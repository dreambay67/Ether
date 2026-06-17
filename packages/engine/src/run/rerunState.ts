import type { EtherGraph } from "../project/schema.js";
import type { CanvasNodeData } from "../graph/nodeCatalog.js";

export type RerunState = "ready" | "stale" | "running" | "complete" | "error";

type GraphNode = EtherGraph["nodes"][number] & {
  id: string;
  data?: Partial<CanvasNodeData>;
};

type GraphEdge = EtherGraph["edges"][number] & {
  source: string;
  target: string;
};

export function markDownstreamStale(
  graph: EtherGraph,
  changedNodeIds: string[],
  now = new Date().toISOString(),
  options: { includeChanged?: boolean } = {}
): EtherGraph {
  const changed = new Set(changedNodeIds);
  const staleNodeIds = new Set<string>();
  const includeChanged = options.includeChanged ?? true;

  for (const nodeId of changed) {
    if (includeChanged) {
      staleNodeIds.add(nodeId);
    }

    for (const downstreamId of collectDownstreamNodeIds(graph, nodeId, false)) {
      staleNodeIds.add(downstreamId);
    }
  }

  if (staleNodeIds.size === 0) {
    return graph;
  }

  return {
    ...graph,
    nodes: nodesOf(graph).map((node) =>
      staleNodeIds.has(node.id) && !node.data?.locked
        ? {
            ...node,
            data: changed.has(node.id) && includeChanged
              ? markChangedNodeStale(node.data, now)
              : {
                  ...node.data,
                  rerunState: "stale",
                  staleSince: now
                }
          }
        : node
    ),
    updatedAt: now
  };
}

function markChangedNodeStale(data: Partial<CanvasNodeData> | undefined, now: string) {
  const shouldMarkStale =
    data?.rerunState === "complete" ||
    data?.rerunState === "stale" ||
    data?.status === "complete" ||
    hasExecutionArtifact(data);
  const next: Partial<CanvasNodeData> = {
    ...data,
    rerunState: shouldMarkStale ? "stale" : "ready",
    staleSince: shouldMarkStale ? now : undefined,
    artifactKind: undefined,
    assembledPrompt: undefined,
    assembledNegativePrompt: undefined,
    assembledPromptArtifact: undefined,
    lastRunAt: undefined,
    assetId: undefined,
    assetKind: undefined,
    assetPath: undefined,
    assetMetadata: undefined,
    storeAssetId: undefined,
    storePath: undefined,
    storeMetadata: undefined,
    lastMovedAssetId: undefined,
    lastMovedAssetPath: undefined,
    lastMovedAt: undefined
  };

  for (const key of Object.keys(next) as Array<keyof CanvasNodeData>) {
    if (next[key] === undefined) {
      delete next[key];
    }
  }

  return next;
}

function hasExecutionArtifact(data: Partial<CanvasNodeData> | undefined) {
  return Boolean(
    data?.assembledPrompt ||
      data?.assembledPromptArtifact ||
      data?.assetId ||
      data?.assetPath ||
      data?.storeAssetId ||
      data?.storePath
  );
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

function outgoingTargetIds(graph: EtherGraph, nodeId: string) {
  const indexes = nodeIndexes(graph);
  const edges = edgesOf(graph);

  return edges
    .filter((edge) => edge.source === nodeId)
    .sort((left, right) => {
      const leftIndex = indexes.get(left.target) ?? Number.MAX_SAFE_INTEGER;
      const rightIndex = indexes.get(right.target) ?? Number.MAX_SAFE_INTEGER;

      return leftIndex - rightIndex || edges.indexOf(left) - edges.indexOf(right);
    })
    .map((edge) => edge.target);
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
