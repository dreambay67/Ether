import Database from "better-sqlite3";
import {
  FAKE_PROVIDER_ID,
  ProviderUnavailableError,
  createDefaultProviderRegistry,
  diagnoseProviderRegistry,
  type GeneratedArtifact,
  type GenerationProviderInput,
  type GenerationReferenceInput,
  type ImageEditMaskInput,
  type ImageEditOperation,
  type ImageEditProviderInput,
  type ImageEditSourceInput,
  type ProviderRegistryDiagnostics
} from "@ether/providers";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  ensureCollectionFolder,
  ensureDirectoryRoot,
  saveGeneratedAsset,
  type AssetRecord
} from "../project/assets.js";
import { initializeDatabase } from "../project/database.js";
import { projectPaths } from "../project/paths.js";
import type { EtherGraph } from "../project/schema.js";
import {
  assembleGenerationInputs,
  assemblePromptForNode,
  freezePromptNode,
  resolveReferenceRole
} from "../graph/promptAssembly.js";
import type { CanvasNodeData } from "../graph/nodeCatalog.js";
import type { EdgeRoleArtifact, PromptSectionArtifact } from "../graph/artifacts.js";
import {
  createTextMutationArtifact,
  textForNode
} from "../graph/textMutation.js";

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

type MutableExecutionState = {
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
  const state: MutableExecutionState = { graph };
  const results = await runExecutionQueue(
    plan.items,
    (item) => executeQueueItem(projectPath, state, request, item),
    { parallel: plan.parallel, dependencies: queueDependenciesForPlan(graph, plan.items) }
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
  const db = new Database(databasePath, { readonly: true });

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

function queueDependenciesForPlan(graph: EtherGraph, items: ExecutionQueueItem[]) {
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

async function executeQueueItem(
  projectPath: string,
  state: MutableExecutionState,
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
        result = executePromptNode(state, item, startedAt);
        break;
      case "Assistant":
        result = executeAssistantNode(state, item, startedAt);
        break;
      case "Generation":
        result = await executeGenerationNode(projectPath, state, request, item, startedDate);
        break;
      case "Edit":
        result = await executeEditNode(projectPath, state, request, item, startedDate);
        break;
      case "Store":
        result = await executeStoreNode(projectPath, state, item, startedDate);
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

function executePromptNode(
  state: MutableExecutionState,
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

function executeAssistantNode(
  state: MutableExecutionState,
  item: ExecutionQueueItem,
  startedAt: string
): ExecutionNodeResult {
  const node = findNode(state.graph, item.nodeId);
  const sourceText = assembleAssistantSourceText(state.graph, item.nodeId) || nodeText(node) || node.data?.title || "Assistant context";
  const operation = `Assistant ${cleanText(node.data?.subtype) || "Text"}`;
  const mutationArtifact = createTextMutationArtifact(sourceText, node.data, {
    kind: "assistant-text",
    operation
  });
  const resultText = assistantTextForSubtype(cleanText(node.data?.subtype), mutationArtifact.resultText);
  const textOutputArtifact = {
    ...mutationArtifact,
    resultText
  };

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
    action: "assistant-text",
    metadata: {
      text: textOutputArtifact
    },
    startedAt,
    finishedAt: startedAt
  };
}

function assembleAssistantSourceText(graph: EtherGraph, assistantNodeId: string) {
  const sections: string[] = [];

  for (const edge of incomingEdges(graph, assistantNodeId)) {
    const source = findNode(graph, edge.source);

    if (source.data?.kind === "Prompt" || source.data?.kind === "Assistant") {
      const assembly = assemblePromptForNode(graph, source.id, edge);
      sections.push(assembly.prompt, assembly.negativePrompt);
      continue;
    }

    sections.push(nodeText(source));
  }

  return sections.map(cleanText).filter(Boolean).join("\n\n");
}

function assistantTextForSubtype(subtype: string, resultText: string) {
  switch (subtype) {
    case "Brainstormer":
      return `Brainstorm routes\n${resultText}`;
    case "Expander":
      return `Expanded prompt\n${resultText}`;
    case "Reinforcer":
      return `Reinforced direction\n${resultText}`;
    case "Mutator":
    default:
      return resultText;
  }
}

async function executeGenerationNode(
  projectPath: string,
  state: MutableExecutionState,
  request: ExecutionRequest,
  item: ExecutionQueueItem,
  startedDate: Date
): Promise<ExecutionNodeResult> {
  const assembly = assembleGenerationInputs(state.graph, item.nodeId);
  const startedAt = startedDate.toISOString();
  const registry = createDefaultProviderRegistry();
  const providerId = request.providerId ?? FAKE_PROVIDER_ID;
  const provider = registry.require(providerId);
  const diagnostic = await provider.diagnose();

  if (diagnostic.availability !== "available") {
    throw new ProviderUnavailableError(diagnostic);
  }

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
    requestedAt: startedAt
  };
  const providerResult = await provider.generate(providerInput);
  const providerDescriptor = provider.descriptor;

  if (providerResult.artifacts.length === 0) {
    throw new Error(`Generation provider "${providerId}" returned no image artifacts.`);
  }

  const assets: AssetRecord[] = [];

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
          edgeRoles: assembly.edgeRoles
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
  state: MutableExecutionState,
  request: ExecutionRequest,
  item: ExecutionQueueItem,
  startedDate: Date
): Promise<ExecutionNodeResult> {
  const node = findNode(state.graph, item.nodeId);
  const assembly = assembleEditInputs(state.graph, item.nodeId);
  const startedAt = startedDate.toISOString();
  const registry = createDefaultProviderRegistry();
  const providerId = request.providerId ?? FAKE_PROVIDER_ID;
  const provider = registry.require(providerId);
  const diagnostic = await provider.diagnose();

  if (diagnostic.availability !== "available") {
    throw new ProviderUnavailableError(diagnostic);
  }

  if (!diagnostic.capabilities.includes("image.edit")) {
    throw new Error(`Provider "${providerId}" does not support image.edit.`);
  }

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
    requestedAt: startedAt
  };
  const providerResult = await provider.edit(providerInput);
  const providerDescriptor = provider.descriptor;

  if (providerResult.artifacts.length === 0) {
    throw new Error(`Edit provider "${providerId}" returned no image artifacts.`);
  }

  const assets: AssetRecord[] = [];

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
          ...(localTool ? { localTool } : {})
        },
        now: startedDate
      })
    );
  }

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
    maskMetadata: assembly.mask?.assetMetadata
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
  state: MutableExecutionState,
  item: ExecutionQueueItem,
  startedDate: Date
): Promise<ExecutionNodeResult> {
  const node = findNode(state.graph, item.nodeId);
  const finishedAt = startedDate.toISOString();
  let asset: AssetRecord | null = null;
  let action = "skip-store";

  if (node.data?.subtype === "Collection") {
    asset = await ensureCollectionFolder(projectPath, {
      name: storeFolderName(node),
      nodeId: node.id,
      now: startedDate
    });
    action = "ensure-collection";
  } else if (node.data?.subtype === "Directory") {
    asset = await ensureDirectoryRoot(projectPath, {
      name: storeFolderName(node),
      nodeId: node.id,
      now: startedDate
    });
    action = "ensure-directory";
  } else {
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

function skipUnsupportedNode(
  state: MutableExecutionState,
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

function canExecuteLocally(node: GraphNode) {
  switch (node.data?.kind) {
    case "Prompt":
    case "Assistant":
    case "Generation":
    case "Edit":
      return true;
    case "Store":
      return node.data.subtype === "Collection" || node.data.subtype === "Directory";
    default:
      return false;
  }
}

function unsupportedNodeLabel(node: GraphNode) {
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
  const db = new Database(databasePath);

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

    if (source.data?.kind === "Prompt") {
      const assembly = assemblePromptForNode(graph, source.id, edge);

      for (const section of assembly.sections) {
        appendUniqueSection(sections, section);
      }
    }

    if (!mask && (label === "mask" || source.data?.assetKind === "mask")) {
      mask = maskFromAssetNode(source);
    }

    if (!sourceImage && label !== "mask" && isImageAssetSource(source)) {
      sourceImage = sourceImageFromAssetNode(source);
    }

    const reference = referenceForEditSource(edge, source);
    if (reference) {
      references.push(reference);
      edgeRoles.push({ edgeId: edge.id, role: reference.role });
    }
  }

  if (!sourceImage) {
    sourceImage = sourceImageFromNodeData(editNode.data);
  }

  if (!mask) {
    mask = maskFromNodeData(editNode.data);
  }

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
    mask
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
  if (!node.data?.assetPath) {
    return null;
  }

  return {
    assetId: node.data.assetId,
    assetKind: node.data.assetKind,
    assetPath: node.data.assetPath,
    assetMetadata: node.data.assetMetadata
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

function isImageAssetSource(node: GraphNode) {
  if (!node.data?.assetPath) {
    return false;
  }

  if (node.data.assetKind === "mask") {
    return false;
  }

  return node.data.kind === "Generation" || node.data.kind === "Edit" || node.data.kind === "Reference";
}

function referenceForEditSource(edge: GraphEdge, source: GraphNode): GenerationReferenceInput | null {
  if (source.data?.kind !== "Reference" && source.data?.kind !== "Note") {
    return null;
  }

  const role = resolveReferenceRole(edge, source);
  const steeringText = nodeText(source);
  const reference: GenerationReferenceInput = {
    nodeId: source.id,
    role,
    title: sectionTitle(source),
    sourceKind: cleanText(source.data?.subtype) || cleanText(source.data?.kind) || "Reference",
    ...(steeringText ? { steeringText } : {})
  };

  if (source.data?.assetId) {
    reference.assetId = source.data.assetId;
  }

  if (source.data?.assetKind) {
    reference.assetKind = source.data.assetKind;
  }

  if (source.data?.assetPath) {
    reference.assetPath = source.data.assetPath;
  }

  if (source.data?.assetMetadata) {
    reference.assetMetadata = source.data.assetMetadata;
  }

  return reference;
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

function incomingEdges(graph: EtherGraph, nodeId: string) {
  return edgesOf(graph)
    .filter((edge) => edge.target === nodeId)
    .sort(edgeSorter(graph, "source"));
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
    .map((section) => section.text)
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
