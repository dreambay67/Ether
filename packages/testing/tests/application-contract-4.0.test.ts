import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { EtherApplication } from "@ether/application";
import { importBlob } from "@ether/document";
import { ExecutorRegistry, type ExecutionProviderFacets } from "@ether/execution";
import { nodeDefinitions } from "@ether/graph-kernel";
import { CODEX_PROVIDER_ID, CodexCliImageProvider, FakeImageProvider, type GenerationProvider } from "@ether/providers";
import {
  ApplicationCommandSchema,
  EtherGraphSchema,
  type EtherGraph,
  type GraphTransaction,
  type NodeOutputVersion,
  type PayloadEnvelope,
  type ProviderCapability
} from "@ether/schema";
import { afterEach, describe, expect, it } from "vitest";

import { DesktopApplicationService } from "../../../apps/desktop/src/main/services/applicationService";

const roots: string[] = [];
const timestamp = "2026-07-22T10:00:00.000Z";

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "ether-application-contract-"));
  roots.push(root);
  return root;
}

function graph(): EtherGraph {
  return {
    id: "root", title: "Contract", kind: "root", createdAt: timestamp, updatedAt: timestamp,
    nodes: [], edges: [], groups: [], modules: [],
    viewState: { viewport: { x: 0, y: 0, zoom: 1 }, selectedNodeIds: [], selectedEdgeIds: [], inspectorTarget: null }
  };
}

type GraphNode = EtherGraph["nodes"][number];

function oneNodeGraph<DefinitionId extends GraphNode["definitionId"]>(
  id: string,
  definitionId: DefinitionId,
  config: Extract<GraphNode, { definitionId: DefinitionId }>["config"]
): EtherGraph {
  return EtherGraphSchema.parse({
    ...graph(),
    id: `graph-${id}`,
    nodes: [{
      id,
      definitionId,
      title: id,
      position: { x: 0, y: 0 },
      size: { width: 240, height: 180 },
      config,
      presentation: { collapsed: false, accent: "default", previewMode: "content" }
    }]
  });
}

function transaction(documentRevisionId: string, graphRevisionId: string): GraphTransaction {
  return {
    id: "add-generator", baseDocumentRevisionId: documentRevisionId, baseGraphRevisions: { root: graphRevisionId },
    title: "Prompt to image", actor: "user", layoutPolicy: "preserve", operations: [
      {
        type: "addNode", graphId: "root", node: {
          id: "prompt", definitionId: "prompt.text", title: "Prompt", position: { x: 0, y: 0 }, size: { width: 240, height: 180 },
          config: { kind: "prompt.text", body: "A precise studio product photograph.", assembly: "append" },
          presentation: { collapsed: false, accent: "default", previewMode: "content" }
        }
      },
      {
        type: "addNode", graphId: "root", node: {
          id: "references", definitionId: "reference.set", title: "References", position: { x: 0, y: 240 }, size: { width: 240, height: 180 },
          config: { kind: "reference.set", artifactIds: [], enabledChannels: ["image"], ordering: "manual" },
          presentation: { collapsed: false, accent: "default", previewMode: "content" }
        }
      },
      {
        type: "addNode", graphId: "root", node: {
          id: "compare", definitionId: "review.compare", title: "Compare", position: { x: 640, y: 0 }, size: { width: 240, height: 180 },
          config: { kind: "review.compare", selectionMode: "one", minimumSelections: 1 },
          presentation: { collapsed: false, accent: "default", previewMode: "summary" }
        }
      },
      {
        type: "addNode", graphId: "root", node: {
          id: "image", definitionId: "generation.image", title: "Image", position: { x: 320, y: 0 }, size: { width: 240, height: 180 },
          config: { kind: "generation.image", providerId: "ether-fake-local", profileId: "fake-image-default", aspectRatio: "1:1", resolution: { width: 32, height: 32 }, outputCount: 1 },
          presentation: { collapsed: false, accent: "default", previewMode: "summary" }
        }
      },
      {
        type: "addEdge", graphId: "root", edge: {
          id: "prompt-image", from: { kind: "node", nodeId: "prompt", channel: "text" }, to: { kind: "node", nodeId: "image", channel: "text" },
          role: "subject", order: 0, selector: { kind: "latest-approved" }, adapter: { kind: "auto" }, enabled: true
        }
      },
      {
        type: "addEdge", graphId: "root", edge: {
          id: "image-compare", from: { kind: "node", nodeId: "image", channel: "image" }, to: { kind: "node", nodeId: "compare", channel: "image" },
          role: "general", order: 0, selector: { kind: "latest" }, adapter: { kind: "auto" }, enabled: true
        }
      }
    ]
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Ether 4.0 application boundary", () => {
  it("projects all canonical factory defaults through the serializable node catalog", async () => {
    const root = await temporaryRoot();
    const app = new EtherApplication({
      appDataRoot: root,
      appVersion: "4.0.0-test",
      provider: new FakeImageProvider()
    });
    const response = await app.query({
      kind: "query",
      id: "node-catalog",
      correlationId: "node-catalog",
      name: "node.catalog",
      payload: {}
    });
    expect(response).toMatchObject({ kind: "response", name: "node.catalog" });
    if (response.kind !== "response" || response.name !== "node.catalog") {
      throw new Error("The node catalog did not return.");
    }
    expect(response.payload.nodes).toHaveLength(17);
    expect(response.payload.nodes.map((item) => item.definitionId)).toEqual(nodeDefinitions.map((item) => item.id));
    for (const item of response.payload.nodes) {
      expect(item.defaultConfig.kind).toBe(item.definitionId);
      expect(item.description.length).toBeGreaterThan(24);
      expect(item.presentation.width).toBeGreaterThanOrEqual(220);
    }

    const desktop = new DesktopApplicationService({
      appDataRoot: path.join(root, "desktop"),
      appVersion: "4.0.0-test",
      dialogs: {
        openDocument: async () => null,
        saveDocument: async () => null,
        locateReference: async () => null,
        searchReferenceFolder: async () => null,
        confirmPortable: async () => true
      },
      provider: new FakeImageProvider()
    });
    try {
      const processGlobalResponse = await desktop.executeApplicationQuery({
        kind: "query",
        id: "desktop-node-catalog",
        correlationId: "desktop-node-catalog",
        name: "node.catalog",
        payload: {}
      });
      expect(processGlobalResponse.name).toBe("node.catalog");
      if (processGlobalResponse.name !== "node.catalog") throw new Error("Expected desktop node catalog response.");
      expect(processGlobalResponse.payload.nodes.map((item) => item.definitionId))
        .toEqual(nodeDefinitions.map((item) => item.id));
    } finally {
      await desktop.close();
    }
  });

  it("runs a fresh logical Codex Image Generator through the deterministic fake request boundary", async () => {
    const root = await temporaryRoot();
    const fake = new FakeImageProvider();
    const requests: unknown[] = [];
    const codexFake = {
      descriptor: { ...fake.descriptor, id: CODEX_PROVIDER_ID },
      diagnose: () => ({ ...fake.diagnose(), id: CODEX_PROVIDER_ID }),
      generate: async (input: Parameters<GenerationProvider["generate"]>[0], context?: Parameters<GenerationProvider["generate"]>[1]) => {
        requests.push(input);
        const result = await fake.generate(input, context === undefined ? undefined : {
          ...context,
          complete: (value) => context.complete({ ...value, providerId: CODEX_PROVIDER_ID })
        });
        return { ...result, providerId: CODEX_PROVIDER_ID };
      },
      edit: async (input: Parameters<GenerationProvider["edit"]>[0], context?: Parameters<GenerationProvider["edit"]>[1]) => {
        requests.push(input);
        const result = await fake.edit(input, context === undefined ? undefined : {
          ...context,
          complete: (value) => context.complete({ ...value, providerId: CODEX_PROVIDER_ID })
        });
        return { ...result, providerId: CODEX_PROVIDER_ID };
      }
    } as unknown as GenerationProvider;
    const imageCapability: ProviderCapability = {
      providerId: CODEX_PROVIDER_ID, profileId: "image-default", operation: "generate-image",
      inputChannels: ["text", "image", "data"], outputChannels: ["image"], aspectRatios: ["1:1"],
      resolutions: [{ id: "32", width: 32, height: 32, label: "32 x 32" }], maxReferences: 8, maxOutputsPerCall: 1,
      supportsCancellation: true, supportsSeed: false, provenance: "runtime-discovered", limitations: []
    };
    const config = nodeDefinitions.find((definition) => definition.id === "generation.image")!.defaultConfig();
    if (config.kind !== "generation.image") throw new Error("Expected canonical Image Generator defaults.");
    const logicalGraph = oneNodeGraph("image", "generation.image", { ...config, resolution: { width: 32, height: 32 } });
    const app = new EtherApplication({ appDataRoot: root, appVersion: "4.0.0-test", provider: codexFake, providerCapabilities: [imageCapability], dispatchMode: "manual" });
    try {
      await app.createDocument({ path: path.join(root, "logical-codex.ether"), title: "Logical Codex", initialGraph: logicalGraph });
      const preview = await app.previewRun({ commandId: "logical-codex-preview", graphId: logicalGraph.id, scope: { kind: "node", nodeId: "image" } });
      expect(preview.steps.find((step) => step.nodeId === "image")?.providerBinding).toMatchObject({ providerId: CODEX_PROVIDER_ID, profileId: "image-default" });
      const permit = await app.grantRunPermit({ commandId: "logical-codex-permit", planId: preview.id, contentHash: preview.contentHash });
      const started = await app.startRun({ commandId: "logical-codex-start", planId: preview.id, contentHash: preview.contentHash, runPermitId: permit.id });
      await app.runPending(started.id);
      const completed = await app.waitForJob(started.id);
      expect(completed.status).toBe("completed");
      expect(requests).toHaveLength(1);
      expect(requests[0]).toMatchObject({ generationNodeId: "image", output: { aspectRatio: "1:1", width: 32, height: 32 } });
    } finally {
      await app.closeDocument();
    }
  });

  it("previews a provider-free node without requiring an unrelated reasoning route", async () => {
    const root = await temporaryRoot();
    const worker = nodeDefinitions.find((definition) => definition.id === "prompt.worker")!;
    const transform = nodeDefinitions.find((definition) => definition.id === "edit.transform")!;
    const localGraph = EtherGraphSchema.parse({
      ...graph(),
      nodes: [worker, transform].map((definition, index) => ({
        id: `scoped-${definition.id.replaceAll(".", "-")}`,
        definitionId: definition.id,
        title: definition.title,
        position: { x: index * 320, y: 0 },
        size: { width: 240, height: 180 },
        config: definition.defaultConfig(),
        presentation: { collapsed: false, accent: "default", previewMode: "content" }
      }))
    });
    const app = new EtherApplication({
      appDataRoot: root,
      appVersion: "4.0.0-test",
      provider: new FakeImageProvider()
    });
    await app.createDocument({
      path: path.join(root, "scoped-local.ether"),
      title: "Scoped local",
      initialGraph: localGraph
    });
    const capabilityResponse = await app.query({
      kind: "query",
      id: "scoped-capabilities",
      correlationId: "scoped-capabilities",
      name: "provider.capabilities",
      payload: {}
    });
    expect(capabilityResponse).toMatchObject({
      kind: "response",
      name: "provider.capabilities"
    });
    if (capabilityResponse.kind !== "response" || capabilityResponse.name !== "provider.capabilities") {
      throw new Error("Provider capability inspection did not return.");
    }
    expect(capabilityResponse.payload.capabilities).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ providerId: "ether-intelligence" })
    ]));
    const plan = await app.previewRun({
      commandId: "preview-scoped-local",
      graphId: localGraph.id,
      scope: { kind: "node", nodeId: "scoped-edit-transform" }
    }).finally(() => app.closeDocument());
    expect(plan.estimatedCalls).toBe(0);
    expect(plan.steps).toEqual([
      expect.objectContaining({
        nodeId: "scoped-edit-transform",
        executor: "transform",
        providerBinding: null
      })
    ]);
  });

  it("applies the four-call production Codex profile ceiling without configured capabilities", async () => {
    const root = await temporaryRoot();
    const provider = new CodexCliImageProvider({
      codexCliPath: path.join(root, "codex.exe"),
      fileExists: async () => true
    });
    const app = new EtherApplication({ appDataRoot: root, appVersion: "4.0.0-test", provider });
    const batchGraph: EtherGraph = {
      ...graph(),
      nodes: [
        {
          id: "batch", definitionId: "flow.batch", title: "Batch", position: { x: 0, y: 0 }, size: { width: 240, height: 180 },
          config: { kind: "flow.batch", dimensions: [{ id: "variant", name: "Variant", values: ["a", "b", "c"] }], parallelism: 4 },
          presentation: { collapsed: false, accent: "default", previewMode: "summary" }
        },
        {
          id: "image", definitionId: "generation.image", title: "Image", position: { x: 320, y: 0 }, size: { width: 240, height: 180 },
          config: { kind: "generation.image", providerId: CODEX_PROVIDER_ID, profileId: "image-default", aspectRatio: "1:1", resolution: { width: 32, height: 32 }, outputCount: 1 },
          presentation: { collapsed: false, accent: "default", previewMode: "summary" }
        }
      ],
      edges: [{
        id: "batch-image", from: { kind: "node", nodeId: "batch", channel: "data" }, to: { kind: "node", nodeId: "image", channel: "data" },
        role: "general", order: 0, selector: { kind: "latest" }, adapter: { kind: "auto" }, enabled: true
      }]
    };
    await app.createDocument({ path: path.join(root, "parallelism.ether"), title: "Parallelism", initialGraph: batchGraph });
    const plan = await app.previewRun({ commandId: "preview-parallelism", graphId: "root", scope: { kind: "node", nodeId: "image" } });
    expect(plan.effectiveParallelism).toBe(3);
    expect(plan.requestedParallelism).toBe(4);
    await app.closeDocument();
  });

  it("dispatches an idempotent durable workflow with output lineage, review, collection routing, events, and job inspection", async () => {
    const root = await temporaryRoot();
    const referencePath = path.join(root, "reference.txt");
    const liveOutputPath = path.join(root, "live-output");
    await writeFile(referencePath, Buffer.from("reference bytes"));
    await mkdir(liveOutputPath);
    let interruptExportAfterMain = false;
    const app = new EtherApplication({
      appDataRoot: root,
      appVersion: "4.0.0-test",
      provider: new FakeImageProvider(),
      exportCheckpoint: (stage, destination) => {
        if (
          interruptExportAfterMain &&
          stage === "after-output" &&
          !destination.endsWith(".json")
        ) {
          interruptExportAfterMain = false;
          throw new Error("injected crash after durable main publication");
        }
      },
      pathGrantResolver: {
        resolve: ({ pathGrantId }) => pathGrantId === "reference-grant"
          ? { kind: "file", path: referencePath, mediaType: "text/plain" }
          : { kind: "directory", path: liveOutputPath }
      }
    });
    const events: Array<{ name: string; payload: unknown }> = [];
    app.subscribe((event) => events.push({ name: event.name, payload: event.payload }));
    await app.createDocument({ path: path.join(root, "Contract.ether"), title: "Contract", initialGraph: graph() });
    const initial = await app.queryDocument();
    await app.applyGraphTransaction({ commandId: "graph", transaction: transaction(initial.documentRevisionId, initial.graphRevisions.root!) });

    const editPermit = await app.execute({ kind: "command", id: "edit-permit", correlationId: "c-edit-permit", documentId: initial.documentId, name: "permission.grantEdit", payload: {} });
    if (editPermit.kind === "error") throw new Error(JSON.stringify(editPermit.error));
    expect(editPermit).toMatchObject({ kind: "response", name: "permission.grantEdit", payload: { permission: "edit" } });
    await app.execute({ kind: "command", id: "reference-permit", correlationId: "c-reference-permit", documentId: initial.documentId, name: "permission.grantPath", payload: { pathGrantId: "reference-grant", purpose: "reference" } });
    const linked = await app.execute({ kind: "command", id: "link-reference", correlationId: "c-link-reference", documentId: initial.documentId, name: "reference.link", payload: { graphId: "root", nodeId: "references", pathGrantId: "reference-grant", role: "subject" } });
    if (linked.kind !== "response" || linked.name !== "reference.link") throw new Error(`Reference did not link: ${JSON.stringify(linked)}`);
    expect(events).toContainEqual({
      name: "reference.setMembershipChanged",
      payload: {
        nodeId: "references",
        members: [{
          kind: "linked-reference",
          referenceId: linked.payload.referenceId,
          enabled: true,
          roleOverride: "subject"
        }],
        mode: "assign"
      }
    });
    await app.execute({
      kind: "command",
      id: "assign-reference",
      correlationId: "c-assign-reference",
      documentId: initial.documentId,
      name: "reference.assignToSet",
      payload: {
        nodeId: "references",
        members: [{
          kind: "linked-reference",
          referenceId: linked.payload.referenceId,
          enabled: false,
          roleOverride: "style"
        }],
        replace: true
      }
    });
    expect(await app.boundaryStore().read(({ references }) => references.referenceSetMembers("references")))
      .toEqual([{
        kind: "linked-reference",
        referenceId: linked.payload.referenceId,
        enabled: false,
        roleOverride: "style"
      }]);
    expect(events).toContainEqual({
      name: "reference.setMembershipChanged",
      payload: {
        nodeId: "references",
        members: [{
          kind: "linked-reference",
          referenceId: linked.payload.referenceId,
          enabled: false,
          roleOverride: "style"
        }],
        mode: "replace"
      }
    });
    expect(ApplicationCommandSchema.safeParse({
      kind: "command", id: "legacy-ids", correlationId: "legacy-ids", documentId: initial.documentId,
      name: "reference.assignToSet", payload: { nodeId: "references", members: [linked.payload.referenceId] }
    }).success).toBe(false);

    const preview = await app.execute({ kind: "command", id: "preview", correlationId: "c-preview", documentId: initial.documentId, name: "run.preview", payload: { graphId: "root", scope: { kind: "node", nodeId: "image" } } });
    expect(preview.kind).toBe("response");
    if (preview.kind !== "response" || preview.name !== "run.preview") throw new Error("Preview did not return a plan.");
    const permit = await app.execute({ kind: "command", id: "permit", correlationId: "c-permit", documentId: initial.documentId, name: "permission.grantRun", payload: { planId: preview.payload.plan.id, contentHash: preview.payload.plan.contentHash } });
    if (permit.kind !== "response" || permit.name !== "permission.grantRun") throw new Error("Permit did not return.");
    const started = await app.execute({ kind: "command", id: "start", correlationId: "c-start", documentId: initial.documentId, name: "run.start", payload: { planId: preview.payload.plan.id, contentHash: preview.payload.plan.contentHash, runPermitId: permit.payload.permitId } });
    if (started.kind !== "response" || started.name !== "run.start") throw new Error("Run did not start.");
    await app.waitForJob(started.payload.job.id);

    const artifacts = await app.query({ kind: "query", id: "artifacts", correlationId: "c-artifacts", documentId: initial.documentId, name: "artifact.search", payload: { text: "", channels: [], collectionIds: [], tags: [], minimumRating: null, providerId: null, modelId: null, runId: null, graphId: null, createdAfter: null, createdBefore: null } });
    if (artifacts.kind !== "response" || artifacts.name !== "artifact.search") throw new Error("Artifacts did not return.");
    expect(artifacts.payload).toMatchObject({ total: expect.any(Number), nextCursor: null });
    const artifact = artifacts.payload.artifacts[0]!;
    const boundaryDetail = await app.query({
      kind: "query", id: "artifact-detail", correlationId: "c-artifact-detail", documentId: initial.documentId,
      name: "artifact.detail", payload: { artifactId: artifact.id }
    });
    if (boundaryDetail.kind !== "response" || boundaryDetail.name !== "artifact.detail") throw new Error("Artifact detail did not return.");
    expect(boundaryDetail.payload).toMatchObject({
      artifact: { id: artifact.id },
      outputVersion: { id: artifact.source.outputVersionId },
      sourcePayload: { id: artifact.source.payloadId },
      collections: [], tags: [], ratings: [], lineage: []
    });

    await app.execute({
      kind: "command",
      id: "assign-embedded-reference",
      correlationId: "c-assign-embedded-reference",
      documentId: initial.documentId,
      name: "reference.assignToSet",
      payload: {
        nodeId: "references",
        members: [{
          kind: "embedded-artifact",
          artifactId: artifact.id,
          enabled: false,
          roleOverride: "style"
        }],
        replace: true
      }
    });
    expect(events).toContainEqual({
      name: "reference.setMembershipChanged",
      payload: {
        nodeId: "references",
        members: [{
          kind: "embedded-artifact",
          artifactId: artifact.id,
          enabled: false,
          roleOverride: "style"
        }],
        mode: "replace"
      }
    });

    const current = await app.queryDocument();
    const pinned = await app.execute({ kind: "command", id: "pin", correlationId: "c-pin", documentId: initial.documentId, name: "output.pin", payload: { edgeId: "image-compare", outputVersionId: artifact.source.outputVersionId, baseDocumentRevisionId: current.documentRevisionId } });
    expect(pinned).toMatchObject({ kind: "response", name: "output.pin", payload: { kind: "revision" } });
    await app.execute({ kind: "command", id: "rate", correlationId: "c-rate", documentId: initial.documentId, name: "review.rate", payload: { artifactId: artifact.id, rating: 5 } });
    const tagCommand = { kind: "command" as const, id: "tag", correlationId: "c-tag", documentId: initial.documentId, name: "review.tag" as const, payload: { artifactId: artifact.id, tags: ["launch", "select"] } };
    const firstTag = await app.execute(tagCommand);
    const duplicateTag = await app.execute(tagCommand);
    expect(duplicateTag).toMatchObject({ kind: "response", name: "review.tag", payload: firstTag.kind === "response" ? firstTag.payload : {} });
    const detail = await app.boundaryStore().read(({ artifacts: repository }) => repository.detail(artifact.id));
    expect(detail).toMatchObject({ tags: ["launch", "select"], ratings: [expect.objectContaining({ score: 5 })] });

    await app.grantPathPermit("export-permit", "export-grant", "export");
    interruptExportAfterMain = true;
    const exportInput = {
      artifactIds: [artifact.id],
      collisionPolicy: "error" as const,
      commandId: "durable-bundle-export",
      namingTemplate: "durable-bundle",
      pathGrantId: "export-grant",
      includeLineageReport: true,
      includeMetadataSidecar: true
    };
    await expect(app.exportArtifacts(exportInput)).rejects.toThrow(
      "injected crash after durable main publication"
    );
    const interruptedExport = await app.boundaryStore().read(({ exports }) => exports.list()[0]!);
    expect(interruptedExport.status).toBe("staged");
    const mainExportPath = path.join(liveOutputPath, interruptedExport.relativePath);
    expect((await readFile(mainExportPath)).byteLength).toBe(artifact.byteLength);
    expect(await readdir(liveOutputPath)).toEqual([path.basename(mainExportPath)]);
    expect(await readdir(path.join(root, "export-materializations"))).toHaveLength(1);

    const retried = await app.retryExport("retry-durable-bundle", interruptedExport.id);
    expect(retried[0]?.status).toBe("committed");
    const metadataPath = `${mainExportPath}.metadata.json`;
    const lineagePath = `${mainExportPath}.lineage.json`;
    expect(JSON.parse(await readFile(metadataPath, "utf8"))).toMatchObject({
      artifact: { id: artifact.id }
    });
    expect(JSON.parse(await readFile(lineagePath, "utf8"))).toMatchObject({
      artifactId: artifact.id
    });
    expect(await readdir(path.join(root, "export-materializations"))).toEqual([]);

    await unlink(metadataPath);
    const duplicateBundle = await app.exportArtifacts(exportInput);
    expect(duplicateBundle[0]?.status).toBe("committed");
    expect(JSON.parse(await readFile(metadataPath, "utf8"))).toMatchObject({
      artifact: { id: artifact.id }
    });

    await app.execute({ kind: "command", id: "live-permit", correlationId: "c-live-permit", documentId: initial.documentId, name: "permission.grantPath", payload: { pathGrantId: "live-grant", purpose: "live-output" } });
    const enabled = await app.execute({ kind: "command", id: "live-enable", correlationId: "c-live-enable", documentId: initial.documentId, name: "liveOutput.enable", payload: { pathGrantId: "live-grant", namingPolicy: "artifact", collisionPolicy: "rename", transferPolicy: "copy" } });
    expect(enabled).toMatchObject({ kind: "response", name: "liveOutput.enable", payload: { enabled: true } });
    const entries = await app.query({ kind: "query", id: "live-entries", correlationId: "c-live-entries", documentId: initial.documentId, name: "liveOutput.entries", payload: {} });
    expect(entries).toMatchObject({ kind: "response", name: "liveOutput.entries", payload: { entries: [expect.objectContaining({ artifactId: artifact.id, state: "committed" })] } });
    await app.execute({ kind: "command", id: "live-disable", correlationId: "c-live-disable", documentId: initial.documentId, name: "liveOutput.disable", payload: {} });
    const liveStatus = await app.query({ kind: "query", id: "live-status", correlationId: "c-live-status", documentId: initial.documentId, name: "liveOutput.status", payload: {} });
    expect(liveStatus).toMatchObject({ kind: "response", name: "liveOutput.status", payload: { settings: { enabled: false } } });

    const collection = await app.execute({ kind: "command", id: "collection", correlationId: "c-collection", documentId: initial.documentId, name: "collection.create", payload: { title: "Selects", primary: true } });
    if (collection.kind !== "response" || collection.name !== "collection.create") throw new Error("Collection did not return.");
    await app.execute({ kind: "command", id: "route", correlationId: "c-route", documentId: initial.documentId, name: "review.route", payload: { artifactId: artifact.id, collectionId: collection.payload.collection.id, role: "subject" } });
    const editCommand = { kind: "command" as const, id: "edit", correlationId: "c-edit", documentId: initial.documentId, name: "output.edit" as const, payload: { outputVersionId: artifact.source.outputVersionId, payload: { title: "Retouched" } } };
    const firstEdit = await app.execute(editCommand);
    const duplicateEdit = await app.execute(editCommand);
    if (firstEdit.kind !== "response" || firstEdit.name !== "output.edit") throw new Error("Edit did not return.");
    expect(duplicateEdit).toMatchObject({ kind: "response", name: "output.edit", payload: firstEdit.payload });
    expect(firstEdit.payload.outputVersion.parentOutputVersionId).toBe(artifact.source.outputVersionId);
    await app.execute({ kind: "command", id: "approve", correlationId: "c-approve", documentId: initial.documentId, name: "review.approve", payload: { outputVersionId: firstEdit.payload.outputVersion.id, approved: true } });

    const memberships = await app.query({ kind: "query", id: "membership", correlationId: "c-membership", documentId: initial.documentId, name: "collection.membership", payload: { collectionId: collection.payload.collection.id } });
    expect(memberships).toMatchObject({ kind: "response", name: "collection.membership", payload: { memberships: [expect.objectContaining({ artifactId: artifact.id })] } });
    const job = await app.query({ kind: "query", id: "job", correlationId: "c-job", documentId: initial.documentId, name: "job.summary", payload: { jobId: started.payload.job.id } });
    expect(job).toMatchObject({ kind: "response", name: "job.summary", payload: { job: { status: "completed" } } });
    expect(events.map((event) => event.name)).toEqual(expect.arrayContaining([
      "collection.changed",
      "output.created",
      "output.reviewed",
      "reference.changed"
    ]));
    await app.closeDocument();
  }, 120_000);

  it("previews and runs Worker, evaluation, and local-only graphs with per-step provider routing", async () => {
    const root = await temporaryRoot();
    const routed: Array<{ modelId: string; providerId: string }> = [];
    const workerCapability: ProviderCapability = {
      providerId: "worker-provider", profileId: "worker-default", operation: "llm",
      inputChannels: ["text", "image", "data"], outputChannels: ["text", "data"],
      aspectRatios: [], resolutions: [], maxReferences: 8, maxOutputsPerCall: 1,
      modelId: "gpt-5", reasoningEfforts: ["medium"],
      supportsCancellation: true, supportsSeed: false, provenance: "runtime-discovered", limitations: []
    };
    const evaluationCapability: ProviderCapability = {
      providerId: "evaluation-provider", profileId: "evaluation-default", operation: "evaluate",
      inputChannels: ["text", "image", "data"], outputChannels: ["data"],
      aspectRatios: [], resolutions: [], maxReferences: 8, maxOutputsPerCall: 1,
      modelId: "gpt-5", reasoningEfforts: ["medium"],
      supportsCancellation: true, supportsSeed: false, provenance: "runtime-discovered", limitations: []
    };
    const app = new EtherApplication({
      appDataRoot: root,
      appVersion: "4.0.0-test",
      provider: new FakeImageProvider(),
      providerCapabilities: [workerCapability, evaluationCapability],
      providerResolver: ({ binding }) => {
        if (binding != null) routed.push({ modelId: binding.modelId, providerId: binding.providerId });
        if (binding?.providerId === "worker-provider") {
          return {
            worker: { run: async () => ({ providerId: "worker-provider", providerName: "Worker", capabilities: ["assistant.text"], text: "Rewritten launch prompt" }) }
          } satisfies ExecutionProviderFacets;
        }
        if (binding?.providerId === "evaluation-provider") {
          return {
            evaluation: { evaluate: async () => ({ providerId: "evaluation-provider", providerName: "Evaluator", capabilities: ["evaluation.vision"], items: [], summary: "No inputs to score" }) }
          } satisfies ExecutionProviderFacets;
        }
        return {};
      }
    });
    const scenarios: Array<{ id: string; graph: EtherGraph }> = [
      {
        id: "worker",
        graph: oneNodeGraph("worker", "prompt.worker", {
          kind: "prompt.worker", behavior: "rewrite", instruction: "Rewrite precisely.", profile: "balanced", model: "gpt-5",
          reasoningEffort: "medium", variation: 0.1, contextPolicy: { includeUpstream: true, includeDownstreamCapabilities: true, maxTokens: 2000 },
          memoryPolicy: { mode: "stateless" }, outputContract: { channel: "text", count: 1, selectionPolicy: "latest" }
        })
      },
      {
        id: "evaluate",
        graph: oneNodeGraph("evaluate", "review.evaluate", {
          kind: "review.evaluate", instruction: "Score the available subject.", rubric: [], profile: "balanced", model: "gpt-5", reasoningEffort: "medium"
        })
      },
      {
        id: "filter",
        graph: oneNodeGraph("filter", "review.filter", { kind: "review.filter", match: "all", rules: [], routes: [] })
      }
    ];

    for (const scenario of scenarios) {
      await app.createDocument({ path: path.join(root, `${scenario.id}.ether`), title: scenario.id, initialGraph: scenario.graph });
      const document = await app.queryDocument();
      const preview = await app.execute({ kind: "command", id: `preview-${scenario.id}`, correlationId: `c-preview-${scenario.id}`, documentId: document.documentId, name: "run.preview", payload: { graphId: scenario.graph.id, scope: { kind: "graph" } } });
      if (preview.kind !== "response" || preview.name !== "run.preview") throw new Error(`Preview failed for ${scenario.id}: ${JSON.stringify(preview)}`);
      const permit = await app.execute({ kind: "command", id: `permit-${scenario.id}`, correlationId: `c-permit-${scenario.id}`, documentId: document.documentId, name: "permission.grantRun", payload: { planId: preview.payload.plan.id, contentHash: preview.payload.plan.contentHash } });
      if (permit.kind !== "response" || permit.name !== "permission.grantRun") throw new Error(`Permit failed for ${scenario.id}.`);
      const started = await app.execute({ kind: "command", id: `start-${scenario.id}`, correlationId: `c-start-${scenario.id}`, documentId: document.documentId, name: "run.start", payload: { planId: preview.payload.plan.id, contentHash: preview.payload.plan.contentHash, runPermitId: permit.payload.permitId } });
      if (started.kind !== "response" || started.name !== "run.start") throw new Error(`Run failed for ${scenario.id}: ${JSON.stringify(started)}`);
      expect((await app.waitForJob(started.payload.job.id)).status).toBe("completed");
      await app.closeDocument();
    }

    expect(routed).toEqual(expect.arrayContaining([
      { providerId: "worker-provider", modelId: "gpt-5" },
      { providerId: "evaluation-provider", modelId: "gpt-5" }
    ]));
  });

  it("runs an immutable Prompt → Worker → Worker → Image plan with runtime Worker contracts", async () => {
    const root = await temporaryRoot();
    const workerCalls: Array<Record<string, unknown>> = [];
    const image = new FakeImageProvider();
    const workerCapability: ProviderCapability = {
      providerId: "fake-worker", profileId: "worker:fake-v1", modelId: "fake-v1", reasoningEfforts: ["medium"],
      operation: "llm", inputChannels: ["text", "image", "data"], outputChannels: ["text", "data"],
      aspectRatios: [], resolutions: [], maxReferences: 4, maxOutputsPerCall: 1, maxParallelism: 1,
      supportsCancellation: true, supportsSeed: false, provenance: "runtime-discovered", limitations: ["fake worker"]
    };
    const imageCapability: ProviderCapability = {
      providerId: "ether-fake-local", profileId: "fake-image-default", operation: "generate-image",
      inputChannels: ["text", "image", "data"], outputChannels: ["image"], aspectRatios: ["1:1"],
      resolutions: [{ id: "32", width: 32, height: 32, label: "32 x 32" }], maxReferences: 4, maxOutputsPerCall: 1,
      supportsCancellation: true, supportsSeed: false, provenance: "runtime-discovered", limitations: []
    };
    const workerConfig = (instruction: string, reviewPolicy: "inspect-first" | "auto-apply" = "auto-apply") => ({
      kind: "prompt.worker" as const, behavior: "rewrite" as const, instruction, profile: "balanced" as const,
      providerId: "fake-worker", profileId: "worker:fake-v1", model: "fake-v1", reasoningEffort: "medium",
      variation: 0.1, reviewPolicy,
      contextPolicy: { includeUpstream: true, includeDownstreamCapabilities: true, maxTokens: 2_000 },
      memoryPolicy: { mode: "per-branch" as const }, outputContract: { channel: "text" as const, count: 1, selectionPolicy: "latest" as const }
    });
    const serial = EtherGraphSchema.parse({
      ...graph(), id: "serial-worker-graph",
      nodes: [
        { id: "prompt", definitionId: "prompt.text", title: "Brief", position: { x: 0, y: 0 }, size: { width: 240, height: 180 }, config: { kind: "prompt.text", body: "A cobalt bottle in a calm studio.", assembly: "append" }, presentation: { collapsed: false, accent: "default", previewMode: "content" } },
        { id: "worker-a", definitionId: "prompt.worker", title: "First rewrite", position: { x: 300, y: 0 }, size: { width: 240, height: 180 }, config: workerConfig("Clarify the product direction."), presentation: { collapsed: false, accent: "default", previewMode: "content" } },
        { id: "worker-b", definitionId: "prompt.worker", title: "Second rewrite", position: { x: 600, y: 0 }, size: { width: 240, height: 180 }, config: workerConfig("Make the direction image-ready."), presentation: { collapsed: false, accent: "default", previewMode: "content" } },
        { id: "image", definitionId: "generation.image", title: "Image", position: { x: 900, y: 0 }, size: { width: 240, height: 180 }, config: { kind: "generation.image", providerId: "ether-fake-local", profileId: "fake-image-default", aspectRatio: "1:1", resolution: { width: 32, height: 32 }, outputCount: 1 }, presentation: { collapsed: false, accent: "default", previewMode: "summary" } }
      ],
      edges: [
        { id: "prompt-a", from: { kind: "node", nodeId: "prompt", channel: "text" }, to: { kind: "node", nodeId: "worker-a", channel: "text" }, role: "subject", order: 0, selector: { kind: "latest-approved" }, adapter: { kind: "auto" }, enabled: true },
        { id: "a-b", from: { kind: "node", nodeId: "worker-a", channel: "text" }, to: { kind: "node", nodeId: "worker-b", channel: "text" }, role: "subject", order: 0, selector: { kind: "latest-approved" }, adapter: { kind: "auto" }, enabled: true },
        { id: "b-image", from: { kind: "node", nodeId: "worker-b", channel: "text" }, to: { kind: "node", nodeId: "image", channel: "text" }, role: "subject", order: 0, selector: { kind: "latest-approved" }, adapter: { kind: "auto" }, enabled: true }
      ]
    });
    const app = new EtherApplication({
      appDataRoot: root, appVersion: "4.0.0-test", provider: image,
      providerCapabilities: [workerCapability, imageCapability],
      providerResolver: () => ({
        image,
        worker: { run: async (input) => {
          workerCalls.push(input as unknown as Record<string, unknown>);
          const text = input.assistantNodeId === "worker-a"
            ? "A cobalt bottle on a quiet plinth."
            : "A cobalt bottle on a quiet plinth, soft daylight, editorial product photography.";
          return { providerId: "fake-worker", providerName: "Fake Worker", capabilities: ["assistant.text"], text };
        } }
      })
    });
    await app.createDocument({ path: path.join(root, "serial-worker.ether"), title: "Serial Worker", initialGraph: serial });
    const document = await app.queryDocument();
    const preview = await app.execute({ kind: "command", id: "serial-preview", correlationId: "serial-preview", documentId: document.documentId, name: "run.preview", payload: { graphId: serial.id, scope: { kind: "graph" } } });
    if (preview.kind !== "response" || preview.name !== "run.preview") throw new Error(JSON.stringify(preview));
    const workerStep = preview.payload.plan.steps.find((step) => step.nodeId === "worker-a")!;
    expect(workerStep.compiledContext).toMatchObject({ worker: { request: { model: "fake-v1", reasoningEffort: "medium", outputContract: { channel: "text" } }, memoryScopeKey: expect.stringMatching(/^memory:v1:branch:/) } });
    const workerItem = preview.payload.plan.workItems.find((item) => workerStep.workItemIds.includes(item.id))!;
    const mediaPayload: PayloadEnvelope = {
      id: "vision-payload", channel: "image", role: "subject",
      content: { kind: "artifact", artifactId: "vision-artifact" },
      source: { nodeId: "reference", outputVersionId: "vision-output", lineageKey: "vision-lineage" },
      metadata: { assetPath: path.join(root, "vision-input.png"), mediaType: "image/png" }
    };
    let deliveredMedia: unknown;
    await new ExecutorRegistry().execute({
      claim: {
        plan: preview.payload.plan,
        job: { id: "media-job", status: "running" },
        workItem: { id: "media-work", plannedWorkItemId: workerItem.id, status: "running" },
        attempt: { id: "media-attempt", ordinal: 1, status: "running", startedAt: timestamp, createdAt: timestamp },
        providerAttemptId: "media-provider-attempt"
      },
      step: workerStep,
      plannedWorkItem: workerItem,
      inputs: [mediaPayload],
      providerInputs: [],
      signal: new AbortController().signal,
      stagingDirectory: root,
      providers: {
        worker: {
          run: async (input) => {
            deliveredMedia = input.inputs;
            return { providerId: "fake-worker", providerName: "Fake Worker", capabilities: ["assistant.text"], text: "A cobalt bottle in a studio." };
          }
        }
      }
    });
    expect(deliveredMedia).toEqual([expect.objectContaining({
      channel: "image", assetId: "vision-artifact", assetPath: path.join(root, "vision-input.png"), mimeType: "image/png"
    })]);
    const permit = await app.execute({ kind: "command", id: "serial-permit", correlationId: "serial-permit", documentId: document.documentId, name: "permission.grantRun", payload: { planId: preview.payload.plan.id, contentHash: preview.payload.plan.contentHash } });
    if (permit.kind !== "response" || permit.name !== "permission.grantRun") throw new Error(JSON.stringify(permit));
    const started = await app.execute({ kind: "command", id: "serial-start", correlationId: "serial-start", documentId: document.documentId, name: "run.start", payload: { planId: preview.payload.plan.id, contentHash: preview.payload.plan.contentHash, runPermitId: permit.payload.permitId } });
    if (started.kind !== "response" || started.name !== "run.start") throw new Error(JSON.stringify(started));
    expect((await app.waitForJob(started.payload.job.id)).status).toBe("completed");
    expect(workerCalls).toHaveLength(2);
    expect(workerCalls[0]).toMatchObject({ contextPolicy: { includeUpstream: true }, downstream: { providerProfileIds: ["worker:fake-v1"] }, reviewPolicy: "auto-apply" });
    expect(workerCalls[1]?.prompt).toContain("A cobalt bottle on a quiet plinth.");
    const first = await app.queryNodeOutputs("worker-a");
    const second = await app.queryNodeOutputs("worker-b");
    const imageOutputs = await app.queryNodeOutputs("image");
    expect(first[0]).toMatchObject({ approval: { state: "approved", actor: "system" } });
    expect(second[0]).toMatchObject({ approval: { state: "approved", actor: "system" } });
    expect(second[0]?.inputPayloadIds).toEqual(expect.arrayContaining(first[0]!.outputPayloadIds));
    expect(imageOutputs[0]?.inputPayloadIds).toEqual(expect.arrayContaining(second[0]!.outputPayloadIds));
    expect((await app.queryGraph(serial.id)).nodes.find((node) => node.id === "worker-b")?.config).toMatchObject({ instruction: "Make the direction image-ready." });

    const current = await app.queryDocument();
    const currentGraph = await app.queryGraph(serial.id);
    const currentWorkerB = currentGraph.nodes.find((node) => node.id === "worker-b")!;
    await app.applyGraphTransaction({
      commandId: "switch-worker-b-to-inspect-first",
      transaction: {
        id: "switch-worker-b-to-inspect-first",
        baseDocumentRevisionId: current.documentRevisionId,
        baseGraphRevisions: { [serial.id]: current.graphRevisions[serial.id]! },
        title: "Inspect second worker output",
        actor: "user",
        layoutPolicy: "preserve",
        operations: [{
          type: "updateNode",
          graphId: serial.id,
          nodeId: "worker-b",
          node: {
            ...currentWorkerB,
            config: currentWorkerB.config.kind === "prompt.worker"
              ? { ...currentWorkerB.config, reviewPolicy: "inspect-first" }
              : currentWorkerB.config
          } as EtherGraph["nodes"][number]
        }]
      }
    });
    const inspectPreview = await app.execute({ kind: "command", id: "inspect-preview", correlationId: "inspect-preview", documentId: document.documentId, name: "run.preview", payload: { graphId: serial.id, scope: { kind: "node", nodeId: "worker-b" } } });
    if (inspectPreview.kind !== "response" || inspectPreview.name !== "run.preview") throw new Error(JSON.stringify(inspectPreview));
    const inspectPermit = await app.execute({ kind: "command", id: "inspect-permit", correlationId: "inspect-permit", documentId: document.documentId, name: "permission.grantRun", payload: { planId: inspectPreview.payload.plan.id, contentHash: inspectPreview.payload.plan.contentHash } });
    if (inspectPermit.kind !== "response" || inspectPermit.name !== "permission.grantRun") throw new Error(JSON.stringify(inspectPermit));
    const inspectStart = await app.execute({ kind: "command", id: "inspect-start", correlationId: "inspect-start", documentId: document.documentId, name: "run.start", payload: { planId: inspectPreview.payload.plan.id, contentHash: inspectPreview.payload.plan.contentHash, runPermitId: inspectPermit.payload.permitId } });
    if (inspectStart.kind !== "response" || inspectStart.name !== "run.start") throw new Error(JSON.stringify(inspectStart));
    expect((await app.waitForJob(inspectStart.payload.job.id)).status).toBe("completed");
    const inspected = (await app.queryNodeOutputs("worker-b")).find((output) => output.runId === inspectStart.payload.job.id);
    expect(inspected).toMatchObject({ approval: { state: "unreviewed" } });
    await app.closeDocument();
  });

  it("seals enabled Reference Set material for a downstream Worker", async () => {
    const root = await temporaryRoot();
    const sources = new Map<string, string>();
    const workerCalls: Array<{
      inputs?: Array<Record<string, unknown>>;
      stagedAssets: Array<{ referenceId: string | null; referenceArtifactId: string | null; sha256: string }>;
    }> = [];
    const image = new FakeImageProvider();
    const workerCapability: ProviderCapability = {
      providerId: "reference-worker", profileId: "reference-worker-v1", modelId: "reference-worker-v1", reasoningEfforts: ["medium"],
      operation: "llm", inputChannels: ["image", "text", "data"], outputChannels: ["text", "data"],
      aspectRatios: [], resolutions: [], maxReferences: 4, maxOutputsPerCall: 1, maxParallelism: 1,
      supportsCancellation: true, supportsSeed: false, provenance: "runtime-discovered", limitations: []
    };
    const imageCapability: ProviderCapability = {
      providerId: "ether-fake-local", profileId: "fake-image-default", operation: "generate-image",
      inputChannels: ["text", "image", "data"], outputChannels: ["image"], aspectRatios: ["1:1"],
      resolutions: [{ id: "32", width: 32, height: 32, label: "32 x 32" }], maxReferences: 4, maxOutputsPerCall: 1,
      supportsCancellation: true, supportsSeed: false, provenance: "runtime-discovered", limitations: []
    };
    const workerConfig = {
      kind: "prompt.worker" as const, behavior: "rewrite" as const, instruction: "Use the staged reference images.", profile: "balanced" as const,
      providerId: "reference-worker", profileId: "reference-worker-v1", model: "reference-worker-v1", reasoningEffort: "medium",
      variation: 0.1, reviewPolicy: "auto-apply" as const,
      contextPolicy: { includeUpstream: true, includeDownstreamCapabilities: true, maxTokens: 2_000 },
      memoryPolicy: { mode: "stateless" as const }, outputContract: { channel: "text" as const, count: 1, selectionPolicy: "latest" as const }
    };
    const referenceGraph = EtherGraphSchema.parse({
      ...graph(), id: "reference-material-graph",
      nodes: [
        { id: "seed", definitionId: "generation.image", title: "Seed", position: { x: 0, y: 0 }, size: { width: 220, height: 160 }, config: { kind: "generation.image", providerId: "ether-fake-local", profileId: "fake-image-default", aspectRatio: "1:1", resolution: { width: 32, height: 32 }, outputCount: 1 }, presentation: { collapsed: false, accent: "default", previewMode: "summary" } },
        { id: "refs", definitionId: "reference.set", title: "References", position: { x: 0, y: 240 }, size: { width: 220, height: 160 }, config: { kind: "reference.set", members: [], enabledChannels: ["image"], ordering: "manual" }, presentation: { collapsed: false, accent: "default", previewMode: "summary" } },
        { id: "worker", definitionId: "prompt.worker", title: "Reference worker", position: { x: 320, y: 120 }, size: { width: 220, height: 160 }, config: workerConfig, presentation: { collapsed: false, accent: "default", previewMode: "content" } }
      ],
      edges: [{ id: "refs-worker", from: { kind: "node", nodeId: "refs", channel: "image" }, to: { kind: "node", nodeId: "worker", channel: "image" }, role: "subject", order: 0, selector: { kind: "latest" }, adapter: { kind: "auto" }, enabled: true }]
    });
    const app = new EtherApplication({
      appDataRoot: root,
      appVersion: "4.0.0-test",
      provider: image,
      providerCapabilities: [workerCapability, imageCapability],
      pathGrantResolver: {
        resolve: ({ pathGrantId }) => ({ kind: "file", path: sources.get(pathGrantId)!, mediaType: "image/png" })
      },
      providerResolver: () => ({
        image,
        worker: {
          run: async (input) => {
            const inputs = input.inputs as Array<Record<string, unknown>>;
            const stagedAssets = await Promise.all(inputs.map(async (reference) => {
              if (typeof reference.assetPath !== "string") {
                throw new Error("Reference worker input did not contain a staged top-level asset.");
              }
              const metadata = reference.metadata as Record<string, unknown>;
              return {
                referenceId: typeof metadata.referenceId === "string" ? metadata.referenceId : null,
                referenceArtifactId: typeof metadata.referenceArtifactId === "string" ? metadata.referenceArtifactId : null,
                sha256: createHash("sha256").update(await readFile(reference.assetPath)).digest("hex")
              };
            }));
            workerCalls.push({ inputs, stagedAssets });
            return { providerId: "reference-worker", providerName: "Reference Worker", capabilities: ["assistant.text"], text: "A staged reference-aware image prompt." };
          }
        }
      })
    });
    try {
      await app.createDocument({ path: path.join(root, "reference-material.ether"), title: "Reference material", initialGraph: referenceGraph });
      const run = async (commandId: string, scope: { kind: "node"; nodeId: string }) => {
        const plan = await app.previewRun({ commandId: `${commandId}-preview`, graphId: referenceGraph.id, scope });
        const permit = await app.grantRunPermit({ commandId: `${commandId}-permit`, planId: plan.id, contentHash: plan.contentHash });
        const job = await app.startRun({ commandId: `${commandId}-start`, planId: plan.id, contentHash: plan.contentHash, runPermitId: permit.id });
        return { plan, job: await app.waitForJob(job.id) };
      };
      await run("seed", { kind: "node", nodeId: "seed" });
      const seedOutput = (await app.queryNodeOutputs("seed"))[0]!;
      const seedArtifactId = await app.boundaryStore().read(({ outputs }) => {
        const payload = outputs.getPayload(seedOutput.outputPayloadIds[0]!);
        if (payload?.content.kind !== "artifact") throw new Error("Seed image did not publish an artifact payload.");
        return payload.content.artifactId;
      });
      const seedBytes = await app.readArtifactBytes(seedArtifactId);
      const livePath = path.join(root, "live-reference.png");
      const embeddedPath = path.join(root, "embedded-reference.png");
      const disabledPath = path.join(root, "disabled-reference.png");
      await Promise.all([writeFile(livePath, seedBytes), writeFile(embeddedPath, seedBytes), writeFile(disabledPath, seedBytes)]);
      sources.set("live-grant", livePath);
      sources.set("embedded-grant", embeddedPath);
      sources.set("disabled-grant", disabledPath);
      await app.grantPathPermit("live-grant-permit", "live-grant", "reference");
      await app.grantPathPermit("embedded-grant-permit", "embedded-grant", "reference");
      await app.grantPathPermit("disabled-grant-permit", "disabled-grant", "reference");
      const live = await app.linkDocumentReference({ graphId: referenceGraph.id, nodeId: "refs", pathGrantId: "live-grant", role: "style" });
      const embedded = await app.linkDocumentReference({ graphId: referenceGraph.id, nodeId: "refs", pathGrantId: "embedded-grant", role: "subject" });
      const disabled = await app.linkDocumentReference({ graphId: referenceGraph.id, nodeId: "refs", pathGrantId: "disabled-grant", role: "face" });
      await app.embedAvailableReference(embedded.id);
      await app.assignReferenceSet("refs", [
        { kind: "linked-reference", referenceId: live.id, enabled: true, roleOverride: "style" },
        { kind: "linked-reference", referenceId: embedded.id, enabled: true, roleOverride: "subject" },
        { kind: "embedded-artifact", artifactId: seedArtifactId, enabled: true, roleOverride: "lighting" },
        { kind: "linked-reference", referenceId: disabled.id, enabled: false, roleOverride: "face" }
      ], true);
      const plan = await app.previewRun({ commandId: "references-preview", graphId: referenceGraph.id, scope: { kind: "node", nodeId: "worker" } });
      const workerStep = plan.steps.find((step) => step.nodeId === "worker")!;
      expect(workerStep.compiledContext.referenceInputs).toEqual(expect.arrayContaining([
        expect.objectContaining({ memberKind: "linked-reference", referenceId: live.id, role: "style", order: 0 }),
        expect.objectContaining({ memberKind: "embedded-reference", referenceId: embedded.id, role: "subject", order: 1 }),
        expect.objectContaining({ memberKind: "embedded-artifact", artifactId: seedArtifactId, role: "lighting", order: 2 })
      ]));
      const permit = await app.grantRunPermit({ commandId: "references-permit", planId: plan.id, contentHash: plan.contentHash });
      await app.assignReferenceSet("refs", [], true);
      const job = await app.startRun({ commandId: "references-start", planId: plan.id, contentHash: plan.contentHash, runPermitId: permit.id });
      expect((await app.waitForJob(job.id)).status).toBe("completed");
      expect(workerCalls).toHaveLength(1);
      expect(workerCalls[0]?.inputs).toEqual([
        expect.objectContaining({ channel: "image", role: "style", sourceNodeId: "refs", sourceEdgeId: "refs-worker", assetPath: expect.stringContaining("resolved-references"), metadata: expect.objectContaining({ referenceId: live.id }) }),
        expect.objectContaining({ channel: "image", role: "subject", sourceNodeId: "refs", sourceEdgeId: "refs-worker", assetPath: expect.stringContaining("resolved-references"), metadata: expect.objectContaining({ referenceId: embedded.id }) }),
        expect.objectContaining({ channel: "image", role: "lighting", assetId: seedArtifactId, sourceNodeId: "refs", sourceEdgeId: "refs-worker", assetPath: expect.stringContaining("resolved-references"), metadata: expect.objectContaining({ referenceArtifactId: seedArtifactId }) })
      ]);
      expect(workerCalls[0]?.inputs?.some((input) => (input.metadata as Record<string, unknown>).referenceId === disabled.id)).toBe(false);
      const seedSha256 = createHash("sha256").update(seedBytes).digest("hex");
      expect(workerCalls[0]?.stagedAssets).toEqual([
        { referenceId: live.id, referenceArtifactId: null, sha256: seedSha256 },
        { referenceId: embedded.id, referenceArtifactId: null, sha256: seedSha256 },
        { referenceId: null, referenceArtifactId: seedArtifactId, sha256: seedSha256 }
      ]);
      const workerOutput = (await app.queryNodeOutputs("worker")).find((output) => output.runId === job.id)!;
      expect(workerOutput.inputPayloadIds).toEqual((workerStep.compiledContext.referenceInputs as Array<{ payloadId: string }>).map((input) => input.payloadId));

      await app.assignReferenceSet("refs", [{ kind: "linked-reference", referenceId: live.id, enabled: true, roleOverride: "style" }], true);
      const changedPlan = await app.previewRun({ commandId: "changed-reference-preview", graphId: referenceGraph.id, scope: { kind: "node", nodeId: "worker" } });
      const changedPermit = await app.grantRunPermit({ commandId: "changed-reference-permit", planId: changedPlan.id, contentHash: changedPlan.contentHash });
      await writeFile(livePath, Buffer.concat([seedBytes, Buffer.from([0]) ]));
      const changedJob = await app.startRun({ commandId: "changed-reference-start", planId: changedPlan.id, contentHash: changedPlan.contentHash, runPermitId: changedPermit.id });
      expect((await app.waitForJob(changedJob.id)).status).toBe("failed");
      expect(workerCalls).toHaveLength(1);
    } finally {
      await app.closeDocument();
    }
  });
});
