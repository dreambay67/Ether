import { useCallback } from "react";
import type { ConnectionRole, EdgeEndpoint, EtherEdge, EtherGraph, GraphOperation, PayloadChannel } from "@ether/schema";

function endpoint(graph: EtherGraph, id: string, handle: string, direction: "source" | "target"): EdgeEndpoint | undefined {
  if (!id.startsWith("module:")) return { kind: "node", nodeId: id, channel: handle as PayloadChannel };
  const moduleId = id.slice("module:".length); const module = graph.modules.find((item) => item.id === moduleId); const prefix = direction === "source" ? "out:" : "in:"; const portId = handle.startsWith(prefix) ? handle.slice(prefix.length) : handle;
  const port = direction === "source" ? module?.interface.outputs.find((item) => item.id === portId) : module?.interface.inputs.find((item) => item.id === portId);
  return port === undefined ? undefined : { kind: "module", moduleId, portId, channel: port.channel };
}
function sameEndpoint(left: EdgeEndpoint, right: EdgeEndpoint) { return left.kind === "node" && right.kind === "node" ? left.nodeId === right.nodeId && left.channel === right.channel : left.kind === "module" && right.kind === "module" ? left.moduleId === right.moduleId && left.portId === right.portId && left.channel === right.channel : false; }

export function useEdgeCommands(graph: EtherGraph, apply: (operations: GraphOperation[], title: string) => Promise<boolean>, onStatus: (message: string) => void) {
  const update = useCallback((edge: EtherEdge, title: string) => apply([{ type: "updateEdge", graphId: graph.id, edgeId: edge.id, edge }], title), [apply, graph.id]);
  const deleteEdge = useCallback((id: string) => void apply([{ type: "removeEdge", graphId: graph.id, edgeId: id }], "Delete connection"), [apply, graph.id]);
  const setRole = useCallback((id: string, role: ConnectionRole) => { const edge = graph.edges.find((item) => item.id === id); if (edge) void update({ ...edge, role }, "Change connection role"); }, [graph.edges, update]);
  const setChannel = useCallback((id: string, endpoint: "source" | "target", channel: PayloadChannel) => { const edge = graph.edges.find((item) => item.id === id); if (!edge) return; const next = endpoint === "source" ? { ...edge, from: { ...edge.from, channel } } : { ...edge, to: { ...edge.to, channel } }; void update(next, "Change connection channel"); }, [graph.edges, update]);
  const connect = useCallback((sourceId: string, sourceHandle: string, targetId: string, targetHandle: string) => {
    const from = endpoint(graph, sourceId, sourceHandle, "source"); const to = endpoint(graph, targetId, targetHandle, "target");
    if (from === undefined || to === undefined) { onStatus("That module port is no longer available. Refresh the canvas and try again."); return; }
    const duplicate = graph.edges.find((edge) => sameEndpoint(edge.from, from) && sameEndpoint(edge.to, to) && edge.role === "general" && edge.selector.kind === "latest-approved");
    if (duplicate) { onStatus("An exact connection lane already exists. Change its role or selector to create a distinct lane."); return; }
    const edge: EtherEdge = { id: crypto.randomUUID(), from, to, role: "general", order: graph.edges.length, selector: { kind: "latest-approved" }, adapter: { kind: "auto" }, enabled: true };
    void apply([{ type: "addEdge", graphId: graph.id, edge }], "Connect nodes");
  }, [apply, graph, onStatus]);
  return { deleteEdge, setRole, setChannel, connect };
}
