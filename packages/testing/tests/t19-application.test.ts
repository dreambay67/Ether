import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { EtherApplication } from "../../application/src/application.js";
import { importBlob } from "@ether/document";
import { nodeDefinitions } from "@ether/graph-kernel";
import { FakeImageProvider } from "@ether/providers";
import type { EtherGraph, NodeOutputVersion, PayloadEnvelope } from "@ether/schema";
import { afterEach, describe, expect, it } from "vitest";

const timestamp = "2026-08-03T12:00:00.000Z";
const roots: string[] = [];

function blankGraph(): EtherGraph {
  const note = nodeDefinitions.find((definition) => definition.id === "canvas.note")!;
  return {
    id: "root",
    title: "T19",
    kind: "root",
    createdAt: timestamp,
    updatedAt: timestamp,
    nodes: [{ id: "node", definitionId: "canvas.note", title: "Node", position: { x: 0, y: 0 }, size: { width: 240, height: 180 }, config: note.defaultConfig(), presentation: { collapsed: false, accent: "default", previewMode: "content" } }],
    edges: [],
    groups: [],
    modules: [],
    viewState: { viewport: { x: 0, y: 0, zoom: 1 }, selectedNodeIds: [], selectedEdgeIds: [], inspectorTarget: null }
  };
}

async function createArtifact(app: EtherApplication, root: string, id: string, title: string) {
  const bytes = Buffer.from(`embedded-${id}`, "utf8");
  const sourcePath = path.join(root, `${id}.bin`);
  await writeFile(sourcePath, bytes);
  const blob = await importBlob(app.boundaryStore(), { sourcePath, mediaType: "application/octet-stream" }, { appDataRoot: root });
  const outputVersionId = `output-${id}`;
  const document = await app.queryDocument();
  const payload: PayloadEnvelope = {
    id: `payload-${id}`,
    channel: "data",
    role: "general",
    content: { kind: "artifact", artifactId: id },
    source: { nodeId: "node", outputVersionId, lineageKey: "generated" },
    metadata: {}
  };
  const version: NodeOutputVersion = {
    id: outputVersionId,
    nodeId: "node",
    graphId: "root",
    graphRevisionId: document.graphRevisions.root!,
    inputPayloadIds: [],
    selectedOutputVersionIds: [],
    compiledContextHash: `hash-${id}`,
    producer: { kind: "local", executor: "transform" },
    outputPayloadIds: [payload.id],
    parentOutputVersionId: null,
    approval: { state: "unreviewed" },
    runId: null,
    stepId: null,
    workItemId: null,
    attemptId: null,
    timing: { startedAt: timestamp, completedAt: timestamp },
    failure: null,
    createdAt: timestamp
  };
  await app.boundaryStore().transaction(({ outputs, artifacts }) => {
    outputs.insert(version, [payload]);
    artifacts.attach({
      id,
      contentKey: blob.contentKey,
      channel: "data",
      mediaType: "application/octet-stream",
      byteLength: bytes.byteLength,
      source: { outputVersionId, payloadId: payload.id },
      createdAt: timestamp,
      metadata: { title }
    });
  });
  return { bytes, contentKey: blob.contentKey, id };
}

async function createApp(root: string, exportRoot: string, liveRoot: string) {
  const app = new EtherApplication({
    appDataRoot: root,
    appVersion: "4.0.0-test",
    provider: new FakeImageProvider(),
    pathGrantResolver: {
      resolve: ({ pathGrantId }) => ({
        kind: "directory",
        path: pathGrantId === "export-grant" ? exportRoot : liveRoot
      })
    }
  });
  await app.createDocument({ path: path.join(root, "T19.ether"), title: "T19", initialGraph: blankGraph() });
  return app;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("T19 durable collection and export workflows", () => {
  it("refreshes Live Output after membership changes without losing embedded bytes", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ether-t19-live-"));
    roots.push(root);
    const exportRoot = path.join(root, "exports");
    const liveRoot = path.join(root, "live");
    await mkdir(exportRoot);
    await mkdir(liveRoot);
    const app = await createApp(root, exportRoot, liveRoot);
    try {
      const artifact = await createArtifact(app, root, "artifact-live", "Live sample");
      await app.grantPathPermit("live-permit", "live-grant", "live-output");
      await app.execute({ kind: "command", id: "live-enable", correlationId: "live-enable", documentId: (await app.queryDocument()).documentId, name: "liveOutput.enable", payload: { pathGrantId: "live-grant", namingPolicy: "artifact", collisionPolicy: "rename", transferPolicy: "move" } });
      const created = await app.execute({ kind: "command", id: "collection-create", correlationId: "collection-create", documentId: (await app.queryDocument()).documentId, name: "collection.create", payload: { title: "Final/Set", primary: true } });
      if (created.kind !== "response" || created.name !== "collection.create") throw new Error("Collection creation failed.");
      await app.execute({ kind: "command", id: "collection-add", correlationId: "collection-add", documentId: (await app.queryDocument()).documentId, name: "collection.addMembers", payload: { collectionId: created.payload.collection.id, members: [{ artifactId: artifact.id, role: "general", position: 0 }] } });

      const entries = await app.liveOutputEntries({ artifactId: artifact.id });
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ collectionId: created.payload.collection.id, relativePath: "Final-Set/artifact-live.bin", expectedHash: artifact.contentKey });
      expect(await readFile(path.join(liveRoot, "Final-Set", "artifact-live.bin"))).toEqual(artifact.bytes);
      expect(createHash("sha256").update(await readFile(path.join(liveRoot, "Final-Set", "artifact-live.bin"))).digest("hex")).toBe(artifact.contentKey);
      expect(await readdir(liveRoot)).toEqual(["Final-Set"]);
    } finally {
      await app.closeDocument();
    }
  });

  it("requires an export grant and preserves hierarchical placeholder names", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ether-t19-export-"));
    roots.push(root);
    const exportRoot = path.join(root, "exports");
    const liveRoot = path.join(root, "live");
    await mkdir(exportRoot);
    await mkdir(liveRoot);
    const app = await createApp(root, exportRoot, liveRoot);
    try {
      const artifact = await createArtifact(app, root, "artifact-export", "Summer:Hero");
      const documentId = (await app.queryDocument()).documentId;
      const created = await app.execute({ kind: "command", id: "collection-create", correlationId: "collection-create", documentId, name: "collection.create", payload: { title: "Final/Set", primary: true } });
      if (created.kind !== "response" || created.name !== "collection.create") throw new Error("Collection creation failed.");
      await app.execute({ kind: "command", id: "collection-add", correlationId: "collection-add", documentId, name: "collection.addMembers", payload: { collectionId: created.payload.collection.id, members: [{ artifactId: artifact.id, role: "general", position: 0 }] } });

      const input = { artifactIds: [artifact.id], collisionPolicy: "rename" as const, commandId: "missing-grant", namingTemplate: "{collection}/{title}-{artifactId}", pathGrantId: "missing-grant", includeMetadataSidecar: true, includeLineageReport: true };
      await expect(app.exportArtifacts(input)).rejects.toMatchObject({ code: "PATH_PERMISSION_REQUIRED" });
      await app.grantPathPermit("export-permit", "export-grant", "export");
      const exported = await app.exportArtifacts({ ...input, commandId: "export-1", pathGrantId: "export-grant" });
      expect(exported[0]).toMatchObject({ status: "committed" });
      expect(exported[0]?.relativePath.replaceAll("\\", "/")).toBe("Final-Set/Summer-Hero-artifact-export.bin");
      expect(await readFile(path.join(exportRoot, "Final-Set", "Summer-Hero-artifact-export.bin"))).toEqual(artifact.bytes);
      expect(await readFile(path.join(exportRoot, "Final-Set", "Summer-Hero-artifact-export.bin.metadata.json"))).toBeTruthy();
      expect(await readFile(path.join(exportRoot, "Final-Set", "Summer-Hero-artifact-export.bin.lineage.json"))).toBeTruthy();
      await writeFile(path.join(exportRoot, "Final-Set", "Summer-Hero-artifact-export.bin"), Buffer.from("different"));
      const collision = await app.exportArtifacts({ ...input, commandId: "export-2", pathGrantId: "export-grant" });
      expect(collision[0]?.relativePath.replaceAll("\\", "/")).toBe("Final-Set/Summer-Hero-artifact-export-2.bin");
      for (const [index, namingTemplate] of ["../escape", "C:\\escape", "{colletion}/{title}"].entries()) {
        await expect(app.exportArtifacts({ ...input, commandId: `invalid-${index}`, namingTemplate, pathGrantId: "export-grant" })).rejects.toMatchObject({ code: "EXPORT_TEMPLATE_INVALID" });
      }
    } finally {
      await app.closeDocument();
    }
  });
});
