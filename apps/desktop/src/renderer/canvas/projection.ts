import type { EtherGraph, PayloadChannel } from "@ether/schema";

export type CanvasChannelActivity = Record<string, { input: PayloadChannel[]; output: PayloadChannel[] }>;

/** Shared projection used by CanvasSurface; linear in edges and independent of React rendering. */
export function projectCanvasChannelActivity(graph: Pick<EtherGraph, "edges">): CanvasChannelActivity {
  const result: CanvasChannelActivity = {};
  const ensure = (id: string) => result[id] ??= { input: [], output: [] };
  for (const edge of graph.edges) {
    if (edge.from.kind === "node" && !ensure(edge.from.nodeId).output.includes(edge.from.channel)) ensure(edge.from.nodeId).output.push(edge.from.channel);
    if (edge.to.kind === "node" && !ensure(edge.to.nodeId).input.includes(edge.to.channel)) ensure(edge.to.nodeId).input.push(edge.to.channel);
  }
  return result;
}
