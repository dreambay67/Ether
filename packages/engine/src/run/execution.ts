import {
  CodexCliAssistantProvider,
  CodexCliVisionEvaluationProvider,
  CODEX_PROVIDER_ID,
  FAKE_PROVIDER_ID,
  ProviderUnavailableError,
  createDefaultProviderRegistry,
  diagnoseProviderRegistry,
  type AssistantProviderInput,
  type GeneratedArtifact,
  type CodexCliImageProviderOptions,
  type ImageEditFrameInput,
  type GenerationProviderInput,
  type GenerationReferenceInput,
  type ImageEditMaskInput,
  type ImageEditOperation,
  type ImageEditProviderInput,
  type ImageEditRecipeInput,
  type ImageEditSourceInput,
  type ProviderDescriptor,
  type ProviderDiagnostic,
  type ProviderProcessRunner,
  type ProviderRegistryDiagnostics,
  type ProviderAssistantResult,
  type ProviderGenerationResult,
  type PayloadEnvelope,
  type VisionEvaluationImageInput,
  type VisionEvaluationItemResult,
  type VisionEvaluationProviderInput,
  type VisionEvaluationProviderResult
} from "@ether/providers";
import { randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { copyFile, mkdir, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { addArtifactToCollection, createArtifact } from "../artifacts/artifactStore.js";
import type { ArtifactKind } from "../artifacts/types.js";
import {
  ensureCollectionFolder,
  ensureDirectoryRoot,
  listAssets,
  moveAssetToCollection,
  saveGeneratedAsset,
  updateAssetMetadata,
  type AssetRecord
} from "../project/assets.js";
import { initializeDatabase } from "../project/database.js";
import { projectPaths } from "../project/paths.js";
import { openDatabase, runInTransaction } from "../project/sqlite.js";
import { completeProviderRun, createProviderRun, failProviderRun } from "../project/providerRuns.js";
import type { EtherGraph } from "../project/schema.js";
import {
  assembleGenerationInputs,
  assemblePromptForNode,
  freezePromptNode,
  resolveReferenceRole
} from "../graph/promptAssembly.js";
import { blockedIncomingAdapterReason } from "../graph/adapterBlocks.js";
import {
  referenceAssetsFromNodeData,
  type CanvasNodeData,
  type ReferenceAssetEntry
} from "../graph/nodeCatalog.js";
import { normalizePayloadChannel, type PayloadChannel } from "../graph/channels.js";
import type { EdgeRoleArtifact, PromptSectionArtifact } from "../graph/artifacts.js";
import { textForNode } from "../graph/textMutation.js";

export type ExecutionPolicy =
  | "cached-inputs"
  | "refresh-upstream"
  | "downstream"
  | "branch"
  | "selected";

export type ExecutionRequest = {
  policy: ExecutionPolicy;
  targetNodeIds: string[];
  runCountCap?: number;
  parallel?: boolean;
  providerId?: string;
  imageCodexCliPath?: string;
  imageProviderFileExists?: CodexCliImageProviderOptions["fileExists"];
  imageProviderRunner?: ProviderProcessRunner;
  assistantCodexCliPath?: string;
  assistantProviderFileExists?: CodexCliImageProviderOptions["fileExists"];
  assistantProviderRunner?: ProviderProcessRunner;
  evaluationSimulationMode?: boolean;
  evaluationCodexCliPath?: string;
  evaluationProviderFileExists?: CodexCliImageProviderOptions["fileExists"];
  evaluationProviderRunner?: ProviderProcessRunner;
  now?: () => Date;
};

export type ExecutionQueueItem = {
  nodeId: string;
  iteration: number;
};

export type ExecutionQueueDependencies = Map<string, string[]> | Record<string, string[]>;

export type ExecutionPlan = {
  policy: ExecutionPolicy;
  targetNodeIds: string[];
  nodeIds: string[];
  items: ExecutionQueueItem[];
  parallel: boolean;
  runCountCap?: number;
};

export type ExecutionResultStatus = "complete" | "skipped" | "error";

export type ExecutionNodeResult = {
  nodeId: string;
  iteration: number;
  status: ExecutionResultStatus;
  action: string;
  reason?: string;
  assetId?: string;
  assetPath?: string;
  metadata?: Record<string, unknown>;
  startedAt: string;
  finishedAt: string;
};

export type ExecutionRunResult = {
  graph: EtherGraph;
  plan: ExecutionPlan;
  results: ExecutionNodeResult[];
};

export type RunRecord = {
  id: string;
  status: string;
  graphNodeId: string | null;
  metadata: Record<string, unknown>;
  startedAt: string;
  finishedAt: string | null;
};

type GraphNode = EtherGraph["nodes"][number] & {
  id: string;
  data?: Partial<CanvasNodeData>;
};

type GraphEdge = EtherGraph["edges"][number] & {
  id: string;
  source: string;
  target: string;
  label?: unknown;
  data?: { label?: unknown };
};

type RunRecordRow = {
  id: string;
  status: string;
  graph_node_id: string | null;
  metadata_json: string;
  started_at: string;
  finished_at: string | null;
};

const PROMPT_ASSISTANT_SUBTYPES = new Set(["Brainstormer", "Mutator", "Expander", "Reinforcer"]);
const DEFAULT_GENERATION_ASPECT_RATIO = "1:1";
const DEFAULT_GENERATION_RESOLUTION = "1024-long-edge";
const GENERATION_ASPECT_RATIOS: Record<string, readonly [number, number]> = {
  "1:1": [1, 1],
  "4:5": [4, 5],
  "3:4": [3, 4],
  "9:16": [9, 16],
  "16:9": [16, 9],
  "4:3": [4, 3],
  "3:2": [3, 2],
  "2:3": [2, 3]
};
const GENERATION_RESOLUTION_LONG_EDGE: Record<string, number> = {
  "1024-long-edge": 1024,
  "1536-long-edge": 1536,
  "2048-long-edge": 2048
};

export type ExecutionWorkerState = {
  graph: EtherGraph;
};

export async function getGenerationProviderDiagnostics(): Promise<ProviderRegistryDiagnostics> {
  return diagnoseProviderRegistry(createDefaultProviderRegistry());
}

export function planExecution(graph: EtherGraph, request: ExecutionRequest): ExecutionPlan {
  const nodeIds = planNodeIds(graph, request);

  return {
    policy: request.policy,
    targetNodeIds: orderedExistingIds(graph, request.targetNodeIds),
    nodeIds,
    items: createQueueItems(graph, nodeIds, request.runCountCap),
    parallel: request.parallel === true,
    ...(typeof request.runCountCap === "number" ? { runCountCap: request.runCountCap } : {})
  };
}

export async function runExecutionQueue<T>(
  items: ExecutionQueueItem[],
  runner: (item: ExecutionQueueItem) => Promise<T>,
  options: { parallel?: boolean; dependencies?: ExecutionQueueDependencies } = {}
): Promise<T[]> {
  if (options.parallel) {
    const results = new Array<T>(items.length);
    const groups = groupQueueItems(items);
    const dependencies = normalizeQueueDependencies(options.dependencies, groups);
    assertQueueDependenciesRunnable(dependencies, groups);
    const completed = new Set<string>();
    const pending = new Set(groups.keys());

    while (pending.size > 0) {
      const readyGroupIds = [...pending].filter((nodeId) =>
        (dependencies.get(nodeId) ?? []).every((dependencyId) => completed.has(dependencyId))
      );

      if (readyGroupIds.length === 0) {
        throw new Error("Execution queue has cyclic or unsatisfied dependencies");
      }

      await Promise.all(
        readyGroupIds.map(async (nodeId) => {
          const group = groups.get(nodeId) ?? [];

          for (const { item, index } of group) {
            results[index] = await runner(item);
          }
        })
      );

      for (const nodeId of readyGroupIds) {
        pending.delete(nodeId);
        completed.add(nodeId);
      }
    }

    return results;
  }

  const results: T[] = [];

  for (const item of items) {
    results.push(await runner(item));
  }

  return results;
}

function groupQueueItems(items: ExecutionQueueItem[]) {
  const groups = new Map<string, Array<{ item: ExecutionQueueItem; index: number }>>();

  items.forEach((item, index) => {
    const group = groups.get(item.nodeId) ?? [];
    group.push({ item, index });
    groups.set(item.nodeId, group);
  });

  return groups;
}

function normalizeQueueDependencies(
  dependencies: ExecutionQueueDependencies | undefined,
  groups: Map<string, Array<{ item: ExecutionQueueItem; index: number }>>
) {
  const groupIds = new Set(groups.keys());
  const normalized = new Map<string, string[]>();

  for (const nodeId of groupIds) {
    normalized.set(nodeId, []);
  }

  if (!dependencies) {
    return normalized;
  }

  const entries = dependencies instanceof Map ? dependencies.entries() : Object.entries(dependencies);

  for (const [nodeId, dependencyIds] of entries) {
    if (!groupIds.has(nodeId)) {
      continue;
    }

    normalized.set(
      nodeId,
      uniqueInOrder(dependencyIds)
    );
  }

  return normalized;
}

function assertQueueDependenciesRunnable(
  dependencies: Map<string, string[]>,
  groups: Map<string, Array<{ item: ExecutionQueueItem; index: number }>>
) {
  const groupIds = new Set(groups.keys());
  const visiting = new Set<string>();
  const visited = new Set<string>();

  for (const [nodeId, dependencyIds] of dependencies) {
    for (const dependencyId of dependencyIds) {
      if (!groupIds.has(dependencyId)) {
        throw new Error("Execution queue has cyclic or unsatisfied dependencies");
      }
    }

    if (!groupIds.has(nodeId)) {
      throw new Error("Execution queue has cyclic or unsatisfied dependencies");
    }
  }

  function visit(nodeId: string) {
    if (visited.has(nodeId)) {
      return;
    }

    if (visiting.has(nodeId)) {
      throw new Error("Execution queue has cyclic or unsatisfied dependencies");
    }

    visiting.add(nodeId);

    for (const dependencyId of dependencies.get(nodeId) ?? []) {
      visit(dependencyId);
    }

    visiting.delete(nodeId);
    visited.add(nodeId);
  }

  for (const nodeId of groupIds) {
    visit(nodeId);
  }
}

export async function executeGraphRun(
  projectPath: string,
  graph: EtherGraph,
  request: ExecutionRequest
): Promise<ExecutionRunResult> {
  const plan = planExecution(graph, request);
  const state: ExecutionWorkerState = { graph };
  const results = await runExecutionQueue(
    plan.items,
    (item) => executePlannedJobItem(projectPath, state, request, item),
    { parallel: plan.parallel, dependencies: executionDependenciesForPlan(graph, plan.items) }
  );

  return {
    graph: state.graph,
    plan,
    results
  };
}

export async function listRunRecords(projectPath: string): Promise<RunRecord[]> {
  const databasePath = projectPaths(projectPath).database;
  initializeDatabase(databasePath);
  const db = openDatabase(databasePath, { readonly: true });

  try {
    const rows = db
      .prepare(
        `SELECT id, status, graph_node_id, metadata_json, started_at, finished_at
         FROM runs
         ORDER BY started_at ASC, id ASC`
      )
      .all() as RunRecordRow[];

    return rows.map((row) => ({
      id: row.id,
      status: row.status,
      graphNodeId: row.graph_node_id,
      metadata: parseMetadata(row.metadata_json),
      startedAt: row.started_at,
      finishedAt: row.finished_at
    }));
  } finally {
    db.close();
  }
}

function planNodeIds(graph: EtherGraph, request: ExecutionRequest) {
  const targetNodeIds = orderedExistingIds(graph, request.targetNodeIds);

  switch (request.policy) {
    case "cached-inputs":
    case "selected":
      return orderBySelectedDependencies(graph, targetNodeIds);
    case "refresh-upstream":
      return uniqueInOrder(
        targetNodeIds.flatMap((nodeId) => [
          ...collectUpstreamNodeIds(graph, nodeId),
          nodeId
        ])
      );
    case "downstream":
      return uniqueInOrder(targetNodeIds.flatMap((nodeId) => collectDownstreamNodeIds(graph, nodeId)));
    case "branch":
      return uniqueInOrder(
        targetNodeIds.flatMap((nodeId) => [
          ...collectUpstreamNodeIds(graph, nodeId),
          ...collectDownstreamNodeIds(graph, nodeId)
        ])
      );
    default:
      return [];
  }
}

function createQueueItems(
  graph: EtherGraph,
  nodeIds: string[],
  runCountCap?: number
): ExecutionQueueItem[] {
  const items: ExecutionQueueItem[] = [];
  const generationNodeIds = nodeIds.filter(
    (nodeId) => findNode(graph, nodeId).data?.kind === "Generation"
  );
  const generationBudget =
    typeof runCountCap === "number" ? Math.max(0, Math.floor(runCountCap)) : undefined;
  const generationCounts = createGenerationJobCounts(generationNodeIds, generationBudget);

  for (const nodeId of nodeIds) {
    const node = findNode(graph, nodeId);

    if (node.data?.kind !== "Generation") {
      items.push({ nodeId, iteration: 1 });
      continue;
    }

    const repetitions = generationCounts.get(nodeId) ?? 0;

    for (let iteration = 1; iteration <= repetitions; iteration += 1) {
      items.push({ nodeId, iteration });
    }
  }

  return items;
}

function createGenerationJobCounts(
  generationNodeIds: string[],
  generationBudget?: number
): Map<string, number> {
  const counts = new Map(generationNodeIds.map((nodeId) => [nodeId, 0]));

  if (generationNodeIds.length === 0) {
    return counts;
  }

  if (generationBudget === undefined) {
    return new Map(generationNodeIds.map((nodeId) => [nodeId, 1]));
  }

  let allocated = 0;

  while (allocated < generationBudget) {
    for (const nodeId of generationNodeIds) {
      if (allocated >= generationBudget) {
        break;
      }

      counts.set(nodeId, (counts.get(nodeId) ?? 0) + 1);
      allocated += 1;
    }
  }

  return counts;
}

export function executionDependenciesForPlan(graph: EtherGraph, items: ExecutionQueueItem[]) {
  const plannedNodeIds = uniqueInOrder(items.map((item) => item.nodeId));
  const planned = new Set(plannedNodeIds);
  const planIndexes = new Map(plannedNodeIds.map((nodeId, index) => [nodeId, index]));
  const dependencies = new Map(plannedNodeIds.map((nodeId) => [nodeId, [] as string[]]));

  for (const edge of edgesOf(graph)) {
    if (!planned.has(edge.source) || !planned.has(edge.target) || edge.source === edge.target) {
      continue;
    }

    dependencies.get(edge.target)?.push(edge.source);
  }

  for (const [nodeId, dependencyIds] of dependencies) {
    dependencies.set(
      nodeId,
      uniqueInOrder(dependencyIds).sort(
        (left, right) =>
          (planIndexes.get(left) ?? Number.MAX_SAFE_INTEGER) -
          (planIndexes.get(right) ?? Number.MAX_SAFE_INTEGER)
      )
    );
  }

  return dependencies;
}

export async function executePlannedJobItem(
  projectPath: string,
  state: ExecutionWorkerState,
  request: ExecutionRequest,
  item: ExecutionQueueItem
): Promise<ExecutionNodeResult> {
  const startedDate = request.now?.() ?? new Date();
  const startedAt = startedDate.toISOString();
  const node = findNode(state.graph, item.nodeId);

  if (node.data?.locked) {
    const result: ExecutionNodeResult = {
      nodeId: item.nodeId,
      iteration: item.iteration,
      status: "skipped",
      action: "locked",
      reason: "Node is locked",
      startedAt,
      finishedAt: startedAt
    };
    recordExecutionResult(projectPath, request, result);
    return result;
  }

  const adapterBlockedReason = blockedIncomingAdapterReason(state.graph, item.nodeId);

  if (adapterBlockedReason) {
    const result = skipAdapterBlockedNode(state, item, startedAt, adapterBlockedReason);
    recordExecutionResult(projectPath, request, result);
    return result;
  }

  if (!canExecuteLocally(node)) {
    const result = skipUnsupportedNode(state, item, startedAt, unsupportedNodeLabel(node));
    recordExecutionResult(projectPath, request, result);
    return result;
  }

  try {
    state.graph = setNodeData(state.graph, item.nodeId, {
      status: "running",
      rerunState: "running"
    });

    let result: ExecutionNodeResult;

    switch (node.data?.kind) {
      case "Prompt":
        result = isPromptAssistantHelper(node)
          ? await executeAssistantNode(projectPath, state, request, item, startedDate)
          : executePromptNode(state, item, startedAt);
        break;
      case "Assistant":
        result = await executeAssistantNode(projectPath, state, request, item, startedDate);
        break;
      case "Generation":
        result = await executeGenerationNode(projectPath, state, request, item, startedDate);
        break;
      case "Edit":
        result = await executeEditNode(projectPath, state, request, item, startedDate);
        break;
      case "Store":
        result = await executeStoreNode(projectPath, state, request, item, startedDate);
        break;
      case "Review":
        result = await executeStoreNode(projectPath, state, request, item, startedDate);
        break;
      default:
        result = skipUnsupportedNode(state, item, startedAt, unsupportedNodeLabel(node));
        break;
    }

    recordExecutionResult(projectPath, request, result);
    return result;
  } catch (error) {
    const finishedAt = (request.now?.() ?? new Date()).toISOString();
    const action =
      node.data?.kind === "Generation" ? "generate" : node.data?.kind === "Edit" ? "edit" : "execute";
    state.graph = setNodeData(state.graph, item.nodeId, {
      status: "error",
      rerunState: "error",
      lastRunAt: finishedAt
    });

    const result: ExecutionNodeResult = {
      nodeId: item.nodeId,
      iteration: item.iteration,
      status: "error",
      action,
      reason: error instanceof Error ? error.message : "Execution failed",
      startedAt,
      finishedAt
    };
    recordExecutionResult(projectPath, request, result);
    return result;
  }
}

function isPromptAssistantHelper(node: GraphNode) {
  return node.data?.kind === "Prompt" && PROMPT_ASSISTANT_SUBTYPES.has(cleanText(node.data?.subtype));
}

function executePromptNode(
  state: ExecutionWorkerState,
  item: ExecutionQueueItem,
  startedAt: string
): ExecutionNodeResult {
  state.graph = freezePromptNode(state.graph, item.nodeId, startedAt);
  const node = findNode(state.graph, item.nodeId);
  const mutationArtifact = node.data?.mutationArtifact;
  state.graph = setNodeData(state.graph, item.nodeId, {
    rerunState: "complete"
  });

  return {
    nodeId: item.nodeId,
    iteration: item.iteration,
    status: "complete",
    action: mutationArtifact ? "mutate-prompt" : "assemble-prompt",
    metadata: mutationArtifact && typeof mutationArtifact === "object" && !Array.isArray(mutationArtifact)
      ? { mutation: mutationArtifact as Record<string, unknown> }
      : undefined,
    startedAt,
    finishedAt: startedAt
  };
}

async function executeAssistantNode(
  projectPath: string,
  state: ExecutionWorkerState,
  request: ExecutionRequest,
  item: ExecutionQueueItem,
  startedDate: Date
): Promise<ExecutionNodeResult> {
  const node = findNode(state.graph, item.nodeId);
  const startedAt = startedDate.toISOString();
  const assembly = assembleAssistantInput(state.graph, item.nodeId);
  const provider = new CodexCliAssistantProvider({
    codexCliPath: request.assistantCodexCliPath,
    fileExists: request.assistantProviderFileExists,
    runner: request.assistantProviderRunner
  });
  const providerInput: AssistantProviderInput = {
    projectPath,
    runId: randomUUID(),
    assistantNodeId: item.nodeId,
    assistantSubtype: cleanText(node.data?.subtype) || "Assistant",
    prompt: assembly.prompt,
    instruction: cleanText(node.data?.instruction),
    notes: cleanText(node.data?.notes),
    sections: assembly.sections,
    references: assembly.references,
    edgeRoles: assembly.edgeRoles,
    inputs: collectProviderInputPayloads(state.graph, item.nodeId),
    requestedAt: startedAt
  };
  const diagnostic = await provider.diagnose();

  if (diagnostic.availability !== "available") {
    const error = new ProviderUnavailableError(diagnostic);
    const providerRun = createProviderRun(projectPath, {
      runId: providerInput.runId,
      providerId: provider.descriptor.id,
      model: provider.descriptor.model,
      request: providerRunRequest({
        operation: "assistant.text",
        nodeId: item.nodeId,
        iteration: item.iteration,
        policy: request.policy,
        provider: provider.descriptor,
        diagnostic,
        providerInput
      }),
      now: startedDate
    });
    failProviderRun(projectPath, providerRun.id, providerRunError(error, diagnostic), request.now?.() ?? new Date());
    throw error;
  }

  const providerRun = createProviderRun(projectPath, {
    runId: providerInput.runId,
    providerId: provider.descriptor.id,
    model: provider.descriptor.model,
    request: providerRunRequest({
      operation: "assistant.text",
      nodeId: item.nodeId,
      iteration: item.iteration,
      policy: request.policy,
      provider: provider.descriptor,
      diagnostic,
      providerInput
    }),
    now: startedDate
  });
  let providerResult: ProviderAssistantResult;

  try {
    providerResult = await provider.run(providerInput);
  } catch (error) {
    failProviderRun(projectPath, providerRun.id, providerRunError(error, diagnostic), request.now?.() ?? new Date());
    throw error;
  }
  const providerDescriptor = provider.descriptor;
  const resultText = assistantTextForSubtype(cleanText(node.data?.subtype), providerResult.text);
  const textOutputArtifact = {
    kind: "assistant-codex",
    provider: {
      id: providerResult.providerId,
      name: providerResult.providerName,
      route: providerDescriptor.route,
      capabilities: providerResult.capabilities
    },
    providerJob: providerResult.metadata ?? {},
    assistant: {
      nodeId: item.nodeId,
      subtype: providerInput.assistantSubtype,
      instruction: providerInput.instruction,
      notes: providerInput.notes
    },
    prompt: providerInput.prompt,
    sections: providerInput.sections,
    references: providerInput.references,
    edgeRoles: providerInput.edgeRoles,
    resultText
  };
  completeProviderRun(
    projectPath,
    providerRun.id,
    assistantProviderRunResponse(providerResult, providerDescriptor, resultText),
    request.now?.() ?? new Date()
  );

  state.graph = setNodeData(state.graph, item.nodeId, {
    status: "complete",
    rerunState: "complete",
    textOutput: resultText,
    textOutputArtifact,
    mutationArtifact: textOutputArtifact,
    lastRunAt: startedAt
  });

  return {
    nodeId: item.nodeId,
    iteration: item.iteration,
    status: "complete",
    action: "assistant-codex",
    metadata: {
      text: textOutputArtifact
    },
    startedAt,
    finishedAt: (request.now?.() ?? new Date()).toISOString()
  };
}

function assembleAssistantInput(graph: EtherGraph, assistantNodeId: string) {
  const sections: PromptSectionArtifact[] = [];
  const references: GenerationReferenceInput[] = [];
  const edgeRoles: EdgeRoleArtifact[] = [];

  for (const edge of incomingEdges(graph, assistantNodeId)) {
    const source = findNode(graph, edge.source);

    if (source.data?.kind === "Prompt" || source.data?.kind === "Assistant") {
      const assembly = assemblePromptForNode(graph, source.id, edge);
      for (const section of assembly.sections) {
        if (!sections.some((candidate) => candidate.nodeId === section.nodeId)) {
          sections.push(section);
        }
      }
      continue;
    }

    if (source.data?.kind === "Reference" || source.data?.kind === "Note") {
      const role = resolveReferenceRole(edge, source);
      const sourceReferences = assistantReferencesForNode(source, role);
      edgeRoles.push({ edgeId: edge.id, role });

      if (sourceReferences.length > 0) {
        references.push(...sourceReferences);
      }

      const textSection = assistantTextSectionForNode(source, edge);
      if (textSection && !sections.some((candidate) => candidate.nodeId === textSection.nodeId)) {
        sections.push(textSection);
      }
    }
  }

  const self = findNode(graph, assistantNodeId);
  const selfText = assistantTextSectionForNode(self);
  if (selfText) {
    sections.push(selfText);
  }

  return {
    nodeId: assistantNodeId,
    prompt: joinSections(sections, "prompt"),
    negativePrompt: joinSections(sections, "negativePrompt"),
    sections,
    references,
    edgeRoles
  };
}

function assistantReferenceForAsset(
  source: GraphNode,
  role: string,
  steeringText: string,
  asset: ReferenceAssetEntry | null,
  index: number,
  total: number
): GenerationReferenceInput {
  const baseTitle = cleanText(source.data?.title) || cleanText(source.data?.subtype) || "Reference";
  const reference: GenerationReferenceInput = {
    nodeId: source.id,
    role,
    title: asset?.title || (total > 1 ? `${baseTitle} ${index + 1}` : baseTitle),
    sourceKind: cleanText(source.data?.subtype) || cleanText(source.data?.kind) || "Reference"
  };

  if (steeringText) {
    reference.steeringText = steeringText;
  }

  if (asset?.assetId) {
    reference.assetId = asset.assetId;
  }

  if (asset?.assetKind) {
    reference.assetKind = asset.assetKind;
  }

  if (asset?.assetPath) {
    reference.assetPath = asset.assetPath;
  }

  if (asset?.assetMetadata) {
    reference.assetMetadata = asset.assetMetadata;
  }

  return reference;
}

function assistantReferencesForNode(source: GraphNode, role: string): GenerationReferenceInput[] {
  if (source.data?.kind !== "Reference" && source.data?.kind !== "Note") {
    return [];
  }

  const steeringText = nodeText(source);
  const assets = referenceAssetsFromNodeData(source.data);

  if (assets.length === 0) {
    return [assistantReferenceForAsset(source, role, steeringText, null, 0, 1)];
  }

  return assets.map((asset, index) =>
    assistantReferenceForAsset(source, role, steeringText, asset, index, assets.length)
  );
}

function assistantTextSectionForNode(node: GraphNode, incomingEdge?: GraphEdge): PromptSectionArtifact | null {
  const text = nodeText(node);

  if (!text) {
    return null;
  }

  return {
    nodeId: node.id,
    kind: resolveReferenceRole(incomingEdge ?? { id: "", source: node.id, target: node.id, label: "" }, node) === "negative"
      ? "negativePrompt"
      : "prompt",
    section: cleanText(node.data?.subtype) || cleanText(node.data?.kind) || "Context",
    title: cleanText(node.data?.title) || cleanText(node.data?.subtype) || cleanText(node.data?.kind) || "Context",
    text
  };
}

function assistantTextForSubtype(subtype: string, resultText: string) {
  const normalizedText = normalizeAssistantRewriteText(resultText);

  switch (subtype) {
    case "Brainstormer":
    case "Expander":
    case "Reinforcer":
    case "Mutator":
    default:
      return normalizedText;
  }
}

function normalizeAssistantRewriteText(resultText: string) {
  return cleanText(resultText)
    .replace(/\s+(?:instead of|rather than)\s+[^.;\n]+/gi, "")
    .replace(/\s+changed\s+from\s+[^.;\n]+/gi, "")
    .replace(/\s+replaced\s+[^.;\n]+\s+with\s+/gi, " ")
    .replace(/[ \t]+([.,;:])/g, "$1")
    .replace(/\s+\n/g, "\n")
    .trim();
}

function generationOutputForNode(data: Partial<CanvasNodeData> | undefined): NonNullable<GenerationProviderInput["output"]> {
  const aspectRatio = typeof data?.generationAspectRatio === "string" && GENERATION_ASPECT_RATIOS[data.generationAspectRatio]
    ? data.generationAspectRatio
    : DEFAULT_GENERATION_ASPECT_RATIO;
  const resolution = typeof data?.generationResolution === "string" && GENERATION_RESOLUTION_LONG_EDGE[data.generationResolution]
    ? data.generationResolution
    : DEFAULT_GENERATION_RESOLUTION;
  const [ratioWidth, ratioHeight] = GENERATION_ASPECT_RATIOS[aspectRatio] ?? GENERATION_ASPECT_RATIOS[DEFAULT_GENERATION_ASPECT_RATIO]!;
  const longEdge = GENERATION_RESOLUTION_LONG_EDGE[resolution] ?? GENERATION_RESOLUTION_LONG_EDGE[DEFAULT_GENERATION_RESOLUTION]!;
  const isLandscapeOrSquare = ratioWidth >= ratioHeight;
  const width = isLandscapeOrSquare ? longEdge : Math.round((longEdge * ratioWidth) / ratioHeight);
  const height = isLandscapeOrSquare ? Math.round((longEdge * ratioHeight) / ratioWidth) : longEdge;

  return {
    aspectRatio,
    resolution,
    width,
    height
  };
}

async function executeGenerationNode(
  projectPath: string,
  state: ExecutionWorkerState,
  request: ExecutionRequest,
  item: ExecutionQueueItem,
  startedDate: Date
): Promise<ExecutionNodeResult> {
  const node = findNode(state.graph, item.nodeId);
  const assembly = assembleGenerationInputs(state.graph, item.nodeId);
  const startedAt = startedDate.toISOString();
  const output = generationOutputForNode(node.data);
  const registry = createDefaultProviderRegistry({
    codexCliPath: request.imageCodexCliPath,
    fileExists: request.imageProviderFileExists,
    runner: request.imageProviderRunner
  });
  const providerId = request.providerId ?? CODEX_PROVIDER_ID;
  const provider = registry.require(providerId);
  const providerInput: GenerationProviderInput = {
    projectPath,
    runId: randomUUID(),
    generationNodeId: item.nodeId,
    iteration: item.iteration,
    prompt: assembly.prompt,
    negativePrompt: assembly.negativePrompt,
    sections: assembly.sections,
    references: assembly.references,
    edgeRoles: assembly.edgeRoles,
    inputs: collectProviderInputPayloads(state.graph, item.nodeId),
    output,
    requestedAt: startedAt
  };
  const diagnostic = await provider.diagnose();

  if (diagnostic.availability !== "available") {
    const error = new ProviderUnavailableError(diagnostic);
    const unavailableRun = createProviderRun(projectPath, {
      runId: providerInput.runId,
      providerId: provider.descriptor.id,
      model: provider.descriptor.model,
      request: providerRunRequest({
        operation: "image.generate",
        nodeId: item.nodeId,
        iteration: item.iteration,
        policy: request.policy,
        provider: provider.descriptor,
        diagnostic,
        providerInput
      }),
      now: startedDate
    });
    failProviderRun(projectPath, unavailableRun.id, providerRunError(error, diagnostic), request.now?.() ?? new Date());
    throw error;
  }

  const providerRun = createProviderRun(projectPath, {
    runId: providerInput.runId,
    providerId: provider.descriptor.id,
    model: provider.descriptor.model,
    request: providerRunRequest({
      operation: "image.generate",
      nodeId: item.nodeId,
      iteration: item.iteration,
      policy: request.policy,
      provider: provider.descriptor,
      diagnostic,
      providerInput
    }),
    now: startedDate
  });
  let providerResult: ProviderGenerationResult;

  try {
    providerResult = await provider.generate(providerInput);
  } catch (error) {
    failProviderRun(projectPath, providerRun.id, providerRunError(error, diagnostic), request.now?.() ?? new Date());
    throw error;
  }
  const providerDescriptor = provider.descriptor;

  if (providerResult.artifacts.length === 0) {
    const error = new Error(`Generation provider "${providerId}" returned no image artifacts.`);
    failProviderRun(projectPath, providerRun.id, providerRunError(error, diagnostic), request.now?.() ?? new Date());
    throw error;
  }

  const assets: AssetRecord[] = [];

  try {
    for (const [artifactIndex, artifact] of providerResult.artifacts.entries()) {
      assets.push(
        await saveGeneratedAsset(projectPath, {
          generationNodeId: item.nodeId,
          fileName: artifact.fileName,
          content: await generatedArtifactContent(artifact),
          mimeType: artifact.mimeType,
          lineage: {
            provider: {
              id: providerResult.providerId,
              name: providerResult.providerName,
              route: providerDescriptor.route,
              capabilities: providerResult.capabilities
            },
            providerJob: providerResult.metadata ?? {},
            artifact: artifact.metadata ?? {},
            artifactIndex,
            policy: request.policy,
            iteration: item.iteration,
            prompt: assembly.prompt,
            negativePrompt: assembly.negativePrompt,
            sections: assembly.sections,
            references: assembly.references,
            edgeRoles: assembly.edgeRoles,
            output
          },
          metadata: {
            provider: providerResult.providerId,
            providerName: providerResult.providerName,
            providerRoute: providerDescriptor.route,
            providerCapabilities: providerResult.capabilities,
            providerJob: providerResult.metadata ?? {},
            artifact: artifact.metadata ?? {},
            policy: request.policy,
            iteration: item.iteration
          },
          now: startedDate
        })
      );
    }
  } catch (error) {
    failProviderRun(projectPath, providerRun.id, providerRunError(error, diagnostic), request.now?.() ?? new Date());
    throw error;
  }

  completeProviderRun(
    projectPath,
    providerRun.id,
    generationProviderRunResponse(providerResult, providerDescriptor, assets),
    request.now?.() ?? new Date()
  );

  const asset = assets.at(-1)!;
  const finishedAt = (request.now?.() ?? new Date()).toISOString();

  state.graph = setNodeData(state.graph, item.nodeId, {
    status: "complete",
    rerunState: "complete",
    assembledPrompt: assembly.prompt,
    assembledNegativePrompt: assembly.negativePrompt,
    assembledPromptArtifact: assembly,
    lastRunAt: finishedAt,
    assetId: asset.id,
    assetKind: asset.kind,
    assetPath: asset.path,
    assetMetadata: asset.metadata
  });

  return {
    nodeId: item.nodeId,
    iteration: item.iteration,
    status: "complete",
    action: "generate",
    assetId: asset.id,
    assetPath: asset.path,
    metadata: {
      provider: {
        id: providerResult.providerId,
        name: providerResult.providerName,
        route: providerDescriptor.route,
        capabilities: providerResult.capabilities
      },
      providerJob: providerResult.metadata ?? {},
      generatedAssetIds: assets.map((entry) => entry.id),
      prompt: assembly.prompt,
      negativePrompt: assembly.negativePrompt,
      references: assembly.references
    },
    startedAt,
    finishedAt
  };
}

async function executeEditNode(
  projectPath: string,
  state: ExecutionWorkerState,
  request: ExecutionRequest,
  item: ExecutionQueueItem,
  startedDate: Date
): Promise<ExecutionNodeResult> {
  const node = findNode(state.graph, item.nodeId);
  const assembly = assembleEditInputs(state.graph, item.nodeId);
  const startedAt = startedDate.toISOString();
  const registry = createDefaultProviderRegistry({
    codexCliPath: request.imageCodexCliPath,
    fileExists: request.imageProviderFileExists,
    runner: request.imageProviderRunner
  });
  const providerId = request.providerId ?? CODEX_PROVIDER_ID;
  const provider = registry.require(providerId);
  const providerInput: ImageEditProviderInput = {
    projectPath,
    runId: randomUUID(),
    editNodeId: item.nodeId,
    editSubtype: node.data?.subtype ?? "Edit",
    operation: editOperationForSubtype(node.data?.subtype),
    iteration: item.iteration,
    prompt: assembly.prompt,
    negativePrompt: assembly.negativePrompt,
    instruction: cleanText(node.data?.instruction),
    notes: cleanText(node.data?.notes),
    sections: assembly.sections,
    references: assembly.references,
    edgeRoles: assembly.edgeRoles,
    sourceImage: assembly.sourceImage,
    mask: assembly.mask,
    recipe: assembly.recipe,
    frame: assembly.frame,
    inputs: collectProviderInputPayloads(state.graph, item.nodeId),
    requestedAt: startedAt
  };
  const diagnostic = await provider.diagnose();

  if (diagnostic.availability !== "available") {
    const error = new ProviderUnavailableError(diagnostic);
    const unavailableRun = createProviderRun(projectPath, {
      runId: providerInput.runId,
      providerId: provider.descriptor.id,
      model: provider.descriptor.model,
      request: providerRunRequest({
        operation: "image.edit",
        nodeId: item.nodeId,
        iteration: item.iteration,
        policy: request.policy,
        provider: provider.descriptor,
        diagnostic,
        providerInput
      }),
      now: startedDate
    });
    failProviderRun(projectPath, unavailableRun.id, providerRunError(error, diagnostic), request.now?.() ?? new Date());
    throw error;
  }

  if (!diagnostic.capabilities.includes("image.edit")) {
    const error = new Error(`Provider "${providerId}" does not support image.edit.`);
    const unsupportedRun = createProviderRun(projectPath, {
      runId: providerInput.runId,
      providerId: provider.descriptor.id,
      model: provider.descriptor.model,
      request: providerRunRequest({
        operation: "image.edit",
        nodeId: item.nodeId,
        iteration: item.iteration,
        policy: request.policy,
        provider: provider.descriptor,
        diagnostic,
        providerInput
      }),
      now: startedDate
    });
    failProviderRun(projectPath, unsupportedRun.id, providerRunError(error, diagnostic), request.now?.() ?? new Date());
    throw error;
  }

  const providerRun = createProviderRun(projectPath, {
    runId: providerInput.runId,
    providerId: provider.descriptor.id,
    model: provider.descriptor.model,
    request: providerRunRequest({
      operation: "image.edit",
      nodeId: item.nodeId,
      iteration: item.iteration,
      policy: request.policy,
      provider: provider.descriptor,
      diagnostic,
      providerInput
    }),
    now: startedDate
  });
  let providerResult: ProviderGenerationResult;

  try {
    providerResult = await provider.edit(providerInput);
  } catch (error) {
    failProviderRun(projectPath, providerRun.id, providerRunError(error, diagnostic), request.now?.() ?? new Date());
    throw error;
  }
  const providerDescriptor = provider.descriptor;

  if (providerResult.artifacts.length === 0) {
    const error = new Error(`Edit provider "${providerId}" returned no image artifacts.`);
    failProviderRun(projectPath, providerRun.id, providerRunError(error, diagnostic), request.now?.() ?? new Date());
    throw error;
  }

  const assets: AssetRecord[] = [];

  try {
    for (const [artifactIndex, artifact] of providerResult.artifacts.entries()) {
      const localTool = localToolFromMetadata(providerResult.metadata, artifact.metadata);

      assets.push(
        await saveGeneratedAsset(projectPath, {
          generationNodeId: item.nodeId,
          fileName: artifact.fileName,
          content: await generatedArtifactContent(artifact),
          mimeType: artifact.mimeType,
          lineage: {
            provider: {
              id: providerResult.providerId,
              name: providerResult.providerName,
              route: providerDescriptor.route,
              capabilities: providerResult.capabilities
            },
            providerJob: providerResult.metadata ?? {},
            artifact: artifact.metadata ?? {},
            artifactIndex,
            policy: request.policy,
            iteration: item.iteration,
            prompt: assembly.prompt,
            negativePrompt: assembly.negativePrompt,
            sections: assembly.sections,
            references: assembly.references,
            edgeRoles: assembly.edgeRoles,
            edit: {
              nodeId: item.nodeId,
              subtype: node.data?.subtype ?? "Edit",
              operation: providerInput.operation,
              recipe: providerInput.recipe,
              frame: providerInput.frame,
              instruction: cleanText(node.data?.instruction),
              notes: cleanText(node.data?.notes)
            },
            parent: {
              assetId: assembly.sourceImage.assetId,
              assetKind: assembly.sourceImage.assetKind,
              assetPath: assembly.sourceImage.assetPath,
              assetMetadata: assembly.sourceImage.assetMetadata
            },
            mask: assembly.mask
              ? {
                  assetId: assembly.mask.assetId,
                  assetPath: assembly.mask.assetPath,
                  assetMetadata: assembly.mask.assetMetadata
                }
              : null,
            upstreamReferences: assembly.references,
            ...(localTool ? { localTool } : {})
          },
          metadata: {
            provider: providerResult.providerId,
            providerName: providerResult.providerName,
            providerRoute: providerDescriptor.route,
            providerCapabilities: providerResult.capabilities,
            providerJob: providerResult.metadata ?? {},
            artifact: artifact.metadata ?? {},
            policy: request.policy,
            iteration: item.iteration,
            editNodeId: item.nodeId,
            editSubtype: node.data?.subtype ?? "Edit",
            operation: providerInput.operation,
            sourceAssetId: assembly.sourceImage.assetId,
            sourceAssetKind: assembly.sourceImage.assetKind,
            sourceAssetPath: assembly.sourceImage.assetPath,
            sourceAssetMetadata: assembly.sourceImage.assetMetadata,
            maskAssetId: assembly.mask?.assetId,
            maskAssetPath: assembly.mask?.assetPath,
            maskMetadata: assembly.mask?.assetMetadata,
            editRecipe: providerInput.recipe,
            editFrame: providerInput.frame,
            ...(localTool ? { localTool } : {})
          },
          now: startedDate
        })
      );
    }
  } catch (error) {
    failProviderRun(projectPath, providerRun.id, providerRunError(error, diagnostic), request.now?.() ?? new Date());
    throw error;
  }

  completeProviderRun(
    projectPath,
    providerRun.id,
    generationProviderRunResponse(providerResult, providerDescriptor, assets),
    request.now?.() ?? new Date()
  );

  const asset = assets.at(-1)!;
  const finishedAt = (request.now?.() ?? new Date()).toISOString();

  state.graph = setNodeData(state.graph, item.nodeId, {
    status: "complete",
    rerunState: "complete",
    assembledPrompt: assembly.prompt,
    assembledNegativePrompt: assembly.negativePrompt,
    lastRunAt: finishedAt,
    assetId: asset.id,
    assetKind: asset.kind,
    assetPath: asset.path,
    assetMetadata: asset.metadata,
    sourceAssetId: assembly.sourceImage.assetId,
    sourceAssetKind: assembly.sourceImage.assetKind,
    sourceAssetPath: assembly.sourceImage.assetPath,
    sourceAssetMetadata: assembly.sourceImage.assetMetadata,
    maskAssetId: assembly.mask?.assetId,
    maskAssetPath: assembly.mask?.assetPath,
    maskMetadata: assembly.mask?.assetMetadata,
    editRecipe: providerInput.recipe?.id,
    editFrame: providerInput.frame
  });

  const action = providerInput.operation === "upscale" ? "upscale" : "edit";
  const localTool = localToolFromMetadata(providerResult.metadata, asset.metadata);

  return {
    nodeId: item.nodeId,
    iteration: item.iteration,
    status: "complete",
    action,
    assetId: asset.id,
    assetPath: asset.path,
    metadata: {
      provider: {
        id: providerResult.providerId,
        name: providerResult.providerName,
        route: providerDescriptor.route,
        capabilities: providerResult.capabilities
      },
      providerJob: providerResult.metadata ?? {},
      editedAssetIds: assets.map((entry) => entry.id),
      operation: providerInput.operation,
      sourceAsset: {
        id: assembly.sourceImage.assetId,
        kind: assembly.sourceImage.assetKind,
        path: assembly.sourceImage.assetPath,
        metadata: assembly.sourceImage.assetMetadata
      },
      mask: assembly.mask
        ? {
            assetId: assembly.mask.assetId,
            assetPath: assembly.mask.assetPath,
            assetMetadata: assembly.mask.assetMetadata
          }
        : null,
      recipe: providerInput.recipe,
      frame: providerInput.frame,
      prompt: assembly.prompt,
      negativePrompt: assembly.negativePrompt,
      references: assembly.references,
      ...(localTool ? { localTool } : {})
    },
    startedAt,
    finishedAt
  };
}

async function executeStoreNode(
  projectPath: string,
  state: ExecutionWorkerState,
  request: ExecutionRequest,
  item: ExecutionQueueItem,
  startedDate: Date
): Promise<ExecutionNodeResult> {
  const node = findNode(state.graph, item.nodeId);
  const finishedAt = startedDate.toISOString();
  let asset: AssetRecord;
  let action: string;

  switch (node.data?.subtype) {
    case "Collection":
      asset = await ensureCollectionFolder(projectPath, {
        name: storeFolderName(node),
        nodeId: node.id,
        now: startedDate
      });
      action = "ensure-collection";
      break;
    case "Directory":
      asset = await ensureDirectoryRoot(projectPath, {
        name: storeFolderName(node),
        nodeId: node.id,
        now: startedDate
      });
      action = "ensure-directory";
      break;
    case "Compare":
      return executeCompareNode(projectPath, state, item, startedDate);
    case "Evaluate":
    case "Evaluation":
      return executeEvaluateNode(projectPath, state, request, item, startedDate);
    case "Filter":
      return executeFilterNode(projectPath, state, item, startedDate);
    default:
      return skipUnsupportedNode(state, item, finishedAt, `Store ${node.data?.subtype ?? ""}`.trim());
  }

  state.graph = setNodeData(state.graph, item.nodeId, {
    status: "complete",
    rerunState: "complete",
    lastRunAt: finishedAt,
    storeAssetId: asset.id,
    storePath: asset.path,
    storeMetadata: asset.metadata
  });

  return {
    nodeId: item.nodeId,
    iteration: item.iteration,
    status: "complete",
    action,
    assetId: asset.id,
    assetPath: asset.path,
    startedAt: finishedAt,
    finishedAt
  };
}

async function executeCompareNode(
  projectPath: string,
  state: ExecutionWorkerState,
  item: ExecutionQueueItem,
  startedDate: Date
): Promise<ExecutionNodeResult> {
  const node = findNode(state.graph, item.nodeId);
  const finishedAt = startedDate.toISOString();
  const layout = normalizeCompareLayout(node.data?.compareLayout);
  const rating = normalizeRating(node.data?.reviewRating);
  const tags = parseTags(node.data?.reviewTags);
  const decision = normalizeReviewDecision(node.data?.reviewDecision, rating);
  const notes = cleanText(node.data?.reviewNotes);
  const inputs = collectReviewInputs(state.graph, item.nodeId);
  const items = inputs.map((input) => ({
    ...input,
    rating,
    tags: uniqueText([...input.tags, ...tags]),
    decision,
    notes
  }));
  const winnerAssetId = selectedReviewWinnerAssetId(items);
  const artifact = {
    kind: "compare",
    compareNodeId: item.nodeId,
    layout,
    reviewedAt: finishedAt,
    membership: items,
    winnerAssetId,
    rating,
    tags,
    decision,
    notes,
    items
  };
  const persistedArtifact = await createArtifact(projectPath, {
    kind: "compare",
    nodeId: item.nodeId,
    metadata: artifact,
    parentArtifactIds: artifactIdsFromReviewInputs(items),
    now: startedDate
  });

  for (const input of items) {
    if (!input.assetId) {
      continue;
    }

    await updateAssetMetadata(projectPath, {
      assetId: input.assetId,
      now: startedDate,
      metadata: {
        review: {
          rating,
          tags: input.tags,
          decision,
          notes,
          compareNodeId: item.nodeId,
          compareArtifactId: persistedArtifact.id,
          reviewedAt: finishedAt,
          layout
        }
      }
    });
  }

  state.graph = setNodeData(state.graph, item.nodeId, {
    status: "complete",
    rerunState: "complete",
    lastRunAt: finishedAt,
    compareLayout: layout,
    compareArtifact: {
      ...artifact,
      artifactId: persistedArtifact.id
    }
  });

  return {
    nodeId: item.nodeId,
    iteration: item.iteration,
    status: "complete",
    action: "compare",
    metadata: {
      itemCount: items.length,
      layout,
      tags,
      decision,
      rating,
      winnerAssetId,
      artifactId: persistedArtifact.id
    },
    startedAt: finishedAt,
    finishedAt
  };
}

async function executeEvaluateNode(
  projectPath: string,
  state: ExecutionWorkerState,
  request: ExecutionRequest,
  item: ExecutionQueueItem,
  startedDate: Date
): Promise<ExecutionNodeResult> {
  if (shouldUseVisionEvaluationProvider(request)) {
    return executeProviderEvaluateNode(projectPath, state, request, item, startedDate);
  }

  return executeSimulationEvaluateNode(projectPath, state, item, startedDate);
}

async function executeSimulationEvaluateNode(
  projectPath: string,
  state: ExecutionWorkerState,
  item: ExecutionQueueItem,
  startedDate: Date
): Promise<ExecutionNodeResult> {
  const node = findNode(state.graph, item.nodeId);
  const finishedAt = startedDate.toISOString();
  const threshold = normalizeThreshold(node.data?.evaluationThreshold);
  const instruction = cleanText(node.data?.instruction);
  const inputs = collectReviewInputs(state.graph, item.nodeId);
  const items = inputs.map((input) => evaluateReviewInput(input, {
    evaluateNodeId: item.nodeId,
    threshold,
    instruction,
    evaluatedAt: finishedAt
  }));
  const artifact = {
    kind: "evaluation",
    evaluateNodeId: item.nodeId,
    threshold,
    instruction,
    evaluatedAt: finishedAt,
    items
  };
  const persistedArtifact = await createArtifact(projectPath, {
    kind: "evaluation",
    nodeId: item.nodeId,
    metadata: artifact,
    parentArtifactIds: artifactIdsFromReviewInputs(items),
    now: startedDate
  });

  for (const evaluated of items) {
    if (!evaluated.assetId) {
      continue;
    }

    await updateAssetMetadata(projectPath, {
      assetId: evaluated.assetId,
      now: startedDate,
      metadata: {
        evaluation: {
          evaluateNodeId: item.nodeId,
          decision: evaluated.decision,
          score: evaluated.score,
          tags: evaluated.tags,
          confidence: evaluated.confidence,
          explanation: evaluated.explanation,
          detectedIssues: evaluated.detectedIssues,
          evaluationArtifactId: persistedArtifact.id,
          evaluatedAt: finishedAt,
          threshold
        }
      }
    });
  }

  state.graph = setNodeData(state.graph, item.nodeId, {
    status: "complete",
    rerunState: "complete",
    lastRunAt: finishedAt,
    evaluationThreshold: threshold,
    evaluationArtifact: {
      ...artifact,
      artifactId: persistedArtifact.id
    }
  });

  return {
    nodeId: item.nodeId,
    iteration: item.iteration,
    status: "complete",
    action: "evaluate",
    metadata: {
      itemCount: items.length,
      threshold,
      passCount: items.filter((entry) => entry.decision === "pass").length,
      needsEditCount: items.filter((entry) => entry.decision === "needs-edit").length,
      failCount: items.filter((entry) => entry.decision === "fail").length,
      artifactId: persistedArtifact.id
    },
    startedAt: finishedAt,
    finishedAt
  };
}

async function executeProviderEvaluateNode(
  projectPath: string,
  state: ExecutionWorkerState,
  request: ExecutionRequest,
  item: ExecutionQueueItem,
  startedDate: Date
): Promise<ExecutionNodeResult> {
  const node = findNode(state.graph, item.nodeId);
  const startedAt = startedDate.toISOString();
  const threshold = normalizeThreshold(node.data?.evaluationThreshold);
  const instruction = cleanText(node.data?.instruction);
  const reviewInputs = collectReviewInputs(state.graph, item.nodeId);
  const images = visionEvaluationImagesFromInputs(reviewInputs);

  if (images.length === 0) {
    return executeSimulationEvaluateNode(projectPath, state, item, startedDate);
  }

  const provider = new CodexCliVisionEvaluationProvider({
    codexCliPath: request.evaluationCodexCliPath,
    fileExists: request.evaluationProviderFileExists,
    runner: request.evaluationProviderRunner
  });
  const providerInput: VisionEvaluationProviderInput = {
    projectPath,
    runId: randomUUID(),
    evaluationNodeId: item.nodeId,
    instruction,
    criteria: evaluationCriteriaForNode(node, threshold),
    threshold,
    images,
    inputs: collectProviderInputPayloads(state.graph, item.nodeId),
    requestedAt: startedAt
  };
  const diagnostic = await provider.diagnose();

  if (diagnostic.availability !== "available") {
    const error = new ProviderUnavailableError(diagnostic);
    const unavailableRun = createProviderRun(projectPath, {
      runId: providerInput.runId,
      providerId: provider.descriptor.id,
      model: provider.descriptor.model,
      request: providerRunRequest({
        operation: "evaluation.vision",
        nodeId: item.nodeId,
        iteration: item.iteration,
        policy: request.policy,
        provider: provider.descriptor,
        diagnostic,
        providerInput
      }),
      now: startedDate
    });
    failProviderRun(projectPath, unavailableRun.id, providerRunError(error, diagnostic), request.now?.() ?? new Date());
    throw error;
  }

  const providerRun = createProviderRun(projectPath, {
    runId: providerInput.runId,
    providerId: provider.descriptor.id,
    model: provider.descriptor.model,
    request: providerRunRequest({
      operation: "evaluation.vision",
      nodeId: item.nodeId,
      iteration: item.iteration,
      policy: request.policy,
      provider: provider.descriptor,
      diagnostic,
      providerInput
    }),
    now: startedDate
  });
  let providerResult: VisionEvaluationProviderResult;

  try {
    providerResult = await provider.evaluate(providerInput);
  } catch (error) {
    failProviderRun(projectPath, providerRun.id, providerRunError(error, diagnostic), request.now?.() ?? new Date());
    throw error;
  }
  const providerDescriptor = provider.descriptor;
  const evaluatedAt = (request.now?.() ?? new Date()).toISOString();
  const items = mergeProviderEvaluationResults(reviewInputs, providerInput.images, providerResult.items, {
    evaluateNodeId: item.nodeId,
    threshold,
    instruction,
    evaluatedAt
  });
  const artifact = {
    kind: "evaluation",
    evaluateNodeId: item.nodeId,
    threshold,
    instruction,
    evaluatedAt,
    provider: {
      id: providerResult.providerId,
      name: providerResult.providerName,
      route: providerDescriptor.route,
      capabilities: providerResult.capabilities
    },
    providerJob: providerResult.metadata ?? {},
    summary: providerResult.summary,
    items
  };
  let persistedArtifact: Awaited<ReturnType<typeof createArtifact>>;

  try {
    persistedArtifact = await createArtifact(projectPath, {
      kind: "evaluation",
      nodeId: item.nodeId,
      metadata: artifact,
      parentArtifactIds: artifactIdsFromReviewInputs(items),
      now: startedDate,
    });

    for (const evaluated of items) {
      if (!evaluated.assetId) {
        continue;
      }

      await updateAssetMetadata(projectPath, {
        assetId: evaluated.assetId,
        now: startedDate,
        metadata: {
          evaluation: {
            evaluateNodeId: item.nodeId,
            decision: evaluated.decision,
            score: evaluated.score,
            tags: evaluated.tags,
            confidence: evaluated.confidence,
            explanation: evaluated.explanation,
            detectedIssues: evaluated.detectedIssues,
            evaluationArtifactId: persistedArtifact.id,
            evaluatedAt,
            threshold,
            provider: providerResult.providerId
          }
        }
      });
    }

    completeProviderRun(
      projectPath,
      providerRun.id,
      evaluationProviderRunResponse(providerResult, providerDescriptor, persistedArtifact.id),
      request.now?.() ?? new Date()
    );
  } catch (error) {
    try {
      failProviderRun(projectPath, providerRun.id, providerRunError(error, diagnostic), request.now?.() ?? new Date());
    } catch {
      // Preserve the local persistence error that caused the execution failure.
    }
    throw error;
  }

  state.graph = setNodeData(state.graph, item.nodeId, {
    status: "complete",
    rerunState: "complete",
    lastRunAt: evaluatedAt,
    evaluationThreshold: threshold,
    evaluationArtifact: {
      ...artifact,
      artifactId: persistedArtifact.id
    }
  });

  return {
    nodeId: item.nodeId,
    iteration: item.iteration,
    status: "complete",
    action: "evaluate-codex",
    metadata: {
      itemCount: items.length,
      threshold,
      provider: artifact.provider,
      providerJob: providerResult.metadata ?? {},
      passCount: items.filter((entry) => entry.decision === "pass").length,
      needsEditCount: items.filter((entry) => entry.decision === "needs-edit").length,
      failCount: items.filter((entry) => entry.decision === "fail").length,
      artifactId: persistedArtifact.id
    },
    startedAt,
    finishedAt: evaluatedAt
  };
}

async function executeFilterNode(
  projectPath: string,
  state: ExecutionWorkerState,
  item: ExecutionQueueItem,
  startedDate: Date
): Promise<ExecutionNodeResult> {
  const node = findNode(state.graph, item.nodeId);
  const finishedAt = startedDate.toISOString();
  const inputs = collectReviewInputs(state.graph, item.nodeId);
  const rules = parseFilterRules(node.data?.filterRules);
  const dryRun = node.data?.filterDryRun === true;
  const autoApply = node.data?.filterAutoApply !== false;
  const mode = normalizeFilterRouteMode(node.data?.filterRouteMode);
  const manualOverride = cleanText(node.data?.filterManualOverride);
  const routes = collectFilterRoutes(state.graph, item.nodeId);
  const routed = [];
  const candidateRoutes = [];
  const collectionUpdates = new Map<string, Partial<CanvasNodeData>>();

  for (const input of inputs) {
    const decision = normalizeRoutingDecision(input.decision);
    const route = selectFilterRoute({
      decision,
      manualOverride,
      rules,
      routes
    });
    let moved = false;
    let copied = false;
    let linked = false;
    let metadataUpdated = false;
    let movedAsset: AssetRecord | null = null;
    let copiedPath: string | null = null;
    let collectionAsset: AssetRecord | null = null;
    const previewMetadataChanges = filterMetadataChanges({
      filterNodeId: item.nodeId,
      decision,
      route,
      mode,
      dryRun,
      autoApply,
      moved: false,
      copied: false,
      linked: false,
      routedAt: finishedAt
    });
    const inputArtifactId = artifactIdFromReviewInput(input);
    if (autoApply && !dryRun && mode === "move" && !input.assetId) {
      throw new Error(`Artifact-only route "${inputArtifactId || input.assetPath || "unknown"}" cannot be moved without an asset id. Use copy or link mode for artifact-only inputs.`);
    }

    const canApplyRoute =
      Boolean(input.assetId) ||
      (mode === "copy" && Boolean(input.assetPath)) ||
      (mode === "link" && Boolean(inputArtifactId));
    const candidateRoute = {
      assetId: input.assetId,
      artifactId: inputArtifactId,
      assetPath: input.assetPath,
      decision,
      score: input.score,
      destinationCollectionName: route.collectionName,
      destinationCollectionNodeId: route.node?.id,
      destinationCollectionId: stringFrom(route.node?.data?.storeAssetId),
      rule: route.rule,
      dryRun,
      autoApply,
      mode,
      metadataChanges: previewMetadataChanges
    };

    candidateRoutes.push(candidateRoute);

    if (canApplyRoute && autoApply && !dryRun) {
      collectionAsset = route.node
        ? await ensureCollectionFolder(projectPath, {
            name: route.collectionName,
            nodeId: route.node.id,
            now: startedDate
          })
        : null;

      if (route.node && collectionAsset) {
        collectionUpdates.set(route.node.id, {
          status: "complete",
          rerunState: "complete",
          lastRunAt: finishedAt,
          storeAssetId: collectionAsset.id,
          storePath: collectionAsset.path,
          storeMetadata: collectionAsset.metadata
        });
      }

      if (mode === "move") {
        if (!input.assetId) {
          throw new Error(`Asset-only route "${input.artifactId ?? input.assetPath ?? "unknown"}" cannot be moved without an asset id.`);
        }

        movedAsset = await moveAssetToCollection(projectPath, {
          assetId: input.assetId,
          collectionId: collectionAsset?.id,
          collectionName: collectionAsset ? undefined : route.collectionName,
          reason: `Filter ${item.nodeId} routed ${decision} to ${route.collectionName}`,
          now: startedDate
        });
        moved = true;
      } else if (mode === "copy") {
        const copyResult = await applyCopyRoute(projectPath, {
          input,
          collectionAsset,
          collectionName: route.collectionName,
          filterNodeId: item.nodeId,
          decision,
          route,
          mode,
          dryRun,
          autoApply,
          routedAt: finishedAt,
          now: startedDate
        });
        collectionAsset = copyResult.collectionAsset;
        copiedPath = copyResult.copiedPath;
        copied = true;
        metadataUpdated = true;
      } else {
        const artifactId = await resolveArtifactIdForReviewInput(projectPath, input);

        if (!artifactId) {
          throw new Error(`Asset "${input.assetId}" cannot be linked because it has no artifact id.`);
        }

        if (!collectionAsset) {
          collectionAsset = await ensureCollectionFolder(projectPath, {
            name: route.collectionName,
            now: startedDate
          });
        }

        await addArtifactToCollection(projectPath, {
          artifactId,
          collectionId: collectionAsset.id,
          metadata: {
            filterNodeId: item.nodeId,
            decision,
            mode,
            reason: `Filter ${item.nodeId} linked ${decision} to ${route.collectionName}`
          },
          now: startedDate
        });
        linked = true;
      }

      if (!metadataUpdated && input.assetId) {
        await updateAssetMetadata(projectPath, {
          assetId: input.assetId,
          now: startedDate,
          metadata: filterMetadataChanges({
            filterNodeId: item.nodeId,
            decision,
            route,
            mode,
            dryRun,
            autoApply,
            moved,
            copied,
            linked,
            routedAt: finishedAt,
            copiedPath,
            collectionId: collectionAsset?.id
          })
        });
      }
    }

    const finalMetadataChanges = filterMetadataChanges({
      filterNodeId: item.nodeId,
      decision,
      route,
      mode,
      dryRun,
      autoApply,
      moved,
      copied,
      linked,
      routedAt: finishedAt,
      copiedPath,
      collectionId: collectionAsset?.id ?? candidateRoute.destinationCollectionId
    });

    routed.push({
      assetId: input.assetId,
      artifactId: inputArtifactId,
      assetPath: movedAsset?.path ?? input.assetPath,
      decision,
      score: input.score,
      targetCollectionName: route.collectionName,
      destinationCollectionName: route.collectionName,
      destinationCollectionId: collectionAsset?.id ?? candidateRoute.destinationCollectionId,
      rule: route.rule,
      dryRun,
      autoApply,
      mode,
      preview: dryRun || !autoApply,
      moved,
      copied,
      linked,
      copiedPath,
      metadataChanges: dryRun || !autoApply ? previewMetadataChanges : finalMetadataChanges
    });
  }

  for (const [nodeId, update] of collectionUpdates) {
    state.graph = setNodeData(state.graph, nodeId, update);
  }

  const resultArtifact = {
    kind: "filter",
    filterNodeId: item.nodeId,
    dryRun,
    autoApply,
    mode,
    manualOverride: manualOverride || null,
    routedAt: finishedAt,
    candidateRoutes,
    routed
  };
  const persistedArtifact = await createArtifact(projectPath, {
    kind: "route",
    nodeId: item.nodeId,
    metadata: resultArtifact,
    parentArtifactIds: artifactIdsFromReviewInputs(inputs),
    now: startedDate
  });

  state.graph = setNodeData(state.graph, item.nodeId, {
    status: "complete",
    rerunState: "complete",
    lastRunAt: finishedAt,
    filterRouteMode: mode,
    filterResult: {
      ...resultArtifact,
      artifactId: persistedArtifact.id
    }
  });

  return {
    nodeId: item.nodeId,
    iteration: item.iteration,
    status: "complete",
    action: dryRun ? "filter-dry-run" : autoApply ? "filter-route" : "filter-preview",
    metadata: {
      itemCount: routed.length,
      dryRun,
      autoApply,
      mode,
      manualOverride: manualOverride || null,
      movedCount: routed.filter((entry) => entry.moved).length,
      copiedCount: routed.filter((entry) => entry.copied).length,
      linkedCount: routed.filter((entry) => entry.linked).length,
      artifactId: persistedArtifact.id,
      candidateRoutes,
      routes: routed
    },
    startedAt: finishedAt,
    finishedAt
  };
}

type ReviewInput = {
  assetId?: string;
  artifactId?: string;
  assetKind?: string;
  assetPath?: string;
  assetMetadata?: Record<string, unknown>;
  sourceNodeId: string;
  sourceNodeTitle: string;
  rating?: number;
  tags: string[];
  decision?: string;
  notes?: string;
  score?: number;
  confidence?: number;
  explanation?: string;
  detectedIssues?: string[];
};

type EvaluatedReviewInput = ReviewInput & {
  score: number;
  confidence: number;
  decision: "pass" | "needs-edit" | "fail";
  explanation: string;
  detectedIssues: string[];
};

type FilterRoute = {
  collectionName: string;
  rule: string;
  node?: GraphNode;
};

type FilterRouteMode = "move" | "copy" | "link";

function selectedReviewWinnerAssetId(items: ReviewInput[]) {
  return (
    items.find((input) => input.decision === "select" || input.decision === "favorite")?.assetId ||
    items
      .filter((input) => input.assetId && typeof input.rating === "number")
      .sort((left, right) => (right.rating ?? 0) - (left.rating ?? 0))[0]?.assetId ||
    items.find((input) => input.assetId)?.assetId ||
    null
  );
}

function artifactIdsFromReviewInputs(inputs: ReviewInput[]) {
  return uniqueText(inputs.map(artifactIdFromReviewInput).filter((artifactId): artifactId is string => Boolean(artifactId)));
}

function artifactIdFromReviewInput(input: ReviewInput) {
  if (input.artifactId) {
    return input.artifactId;
  }

  const metadata = recordFrom(input.assetMetadata);
  return stringFrom(metadata.artifactId) || stringFrom(metadata.sourceArtifactId);
}

async function resolveArtifactIdForReviewInput(projectPath: string, input: ReviewInput) {
  const directArtifactId = artifactIdFromReviewInput(input);

  if (directArtifactId || !input.assetId) {
    return directArtifactId;
  }

  const asset = (await listAssets(projectPath)).find((candidate) => candidate.id === input.assetId);

  return asset ? stringFrom(asset.metadata.artifactId) : "";
}

function normalizeFilterRouteMode(value: unknown): FilterRouteMode {
  const mode = cleanText(value).toLowerCase();

  return mode === "copy" || mode === "link" ? mode : "move";
}

function filterMetadataChanges(input: {
  filterNodeId: string;
  decision: string;
  route: FilterRoute;
  mode: FilterRouteMode;
  dryRun: boolean;
  autoApply: boolean;
  moved: boolean;
  copied: boolean;
  linked: boolean;
  routedAt: string;
  copiedPath?: string | null;
  collectionId?: string | null;
}) {
  return {
    filter: withoutUndefined({
      filterNodeId: input.filterNodeId,
      decision: input.decision,
      targetCollectionName: input.route.collectionName,
      destinationCollectionName: input.route.collectionName,
      destinationCollectionId: input.collectionId || undefined,
      rule: input.route.rule,
      mode: input.mode,
      dryRun: input.dryRun,
      autoApply: input.autoApply,
      moved: input.moved,
      copied: input.copied,
      linked: input.linked,
      copiedPath: input.copiedPath || undefined,
      routedAt: input.routedAt
    })
  };
}

async function copyReviewAssetToCollection(
  projectPath: string,
  options: {
    input: ReviewInput;
    collectionAsset: AssetRecord | null;
    collectionName: string;
    now: Date;
  }
) {
  if (!options.input.assetPath) {
    throw new Error(`Asset "${options.input.assetId ?? "unknown"}" cannot be copied because it has no file path.`);
  }

  const collectionAsset =
    options.collectionAsset ??
    (await ensureCollectionFolder(projectPath, {
      name: options.collectionName,
      now: options.now
    }));

  await mkdir(collectionAsset.path, { recursive: true });
  const copiedPath = await copyFileToAvailablePath(
    options.input.assetPath,
    path.join(collectionAsset.path, path.basename(options.input.assetPath))
  );

  return { copiedPath, collectionAsset };
}

async function applyCopyRoute(
  projectPath: string,
  options: {
    input: ReviewInput;
    collectionAsset: AssetRecord | null;
    collectionName: string;
    filterNodeId: string;
    decision: string;
    route: FilterRoute;
    mode: FilterRouteMode;
    dryRun: boolean;
    autoApply: boolean;
    routedAt: string;
    now: Date;
  }
) {
  let copiedPath: string | null = null;
  let copiedArtifactId: string | null = null;

  try {
    const copyResult = await copyReviewAssetToCollection(projectPath, {
      input: options.input,
      collectionAsset: options.collectionAsset,
      collectionName: options.collectionName,
      now: options.now
    });
    copiedPath = copyResult.copiedPath;
    const copiedMetadata = recordFrom(options.input.assetMetadata);
    delete copiedMetadata.assetId;
    delete copiedMetadata.assetPath;

    const copiedArtifact = await createArtifact(projectPath, {
      kind: artifactKindForAssetKind(options.input.assetKind),
      nodeId: options.filterNodeId,
      path: copiedPath,
      metadata: {
        ...copiedMetadata,
        assetPath: copiedPath,
        copiedFromAssetId: options.input.assetId,
        copiedFromPath: options.input.assetPath,
        collectionId: copyResult.collectionAsset.id,
        collectionName: options.collectionName,
        filterNodeId: options.filterNodeId,
        routeDecision: options.decision,
        routeMode: options.mode
      },
      parentArtifactIds: artifactIdsFromReviewInputs([options.input]),
      now: options.now
    });
    copiedArtifactId = copiedArtifact.id;

    await addArtifactToCollection(projectPath, {
      artifactId: copiedArtifact.id,
      collectionId: copyResult.collectionAsset.id,
      metadata: {
        filterNodeId: options.filterNodeId,
        decision: options.decision,
        mode: options.mode,
        reason: `Filter ${options.filterNodeId} copied ${options.decision} to ${options.collectionName}`
      },
      now: options.now
    });

    if (options.input.assetId) {
      await updateAssetMetadata(projectPath, {
        assetId: options.input.assetId,
        now: options.now,
        metadata: filterMetadataChanges({
          filterNodeId: options.filterNodeId,
          decision: options.decision,
          route: options.route,
          mode: options.mode,
          dryRun: options.dryRun,
          autoApply: options.autoApply,
          moved: false,
          copied: true,
          linked: false,
          routedAt: options.routedAt,
          copiedPath,
          collectionId: copyResult.collectionAsset.id
        })
      });
    }

    return copyResult;
  } catch (error) {
    if (copiedArtifactId) {
      await deleteArtifactRecord(projectPath, copiedArtifactId).catch(() => undefined);
    }

    if (copiedPath) {
      await unlink(copiedPath).catch(() => undefined);
    }

    throw error;
  }
}

async function copyFileToAvailablePath(sourcePath: string, basePath: string) {
  const directory = path.dirname(basePath);
  const extension = path.extname(basePath);
  const name = path.basename(basePath, extension);

  for (let index = 1; index < 10000; index += 1) {
    const candidate = index === 1 ? basePath : path.join(directory, `${name}-${index}${extension}`);

    try {
      await copyFile(sourcePath, candidate, fsConstants.COPYFILE_EXCL);
      return candidate;
    } catch (error) {
      if (isNodeErrorWithCode(error, "EEXIST")) {
        continue;
      }

      await unlink(candidate).catch(() => undefined);
      throw error;
    }
  }

  throw new Error(`Could not copy to an available file path for ${basePath}`);
}

async function deleteArtifactRecord(projectPath: string, artifactId: string) {
  const paths = projectPaths(projectPath);
  initializeDatabase(paths.database);
  const db = openDatabase(paths.database);

  try {
    runInTransaction(db, () => {
      db.prepare("DELETE FROM collection_memberships WHERE artifact_id = ?").run(artifactId);
      db.prepare("DELETE FROM lineage_edges WHERE parent_artifact_id = ? OR child_artifact_id = ?").run(artifactId, artifactId);
      db.prepare("DELETE FROM artifact_versions WHERE artifact_id = ?").run(artifactId);
      db.prepare("DELETE FROM artifacts WHERE id = ?").run(artifactId);
    });
  } finally {
    db.close();
  }
}

function artifactKindForAssetKind(assetKind: string | undefined): ArtifactKind {
  switch (assetKind) {
    case "reference":
      return "reference";
    case "mask":
      return "mask";
    default:
      return "image";
  }
}

function isNodeErrorWithCode(error: unknown, code: string) {
  return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === code;
}

function collectReviewInputs(graph: EtherGraph, nodeId: string): ReviewInput[] {
  const inputs: ReviewInput[] = [];

  for (const edge of incomingEdges(graph, nodeId)) {
    const source = findNode(graph, edge.source);

    appendReviewInputs(inputs, reviewInputsFromNode(source));
  }

  return inputs;
}

function reviewInputsFromNode(node: GraphNode): ReviewInput[] {
  const inputs: ReviewInput[] = [];

  if (isImageAssetSource(node)) {
    appendReviewInputs(inputs, [reviewInputFromAssetNode(node)]);
  }

  appendReviewInputs(inputs, reviewInputsFromArtifact(node, node.data?.compareArtifact));
  appendReviewInputs(inputs, reviewInputsFromArtifact(node, node.data?.evaluationArtifact));
  appendReviewInputs(inputs, reviewInputsFromArtifact(node, node.data?.filterResult));

  return inputs;
}

function reviewInputFromAssetNode(node: GraphNode): ReviewInput {
  const metadata = node.data?.assetMetadata ?? {};
  const review = recordFrom(metadata.review);
  const evaluation = recordFrom(metadata.evaluation);
  const artifactId = stringFrom(metadata.artifactId) || stringFrom(metadata.sourceArtifactId);

  return {
    assetId: node.data?.assetId,
    artifactId: artifactId || undefined,
    assetKind: node.data?.assetKind,
    assetPath: node.data?.assetPath,
    assetMetadata: metadata,
    sourceNodeId: node.id,
    sourceNodeTitle: sectionTitle(node),
    rating: numberFrom(review.rating),
    tags: uniqueText([
      ...tagsFromUnknown(review.tags),
      ...tagsFromUnknown(evaluation.tags)
    ]),
    decision: stringFrom(evaluation.decision) || stringFrom(review.decision),
    notes: stringFrom(review.notes),
    score: numberFrom(evaluation.score),
    confidence: numberFrom(evaluation.confidence),
    explanation: stringFrom(evaluation.explanation),
    detectedIssues: tagsFromUnknown(evaluation.detectedIssues)
  };
}

function reviewInputsFromArtifact(node: GraphNode, artifact: unknown): ReviewInput[] {
  const record = recordFrom(artifact);
  const items = Array.isArray(record.items)
    ? record.items
    : Array.isArray(record.routed)
      ? record.routed
      : [];

  return items.flatMap((item) => {
    const itemRecord = recordFrom(item);
    const assetId = stringFrom(itemRecord.assetId);
    const assetMetadata = recordFrom(itemRecord.assetMetadata);
    const artifactId =
      stringFrom(itemRecord.artifactId) ||
      stringFrom(assetMetadata.artifactId) ||
      stringFrom(assetMetadata.sourceArtifactId);
    const assetPath = stringFrom(itemRecord.assetPath);

    if (!assetId && !assetPath && !artifactId) {
      return [];
    }

    return [
      {
        assetId,
        artifactId: artifactId || undefined,
        assetKind: stringFrom(itemRecord.assetKind),
        assetPath,
        assetMetadata,
        sourceNodeId: node.id,
        sourceNodeTitle: sectionTitle(node),
        rating: numberFrom(itemRecord.rating),
        tags: tagsFromUnknown(itemRecord.tags),
        decision: stringFrom(itemRecord.decision),
        notes: stringFrom(itemRecord.notes),
        score: numberFrom(itemRecord.score),
        confidence: numberFrom(itemRecord.confidence),
        explanation: stringFrom(itemRecord.explanation),
        detectedIssues: tagsFromUnknown(itemRecord.detectedIssues)
      }
    ];
  });
}

function appendReviewInputs(target: ReviewInput[], additions: ReviewInput[]) {
  for (const addition of additions) {
    const key = reviewInputKey(addition);
    const existingIndex = target.findIndex((candidate) => reviewInputKey(candidate) === key);

    if (existingIndex === -1) {
      target.push(addition);
      continue;
    }

    const existing = target[existingIndex]!;
    target[existingIndex] = {
      ...existing,
      ...withoutUndefined(addition),
      tags: uniqueText([...existing.tags, ...addition.tags]),
      assetMetadata: {
        ...(existing.assetMetadata ?? {}),
        ...(addition.assetMetadata ?? {})
      }
    };
  }
}

function reviewInputKey(input: ReviewInput) {
  return input.assetId || artifactIdFromReviewInput(input) || input.assetPath || `${input.sourceNodeId}:${input.sourceNodeTitle}`;
}

function evaluateReviewInput(
  input: ReviewInput,
  context: {
    evaluateNodeId: string;
    threshold: number;
    instruction: string;
    evaluatedAt: string;
  }
): EvaluatedReviewInput {
  const ratingScore = typeof input.rating === "number" ? input.rating * 20 : 50;
  const decisionBonus = input.decision === "select" || input.decision === "favorite"
    ? 8
    : input.decision === "reject" || input.decision === "fail"
      ? -22
      : input.decision === "needs-edit"
        ? -8
        : 0;
  const tagBonus = Math.min(10, input.tags.length * 2);
  const score = clampInt(input.score ?? ratingScore + decisionBonus + tagBonus, 0, 100);
  const decision = score >= context.threshold
    ? "pass"
    : score >= Math.max(0, context.threshold - 20)
      ? "needs-edit"
      : "fail";
  const confidence = clampNumber(0.55 + score / 250, 0.55, 0.95);
  const instructionSummary = context.instruction || "the configured evaluation direction";
  const explanation =
    input.explanation ||
    `Scored ${score} against ${instructionSummary}; tags ${input.tags.join(", ") || "none"} and decision ${
      input.decision || "unreviewed"
    } informed the result.`;

  return {
    ...input,
    tags: uniqueText(input.tags),
    score,
    confidence: Number(confidence.toFixed(2)),
    decision,
    explanation,
    detectedIssues: input.detectedIssues ?? []
  };
}

function shouldUseVisionEvaluationProvider(request: ExecutionRequest) {
  if (request.evaluationSimulationMode === true || request.providerId === FAKE_PROVIDER_ID) {
    return false;
  }

  return true;
}

function evaluationCriteriaForNode(node: GraphNode, threshold: number) {
  return [
    `Use a ${threshold}/100 pass threshold.`,
    cleanText(node.data?.notes),
    "Return score, tags, pass/needs-edit/fail decision, confidence, explanation, and detected visual issues for each image."
  ]
    .filter(Boolean)
    .join("\n");
}

function visionEvaluationImagesFromInputs(inputs: ReviewInput[]): VisionEvaluationImageInput[] {
  return inputs
    .filter((input) => input.assetPath)
    .map((input, index) => ({
      id: input.assetId || input.assetPath || `image-${index + 1}`,
      nodeId: input.sourceNodeId,
      title: input.sourceNodeTitle,
      ...(input.assetId ? { assetId: input.assetId } : {}),
      ...(input.assetKind ? { assetKind: input.assetKind } : {}),
      assetPath: input.assetPath!,
      ...(input.assetMetadata ? { assetMetadata: input.assetMetadata } : {}),
      tags: input.tags,
      ...(input.decision ? { decision: input.decision } : {}),
      ...(input.notes ? { notes: input.notes } : {})
    }));
}

function mergeProviderEvaluationResults(
  inputs: ReviewInput[],
  images: VisionEvaluationImageInput[],
  providerItems: VisionEvaluationItemResult[],
  context: {
    evaluateNodeId: string;
    threshold: number;
    instruction: string;
    evaluatedAt: string;
  }
): EvaluatedReviewInput[] {
  const providerItemsByKey = new Map<string, VisionEvaluationItemResult>();

  for (const item of providerItems) {
    for (const key of providerResultKeys(item)) {
      if (!providerItemsByKey.has(key)) {
        providerItemsByKey.set(key, item);
      }
    }
  }

  return inputs.map((input) => {
    const image = images.find((candidate) => candidate.assetId === input.assetId || candidate.assetPath === input.assetPath);
    const providerItem = [
      input.assetId,
      input.assetPath,
      image?.id
    ]
      .filter((key): key is string => Boolean(key))
      .map((key) => providerItemsByKey.get(key))
      .find(Boolean);

    if (!providerItem) {
      return evaluateReviewInput(input, context);
    }

    return {
      ...input,
      assetId: input.assetId || providerItem.assetId,
      assetPath: input.assetPath || providerItem.assetPath,
      tags: uniqueText([...input.tags, ...providerItem.tags]),
      score: clampInt(providerItem.score, 0, 100),
      confidence: clampNumber(providerItem.confidence, 0, 1),
      decision: providerItem.decision,
      explanation: providerItem.explanation,
      detectedIssues: providerItem.detectedIssues
    };
  });
}

function providerResultKeys(item: VisionEvaluationItemResult) {
  return [item.id, item.assetId, item.assetPath].filter((key): key is string => Boolean(key));
}

function collectFilterRoutes(graph: EtherGraph, filterNodeId: string): FilterRoute[] {
  const routes: FilterRoute[] = [];

  for (const edge of outgoingEdges(graph, filterNodeId)) {
    const target = findNode(graph, edge.target);

    if (target.data?.kind !== "Store" || target.data.subtype !== "Collection") {
      continue;
    }

    routes.push({
      collectionName: storeFolderName(target),
      rule: normalizeRoleKey(edgeLabel(edge)) || normalizeRoleKey(storeFolderName(target)),
      node: target
    });
  }

  return routes;
}

function selectFilterRoute(options: {
  decision: string;
  manualOverride: string;
  rules: Map<string, string>;
  routes: FilterRoute[];
}): FilterRoute {
  const requestedName =
    options.manualOverride ||
    options.rules.get(options.decision) ||
    defaultCollectionForDecision(options.decision);
  const requestedKey = normalizeRoleKey(requestedName);
  const matchingRoute =
    options.routes.find((route) => normalizeRoleKey(route.collectionName) === requestedKey) ||
    options.routes.find((route) => route.rule === options.decision) ||
    options.routes.find((route) => normalizeRoleKey(route.collectionName) === normalizeRoleKey(defaultCollectionForDecision(options.decision)));

  if (matchingRoute) {
    return {
      ...matchingRoute,
      rule: options.manualOverride ? "manual-override" : options.rules.has(options.decision) ? options.decision : matchingRoute.rule
    };
  }

  return {
    collectionName: requestedName,
    rule: options.manualOverride ? "manual-override" : options.rules.has(options.decision) ? options.decision : "default"
  };
}

function parseFilterRules(value: unknown) {
  const rules = new Map<string, string>();
  const text = cleanText(value);

  for (const part of text.split(/[;\n]+/)) {
    const [rawDecision, rawCollection] = part.split(/->|=>/).map((entry) => entry?.trim());

    if (!rawDecision || !rawCollection) {
      continue;
    }

    rules.set(normalizeRoutingDecision(rawDecision), rawCollection);
  }

  return rules;
}

function defaultCollectionForDecision(decision: string) {
  switch (decision) {
    case "pass":
      return "Selected";
    case "needs-edit":
      return "Needs Edit";
    case "fail":
    default:
      return "Rejected";
  }
}

function normalizeRoutingDecision(value: unknown) {
  const decision = normalizeRoleKey(stringFrom(value) || "needs-edit");

  if (decision === "pass" || decision === "select" || decision === "selected" || decision === "favorite") {
    return "pass";
  }

  if (decision === "fail" || decision === "reject" || decision === "rejected") {
    return "fail";
  }

  return "needs-edit";
}

function normalizeReviewDecision(value: unknown, rating: number | undefined) {
  const decision = normalizeRoleKey(stringFrom(value));

  if (decision === "favorite") {
    return "favorite";
  }

  if (decision === "select" || decision === "selected" || decision === "pass") {
    return "select";
  }

  if (decision === "reject" || decision === "rejected" || decision === "fail") {
    return "reject";
  }

  if (decision === "needs-edit" || decision === "edit") {
    return "needs-edit";
  }

  if (typeof rating === "number") {
    if (rating >= 4) {
      return "select";
    }

    if (rating <= 2) {
      return "reject";
    }
  }

  return "review";
}

function normalizeCompareLayout(value: unknown) {
  const layout = numberFrom(value);
  return layout && [2, 3, 4, 6, 8].includes(layout) ? layout : 4;
}

function normalizeRating(value: unknown) {
  const rating = numberFrom(value);
  return rating ? clampInt(rating, 1, 5) : undefined;
}

function normalizeThreshold(value: unknown) {
  const threshold = numberFrom(value);
  return threshold ? clampInt(threshold, 0, 100) : 70;
}

function parseTags(value: unknown) {
  return uniqueText(cleanText(value).split(/[,;\n]+/));
}

function tagsFromUnknown(value: unknown) {
  if (Array.isArray(value)) {
    return uniqueText(value.map((entry) => stringFrom(entry)));
  }

  return parseTags(value);
}

function uniqueText(values: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const text = cleanText(value);
    const key = text.toLowerCase();

    if (!text || seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(text);
  }

  return result;
}

function recordFrom(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function numberFrom(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

function stringFrom(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function clampInt(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function clampNumber(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function withoutUndefined<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as Partial<T>;
}

function skipUnsupportedNode(
  state: ExecutionWorkerState,
  item: ExecutionQueueItem,
  now: string,
  kind: string
): ExecutionNodeResult {
  const node = findNode(state.graph, item.nodeId);
  const nextRerunState = node.data?.rerunState === "stale" ? "stale" : "ready";
  state.graph = setNodeData(state.graph, item.nodeId, {
    rerunState: nextRerunState
  });

  return {
    nodeId: item.nodeId,
    iteration: item.iteration,
    status: "skipped",
    action: "unsupported",
    reason: `${kind} nodes do not have local execution yet`,
    startedAt: now,
    finishedAt: now
  };
}

function skipAdapterBlockedNode(
  state: ExecutionWorkerState,
  item: ExecutionQueueItem,
  now: string,
  reason: string
): ExecutionNodeResult {
  const node = findNode(state.graph, item.nodeId);
  const nextRerunState = node.data?.rerunState === "stale" ? "stale" : "ready";
  state.graph = setNodeData(state.graph, item.nodeId, {
    rerunState: nextRerunState
  });

  return {
    nodeId: item.nodeId,
    iteration: item.iteration,
    status: "skipped",
    action: "adapter-blocked",
    reason,
    startedAt: now,
    finishedAt: now
  };
}

function canExecuteLocally(node: GraphNode) {
  switch (node.data?.kind) {
    case "Prompt":
    case "Assistant":
    case "Generation":
    case "Edit":
      return true;
    case "Review":
      return ["Compare", "Evaluate", "Evaluation", "Filter"].includes(node.data.subtype ?? "");
    case "Store":
      return ["Collection", "Directory", "Compare", "Evaluate", "Evaluation", "Filter"].includes(
        node.data.subtype ?? ""
      );
    default:
      return false;
  }
}

function unsupportedNodeLabel(node: GraphNode) {
  if (node.data?.kind === "Review") {
    return `Review ${node.data.subtype ?? ""}`.trim();
  }

  if (node.data?.kind === "Store") {
    return `Store ${node.data.subtype ?? ""}`.trim();
  }

  return node.data?.kind ?? "Unknown";
}

function recordExecutionResult(
  projectPath: string,
  request: ExecutionRequest,
  result: ExecutionNodeResult
) {
  insertRunRecord(projectPath, {
    status: result.status,
    graphNodeId: result.nodeId,
    metadata: {
      action: result.action,
      policy: request.policy,
      iteration: result.iteration,
      ...(result.reason ? { reason: result.reason } : {}),
      ...(result.assetId ? { assetId: result.assetId } : {}),
      ...(result.assetPath ? { assetPath: result.assetPath } : {}),
      ...(result.metadata ?? {})
    },
    startedAt: result.startedAt,
    finishedAt: result.finishedAt
  });
}

function insertRunRecord(
  projectPath: string,
  record: {
    status: string;
    graphNodeId: string;
    metadata: Record<string, unknown>;
    startedAt: string;
    finishedAt: string;
  }
) {
  const databasePath = projectPaths(projectPath).database;
  initializeDatabase(databasePath);
  const db = openDatabase(databasePath);

  try {
    db.prepare(
      `INSERT INTO runs (id, status, graph_node_id, metadata_json, started_at, finished_at)
       VALUES (@id, @status, @graphNodeId, @metadataJson, @startedAt, @finishedAt)`
    ).run({
      id: randomUUID(),
      status: record.status,
      graphNodeId: record.graphNodeId,
      metadataJson: JSON.stringify(record.metadata),
      startedAt: record.startedAt,
      finishedAt: record.finishedAt
    });
  } finally {
    db.close();
  }
}

function providerRunRequest(input: {
  operation: string;
  nodeId: string;
  iteration: number;
  policy: ExecutionPolicy;
  provider: ProviderDescriptor;
  diagnostic?: ProviderDiagnostic;
  providerInput: unknown;
}) {
  return {
    operation: input.operation,
    nodeId: input.nodeId,
    iteration: input.iteration,
    policy: input.policy,
    provider: providerDescriptorSummary(input.provider),
    ...(input.diagnostic ? { diagnostic: providerDiagnosticSummary(input.diagnostic) } : {}),
    providerInput: input.providerInput
  };
}

function providerRunError(error: unknown, diagnostic?: ProviderDiagnostic) {
  const base =
    error instanceof Error
      ? {
          name: error.name,
          message: error.message,
          stack: error.stack
        }
      : {
          name: "Error",
          message: String(error)
        };

  return {
    ...base,
    ...(diagnostic ? { diagnostic: providerDiagnosticSummary(diagnostic) } : {})
  };
}

function generationProviderRunResponse(
  result: ProviderGenerationResult,
  provider: ProviderDescriptor,
  assets: AssetRecord[]
) {
  return {
    providerId: result.providerId,
    providerName: result.providerName,
    provider: providerDescriptorSummary(provider),
    capabilities: result.capabilities,
    metadata: result.metadata ?? {},
    artifactCount: result.artifacts.length,
    artifactIds: assets.map((asset) => asset.id),
    artifacts: result.artifacts.map(generatedArtifactSummary),
    outputCount: result.outputs?.length ?? 0,
    outputs: providerOutputsSummary(result.outputs)
  };
}

function assistantProviderRunResponse(
  result: ProviderAssistantResult,
  provider: ProviderDescriptor,
  resultText: string
) {
  return {
    providerId: result.providerId,
    providerName: result.providerName,
    provider: providerDescriptorSummary(provider),
    capabilities: result.capabilities,
    metadata: result.metadata ?? {},
    textLength: result.text.length,
    resultTextLength: resultText.length,
    outputCount: result.outputs?.length ?? 0,
    outputs: providerOutputsSummary(result.outputs)
  };
}

function evaluationProviderRunResponse(
  result: VisionEvaluationProviderResult,
  provider: ProviderDescriptor,
  artifactId: string
) {
  return {
    providerId: result.providerId,
    providerName: result.providerName,
    provider: providerDescriptorSummary(provider),
    capabilities: result.capabilities,
    metadata: result.metadata ?? {},
    itemCount: result.items.length,
    summary: result.summary,
    artifactCount: 1,
    artifactIds: [artifactId],
    outputCount: result.outputs?.length ?? 0,
    outputs: providerOutputsSummary(result.outputs)
  };
}

function providerDescriptorSummary(provider: ProviderDescriptor) {
  return {
    id: provider.id,
    name: provider.name,
    route: provider.route,
    capabilities: [...provider.capabilities],
    ...(provider.model ? { model: provider.model } : {}),
    ...(provider.notes ? { notes: [...provider.notes] } : {})
  };
}

function providerDiagnosticSummary(diagnostic: ProviderDiagnostic) {
  return {
    ...providerDescriptorSummary(diagnostic),
    availability: diagnostic.availability,
    messages: [...diagnostic.messages],
    ...(diagnostic.details ? { details: diagnostic.details } : {}),
    ...(diagnostic.readiness ? { readiness: diagnostic.readiness } : {}),
    ...(diagnostic.credentialStatus ? { credentialStatus: diagnostic.credentialStatus } : {}),
    ...(diagnostic.requestPolicy ? { requestPolicy: diagnostic.requestPolicy } : {}),
    ...(diagnostic.dataDisclosure ? { dataDisclosure: diagnostic.dataDisclosure } : {}),
    ...(diagnostic.noHiddenFallback ? { noHiddenFallback: diagnostic.noHiddenFallback } : {})
  };
}

function generatedArtifactSummary(artifact: GeneratedArtifact) {
  return {
    fileName: artifact.fileName,
    mimeType: artifact.mimeType,
    metadata: artifact.metadata ?? {},
    hasContent: artifact.content !== undefined,
    hasSourcePath: Boolean(artifact.sourcePath)
  };
}

function providerOutputsSummary(outputs: Array<Record<string, unknown>> | undefined) {
  return (outputs ?? []).map((output) => ({
    id: output.id,
    channel: output.channel,
    role: output.role,
    uri: output.uri,
    assetId: output.assetId,
    mimeType: output.mimeType,
    sourceNodeId: output.sourceNodeId,
    sourceEdgeId: output.sourceEdgeId,
    metadata: output.metadata
  }));
}

async function generatedArtifactContent(artifact: GeneratedArtifact) {
  if (artifact.content !== undefined) {
    return artifact.content;
  }

  if (artifact.sourcePath) {
    return readFile(artifact.sourcePath);
  }

  throw new Error(`Generated artifact "${artifact.fileName}" did not include content or sourcePath.`);
}

type EditInputAssembly = {
  prompt: string;
  negativePrompt: string;
  sections: PromptSectionArtifact[];
  references: GenerationReferenceInput[];
  edgeRoles: EdgeRoleArtifact[];
  sourceImage: ImageEditSourceInput;
  mask: ImageEditMaskInput;
  recipe?: ImageEditRecipeInput;
  frame?: ImageEditFrameInput;
};

function assembleEditInputs(graph: EtherGraph, editNodeId: string): EditInputAssembly {
  const editNode = findNode(graph, editNodeId);
  const sections: PromptSectionArtifact[] = [];
  const references: GenerationReferenceInput[] = [];
  const edgeRoles: EdgeRoleArtifact[] = [];
  let sourceImage: ImageEditSourceInput | null = null;
  let mask: ImageEditMaskInput = null;

  for (const edge of incomingEdges(graph, editNodeId)) {
    const source = findNode(graph, edge.source);
    const label = normalizeRoleKey(edgeLabel(edge));
    const isMaskSource = label === "mask" || source.data?.assetKind === "mask";

    if (source.data?.kind === "Prompt") {
      const assembly = assemblePromptForNode(graph, source.id, edge);

      for (const section of assembly.sections) {
        appendUniqueSection(sections, section);
      }
    }

    if (!mask && isMaskSource) {
      mask = maskFromAssetNode(source);
    }

    if (!sourceImage && !isMaskSource && isImageAssetSource(source)) {
      sourceImage = sourceImageFromAssetNode(source);
    }

    if (!isMaskSource) {
      const sourceReferences = referencesForEditSource(edge, source);
      if (sourceReferences.length > 0) {
        references.push(...sourceReferences);
        edgeRoles.push({ edgeId: edge.id, role: sourceReferences[0]!.role });
      }
    }
  }

  if (!sourceImage) {
    sourceImage = sourceImageFromNodeData(editNode.data);
  }

  if (!mask) {
    mask = maskFromNodeData(editNode.data);
  }

  const recipe = editRecipeFromNodeData(editNode.data, mask?.assetMetadata);
  const frame = editFrameFromNodeData(editNode.data, mask?.assetMetadata);

  if (!sourceImage) {
    throw new Error("Edit node requires an upstream image asset or sourceAssetPath.");
  }

  return {
    prompt: joinSections(sections, "prompt"),
    negativePrompt: joinSections(sections, "negativePrompt"),
    sections,
    references,
    edgeRoles,
    sourceImage,
    mask,
    recipe,
    frame
  };
}

function sourceImageFromNodeData(data: Partial<CanvasNodeData> | undefined): ImageEditSourceInput | null {
  if (!data?.sourceAssetPath) {
    return null;
  }

  return {
    assetId: data.sourceAssetId,
    assetKind: data.sourceAssetKind,
    assetPath: data.sourceAssetPath,
    assetMetadata: data.sourceAssetMetadata
  };
}

function sourceImageFromAssetNode(node: GraphNode): ImageEditSourceInput | null {
  const referenceAsset = referenceAssetsFromNodeData(node.data).at(0);
  const assetPath = referenceAsset?.assetPath ?? node.data?.assetPath;

  if (!assetPath) {
    return null;
  }

  return {
    assetId: referenceAsset?.assetId ?? node.data?.assetId,
    assetKind: referenceAsset?.assetKind ?? node.data?.assetKind,
    assetPath,
    assetMetadata: referenceAsset?.assetMetadata ?? node.data?.assetMetadata
  };
}

function maskFromNodeData(data: Partial<CanvasNodeData> | undefined): ImageEditMaskInput {
  if (!data?.maskAssetId && !data?.maskAssetPath) {
    return null;
  }

  return {
    assetId: data.maskAssetId,
    assetPath: data.maskAssetPath,
    assetMetadata: data.maskMetadata
  };
}

function maskFromAssetNode(node: GraphNode): ImageEditMaskInput {
  if (!node.data?.assetId && !node.data?.assetPath) {
    return null;
  }

  return {
    assetId: node.data.assetId,
    assetPath: node.data.assetPath,
    assetMetadata: node.data.assetMetadata
  };
}

function editRecipeFromNodeData(
  data: Partial<CanvasNodeData> | undefined,
  maskMetadata?: Record<string, unknown>
): ImageEditRecipeInput | undefined {
  const metadataRecipe = recordFrom(maskMetadata?.recipe);
  const id = cleanText(data?.editRecipe) || stringFrom(metadataRecipe.id);

  if (!id) {
    return undefined;
  }

  return {
    id,
    ...(stringFrom(metadataRecipe.label) ? { label: stringFrom(metadataRecipe.label) } : {}),
    ...(Object.keys(metadataRecipe).length > 0 ? { metadata: metadataRecipe } : {})
  };
}

function editFrameFromNodeData(
  data: Partial<CanvasNodeData> | undefined,
  maskMetadata?: Record<string, unknown>
): ImageEditFrameInput | undefined {
  return editFrameFromUnknown(data?.editFrame) ?? editFrameFromUnknown(recordFrom(maskMetadata?.frame));
}

function editFrameFromUnknown(value: unknown): ImageEditFrameInput | undefined {
  const frame = recordFrom(value);
  const mode = frame.mode;
  const x = numberFrom(frame.x);
  const y = numberFrom(frame.y);
  const width = numberFrom(frame.width);
  const height = numberFrom(frame.height);

  if ((mode !== "source" && mode !== "crop" && mode !== "outpaint") || x === undefined || y === undefined || width === undefined || height === undefined) {
    return undefined;
  }

  return withoutUndefined({
    mode,
    x,
    y,
    width,
    height,
    canvasWidth: numberFrom(frame.canvasWidth),
    canvasHeight: numberFrom(frame.canvasHeight)
  }) as ImageEditFrameInput;
}

function isImageAssetSource(node: GraphNode) {
  if (!node.data?.assetPath) {
    return false;
  }

  if (node.data.assetKind === "mask") {
    return false;
  }

  return node.data.kind === "Generation" || node.data.kind === "Edit" || node.data.kind === "Reference";
}

function referenceForEditAsset(
  edge: GraphEdge,
  source: GraphNode,
  role: string,
  steeringText: string,
  asset: ReferenceAssetEntry | null,
  index: number,
  total: number
): GenerationReferenceInput {
  const baseTitle = sectionTitle(source);
  const reference: GenerationReferenceInput = {
    nodeId: source.id,
    role,
    title: asset?.title || (total > 1 ? `${baseTitle} ${index + 1}` : baseTitle),
    sourceKind: cleanText(source.data?.subtype) || cleanText(source.data?.kind) || "Reference",
    ...(steeringText ? { steeringText } : {})
  };

  if (asset?.assetId) {
    reference.assetId = asset.assetId;
  }

  if (asset?.assetKind) {
    reference.assetKind = asset.assetKind;
  }

  if (asset?.assetPath) {
    reference.assetPath = asset.assetPath;
  }

  if (asset?.assetMetadata) {
    reference.assetMetadata = asset.assetMetadata;
  }

  return reference;
}

function referencesForEditSource(edge: GraphEdge, source: GraphNode): GenerationReferenceInput[] {
  if (source.data?.kind !== "Reference" && source.data?.kind !== "Note") {
    return [];
  }

  const role = resolveReferenceRole(edge, source);
  const steeringText = nodeText(source);
  const assets = referenceAssetsFromNodeData(source.data);

  if (assets.length === 0) {
    return [referenceForEditAsset(edge, source, role, steeringText, null, 0, 1)];
  }

  return assets.map((asset, index) =>
    referenceForEditAsset(edge, source, role, steeringText, asset, index, assets.length)
  );
}

function editOperationForSubtype(subtype: unknown): ImageEditOperation {
  switch (subtype) {
    case "Expand / Outpaint":
      return "outpaint";
    case "Draw & Note":
      return "draw-note";
    case "Upscale":
      return "upscale";
    case "Inpaint":
    default:
      return "inpaint";
  }
}

function localToolFromMetadata(...metadataEntries: Array<Record<string, unknown> | undefined>) {
  for (const metadata of metadataEntries) {
    const localTool = metadata?.localTool;

    if (localTool && typeof localTool === "object" && !Array.isArray(localTool)) {
      return localTool as Record<string, unknown>;
    }
  }

  return undefined;
}

function collectProviderInputPayloads(graph: EtherGraph, nodeId: string): PayloadEnvelope[] {
  return incomingEdges(graph, nodeId).flatMap((edge) => providerPayloadsForEdge(graph, edge));
}

function providerPayloadsForEdge(graph: EtherGraph, edge: GraphEdge): PayloadEnvelope[] {
  const source = findNode(graph, edge.source);
  const channel = payloadChannelForEdge(edge, source);

  if (!channel) {
    return [];
  }

  const role = resolveReferenceRole(edge, source) as PayloadEnvelope["role"];

  if (channel === "text") {
    const text = nodeText(source);

    if (!text) {
      return [];
    }

    return [
      {
        ...payloadEnvelopeBase(edge, source, channel, role),
        text
      }
    ];
  }

  if (channel === "data") {
    return [
      {
        ...payloadEnvelopeBase(edge, source, channel, role),
        data: providerDataForNode(source)
      }
    ];
  }

  return assetPayloadsForSource(edge, source, channel, role);
}

function payloadChannelForEdge(edge: GraphEdge, source: GraphNode): PayloadEnvelope["channel"] | undefined {
  const data = recordFrom(edge.data);
  return (
    providerChannelFromUnknown(data.sourceChannel) ??
    providerChannelFromUnknown((edge as Record<string, unknown>).sourceHandle) ??
    providerChannelFromUnknown(data.channel) ??
    providerChannelFromUnknown(edgeLabel(edge)) ??
    fallbackPayloadChannelForNode(source)
  );
}

function providerChannelFromUnknown(value: unknown): PayloadEnvelope["channel"] | undefined {
  const direct = normalizePayloadChannel(value);

  if (direct) {
    return direct as PayloadEnvelope["channel"];
  }

  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();

  if (!normalized) {
    return undefined;
  }

  for (const token of normalized.split(/[^a-z0-9]+/)) {
    const channel = normalizePayloadChannel(token);

    if (channel) {
      return channel as PayloadEnvelope["channel"];
    }
  }

  for (const channel of ["text", "image", "mask", "data", "video", "audio"] satisfies PayloadChannel[]) {
    if (normalized.includes(channel)) {
      return channel as PayloadEnvelope["channel"];
    }
  }

  return undefined;
}

function fallbackPayloadChannelForNode(node: GraphNode): PayloadEnvelope["channel"] | undefined {
  const assetKind = cleanText(node.data?.assetKind).toLowerCase();
  const subtype = cleanText(node.data?.subtype).toLowerCase();

  if (assetKind === "mask" || subtype.includes("mask")) {
    return "mask";
  }

  if (assetKind === "video" || subtype.includes("video")) {
    return "video";
  }

  if (assetKind === "audio" || subtype.includes("audio")) {
    return "audio";
  }

  if (node.data?.assetPath || referenceAssetsFromNodeData(node.data).length > 0) {
    return "image";
  }

  if (
    node.data?.kind === "Review" ||
    node.data?.kind === "Store" ||
    node.data?.compareArtifact ||
    node.data?.evaluationArtifact ||
    node.data?.filterResult ||
    node.data?.storeMetadata
  ) {
    return "data";
  }

  if (nodeText(node)) {
    return "text";
  }

  return undefined;
}

function assetPayloadsForSource(
  edge: GraphEdge,
  source: GraphNode,
  channel: PayloadEnvelope["channel"],
  role: PayloadEnvelope["role"]
): PayloadEnvelope[] {
  const assets = referenceAssetsFromNodeData(source.data);

  return assets.map((asset, index) => {
    const base = payloadEnvelopeBase(edge, source, channel, role, assets.length > 1 ? index : undefined);
    const steeringText = nodeText(source);

    return withoutUndefined({
      ...base,
      assetId: asset.assetId,
      assetPath: asset.assetPath,
      uri: asset.assetPath,
      mimeType: stringFrom(asset.assetMetadata?.mimeType),
      text: steeringText || undefined,
      metadata: {
        ...recordFrom(base.metadata),
        ...(asset.title ? { assetTitle: asset.title } : {}),
        ...(asset.assetKind ? { assetKind: asset.assetKind } : {}),
        ...(asset.assetMetadata ? { assetMetadata: asset.assetMetadata } : {})
      }
    }) as PayloadEnvelope;
  });
}

function payloadEnvelopeBase(
  edge: GraphEdge,
  source: GraphNode,
  channel: PayloadEnvelope["channel"],
  role: PayloadEnvelope["role"],
  index?: number
): PayloadEnvelope {
  const data = recordFrom(edge.data);
  const targetChannel = providerChannelFromUnknown(data.targetChannel) ??
    providerChannelFromUnknown((edge as Record<string, unknown>).targetHandle);

  return withoutUndefined({
    id: index === undefined ? edge.id : `${edge.id}:${index + 1}`,
    channel,
    role,
    sourceNodeId: source.id,
    sourceEdgeId: edge.id,
    metadata: withoutUndefined({
      sourceTitle: sectionTitle(source),
      sourceKind: source.data?.kind,
      sourceSubtype: source.data?.subtype,
      edgeLabel: edgeLabel(edge),
      targetChannel
    })
  }) as PayloadEnvelope;
}

function providerDataForNode(node: GraphNode): unknown {
  return withoutUndefined({
    kind: node.data?.kind,
    subtype: node.data?.subtype,
    title: sectionTitle(node),
    instruction: cleanText(node.data?.instruction) || undefined,
    notes: cleanText(node.data?.notes) || undefined,
    assetId: node.data?.assetId,
    assetKind: node.data?.assetKind,
    assetPath: node.data?.assetPath,
    assetMetadata: node.data?.assetMetadata,
    assembledPromptArtifact: node.data?.assembledPromptArtifact,
    textOutputArtifact: node.data?.textOutputArtifact,
    mutationArtifact: node.data?.mutationArtifact,
    compareArtifact: node.data?.compareArtifact,
    evaluationArtifact: node.data?.evaluationArtifact,
    filterResult: node.data?.filterResult,
    storeMetadata: node.data?.storeMetadata
  });
}

function incomingEdges(graph: EtherGraph, nodeId: string) {
  return edgesOf(graph)
    .filter((edge) => edge.target === nodeId)
    .sort(edgeSorter(graph, "source"));
}

function outgoingEdges(graph: EtherGraph, nodeId: string) {
  return edgesOf(graph)
    .filter((edge) => edge.source === nodeId)
    .sort(edgeSorter(graph, "target"));
}

function edgeLabel(edge: GraphEdge) {
  return String(edge.label ?? edge.data?.label ?? "").trim();
}

function normalizeRoleKey(value: string) {
  return value.trim().replace(/\s+/g, "-").toLowerCase();
}

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function nodeText(node: GraphNode) {
  const output = textForNode(node.data);

  if (output) {
    return output;
  }

  return [cleanText(node.data?.instruction), cleanText(node.data?.notes)].filter(Boolean).join("\n");
}

function sectionTitle(node: GraphNode) {
  return cleanText(node.data?.title) || cleanText(node.data?.label) || cleanText(node.data?.subtype) || "Reference";
}

function appendUniqueSection(sections: PromptSectionArtifact[], section: PromptSectionArtifact) {
  if (!sections.some((candidate) => candidate.nodeId === section.nodeId)) {
    sections.push(section);
  }
}

function joinSections(sections: PromptSectionArtifact[], kind: PromptSectionArtifact["kind"]) {
  return sections
    .filter((section) => section.kind === kind)
    .map((section) => `${section.section}: ${section.text}`)
    .filter(Boolean)
    .join("\n\n");
}

function setNodeData(graph: EtherGraph, nodeId: string, data: Partial<CanvasNodeData>): EtherGraph {
  const now = typeof data.lastRunAt === "string" ? data.lastRunAt : new Date().toISOString();

  return {
    ...graph,
    nodes: nodesOf(graph).map((node) =>
      node.id === nodeId
        ? {
            ...node,
            data: mergeNodeData(node.data, data)
          }
        : node
    ),
    updatedAt: now
  };
}

function mergeNodeData(
  current: Partial<CanvasNodeData> | undefined,
  updates: Partial<CanvasNodeData>
) {
  const next: Partial<CanvasNodeData> = {
    ...current,
    ...updates
  };

  for (const key of Object.keys(next) as Array<keyof CanvasNodeData>) {
    if (next[key] === undefined) {
      delete next[key];
    }
  }

  if (updates.rerunState === "complete") {
    delete next.staleSince;
  }

  return next;
}

function storeFolderName(node: GraphNode) {
  const label = node.data?.label?.trim();
  const title = node.data?.title?.trim();

  return label || title || node.id;
}

function collectUpstreamNodeIds(graph: EtherGraph, nodeId: string) {
  const seen = new Set<string>();
  const ordered: string[] = [];

  function visit(currentNodeId: string) {
    for (const sourceId of incomingSourceIds(graph, currentNodeId)) {
      if (seen.has(sourceId)) {
        continue;
      }

      seen.add(sourceId);
      visit(sourceId);
      ordered.push(sourceId);
    }
  }

  visit(nodeId);

  return ordered;
}

function collectDownstreamNodeIds(graph: EtherGraph, nodeId: string, includeSelf = true) {
  const seen = new Set<string>();
  const ordered: string[] = [];

  function visit(currentNodeId: string) {
    if (!seen.has(currentNodeId)) {
      seen.add(currentNodeId);
      if (includeSelf || currentNodeId !== nodeId) {
        ordered.push(currentNodeId);
      }
    }

    for (const targetId of outgoingTargetIds(graph, currentNodeId)) {
      if (!seen.has(targetId)) {
        visit(targetId);
      }
    }
  }

  visit(nodeId);

  return ordered;
}

function orderBySelectedDependencies(graph: EtherGraph, nodeIds: string[]) {
  const selected = new Set(nodeIds);
  const seen = new Set<string>();
  const ordered: string[] = [];

  function visit(nodeId: string) {
    if (seen.has(nodeId)) {
      return;
    }

    seen.add(nodeId);
    for (const sourceId of incomingSourceIds(graph, nodeId)) {
      if (selected.has(sourceId)) {
        visit(sourceId);
      }
    }
    ordered.push(nodeId);
  }

  for (const nodeId of nodeIds) {
    visit(nodeId);
  }

  return ordered;
}

function incomingSourceIds(graph: EtherGraph, nodeId: string) {
  return edgesOf(graph)
    .filter((edge) => edge.target === nodeId)
    .sort(edgeSorter(graph, "source"))
    .map((edge) => edge.source);
}

function outgoingTargetIds(graph: EtherGraph, nodeId: string) {
  return edgesOf(graph)
    .filter((edge) => edge.source === nodeId)
    .sort(edgeSorter(graph, "target"))
    .map((edge) => edge.target);
}

function edgeSorter(graph: EtherGraph, endpoint: "source" | "target") {
  const indexes = nodeIndexes(graph);
  const edges = edgesOf(graph);

  return (left: GraphEdge, right: GraphEdge) => {
    const leftIndex = indexes.get(left[endpoint]) ?? Number.MAX_SAFE_INTEGER;
    const rightIndex = indexes.get(right[endpoint]) ?? Number.MAX_SAFE_INTEGER;

    return leftIndex - rightIndex || edges.indexOf(left) - edges.indexOf(right);
  };
}

function orderedExistingIds(graph: EtherGraph, nodeIds: string[]) {
  const requested = new Set(nodeIds);

  return nodesOf(graph)
    .filter((node) => requested.has(node.id))
    .map((node) => node.id);
}

function uniqueInOrder(ids: string[]) {
  const seen = new Set<string>();
  const ordered: string[] = [];

  for (const id of ids) {
    if (!seen.has(id)) {
      seen.add(id);
      ordered.push(id);
    }
  }

  return ordered;
}

function findNode(graph: EtherGraph, nodeId: string): GraphNode {
  const node = nodesOf(graph).find((candidate) => candidate.id === nodeId);

  if (!node) {
    throw new Error(`Unknown graph node: ${nodeId}`);
  }

  return node;
}

function nodeIndexes(graph: EtherGraph) {
  return new Map(nodesOf(graph).map((node, index) => [node.id, index]));
}

function nodesOf(graph: EtherGraph): GraphNode[] {
  return graph.nodes as GraphNode[];
}

function edgesOf(graph: EtherGraph): GraphEdge[] {
  return graph.edges as GraphEdge[];
}

function parseMetadata(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value) as unknown;
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}
