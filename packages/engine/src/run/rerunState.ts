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
  now = new Date().toISOString()
): EtherGraph {
  const changed = new Set(changedNodeIds);
  const staleNodeIds = new Set<string>();

  for (const nodeId of changed) {
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
            data: {
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
