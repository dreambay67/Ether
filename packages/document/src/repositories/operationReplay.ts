import {
  EtherGraphSchema,
  GraphOperationSchema,
  type EtherGraph,
  type GraphOperation
} from "@ether/schema";

export class GraphOperationReplayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GraphOperationReplayError";
  }
}

function requireGraph(graphs: Map<string, EtherGraph>, graphId: string): EtherGraph {
  const graph = graphs.get(graphId);
  if (graph === undefined) {
    throw new GraphOperationReplayError(`Graph operation target ${graphId} does not exist.`);
  }
  return graph;
}

function addUnique<T extends { id: string }>(items: T[], item: T, kind: string): T[] {
  if (items.some(({ id }) => id === item.id)) {
    throw new GraphOperationReplayError(`${kind} ${item.id} already exists.`);
  }
  return [...items, item];
}

function insertUnique<T extends { id: string }>(items: T[], item: T, kind: string, index?: number): T[] {
  const appended = addUnique(items, item, kind);
  if (index === undefined || index >= items.length) return appended;
  return [...items.slice(0, index), item, ...items.slice(index)];
}

function replaceRequired<T extends { id: string }>(
  items: T[],
  id: string,
  replacement: T,
  kind: string
): T[] {
  const index = items.findIndex((item) => item.id === id);
  if (index < 0) {
    throw new GraphOperationReplayError(`${kind} ${id} does not exist.`);
  }
  const result = items.slice();
  result[index] = replacement;
  return result;
}

function removeRequired<T extends { id: string }>(items: T[], id: string, kind: string): T[] {
  if (!items.some((item) => item.id === id)) {
    throw new GraphOperationReplayError(`${kind} ${id} does not exist.`);
  }
  return items.filter((item) => item.id !== id);
}

function unreachable(operation: never): never {
  throw new GraphOperationReplayError(
    `Unsupported graph operation ${(operation as { type?: unknown }).type as string}.`
  );
}

export function replayGraphOperations(
  inputGraphs: readonly EtherGraph[],
  inputOperations: readonly GraphOperation[]
): EtherGraph[] {
  const graphs = new Map<string, EtherGraph>();
  for (const input of inputGraphs) {
    const graph = EtherGraphSchema.parse(structuredClone(input));
    if (graphs.has(graph.id)) {
      throw new GraphOperationReplayError(`Graph ${graph.id} appears more than once.`);
    }
    graphs.set(graph.id, graph);
  }

  for (const input of inputOperations) {
    const operation = GraphOperationSchema.parse(structuredClone(input));
    const graph = requireGraph(graphs, operation.graphId);
    switch (operation.type) {
      case "addNode":
        graphs.set(graph.id, { ...graph, nodes: insertUnique(graph.nodes, operation.node, "Node", operation.index) });
        break;
      case "updateNode":
        graphs.set(graph.id, {
          ...graph,
          nodes: replaceRequired(graph.nodes, operation.nodeId, operation.node, "Node")
        });
        break;
      case "removeNode":
        graphs.set(graph.id, {
          ...graph,
          nodes: removeRequired(graph.nodes, operation.nodeId, "Node")
        });
        break;
      case "addEdge":
        graphs.set(graph.id, { ...graph, edges: insertUnique(graph.edges, operation.edge, "Edge", operation.index) });
        break;
      case "updateEdge":
        graphs.set(graph.id, {
          ...graph,
          edges: replaceRequired(graph.edges, operation.edgeId, operation.edge, "Edge")
        });
        break;
      case "removeEdge":
        graphs.set(graph.id, {
          ...graph,
          edges: removeRequired(graph.edges, operation.edgeId, "Edge")
        });
        break;
      case "moveNodes": {
        const positions = new Map(operation.positions.map((item) => [item.nodeId, item.position]));
        for (const nodeId of positions.keys()) {
          if (!graph.nodes.some(({ id }) => id === nodeId)) {
            throw new GraphOperationReplayError(`Node ${nodeId} does not exist.`);
          }
        }
        graphs.set(graph.id, {
          ...graph,
          nodes: graph.nodes.map((node) => ({
            ...node,
            position: positions.get(node.id) ?? node.position
          }))
        });
        break;
      }
      case "resizeNodes": {
        const sizes = new Map(operation.sizes.map((item) => [item.nodeId, item.size]));
        for (const nodeId of sizes.keys()) {
          if (!graph.nodes.some(({ id }) => id === nodeId)) {
            throw new GraphOperationReplayError(`Node ${nodeId} does not exist.`);
          }
        }
        graphs.set(graph.id, {
          ...graph,
          nodes: graph.nodes.map((node) => ({ ...node, size: sizes.get(node.id) ?? node.size }))
        });
        break;
      }
      case "createGroup":
        graphs.set(graph.id, {
          ...graph,
          groups: insertUnique(graph.groups, operation.group, "Group", operation.index)
        });
        break;
      case "updateGroup":
        graphs.set(graph.id, {
          ...graph,
          groups: replaceRequired(graph.groups, operation.groupId, operation.group, "Group")
        });
        break;
      case "removeGroup":
        graphs.set(graph.id, {
          ...graph,
          groups: removeRequired(graph.groups, operation.groupId, "Group")
        });
        break;
      case "createModule": {
        for (const subtreeGraph of operation.subtree.graphs) {
          const internal = EtherGraphSchema.parse(subtreeGraph);
          const existing = graphs.get(internal.id);
          if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(internal)) {
            throw new GraphOperationReplayError(`Module graph ${internal.id} already exists with different state.`);
          }
          graphs.set(internal.id, internal);
        }
        graphs.set(graph.id, {
          ...graph,
          modules: insertUnique(graph.modules, operation.module, "Module", operation.index)
        });
        break;
      }
      case "updateModule":
        graphs.set(graph.id, {
          ...graph,
          modules: replaceRequired(graph.modules, operation.moduleId, operation.module, "Module")
        });
        break;
      case "removeModule": {
        const removed = graph.modules.find(({ id }) => id === operation.moduleId);
        if (removed === undefined) {
          throw new GraphOperationReplayError(`Module ${operation.moduleId} does not exist.`);
        }
        const connected = graph.edges.filter((edge) =>
          (edge.from.kind === "module" && edge.from.moduleId === removed.id) ||
          (edge.to.kind === "module" && edge.to.moduleId === removed.id)
        );
        if (connected.length > 0) {
          throw new GraphOperationReplayError(`Module ${operation.moduleId} still has connected edge dependencies.`);
        }
        const removing = new Set<string>();
        const removeSubtree = (graphId: string): void => {
          if (removing.has(graphId)) {
            return;
          }
          const internal = graphs.get(graphId);
          if (internal === undefined) {
            throw new GraphOperationReplayError(`Module graph ${graphId} does not exist.`);
          }
          removing.add(graphId);
          graphs.delete(graphId);
          for (const nested of internal.modules) removeSubtree(nested.graphId);
        };
        graphs.set(graph.id, {
          ...graph,
          modules: graph.modules.filter(({ id }) => id !== operation.moduleId)
        });
        removeSubtree(removed.graphId);
        break;
      }
      case "updateModuleInterface": {
        const current = graph.modules.find(({ id }) => id === operation.moduleId);
        if (current === undefined) {
          throw new GraphOperationReplayError(`Module ${operation.moduleId} does not exist.`);
        }
        graphs.set(graph.id, {
          ...graph,
          modules: replaceRequired(
            graph.modules,
            operation.moduleId,
            { ...current, interface: operation.interface },
            "Module"
          )
        });
        break;
      }
      case "updateGraphProperties":
        graphs.set(graph.id, {
          ...graph,
          ...(operation.title === undefined ? {} : { title: operation.title }),
          ...(operation.viewState === undefined ? {} : { viewState: operation.viewState })
        });
        break;
      default:
        unreachable(operation);
    }
  }

  return [...graphs.values()]
    .map((graph) => EtherGraphSchema.parse(graph))
    .sort((left, right) => left.id.localeCompare(right.id));
}
