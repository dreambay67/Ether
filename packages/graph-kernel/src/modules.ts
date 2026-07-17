import { type EtherEdge, type EtherGraph, type EtherModule } from "@ether/schema";
import { canonicalConnectionIdentity } from "./connectionValidator.js";
import { getNodeDefinition } from "./registry.js";

export type GraphDiagnostic = { code: string; message: string; graphId?: string; entityId?: string };

function hasConfigPath(config: unknown, path: readonly string[]): boolean {
  let current = config;
  for (const segment of path) {
    if (Array.isArray(current) && /^\d+$/.test(segment)) current = current[Number(segment)];
    else if (typeof current === "object" && current !== null && Object.hasOwn(current, segment)) current = Reflect.get(current, segment);
    else return false;
  }
  return true;
}

export function validateGraphSet(graphs: readonly EtherGraph[]): GraphDiagnostic[] {
  const diagnostics: GraphDiagnostic[] = [];
  const byId = new Map<string, EtherGraph>();
  for (const graph of graphs) {
    if (byId.has(graph.id)) diagnostics.push({ code: "DUPLICATE_GRAPH_ID", message: `Graph ${graph.id} appears more than once.`, graphId: graph.id });
    byId.set(graph.id, graph);
  }
  const entityOwners = new Map<string, string>();
  const internalOwners = new Map<string, { parentGraphId: string; moduleId: string }>();
  const modules = new Map<string, { module: EtherModule; parent: EtherGraph }>();
  const own = (id: string, graphId: string): void => {
    const prior = entityOwners.get(id);
    if (prior !== undefined) diagnostics.push({ code: "DUPLICATE_ENTITY_ID", message: `Entity ${id} is shared by ${prior} and ${graphId}.`, graphId, entityId: id });
    else entityOwners.set(id, graphId);
  };
  for (const graph of graphs) {
    graph.nodes.forEach((item) => own(item.id, graph.id));
    graph.edges.forEach((item) => own(item.id, graph.id));
    graph.groups.forEach((item) => own(item.id, graph.id));
    const laneIdentities = new Map<string, string>();
    for (const edge of graph.edges) {
      const identity = canonicalConnectionIdentity(edge);
      const prior = laneIdentities.get(identity);
      if (prior !== undefined) diagnostics.push({ code: "DUPLICATE_LANE", message: `Edges ${prior} and ${edge.id} have the same canonical lane identity.`, graphId: graph.id, entityId: edge.id });
      else laneIdentities.set(identity, edge.id);
    }
    for (const group of graph.groups) {
      if (new Set(group.nodeIds).size !== group.nodeIds.length) diagnostics.push({ code: "DUPLICATE_GROUP_NODE", message: `Group ${group.id} repeats a node.`, graphId: graph.id, entityId: group.id });
      for (const nodeId of group.nodeIds) if (!graph.nodes.some((node) => node.id === nodeId)) diagnostics.push({ code: "GROUP_NODE_MISSING", message: `Group ${group.id} references missing node ${nodeId}.`, graphId: graph.id, entityId: group.id });
    }
    for (const module of graph.modules) {
      own(module.id, graph.id);
      modules.set(module.id, { module, parent: graph });
      const internal = byId.get(module.graphId);
      if (internal === undefined || internal.kind !== "module") diagnostics.push({ code: "MODULE_GRAPH_MISSING", message: `Module ${module.id} does not own a module graph.`, graphId: graph.id, entityId: module.id });
      const prior = internalOwners.get(module.graphId);
      if (prior !== undefined) diagnostics.push({ code: "SHARED_MODULE_GRAPH", message: `Internal graph ${module.graphId} is owned by multiple modules.`, graphId: graph.id, entityId: module.id });
      else internalOwners.set(module.graphId, { parentGraphId: graph.id, moduleId: module.id });
      const portIds = [...module.interface.inputs, ...module.interface.outputs].map((port) => port.id);
      if (new Set(portIds).size !== portIds.length) diagnostics.push({ code: "DUPLICATE_MODULE_PORT", message: `Module ${module.id} has duplicate port IDs.`, graphId: graph.id, entityId: module.id });
      const parameterIds = module.interface.parameters.map((parameter) => parameter.id);
      if (new Set(parameterIds).size !== parameterIds.length) diagnostics.push({ code: "DUPLICATE_MODULE_PARAMETER", message: `Module ${module.id} has duplicate parameter IDs.`, graphId: graph.id, entityId: module.id });
      if (internal !== undefined) {
        for (const [direction, ports] of [["inputs", module.interface.inputs], ["outputs", module.interface.outputs]] as const) for (const port of ports) {
          const node = internal.nodes.find((candidate) => candidate.id === port.internalNodeId);
          if (node === undefined) diagnostics.push({ code: "MODULE_PORT_NODE_MISSING", message: `Port ${port.id} references a missing internal node.`, graphId: graph.id, entityId: module.id });
          else {
            const contract = getNodeDefinition(node.definitionId).contract[direction];
            if (port.channel !== port.internalChannel || !contract.some((candidate) => candidate.channel === port.internalChannel)) diagnostics.push({ code: "MODULE_PORT_CHANNEL_MISMATCH", message: `Port ${port.id} has an invalid ${direction === "inputs" ? "input" : "output"} channel.`, graphId: graph.id, entityId: module.id });
          }
        }
        for (const parameter of module.interface.parameters) {
          const node = internal.nodes.find((candidate) => candidate.id === parameter.nodeId);
          if (node === undefined || !hasConfigPath(node.config, parameter.configPath)) diagnostics.push({ code: "MODULE_PARAMETER_PATH_INVALID", message: `Parameter ${parameter.id} has an invalid config path.`, graphId: graph.id, entityId: module.id });
        }
      }
    }
  }
  for (const graph of graphs) for (const edge of graph.edges) for (const [direction, endpoint] of [["output", edge.from], ["input", edge.to]] as const) {
    if (endpoint.kind === "node") {
      if (!graph.nodes.some((node) => node.id === endpoint.nodeId)) diagnostics.push({ code: "EDGE_NODE_ENDPOINT_MISSING", message: `Edge ${edge.id} references node ${endpoint.nodeId} outside graph ${graph.id}.`, graphId: graph.id, entityId: edge.id });
    } else {
      const owner = modules.get(endpoint.moduleId);
      if (owner === undefined || owner.parent.id !== graph.id) diagnostics.push({ code: "EDGE_MODULE_ENDPOINT_MISSING", message: `Edge ${edge.id} references an unavailable module.`, graphId: graph.id, entityId: edge.id });
      else {
        const ports = direction === "input" ? owner.module.interface.inputs : owner.module.interface.outputs;
        const port = ports.find((candidate) => candidate.id === endpoint.portId);
        if (port === undefined || port.channel !== endpoint.channel) diagnostics.push({ code: "EDGE_MODULE_PORT_INVALID", message: `Edge ${edge.id} references an invalid module ${direction} port.`, graphId: graph.id, entityId: edge.id });
      }
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (graphId: string): void => {
    if (visiting.has(graphId)) { diagnostics.push({ code: "MODULE_OWNERSHIP_CYCLE", message: `Module ownership recurses through graph ${graphId}.`, graphId }); return; }
    if (visited.has(graphId)) return;
    visiting.add(graphId);
    for (const module of byId.get(graphId)?.modules ?? []) visit(module.graphId);
    visiting.delete(graphId);
    visited.add(graphId);
  };
  [...graphs].sort((left, right) => left.id.localeCompare(right.id)).forEach((graph) => visit(graph.id));
  for (const graph of graphs) if (graph.kind === "module" && !internalOwners.has(graph.id)) diagnostics.push({ code: "UNOWNED_MODULE_GRAPH", message: `Module graph ${graph.id} has no owner.`, graphId: graph.id });
  return diagnostics;
}

export function moduleSubtree(graphs: readonly EtherGraph[], rootGraphId: string): EtherGraph[] {
  const byId = new Map(graphs.map((graph) => [graph.id, graph]));
  const result: EtherGraph[] = [];
  const visit = (graphId: string): void => {
    const graph = byId.get(graphId);
    if (graph === undefined || result.some((item) => item.id === graphId)) return;
    result.push(graph);
    graph.modules.forEach((module) => visit(module.graphId));
  };
  visit(rootGraphId);
  return result.sort((left, right) => left.id.localeCompare(right.id));
}

export function expandModuleBoundaries(graphs: readonly EtherGraph[]): EtherEdge[] {
  const modules = new Map<string, EtherModule>();
  graphs.forEach((graph) => graph.modules.forEach((module) => modules.set(module.id, module)));
  const resolve = (endpoint: EtherEdge["from"], direction: "input" | "output"): EtherEdge["from"] => {
    let current = endpoint;
    const seen = new Set<string>();
    while (current.kind === "module") {
      const key = `${current.moduleId}:${current.portId}:${direction}`;
      if (seen.has(key)) throw new Error(`Recursive module boundary: ${key}`);
      seen.add(key);
      const module = modules.get(current.moduleId);
      const ports = direction === "input" ? module?.interface.inputs : module?.interface.outputs;
      const portId = current.portId;
      const port = ports?.find((candidate) => candidate.id === portId);
      if (module === undefined || port === undefined || port.channel !== current.channel) throw new Error(`Invalid module ${direction} endpoint: ${key}`);
      current = { kind: "node", nodeId: port.internalNodeId, channel: port.internalChannel };
    }
    return current;
  };
  return graphs.flatMap((graph) => graph.edges.map((edge) => ({ ...edge, from: resolve(edge.from, "output"), to: resolve(edge.to, "input") })));
}
