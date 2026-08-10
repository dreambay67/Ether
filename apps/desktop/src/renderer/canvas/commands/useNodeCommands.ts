import { useCallback } from "react";
import { EtherNodeSchema, type EtherGraph, type EtherNode, type GraphOperation, type NodeConfig, type NodeDefinitionId, type NodeLibraryItem, type NodePosition, type NodeSize } from "@ether/schema";
import { createModuleOperations, moduleIsLocked } from "../modules/moduleModel";

export function createNodeFromDefinition(definition: NodeLibraryItem, ordinal: number, position: NodePosition, id = crypto.randomUUID()): EtherNode | null {
  const parsed = EtherNodeSchema.safeParse({
    id,
    definitionId: definition.definitionId,
    title: `${definition.title} ${ordinal}`,
    position,
    size: { width: definition.presentation.width, height: definition.presentation.height },
    config: structuredClone(definition.defaultConfig),
    presentation: { collapsed: false, accent: "default", previewMode: definition.presentation.previewMode }
  });
  return parsed.success ? parsed.data : null;
}

export function useNodeCommands(graph: EtherGraph, catalog: readonly NodeLibraryItem[], apply: (operations: GraphOperation[], title: string) => Promise<boolean>, onStatus: (message: string) => void) {
  const createNode = useCallback(async (definitionId: NodeDefinitionId, position: NodePosition = { x: 120 + graph.nodes.length * 28, y: 120 + graph.nodes.length * 20 }) => {
    const definition = catalog.find((item) => item.definitionId === definitionId);
    if (definition === undefined) {
      onStatus(`The canonical ${definitionId} definition is unavailable.`);
      return null;
    }
    const ordinal = graph.nodes.filter((item) => item.definitionId === definitionId).length + 1;
    const node = createNodeFromDefinition(definition, ordinal, position);
    if (node === null) {
      onStatus(`The canonical ${definition.title} default configuration is invalid; no node was added.`);
      return null;
    }
    const saved = await apply([{ type: "addNode", graphId: graph.id, node } as GraphOperation], `Add ${definition.title}`);
    return saved ? node.id : null;
  }, [apply, catalog, graph.id, graph.nodes, onStatus]);
  const removeNode = useCallback((nodeId: string) => {
    const edgeOperations = graph.edges
      .filter((edge) => (edge.from.kind === "node" && edge.from.nodeId === nodeId) || (edge.to.kind === "node" && edge.to.nodeId === nodeId))
      .map((edge) => ({ type: "removeEdge", graphId: graph.id, edgeId: edge.id } as GraphOperation));
    void apply([...edgeOperations, { type: "removeNode", graphId: graph.id, nodeId }], "Delete node");
  }, [apply, graph.edges, graph.id]);
  const moveNodes = useCallback((positions: { nodeId: string; position: NodePosition }[]) => void apply([{ type: "moveNodes", graphId: graph.id, positions }], positions.length > 1 ? "Move selected nodes" : "Move node"), [apply, graph.id]);
  const resizeNode = useCallback((nodeId: string, size: NodeSize) => void apply([{ type: "resizeNodes", graphId: graph.id, sizes: [{ nodeId, size }] }], "Resize node"), [apply, graph.id]);
  const rename = useCallback((nodeId: string, title: string) => {
    const node = graph.nodes.find((item) => item.id === nodeId);
    if (!node) return Promise.resolve(false);
    const nextTitle = title.trim();
    if (!nextTitle) {
      onStatus("A node title cannot be empty.");
      return Promise.resolve(false);
    }
    if (nextTitle === node.title) return Promise.resolve(true);
    return apply([{ type: "updateNode", graphId: graph.id, nodeId, node: { ...node, title: nextTitle } }], "Rename node");
  }, [apply, graph.id, graph.nodes, onStatus]);
  const updateConfig = useCallback((nodeId: string, config: NodeConfig, title = "Edit node content") => {
    const node = graph.nodes.find((item) => item.id === nodeId);
    if (!node || config.kind !== node.definitionId) return Promise.resolve(false);
    const updated = EtherNodeSchema.safeParse({ ...node, config });
    if (!updated.success) { onStatus("The edited content did not match this node definition."); return Promise.resolve(false); }
    return apply([{ type: "updateNode", graphId: graph.id, nodeId, node: updated.data }], title);
  }, [apply, graph.id, graph.nodes, onStatus]);
  const moveModule = useCallback((moduleId: string, position: NodePosition) => {
    const module = graph.modules.find((item) => item.id === moduleId); if (!module) return;
    if (moduleIsLocked(module)) { onStatus("Unlock this module before moving it."); return; }
    void apply([{ type: "updateModule", graphId: graph.id, moduleId, module: { ...module, position } }], "Move module");
  }, [apply, graph.id, graph.modules, onStatus]);
  const createModule = useCallback((nodeIds: string[]) => {
    if (graph.groups.some((group) => group.nodeIds.some((nodeId) => nodeIds.includes(nodeId)))) {
      onStatus("Selected nodes belong to a legacy Visual Group. Use its repair preview before creating a Module.");
      return;
    }
    const result = createModuleOperations(graph, nodeIds);
    if (result === null) { onStatus("Select nodes before creating a module."); return; }
    return apply(result.operations, "Create locked module");
  }, [apply, graph, onStatus]);
  return { createNode, removeNode, moveNodes, resizeNode, rename, updateConfig, moveModule, createModule };
}
