import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { EtherApplication, transcodeArtifactForExport } from "@ether/application";
import { importBlob } from "@ether/document";
import { compilePlan, documentStorePersistence, ExecutorRegistry } from "@ether/execution";
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
      id: "connected-mask", definitionId: "edit.mask", title: "Connected Mask", position: { x: 0, y: 110 }, size: { width: 220, height: 160 },
      config: { kind: "edit.mask", mode: "local", feather: 0 },
      presentation: { collapsed: false, accent: "default", previewMode: "summary" }
    }, {
      id: "drawing", definitionId: "canvas.drawing", title: "Drawing", position: { x: 0, y: 220 }, size: { width: 220, height: 160 },
      config: { kind: "canvas.drawing", width: 2, height: 2, background: "#ffffff", strokes: [] },
      presentation: { collapsed: false, accent: "default", previewMode: "content" }
    }],
    edges: [{
      id: "source-edit", from: { kind: "node", nodeId: "source", channel: "image" }, to: { kind: "node", nodeId: "edit", channel: "image" },
      role: "subject", order: 0, selector: { kind: "latest" }, adapter: { kind: "auto" }, enabled: true
    }, {
      id: "mask-edit", from: { kind: "node", nodeId: "connected-mask", channel: "mask" }, to: { kind: "node", nodeId: "edit", channel: "mask" },
      role: "general", order: 1, selector: { kind: "latest" }, adapter: { kind: "auto" }, enabled: true
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
    const connectedMaskBytes = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="white"/></svg>');
    const connectedMaskPath = path.join(root, "connected-mask.svg");
    await writeFile(connectedMaskPath, connectedMaskBytes);
    const connectedMaskBlob = await importBlob(app.boundaryStore(), { sourcePath: connectedMaskPath, mediaType: "image/svg+xml" }, { appDataRoot: root });
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
    const connectedMaskVersion: NodeOutputVersion = {
      ...sourceVersion,
      id: "connected-mask-output", nodeId: "connected-mask", outputPayloadIds: ["connected-mask-payload"], compiledContextHash: "connected-mask"
    };
    const connectedMaskPayload: PayloadEnvelope = {
      id: "connected-mask-payload", channel: "mask", role: "general", content: { kind: "artifact", artifactId: "connected-mask-artifact" },
      source: { nodeId: "connected-mask", outputVersionId: "connected-mask-output", lineageKey: "connected-mask" }, metadata: { width: 2, height: 2 }
    };
    await app.boundaryStore().transaction(({ artifacts, outputs }) => {
      outputs.insert(sourceVersion, [sourcePayload]);
      artifacts.attach({ id: "source-artifact", contentKey: blob.contentKey, channel: "image", mediaType: "image/png", byteLength: sourcePng.byteLength, source: { outputVersionId: "source-output", payloadId: "source-payload" }, createdAt: at, metadata: { width: 2, height: 2 } });
      outputs.insert(connectedMaskVersion, [connectedMaskPayload]);
      artifacts.attach({ id: "connected-mask-artifact", contentKey: connectedMaskBlob.contentKey, channel: "mask", mediaType: "image/svg+xml", byteLength: connectedMaskBytes.byteLength, source: { outputVersionId: "connected-mask-output", payloadId: "connected-mask-payload" }, createdAt: at, metadata: { width: 2, height: 2 } });
    });
    const connectedMaskDocument = await app.queryDocument();
    const connectedMaskPlan = compilePlan({
      id: "connected-mask-plan", documentId: app.boundaryStore().documentId,
      documentRevisionId: connectedMaskDocument.documentRevisionId,
      graph: await app.queryGraph("root"), graphRevisionId: connectedMaskDocument.graphRevisions.root!,
      scope: { kind: "node", nodeId: "edit" }, capability: editCapability,
      providerCapabilities: [editCapability], outputVersions: [sourceVersion, connectedMaskVersion],
      payloads: [sourcePayload, connectedMaskPayload], createdAt: at
    });
    const connectedMaskStep = connectedMaskPlan.steps.find((step) => step.nodeId === "edit")!;
    expect(connectedMaskStep.inputPayloadIds).toEqual(["source-payload", "connected-mask-payload"]);
    expect(connectedMaskStep.compiledContext).not.toHaveProperty("workspaceInputPolicy");

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
    const exactSourceArtifacts = await app.query({
      kind: "query", id: "exact-source-artifacts", correlationId: "exact-source-artifacts",
      documentId: app.boundaryStore().documentId, name: "artifact.search",
      payload: {
        text: "", channels: ["image"], collectionIds: [], tags: [], minimumRating: null,
        providerId: null, modelId: null, runId: null, graphId: null,
        createdAfter: null, createdBefore: null, outputVersionIds: ["source-output"]
      }
    });
    expect(exactSourceArtifacts).toMatchObject({
      kind: "response", name: "artifact.search",
      payload: { artifacts: [{ id: "source-artifact", source: { outputVersionId: "source-output" } }], total: 1 }
    });
    const beforeWorkspaceSave = await app.queryDocument();
    const editNode = (await app.queryGraph("root")).nodes.find((node) => node.id === "edit")!;
    if (editNode.config.kind !== "edit.image" || editNode.config.workspace === undefined) throw new Error("Edit workspace is missing.");
    await app.applyGraphTransaction({ commandId: "save-mask-selection", transaction: {
      id: "save-mask-selection", baseDocumentRevisionId: beforeWorkspaceSave.documentRevisionId,
      baseGraphRevisions: { root: beforeWorkspaceSave.graphRevisions.root! }, title: "Save mask selection", actor: "user", layoutPolicy: "preserve",
      operations: [{ type: "updateNode", graphId: "root", nodeId: "edit", node: {
        ...editNode,
        definitionId: "edit.image",
        config: { ...editNode.config, workspace: { ...editNode.config.workspace, maskArtifactId: first.payload.artifact.id } }
      } as EtherGraph["nodes"][number] }]
    } });
    await app.closeDocument();
    await app.openDocument({ path: documentPath, access: "require-write" });
    expect(await app.readArtifactBytes(first.payload.artifact.id)).toEqual(maskBytes);
    const reopenedEdit = (await app.queryGraph("root")).nodes.find((node) => node.id === "edit")!;
    expect(reopenedEdit.config).toMatchObject({ workspace: { sourceArtifactId: "source-artifact", maskArtifactId: first.payload.artifact.id } });
    const editPlan = await app.previewRun({ commandId: "reopened-edit-plan", graphId: "root", scope: { kind: "node", nodeId: "edit" } });
    const editStep = editPlan.steps.find((step) => step.nodeId === "edit")!;
    expect(editStep.resolvedInputBindings?.map((binding) => [binding.name, binding.payloadId])).toEqual([
      ["workspace.sourceImage", "source-payload"],
      ["workspace.mask", first.payload.artifact.source.payloadId]
    ]);
    expect(editStep.parameters).toMatchObject({ workspace: { capability: { mode: "guidance-only" } } });
    expect(editStep.provider.settings).toMatchObject({ workspace: { capability: { mode: "guidance-only" } } });
    expect(editStep.compiledContext).toMatchObject({ workspaceInputPolicy: "workspace-mask-overrides-connected" });
    const plannedWorkItem = editPlan.workItems.find((item) => editStep.workItemIds.includes(item.id))!;
    const executionStaging = path.join(root, "execution-staging");
    const boundPayloads = await documentStorePersistence(app.boundaryStore()).resolvePayloads(editStep.inputPayloadIds, executionStaging);
    expect(boundPayloads.map((payload) => [payload.channel, payload.metadata.assetPath])).toEqual([
      ["image", expect.stringContaining("resolved-inputs")],
      ["mask", expect.stringContaining("resolved-inputs")]
    ]);
    const materializedByChannel = new Map(boundPayloads.map((payload) => [payload.channel, payload.metadata.assetPath as string]));
    expect(await readFile(materializedByChannel.get("image")!)).toEqual(sourcePng);
    expect(await readFile(materializedByChannel.get("mask")!)).toEqual(maskBytes);
    const executorResult = await new ExecutorRegistry().execute({
      claim: {
        plan: editPlan,
        job: { id: "job-edit", status: "running" },
        workItem: { id: "work-edit", plannedWorkItemId: plannedWorkItem.id, status: "running" },
        attempt: { id: "attempt-edit", ordinal: 1, status: "running", startedAt: at, createdAt: at },
        providerAttemptId: "provider-attempt-edit"
      },
      step: editStep,
      plannedWorkItem,
      inputs: boundPayloads,
      providerInputs: [],
      signal: new AbortController().signal,
      stagingDirectory: root,
      providers: { image: new FakeImageProvider() }
    });
    if (executorResult.kind !== "provider-generation" || executorResult.operation !== "edit") throw new Error("Edit executor did not produce a provider edit request.");
    expect(executorResult.input).toMatchObject({
      sourceImage: { assetId: "source-artifact" },
      mask: { assetId: first.payload.artifact.id, assetMetadata: { maskSemantics: "guidance-only-not-pixel-exact" } },
      notes: expect.stringMatching(/guidance-only.*pixel-exact/i)
    });

    const beforeUnsupported = await app.queryDocument();
    const editBeforeUnsupported = (await app.queryGraph("root")).nodes.find((node) => node.id === "edit")!;
    await app.applyGraphTransaction({ commandId: "mark-edit-unsupported", transaction: {
      id: "mark-edit-unsupported", baseDocumentRevisionId: beforeUnsupported.documentRevisionId,
      baseGraphRevisions: { root: beforeUnsupported.graphRevisions.root! }, title: "Mark edit unsupported", actor: "user", layoutPolicy: "preserve",
      operations: [{ type: "updateNode", graphId: "root", nodeId: "edit", node: {
        ...editBeforeUnsupported,
        definitionId: "edit.image",
        config: editBeforeUnsupported.config.kind === "edit.image" ? {
          ...editBeforeUnsupported.config,
          workspace: { ...editBeforeUnsupported.config.workspace!, capability: { ...editBeforeUnsupported.config.workspace!.capability, mode: "unsupported", detail: "No edit route." } }
        } : editBeforeUnsupported.config
      } as EtherGraph["nodes"][number] }]
    } });
    await expect(app.previewRun({ commandId: "unsupported-plan", graphId: "root", scope: { kind: "node", nodeId: "edit" } }))
      .rejects.toMatchObject({ code: "EDIT_CAPABILITY_UNSUPPORTED" });
    await app.closeDocument();
  });

  it("rejects invalid, oversize, and unsupported publications and keeps guidance metadata honest in plans", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ether-local-output-invalid-")); roots.push(root);
    const app = new EtherApplication({ appDataRoot: root, appVersion: "4.0.0-test", provider: new FakeImageProvider(), providerCapabilities: [editCapability] });
    await app.createDocument({ path: path.join(root, "Invalid.ether"), title: "Invalid", initialGraph: graph() });
    expect(ApplicationCommandSchema.safeParse({ kind: "command", id: "oversize", correlationId: "oversize", documentId: app.boundaryStore().documentId, name: "editWorkspace.commit", payload: { graphId: "root", nodeId: "edit", kind: "mask", channel: "mask", mediaType: "image/svg+xml", width: 2, height: 2, byteLength: 16 * 1024 * 1024 + 1, content: { encoding: "base64", data: "AAAA" }, geometry: { width: 2, height: 2, strokes: [] } } }).success).toBe(false);
    await expect(app.commitEditWorkspace({ commandId: "bad-base64", graphId: "root", nodeId: "edit", kind: "mask", channel: "mask", mediaType: "image/svg+xml", width: 2, height: 2, byteLength: 2, content: { encoding: "base64", data: "%%%=" }, geometry: { width: 2, height: 2, strokes: [] } })).rejects.toMatchObject({ code: "LOCAL_OUTPUT_BASE64_INVALID" });
    await expect(app.commitEditWorkspace({ commandId: "unsupported", graphId: "root", nodeId: "edit", kind: "mask", channel: "mask", mediaType: "image/svg+xml", width: 2, height: 2, byteLength: 4, content: { encoding: "utf8", data: "<svg" }, geometry: { width: 2, height: 2, strokes: [] }, editState: { sourceArtifactId: "source-artifact", recipeId: "freeform", frame: { mode: "source", x: 0, y: 0, width: 2, height: 2 }, maskGeometry: { width: 2, height: 2, strokes: [] }, capability: { providerId: "edit-provider", profileId: "edit-profile", mode: "unsupported", detail: "No edit route." } } })).rejects.toMatchObject({ code: "EDIT_CAPABILITY_UNSUPPORTED" });
    await app.closeDocument();
  });
});
