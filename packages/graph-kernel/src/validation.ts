import type { EtherGraph } from "@ether/schema";
import { FULL_ADAPTER_CAPABILITIES } from "./adapters.js";
import { validateConnection } from "./connectionValidator.js";
import { expandModuleBoundaries, validateGraphSet, type GraphDiagnostic } from "./modules.js";
import { planTraversal } from "./traversal.js";

export function validateFullGraphState(
  graphs: readonly EtherGraph[],
  capabilities: readonly string[] = FULL_ADAPTER_CAPABILITIES
): GraphDiagnostic[] {
  const diagnostics = [...validateGraphSet(graphs)];
  const nodes = new Map(graphs.flatMap((graph) => graph.nodes.map((node) => [node.id, node] as const)));
  try {
    for (const edge of expandModuleBoundaries(graphs)) {
      if (edge.from.kind !== "node" || edge.to.kind !== "node") continue;
      const source = nodes.get(edge.from.nodeId);
      const target = nodes.get(edge.to.nodeId);
      if (source === undefined || target === undefined) continue;
      const decision = validateConnection({
        sourceDefinitionId: source.definitionId,
        sourceChannel: edge.from.channel,
        targetDefinitionId: target.definitionId,
        targetChannel: edge.to.channel,
        role: edge.role,
        adapter: edge.adapter,
        capabilities
      });
      if (!decision.allowed) diagnostics.push({ code: decision.code, message: decision.message, entityId: edge.id });
    }
  } catch (error) {
    diagnostics.push({ code: "MODULE_BOUNDARY_INVALID", message: error instanceof Error ? error.message : "Module boundary expansion failed." });
  }
  for (const root of graphs.filter((graph) => graph.kind === "root").sort((left, right) => left.id.localeCompare(right.id))) {
    try {
      planTraversal(graphs, root.id);
    } catch (error) {
      diagnostics.push({ code: "TRAVERSAL_INVALID", message: error instanceof Error ? error.message : "Graph traversal failed.", graphId: root.id });
    }
  }
  return diagnostics.sort((left, right) =>
    (left.graphId ?? "").localeCompare(right.graphId ?? "")
    || (left.entityId ?? "").localeCompare(right.entityId ?? "")
    || left.code.localeCompare(right.code)
    || left.message.localeCompare(right.message)
  );
}
