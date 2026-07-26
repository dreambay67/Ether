import { describe, expect, it } from "vitest";

import {
  compilePlan,
  expandBatch,
  hashPlan,
  resolveScope
} from "../../execution/src/index.js";
import type {
  EtherEdge,
  EtherGraph,
  ProviderCapability
} from "@ether/schema";

const timestamp = "2026-07-17T08:00:00.000Z";
const presentation = { collapsed: false, accent: "default", previewMode: "summary" as const };
const viewState = {
  viewport: { x: 0, y: 0, zoom: 1 },
  selectedNodeIds: [],
  selectedEdgeIds: [],
  inspectorTarget: null
};

const capability: ProviderCapability = {
  providerId: "ether-fake-local",
  profileId: "fake-image-default",
  operation: "generate-image",
  inputChannels: ["text", "image", "data"],
  outputChannels: ["image"],
  aspectRatios: ["1:1"],
  resolutions: [{ id: "64", width: 64, height: 64, label: "64 x 64" }],
  maxReferences: 8,
  maxOutputsPerCall: 4,
  maxParallelism: 2,
  supportsCancellation: true,
  supportsSeed: false,
  provenance: "conformance-verified",
  limitations: []
};

function node(id: string, config: Record<string, unknown>) {
  return {
    id,
    definitionId: config.kind,
    title: id,
    position: { x: 0, y: 0 },
    size: { width: 220, height: 140 },
    config,
    presentation
  } as EtherGraph["nodes"][number];
}

function lane(
  id: string,
  from: string,
  fromChannel: EtherEdge["from"] extends { channel: infer Channel } ? Extract<Channel, string> : never,
  to: string,
  toChannel: EtherEdge["to"] extends { channel: infer Channel } ? Extract<Channel, string> : never,
  role: EtherEdge["role"],
  order: number,
  adapter: EtherEdge["adapter"] = { kind: "auto" }
): EtherEdge {
  return {
    id,
    from: { kind: "node", nodeId: from, channel: fromChannel } as EtherEdge["from"],
    to: { kind: "node", nodeId: to, channel: toChannel } as EtherEdge["to"],
    role,
    order,
    selector: { kind: "latest-approved" },
    adapter,
    enabled: true
  };
}

function representativeGraph(): EtherGraph {
  return {
    id: "graph-root",
    title: "Planner acceptance graph",
    kind: "root",
    createdAt: timestamp,
    updatedAt: timestamp,
    nodes: [
      node("prompt", { kind: "prompt.text", body: "A cobalt bottle", assembly: "append" }),
      node("note", { kind: "canvas.note", body: "Studio lighting", style: "note" }),
      node("variables", { kind: "flow.variables", variables: [{ name: "season", value: "summer" }] }),
      node("worker", {
        kind: "prompt.worker",
        behavior: "rewrite",
        instruction: "Make the direction precise.",
        profile: "balanced",
        model: "gpt-5",
        reasoningEffort: "medium",
        variation: 0.2,
        contextPolicy: { includeUpstream: true, includeDownstreamCapabilities: true, maxTokens: 4000 },
        memoryPolicy: { mode: "stateless" },
        outputContract: { channel: "text", count: 1, selectionPolicy: "latest" }
      }),
      node("batch", {
        kind: "flow.batch",
        dimensions: [
          { id: "model", name: "Model", values: ["draft", "final"] },
          { id: "lighting", name: "Lighting", values: ["cool", "warm"] }
        ],
        exclusions: [{ values: { model: "final", lighting: "warm" } }],
        parallelism: 4
      }),
      node("generator", {
        kind: "generation.image",
        providerId: capability.providerId,
        profileId: capability.profileId,
        aspectRatio: "1:1",
        resolution: { width: 64, height: 64 },
        outputCount: 1
      }),
      node("compare", { kind: "review.compare", selectionMode: "one", minimumSelections: 1 }),
      node("filter", { kind: "review.filter", match: "all", rules: [], routes: [] }),
      node("collection", { kind: "output.collection", collectionId: "final", membershipMode: "add", makePrimary: true }),
      node("join", { kind: "flow.join", strategy: "ordered", requireComplete: true }),
      node("references", { kind: "reference.set", artifactIds: [], enabledChannels: ["image"], ordering: "manual" })
    ],
    edges: [
      lane("prompt-worker", "prompt", "text", "worker", "text", "subject", 0),
      lane("note-worker", "note", "text", "worker", "text", "setting", 1),
      lane("variables-worker", "variables", "data", "worker", "data", "general", 2),
      lane("worker-batch", "worker", "text", "batch", "text", "subject", 0),
      lane("batch-generator", "batch", "text", "generator", "text", "subject", 0),
      lane("generator-compare", "generator", "image", "compare", "image", "general", 0),
      lane("compare-filter", "compare", "image", "filter", "image", "general", 0),
      lane("filter-collection", "filter", "image", "collection", "image", "general", 0)
    ],
    groups: [],
    modules: [],
    viewState
  };
}

function compile(
  graph = representativeGraph(),
  scope: Parameters<typeof compilePlan>[0]["scope"] = { kind: "graph" },
  providerCapabilities?: readonly ProviderCapability[]
) {
  return compilePlan({
    id: "plan-acceptance",
    documentId: "document-acceptance",
    documentRevisionId: "document-revision-1",
    graph,
    graphRevisionId: "graph-revision-1",
    scope,
    capability,
    providerCapabilities,
    capabilities: ["codex.vision"],
    createdAt: timestamp
  });
}

describe("Ether execution planner", () => {
  it("plans canonical runnable nodes while resolver nodes remain input-only", () => {
    const plan = compile();
    const plannedNodeIds = plan.steps
      .filter((step) => step.subject?.kind === "node")
      .map((step) => step.nodeId);

    expect(plannedNodeIds).toEqual(["worker", "generator", "compare", "filter", "collection"]);
    expect(plannedNodeIds).not.toEqual(expect.arrayContaining(["prompt", "note", "variables", "batch", "join", "references"]));
    expect(plan.steps.find((step) => step.nodeId === "compare")).toEqual(
      expect.objectContaining({
        executor: "human-checkpoint",
        subject: { kind: "node", nodeId: "compare" },
        providerBinding: null
      })
    );
    expect(plan.steps.find((step) => step.nodeId === "generator")?.dependencyStepIds).toEqual(["step-worker"]);
  });

  it("resolves branch, selected, downstream, and refresh-upstream by edges", () => {
    const graph = representativeGraph();
    expect(resolveScope(graph, { kind: "branch", rootNodeId: "generator" })).toEqual([
      "generator",
      "compare",
      "filter",
      "collection"
    ]);
    expect(resolveScope(graph, { kind: "selected", nodeIds: ["generator"] })).toEqual(["generator"]);
    expect(resolveScope(graph, { kind: "downstream", rootNodeId: "generator", includeRoot: false })).toEqual([
      "compare",
      "filter",
      "collection"
    ]);
    expect(resolveScope(graph, { kind: "refresh-upstream", nodeId: "generator" })).toEqual([
      "worker",
      "generator"
    ]);
  });

  it("expands Cartesian batch work deterministically with exclusions and bounded parallelism", () => {
    const expansion = expandBatch({
      stepId: "step-generator",
      dimensions: [
        { id: "model", name: "Model", values: ["draft", "final"] },
        { id: "lighting", name: "Lighting", values: ["cool", "warm"] }
      ],
      exclusions: [{ values: { model: "final", lighting: "warm" } }],
      requestedParallelism: 4
    });
    expect(expansion.items).toHaveLength(3);
    expect(expansion.summary).toEqual(expect.objectContaining({ dimensions: 2, exclusions: 1, workItemCount: 3 }));
    expect(expansion.effectiveParallelism).toBe(3);
    expect(expansion.items.map((item) => item.id)).toEqual(
      expandBatch({
        stepId: "step-generator",
        dimensions: [
          { id: "model", name: "Model", values: ["draft", "final"] },
          { id: "lighting", name: "Lighting", values: ["cool", "warm"] }
        ],
        exclusions: [{ values: { model: "final", lighting: "warm" } }],
        requestedParallelism: 4
      }).items.map((item) => item.id)
    );
    expect(compile().batchSummary).toEqual({ dimensions: 2, exclusions: 1, workItemCount: 3 });
    expect(compile().effectiveParallelism).toBe(2);
  });

  it("persists exact provider/model allocations and combines independent provider-family capacity", () => {
    const graph = representativeGraph();
    const alternate: ProviderCapability = {
      ...capability,
      providerId: "google-nano-banana-2",
      profileId: "nano-banana-pro",
      modelId: "provider-reported-nano-banana",
      maxParallelism: 1
    };
    const batch = graph.nodes.find((candidate) => candidate.id === "batch")!;
    if (batch.config.kind !== "flow.batch") throw new Error("Expected the representative Batch node.");
    batch.config = {
      ...batch.config,
      allocations: [{
        id: "codex-two",
        targetNodeId: "generator",
        count: 2,
        providerId: capability.providerId,
        profileId: capability.profileId,
        modelId: "codex-image"
      }, {
        id: "antigravity-one",
        targetNodeId: "generator",
        count: 1,
        providerId: alternate.providerId,
        profileId: alternate.profileId,
        modelId: "provider-reported-nano-banana"
      }]
    };

    const first = compile(graph, { kind: "graph" }, [capability, alternate]);
    const second = compile(graph, { kind: "graph" }, [capability, alternate]);
    const generator = first.steps.find((step) => step.nodeId === "generator")!;
    const generatorItems = generator.workItemIds.map((id) =>
      first.workItems.find((workItem) => workItem.id === id)!
    );

    expect(generatorItems.map((item) => item.providerBindingOverride)).toEqual([
      expect.objectContaining({
        providerId: capability.providerId,
        profileId: capability.profileId,
        modelId: "codex-image"
      }),
      expect.objectContaining({
        providerId: capability.providerId,
        profileId: capability.profileId,
        modelId: "codex-image"
      }),
      expect.objectContaining({
        providerId: alternate.providerId,
        profileId: alternate.profileId,
        modelId: "provider-reported-nano-banana"
      })
    ]);
    expect(first.effectiveParallelism).toBe(3);
    expect(first.contentHash).toBe(second.contentHash);
  });

  it("fails closed on over-allocation, duplicate allocation lanes, and partial Worker routing", () => {
    const overAllocated = representativeGraph();
    const batch = overAllocated.nodes.find((candidate) => candidate.id === "batch")!;
    if (batch.config.kind !== "flow.batch") throw new Error("Expected the representative Batch node.");
    batch.config = {
      ...batch.config,
      allocations: [{
        id: "too-many",
        targetNodeId: "generator",
        count: 4,
        providerId: capability.providerId,
        profileId: capability.profileId,
        modelId: "image-model"
      }]
    };
    expect(() => compile(overAllocated)).toThrow(/assign 4 items, but the batch has only 3/i);

    const duplicated = representativeGraph();
    const duplicatedBatch = duplicated.nodes.find((candidate) => candidate.id === "batch")!;
    if (duplicatedBatch.config.kind !== "flow.batch") throw new Error("Expected the representative Batch node.");
    const allocation = {
      id: "duplicate",
      targetNodeId: "generator",
      count: 1,
      providerId: capability.providerId,
      profileId: capability.profileId,
      modelId: "image-model"
    };
    duplicatedBatch.config = { ...duplicatedBatch.config, allocations: [allocation, allocation] };
    expect(() => compile(duplicated)).toThrow(/duplicate allocation id duplicate/i);

    const partialWorker = representativeGraph();
    const worker = partialWorker.nodes.find((candidate) => candidate.id === "worker")!;
    if (worker.config.kind !== "prompt.worker") throw new Error("Expected the representative Worker node.");
    worker.config = { ...worker.config, providerId: "codex-assistant" };
    expect(() => compile(partialWorker)).toThrow(/must select both a provider and profile/i);

    const unsupportedModel = representativeGraph();
    const unsupportedBatch = unsupportedModel.nodes.find((candidate) => candidate.id === "batch")!;
    if (unsupportedBatch.config.kind !== "flow.batch") throw new Error("Expected the representative Batch node.");
    unsupportedBatch.config = {
      ...unsupportedBatch.config,
      allocations: [{
        id: "invented-model",
        targetNodeId: "generator",
        count: 1,
        providerId: "google-nano-banana-2",
        profileId: "nano-banana-pro",
        modelId: "made-up-model"
      }]
    };
    expect(() => compile(unsupportedModel, { kind: "graph" }, [{
      ...capability,
      providerId: "google-nano-banana-2",
      profileId: "nano-banana-pro",
      modelId: "verified-image-model"
    }])).toThrow(/made-up-model is not the verified model/i);

    const imageOnly = compile(
      representativeGraph(),
      { kind: "node", nodeId: "generator" },
      [{ ...capability, modelId: "verified-codex-image-model" }]
    );
    expect(imageOnly.steps.find((step) => step.nodeId === "generator")?.providerBinding?.modelId)
      .toBe("verified-codex-image-model");
  });

  it("persists adapter subjects, roles, channels, consequences, and stable plan hashes", () => {
    const graph = representativeGraph();
    graph.edges = [
      lane(
        "generator-evaluate",
        "generator",
        "image",
        "compare",
        "text",
        "subject",
        0,
        { kind: "explicit", adapterId: "codex.image-to-text" }
      )
    ];
    const first = compile(graph);
    const second = compile(graph);
    const adapter = first.steps.find((step) => step.subject?.kind === "adapter");

    expect(adapter).toEqual(expect.objectContaining({
      subject: { kind: "adapter", adapterId: "codex.image-to-text" },
      executor: "codex-evaluation"
    }));
    expect(adapter?.compiledContext).toEqual(expect.objectContaining({
      sourceChannel: "image",
      targetChannel: "text",
      role: "subject",
      consequence: expect.objectContaining({ executorInputField: expect.any(String) })
    }));
    expect(first.contentHash).toBe(second.contentHash);
    expect(hashPlan(first)).toBe(first.contentHash);
  });
});
