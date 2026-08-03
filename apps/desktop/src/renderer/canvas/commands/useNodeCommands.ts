import { useCallback } from "react";
import { EtherNodeSchema, type EtherGraph, type EtherNode, type GraphOperation, type ModuleInterface, type NodeConfig, type NodeDefinitionId, type NodeLibraryItem, type NodePosition, type NodeSize } from "@ether/schema";
function bounds(nodes: EtherNode[]) { const left = Math.min(...nodes.map((node) => node.position.x)); const top = Math.min(...nodes.map((node) => node.position.y)); const right = Math.max(...nodes.map((node) => node.position.x + node.size.width)); const bottom = Math.max(...nodes.map((node) => node.position.y + node.size.height)); return { left, top, width: right - left, height: bottom - top }; }

export function useNodeCommands(graph: EtherGraph, catalog: readonly NodeLibraryItem[], apply: (operations: GraphOperation[], title: string) => Promise<boolean>, onStatus: (message: string) => void) {
  const createNode = useCallback(async (definitionId: NodeDefinitionId, position: NodePosition = { x: 120 + graph.nodes.length * 28, y: 120 + graph.nodes.length * 20 }) => {
    const definition = catalog.find((item) => item.definitionId === definitionId);
    if (definition === undefined) {
      onStatus(`The canonical ${definitionId} definition is unavailable.`);
      return false;
    }
    const ordinal = graph.nodes.filter((item) => item.definitionId === definitionId).length + 1;
    const node = {
      id: crypto.randomUUID(),
      definitionId,
      title: `${definition.title} ${ordinal}`,
      position,
      size: { width: definition.presentation.width, height: definition.presentation.height },
      config: structuredClone(definition.defaultConfig),
      presentation: { collapsed: false, accent: "default", previewMode: definition.presentation.previewMode }
    } as EtherNode;
    return apply([{ type: "addNode", graphId: graph.id, node } as GraphOperation], `Add ${definition.title}`);
  }, [apply, catalog, graph.id, graph.nodes, onStatus]);
  const removeNode = useCallback((nodeId: string) => {
    const edgeOperations = graph.edges
      .filter((edge) => (edge.from.kind === "node" && edge.from.nodeId === nodeId) || (edge.to.kind === "node" && edge.to.nodeId === nodeId))
      .map((edge) => ({ type: "removeEdge", graphId: graph.id, edgeId: edge.id } as GraphOperation));
    void apply([...edgeOperations, { type: "removeNode", graphId: graph.id, nodeId }], "Delete node");
  }, [apply, graph.edges, graph.id]);
  const moveNodes = useCallback((positions: { nodeId: string; position: NodePosition }[]) => void apply([{ type: "moveNodes", graphId: graph.id, positions }], positions.length > 1 ? "Move selected nodes" : "Move node"), [apply, graph.id]);
  const resizeNode = useCallback((nodeId: string, size: NodeSize) => void apply([{ type: "resizeNodes", graphId: graph.id, sizes: [{ nodeId, size }] }], "Resize node"), [apply, graph.id]);
  const rename = useCallback((nodeId: string, title: string) => { const node = graph.nodes.find((item) => item.id === nodeId); return node && title.trim() ? apply([{ type: "updateNode", graphId: graph.id, nodeId, node: { ...node, title: title.trim() } }], "Rename node") : Promise.resolve(false); }, [apply, graph.id, graph.nodes]);
  const updateConfig = useCallback((nodeId: string, config: NodeConfig, title = "Edit node content") => {
    const node = graph.nodes.find((item) => item.id === nodeId);
    if (!node || config.kind !== node.definitionId) return Promise.resolve(false);
    const updated = EtherNodeSchema.safeParse({ ...node, config });
    if (!updated.success) { onStatus("The edited content did not match this node definition."); return Promise.resolve(false); }
    return apply([{ type: "updateNode", graphId: graph.id, nodeId, node: updated.data }], title);
  }, [apply, graph.id, graph.nodes, onStatus]);
  const createGroup = useCallback((nodeIds: string[]) => { const nodes = graph.nodes.filter((node) => nodeIds.includes(node.id)); if (nodes.length < 2) { onStatus("Select two or more nodes to create a visual group."); return; } const box = bounds(nodes); void apply([{ type: "createGroup", graphId: graph.id, group: { id: crypto.randomUUID(), title: "Visual group", nodeIds, position: { x: box.left - 28, y: box.top - 48 }, size: { width: box.width + 56, height: box.height + 76 }, color: "#a889ff" } }], "Create visual group"); }, [apply, graph.id, graph.nodes, onStatus]);
  const moveGroup = useCallback((groupId: string, position: NodePosition) => {
    const group = graph.groups.find((item) => item.id === groupId); if (!group) return;
    const delta = { x: position.x - group.position.x, y: position.y - group.position.y };
    const positions = graph.nodes.filter((node) => group.nodeIds.includes(node.id)).map((node) => ({ nodeId: node.id, position: { x: node.position.x + delta.x, y: node.position.y + delta.y } }));
    void apply([{ type: "updateGroup", graphId: graph.id, groupId, group: { ...group, position } }, { type: "moveNodes", graphId: graph.id, positions }], "Move visual group");
  }, [apply, graph.groups, graph.id, graph.nodes]);
  const moveModule = useCallback((moduleId: string, position: NodePosition) => {
    const module = graph.modules.find((item) => item.id === moduleId); if (!module) return;
    void apply([{ type: "updateModule", graphId: graph.id, moduleId, module: { ...module, position } }], "Move module");
  }, [apply, graph.id, graph.modules]);
  const createModule = useCallback((nodeIds: string[]) => {
    const nodes = graph.nodes.filter((node) => nodeIds.includes(node.id)); if (nodes.length === 0) { onStatus("Select nodes before creating a module."); return; }
    const nodeSet = new Set(nodeIds); const box = bounds(nodes); const moduleId = crypto.randomUUID(); const childId = crypto.randomUUID(); const modulePosition = { x: box.left - 20, y: box.top - 20 }; const inputs: ModuleInterface["inputs"] = []; const outputs: ModuleInterface["outputs"] = []; let port = 0;
    const innerEdges = graph.edges.filter((edge) => edge.from.kind === "node" && edge.to.kind === "node" && nodeSet.has(edge.from.nodeId) && nodeSet.has(edge.to.nodeId));
    const affected = graph.edges.filter((edge) => edge.from.kind === "node" && edge.to.kind === "node" && (nodeSet.has(edge.from.nodeId) || nodeSet.has(edge.to.nodeId)) && !innerEdges.includes(edge));
    const operations: GraphOperation[] = [];
    for (const edge of affected) { if (edge.to.kind === "node" && nodeSet.has(edge.to.nodeId)) { const id = `input-${port++}`; inputs.push({ id, name: `Input ${inputs.length + 1}`, channel: edge.to.channel, internalNodeId: edge.to.nodeId, internalChannel: edge.to.channel, required: false }); operations.push({ type: "updateEdge", graphId: graph.id, edgeId: edge.id, edge: { ...edge, to: { kind: "module", moduleId, portId: id, channel: edge.to.channel } } }); } else if (edge.from.kind === "node" && nodeSet.has(edge.from.nodeId)) { const id = `output-${port++}`; outputs.push({ id, name: `Output ${outputs.length + 1}`, channel: edge.from.channel, internalNodeId: edge.from.nodeId, internalChannel: edge.from.channel, required: false }); operations.push({ type: "updateEdge", graphId: graph.id, edgeId: edge.id, edge: { ...edge, from: { kind: "module", moduleId, portId: id, channel: edge.from.channel } } }); } }
    const childNodes = nodes.map((node) => ({ ...node, position: { x: node.position.x - modulePosition.x, y: node.position.y - modulePosition.y } }));
    const child: EtherGraph = { id: childId, title: "Module", kind: "module", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), nodes: childNodes, edges: innerEdges, groups: [], modules: [], viewState: { viewport: { x: 0, y: 0, zoom: 1 }, selectedNodeIds: [], selectedEdgeIds: [], inspectorTarget: null } };
    operations.unshift({ type: "createModule", graphId: graph.id, module: { id: moduleId, title: "Module", graphId: childId, position: modulePosition, size: { width: Math.max(260, box.width + 40), height: Math.max(150, box.height + 40) }, interface: { inputs, outputs, parameters: [] }, collapsed: false }, subtree: { rootGraphId: childId, graphs: [child] } });
    operations.push(...innerEdges.map((edge) => ({ type: "removeEdge", graphId: graph.id, edgeId: edge.id } as GraphOperation)), ...nodes.map((node) => ({ type: "removeNode", graphId: graph.id, nodeId: node.id } as GraphOperation)));
    return apply(operations, "Create module");
  }, [apply, graph, onStatus]);
  return { createNode, removeNode, moveNodes, resizeNode, rename, updateConfig, createGroup, moveGroup, moveModule, createModule };
}
