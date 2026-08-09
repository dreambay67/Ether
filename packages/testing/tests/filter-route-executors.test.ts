import { CollectionExecutor } from "../../execution/src/executors/collection.js";
import { ExportExecutor } from "../../execution/src/executors/export.js";
import type { ExecutorContext } from "../../execution/src/executors/types.js";
import { compilePlan } from "../../execution/src/plan/compilePlan.js";
import { documentStorePersistence, type DocumentStoreLike } from "../../execution/src/scheduler/persistence.js";
import type { EtherGraph, NodeOutputVersion, PayloadEnvelope, PlanStep, ProviderCapability } from "@ether/schema";
import { describe, expect, it, vi } from "vitest";

const timestamp = "2026-08-09T12:00:00.000Z";

const evaluationCapability: ProviderCapability = {
  providerId: "ether-fake-local-evaluation",
  profileId: "evaluation:deterministic-v1",
  modelId: "deterministic-evaluation-v1",
  operation: "evaluate",
  inputChannels: ["image", "data"],
  outputChannels: ["data"],
  aspectRatios: [],
  resolutions: [],
  maxReferences: 8,
  maxOutputsPerCall: 8,
  supportsCancellation: true,
  supportsSeed: false,
  provenance: "runtime-discovered",
  limitations: []
};

function graph(): EtherGraph {
  const node = (id: string, definitionId: EtherGraph["nodes"][number]["definitionId"], config: EtherGraph["nodes"][number]["config"]): EtherGraph["nodes"][number] => ({
    id,
    definitionId,
    title: id,
    position: { x: 0, y: 0 },
    size: { width: 220, height: 140 },
    config,
    presentation: { collapsed: false, accent: "#37e6ea", previewMode: "summary" as const }
  }) as unknown as EtherGraph["nodes"][number];
  const edge = (id: string, from: string, to: string, role: "general" | "negative") => ({
    id,
    from: { kind: "node" as const, nodeId: from, channel: "image" as const },
    to: { kind: "node" as const, nodeId: to, channel: "image" as const },
    role,
    order: 0,
    selector: { kind: "latest" as const },
    adapter: { kind: "auto" as const },
    enabled: true
  });
  return {
    id: "filter-route",
    title: "Filter routes",
    kind: "root",
    createdAt: timestamp,
    updatedAt: timestamp,
    nodes: [
      node("evaluate", "review.evaluate", { kind: "review.evaluate", instruction: "Evaluate.", rubric: [], profile: "balanced", model: "gpt-5", reasoningEffort: "medium" }),
      node("filter", "review.filter", { kind: "review.filter", match: "all", rules: [], routes: [{ id: "matched", label: "Matched", outcome: "matched" }, { id: "unmatched", label: "Unmatched", outcome: "unmatched" }] }),
      node("collection", "output.collection", { kind: "output.collection", collectionId: "delivery", membershipMode: "add", makePrimary: true }),
      node("export", "output.export", { kind: "output.export", pathGrantId: "grant", namingTemplate: "delivery-{index}", format: "original", collisionPolicy: "rename", includeMetadata: true }),
      node("hold", "output.collection", { kind: "output.collection", collectionId: "hold", membershipMode: "add", makePrimary: false })
    ],
    edges: [
      edge("evaluate-filter", "evaluate", "filter", "general"),
      edge("filter-collection", "filter", "collection", "general"),
      edge("filter-export", "filter", "export", "general"),
      edge("filter-hold", "filter", "hold", "negative")
    ],
    groups: [],
    modules: [],
    viewState: { viewport: { x: 0, y: 0, zoom: 1 }, selectedNodeIds: [], selectedEdgeIds: [], inspectorTarget: null }
  };
}

function plan() {
  const current = graph();
  return compilePlan({
    id: "filter-route-plan",
    documentId: "filter-route-document",
    documentRevisionId: "revision",
    graph: current,
    graphRevisionId: "graph-revision",
    scope: { kind: "graph" },
    capability: evaluationCapability,
    providerCapabilities: [evaluationCapability],
    createdAt: timestamp
  });
}

function context(
  currentPlan: ReturnType<typeof plan>,
  step: PlanStep,
  providers: ExecutorContext["providers"],
  inputs: PayloadEnvelope[] = []
): ExecutorContext {
  const plannedWorkItem = currentPlan.workItems.find((item) => item.stepId === step.id)!;
  return {
    claim: {
      plan: currentPlan,
      job: { id: "job", status: "running" },
      workItem: { id: "work", plannedWorkItemId: plannedWorkItem.id, status: "running" },
      attempt: { id: "attempt", ordinal: 0, status: "running", startedAt: timestamp, createdAt: timestamp },
      providerAttemptId: "provider-attempt"
    },
    step,
    plannedWorkItem,
    inputs,
    providerInputs: [],
    signal: new AbortController().signal,
    stagingDirectory: "C:\\filter-route-test",
    providers
  };
}

const cachedFilterPayloads: PayloadEnvelope[] = [
  {
    id: "cached-filter-matched",
    channel: "image",
    role: "general",
    content: { kind: "artifact", artifactId: "artifact-matched" },
    source: { nodeId: "filter", outputVersionId: "cached-filter-version-matched", lineageKey: "filter:matched" },
    metadata: { filterMatched: true }
  },
  {
    id: "cached-filter-unmatched",
    channel: "image",
    role: "general",
    content: { kind: "artifact", artifactId: "artifact-unmatched" },
    source: { nodeId: "filter", outputVersionId: "cached-filter-version-unmatched", lineageKey: "filter:unmatched" },
    metadata: { filterMatched: false }
  },
  {
    id: "cached-filter-summary",
    channel: "data",
    role: "general",
    content: { kind: "object", value: { summary: true }, schemaId: "ether.filter-result.v1" },
    source: { nodeId: "filter", outputVersionId: "cached-filter-version-summary", lineageKey: "filter:summary" },
    metadata: { aggregateSummary: true }
  }
];

const cachedFilterVersions: NodeOutputVersion[] = cachedFilterPayloads.map((payload, ordinal) => ({
  id: payload.source.outputVersionId,
  nodeId: "filter",
  graphId: "filter-route",
  graphRevisionId: "graph-revision",
  inputPayloadIds: [],
  selectedOutputVersionIds: [],
  compiledContextHash: "sha256:v1:cached-filter",
  producer: { kind: "local", executor: "deterministic-filter" },
  outputPayloadIds: [payload.id],
  parentOutputVersionId: null,
  approval: { state: "approved", actor: "system", at: timestamp },
  runId: "prior-filter-job",
  stepId: "prior-filter-step",
  workItemId: `prior-filter-work-${ordinal}`,
  attemptId: `prior-filter-attempt-${ordinal}`,
  timing: { startedAt: timestamp, completedAt: timestamp },
  failure: null,
  createdAt: timestamp
}));

function cachedFilterGraph(): EtherGraph {
  const current = graph();
  current.edges = current.edges.map((edge) => edge.from.kind === "node" && edge.from.nodeId === "filter"
    ? { ...edge, selector: { kind: "all" } }
    : edge);
  current.edges.push(
    {
      id: "filter-collection-summary",
      from: { kind: "node", nodeId: "filter", channel: "data" },
      to: { kind: "node", nodeId: "collection", channel: "data" },
      role: "general",
      order: 1,
      selector: { kind: "all" },
      adapter: { kind: "auto" },
      enabled: true
    },
    {
      id: "filter-export-summary",
      from: { kind: "node", nodeId: "filter", channel: "data" },
      to: { kind: "node", nodeId: "export", channel: "data" },
      role: "general",
      order: 1,
      selector: { kind: "all" },
      adapter: { kind: "auto" },
      enabled: true
    }
  );
  return current;
}

function cachedNodePlan(nodeId: "collection" | "export" | "hold") {
  return compilePlan({
    id: `cached-filter-${nodeId}-plan`,
    documentId: "filter-route-document",
    documentRevisionId: "revision",
    graph: cachedFilterGraph(),
    graphRevisionId: "graph-revision",
    scope: { kind: "node", nodeId },
    capability: evaluationCapability,
    providerCapabilities: [evaluationCapability],
    outputVersions: cachedFilterVersions,
    payloads: cachedFilterPayloads,
    createdAt: timestamp
  });
}

const cachedFilterStore = {
  documentId: "filter-route-document",
  path: "C:/tmp/filter-route.ether",
  read: async <T>(operation: Parameters<DocumentStoreLike["read"]>[0]): Promise<T> => operation({
    artifacts: { get: () => undefined },
    execution: {},
    outputs: {
      getPayload: (id: string) => cachedFilterPayloads.find((payload) => payload.id === id),
      listByNode: (nodeId: string) => nodeId === "filter" ? cachedFilterVersions : []
    }
  }) as T,
  transaction: async <T>(operation: Parameters<DocumentStoreLike["transaction"]>[0]): Promise<T> => operation({ execution: {}, outputs: {} }) as T
} satisfies DocumentStoreLike;

async function cachedNodeInputs(currentPlan: ReturnType<typeof cachedNodePlan>, step: PlanStep): Promise<PayloadEnvelope[]> {
  const plannedWorkItem = currentPlan.workItems.find((item) => item.stepId === step.id)!;
  return documentStorePersistence(cachedFilterStore).resolvePlanInputs!({
    claim: { job: { id: "cached-filter-consumer" }, plan: currentPlan } as never,
    step,
    plannedWorkItem,
    stagingDirectory: "C:/tmp/filter-route"
  });
}

describe("filter route execution contracts", () => {
  it("seals general and negative Review Filter lanes into new plans", () => {
    const currentPlan = plan();
    const routeFor = (nodeId: string) => {
      const step = currentPlan.steps.find((candidate) => candidate.nodeId === nodeId)!;
      const binding = (step.compiledContext.inputBindings as Array<Record<string, unknown>>)[0]!;
      return binding.filterRoute;
    };
    expect(routeFor("collection")).toBe("matched");
    expect(routeFor("export")).toBe("matched");
    expect(routeFor("hold")).toBe("unmatched");
  });

  it("routes cached Filter outputs for node-scoped Collection and Export", async () => {
    const collectionPlan = cachedNodePlan("collection");
    const exportPlan = cachedNodePlan("export");
    const holdPlan = cachedNodePlan("hold");
    const collectionStep = collectionPlan.steps.find((step) => step.nodeId === "collection")!;
    const exportStep = exportPlan.steps.find((step) => step.nodeId === "export")!;
    const holdStep = holdPlan.steps.find((step) => step.nodeId === "hold")!;
    const source = { nodeId: "filter", definitionId: "review.filter", executor: "deterministic-filter" };
    const bindingsFor = (step: PlanStep) => step.compiledContext.inputBindings as Array<Record<string, unknown>>;

    expect(bindingsFor(collectionStep)).toEqual(expect.arrayContaining([
      expect.objectContaining({ filterRoute: "matched", sourceStepId: null, filterSource: source })
    ]));
    expect(bindingsFor(exportStep)).toEqual(expect.arrayContaining([
      expect.objectContaining({ filterRoute: "matched", sourceStepId: null, filterSource: source })
    ]));
    expect(bindingsFor(holdStep)).toEqual(expect.arrayContaining([
      expect.objectContaining({ filterRoute: "unmatched", sourceStepId: null, filterSource: source })
    ]));

    const [collectionInputs, exportInputs, holdInputs] = await Promise.all([
      cachedNodeInputs(collectionPlan, collectionStep),
      cachedNodeInputs(exportPlan, exportStep),
      cachedNodeInputs(holdPlan, holdStep)
    ]);

    expect(collectionInputs.map((payload) => payload.id)).toEqual(["cached-filter-matched"]);
    expect(exportInputs.map((payload) => payload.id)).toEqual(["cached-filter-matched"]);
    expect(holdInputs.map((payload) => payload.id)).toEqual(["cached-filter-unmatched"]);

    const apply = vi.fn().mockResolvedValue({ collectionId: "delivery", memberCount: 1 });
    const exportPayloads = vi.fn().mockResolvedValue({ exported: 1, skipped: 0, paths: ["delivery-1.png"] });
    await new CollectionExecutor().execute(context(collectionPlan, collectionStep, {
      collection: { apply }
    }, collectionInputs));
    await new ExportExecutor().execute(context(exportPlan, exportStep, {
      export: { export: exportPayloads }
    }, exportInputs));

    expect(apply).toHaveBeenCalledWith(expect.objectContaining({
      payloads: [expect.objectContaining({ id: "cached-filter-matched" })]
    }));
    expect(exportPayloads).toHaveBeenCalledWith(expect.objectContaining({
      payloads: [expect.objectContaining({ id: "cached-filter-matched" })]
    }));
  });

  it("completes closed new Filter routes without calling collection or export facets", async () => {
    const currentPlan = plan();
    const collectionStep = currentPlan.steps.find((step) => step.nodeId === "collection")!;
    const exportStep = currentPlan.steps.find((step) => step.nodeId === "export")!;
    const apply = vi.fn();
    const write = vi.fn();

    const collection = await new CollectionExecutor().execute(context(currentPlan, collectionStep, {
      collection: { apply }
    }));
    const exported = await new ExportExecutor().execute(context(currentPlan, exportStep, {
      export: { export: write }
    }));

    expect(apply).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    expect(collection).toMatchObject({ kind: "complete", outputs: [{ content: { value: { collectionId: "delivery", memberCount: 0 } }, metadata: { filterRouteClosed: true } }] });
    expect(exported).toMatchObject({ kind: "complete", outputs: [{ content: { value: { exported: 0, skipped: 0, paths: [] } }, metadata: { filterRouteClosed: true } }] });
  });

  it("keeps legacy unmarked plans on their existing collection behavior", async () => {
    const currentPlan = plan();
    const collectionStep = currentPlan.steps.find((step) => step.nodeId === "collection")!;
    const legacyStep: PlanStep = {
      ...collectionStep,
      compiledContext: {
        ...collectionStep.compiledContext,
        inputBindings: (collectionStep.compiledContext.inputBindings as Array<Record<string, unknown>>).map(({ filterRoute: _filterRoute, ...binding }) => binding)
      } as unknown as PlanStep["compiledContext"]
    };
    const apply = vi.fn().mockResolvedValue({ collectionId: "delivery", memberCount: 0 });

    await new CollectionExecutor().execute(context(currentPlan, legacyStep, {
      collection: { apply }
    }));

    expect(apply).toHaveBeenCalledOnce();
  });
});
