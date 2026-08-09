import {
  expandModuleBoundaries,
  getNodeDefinition,
  validateGraphSet,
  type KernelNodeDefinition
} from "@ether/graph-kernel";
import type {
  EtherEdge,
  EtherGraph,
  EtherNode,
  ExecutionScope,
  NodeExecutorKind
} from "@ether/schema";

export type DownstreamExecutionScope = Extract<ExecutionScope, { kind: "downstream" }>;

export type RefreshUpstreamExecutionScope = {
  kind: "refresh-upstream";
  nodeId?: string;
  targetNodeId?: string;
};

export type PlannerExecutionScope =
  | ExecutionScope
  | RefreshUpstreamExecutionScope;

export type PlannerNode = EtherNode & {
  definition: KernelNodeDefinition;
};

export type PlannerTopology = {
  graphs: EtherGraph[];
  nodes: PlannerNode[];
  edges: EtherEdge[];
  nodeById: Map<string, PlannerNode>;
  incoming: Map<string, EtherEdge[]>;
  outgoing: Map<string, EtherEdge[]>;
  nodeOrder: Map<string, number>;
  topologicalNodeIds: string[];
};

export type ScopeResolution = {
  nodeIds: string[];
  targetNodeIds: string[];
  upstreamNodeIds: string[];
  downstreamNodeIds: string[];
};

const resolverDefinitionIds = new Set([
  "prompt.text",
  "reference.set",
  "canvas.note",
  "flow.variables",
  "flow.batch"
]);

export class ScopeResolutionError extends Error {
  readonly code:
    | "INVALID_GRAPH"
    | "UNKNOWN_SCOPE_NODE"
    | "INVALID_SCOPE"
    | "GRAPH_CYCLE";

  constructor(
    code: ScopeResolutionError["code"],
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "ScopeResolutionError";
    this.code = code;
  }
}

export function createPlannerTopology(
  graph: EtherGraph,
  graphs: readonly EtherGraph[] = [graph]
): PlannerTopology {
  const graphSet = reachableGraphs(graph, graphs);
  const diagnostics = validateGraphSet(graphSet);
  if (diagnostics.length > 0) {
    throw new ScopeResolutionError(
      "INVALID_GRAPH",
      diagnostics
        .map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`)
        .join("\n")
    );
  }

  let expandedEdges: EtherEdge[];
  try {
    expandedEdges = expandModuleBoundaries(graphSet);
  } catch (error) {
    throw new ScopeResolutionError(
      "INVALID_GRAPH",
      error instanceof Error ? error.message : String(error),
      { cause: error }
    );
  }

  const nodes = graphSet
    .flatMap((candidate) => candidate.nodes)
    .map((node) => ({ ...node, definition: getNodeDefinition(node.definitionId) }));
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const nodeOrder = new Map(nodes.map((node, index) => [node.id, index]));
  const edges = expandedEdges
    .filter((edge) => edge.enabled && edge.from.kind === "node" && edge.to.kind === "node")
    .sort((left, right) => edgeOrder(left, right));
  const incoming = new Map<string, EtherEdge[]>();
  const outgoing = new Map<string, EtherEdge[]>();

  for (const edge of edges) {
    if (edge.from.kind !== "node" || edge.to.kind !== "node") continue;
    if (!nodeById.has(edge.from.nodeId) || !nodeById.has(edge.to.nodeId)) {
      throw new ScopeResolutionError(
        "INVALID_GRAPH",
        `Enabled edge ${edge.id} references a node outside the reachable graph set.`
      );
    }
    const incomingEdges = incoming.get(edge.to.nodeId) ?? [];
    incomingEdges.push(edge);
    incoming.set(edge.to.nodeId, incomingEdges);
    const outgoingEdges = outgoing.get(edge.from.nodeId) ?? [];
    outgoingEdges.push(edge);
    outgoing.set(edge.from.nodeId, outgoingEdges);
  }

  const topologicalNodeIds = topologicalOrder(nodes, edges, nodeOrder);
  return {
    graphs: graphSet,
    nodes,
    edges,
    nodeById,
    incoming,
    outgoing,
    nodeOrder,
    topologicalNodeIds
  };
}

export function resolveExecutionScope(
  topology: PlannerTopology,
  scope: PlannerExecutionScope
): ScopeResolution {
  const allRunnable = new Set(
    topology.nodes
      .filter(isPlanStepNode)
      .map((node) => node.id)
  );

  const targetIds = scopeTargetIds(scope);
  for (const nodeId of targetIds) requireNode(topology, nodeId);
  if (scope.kind === "batch") requireBatchNode(topology, scope.batchNodeId);

  const rootNodeId = rootForScope(scope);
  if (rootNodeId !== null) requireNode(topology, rootNodeId);

  const downstreamNodeIds = rootNodeId === null
    ? []
    : collectReachable(topology.outgoing, rootNodeId, true);
  const upstreamNodeIds = rootNodeId === null
    ? []
    : collectReachable(topology.incoming, rootNodeId, false, true);

  let selected: Set<string>;
  switch (scope.kind) {
    case "graph":
      selected = allRunnable;
      break;
    case "node":
      selected = new Set(allRunnable.has(scope.nodeId) ? [scope.nodeId] : []);
      break;
    case "selected":
      selected = new Set(scope.nodeIds.filter((nodeId) => allRunnable.has(nodeId)));
      break;
    case "branch":
      selected = new Set(downstreamNodeIds.filter((nodeId) => allRunnable.has(nodeId)));
      break;
    case "downstream":
      selected = new Set(
        downstreamNodeIds
          .filter((nodeId) => scope.includeRoot !== false || nodeId !== scope.rootNodeId)
          .filter((nodeId) => allRunnable.has(nodeId))
      );
      break;
    case "batch":
      // Batch is a resolver boundary, not a plan step. Its downstream branch is
      // planned while its upstream inputs remain cached input boundaries.
      selected = new Set(downstreamNodeIds.filter((nodeId) => allRunnable.has(nodeId)));
      break;
    case "refresh-upstream":
      selected = new Set(
        [...upstreamNodeIds, ...(rootNodeId === null ? [] : [rootNodeId])]
          .filter((nodeId) => allRunnable.has(nodeId))
      );
      break;
    case "recipe":
      throw new ScopeResolutionError(
        "INVALID_SCOPE",
        `Recipe scope ${scope.recipeInstanceId} must be expanded before plan compilation.`
      );
    default:
      throw new ScopeResolutionError("INVALID_SCOPE", "Unsupported execution scope.");
  }

  const orderedNodeIds = topology.topologicalNodeIds.filter((nodeId) => selected.has(nodeId));
  return {
    nodeIds: orderedNodeIds,
    targetNodeIds: targetIds,
    upstreamNodeIds: topology.topologicalNodeIds.filter((nodeId) => upstreamNodeIds.includes(nodeId)),
    downstreamNodeIds: topology.topologicalNodeIds.filter((nodeId) => downstreamNodeIds.includes(nodeId))
  };
}

export function resolveScope(
  graph: EtherGraph,
  scope: PlannerExecutionScope,
  graphs: readonly EtherGraph[] = [graph]
): string[] {
  return resolveExecutionScope(createPlannerTopology(graph, graphs), scope).nodeIds;
}

export const resolveScopeNodeIds = resolveScope;

export function isPlanStepNode(node: PlannerNode): boolean {
  return node.definition.executor !== "non-runnable" && !resolverDefinitionIds.has(node.definitionId);
}

export function isRunnableExecutor(executor: NodeExecutorKind): boolean {
  return executor !== "non-runnable";
}

function reachableGraphs(root: EtherGraph, graphs: readonly EtherGraph[]): EtherGraph[] {
  const byId = new Map(graphs.map((candidate) => [candidate.id, candidate]));
  if (!byId.has(root.id)) byId.set(root.id, root);
  const result: EtherGraph[] = [];
  const visiting = new Set<string>();
  const visit = (graphId: string): void => {
    if (visiting.has(graphId)) {
      throw new ScopeResolutionError("INVALID_GRAPH", `Module ownership cycle reaches graph ${graphId}.`);
    }
    if (result.some((candidate) => candidate.id === graphId)) return;
    const candidate = byId.get(graphId);
    if (candidate === undefined) {
      throw new ScopeResolutionError("INVALID_GRAPH", `Unknown graph ${graphId} in module subtree.`);
    }
    visiting.add(graphId);
    result.push(candidate);
    for (const module of candidate.modules) visit(module.graphId);
    visiting.delete(graphId);
  };
  visit(root.id);
  return result;
}

function topologicalOrder(
  nodes: readonly PlannerNode[],
  edges: readonly EtherEdge[],
  nodeOrder: ReadonlyMap<string, number>
): string[] {
  const indegree = new Map(nodes.map((node) => [node.id, 0]));
  const outgoing = new Map<string, string[]>();
  for (const edge of edges) {
    if (edge.from.kind !== "node" || edge.to.kind !== "node") continue;
    indegree.set(edge.to.nodeId, (indegree.get(edge.to.nodeId) ?? 0) + 1);
    const targets = outgoing.get(edge.from.nodeId) ?? [];
    targets.push(edge.to.nodeId);
    outgoing.set(edge.from.nodeId, targets);
  }

  const ready = nodes
    .filter((node) => indegree.get(node.id) === 0)
    .map((node) => node.id);
  const sortReady = (): void => {
    ready.sort((left, right) => (nodeOrder.get(left)! - nodeOrder.get(right)!) || left.localeCompare(right));
  };
  sortReady();
  const ordered: string[] = [];
  while (ready.length > 0) {
    const nodeId = ready.shift()!;
    ordered.push(nodeId);
    for (const targetId of outgoing.get(nodeId) ?? []) {
      const next = (indegree.get(targetId) ?? 0) - 1;
      indegree.set(targetId, next);
      if (next === 0) {
        ready.push(targetId);
        sortReady();
      }
    }
  }
  if (ordered.length !== nodes.length) {
    throw new ScopeResolutionError(
      "GRAPH_CYCLE",
      "Graph contains an execution cycle across enabled node edges."
    );
  }
  return ordered;
}

function collectReachable(
  adjacency: ReadonlyMap<string, readonly EtherEdge[]>,
  rootNodeId: string,
  includeRoot: boolean,
  reverse = false
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  const visit = (nodeId: string): void => {
    if (seen.has(nodeId)) return;
    seen.add(nodeId);
    if (includeRoot || nodeId !== rootNodeId) result.push(nodeId);
    for (const edge of adjacency.get(nodeId) ?? []) {
      const next = reverse
        ? edge.from.kind === "node" ? edge.from.nodeId : undefined
        : edge.to.kind === "node" ? edge.to.nodeId : undefined;
      if (next !== undefined) visit(next);
    }
  };
  visit(rootNodeId);
  return result;
}

function targetForScope(scope: RefreshUpstreamExecutionScope): string {
  const target = scope.nodeId ?? scope.targetNodeId;
  if (target === undefined || target.length === 0) {
    throw new ScopeResolutionError(
      "INVALID_SCOPE",
      "Refresh-upstream scope requires nodeId or targetNodeId."
    );
  }
  return target;
}

function scopeTargetIds(scope: PlannerExecutionScope): string[] {
  switch (scope.kind) {
    case "node":
      return [scope.nodeId];
    case "selected":
      return [...scope.nodeIds];
    case "branch":
    case "downstream":
      return [scope.rootNodeId];
    case "batch":
      return [scope.batchNodeId];
    case "refresh-upstream":
      return [targetForScope(scope)];
    case "graph":
    case "recipe":
      return [];
    default:
      return [];
  }
}

function rootForScope(scope: PlannerExecutionScope): string | null {
  switch (scope.kind) {
    case "branch":
    case "downstream":
      return scope.rootNodeId;
    case "batch":
      return scope.batchNodeId;
    case "refresh-upstream":
      return targetForScope(scope);
    case "node":
      return scope.nodeId;
    default:
      return null;
  }
}

function requireNode(topology: PlannerTopology, nodeId: string): void {
  if (!topology.nodeById.has(nodeId)) {
    throw new ScopeResolutionError("UNKNOWN_SCOPE_NODE", `Execution scope references unknown node ${nodeId}.`);
  }
}

function requireBatchNode(topology: PlannerTopology, nodeId: string): void {
  const node = topology.nodeById.get(nodeId);
  if (node?.config.kind !== "flow.batch") {
    throw new ScopeResolutionError(
      "INVALID_SCOPE",
      `Batch execution scope requires a flow.batch node; ${nodeId} is ${node?.definitionId ?? "unknown"}.`
    );
  }
}

function edgeOrder(left: EtherEdge, right: EtherEdge): number {
  return left.order - right.order || left.id.localeCompare(right.id);
}
