import { createHash } from "node:crypto";

import {
  adapterDefinitions,
  interpolateVariables,
  renderVariableValue,
  variableMap,
  resolveOutputSelector,
  validateConnection,
  type AdapterDefinition
} from "@ether/graph-kernel";
import {
  compileWorkerContext,
  resolveMemoryScopeKey,
  WorkerContextCompilationError,
  type StructuredOutputSchema
} from "@ether/intelligence";
import {
  ExecutionPlanSchema,
  type BatchProviderAllocation,
  type ConnectionRole,
  type EtherEdge,
  type EtherGraph,
  type ExecutionPlan,
  type ExecutionScope,
  type JsonObject,
  type JsonValue,
  type NodeOutputVersion,
  type PayloadEnvelope,
  type PlanStep,
  type PlannedWorkItem,
  type ProviderBinding,
  type ProviderCapability
} from "@ether/schema";
import { resolveImageProviderAlias } from "@ether/providers";

import {
  BatchExpansionError,
  expandBatch,
  type BatchExclusion,
  type BatchExpansionResult
} from "./batchExpansion.js";
import { hashPlan } from "./hashPlan.js";
import {
  combinedProviderParallelismLimit,
  SAFE_GLOBAL_PARALLELISM
} from "./providerConcurrency.js";
import {
  createPlannerTopology,
  isPlanStepNode,
  resolveExecutionScope,
  type PlannerExecutionScope,
  type PlannerNode,
  type PlannerTopology,
  type ScopeResolution
} from "./scopeResolution.js";

export interface CompilePlanInput {
  id: string;
  documentId: string;
  documentRevisionId: string;
  graph: EtherGraph;
  graphs?: readonly EtherGraph[];
  graphRevisionId: string;
  scope: PlannerExecutionScope;
  capability: ProviderCapability;
  providerCapabilities?: readonly ProviderCapability[];
  capabilities?: readonly string[];
  outputVersions?: readonly NodeOutputVersion[];
  payloads?: readonly PayloadEnvelope[];
  batchDimensions?: readonly {
    id: string;
    name: string;
    values: JsonValue[];
  }[];
  batchExclusions?: readonly BatchExclusion[];
  batchExclusionsByNode?: Readonly<Record<string, readonly BatchExclusion[]>>;
  batchCap?: number;
  requestedParallelism?: number;
  /** Enables the immutable Worker runtime contract used by the production preview path. */
  workerRuntimeIntegration?: {
    schemaCatalog?: readonly StructuredOutputSchema[];
  };
  /** Exact enabled Reference Set members, resolved during preview and sealed into the plan. */
  referenceInputs?: readonly ReferenceInputBinding[];
  createdAt: string;
}

type ReferenceInputBinding = {
  id: string;
  edgeId: string;
  sourceNodeId: string;
  payloadId: string;
  channel: PayloadEnvelope["channel"];
  role: ConnectionRole;
  order: number;
  displayName: string;
  mediaType: string;
  memberKind: "linked-reference" | "embedded-reference" | "embedded-artifact";
};

export type PlanCompilationErrorCode =
  | "INVALID_GRAPH"
  | "UNKNOWN_SCOPE_NODE"
  | "INVALID_SCOPE"
  | "GRAPH_CYCLE"
  | "INVALID_NODE_CONFIG"
  | "INVALID_CONNECTION"
  | "OUTPUT_SELECTOR_INVALID"
  | "PROVIDER_CAPABILITY_UNAVAILABLE"
  | "EDIT_CAPABILITY_UNSUPPORTED"
  | "EDIT_MASK_UNSUPPORTED"
  | "LOCAL_MEDIA_PROVIDER_MODE_UNSUPPORTED"
  | "EDIT_WORKSPACE_ARTIFACT_NOT_FOUND"
  | "EDIT_SOURCE_NOT_ON_IMAGE_LANE"
  | "WORKER_CONTEXT_INVALID"
  | "WORKER_RUNTIME_UNAVAILABLE"
  | "VARIABLE_INTERPOLATION_INVALID"
  | "INVALID_PLAN";

export class PlanCompilationError extends Error {
  readonly code: PlanCompilationErrorCode;
  readonly details: Record<string, unknown> | undefined;

  constructor(
    code: PlanCompilationErrorCode,
    message: string,
    details?: Record<string, unknown>,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "PlanCompilationError";
    this.code = code;
    this.details = details;
  }
}

type EdgeResolution = {
  edge: EtherEdge;
  source: PlannerNode;
  target: PlannerNode;
  adapter: AdapterDefinition | null;
  consequence: JsonObject;
  sourcePayloadIds: string[];
  targetPayloadIds: string[];
  sourceBindings: Array<{
    name: string;
    payloadId: string;
    sourceStepId: string | null;
    selector: "latest-approved" | "latest" | "all" | "pinned";
  }>;
  targetBindings: Array<{
    name: string;
    payloadId: string;
    sourceStepId: string | null;
    selector: "latest-approved" | "latest" | "all" | "pinned";
  }>;
  sourceStepId: string | null;
  sourceDependencyStepIds: string[];
  adapterStepId: string | null;
};

type StepDraft = {
  step: Omit<PlanStep, "workItemIds">;
  expansion: BatchExpansionResult;
  allocations: Array<{
    id: string;
    count: number;
    binding: ProviderBinding;
  }>;
};

type InternalWorkItem = PlannedWorkItem & {
  values: JsonObject;
};

type BatchPlanContext = {
  dimensions: Array<{
    id: string;
    name: string;
    values: JsonValue[];
  }>;
  exclusions: readonly BatchExclusion[];
  allocations: readonly BatchProviderAllocation[];
  requestedParallelism: number | undefined;
};

const resolverDefinitionIds = new Set([
  "prompt.text",
  "reference.set",
  "canvas.note",
  "flow.variables",
  "flow.batch"
]);

export function compilePlan(input: CompilePlanInput): ExecutionPlan {
  let topology: PlannerTopology;
  let scope: ScopeResolution;
  try {
    topology = createPlannerTopology(input.graph, input.graphs ?? [input.graph]);
    scope = resolveExecutionScope(topology, input.scope);
  } catch (error) {
    if (error instanceof PlanCompilationError) throw error;
    const code = errorCode(error);
    throw new PlanCompilationError(code, errorMessage(error), undefined, { cause: error });
  }

  const selected = new Set(scope.nodeIds);
  const nodeStepIds = new Map(
    scope.nodeIds
      .map((nodeId) => topology.nodeById.get(nodeId))
      .filter((node): node is PlannerNode => node !== undefined)
      .filter(isPlanStepNode)
      .map((node) => [node.id, nodeStepId(input.id, node.id)] as const)
  );
  validateNodeConfigurations(topology);
  const edgeResolutions = resolveEdges(
    input,
    topology,
    selected,
    nodeStepIds,
    input.scope.kind === "graph" ||
      input.scope.kind === "branch" ||
      input.scope.kind === "downstream" ||
      input.scope.kind === "batch" ||
      input.scope.kind === "refresh-upstream"
  );
  const batchNodes = topology.nodes.filter((node) => {
    if (node.config.kind !== "flow.batch") return false;
    return input.scope.kind === "graph" || scope.nodeIds.some((targetId) =>
      node.id === targetId || canReach(topology, node.id, targetId)
    );
  });
  const drafts: StepDraft[] = [];
  const warnings: ExecutionPlan["warnings"] = [];
  const batchResults: BatchExpansionResult[] = [];
  const variableMaps = new Map<string, ReadonlyMap<string, JsonValue>>();

  for (const nodeId of scope.nodeIds) {
    const target = topology.nodeById.get(nodeId);
    if (target === undefined || !isPlanStepNode(target)) continue;
    const variables = variablesForTarget(topology, target.id);
    variableMaps.set(target.id, variables);
    const incoming = (topology.incoming.get(nodeId) ?? [])
      .filter((edge) => edge.from.kind === "node" && edge.to.kind === "node")
      .sort(edgeOrder);
    const resolvedIncoming = incoming.map((edge) => {
      const resolution = edgeResolutions.get(edge.id);
      if (resolution === undefined) {
        throw new PlanCompilationError(
          "INVALID_CONNECTION",
          `Enabled input edge ${edge.id} was not resolved.`,
          { edgeId: edge.id, nodeId }
        );
      }
      return resolution;
    });

    for (const edge of resolvedIncoming.filter((entry) => entry.adapter !== null)) {
      const adapter = edge.adapter!;
      const stepId = edge.adapterStepId!;
      const batchContext = batchContextForNode(
        target.id,
        batchNodes,
        topology,
        input
      );
      const expansion = expandForStep(stepId, batchContext, input);
      batchResults.push(expansion);
      if (expansion.summary.capped) {
        warnings.push({
          code: "BATCH_EXPANSION_CAPPED",
          message: `Batch expansion for ${stepId} was capped at ${expansion.summary.cap}.`,
          nodeId: target.id,
          blocking: false
        });
      }
      drafts.push({
        allocations: [],
        expansion,
        step: makeAdapterStep({
          input,
          target,
          edge,
          adapter
        })
      });
    }

    const batchContext = batchContextForNode(nodeId, batchNodes, topology, input);
    const expansion = expandForStep(nodeStepId(input.id, nodeId), batchContext, input);
    batchResults.push(expansion);
    if (expansion.summary.capped) {
      warnings.push({
        code: "BATCH_EXPANSION_CAPPED",
        message: `Batch expansion for ${nodeStepId(input.id, nodeId)} was capped at ${expansion.summary.cap}.`,
        nodeId: target.id,
        blocking: false
      });
    }
    drafts.push({
      allocations: allocationBindingsFor(input, target, batchContext.allocations),
      expansion,
      step: makeNodeStep({
        input,
        target,
        incoming: resolvedIncoming,
        variables
      })
    });
  }

  const workItems = materializeWorkItems(drafts);
  const steps = drafts.map((draft) => ({
    ...draft.step,
    workItemIds: workItems.byStep.get(draft.step.id)?.map((item) => item.id) ?? []
  }));
  const allCapabilities = uniqueCapabilities([
    input.capability,
    ...(input.providerCapabilities ?? [])
  ]);
  const requestedParallelism = Math.max(
    1,
    ...drafts.map((draft) => draft.expansion.requestedParallelism)
  );
  const activeProviderBindings = [
    ...steps.flatMap((step) => {
      if (step.providerBinding === null || step.providerBinding === undefined) return [];
      const items = workItems.byStep.get(step.id) ?? [];
      return items.some((item) => item.providerBindingOverride === undefined)
        ? [step.providerBinding]
        : [];
    }),
    ...workItems.items.flatMap((item) =>
      item.providerBindingOverride === undefined ? [] : [item.providerBindingOverride]
    )
  ];
  const effectiveParallelism = Math.min(
    requestedParallelism,
    Math.max(workItems.items.length, 1),
    SAFE_GLOBAL_PARALLELISM,
    combinedProviderParallelismLimit(activeProviderBindings)
  );
  const batchSummary = batchNodes.length === 0
    ? undefined
    : {
        dimensions: Math.max(...batchResults.map((result) => result.summary.dimensions), 0),
        exclusions: Math.max(...batchResults.map((result) => result.summary.exclusions), 0),
        workItemCount: Math.max(...batchResults.map((result) => result.summary.workItemCount), 0)
      };
  const runtimeSteps = input.workerRuntimeIntegration === undefined
    ? steps
    : compileWorkerRuntimeContexts(input, topology, steps, variableMaps);
  const withoutHash = {
    id: input.id,
    capsuleVersion: 1 as const,
    hashVersion: "sha256-v1" as const,
    documentId: input.documentId,
    documentRevisionId: input.documentRevisionId,
    graphId: input.graph.id,
    graphRevisionId: input.graphRevisionId,
    scope: planScope(input.scope, scope),
    steps: runtimeSteps,
    workItems: workItems.items,
    providerCapabilitySnapshots: allCapabilities,
    estimatedCalls: steps.reduce(
      (count, step) => count + (step.providerBinding === null ? 0 : step.workItemIds.length),
      0
    ),
    ...(batchSummary === undefined ? {} : { batchSummary }),
    requestedParallelism,
    effectiveParallelism,
    warnings,
    createdAt: input.createdAt
  };

  try {
    return ExecutionPlanSchema.parse({
      ...withoutHash,
      contentHash: hashPlan(withoutHash)
    });
  } catch (error) {
    throw new PlanCompilationError(
      "INVALID_PLAN",
      `Compiled execution plan is invalid: ${errorMessage(error)}`,
      undefined,
      { cause: error }
    );
  }
}

/**
 * Worker inputs produced inside this plan have no persisted output version at preview
 * time.  Compile the available pinned context now, then record the exact runtime
 * policy/manifest beside the plan so dispatch never re-reads mutable graph settings.
 */
function compileWorkerRuntimeContexts(
  input: CompilePlanInput,
  topology: PlannerTopology,
  steps: PlanStep[],
  variableMaps: ReadonlyMap<string, ReadonlyMap<string, JsonValue>>
): PlanStep[] {
  const workerSteps = new Map(steps.map((step) => [step.nodeId, step]));
  return steps.map((step) => {
    const target = topology.nodeById.get(step.nodeId);
    if (target?.config.kind !== "prompt.worker") return step;
    const variables = variableMaps.get(target.id) ?? new Map<string, JsonValue>();
    const binding = step.providerBinding;
    if (binding === null || binding === undefined) {
      throw new PlanCompilationError(
        "WORKER_RUNTIME_UNAVAILABLE",
        `Worker ${target.id} has no immutable provider binding.`
      );
    }
    const targetConfig = interpolatedNodeConfig(target.config, variables);
    if (targetConfig.kind !== "prompt.worker") return step;
    const workerNodeIds = new Set([target.id]);
    const workerStack = [target.id];
    while (workerStack.length > 0) {
      const nodeId = workerStack.pop()!;
      for (const edge of input.graph.edges) {
        if (edge.enabled && edge.to.kind === "node" && edge.to.nodeId === nodeId && edge.from.kind === "node" && !workerNodeIds.has(edge.from.nodeId)) {
          workerNodeIds.add(edge.from.nodeId);
          workerStack.push(edge.from.nodeId);
        }
      }
    }
    const workerGraph: EtherGraph = {
      ...input.graph,
      nodes: input.graph.nodes.map((candidate) => workerNodeIds.has(candidate.id)
        ? { ...candidate, config: interpolatedNodeConfig(candidate.config, variables) } as EtherGraph["nodes"][number]
        : candidate)
    };
    const runtimeCatalog = runtimeCatalogForWorker(targetConfig, binding.capabilitySnapshot, binding.modelId);
    const retainedEdges = input.graph.edges.filter((edge) => {
      if (edge.to.kind !== "node" || edge.from.kind !== "node") return true;
      if (edge.to.nodeId !== target.id) return true;
      const sourceNodeId = edge.from.nodeId;
      // Resolver and planned source nodes will supply their materialized payload at
      // dispatch. They are represented by the immutable step bindings below.
      return (input.outputVersions ?? []).some((version) => version.nodeId === sourceNodeId);
    });
    const downstream = downstreamCapabilities(input, topology, target.id, workerSteps);
    if (target.config.outputContract.count > binding.capabilitySnapshot.maxOutputsPerCall) {
      throw new PlanCompilationError(
        "WORKER_RUNTIME_UNAVAILABLE",
        `Worker ${target.id} requests ${target.config.outputContract.count} variants, but ${binding.providerId}/${binding.profileId} verifies at most ${binding.capabilitySnapshot.maxOutputsPerCall}.`,
        { nodeId: target.id, requested: target.config.outputContract.count, maximum: binding.capabilitySnapshot.maxOutputsPerCall }
      );
    }
    let compiled: ReturnType<typeof compileWorkerContext>;
    try {
      compiled = compileWorkerContext({
        graph: { ...workerGraph, edges: retainedEdges },
        targetNodeId: target.id,
        versions: input.outputVersions ?? [],
        payloads: input.payloads ?? [],
        runtimeCatalog,
        adapterCapabilities: [...adapterCapabilityIds(input)],
        downstream,
        schemaCatalog: input.workerRuntimeIntegration?.schemaCatalog ?? []
      });
    } catch (error) {
      if (error instanceof WorkerContextCompilationError) {
        throw new PlanCompilationError(
          "WORKER_CONTEXT_INVALID",
          `Worker ${target.id} cannot be dispatched: ${error.message}`,
          { nodeId: target.id, manifest: error.manifest as unknown as Record<string, unknown> }
        );
      }
      throw error;
    }
    const plannedIncomingEdges = input.graph.edges
      .filter((edge) => edge.enabled && edge.from.kind === "node" && edge.to.kind === "node" && edge.to.nodeId === target.id)
      .map((edge) => edge.id)
      .sort();
    const lineageKey = compiled.manifest.lineageKey || `planned:${plannedIncomingEdges.join(",")}`;
    const memoryScopeKey = resolveMemoryScopeKey(target.config.memoryPolicy, {
      documentId: input.documentId,
      graphId: input.graph.id,
      nodeId: target.id,
      lineageKey
    });
    return {
      ...step,
      compiledContext: jsonObject({
        ...step.compiledContext,
        worker: {
          request: compiled.request,
          manifest: compiled.manifest,
          memoryScopeKey,
          schemaCatalog: input.workerRuntimeIntegration?.schemaCatalog ?? [],
          inputChannels: binding.capabilitySnapshot.inputChannels,
          maxReferences: binding.capabilitySnapshot.maxReferences,
          ...(compiled.request.outputContract.schemaId === undefined ? {} : {
            outputSchema: input.workerRuntimeIntegration?.schemaCatalog
              ?.find((schema) => schema.id === compiled.request.outputContract.schemaId)?.schema
          }),
          plannedIncomingEdges
        }
      })
    };
  });
}

function runtimeCatalogForWorker(
  config: Extract<PlannerNode["config"], { kind: "prompt.worker" }>,
  capability: ProviderCapability,
  boundModel: string
) {
  if (capability.operation !== "llm" || capability.provenance !== "runtime-discovered") {
    throw new PlanCompilationError(
      "WORKER_RUNTIME_UNAVAILABLE",
      `Worker ${config.profile} requires a runtime-discovered LLM capability.`,
      { providerId: capability.providerId, profileId: capability.profileId }
    );
  }
  const reasoningEfforts = capability.reasoningEfforts ?? [];
  if (!reasoningEfforts.includes(config.reasoningEffort)) {
    throw new PlanCompilationError(
      "WORKER_RUNTIME_UNAVAILABLE",
      `The active model ${boundModel} does not expose reasoning effort ${config.reasoningEffort}.`,
      { modelId: boundModel, reasoningEffort: config.reasoningEffort }
    );
  }
  return {
    profileMappings: config.profile === "custom"
      ? []
      : [{ profile: config.profile, model: boundModel, reasoningEffort: config.reasoningEffort }],
    models: [{ model: boundModel, reasoningEfforts, capability }]
  };
}

function downstreamCapabilities(
  input: CompilePlanInput,
  topology: PlannerTopology,
  sourceNodeId: string,
  steps: ReadonlyMap<string, PlanStep>
) {
  const direct = (topology.outgoing.get(sourceNodeId) ?? []).filter((edge) => edge.to.kind === "node");
  if (direct.length === 0) return null;
  const requiredChannels = [...new Set(direct.map((edge) => edge.to.kind === "node" ? edge.to.channel : "data"))].sort();
  const downstreamSteps = direct.flatMap((edge) => edge.to.kind === "node" ? [steps.get(edge.to.nodeId)] : [])
    .filter((step): step is PlanStep => step !== undefined);
  const bindings = downstreamSteps.map((step) => step.providerBinding).filter((binding): binding is ProviderBinding => binding !== null && binding !== undefined);
  return {
    requiredChannels,
    providerProfileIds: [...new Set(bindings.map((binding) => binding.profileId))].sort(),
    limitations: [...new Set(bindings.flatMap((binding) => binding.capabilitySnapshot.limitations))].sort()
  };
}

function validateNodeConfigurations(topology: PlannerTopology): void {
  for (const node of topology.nodes) {
    const result = node.definition.configSchema.safeParse(node.config);
    if (!result.success) {
      throw new PlanCompilationError(
        "INVALID_NODE_CONFIG",
        `Node ${node.id} has an invalid ${node.definitionId} configuration: ${result.error.message}`,
        { nodeId: node.id, definitionId: node.definitionId }
      );
    }
    if (
      node.config.kind === "prompt.worker" &&
      ((node.config.providerId === undefined) !== (node.config.profileId === undefined))
    ) {
      throw new PlanCompilationError(
        "INVALID_NODE_CONFIG",
        `Worker ${node.id} must select both a provider and profile, or leave both on the document default.`,
        { nodeId: node.id }
      );
    }
    if (node.config.kind === "flow.batch") {
      const allocationIds = new Set<string>();
      for (const allocation of node.config.allocations ?? []) {
        if (allocationIds.has(allocation.id)) {
          throw new PlanCompilationError(
            "INVALID_NODE_CONFIG",
            `Batch ${node.id} contains duplicate allocation id ${allocation.id}.`,
            { allocationId: allocation.id, nodeId: node.id }
          );
        }
        allocationIds.add(allocation.id);
      }
    }
  }
}

function resolveEdges(
  input: CompilePlanInput,
  topology: PlannerTopology,
  selected: ReadonlySet<string>,
  nodeStepIds: ReadonlyMap<string, string>,
  includeResolverAncestors: boolean
): Map<string, EdgeResolution> {
  const result = new Map<string, EdgeResolution>();
  const capabilityIds = adapterCapabilityIds(input);
  for (const edge of topology.edges) {
    if (edge.from.kind !== "node" || edge.to.kind !== "node") continue;
    const source = topology.nodeById.get(edge.from.nodeId);
    const target = topology.nodeById.get(edge.to.nodeId);
    if (source === undefined || target === undefined) {
      throw new PlanCompilationError(
        "INVALID_CONNECTION",
        `Enabled edge ${edge.id} references a missing node.`,
        { edgeId: edge.id }
      );
    }
    const decision = validateConnection({
      sourceDefinitionId: source.definitionId,
      sourceChannel: edge.from.channel,
      targetDefinitionId: target.definitionId,
      targetChannel: edge.to.channel,
      role: edge.role,
      adapter: edge.adapter,
      capabilities: [...capabilityIds]
    });
    if (!decision.allowed) {
      throw new PlanCompilationError(
        decision.code === "PROVIDER_CAPABILITY_UNAVAILABLE"
          ? "PROVIDER_CAPABILITY_UNAVAILABLE"
          : "INVALID_CONNECTION",
        `Edge ${edge.id} cannot be planned: ${decision.code}: ${decision.message}`,
        { edgeId: edge.id, remedies: decision.remedies }
      );
    }
    const adapter = decision.adapter === null
      ? null
      : adapterDefinitions.find((candidate) => candidate.id === decision.adapter!.adapterId) ?? null;
    if (decision.adapter !== null && adapter === null) {
      throw new PlanCompilationError(
        "INVALID_CONNECTION",
        `Edge ${edge.id} resolved to unknown adapter ${decision.adapter.adapterId}.`,
        { edgeId: edge.id, adapterId: decision.adapter.adapterId }
      );
    }
    const sourceStepId = nodeStepIds.get(source.id) ?? null;
    const sourcePayloadIds = resolveSourcePayloadIds(input, edge, source.id, sourceStepId !== null);
    const sourceDependencyStepIds = dependencyStepIdsForNode(
      source.id,
      topology,
      selected,
      nodeStepIds,
      includeResolverAncestors
    );
    const selector = selectorKind(edge);
    const consequence = decision.consequences[0];
    const consequenceObject = (consequence ?? {
      executorInputField: `${edge.to.channel}Input`,
      assemblyStrategy: "ordered-list",
      preservationRule: "preserve-lineage",
      requiredAdapterCapability: adapter?.requiredCapability ?? null,
      failureReason: null
    }) as unknown as JsonObject;
    const adapterStepId = adapter === null ? null : adapterStepIdFor(input.id, edge);
    const targetPayloadIds = adapter === null
      ? sourcePayloadIds
      : sourcePayloadIds.map((payloadId, index) =>
          adapterPayloadId(edge, adapter.adapterId, payloadId, index)
        );
    result.set(edge.id, {
      edge,
      source,
      target,
      adapter,
      consequence: consequenceObject,
      sourcePayloadIds,
      targetPayloadIds,
      sourceBindings: sourcePayloadIds.map((payloadId) => ({
        name: `adapter.input.${edge.from.channel}`,
        payloadId,
        sourceStepId,
        selector
      })),
      targetBindings: targetPayloadIds.map((payloadId) => ({
        name: consequenceObject.executorInputField as string,
        payloadId,
        sourceStepId: adapterStepId ?? sourceStepId,
        selector
      })),
      sourceStepId,
      sourceDependencyStepIds,
      adapterStepId
    });
  }
  return result;
}

function makeAdapterStep(input: {
  input: CompilePlanInput;
  target: PlannerNode;
  edge: EdgeResolution;
  adapter: AdapterDefinition;
}): Omit<PlanStep, "workItemIds"> {
  const providerBinding = input.adapter.semantic
    ? makeProviderBinding(input.input, input.input.capability.providerId, `adapter:${input.adapter.adapterId}`, {
        kind: "adapter",
        adapterId: input.adapter.adapterId,
        fromChannel: input.edge.edge.from.kind === "node" ? input.edge.edge.from.channel : input.adapter.fromChannel,
        toChannel: input.edge.edge.to.kind === "node" ? input.edge.edge.to.channel : input.adapter.toChannel,
        requiredCapability: input.adapter.requiredCapability,
        sourceEdgeId: input.edge.edge.id,
        role: input.edge.edge.role
      })
    : null;
  const provider = providerBinding ?? compatibilityProvider(input.input.capability, {
    kind: "adapter",
    adapterId: input.adapter.adapterId
  });
  const dependencyStepIds = input.edge.sourceDependencyStepIds;
  return {
    id: input.edge.adapterStepId!,
    nodeId: input.target.id,
    subject: { kind: "adapter", adapterId: input.adapter.adapterId },
    executor: input.adapter.semantic ? "codex-evaluation" : "deterministic",
    dependencyStepIds,
    inputPayloadIds: input.edge.sourcePayloadIds,
    resolvedInputBindings: input.edge.sourceBindings,
    compiledPrompt: "",
    compiledContext: jsonObject({
      kind: "adapter",
      adapterId: input.adapter.adapterId,
      sourceEdgeId: input.edge.edge.id,
      sourceNodeId: input.edge.source.id,
      targetNodeId: input.target.id,
      sourceChannel: input.adapter.fromChannel,
      targetChannel: input.adapter.toChannel,
      role: input.edge.edge.role,
      consequence: input.edge.consequence,
      inputBindings: input.edge.sourceBindings
    }),
    parameters: jsonObject({
      adapterId: input.adapter.adapterId,
      fromChannel: input.adapter.fromChannel,
      toChannel: input.adapter.toChannel,
      requiredCapability: input.adapter.requiredCapability,
      semantic: input.adapter.semantic
    }),
    selectors: [input.edge.edge.selector as unknown as JsonObject],
    executorConfig: jsonObject({
      kind: "adapter",
      adapterId: input.adapter.adapterId,
      fromChannel: input.adapter.fromChannel,
      toChannel: input.adapter.toChannel,
      role: input.edge.edge.role,
      consequence: input.edge.consequence
    }),
    provider,
    providerBinding
  };
}

function makeNodeStep(input: {
  input: CompilePlanInput;
  target: PlannerNode;
  incoming: readonly EdgeResolution[];
  variables: ReadonlyMap<string, JsonValue>;
}): Omit<PlanStep, "workItemIds"> {
  const incomingDependencyIds = input.incoming.flatMap((edge) =>
    edge.adapterStepId !== null
      ? [edge.adapterStepId]
      : edge.sourceDependencyStepIds
  );
  const dependencyStepIds = unique(incomingDependencyIds);
  const edgeBindings = input.incoming.flatMap((edge) => edge.targetBindings);
  const bindings = bindEditWorkspaceInputs(input.input, input.target, input.incoming, edgeBindings);
  const workspaceInputPolicy = editWorkspaceInputPolicy(input.input, input.target, input.incoming);
  const providerBinding = nodeProviderBinding(input.input, input.target);
  const provider = providerBinding ?? compatibilityProvider(input.input.capability, input.target.config);
  const resolverInputs = input.incoming
    .filter((edge) => resolverDefinitionIds.has(edge.source.definitionId))
    .map((edge) => jsonObject({
      nodeId: edge.source.id,
      definitionId: edge.source.definitionId,
      config: edge.source.config as unknown as JsonObject,
      edgeId: edge.edge.id,
      role: edge.edge.role,
      sourceChannel: edge.edge.from.kind === "node" ? edge.edge.from.channel : "data",
      targetChannel: edge.edge.to.kind === "node" ? edge.edge.to.channel : "data"
    }));
  const referenceInputs = input.incoming
    .flatMap((edge) => (input.input.referenceInputs ?? []).filter((binding) =>
      binding.edgeId === edge.edge.id &&
      binding.sourceNodeId === edge.source.id &&
      binding.channel === (edge.edge.from.kind === "node" ? edge.edge.from.channel : "data")
    ))
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
  const inputContext = input.incoming.map((edge) => jsonObject({
    edgeId: edge.edge.id,
    sourceNodeId: edge.source.id,
    targetNodeId: edge.target.id,
    sourceChannel: edge.edge.from.kind === "node" ? edge.edge.from.channel : "data",
    targetChannel: edge.edge.to.kind === "node" ? edge.edge.to.channel : "data",
    role: edge.edge.role,
    sourceStepId: edge.sourceStepId,
    selector: edge.edge.selector as unknown as JsonObject,
    adapterId: edge.adapter?.adapterId ?? null,
    sourcePayloadIds: edge.sourcePayloadIds,
    targetPayloadIds: edge.targetPayloadIds,
    consequence: edge.consequence
  }));
  const interpolatedConfig = interpolatedNodeConfig(input.target.config, input.variables);
  const parameters = normalizedNodeParameters(interpolatedConfig, providerBinding);
  const joinConfig = input.target.config.kind === "flow.join"
    ? {
        expectedSourceEdgeIds: input.incoming.map((edge) => edge.edge.id).sort(),
        strategy: input.target.config.strategy,
        requireComplete: input.target.config.requireComplete
      }
    : undefined;
  return {
    id: nodeStepId(input.input.id, input.target.id),
    nodeId: input.target.id,
    subject: { kind: "node", nodeId: input.target.id },
    executor: input.target.definition.executor,
    dependencyStepIds,
    inputPayloadIds: unique(bindings.map((binding) => binding.payloadId)),
    resolvedInputBindings: bindings,
    compiledPrompt: compilePrompt({ ...input.target, config: interpolatedConfig } as PlannerNode, input.incoming, input.variables),
    compiledContext: jsonObject({
      nodeId: input.target.id,
      definitionId: input.target.definitionId,
      inputBindings: inputContext,
      referenceInputs: referenceInputs as unknown as JsonObject[],
      resolverInputs,
      sourceEdgeIds: input.incoming.map((edge) => edge.edge.id),
      promptSections: compilePromptSections({ ...input.target, config: interpolatedConfig } as PlannerNode, input.incoming, input.variables),
      selectedDependencies: dependencyStepIds,
      ...(joinConfig === undefined ? {} : { join: joinConfig }),
      ...(workspaceInputPolicy === undefined ? {} : { workspaceInputPolicy })
    }),
    parameters,
    selectors: input.incoming.map((edge) => edge.edge.selector as unknown as JsonObject),
    executorConfig: jsonObject({ ...parameters, ...(joinConfig === undefined ? {} : { join: joinConfig }) }),
    provider,
    providerBinding
  };
}

function bindEditWorkspaceInputs(
  input: CompilePlanInput,
  target: PlannerNode,
  incoming: readonly EdgeResolution[],
  bindings: NonNullable<PlanStep["resolvedInputBindings"]>
): NonNullable<PlanStep["resolvedInputBindings"]> {
  if (target.config.kind !== "edit.image" || target.config.workspace === undefined) return bindings;
  const payloads = input.payloads ?? [];
  const byId = new Map(payloads.map((payload) => [payload.id, payload]));
  const artifactPayload = (artifactId: string, channel: "image" | "mask") => payloads.find((payload) =>
    payload.channel === channel && payload.content.kind === "artifact" && payload.content.artifactId === artifactId
  );
  const source = artifactPayload(target.config.workspace.sourceArtifactId, "image");
  if (source === undefined) {
    throw new PlanCompilationError(
      "EDIT_WORKSPACE_ARTIFACT_NOT_FOUND",
      `Workspace source artifact ${target.config.workspace.sourceArtifactId} has no persisted Image payload.`,
      { nodeId: target.id, artifactId: target.config.workspace.sourceArtifactId }
    );
  }
  const connectedImageIds = new Set(incoming.flatMap((edge) =>
    edge.edge.to.kind === "node" && edge.edge.to.channel === "image" ? edge.targetPayloadIds : []
  ));
  if (!connectedImageIds.has(source.id)) {
    throw new PlanCompilationError(
      "EDIT_SOURCE_NOT_ON_IMAGE_LANE",
      "The workspace-selected source is not the artifact resolved by an incoming Image lane selector.",
      { nodeId: target.id, artifactId: target.config.workspace.sourceArtifactId, payloadId: source.id }
    );
  }
  const sourceBinding = bindings.find((binding) => binding.payloadId === source.id);
  const result: NonNullable<PlanStep["resolvedInputBindings"]> = [{
    name: "workspace.sourceImage",
    payloadId: source.id,
    sourceStepId: sourceBinding?.sourceStepId ?? null,
    selector: sourceBinding?.selector ?? "pinned"
  }];
  const maskArtifactId = target.config.workspace.maskArtifactId;
  if (maskArtifactId !== undefined) {
    const mask = artifactPayload(maskArtifactId, "mask");
    if (mask === undefined) {
      throw new PlanCompilationError(
        "EDIT_WORKSPACE_ARTIFACT_NOT_FOUND",
        `Workspace mask artifact ${maskArtifactId} has no persisted Mask payload.`,
        { nodeId: target.id, artifactId: maskArtifactId }
      );
    }
    const maskBinding = bindings.find((binding) => binding.payloadId === mask.id);
    result.push({
      name: "workspace.mask",
      payloadId: mask.id,
      sourceStepId: maskBinding?.sourceStepId ?? null,
      selector: maskBinding?.selector ?? "pinned"
    });
  }
  for (const binding of bindings) {
    if (result.some((candidate) => candidate.payloadId === binding.payloadId)) continue;
    const payload = byId.get(binding.payloadId);
    if (payload?.channel === "image") continue;
    if (maskArtifactId !== undefined && payload?.channel === "mask") continue;
    result.push(binding);
  }
  return result;
}

function editWorkspaceInputPolicy(
  input: CompilePlanInput,
  target: PlannerNode,
  incoming: readonly EdgeResolution[]
): "workspace-mask-overrides-connected" | undefined {
  if (target.config.kind !== "edit.image") return undefined;
  const maskArtifactId = target.config.workspace?.maskArtifactId;
  if (maskArtifactId === undefined) return undefined;
  const savedMask = input.payloads?.find((payload) =>
    payload.channel === "mask" &&
    payload.content.kind === "artifact" &&
    payload.content.artifactId === maskArtifactId
  );
  if (savedMask === undefined) return undefined;
  return incoming.some((edge) =>
    edge.edge.to.kind === "node" &&
    edge.edge.to.channel === "mask" &&
    edge.targetPayloadIds.some((payloadId) => payloadId !== savedMask.id)
  ) ? "workspace-mask-overrides-connected" : undefined;
}

function allocationBindingsFor(
  input: CompilePlanInput,
  target: PlannerNode,
  allocations: readonly BatchProviderAllocation[]
): StepDraft["allocations"] {
  const selected = allocations.filter((allocation) => allocation.targetNodeId === target.id);
  if (selected.length === 0) return [];
  if (target.config.kind !== "prompt.worker" && target.config.kind !== "generation.image") {
    throw new PlanCompilationError(
      "INVALID_NODE_CONFIG",
      `Batch provider/model allocations can target only Worker or Image Generator nodes, not ${target.definitionId}.`,
      { nodeId: target.id }
    );
  }
  return selected.map((allocation) => {
    const binding = makeProviderBinding(
      input,
      allocation.providerId,
      allocation.modelId,
      jsonObject({
        allocationId: allocation.id,
        targetNodeId: allocation.targetNodeId
      }),
      allocation.profileId,
      target.config.kind === "generation.image" ? ["generate-image"] : ["llm", "interpret"]
    );
    if (target.config.kind === "generation.image") {
      assertGenerationAllocationCompatible(target, binding);
    }
    return { id: allocation.id, count: allocation.count, binding };
  });
}

function assertGenerationAllocationCompatible(
  target: PlannerNode,
  binding: ProviderBinding
): void {
  if (target.config.kind !== "generation.image") return;
  const capability = binding.capabilitySnapshot;
  const config = target.config;
  const outputFormat = config.outputFormat ?? "image/png";
  const supportsAspectRatio = capability.aspectRatios.length === 0 ||
    capability.aspectRatios.includes(config.aspectRatio);
  const supportsResolution = capability.resolutions.length === 0 ||
    capability.resolutions.some((resolution) =>
      resolution.width === config.resolution.width &&
      resolution.height === config.resolution.height
    );
  const supportsOutputFormat = capability.outputFormats === undefined ||
    capability.outputFormats.includes(outputFormat);
  if (
    !supportsAspectRatio ||
    !supportsResolution ||
    !supportsOutputFormat ||
    capability.maxOutputsPerCall < config.outputCount
  ) {
    throw new PlanCompilationError(
      "PROVIDER_CAPABILITY_UNAVAILABLE",
      `Batch allocation ${binding.providerId}/${binding.profileId} is incompatible with the Image Generator ratio, resolution, output format, or output count.`,
      {
        nodeId: target.id,
        providerId: binding.providerId,
        profileId: binding.profileId,
        outputFormat,
        outputCount: config.outputCount
      }
    );
  }
}

function materializeWorkItems(drafts: readonly StepDraft[]): {
  items: PlannedWorkItem[];
  byStep: Map<string, InternalWorkItem[]>;
} {
  const byStep = new Map<string, InternalWorkItem[]>();
  for (const draft of drafts) {
    const allocatedCount = draft.allocations.reduce((total, allocation) => total + allocation.count, 0);
    if (allocatedCount > draft.expansion.items.length) {
      throw new PlanCompilationError(
        "INVALID_NODE_CONFIG",
        `Provider/model allocations for ${draft.step.nodeId} assign ${allocatedCount} items, but the batch has only ${draft.expansion.items.length}.`,
        { allocatedCount, nodeId: draft.step.nodeId, workItemCount: draft.expansion.items.length }
      );
    }
    const items = draft.expansion.items.map((item) => ({
      id: item.id,
      stepId: draft.step.id,
      ordinal: item.ordinal,
      inputs: (draft.step.resolvedInputBindings ?? []).map((binding) => ({
        name: binding.name,
        payloadId: binding.payloadId
      })),
      parameters: [
        ...item.parameters,
        ...Object.entries(draft.step.parameters).map(([name, value]) => ({
          name,
          value: value as JsonValue
        }))
      ],
      dependencyWorkItemIds: [],
      ...providerBindingOverrideFor(item.ordinal, draft.allocations),
      values: item.values
    }));
    byStep.set(draft.step.id, items);
  }

  for (const draft of drafts) {
    const items = byStep.get(draft.step.id) ?? [];
    for (const item of items) {
      const dependencies = new Set<string>();
      for (const dependencyStepId of draft.step.dependencyStepIds) {
        const parentItems = byStep.get(dependencyStepId) ?? [];
        const matches = parentItems.filter((parent) => assignmentIncludes(item.values, parent.values));
        for (const parent of (matches.length > 0 ? matches : parentItems)) dependencies.add(parent.id);
      }
      item.dependencyWorkItemIds = [...dependencies].sort();
    }
  }
  // Keep the map construction explicit so adding another draft family cannot
  // accidentally omit a step from the flattened durable work-item list.
  const flattened = drafts
    .flatMap((draft) => byStep.get(draft.step.id) ?? [])
    .map(({ values: _values, ...item }) => item);
  return { items: flattened, byStep };
}

function providerBindingOverrideFor(
  ordinal: number,
  allocations: StepDraft["allocations"]
): { providerBindingOverride?: ProviderBinding } {
  let start = 0;
  for (const allocation of allocations) {
    const end = start + allocation.count;
    if (ordinal >= start && ordinal < end) {
      return { providerBindingOverride: allocation.binding };
    }
    start = end;
  }
  return {};
}

function assignmentIncludes(child: JsonObject, parent: JsonObject): boolean {
  const parentEntries = Object.entries(parent);
  if (parentEntries.length === 0) return true;
  return parentEntries.every(
    ([key, value]) => Object.hasOwn(child, key) && JSON.stringify(child[key]) === JSON.stringify(value)
  );
}

function batchContextForNode(
  nodeId: string,
  batchNodes: readonly PlannerNode[],
  topology: PlannerTopology,
  input: CompilePlanInput
): BatchPlanContext {
  const dimensions: BatchPlanContext["dimensions"] = [];
  const exclusions: BatchExclusion[] = [...(input.batchExclusions ?? [])];
  const allocations: BatchProviderAllocation[] = [];
  let requestedParallelism: number | undefined = input.requestedParallelism;
  const seenDimensionIds = new Set<string>();
  for (const batchNode of batchNodes) {
    if (batchNode.id === nodeId || !canReach(topology, batchNode.id, nodeId)) continue;
    if (batchNode.config.kind !== "flow.batch") continue;
    requestedParallelism = Math.max(
      requestedParallelism ?? 1,
      batchNode.config.parallelism
    );
    for (const dimension of batchNode.config.dimensions) {
      if (seenDimensionIds.has(dimension.id)) {
        throw new PlanCompilationError(
          "INVALID_NODE_CONFIG",
          `Batch dimension ${dimension.id} is provided by more than one upstream batch node.`,
          { nodeId: batchNode.id, dimensionId: dimension.id }
        );
      }
      seenDimensionIds.add(dimension.id);
      dimensions.push(dimension);
    }
    exclusions.push(...(batchNode.config.exclusions ?? []));
    exclusions.push(...(input.batchExclusionsByNode?.[batchNode.id] ?? []));
    allocations.push(...(batchNode.config.allocations ?? []));
  }
  if (dimensions.length === 0 && input.batchDimensions !== undefined) {
    for (const dimension of input.batchDimensions) {
      if (seenDimensionIds.has(dimension.id)) {
        throw new PlanCompilationError(
          "INVALID_NODE_CONFIG",
          `Batch dimension ${dimension.id} is declared more than once.`,
          { dimensionId: dimension.id }
        );
      }
      seenDimensionIds.add(dimension.id);
      dimensions.push(dimension);
    }
  }
  return { allocations, dimensions, exclusions, requestedParallelism };
}

function expandForStep(
  stepId: string,
  context: BatchPlanContext,
  input: CompilePlanInput
): BatchExpansionResult {
  try {
    return expandBatch({
      dimensions: context.dimensions ?? [],
      exclusions: context.exclusions,
      cap: input.batchCap,
      stepId,
      requestedParallelism: context.requestedParallelism
    });
  } catch (error) {
    if (error instanceof BatchExpansionError) throw error;
    throw new PlanCompilationError(
      "INVALID_PLAN",
      `Batch expansion for ${stepId} failed: ${errorMessage(error)}`,
      { stepId },
      { cause: error }
    );
  }
}

function canReach(topology: PlannerTopology, sourceId: string, targetId: string): boolean {
  const seen = new Set<string>();
  const visit = (nodeId: string): boolean => {
    if (nodeId === targetId) return true;
    if (seen.has(nodeId)) return false;
    seen.add(nodeId);
    return (topology.outgoing.get(nodeId) ?? []).some((edge) =>
      edge.to.kind === "node" && visit(edge.to.nodeId)
    );
  };
  return visit(sourceId);
}

function dependencyStepIdsForNode(
  nodeId: string,
  topology: PlannerTopology,
  selected: ReadonlySet<string>,
  nodeStepIds: ReadonlyMap<string, string>,
  includeResolverAncestors: boolean
): string[] {
  const dependencies = new Set<string>();
  const visited = new Set<string>();
  const visit = (currentNodeId: string): void => {
    if (visited.has(currentNodeId)) return;
    visited.add(currentNodeId);
    const current = topology.nodeById.get(currentNodeId);
    if (current === undefined) return;
    const stepId = nodeStepIds.get(currentNodeId);
    if (stepId !== undefined) {
      dependencies.add(stepId);
      return;
    }
    // A runnable node outside the selected scope is a cached input boundary;
    // do not pull its own ancestors into this plan through a resolver node.
    if (selected.has(currentNodeId) || (includeResolverAncestors && !isPlanStepNode(current))) {
      for (const edge of topology.incoming.get(currentNodeId) ?? []) {
        if (edge.from.kind === "node") visit(edge.from.nodeId);
      }
    }
  };
  visit(nodeId);
  return [...dependencies].sort();
}

function nodeProviderBinding(input: CompilePlanInput, node: PlannerNode): ProviderBinding | null {
  const config = node.config;
  switch (config.kind) {
    case "prompt.worker": {
      const operations = ["llm", "interpret"] as const;
      if (config.providerId !== undefined || config.profileId !== undefined) {
        return makeProviderBinding(
          input,
          config.providerId ?? input.capability.providerId,
          config.model,
          config,
          config.profileId,
          operations
        );
      }
      const capabilities = [...(input.providerCapabilities ?? []), input.capability]
        .filter((capability) => operations.includes(capability.operation as "llm" | "interpret"));
      const active = capabilities.find((capability) => capability.modelId === config.model) ?? capabilities[0];
      if (active === undefined) {
        return makeProviderBinding(input, input.capability.providerId, config.model, config, undefined, operations);
      }
      return makeProviderBinding(
        input,
        active.providerId,
        active.modelId ?? config.model,
        config,
        active.profileId,
        operations
      );
    }
    case "generation.image": {
      const selection = resolveImageProviderAlias(config.providerId, config.profileId);
      return makeProviderBinding(input, selection.providerId, undefined, config, config.profileId, ["generate-image"]);
    }
    case "edit.image": {
      if (config.workspace?.capability.mode === "unsupported") {
        throw new PlanCompilationError(
          "EDIT_CAPABILITY_UNSUPPORTED",
          config.workspace.capability.detail ?? "The selected provider profile cannot execute image edits.",
          { providerId: config.providerId, profileId: config.profileId }
        );
      }
      const selection = resolveImageProviderAlias(config.providerId, config.profileId);
      const binding = makeProviderBinding(input, selection.providerId, undefined, config, config.profileId, ["edit-image"]);
      const capability = binding.capabilitySnapshot;
      if (capability.operation !== "edit-image" || !capability.inputChannels.includes("image") || !capability.outputChannels.includes("image")) {
        throw new PlanCompilationError(
          "EDIT_CAPABILITY_UNSUPPORTED",
          `Provider profile ${config.providerId}/${config.profileId} does not expose a verified image-edit capability.`,
          { providerId: config.providerId, profileId: config.profileId, operation: capability.operation }
        );
      }
      if (config.workspace !== undefined && !capability.inputChannels.includes("mask")) {
        throw new PlanCompilationError(
          "EDIT_MASK_UNSUPPORTED",
          `Provider profile ${config.providerId}/${config.profileId} cannot consume the committed mask.`,
          { providerId: config.providerId, profileId: config.profileId }
        );
      }
      return binding;
    }
    case "review.evaluate":
      return makeEvaluationProviderBinding(input, config);
    case "edit.mask":
      if (config.mode === "provider") {
        throw new PlanCompilationError(
          "LOCAL_MEDIA_PROVIDER_MODE_UNSUPPORTED",
          "Provider mask mode is not available for the canonical deterministic Mask executor. Choose local or manual mode.",
          { nodeId: node.id }
        );
      }
      // Canonical local/manual masks are rendered from staged image/mask inputs
      // and persisted workspace geometry; no remote provider route is selected.
      return null;
    default:
      return null;
  }
}

function normalizedNodeParameters(
  config: PlannerNode["config"],
  binding: ProviderBinding | null
): JsonObject {
  const parameters = { ...(config as unknown as Record<string, JsonValue>) };
  if (
    (config.kind === "generation.image" || config.kind === "edit.image") &&
    binding !== null
  ) {
    parameters.providerId = binding.providerId;
    parameters.profileId = binding.profileId;
  }
  if (config.kind === "generation.image" && binding !== null) {
    const outputFormats = binding.capabilitySnapshot.outputFormats;
    const configured = config.outputFormat ?? "image/png";
    if (outputFormats?.length && !outputFormats.includes(configured)) {
      parameters.outputFormat = outputFormats[0]!;
    }
  }
  return jsonObject(parameters);
}

function makeProviderBinding(
  input: CompilePlanInput,
  providerId: string,
  requestedModelId: string | undefined,
  settings: unknown,
  requestedProfileId?: string,
  requiredOperations: readonly ProviderCapability["operation"][] = []
): ProviderBinding {
  const capabilities = [...(input.providerCapabilities ?? []), input.capability];
  const capability = capabilities.find((candidate) =>
    candidate.providerId === providerId &&
    (requestedProfileId === undefined || candidate.profileId === requestedProfileId) &&
    (requiredOperations.length === 0 || requiredOperations.includes(candidate.operation))
  );
  if (capability === undefined) {
    const operationDetail = requiredOperations.length === 0
      ? ""
      : ` for operation ${requiredOperations.join(" or ")}`;
    throw new PlanCompilationError(
      "PROVIDER_CAPABILITY_UNAVAILABLE",
      `No provider capability snapshot is available for ${providerId}${requestedProfileId === undefined ? "" : `/${requestedProfileId}`}${operationDetail}.`,
      { providerId, profileId: requestedProfileId, requiredOperations }
    );
  }
  if (
    requestedModelId !== undefined &&
    capability.modelId !== undefined &&
    requestedModelId !== capability.modelId
  ) {
    throw new PlanCompilationError(
      "PROVIDER_CAPABILITY_UNAVAILABLE",
      `Model ${requestedModelId} is not the verified model for ${providerId}/${capability.profileId}.`,
      {
        providerId,
        profileId: capability.profileId,
        requestedModelId,
        verifiedModelId: capability.modelId
      }
    );
  }
  return {
    providerId,
    profileId: requestedProfileId ?? capability.profileId,
    modelId: capability.modelId ?? requestedModelId ?? capability.profileId,
    settings: settings as JsonObject,
    capabilitySnapshot: capability
  };
}

function makeEvaluationProviderBinding(
  input: CompilePlanInput,
  config: Extract<PlannerNode["config"], { kind: "review.evaluate" }>
): ProviderBinding {
  const capabilities = [...(input.providerCapabilities ?? []), input.capability];
  const evaluation = capabilities.find((capability) =>
    capability.operation === "evaluate" &&
    capability.outputChannels.includes("data") &&
    (capability.modelId === undefined || capability.modelId === config.model)
  );
  if (evaluation === undefined) {
    throw new PlanCompilationError(
      "PROVIDER_CAPABILITY_UNAVAILABLE",
      "Review Evaluate requires a verified evaluation capability, not a generic Worker/LLM capability.",
      { modelId: config.model, requiredOperation: "evaluate" }
    );
  }
  return makeProviderBinding(input, evaluation.providerId, config.model, config, evaluation.profileId, ["evaluate"]);
}

function compatibilityProvider(capability: ProviderCapability, settings: unknown): PlanStep["provider"] {
  return {
    providerId: capability.providerId,
    profileId: capability.profileId,
    modelId: "local-v1",
    settings: settings as JsonObject,
    capabilitySnapshot: capability
  };
}

function resolveSourcePayloadIds(
  input: CompilePlanInput,
  edge: EtherEdge,
  sourceNodeId: string,
  sourceWillRun: boolean
): string[] {
  if (sourceWillRun) return [logicalPayloadId(edge)];
  const hasOutputContext = input.outputVersions?.some((version) => version.nodeId === sourceNodeId) ?? false;
  if (hasOutputContext) {
    const result = resolveOutputSelector({
      selector: edge.selector,
      nodeId: sourceNodeId,
      channel: edge.from.kind === "node" ? edge.from.channel : "data",
      versions: input.outputVersions ?? [],
      payloads: input.payloads ?? []
    });
    if (result.diagnostics.length > 0) {
      const diagnostic = result.diagnostics[0]!;
      throw new PlanCompilationError(
        "OUTPUT_SELECTOR_INVALID",
        `Edge ${edge.id} has an invalid output selector: ${diagnostic.message}`,
        { edgeId: edge.id, diagnostic: diagnostic.code }
      );
    }
    const payloadIds = result.versionIds.flatMap((versionId) => {
      const version = input.outputVersions?.find((candidate) => candidate.id === versionId);
      return version?.outputPayloadIds.filter((payloadId) => {
        const payload = input.payloads?.find((candidate) => candidate.id === payloadId);
        return payload === undefined || payload.channel === edge.from.channel;
      }) ?? [];
    });
    if (payloadIds.length > 0) return unique(payloadIds);
  }
  return [logicalPayloadId(edge)];
}

function adapterCapabilityIds(input: CompilePlanInput): Set<string> {
  const result = new Set(input.capabilities ?? []);
  const capability = input.capability;
  if (capability.operation === "transcribe") result.add("native.transcription");
  if (capability.operation === "interpret") {
    if (capability.inputChannels.includes("image")) result.add("codex.vision");
    if (capability.inputChannels.includes("audio")) result.add("codex.audio");
    if (capability.inputChannels.includes("video")) result.add("codex.video");
  }
  return result;
}

function compilePrompt(
  target: PlannerNode,
  incoming: readonly EdgeResolution[],
  variables: ReadonlyMap<string, JsonValue>
): string {
  const instruction = target.config.kind === "prompt.worker" || target.config.kind === "review.evaluate"
    ? interpolateText(target.config.instruction, variables)
    : "";
  const sections = compilePromptSections(target, incoming, variables);
  return [instruction, ...sections].filter((section) => section.length > 0).join("\n\n");
}

function variablesForTarget(
  topology: PlannerTopology,
  targetNodeId: string
): ReadonlyMap<string, JsonValue> {
  const visited = new Set<string>();
  const stack = [targetNodeId];
  const definitions = [];
  while (stack.length > 0) {
    const nodeId = stack.pop()!;
    if (visited.has(nodeId)) continue;
    visited.add(nodeId);
    const node = topology.nodeById.get(nodeId);
    if (node?.config.kind === "flow.variables") definitions.push(...node.config.variables);
    for (const edge of topology.incoming.get(nodeId) ?? []) {
      if (edge.from.kind === "node") stack.push(edge.from.nodeId);
    }
  }
  try {
    return variableMap(definitions);
  } catch (error) {
    throw new PlanCompilationError(
      "VARIABLE_INTERPOLATION_INVALID",
      error instanceof Error ? error.message : "Variable definitions are invalid.",
      { targetNodeId, cause: error instanceof Error ? error.name : String(error) }
    );
  }
}

function compilePromptSections(
  _target: PlannerNode,
  incoming: readonly EdgeResolution[],
  variables: ReadonlyMap<string, JsonValue>
): string[] {
  return incoming.flatMap((edge) => {
    const value = staticNodeText(edge.source, variables);
    if (value === null || value.length === 0) return [];
    return [`${roleLabel(edge.edge.role)}: ${value}`];
  });
}

function staticNodeText(node: PlannerNode, variables: ReadonlyMap<string, JsonValue>): string | null {
  switch (node.config.kind) {
    case "prompt.text":
      return interpolateText(node.config.body, variables);
    case "canvas.note":
      return interpolateText(node.config.body, variables);
    case "flow.variables":
      return node.config.variables
        .map((variable) => `${variable.name}=${renderVariableValue(variable.value)}`)
        .join("\n");
    case "reference.set": {
      const members = node.config.members ?? [];
      const artifactIds = [
        ...(node.config.artifactIds ?? []),
        ...members.flatMap((member) => member.kind === "embedded-artifact" ? [member.artifactId] : [])
      ];
      return artifactIds.length === 0 ? null : `References: ${artifactIds.join(", ")}`;
    }
    case "flow.batch":
      return node.config.dimensions
        .map((dimension) => `${dimension.name}: ${dimension.values.map(jsonText).join(", ")}`)
        .join("\n");
    default:
      return null;
  }
}

function interpolateText(text: string, variables: ReadonlyMap<string, JsonValue>): string {
  try {
    return interpolateVariables(text, variables);
  } catch (error) {
    throw new PlanCompilationError(
      "VARIABLE_INTERPOLATION_INVALID",
      error instanceof Error ? error.message : "Variable interpolation failed.",
      { cause: error instanceof Error ? error.name : String(error) }
    );
  }
}

function interpolatedNodeConfig(
  config: PlannerNode["config"],
  variables: ReadonlyMap<string, JsonValue>
): PlannerNode["config"] {
  switch (config.kind) {
    case "prompt.text": return { ...config, body: interpolateText(config.body, variables) };
    case "prompt.worker": return { ...config, instruction: interpolateText(config.instruction, variables) };
    case "review.evaluate": return { ...config, instruction: interpolateText(config.instruction, variables) };
    case "canvas.note": return { ...config, body: interpolateText(config.body, variables) };
    default: return config;
  }
}

function planScope(scope: PlannerExecutionScope, resolution: ScopeResolution): ExecutionScope {
  if (scope.kind !== "refresh-upstream") return scope;
  const fallbackNodeId = scope.nodeId ?? scope.targetNodeId!;
  return resolution.nodeIds.length > 0
    ? { kind: "selected", nodeIds: resolution.nodeIds }
    : { kind: "node", nodeId: fallbackNodeId };
}

function nodeStepId(planId: string, nodeId: string): string {
  return `step-${digest(planId)}-${nodeId}`;
}

function adapterStepIdFor(planId: string, edge: EtherEdge): string {
  return `step-${digest(planId)}-adapter-${edge.id}`;
}

function logicalPayloadId(edge: EtherEdge): string {
  return `payload-${digest(`${edge.id}:${selectorKind(edge)}`)}`;
}

function adapterPayloadId(
  edge: EtherEdge,
  adapterId: string,
  sourcePayloadId: string,
  ordinal: number
): string {
  return `payload-adapter-${digest(`${edge.id}:${adapterId}:${sourcePayloadId}:${ordinal}`)}`;
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

function selectorKind(edge: EtherEdge): "latest-approved" | "latest" | "all" | "pinned" {
  return edge.selector.kind;
}

function roleLabel(role: ConnectionRole): string {
  const labels: Partial<Record<ConnectionRole, string>> = {
    colourPalette: "Colour Palette",
    general: "General"
  };
  return labels[role] ?? `${role[0]!.toUpperCase()}${role.slice(1)}`;
}

function jsonObject(value: Record<string, unknown>): JsonObject {
  return value as JsonObject;
}

function jsonText(value: JsonValue): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function uniqueCapabilities(capabilities: readonly ProviderCapability[]): ProviderCapability[] {
  const seen = new Set<string>();
  return capabilities.filter((capability) => {
    const key = `${capability.providerId}:${capability.profileId}:${capability.operation}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function edgeOrder(left: EtherEdge, right: EtherEdge): number {
  return left.order - right.order || left.id.localeCompare(right.id);
}

function errorCode(error: unknown): PlanCompilationErrorCode {
  if (error instanceof Error && "code" in error) {
    const code = String((error as Error & { code?: unknown }).code);
    if (
      code === "INVALID_GRAPH" ||
      code === "UNKNOWN_SCOPE_NODE" ||
      code === "INVALID_SCOPE" ||
      code === "GRAPH_CYCLE"
    ) return code;
  }
  return "INVALID_GRAPH";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
