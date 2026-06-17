import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
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
import { assembleGenerationInputs, freezePromptNode } from "../graph/promptAssembly.js";
import type { CanvasNodeData } from "../graph/nodeCatalog.js";

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
  now?: () => Date;
};

export type ExecutionQueueItem = {
  nodeId: string;
  iteration: number;
};

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

const fakeProvider = "ether-fake-local";

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
  options: { parallel?: boolean } = {}
): Promise<T[]> {
  if (options.parallel) {
    return Promise.all(items.map((item) => runner(item)));
  }

  const results: T[] = [];

  for (const item of items) {
    results.push(await runner(item));
  }

  return results;
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
    { parallel: plan.parallel }
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
  const generationBudget =
    typeof runCountCap === "number" ? Math.max(0, Math.floor(runCountCap)) : undefined;
  let remainingGenerations = generationBudget;

  for (const nodeId of nodeIds) {
    const node = findNode(graph, nodeId);

    if (node.data?.kind !== "Generation") {
      items.push({ nodeId, iteration: 1 });
      continue;
    }

    const repetitions = remainingGenerations === undefined ? 1 : remainingGenerations;

    for (let iteration = 1; iteration <= repetitions; iteration += 1) {
      items.push({ nodeId, iteration });
    }

    if (remainingGenerations !== undefined) {
      remainingGenerations = 0;
    }
  }

  return items;
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
    return {
      nodeId: item.nodeId,
      iteration: item.iteration,
      status: "skipped",
      action: "locked",
      reason: "Node is locked",
      startedAt,
      finishedAt: startedAt
    };
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
      case "Generation":
        result = await executeGenerationNode(projectPath, state, request, item, startedDate);
        break;
      case "Store":
        result = await executeStoreNode(projectPath, state, item, startedDate);
        break;
      default:
        result = skipUnsupportedNode(state, item, startedAt, node.data?.kind ?? "Unknown");
        break;
    }

    return result;
  } catch (error) {
    const finishedAt = (request.now?.() ?? new Date()).toISOString();
    state.graph = setNodeData(state.graph, item.nodeId, {
      status: "error",
      rerunState: "error",
      lastRunAt: finishedAt
    });

    return {
      nodeId: item.nodeId,
      iteration: item.iteration,
      status: "error",
      action: "execute",
      reason: error instanceof Error ? error.message : "Execution failed",
      startedAt,
      finishedAt
    };
  }
}

function executePromptNode(
  state: MutableExecutionState,
  item: ExecutionQueueItem,
  startedAt: string
): ExecutionNodeResult {
  state.graph = freezePromptNode(state.graph, item.nodeId, startedAt);
  state.graph = setNodeData(state.graph, item.nodeId, {
    rerunState: "complete"
  });

  return {
    nodeId: item.nodeId,
    iteration: item.iteration,
    status: "complete",
    action: "assemble-prompt",
    startedAt,
    finishedAt: startedAt
  };
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
  const asset = await saveGeneratedAsset(projectPath, {
    generationNodeId: item.nodeId,
    fileName: `fake-output-${item.nodeId}-${item.iteration}.txt`,
    content: fakeGeneratedContent(item.nodeId, item.iteration, assembly),
    mimeType: "text/plain",
    lineage: {
      provider: fakeProvider,
      policy: request.policy,
      iteration: item.iteration,
      prompt: assembly.prompt,
      negativePrompt: assembly.negativePrompt,
      sections: assembly.sections,
      references: assembly.references,
      edgeRoles: assembly.edgeRoles
    },
    metadata: {
      provider: fakeProvider,
      policy: request.policy,
      iteration: item.iteration
    },
    now: startedDate
  });
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
  insertRunRecord(projectPath, {
    status: "complete",
    graphNodeId: item.nodeId,
    metadata: {
      provider: fakeProvider,
      policy: request.policy,
      iteration: item.iteration,
      assetId: asset.id,
      assetPath: asset.path,
      prompt: assembly.prompt,
      negativePrompt: assembly.negativePrompt,
      references: assembly.references
    },
    startedAt,
    finishedAt
  });

  return {
    nodeId: item.nodeId,
    iteration: item.iteration,
    status: "complete",
    action: "fake-generate",
    assetId: asset.id,
    assetPath: asset.path,
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
  state.graph = setNodeData(state.graph, item.nodeId, {
    status: "complete",
    rerunState: "complete",
    lastRunAt: now
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

function fakeGeneratedContent(
  nodeId: string,
  iteration: number,
  assembly: ReturnType<typeof assembleGenerationInputs>
) {
  return [
    "ETHER_FAKE_GENERATED_ASSET",
    `provider=${fakeProvider}`,
    `nodeId=${nodeId}`,
    `iteration=${iteration}`,
    `prompt=${assembly.prompt}`,
    `negativePrompt=${assembly.negativePrompt}`,
    `references=${JSON.stringify(assembly.references)}`
  ].join("\n");
}

function setNodeData(graph: EtherGraph, nodeId: string, data: Partial<CanvasNodeData>): EtherGraph {
  const now = typeof data.lastRunAt === "string" ? data.lastRunAt : new Date().toISOString();

  return {
    ...graph,
    nodes: nodesOf(graph).map((node) =>
      node.id === nodeId
        ? {
            ...node,
            data: {
              ...node.data,
              ...data
            }
          }
        : node
    ),
    updatedAt: now
  };
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
