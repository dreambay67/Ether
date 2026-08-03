import type {
  EtherGraph,
  EtherModule,
  EtherNode,
  GraphOperation,
  ModuleInterface,
  NodePosition
} from "@ether/schema";

export const DEFAULT_MODULE_ACCENT = "#37e6ea";
export const MODULE_ACCENTS = [
  { name: "Aqua", value: "#37e6ea" },
  { name: "Electric blue", value: "#1470db" },
  { name: "Violet", value: "#a889ff" },
  { name: "Mint", value: "#7ef4d7" },
  { name: "Amber", value: "#ffbd5c" },
  { name: "Rose", value: "#ff7a9e" }
] as const;

export function moduleIsLocked(module: EtherModule): boolean {
  return module.locked !== false;
}

export function moduleAccent(module: EtherModule): string {
  return module.accent ?? DEFAULT_MODULE_ACCENT;
}

function bounds(nodes: readonly EtherNode[]) {
  const left = Math.min(...nodes.map((node) => node.position.x));
  const top = Math.min(...nodes.map((node) => node.position.y));
  const right = Math.max(...nodes.map((node) => node.position.x + node.size.width));
  const bottom = Math.max(...nodes.map((node) => node.position.y + node.size.height));
  return { left, top, width: right - left, height: bottom - top };
}

type CreateModuleOptions = {
  title?: string;
  description?: string;
  accent?: string;
  removeGroupId?: string;
  idFactory?: () => string;
  now?: () => string;
};

export function createModuleOperations(
  graph: EtherGraph,
  nodeIds: readonly string[],
  options: CreateModuleOptions = {}
): { module: EtherModule; child: EtherGraph; operations: GraphOperation[] } | null {
  const nodes = graph.nodes.filter((node) => nodeIds.includes(node.id));
  if (nodes.length === 0) return null;

  const idFactory = options.idFactory ?? (() => crypto.randomUUID());
  const nodeSet = new Set(nodes.map((node) => node.id));
  const box = bounds(nodes);
  const moduleId = idFactory();
  const childId = idFactory();
  const modulePosition: NodePosition = { x: box.left - 20, y: box.top - 20 };
  const inputs: ModuleInterface["inputs"] = [];
  const outputs: ModuleInterface["outputs"] = [];
  let port = 0;

  const innerEdges = graph.edges.filter((edge) =>
    edge.from.kind === "node" && edge.to.kind === "node" &&
    nodeSet.has(edge.from.nodeId) && nodeSet.has(edge.to.nodeId)
  );
  const affected = graph.edges.filter((edge) => {
    if (innerEdges.includes(edge)) return false;
    const selectedSource = edge.from.kind === "node" && nodeSet.has(edge.from.nodeId);
    const selectedTarget = edge.to.kind === "node" && nodeSet.has(edge.to.nodeId);
    return selectedSource || selectedTarget;
  });
  const operations: GraphOperation[] = [];

  for (const edge of affected) {
    if (edge.to.kind === "node" && nodeSet.has(edge.to.nodeId)) {
      const id = `input-${port++}`;
      inputs.push({ id, name: `Input ${inputs.length + 1}`, channel: edge.to.channel, internalNodeId: edge.to.nodeId, internalChannel: edge.to.channel, required: false });
      operations.push({ type: "updateEdge", graphId: graph.id, edgeId: edge.id, edge: { ...edge, to: { kind: "module", moduleId, portId: id, channel: edge.to.channel } } });
    } else if (edge.from.kind === "node" && nodeSet.has(edge.from.nodeId)) {
      const id = `output-${port++}`;
      outputs.push({ id, name: `Output ${outputs.length + 1}`, channel: edge.from.channel, internalNodeId: edge.from.nodeId, internalChannel: edge.from.channel, required: false });
      operations.push({ type: "updateEdge", graphId: graph.id, edgeId: edge.id, edge: { ...edge, from: { kind: "module", moduleId, portId: id, channel: edge.from.channel } } });
    }
  }

  const timestamp = (options.now ?? (() => new Date().toISOString()))();
  const child: EtherGraph = {
    id: childId,
    title: options.title?.trim() || "Module",
    kind: "module",
    createdAt: timestamp,
    updatedAt: timestamp,
    nodes: nodes.map((node) => ({ ...node, position: { x: node.position.x - modulePosition.x, y: node.position.y - modulePosition.y } })),
    edges: innerEdges,
    groups: [],
    modules: [],
    viewState: { viewport: { x: 0, y: 0, zoom: 1 }, selectedNodeIds: [], selectedEdgeIds: [], inspectorTarget: null }
  };
  const module: EtherModule = {
    id: moduleId,
    title: options.title?.trim() || "Module",
    description: options.description ?? "",
    accent: options.accent ?? DEFAULT_MODULE_ACCENT,
    locked: true,
    graphId: childId,
    position: modulePosition,
    size: { width: Math.max(260, box.width + 40), height: Math.max(150, box.height + 40) },
    interface: { inputs, outputs, parameters: [] },
    collapsed: false
  };

  operations.unshift({ type: "createModule", graphId: graph.id, module, subtree: { rootGraphId: childId, graphs: [child] } });
  operations.push(
    ...innerEdges.map((edge) => ({ type: "removeEdge", graphId: graph.id, edgeId: edge.id } as GraphOperation)),
    ...nodes.map((node) => ({ type: "removeNode", graphId: graph.id, nodeId: node.id } as GraphOperation))
  );
  if (options.removeGroupId !== undefined) operations.push({ type: "removeGroup", graphId: graph.id, groupId: options.removeGroupId });
  return { module, child, operations };
}

export type ModuleMembershipResult =
  | { ok: false; message: string }
  | { ok: true; module: EtherModule; subtree: EtherGraph[]; operations: GraphOperation[] };

export function addNodesToModuleOperations(
  parent: EtherGraph,
  module: EtherModule,
  subtree: readonly EtherGraph[],
  nodeIds: readonly string[]
): ModuleMembershipResult {
  if (moduleIsLocked(module)) return { ok: false, message: "Unlock this module before changing membership from the parent canvas." };
  const child = subtree.find((graph) => graph.id === module.graphId);
  if (child === undefined) return { ok: false, message: "The module's internal graph is unavailable." };
  const nodes = parent.nodes.filter((node) => nodeIds.includes(node.id));
  if (nodes.length === 0) return { ok: false, message: "Select one or more parent nodes to add." };
  const selected = new Set(nodes.map((node) => node.id));
  const directModuleEdge = parent.edges.find((edge) =>
    ((edge.from.kind === "node" && selected.has(edge.from.nodeId)) && edge.to.kind === "module" && edge.to.moduleId === module.id) ||
    ((edge.to.kind === "node" && selected.has(edge.to.nodeId)) && edge.from.kind === "module" && edge.from.moduleId === module.id)
  );
  if (directModuleEdge !== undefined) {
    return { ok: false, message: "A selected node is already connected directly to this module. Enter the module and repair that boundary before changing its membership." };
  }

  const innerEdges = parent.edges.filter((edge) =>
    edge.from.kind === "node" && edge.to.kind === "node" &&
    selected.has(edge.from.nodeId) && selected.has(edge.to.nodeId)
  );
  const affected = parent.edges.filter((edge) => {
    if (innerEdges.includes(edge)) return false;
    const selectedSource = edge.from.kind === "node" && selected.has(edge.from.nodeId);
    const selectedTarget = edge.to.kind === "node" && selected.has(edge.to.nodeId);
    return selectedSource || selectedTarget;
  });
  const inputs = [...module.interface.inputs];
  const outputs = [...module.interface.outputs];
  let ordinal = inputs.length + outputs.length;
  const edgeOperations: GraphOperation[] = [];
  for (const edge of affected) {
    if (edge.to.kind === "node" && selected.has(edge.to.nodeId)) {
      const id = `input-${crypto.randomUUID()}-${ordinal++}`;
      inputs.push({ id, name: `Input ${inputs.length + 1}`, channel: edge.to.channel, internalNodeId: edge.to.nodeId, internalChannel: edge.to.channel, required: false });
      edgeOperations.push({ type: "updateEdge", graphId: parent.id, edgeId: edge.id, edge: { ...edge, to: { kind: "module", moduleId: module.id, portId: id, channel: edge.to.channel } } });
    } else if (edge.from.kind === "node" && selected.has(edge.from.nodeId)) {
      const id = `output-${crypto.randomUUID()}-${ordinal++}`;
      outputs.push({ id, name: `Output ${outputs.length + 1}`, channel: edge.from.channel, internalNodeId: edge.from.nodeId, internalChannel: edge.from.channel, required: false });
      edgeOperations.push({ type: "updateEdge", graphId: parent.id, edgeId: edge.id, edge: { ...edge, from: { kind: "module", moduleId: module.id, portId: id, channel: edge.from.channel } } });
    }
  }

  const movedNodes = nodes.map((node) => ({
    ...node,
    position: { x: node.position.x - module.position.x, y: node.position.y - module.position.y }
  }));
  const nextChild: EtherGraph = {
    ...child,
    nodes: [...child.nodes, ...movedNodes],
    edges: [...child.edges, ...innerEdges],
    updatedAt: new Date().toISOString()
  };
  const nextSubtree = subtree.map((graph) => graph.id === child.id ? nextChild : graph);
  const nextModule: EtherModule = { ...module, interface: { ...module.interface, inputs, outputs } };
  const operations: GraphOperation[] = [
    { type: "updateModule", graphId: parent.id, moduleId: module.id, module: nextModule, subtree: { rootGraphId: module.graphId, graphs: nextSubtree } },
    ...edgeOperations,
    ...innerEdges.map((edge) => ({ type: "removeEdge", graphId: parent.id, edgeId: edge.id } as GraphOperation)),
    ...nodes.map((node) => ({ type: "removeNode", graphId: parent.id, nodeId: node.id } as GraphOperation))
  ];
  return { ok: true, module: nextModule, subtree: nextSubtree, operations };
}

export function removeNodesFromModuleOperations(
  parent: EtherGraph,
  module: EtherModule,
  subtree: readonly EtherGraph[],
  nodeIds: readonly string[]
): ModuleMembershipResult {
  const child = subtree.find((graph) => graph.id === module.graphId);
  if (child === undefined) return { ok: false, message: "The module's internal graph is unavailable." };
  const nodes = child.nodes.filter((node) => nodeIds.includes(node.id));
  if (nodes.length === 0) return { ok: false, message: "Select one or more module members to move to the parent canvas." };
  const selected = new Set(nodes.map((node) => node.id));
  if (child.groups.some((group) => group.nodeIds.some((nodeId) => selected.has(nodeId)))) {
    return { ok: false, message: "A selected member belongs to a legacy Visual Group. Convert or repair that group before changing membership." };
  }
  const nestedBoundary = child.edges.find((edge) => {
    const selectedSource = edge.from.kind === "node" && selected.has(edge.from.nodeId);
    const selectedTarget = edge.to.kind === "node" && selected.has(edge.to.nodeId);
    return (selectedSource && edge.to.kind === "module") || (selectedTarget && edge.from.kind === "module");
  });
  if (nestedBoundary !== undefined) {
    return { ok: false, message: "A selected member connects directly to a nested module. Dissolve or rewire that nested boundary before changing membership." };
  }

  const movingEdges = child.edges.filter((edge) =>
    (edge.from.kind === "node" && selected.has(edge.from.nodeId)) ||
    (edge.to.kind === "node" && selected.has(edge.to.nodeId))
  );
  const inputs = module.interface.inputs.filter((port) => !selected.has(port.internalNodeId));
  const outputs = module.interface.outputs.filter((port) => !selected.has(port.internalNodeId));
  const parameters = module.interface.parameters.filter((parameter) => !selected.has(parameter.nodeId));
  let ordinal = inputs.length + outputs.length;
  const movedEdges = movingEdges.map((edge) => {
    const selectedSource = edge.from.kind === "node" && selected.has(edge.from.nodeId);
    const selectedTarget = edge.to.kind === "node" && selected.has(edge.to.nodeId);
    if (selectedSource && selectedTarget) return edge;
    if (selectedSource && edge.to.kind === "node") {
      const id = `input-${crypto.randomUUID()}-${ordinal++}`;
      inputs.push({ id, name: `Input ${inputs.length + 1}`, channel: edge.to.channel, internalNodeId: edge.to.nodeId, internalChannel: edge.to.channel, required: false });
      return { ...edge, to: { kind: "module" as const, moduleId: module.id, portId: id, channel: edge.to.channel } };
    }
    if (selectedTarget && edge.from.kind === "node") {
      const id = `output-${crypto.randomUUID()}-${ordinal++}`;
      outputs.push({ id, name: `Output ${outputs.length + 1}`, channel: edge.from.channel, internalNodeId: edge.from.nodeId, internalChannel: edge.from.channel, required: false });
      return { ...edge, from: { kind: "module" as const, moduleId: module.id, portId: id, channel: edge.from.channel } };
    }
    return edge;
  });
  const removedInputIds = new Set(module.interface.inputs.filter((port) => selected.has(port.internalNodeId)).map((port) => port.id));
  const removedOutputIds = new Set(module.interface.outputs.filter((port) => selected.has(port.internalNodeId)).map((port) => port.id));
  const rewrittenParentEdges = parent.edges.map((edge) => {
    const inputPortId = edge.to.kind === "module" && edge.to.moduleId === module.id && removedInputIds.has(edge.to.portId) ? edge.to.portId : undefined;
    const outputPortId = edge.from.kind === "module" && edge.from.moduleId === module.id && removedOutputIds.has(edge.from.portId) ? edge.from.portId : undefined;
    const input = inputPortId !== undefined
      ? module.interface.inputs.find((port) => port.id === inputPortId)
      : undefined;
    const output = outputPortId !== undefined
      ? module.interface.outputs.find((port) => port.id === outputPortId)
      : undefined;
    return input || output ? {
      ...edge,
      from: output ? { kind: "node" as const, nodeId: output.internalNodeId, channel: output.internalChannel } : edge.from,
      to: input ? { kind: "node" as const, nodeId: input.internalNodeId, channel: input.internalChannel } : edge.to
    } : edge;
  });
  const nextChild: EtherGraph = {
    ...child,
    nodes: child.nodes.filter((node) => !selected.has(node.id)),
    edges: child.edges.filter((edge) => !movingEdges.includes(edge)),
    updatedAt: new Date().toISOString()
  };
  const nextSubtree = subtree.map((graph) => graph.id === child.id ? nextChild : graph);
  const nextModule: EtherModule = { ...module, interface: { inputs, outputs, parameters } };
  const movedNodes = nodes.map((node) => ({
    ...node,
    position: { x: module.position.x + node.position.x, y: module.position.y + node.position.y }
  }));
  const operations: GraphOperation[] = [
    { type: "updateModule", graphId: parent.id, moduleId: module.id, module: nextModule, subtree: { rootGraphId: module.graphId, graphs: nextSubtree } },
    ...rewrittenParentEdges.flatMap((edge, index) => edge === parent.edges[index] ? [] : [{ type: "updateEdge", graphId: parent.id, edgeId: edge.id, edge } as GraphOperation]),
    ...movedNodes.map((node) => ({ type: "addNode", graphId: parent.id, node } as GraphOperation)),
    ...movedEdges.map((edge) => ({ type: "addEdge", graphId: parent.id, edge } as GraphOperation))
  ];
  return { ok: true, module: nextModule, subtree: nextSubtree, operations };
}
