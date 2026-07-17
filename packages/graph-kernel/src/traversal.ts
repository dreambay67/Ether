import type { EtherGraph } from "@ether/schema";
import { expandModuleBoundaries, validateGraphSet } from "./modules.js";
import { getNodeDefinition } from "./registry.js";

export function planTraversal(graphs: readonly EtherGraph[], rootGraphId: string): { nodeIds: string[]; edgeIds: string[] } {
  const diagnostics = validateGraphSet(graphs);
  if (diagnostics.length > 0) throw new Error(diagnostics.map((item) => `${item.code}: ${item.message}`).join("\n"));
  const byId = new Map(graphs.map((graph) => [graph.id, graph]));
  const reachable: EtherGraph[] = [];
  const visit = (graphId: string): void => {
    const graph = byId.get(graphId);
    if (graph === undefined) throw new Error(`Unknown traversal root graph: ${graphId}`);
    if (reachable.some((item) => item.id === graphId)) return;
    reachable.push(graph);
    graph.modules.forEach((module) => visit(module.graphId));
  };
  visit(rootGraphId);
  const nodes = reachable
    .flatMap((graph) => graph.nodes)
    .filter((node) => getNodeDefinition(node.definitionId).executor !== "non-runnable");
  const executableNodeIds = new Set(nodes.map((node) => node.id));
  const nodeOrder = new Map(nodes.map((node, index) => [node.id, index]));
  const edges = expandModuleBoundaries(reachable).filter((edge) =>
    edge.enabled
    && edge.from.kind === "node"
    && edge.to.kind === "node"
    && executableNodeIds.has(edge.from.nodeId)
    && executableNodeIds.has(edge.to.nodeId)
  );
  const indegree = new Map(nodes.map((node) => [node.id, 0]));
  const outgoing = new Map(nodes.map((node) => [node.id, [] as string[]]));
  for (const edge of edges) {
    if (edge.from.kind !== "node" || edge.to.kind !== "node") continue;
    indegree.set(edge.to.nodeId, (indegree.get(edge.to.nodeId) ?? 0) + 1);
    outgoing.get(edge.from.nodeId)?.push(edge.to.nodeId);
  }
  const ready = nodes.filter((node) => indegree.get(node.id) === 0).map((node) => node.id);
  const sortReady = (): void => { ready.sort((left, right) => (nodeOrder.get(left)! - nodeOrder.get(right)!) || left.localeCompare(right)); };
  sortReady();
  const ordered: string[] = [];
  while (ready.length > 0) {
    const nodeId = ready.shift()!;
    ordered.push(nodeId);
    for (const targetId of outgoing.get(nodeId) ?? []) {
      const next = indegree.get(targetId)! - 1;
      indegree.set(targetId, next);
      if (next === 0) { ready.push(targetId); sortReady(); }
    }
  }
  if (ordered.length !== nodes.length) throw new Error("Graph contains an execution cycle across node or module boundaries.");
  return { nodeIds: ordered, edgeIds: edges.map((edge) => edge.id).sort() };
}
