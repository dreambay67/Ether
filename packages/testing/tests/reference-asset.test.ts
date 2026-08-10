import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { EtherApplication } from "@ether/application";
import { embedReference, importBlob } from "@ether/document";
import { FakeImageProvider } from "@ether/providers";
import type { EtherGraph, GraphTransaction } from "@ether/schema";
import { afterEach, describe, expect, it } from "vitest";

import { createEtherAssetProtocolHandler } from "../../../apps/desktop/src/main/protocol/etherAssetProtocol.js";
import { DesktopApplicationService } from "../../../apps/desktop/src/main/services/applicationService.js";

const roots: string[] = [];
const pngBytes = Buffer.from("89504e470d0a1a0a", "hex");

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("reference ether-asset delivery", () => {
  it("prefers embedded source content while retaining a preview fallback", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ether-reference-asset-"));
    roots.push(root);
    const sourcePath = path.join(root, "reference.png");
    const embeddedPath = path.join(root, "embedded-reference.png");
    const embeddedBytes = Buffer.concat([pngBytes, Buffer.from([1, 2, 3])]);
    await writeFile(sourcePath, pngBytes);
    await writeFile(embeddedPath, embeddedBytes);

    const application = new EtherApplication({
      appDataRoot: path.join(root, "app-data"),
      appVersion: "4.0.0-reference-asset-test",
      pathGrantResolver: {
        resolve: () => ({
          kind: "file" as const,
          mediaType: "image/png",
          path: sourcePath
        })
      },
      provider: new FakeImageProvider()
    });

    try {
      await application.createDocument({
        path: path.join(root, "reference.ether"),
        title: "Reference asset",
        initialGraph: referenceSetGraph()
      });
      await application.grantPathPermit("grant-command", "reference-grant", "reference");
      const linked = await application.linkDocumentReference({
        graphId: "graph-root",
        nodeId: "reference-set",
        pathGrantId: "reference-grant",
        role: "general"
      });
      const preview = await application.queryReferenceAssetDescriptor(linked.id, "reference");
      expect(preview.contentKey).toBe(linked.previewContentKey);

      const embedded = await importBlob(
        application.boundaryStore(),
        { mediaType: "image/png", sourcePath: embeddedPath },
        { appDataRoot: path.join(root, "app-data") }
      );
      await embedReference(application.boundaryStore(), linked.id, embedded.contentKey);

      const descriptor = await application.queryReferenceAssetDescriptor(linked.id, "reference");
      expect(descriptor.contentKey).toBe(embedded.contentKey);
      const streamed: Buffer[] = [];
      for await (const part of application.streamReferenceAssetRange(
        linked.id,
        "reference",
        0,
        embedded.byteLength
      )) {
        streamed.push(part);
      }
      expect(Buffer.concat(streamed)).toEqual(embeddedBytes);
    } finally {
      await application.closeDocument();
    }
  });

  it("authorizes the active reference, resolves its preview blob, and streams bounded ranges", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ether-reference-asset-"));
    roots.push(root);
    const sourcePath = path.join(root, "reference.png");
    await writeFile(sourcePath, pngBytes);

    const service = new DesktopApplicationService({
      appDataRoot: path.join(root, "app-data"),
      appVersion: "4.0.0-reference-asset-test",
      dialogs: {
        openDocument: async () => null,
        saveDocument: async () => null,
        locateReference: async () => sourcePath,
        searchReferenceFolder: async () => null,
        confirmPortable: async () => true
      },
      locationCapability: { classify: () => "local-fixed" },
      provider: new FakeImageProvider()
    });

    try {
      const document = await service.bootstrap();
      await service.applyGraphTransaction(document.documentId, referenceSetTransaction(document));
      const linked = await service.chooseAndLinkReference({
        documentId: document.documentId,
        graphId: document.graphId,
        nodeId: "reference-set",
        role: "general",
        storage: "link"
      });
      if (linked.cancelled) throw new Error("Reference selection unexpectedly cancelled.");

      const descriptor = await service.referenceAssetDescriptor(
        document.documentId,
        linked.referenceId,
        "reference"
      );
      expect(descriptor).toMatchObject({
        byteLength: pngBytes.byteLength,
        mediaType: "image/png"
      });

      const handler = createEtherAssetProtocolHandler({
        authorize: async (documentId, assetId, variant) => {
          if (variant !== "reference") return null;
          try {
            const asset = await service.referenceAssetDescriptor(documentId, assetId, variant);
            return {
              byteLength: asset.byteLength,
              contentHash: asset.contentKey,
              mediaType: asset.mediaType
            };
          } catch {
            return null;
          }
        },
        streamRange: (documentId, assetId, variant, start, endExclusive) => {
          if (variant !== "reference") throw new Error("Unsupported reference asset variant.");
          return service.streamReferenceAssetRange(documentId, assetId, variant, start, endExclusive);
        }
      });
      const url = `ether-asset://${document.documentId}/${linked.referenceId}/reference`;

      const full = await handler(new Request(url));
      expect(full.status).toBe(200);
      expect(full.headers.get("Content-Type")).toBe("image/png");
      expect(Buffer.from(await full.arrayBuffer())).toEqual(pngBytes);

      const range = await handler(new Request(url, { headers: { Range: "bytes=0-3" } }));
      expect(range.status).toBe(206);
      expect(range.headers.get("Content-Range")).toBe(`bytes 0-3/${pngBytes.byteLength}`);
      expect(Buffer.from(await range.arrayBuffer())).toEqual(pngBytes.subarray(0, 4));

      expect((await handler(new Request(
        `ether-asset://${document.documentId}/unknown-reference/reference`
      ))).status).toBe(404);
      expect((await handler(new Request(
        `ether-asset://other-document/${linked.referenceId}/reference`
      ))).status).toBe(404);
      await expect(
        service.referenceAssetDescriptor("other-document", linked.referenceId, "reference")
      ).rejects.toMatchObject({ code: "DOCUMENT_SCOPE_REJECTED" });
    } finally {
      await service.close();
    }
  });
});

function referenceSetTransaction(document: {
  documentId: string;
  documentRevisionId: string;
  graphId: string;
  graphRevisionId: string;
}): GraphTransaction {
  return {
    id: "reference-set-transaction",
    baseDocumentRevisionId: document.documentRevisionId,
    baseGraphRevisions: { [document.graphId]: document.graphRevisionId },
    title: "Add reference set",
    actor: "user",
    layoutPolicy: "preserve",
    operations: [{
      type: "addNode",
      graphId: document.graphId,
      node: {
        id: "reference-set",
        definitionId: "reference.set",
        title: "Reference Set",
        position: { x: 0, y: 0 },
        size: { width: 240, height: 180 },
        config: {
          kind: "reference.set",
          artifactIds: [],
          enabledChannels: ["image"],
          ordering: "manual"
        },
        presentation: { collapsed: false, accent: "default", previewMode: "content" }
      }
    }]
  };
}

function referenceSetGraph(): EtherGraph {
  const timestamp = "2026-08-10T00:00:00.000Z";
  return {
    id: "graph-root",
    title: "References",
    kind: "root",
    createdAt: timestamp,
    updatedAt: timestamp,
    nodes: [{
      id: "reference-set",
      definitionId: "reference.set",
      title: "Reference Set",
      position: { x: 0, y: 0 },
      size: { width: 240, height: 180 },
      config: {
        kind: "reference.set",
        artifactIds: [],
        enabledChannels: ["image"],
        ordering: "manual"
      },
      presentation: { collapsed: false, accent: "default", previewMode: "content" }
    }],
    edges: [],
    groups: [],
    modules: [],
    viewState: {
      viewport: { x: 0, y: 0, zoom: 1 },
      selectedNodeIds: [],
      selectedEdgeIds: [],
      inspectorTarget: null
    }
  };
}
