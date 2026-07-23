import { PanelRight } from "lucide-react";
import { EdgeInspector } from "./EdgeInspector";
import { NodeInspector } from "./NodeInspector";
import type { InspectorContext } from "./types";

export function InspectorShell({ context }: { context: InspectorContext | null }) {
  if (context === null) return <div className="ether-inspector-empty"><PanelRight size={18} aria-hidden="true" /><strong>Project lens</strong><p>Select one node or connection to reveal concise, task-specific controls.</p></div>;
  const node = context.nodeId === null ? undefined : context.graph.nodes.find((candidate) => candidate.id === context.nodeId);
  if (node) return <NodeInspector context={{ ...context, node }} />;
  const edge = context.edgeId === null ? undefined : context.graph.edges.find((candidate) => candidate.id === context.edgeId);
  if (edge) return <EdgeInspector context={{ ...context, edge }} />;
  return <div className="ether-inspector-empty"><strong>Selection changed</strong><p>The selected item is no longer available in this graph revision.</p></div>;
}
