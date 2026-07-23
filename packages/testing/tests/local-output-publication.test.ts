import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { EtherApplication, transcodeArtifactForExport } from "@ether/application";
import { importBlob } from "@ether/document";
import { FakeImageProvider } from "@ether/providers";
import { ApplicationCommandSchema, type EtherGraph, type GraphTransaction, type NodeOutputVersion, type PayloadEnvelope, type ProviderCapability } from "@ether/schema";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];
const at = "2026-07-23T08:00:00.000Z";
const editCapability: ProviderCapability = {
  providerId: "edit-provider", profileId: "edit-profile", operation: "edit-image",
  inputChannels: ["image", "mask"], outputChannels: ["image"], aspectRatios: [], resolutions: [],
  maxReferences: 2, maxOutputsPerCall: 1, supportsCancellation: true, supportsSeed: false,
  provenance: "conformance-verified", limitations: ["Mask input is guidance-only; pixel-exact native inpainting is not guaranteed."]
};

function graph(): EtherGraph {
  return {
    id: "root", title: "Local outputs", kind: "root", createdAt: at, updatedAt: at,
    nodes: [{
      id: "source", definitionId: "generation.image", title: "Source", position: { x: 0, y: 0 }, size: { width: 220, height: 160 },
      config: { kind: "generation.image", providerId: "ether-fake-local", profileId: "fake-image-default", aspectRatio: "1:1", resolution: { width: 2, height: 2 }, outputCount: 1 },
      presentation: { collapsed: false, accent: "default", previewMode: "summary" }
    }, {
      id: "edit", definitionId: "edit.image", title: "Edit", position: { x: 280, y: 0 }, size: { width: 220, height: 160 },
      config: {
        kind: "edit.image", providerId: "edit-provider", profileId: "edit-profile", strength: .7, outputCount: 1,
        workspace: {
          sourceArtifactId: "source-artifact", recipeId: "object-removal",
          frame: { mode: "source", x: 0, y: 0, width: 2, height: 2 },
          maskGeometry: { width: 2, height: 2, strokes: [] },
          capability: { providerId: "edit-provider", profileId: "edit-profile", mode: "guidance-only", detail: "Guidance only." }
        }
      },
      presentation: { collapsed: false, accent: "default", previewMode: "summary" }
    }, {
      id: "drawing", definitionId: "canvas.drawing", title: "Drawing", position: { x: 0, y: 220 }, size: { width: 220, height: 160 },
      config: { kind: "canvas.drawing", width: 2, height: 2, background: "#ffffff", strokes: [] },
      presentation: { collapsed: false, accent: "default", previewMode: "content" }
    }],
    edges: [{
      id: "source-edit", from: { kind: "node", nodeId: "source", channel: "image" }, to: { kind: "node", nodeId: "edit", channel: "image" },
      role: "subject", order: 0, selector: { kind: "latest" }, adapter: { kind: "auto" }, enabled: true
    }],
    groups: [], modules: [],
    viewState: { viewport: { x: 0, y: 0, zoom: 1 }, selectedNodeIds: [], selectedEdgeIds: [], inspectorTarget: null }
  };
}

afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe("typed local output publication", () => {
  it("persists drawing strokes and publishes drawing/mask artifacts idempotently with exact bytes and lineage", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ether-local-output-"));
    roots.push(root);
    const documentPath = path.join(root, "Local.ether");
    const app = new EtherApplication({ appDataRoot: root, appVersion: "4.0.0-test", provider: new FakeImageProvider(), providerCapabilities: [editCapability] });
    const events: string[] = [];
    app.events.subscribe((event) => events.push(`${event.name}:${"artifactId" in event.payload ? event.payload.artifactId : "outputVersionId" in event.payload ? event.payload.outputVersionId : ""}`));
    await app.createDocument({ path: documentPath, title: "Local", initialGraph: graph() });
    const snapshot = await app.queryDocument();
    const drawing = (await app.queryGraph("root")).nodes.find((node) => node.id === "drawing")!;
    const strokes = [{ id: "stroke-1", color: "#123456", width: 7, points: [{ x: 0, y: 0, pressure: .5 }, { x: 2, y: 2, pressure: 1 }] }];
    const transaction: GraphTransaction = {
      id: "drawing-strokes", baseDocumentRevisionId: snapshot.documentRevisionId, baseGraphRevisions: { root: snapshot.graphRevisions.root! },
      title: "Persist drawing", actor: "user", layoutPolicy: "preserve",
      operations: [{ type: "updateNode", graphId: "root", nodeId: "drawing", node: { ...drawing, definitionId: "canvas.drawing", config: { kind: "canvas.drawing", width: 2, height: 2, background: "#ffffff", strokes } } as EtherGraph["nodes"][number] }]
    };
    await app.applyGraphTransaction({ commandId: "drawing-transaction", transaction });
    await app.closeDocument();
    await app.openDocument({ path: documentPath, access: "require-write" });
    expect((await app.queryGraph("root")).nodes.find((node) => node.id === "drawing")?.config).toMatchObject({ strokes });

    const sourceSvg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="red"/></svg>');
    const sourcePng = await transcodeArtifactForExport(sourceSvg, "image/svg+xml", "png");
    const sourcePath = path.join(root, "source.png");
    await writeFile(sourcePath, sourcePng);
    const blob = await importBlob(app.boundaryStore(), { sourcePath, mediaType: "image/png" }, { appDataRoot: root });
    const head = await app.boundaryStore().read(({ revisions }) => revisions.head());
    const sourceVersion: NodeOutputVersion = {
      id: "source-output", nodeId: "source", graphId: "root", graphRevisionId: head.graphRevisions.root!, inputPayloadIds: [], selectedOutputVersionIds: [],
      compiledContextHash: "source", producer: { kind: "local", executor: "image-provider" }, outputPayloadIds: ["source-payload"], parentOutputVersionId: null,
      approval: { state: "unreviewed" }, runId: null, stepId: null, workItemId: null, attemptId: null,
      timing: { startedAt: at, completedAt: at }, failure: null, createdAt: at
    };
    const sourcePayload: PayloadEnvelope = {
      id: "source-payload", channel: "image", role: "subject", content: { kind: "artifact", artifactId: "source-artifact" },
      source: { nodeId: "source", outputVersionId: "source-output", lineageKey: "source" }, metadata: { width: 2, height: 2 }
    };
    await app.boundaryStore().transaction(({ artifacts, outputs }) => {
      outputs.insert(sourceVersion, [sourcePayload]);
      artifacts.attach({ id: "source-artifact", contentKey: blob.contentKey, channel: "image", mediaType: "image/png", byteLength: sourcePng.byteLength, source: { outputVersionId: "source-output", payloadId: "source-payload" }, createdAt: at, metadata: { width: 2, height: 2 } });
    });

    const drawingSvg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><path d="M0 0 L2 2" stroke="#123456"/></svg>');
    const drawingResponse = await app.execute({
      kind: "command", id: "drawing-publish", correlationId: "drawing-publish", documentId: app.boundaryStore().documentId, name: "editWorkspace.commit",
      payload: { graphId: "root", nodeId: "drawing", kind: "drawing", channel: "image", mediaType: "image/svg+xml", width: 2, height: 2, byteLength: drawingSvg.byteLength, content: { encoding: "base64", data: drawingSvg.toString("base64") }, drawing: { kind: "canvas.drawing", width: 2, height: 2, background: "#ffffff", strokes } }
    });
    expect(drawingResponse).toMatchObject({ kind: "response", name: "editWorkspace.commit", payload: { artifact: { channel: "image" }, outputVersion: { producer: { kind: "local", executor: "drawing" } } } });
    if (drawingResponse.kind !== "response" || drawingResponse.name !== "editWorkspace.commit") throw new Error("Drawing publication failed.");
    expect(await app.readArtifactBytes(drawingResponse.payload.artifact.id)).toEqual(drawingSvg);
    expect(drawingResponse.payload.artifact.metadata).toMatchObject({ drawing: { strokes } });

    const comment = "x".repeat(300 * 1024);
    const maskBytes = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><!--${comment}--><rect width="2" height="2" fill="black"/></svg>`);
    const geometry = { width: 2, height: 2, strokes: [{ id: "mask-1", tool: "brush" as const, size: 1, opacity: .8, points: [{ x: 0, y: 0, pressure: 1 }] }] };
    const editState = { sourceArtifactId: "source-artifact", recipeId: "object-removal" as const, frame: { mode: "source" as const, x: 0, y: 0, width: 2, height: 2 }, maskGeometry: geometry, capability: { providerId: "edit-provider", profileId: "edit-profile", mode: "guidance-only" as const, detail: "Guidance only." } };
    const command = { kind: "command" as const, id: "mask-publish", correlationId: "mask-publish", documentId: app.boundaryStore().documentId, name: "editWorkspace.commit" as const,
      payload: { graphId: "root", nodeId: "edit", kind: "mask" as const, channel: "mask" as const, mediaType: "image/svg+xml" as const, width: 2, height: 2, byteLength: maskBytes.byteLength, content: { encoding: "utf8" as const, data: maskBytes.toString("utf8") }, geometry, editState } };
    const first = await app.execute(command);
    const duplicate = await app.execute(command);
    expect(duplicate).toMatchObject({ kind: "response", payload: first.kind === "response" ? first.payload : {} });
    if (first.kind !== "response" || first.name !== "editWorkspace.commit") throw new Error("Mask publication failed.");
    expect(await app.readArtifactBytes(first.payload.artifact.id)).toEqual(maskBytes);
    const persisted = await app.boundaryStore().read(({ artifacts, blobs, outputs }) => ({
      detail: artifacts.detail(first.payload.artifact.id),
      artifacts: artifacts.listByOutputVersion(first.payload.outputVersion.id),
      blob: blobs.get(first.payload.artifact.contentKey),
      outputs: outputs.listByNode("edit")
    }));
    expect(persisted.blob).toMatchObject({ storage: "chunked" });
    expect(persisted.artifacts).toHaveLength(1);
    expect(persisted.outputs).toHaveLength(1);
    expect(persisted.detail).toMatchObject({ artifact: { metadata: { geometry, editCapabilityMode: "guidance-only", maskSemantics: "guidance-only-not-pixel-exact" } }, lineage: [expect.objectContaining({ parentArtifactId: "source-artifact", childArtifactId: first.payload.artifact.id, relation: "edited-from" })] });
    expect(events.filter((event) => event === `artifact.changed:${first.payload.artifact.id}`)).toHaveLength(1);
    expect(events.filter((event) => event === `output.created:${first.payload.outputVersion.id}`)).toHaveLength(1);
    await app.closeDocument();
    await app.openDocument({ path: documentPath, access: "require-write" });
    expect(await app.readArtifactBytes(first.payload.artifact.id)).toEqual(maskBytes);
    await app.closeDocument();
  });

  it("rejects invalid, oversize, and unsupported publications and keeps guidance metadata honest in plans", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ether-local-output-invalid-")); roots.push(root);
    const app = new EtherApplication({ appDataRoot: root, appVersion: "4.0.0-test", provider: new FakeImageProvider(), providerCapabilities: [editCapability] });
    await app.createDocument({ path: path.join(root, "Invalid.ether"), title: "Invalid", initialGraph: graph() });
    expect(ApplicationCommandSchema.safeParse({ kind: "command", id: "oversize", correlationId: "oversize", documentId: app.boundaryStore().documentId, name: "editWorkspace.commit", payload: { graphId: "root", nodeId: "edit", kind: "mask", channel: "mask", mediaType: "image/svg+xml", width: 2, height: 2, byteLength: 16 * 1024 * 1024 + 1, content: { encoding: "base64", data: "AAAA" }, geometry: { width: 2, height: 2, strokes: [] } } }).success).toBe(false);
    await expect(app.commitEditWorkspace({ commandId: "bad-base64", graphId: "root", nodeId: "edit", kind: "mask", channel: "mask", mediaType: "image/svg+xml", width: 2, height: 2, byteLength: 2, content: { encoding: "base64", data: "%%%=" }, geometry: { width: 2, height: 2, strokes: [] } })).rejects.toMatchObject({ code: "LOCAL_OUTPUT_BASE64_INVALID" });
    await expect(app.commitEditWorkspace({ commandId: "unsupported", graphId: "root", nodeId: "edit", kind: "mask", channel: "mask", mediaType: "image/svg+xml", width: 2, height: 2, byteLength: 4, content: { encoding: "utf8", data: "<svg" }, geometry: { width: 2, height: 2, strokes: [] }, editState: { sourceArtifactId: "source-artifact", recipeId: "freeform", frame: { mode: "source", x: 0, y: 0, width: 2, height: 2 }, maskGeometry: { width: 2, height: 2, strokes: [] }, capability: { providerId: "edit-provider", profileId: "edit-profile", mode: "unsupported", detail: "No edit route." } } })).rejects.toMatchObject({ code: "EDIT_CAPABILITY_UNSUPPORTED" });
    const plan = await app.previewRun({ commandId: "guidance-plan", graphId: "root", scope: { kind: "node", nodeId: "edit" } });
    const step = plan.steps.find((candidate) => candidate.nodeId === "edit")!;
    expect(step.parameters).toMatchObject({ workspace: { capability: { mode: "guidance-only" } } });
    expect(step.provider.settings).toMatchObject({ workspace: { capability: { mode: "guidance-only" } } });
    const current = await app.queryDocument();
    const edit = (await app.queryGraph("root")).nodes.find((node) => node.id === "edit")!;
    await app.applyGraphTransaction({ commandId: "mark-edit-unsupported", transaction: {
      id: "mark-edit-unsupported", baseDocumentRevisionId: current.documentRevisionId, baseGraphRevisions: { root: current.graphRevisions.root! },
      title: "Mark edit unsupported", actor: "user", layoutPolicy: "preserve",
      operations: [{ type: "updateNode", graphId: "root", nodeId: "edit", node: {
        ...edit,
        definitionId: "edit.image",
        config: edit.config.kind === "edit.image" ? {
          ...edit.config,
          workspace: { ...edit.config.workspace!, capability: { ...edit.config.workspace!.capability, mode: "unsupported", detail: "No edit route." } }
        } : edit.config
      } as EtherGraph["nodes"][number] }]
    } });
    await expect(app.previewRun({ commandId: "unsupported-plan", graphId: "root", scope: { kind: "node", nodeId: "edit" } }))
      .rejects.toMatchObject({ code: "EDIT_CAPABILITY_UNSUPPORTED" });
    await app.closeDocument();
  });
});
