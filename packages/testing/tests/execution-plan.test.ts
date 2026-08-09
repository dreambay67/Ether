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

const workerCapability: ProviderCapability = {
  providerId: capability.providerId,
  profileId: "fake-worker-default",
  operation: "llm",
  inputChannels: ["text", "image", "audio", "video", "data"],
  outputChannels: ["text", "data"],
  aspectRatios: [],
  resolutions: [],
  maxReferences: 8,
  maxOutputsPerCall: 4,
  maxParallelism: 2,
  supportsCancellation: true,
  supportsSeed: false,
  provenance: "conformance-verified",
  limitations: [],
  reasoningEfforts: ["medium"]
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
    providerCapabilities: [...(providerCapabilities ?? []), workerCapability],
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

    expect(plannedNodeIds).toEqual(["worker", "generator", "compare", "filter", "collection", "join"]);
    expect(plannedNodeIds).not.toEqual(expect.arrayContaining(["prompt", "note", "variables", "batch", "references"]));
    expect(plan.steps.find((step) => step.nodeId === "compare")).toEqual(
      expect.objectContaining({
        executor: "human-checkpoint",
        subject: { kind: "node", nodeId: "compare" },
        providerBinding: null
      })
    );
    expect(plan.steps.find((step) => step.nodeId === "generator")?.dependencyStepIds).toEqual([
      plan.steps.find((step) => step.nodeId === "worker")?.id
    ]);
  });

  it("seals an Output Collection node's visible title into its execution plan", () => {
    const graph = representativeGraph();
    const collection = graph.nodes.find((candidate) => candidate.id === "collection");
    if (collection === undefined || collection.config.kind !== "output.collection") {
      throw new Error("Expected Output Collection node.");
    }
    collection.title = "First selects";

    const plan = compile(graph, { kind: "node", nodeId: "collection" });
    expect(plan.steps[0]?.parameters).toMatchObject({
      collectionId: "final",
      collectionTitle: "First selects"
    });

    collection.title = "Renamed selects";
    expect(compile(graph, { kind: "node", nodeId: "collection" }).contentHash)
      .not.toBe(plan.contentHash);
  });

  it("normalizes historical Google aliases into the immutable Gemini binding and JPEG request", () => {
    const graph = representativeGraph();
    const generator = graph.nodes.find((candidate) => candidate.id === "generator")!;
    if (generator.config.kind !== "generation.image") throw new Error("Expected Image Generator.");
    generator.config = {
      ...generator.config,
      providerId: "google-nano-banana-default",
      profileId: "nano-banana-2"
    };
    const gemini: ProviderCapability = {
      ...capability,
      providerId: "google-gemini-api-nano-banana-2",
      profileId: "nano-banana-2",
      modelId: "gemini-3.1-flash-image",
      outputFormats: ["image/jpeg"],
      maxParallelism: 4
    };
    const plan = compile(graph, { kind: "graph" }, [gemini]);
    const step = plan.steps.find((candidate) => candidate.nodeId === "generator")!;
    expect(step.providerBinding).toMatchObject({
      providerId: "google-gemini-api-nano-banana-2",
      profileId: "nano-banana-2"
    });
    expect(step.parameters).toMatchObject({
      providerId: "google-gemini-api-nano-banana-2",
      profileId: "nano-banana-2",
      outputFormat: "image/jpeg"
    });
  });

  it("rejects a persisted batch allocation that cannot honor the target output format", () => {
    const graph = representativeGraph();
    const batch = graph.nodes.find((candidate) => candidate.id === "batch")!;
    if (batch.config.kind !== "flow.batch") throw new Error("Expected Batch.");
    batch.config = {
      ...batch.config,
      allocations: [{
        id: "incompatible-gemini",
        targetNodeId: "generator",
        count: 1,
        providerId: "google-gemini-api-nano-banana-2",
        profileId: "nano-banana-2",
        modelId: "gemini-3.1-flash-image"
      }]
    };
    const gemini: ProviderCapability = {
      ...capability,
      providerId: "google-gemini-api-nano-banana-2",
      profileId: "nano-banana-2",
      modelId: "gemini-3.1-flash-image",
      outputFormats: ["image/jpeg"],
      maxOutputsPerCall: 1
    };
    expect(() => compile(graph, { kind: "graph" }, [gemini])).toThrow(
      /incompatible with the Image Generator ratio, resolution, output format, or output count/u
    );
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
    const downstreamPlan = compile(graph, { kind: "downstream", rootNodeId: "generator", includeRoot: false });
    expect(downstreamPlan.scope).toEqual({ kind: "downstream", rootNodeId: "generator", includeRoot: false });
    expect(downstreamPlan.steps.filter((step) => step.subject?.kind === "node").map((step) => step.nodeId)).toEqual([
      "compare",
      "filter",
      "collection"
    ]);
  });

  it("resolves a blank default Evaluate node to the active verified evaluation route", () => {
    const graph: EtherGraph = {
      id: "graph-evaluate",
      title: "Evaluate graph",
      kind: "root",
      createdAt: timestamp,
      updatedAt: timestamp,
      nodes: [node("evaluate", {
        kind: "review.evaluate",
        instruction: "Score the available subject.",
        rubric: [],
        profile: "balanced",
        model: "gpt-5",
        reasoningEffort: "medium"
      })],
      edges: [],
      groups: [],
      modules: [],
      viewState
    };
    const evaluationCapability: ProviderCapability = {
      providerId: "ether-fake-local-evaluation",
      profileId: "evaluation:deterministic-v1",
      modelId: "deterministic-evaluation-v1",
      reasoningEfforts: ["medium"],
      operation: "evaluate",
      inputChannels: ["text", "image", "data"],
      outputChannels: ["text", "data"],
      aspectRatios: [],
      resolutions: [],
      maxReferences: 32,
      maxOutputsPerCall: 32,
      maxParallelism: 1,
      supportsCancellation: true,
      supportsSeed: false,
      provenance: "runtime-discovered",
      limitations: ["Offline deterministic recovery simulation."]
    };

    const plan = compile(graph, { kind: "node", nodeId: "evaluate" }, [evaluationCapability]);
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]?.providerBinding).toMatchObject({
      providerId: evaluationCapability.providerId,
      profileId: evaluationCapability.profileId,
      modelId: evaluationCapability.modelId,
      capabilitySnapshot: evaluationCapability
    });
    expect(plan.steps[0]?.parameters).toMatchObject({ model: evaluationCapability.modelId });

    const evaluate = graph.nodes[0]!;
    if (evaluate.config.kind !== "review.evaluate") throw new Error("Expected Evaluate node.");
    evaluate.config = { ...evaluate.config, model: "explicit-unavailable-evaluator" };
    expect(() => compile(graph, { kind: "node", nodeId: "evaluate" }, [evaluationCapability]))
      .toThrow(/requires a verified evaluation capability/i);
  });

  it("resolves a Batch scope as its downstream execution boundary and preserves its immutable scope", () => {
    const graph = representativeGraph();
    const scope = { kind: "batch", batchNodeId: "batch" } as const;

    expect(resolveScope(graph, scope)).toEqual(["generator", "compare", "filter", "collection"]);

    const first = compile(graph, scope);
    const second = compile(graph, scope);
    const stepsByNodeId = new Map(first.steps.map((step) => [step.nodeId, step]));
    const generator = stepsByNodeId.get("generator")!;
    const compare = stepsByNodeId.get("compare")!;

    expect(first.scope).toEqual(scope);
    expect(first.steps.filter((step) => step.subject?.kind === "node").map((step) => step.nodeId)).toEqual([
      "generator",
      "compare",
      "filter",
      "collection"
    ]);
    expect(generator.compiledContext).toEqual(expect.objectContaining({
      sourceEdgeIds: ["batch-generator"],
      resolverInputs: [expect.objectContaining({ nodeId: "batch", edgeId: "batch-generator" })]
    }));
    expect(compare.dependencyStepIds).toEqual([generator.id]);
    expect(first.contentHash).toBe(second.contentHash);
    expect(hashPlan(first)).toBe(first.contentHash);
    const changedGraph = {
      ...graph,
      nodes: graph.nodes.map((candidate) => candidate.id === "batch" && candidate.config.kind === "flow.batch"
        ? {
            ...candidate,
            config: {
              ...candidate.config,
              dimensions: candidate.config.dimensions.map((dimension, index) => index === 0
                ? { ...dimension, values: [...dimension.values, "gold"] }
                : dimension)
            }
          }
        : candidate)
    };
    expect(compile(changedGraph, scope).contentHash).not.toBe(first.contentHash);
    expect(compile(graph, { kind: "branch", rootNodeId: "batch" }).contentHash).not.toBe(first.contentHash);
  });

  it("rejects unknown and non-Batch Batch scope nodes", () => {
    const graph = representativeGraph();

    expect(() => resolveScope(graph, { kind: "batch", batchNodeId: "missing" })).toThrow(
      /unknown node missing/i
    );
    expect(() => resolveScope(graph, { kind: "batch", batchNodeId: "worker" })).toThrow(
      /requires a flow\.batch node/i
    );
  });

  it("binds canonical logical Codex image defaults to the runtime provider capability", () => {
    const graph = representativeGraph();
    const edit = node("edit", {
      kind: "edit.image", providerId: "codex", profileId: "image-edit", strength: 0.75, outputCount: 1
    });
    graph.nodes.push(edit);
    const codexImage: ProviderCapability = {
      ...capability,
      providerId: "codex-chatgpt-image-2",
      profileId: "image-default",
      modelId: "chatgpt-image-2"
    };
    const codexEdit: ProviderCapability = {
      ...capability,
      providerId: "codex-chatgpt-image-2",
      profileId: "image-edit",
      operation: "edit-image",
      inputChannels: ["text", "image", "mask", "data"],
      modelId: "chatgpt-image-2"
    };
    const generator = graph.nodes.find((candidate) => candidate.id === "generator")!;
    if (generator.config.kind !== "generation.image") throw new Error("Expected Image Generator.");
    generator.config = { ...generator.config, providerId: "codex", profileId: "image-default" };
    const plan = compile(graph, { kind: "graph" }, [codexImage, codexEdit]);
    expect(plan.steps.find((step) => step.nodeId === "generator")?.providerBinding).toMatchObject({
      providerId: "codex-chatgpt-image-2", profileId: "image-default"
    });
    expect(plan.steps.find((step) => step.nodeId === "edit")?.providerBinding).toMatchObject({
      providerId: "codex-chatgpt-image-2", profileId: "image-edit"
    });
    expect(plan.steps.find((step) => step.nodeId === "generator")?.parameters).toMatchObject({
      providerId: "codex-chatgpt-image-2", profileId: "image-default"
    });
  });

  it("selects the required operation when one provider profile exposes generation and editing", () => {
    const graph = representativeGraph();
    graph.nodes.push(node("edit", {
      kind: "edit.image",
      providerId: capability.providerId,
      profileId: capability.profileId,
      strength: 0.75,
      outputCount: 1
    }));
    const editCapability: ProviderCapability = {
      ...capability,
      operation: "edit-image",
      inputChannels: ["text", "image", "mask", "data"]
    };

    const plan = compile(graph, { kind: "graph" }, [capability, editCapability]);

    expect(plan.steps.find((step) => step.nodeId === "generator")?.providerBinding?.capabilitySnapshot.operation)
      .toBe("generate-image");
    expect(plan.steps.find((step) => step.nodeId === "edit")?.providerBinding?.capabilitySnapshot.operation)
      .toBe("edit-image");
  });

  it("resolves an unbound Worker to the active verified runtime route", () => {
    const runtimeWorker: ProviderCapability = {
      ...workerCapability,
      providerId: "runtime-worker",
      profileId: "worker:deterministic-transform-v1",
      modelId: "deterministic-transform-v1",
      provenance: "runtime-discovered"
    };

    const plan = compile(representativeGraph(), { kind: "node", nodeId: "worker" }, [runtimeWorker]);

    expect(plan.steps.find((step) => step.nodeId === "worker")?.providerBinding).toMatchObject({
      providerId: "runtime-worker",
      profileId: "worker:deterministic-transform-v1",
      modelId: "deterministic-transform-v1",
      capabilitySnapshot: { operation: "llm", provenance: "runtime-discovered" }
    });
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
    expect(compile().effectiveParallelism).toBe(1);
  });

  it("persists exact Prompt Worker and Image Generator allocations across the fixed 4/4 provider capacities", () => {
    const graph = representativeGraph();
    graph.edges = graph.edges.filter((edge) =>
      edge.id !== "worker-batch" && edge.id !== "batch-generator"
    );
    graph.edges.push(
      lane("batch-worker", "batch", "data", "worker", "data", "general", 3),
      lane("worker-generator", "worker", "text", "generator", "text", "subject", 0)
    );
    const codexWorkerA: ProviderCapability = {
      ...capability,
      providerId: "codex-vision-assistant",
      profileId: "worker:gpt-5.4",
      modelId: "gpt-5.4",
      operation: "llm",
      outputChannels: ["text", "data"],
      maxParallelism: 1
    };
    const codexWorkerB: ProviderCapability = {
      ...codexWorkerA,
      profileId: "worker:gpt-5.6",
      modelId: "gpt-5.6"
    };
    const codexImage: ProviderCapability = {
      ...capability,
      providerId: "codex-chatgpt-image-2",
      profileId: "image-default",
      modelId: "chatgpt-image-2",
      maxParallelism: 1
    };
    const gemini: ProviderCapability = {
      ...capability,
      providerId: "google-gemini-api-nano-banana-2",
      profileId: "nano-banana-2",
      modelId: "gemini-3.1-flash-image",
      outputFormats: ["image/jpeg"],
      maxParallelism: 4
    };
    const worker = graph.nodes.find((candidate) => candidate.id === "worker")!;
    if (worker.config.kind !== "prompt.worker") throw new Error("Expected the representative Worker node.");
    worker.config = {
      ...worker.config,
      providerId: codexWorkerA.providerId,
      profileId: codexWorkerA.profileId,
      model: codexWorkerA.modelId!
    };
    const generatorNode = graph.nodes.find((candidate) => candidate.id === "generator")!;
    if (generatorNode.config.kind !== "generation.image") throw new Error("Expected the representative Image Generator node.");
    generatorNode.config = {
      ...generatorNode.config,
      providerId: codexImage.providerId,
      profileId: codexImage.profileId,
      outputFormat: "image/jpeg"
    };
    const batch = graph.nodes.find((candidate) => candidate.id === "batch")!;
    if (batch.config.kind !== "flow.batch") throw new Error("Expected the representative Batch node.");
    batch.config = {
      ...batch.config,
      dimensions: [
        { id: "model", name: "Model", values: ["draft", "final", "launch", "evergreen"] },
        { id: "lighting", name: "Lighting", values: ["cool", "warm"] }
      ],
      exclusions: [],
      parallelism: 8,
      allocations: [{
        id: "worker-gpt-5.4",
        targetNodeId: "worker",
        count: 4,
        providerId: codexWorkerA.providerId,
        profileId: codexWorkerA.profileId,
        modelId: codexWorkerA.modelId!
      }, {
        id: "worker-gpt-5.6",
        targetNodeId: "worker",
        count: 4,
        providerId: codexWorkerB.providerId,
        profileId: codexWorkerB.profileId,
        modelId: codexWorkerB.modelId!
      }, {
        id: "image-codex",
        targetNodeId: "generator",
        count: 4,
        providerId: codexImage.providerId,
        profileId: codexImage.profileId,
        modelId: codexImage.modelId!
      }, {
        id: "image-gemini",
        targetNodeId: "generator",
        count: 4,
        providerId: gemini.providerId,
        profileId: gemini.profileId,
        modelId: gemini.modelId!
      }]
    };

    const capabilities = [codexWorkerA, codexWorkerB, codexImage, gemini];
    const first = compile(graph, { kind: "graph" }, capabilities);
    const second = compile(graph, { kind: "graph" }, capabilities);
    const workerStep = first.steps.find((step) => step.nodeId === "worker")!;
    const generator = first.steps.find((step) => step.nodeId === "generator")!;
    const workerItems = workerStep.workItemIds.map((id) =>
      first.workItems.find((workItem) => workItem.id === id)!
    );
    const generatorItems = generator.workItemIds.map((id) =>
      first.workItems.find((workItem) => workItem.id === id)!
    );

    expect(workerItems.slice(0, 4).map((item) => item.providerBindingOverride)).toEqual(
      Array.from({ length: 4 }, () => expect.objectContaining({
        providerId: codexWorkerA.providerId,
        profileId: codexWorkerA.profileId,
        modelId: codexWorkerA.modelId
      }))
    );
    expect(workerItems.slice(4).map((item) => item.providerBindingOverride)).toEqual(
      Array.from({ length: 4 }, () => expect.objectContaining({
        providerId: codexWorkerB.providerId,
        profileId: codexWorkerB.profileId,
        modelId: codexWorkerB.modelId
      }))
    );
    expect(generatorItems.slice(0, 4).map((item) => item.providerBindingOverride)).toEqual(
      Array.from({ length: 4 }, () => expect.objectContaining({
        providerId: codexImage.providerId,
        profileId: codexImage.profileId,
        modelId: codexImage.modelId
      }))
    );
    expect(generatorItems.slice(4).map((item) => item.providerBindingOverride)).toEqual(
      Array.from({ length: 4 }, () => expect.objectContaining({
        providerId: gemini.providerId,
        profileId: gemini.profileId,
        modelId: gemini.modelId
      }))
    );
    expect(first.effectiveParallelism).toBe(8);
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
