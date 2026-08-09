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

function collectionGraph(): EtherGraph {
  const graph = blankGraph();
  graph.nodes.push({
    id: "collection",
    definitionId: "output.collection",
    title: "First selects",
    position: { x: 320, y: 0 },
    size: { width: 240, height: 180 },
    config: { kind: "output.collection", collectionId: "first-selects", membershipMode: "add", makePrimary: true },
    presentation: { collapsed: false, accent: "default", previewMode: "content" }
  });
  graph.edges.push({
    id: "node-collection",
    from: { kind: "node", nodeId: "node", channel: "data" },
    to: { kind: "node", nodeId: "collection", channel: "data" },
    role: "general",
    order: 0,
    selector: { kind: "latest" },
    adapter: { kind: "auto" },
    enabled: true
  });
  return graph;
}

function imageCompareCollectionGraph(): EtherGraph {
  const graph = blankGraph();
  graph.nodes = [
    {
      id: "prompt",
      definitionId: "prompt.text",
      title: "Prompt",
      position: { x: 0, y: 0 },
      size: { width: 240, height: 180 },
      config: { kind: "prompt.text", body: "Three candidate campaign images.", assembly: "append" },
      presentation: { collapsed: false, accent: "default", previewMode: "content" }
    },
    {
      id: "image",
      definitionId: "generation.image",
      title: "Image",
      position: { x: 320, y: 0 },
      size: { width: 240, height: 180 },
      config: { kind: "generation.image", providerId: "ether-fake-local", profileId: "fake-image-default", aspectRatio: "1:1", resolution: { width: 64, height: 64 }, outputCount: 3 },
      presentation: { collapsed: false, accent: "default", previewMode: "content" }
    },
    {
      id: "compare",
      definitionId: "review.compare",
      title: "Compare",
      position: { x: 640, y: 0 },
      size: { width: 240, height: 180 },
      config: { kind: "review.compare", selectionMode: "many", minimumSelections: 1 },
      presentation: { collapsed: false, accent: "default", previewMode: "content" }
    },
    {
      id: "collection",
      definitionId: "output.collection",
      title: "First selects",
      position: { x: 960, y: 0 },
      size: { width: 240, height: 180 },
      config: { kind: "output.collection", collectionId: "first-selects", membershipMode: "add", makePrimary: true },
      presentation: { collapsed: false, accent: "default", previewMode: "content" }
    }
  ];
  graph.edges = [
    {
      id: "prompt-image",
      from: { kind: "node", nodeId: "prompt", channel: "text" },
      to: { kind: "node", nodeId: "image", channel: "text" },
      role: "subject",
      order: 0,
      selector: { kind: "latest-approved" },
      adapter: { kind: "auto" },
      enabled: true
    },
    {
      id: "image-compare",
      from: { kind: "node", nodeId: "image", channel: "image" },
      to: { kind: "node", nodeId: "compare", channel: "image" },
      role: "general",
      order: 0,
      selector: { kind: "all" },
      adapter: { kind: "auto" },
      enabled: true
    },
    {
      id: "compare-collection",
      from: { kind: "node", nodeId: "compare", channel: "image" },
      to: { kind: "node", nodeId: "collection", channel: "image" },
      role: "general",
      order: 0,
      selector: { kind: "latest-approved" },
      adapter: { kind: "auto" },
      enabled: true
    }
  ];
  return graph;
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

async function createApp(root: string, exportRoot: string, liveRoot: string, initialGraph = blankGraph()) {
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
  await app.createDocument({ path: path.join(root, "T19.ether"), title: "T19", initialGraph });
  return app;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("T19 durable collection and export workflows", () => {
  it("routes completed Compare selections into an Output Collection", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ether-t20-compare-collection-"));
    roots.push(root);
    const exportRoot = path.join(root, "exports");
    const liveRoot = path.join(root, "live");
    await mkdir(exportRoot);
    await mkdir(liveRoot);
    const app = await createApp(root, exportRoot, liveRoot, imageCompareCollectionGraph());
    try {
      const plan = await app.previewRun({
        commandId: "compare-collection-preview",
        graphId: "root",
        scope: { kind: "graph" }
      });
      const permit = await app.grantRunPermit({
        commandId: "compare-collection-permit",
        planId: plan.id,
        contentHash: plan.contentHash
      });
      const job = await app.startRun({
        commandId: "compare-collection-start",
        planId: plan.id,
        contentHash: plan.contentHash,
        runPermitId: permit.id
      });
      expect((await app.waitForJob(job.id)).status).toBe("waiting-review");
      const checkpoint = await app.boundaryStore().read(({ execution }) => execution.listReviewCheckpoints(job.id)[0]!);
      expect(checkpoint.candidateOutputVersionIds).toHaveLength(3);

      await app.completeCompare({
        commandId: "compare-collection-complete",
        checkpointId: checkpoint.id,
        selectedOutputVersionIds: checkpoint.candidateOutputVersionIds.slice(0, 2)
      });
      expect((await app.waitForJob(job.id)).status).toBe("completed");
      const collectionStep = plan.steps.find((step) => step.nodeId === "collection")!;
      const collectionPlannedWorkItem = plan.workItems.find((item) => item.stepId === collectionStep.id)!;
      const workItems = await app.queryWorkItems(job.id);
      const attempts = await app.queryAttempts(job.id);
      const collectionWorkItem = workItems.find((item) => item.plannedWorkItemId === collectionPlannedWorkItem.id)!;
      const collectionAttempt = attempts.find((attempt) => attempt.workItemId === collectionWorkItem.id);
      expect(collectionAttempt).toMatchObject({ status: "accepted", failure: null });
      const routed = await app.boundaryStore().read(({ collections }) => ({
        collection: collections.get("first-selects"),
        memberships: collections.memberships("first-selects")
      }));
      expect(routed.collection).toMatchObject({ title: "First selects", primary: true });
      expect(routed.memberships.map((member) => member.artifactId)).toHaveLength(2);
    } finally {
      await app.closeDocument();
    }
  });

  it("creates an Output Collection from the sealed node title and keeps reruns idempotent", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ether-t20-collection-"));
    roots.push(root);
    const exportRoot = path.join(root, "exports");
    const liveRoot = path.join(root, "live");
    await mkdir(exportRoot);
    await mkdir(liveRoot);
    const app = await createApp(root, exportRoot, liveRoot, collectionGraph());
    const events: Array<{ name: string; payload: unknown }> = [];
    app.subscribe((event) => events.push({ name: event.name, payload: event.payload }));
    try {
      const artifact = await createArtifact(app, root, "artifact-select", "First candidate");

      for (const suffix of ["first", "second"]) {
        const plan = await app.previewRun({
          commandId: `collection-preview-${suffix}`,
          graphId: "root",
          scope: { kind: "node", nodeId: "collection" }
        });
        expect(plan.steps[0]?.parameters).toMatchObject({
          collectionId: "first-selects",
          collectionTitle: "First selects"
        });
        const permit = await app.grantRunPermit({
          commandId: `collection-permit-${suffix}`,
          planId: plan.id,
          contentHash: plan.contentHash
        });
        const job = await app.startRun({
          commandId: `collection-start-${suffix}`,
          planId: plan.id,
          contentHash: plan.contentHash,
          runPermitId: permit.id
        });
        expect((await app.waitForJob(job.id)).status).toBe("completed");
      }

      const collections = await app.boundaryStore().read(({ collections }) => ({
        collection: collections.get("first-selects"),
        memberships: collections.memberships("first-selects")
      }));
      expect(collections.collection).toMatchObject({
        id: "first-selects",
        title: "First selects",
        primary: true
      });
      expect(collections.memberships).toEqual([
        expect.objectContaining({ artifactId: artifact.id, role: "general" })
      ]);
      expect(events.filter((event) => event.name === "collection.changed")).toEqual([
        { name: "collection.changed", payload: { collectionId: "first-selects", change: "created" } },
        { name: "collection.changed", payload: { collectionId: "first-selects", change: "membership" } },
        { name: "collection.changed", payload: { collectionId: "first-selects", change: "primary" } }
      ]);
    } finally {
      await app.closeDocument();
    }
  });

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
