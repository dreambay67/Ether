import { useCallback } from "react";
import type { EtherGraph, EtherNode, GraphOperation, ModuleInterface, NodeDefinitionId, NodePosition, NodeSize } from "@ether/schema";

function defaultConfig(definitionId: NodeDefinitionId) {
  if (definitionId === "generation.image") return { kind: definitionId, providerId: "ether-fake-local", profileId: "default", aspectRatio: "1:1", resolution: { width: 1024, height: 1024 }, outputCount: 1 } as const;
  if (definitionId === "canvas.note") return { kind: definitionId, body: "", style: "plain" } as const;
  return { kind: "prompt.text", body: "Describe the creative direction", assembly: "append" } as const;
}
function bounds(nodes: EtherNode[]) { const left = Math.min(...nodes.map((node) => node.position.x)); const top = Math.min(...nodes.map((node) => node.position.y)); const right = Math.max(...nodes.map((node) => node.position.x + node.size.width)); const bottom = Math.max(...nodes.map((node) => node.position.y + node.size.height)); return { left, top, width: right - left, height: bottom - top }; }

export function useNodeCommands(graph: EtherGraph, apply: (operations: GraphOperation[], title: string) => Promise<boolean>, onStatus: (message: string) => void) {
  const createNode = useCallback((definitionId: NodeDefinitionId, position: NodePosition = { x: 120 + graph.nodes.length * 28, y: 120 + graph.nodes.length * 20 }) => {
    const title = definitionId === "generation.image" ? "Image Generator" : definitionId === "canvas.note" ? "Note" : "Prompt";
    const node = { id: crypto.randomUUID(), definitionId, title: `${title} ${graph.nodes.filter((item) => item.definitionId === definitionId).length + 1}`, position, size: { width: 260, height: 156 }, config: defaultConfig(definitionId), presentation: { collapsed: false, accent: "default", previewMode: definitionId === "prompt.text" ? "content" : "summary" } } as EtherNode;
    void apply([{ type: "addNode", graphId: graph.id, node } as GraphOperation], `Add ${title}`);
  }, [apply, graph.id, graph.nodes]);
  const removeNode = useCallback((nodeId: string) => void apply([{ type: "removeNode", graphId: graph.id, nodeId }], "Delete node"), [apply, graph.id]);
  const moveNodes = useCallback((positions: { nodeId: string; position: NodePosition }[]) => void apply([{ type: "moveNodes", graphId: graph.id, positions }], positions.length > 1 ? "Move selected nodes" : "Move node"), [apply, graph.id]);
  const resizeNode = useCallback((nodeId: string, size: NodeSize) => void apply([{ type: "resizeNodes", graphId: graph.id, sizes: [{ nodeId, size }] }], "Resize node"), [apply, graph.id]);
  const rename = useCallback((nodeId: string, title: string) => { const node = graph.nodes.find((item) => item.id === nodeId); if (node && title.trim()) void apply([{ type: "updateNode", graphId: graph.id, nodeId, node: { ...node, title } }], "Rename node"); }, [apply, graph.id, graph.nodes]);
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
    const nodeSet = new Set(nodeIds); const box = bounds(nodes); const moduleId = crypto.randomUUID(); const childId = crypto.randomUUID(); const inputs: ModuleInterface["inputs"] = []; const outputs: ModuleInterface["outputs"] = []; let port = 0;
    const innerEdges = graph.edges.filter((edge) => edge.from.kind === "node" && edge.to.kind === "node" && nodeSet.has(edge.from.nodeId) && nodeSet.has(edge.to.nodeId));
    const affected = graph.edges.filter((edge) => edge.from.kind === "node" && edge.to.kind === "node" && (nodeSet.has(edge.from.nodeId) || nodeSet.has(edge.to.nodeId)) && !innerEdges.includes(edge));
    const operations: GraphOperation[] = [];
    for (const edge of affected) { if (edge.to.kind === "node" && nodeSet.has(edge.to.nodeId)) { const id = `input-${port++}`; inputs.push({ id, name: `Input ${inputs.length + 1}`, channel: edge.to.channel, internalNodeId: edge.to.nodeId, internalChannel: edge.to.channel, required: false }); operations.push({ type: "updateEdge", graphId: graph.id, edgeId: edge.id, edge: { ...edge, to: { kind: "module", moduleId, portId: id, channel: edge.to.channel } } }); } else if (edge.from.kind === "node" && nodeSet.has(edge.from.nodeId)) { const id = `output-${port++}`; outputs.push({ id, name: `Output ${outputs.length + 1}`, channel: edge.from.channel, internalNodeId: edge.from.nodeId, internalChannel: edge.from.channel, required: false }); operations.push({ type: "updateEdge", graphId: graph.id, edgeId: edge.id, edge: { ...edge, from: { kind: "module", moduleId, portId: id, channel: edge.from.channel } } }); } }
    const child: EtherGraph = { id: childId, title: "Module", kind: "module", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), nodes, edges: innerEdges, groups: [], modules: [], viewState: { viewport: { x: 0, y: 0, zoom: 1 }, selectedNodeIds: [], selectedEdgeIds: [], inspectorTarget: null } };
    operations.unshift({ type: "createModule", graphId: graph.id, module: { id: moduleId, title: "Module", graphId: childId, position: { x: box.left, y: box.top }, size: { width: Math.max(260, box.width + 40), height: Math.max(150, box.height + 40) }, interface: { inputs, outputs, parameters: [] }, collapsed: false }, subtree: { rootGraphId: childId, graphs: [child] } });
    operations.push(...innerEdges.map((edge) => ({ type: "removeEdge", graphId: graph.id, edgeId: edge.id } as GraphOperation)), ...nodes.map((node) => ({ type: "removeNode", graphId: graph.id, nodeId: node.id } as GraphOperation)));
    void apply(operations, "Create module");
  }, [apply, graph, onStatus]);
  return { createNode, removeNode, moveNodes, resizeNode, rename, createGroup, moveGroup, moveModule, createModule };
}
