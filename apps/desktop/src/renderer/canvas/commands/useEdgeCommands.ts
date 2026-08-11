import { useCallback } from "react";
import { canonicalConnectionIdentity, validateConnection } from "@ether/graph-kernel";
import type { ConnectionRole, EdgeEndpoint, EtherEdge, EtherGraph, GraphOperation, PayloadChannel } from "@ether/schema";

function endpoint(graph: EtherGraph, id: string, handle: string, direction: "source" | "target"): EdgeEndpoint | undefined {
  if (!id.startsWith("module:")) return { kind: "node", nodeId: id, channel: handle as PayloadChannel };
  const moduleId = id.slice("module:".length); const module = graph.modules.find((item) => item.id === moduleId); const prefix = direction === "source" ? "out:" : "in:"; const portId = handle.startsWith(prefix) ? handle.slice(prefix.length) : handle;
  const port = direction === "source" ? module?.interface.outputs.find((item) => item.id === portId) : module?.interface.inputs.find((item) => item.id === portId);
  return port === undefined ? undefined : { kind: "module", moduleId, portId, channel: port.channel };
}
export function edgePreflightMessage(graph: EtherGraph, candidate: EtherEdge): string | null {
  const duplicate = graph.edges.find((edge) => edge.id !== candidate.id && canonicalConnectionIdentity(edge) === canonicalConnectionIdentity(candidate));
  if (duplicate !== undefined) return "DUPLICATE_LANE: An exact connection lane already exists. Change its role or output selection to keep both lanes.";
  const from = candidate.from; const to = candidate.to;
  if (from.kind !== "node" || to.kind !== "node") return null;
  const source = graph.nodes.find((node) => node.id === from.nodeId);
  const target = graph.nodes.find((node) => node.id === to.nodeId);
  if (source === undefined || target === undefined) return "EDGE_NODE_ENDPOINT_MISSING: One of the selected connection endpoints is unavailable.";
  const decision = validateConnection({
    sourceDefinitionId: source.definitionId,
    sourceChannel: candidate.from.channel,
    targetDefinitionId: target.definitionId,
    targetChannel: candidate.to.channel,
    role: candidate.role,
    adapter: candidate.adapter,
    candidate,
    existingEdges: graph.edges,
    capabilities: [],
    topology: { graphs: [graph] }
  });
  return decision.allowed ? null : `${decision.code}: ${decision.message}`;
}

export function useEdgeCommands(graph: EtherGraph, apply: (operations: GraphOperation[], title: string) => Promise<boolean>, onStatus: (message: string) => void) {
  const update = useCallback((edge: EtherEdge, title: string) => {
    const problem = edgePreflightMessage(graph, edge);
    if (problem !== null) { onStatus(problem); return Promise.resolve(false); }
    return apply([{ type: "updateEdge", graphId: graph.id, edgeId: edge.id, edge }], title);
  }, [apply, graph, onStatus]);
  const deleteEdge = useCallback((id: string) => void apply([{ type: "removeEdge", graphId: graph.id, edgeId: id }], "Delete connection"), [apply, graph.id]);
  const setRole = useCallback((id: string, role: ConnectionRole) => { const edge = graph.edges.find((item) => item.id === id); if (edge) void update({ ...edge, role }, "Change connection role"); }, [graph.edges, update]);
  const setChannel = useCallback((id: string, endpoint: "source" | "target", channel: PayloadChannel) => { const edge = graph.edges.find((item) => item.id === id); if (!edge) return; const next = endpoint === "source" ? { ...edge, from: { ...edge.from, channel } } : { ...edge, to: { ...edge.to, channel } }; void update(next, "Change connection channel"); }, [graph.edges, update]);
  const connect = useCallback(async (sourceId: string, sourceHandle: string, targetId: string, targetHandle: string): Promise<string | null> => {
    const from = endpoint(graph, sourceId, sourceHandle, "source"); const to = endpoint(graph, targetId, targetHandle, "target");
    if (from === undefined || to === undefined) { onStatus("That module port is no longer available. Refresh the canvas and try again."); return null; }
    const edge: EtherEdge = { id: crypto.randomUUID(), from, to, role: "general", order: graph.edges.length, selector: { kind: "latest-approved" }, adapter: { kind: "auto" }, enabled: true };
    const problem = edgePreflightMessage(graph, edge);
    if (problem !== null) { onStatus(problem); return null; }
    return await apply([{ type: "addEdge", graphId: graph.id, edge }], "Connect nodes") ? edge.id : null;
  }, [apply, graph, onStatus]);
  return { deleteEdge, setRole, setChannel, connect };
}
