import { rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { EtherApplication } from "../../packages/application/dist/index.js";
import { nodeDefinitions } from "../../packages/graph-kernel/dist/index.js";
import { FakeImageProvider } from "../../packages/providers/dist/index.js";

const fixturePath = path.resolve(process.argv[2] ?? "");
const appDataRoot = path.resolve(process.argv[3] ?? "");
if (!fixturePath.toLowerCase().endsWith(".ether")) {
  throw new Error("Provide a scoped .ether destination for the manual release fixture.");
}
if (!appDataRoot || appDataRoot === path.parse(appDataRoot).root) {
  throw new Error("Provide a scoped AppData root for the fixture builder.");
}

await rm(fixturePath, { force: true });
const createdAt = "2026-07-23T00:00:00.000Z";
const referenceSourcePath = `${fixturePath}.release-reference.png`;
const referenceGrantId = "manual-release-reference-grant";
await writeFile(
  referenceSourcePath,
  Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64")
);
const columns = 5;
const nodes = nodeDefinitions.map((definition, index) => {
  const id = `manual-${definition.id.replaceAll(".", "-")}`;
  const config = definition.defaultConfig();
  const releaseConfig = definition.id === "prompt.text"
    ? { ...config, body: "A luminous DreamBay product portrait with controlled aqua light and deep violet shadow." }
    : definition.id === "prompt.worker"
      ? { ...config, instruction: "Refine the direction while preserving the product identity and restrained editorial tone." }
      : definition.id === "generation.image"
        ? { ...config, providerId: "ether-fake-local", profileId: "fake-image-default", resolution: { width: 64, height: 64 } }
        : definition.id === "edit.image"
          ? { ...config, providerId: "ether-fake-local", profileId: "fake-image-default" }
          : definition.id === "flow.batch"
            ? {
                ...config,
                dimensions: [
                  { id: "market", name: "Market", values: ["EU", "US"] },
                  { id: "treatment", name: "Treatment", values: ["Editorial", "Product", "Social"] }
                ],
                exclusions: [{ values: { market: "US", treatment: "Social" } }],
                parallelism: 1
              }
          : definition.id === "canvas.note"
            ? { ...config, body: "Release fixture: inspect every canonical node before publishing.", style: "note" }
            : config;
  return {
    id,
    definitionId: definition.id,
    title: definition.title,
    position: {
      x: 80 + (index % columns) * 330,
      y: 80 + Math.floor(index / columns) * 230
    },
    size: { width: 260, height: 156 },
    config: releaseConfig,
    presentation: {
      collapsed: false,
      accent: index % 3 === 0 ? "aqua" : index % 3 === 1 ? "violet" : "default",
      previewMode: definition.id === "prompt.text" ? "content" : "summary"
    }
  };
});
const nodeId = (definitionId) => nodes.find((node) => node.definitionId === definitionId).id;
const edges = [
  {
    id: "manual-edge-prompt-worker",
    from: { kind: "node", nodeId: nodeId("prompt.text"), channel: "text" },
    to: { kind: "node", nodeId: nodeId("prompt.worker"), channel: "text" },
    role: "subject",
    order: 0,
    selector: { kind: "latest-approved" },
    adapter: { kind: "auto" },
    enabled: true
  },
  {
    id: "manual-edge-batch-worker",
    from: { kind: "node", nodeId: nodeId("flow.batch"), channel: "data" },
    to: { kind: "node", nodeId: nodeId("prompt.worker"), channel: "data" },
    role: "general",
    order: 0,
    selector: { kind: "latest" },
    adapter: { kind: "auto" },
    enabled: true
  },
  {
    id: "manual-edge-batch-image",
    from: { kind: "node", nodeId: nodeId("flow.batch"), channel: "data" },
    to: { kind: "node", nodeId: nodeId("generation.image"), channel: "data" },
    role: "general",
    order: 0,
    selector: { kind: "latest" },
    adapter: { kind: "auto" },
    enabled: true
  },
  {
    id: "manual-edge-prompt-image",
    from: { kind: "node", nodeId: nodeId("prompt.text"), channel: "text" },
    to: { kind: "node", nodeId: nodeId("generation.image"), channel: "text" },
    role: "composition",
    order: 0,
    selector: { kind: "latest" },
    adapter: { kind: "auto" },
    enabled: true
  },
  {
    id: "manual-edge-reference-image",
    from: { kind: "node", nodeId: nodeId("reference.set"), channel: "image" },
    to: { kind: "node", nodeId: nodeId("generation.image"), channel: "image" },
    role: "subject",
    order: 1,
    selector: { kind: "all" },
    adapter: { kind: "auto" },
    enabled: true
  }
];
const graph = {
  id: "manual-release-graph",
  title: "Ether 4.0 Release Atlas",
  kind: "root",
  createdAt,
  updatedAt: createdAt,
  nodes,
  edges,
  groups: [],
  modules: [],
  viewState: {
    viewport: { x: 0, y: 0, zoom: 0.55 },
    selectedNodeIds: [],
    selectedEdgeIds: [],
    inspectorTarget: null
  }
};

const application = new EtherApplication({
  appDataRoot,
  appVersion: "4.0.0",
  provider: new FakeImageProvider(),
  // The atlas contains all canonical definitions so planning must know that
  // Worker and Evaluate capabilities exist. They are intentionally outside the
  // Image Generator node scope used below and are therefore never dispatched.
  executionProviders: {
    worker: {},
    evaluation: {}
  },
  providerCapabilities: [{
    providerId: "codex-manual-release",
    profileId: "manual-release-balanced",
    operation: "llm",
    inputChannels: ["text", "image", "mask", "data", "video", "audio"],
    outputChannels: ["text", "data"],
    aspectRatios: [],
    resolutions: [],
    maxReferences: 16,
    maxOutputsPerCall: 1,
    maxParallelism: 4,
    supportsCancellation: true,
    supportsSeed: false,
    provenance: "conformance-verified",
    limitations: ["Fixture-only planning evidence; the release capture does not dispatch this route."]
  }],
  pathGrantResolver: {
    resolve({ pathGrantId, purpose }) {
      if (pathGrantId !== referenceGrantId || purpose !== "reference") {
        throw new Error("The release fixture resolver accepts only its scoped reference grant.");
      }
      return {
        displayName: "DreamBay release reference.png",
        kind: "file",
        mediaType: "image/png",
        path: referenceSourcePath
      };
    }
  },
  dispatchMode: "manual"
});
let opened = false;
try {
  const document = await application.createDocument({
    path: fixturePath,
    title: "Ether 4.0 Release Atlas",
    initialGraph: graph
  });
  opened = true;
  await application.grantPathPermit("manual-reference-path-permit", referenceGrantId, "reference");
  const linkedReference = await application.linkDocumentReference({
    graphId: graph.id,
    nodeId: nodeId("reference.set"),
    pathGrantId: referenceGrantId,
    role: "subject"
  });
  await application.embedAvailableReference(linkedReference.id);
  const plan = await application.previewRun({
    commandId: "manual-release-plan",
    correlationId: "manual-release-correlation",
    graphId: graph.id,
    scope: { kind: "node", nodeId: nodeId("generation.image") }
  });
  const permit = await application.grantRunPermit({
    commandId: "manual-release-permit",
    correlationId: "manual-release-correlation",
    planId: plan.id,
    contentHash: plan.contentHash
  });
  const job = await application.startRun({
    commandId: "manual-release-start",
    correlationId: "manual-release-correlation",
    planId: plan.id,
    contentHash: plan.contentHash,
    runPermitId: permit.id
  });
  const completed = await application.runPending(job.id);
  if (!["completed", "waiting-review"].includes(completed.status)) {
    throw new Error(`Release fixture run did not complete: ${completed.status}`);
  }
  const artifacts = await application.searchArtifacts({ text: "" });
  if (artifacts.length === 0) throw new Error("Release fixture did not produce an embedded artifact.");
  process.stdout.write(`${JSON.stringify({
    artifactCount: artifacts.length,
    documentId: document.documentId,
    fixturePath,
    graphId: graph.id,
    jobId: job.id,
    nodeCount: nodes.length,
    referenceCount: 1
  })}\n`);
} finally {
  if (opened) await application.closeDocument();
  await rm(referenceSourcePath, { force: true });
}
