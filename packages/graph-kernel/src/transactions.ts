import {
  firstTemporaryIdentityReference,
  graphOperationIdentityReferences,
  GraphOperationSchema,
  GraphTransactionSchema,
  parseTemporaryReference,
  type EtherGraph,
  type GraphOperation,
  type GraphTransaction,
  type ModuleSubtreeSnapshot,
  type TemporaryReferenceKind
} from "@ether/schema";
import { moduleSubtree } from "./modules.js";
import { structurallyEqual } from "./structural.js";
import { validateFullGraphState } from "./validation.js";

export class GraphKernelError extends Error {
  constructor(public readonly code: string, message: string, public readonly diagnostics: readonly { code: string; message: string }[] = []) {
    super(message);
    this.name = "GraphKernelError";
  }
}

type TempFactory = (reference: { kind: TemporaryReferenceKind; name: string }) => string;

function cloneGraphs(graphs: readonly EtherGraph[]): Map<string, EtherGraph> {
  return new Map(structuredClone(graphs).map((graph) => [graph.id, graph]));
}

function entityIds(graphs: readonly EtherGraph[]): Set<string> {
  return new Set(graphs.flatMap((graph) => [graph.id, ...graph.nodes.map((item) => item.id), ...graph.edges.map((item) => item.id), ...graph.groups.map((item) => item.id), ...graph.modules.map((item) => item.id)]));
}

function declarations(operations: readonly GraphOperation[]): Map<string, TemporaryReferenceKind> {
  const result = new Map<string, TemporaryReferenceKind>();
  const add = (value: string, kind: TemporaryReferenceKind): void => {
    const temporary = parseTemporaryReference(value);
    if (temporary === null) return;
    if (temporary.kind !== kind) throw new GraphKernelError("TEMP_KIND_MISMATCH", `Temporary ID ${value} declares ${temporary.kind} where ${kind} is required.`);
    if (result.has(value)) throw new GraphKernelError("TEMP_DECLARATION_COLLISION", `Temporary ID ${value} is declared more than once.`);
    result.set(value, kind);
  };
  const graphContents = (graph: EtherGraph): void => {
    add(graph.id, "graph");
    graph.nodes.forEach((item) => add(item.id, "node"));
    graph.edges.forEach((item) => add(item.id, "edge"));
    graph.groups.forEach((item) => add(item.id, "group"));
    graph.modules.forEach((item) => add(item.id, "module"));
  };
  for (const operation of operations) {
    if (operation.type === "addNode") add(operation.node.id, "node");
    else if (operation.type === "addEdge") add(operation.edge.id, "edge");
    else if (operation.type === "createGroup") add(operation.group.id, "group");
    else if (operation.type === "createModule") { add(operation.module.id, "module"); operation.subtree.graphs.forEach(graphContents); }
  }
  return result;
}

function setPath(root: object, path: readonly string[], value: string): void {
  let owner: unknown = root;
  for (const segment of path.slice(0, -1)) {
    owner = Reflect.get(owner as object, segment);
  }
  Reflect.set(owner as object, path.at(-1)!, value);
}

function replaceTemporaryIds(
  operation: GraphOperation,
  resolved: ReadonlyMap<string, string>
): GraphOperation {
  const replacement = structuredClone(operation);
  for (const reference of graphOperationIdentityReferences(replacement)) {
    const temporary = parseTemporaryReference(reference.value);
    if (temporary === null) continue;
    if (reference.expectedKind === null) {
      throw new GraphKernelError(
        "TEMP_REFERENCE_UNSUPPORTED",
        `Temporary reference ${reference.value} is not supported at ${reference.path.join(".")}.`
      );
    }
    if (temporary.kind !== reference.expectedKind) {
      throw new GraphKernelError("TEMP_KIND_MISMATCH", `Temporary reference ${reference.value} has kind ${temporary.kind}, expected ${reference.expectedKind}.`);
    }
    const resolvedId = resolved.get(reference.value);
    if (resolvedId === undefined) throw new GraphKernelError("TEMP_REFERENCE_UNRESOLVED", `Temporary reference ${reference.value} has no declaration.`);
    setPath(replacement, reference.path, resolvedId);
  }
  const unresolved = firstTemporaryIdentityReference(graphOperationIdentityReferences(replacement));
  if (unresolved !== null) {
    throw new GraphKernelError(
      "TEMP_REFERENCE_UNRESOLVED",
      `Temporary reference ${unresolved.value} survived resolution at ${unresolved.path.join(".")}.`
    );
  }
  return replacement;
}

function requireGraph(graphs: Map<string, EtherGraph>, graphId: string): EtherGraph {
  const graph = graphs.get(graphId);
  if (graph === undefined) throw new GraphKernelError("GRAPH_NOT_FOUND", `Graph ${graphId} does not exist.`);
  return graph;
}

function replaceById<T extends { id: string }>(items: T[], id: string, replacement: T): T[] {
  const index = items.findIndex((item) => item.id === id);
  if (index < 0) throw new GraphKernelError("ENTITY_NOT_FOUND", `Entity ${id} does not exist.`);
  const result = items.slice();
  result[index] = replacement;
  return result;
}

function requireById<T extends { id: string }>(items: T[], id: string): T {
  const item = items.find((candidate) => candidate.id === id);
  if (item === undefined) throw new GraphKernelError("ENTITY_NOT_FOUND", `Entity ${id} does not exist.`);
  return item;
}

function addUnique<T extends { id: string }>(items: T[], item: T): T[] {
  if (items.some((candidate) => candidate.id === item.id)) throw new GraphKernelError("ENTITY_COLLISION", `Entity ${item.id} already exists.`);
  return [...items, item];
}

function insertUnique<T extends { id: string }>(items: T[], item: T, index?: number): T[] {
  const appended = addUnique(items, item);
  if (index === undefined || index >= items.length) return appended;
  return [...items.slice(0, index), item, ...items.slice(index)];
}

function snapshotFor(graphs: Map<string, EtherGraph>, rootGraphId: string): ModuleSubtreeSnapshot {
  return { rootGraphId, graphs: moduleSubtree([...graphs.values()], rootGraphId).map((graph) => structuredClone(graph)) };
}

function applyOne(graphs: Map<string, EtherGraph>, operation: GraphOperation): GraphOperation {
  const graph = requireGraph(graphs, operation.graphId);
  switch (operation.type) {
    case "addNode": graphs.set(graph.id, { ...graph, nodes: insertUnique(graph.nodes, operation.node, operation.index) }); return { type: "removeNode", graphId: graph.id, nodeId: operation.node.id };
    case "updateNode": { const old = requireById(graph.nodes, operation.nodeId); graphs.set(graph.id, { ...graph, nodes: replaceById(graph.nodes, operation.nodeId, operation.node) }); return { type: "updateNode", graphId: graph.id, nodeId: old.id, node: old }; }
    case "removeNode": { const old = requireById(graph.nodes, operation.nodeId); const index = graph.nodes.findIndex((item) => item.id === old.id); graphs.set(graph.id, { ...graph, nodes: graph.nodes.filter((item) => item.id !== old.id) }); return { type: "addNode", graphId: graph.id, node: old, index }; }
    case "addEdge": graphs.set(graph.id, { ...graph, edges: insertUnique(graph.edges, operation.edge, operation.index) }); return { type: "removeEdge", graphId: graph.id, edgeId: operation.edge.id };
    case "updateEdge": { const old = requireById(graph.edges, operation.edgeId); graphs.set(graph.id, { ...graph, edges: replaceById(graph.edges, operation.edgeId, operation.edge) }); return { type: "updateEdge", graphId: graph.id, edgeId: old.id, edge: old }; }
    case "removeEdge": { const old = requireById(graph.edges, operation.edgeId); const index = graph.edges.findIndex((item) => item.id === old.id); graphs.set(graph.id, { ...graph, edges: graph.edges.filter((item) => item.id !== old.id) }); return { type: "addEdge", graphId: graph.id, edge: old, index }; }
    case "moveNodes": { const old = operation.positions.map(({ nodeId }) => ({ nodeId, position: requireById(graph.nodes, nodeId).position })); const positions = new Map(operation.positions.map((item) => [item.nodeId, item.position])); graphs.set(graph.id, { ...graph, nodes: graph.nodes.map((node) => ({ ...node, position: positions.get(node.id) ?? node.position })) }); return { type: "moveNodes", graphId: graph.id, positions: old }; }
    case "resizeNodes": { const old = operation.sizes.map(({ nodeId }) => ({ nodeId, size: requireById(graph.nodes, nodeId).size })); const sizes = new Map(operation.sizes.map((item) => [item.nodeId, item.size])); graphs.set(graph.id, { ...graph, nodes: graph.nodes.map((node) => ({ ...node, size: sizes.get(node.id) ?? node.size })) }); return { type: "resizeNodes", graphId: graph.id, sizes: old }; }
    case "createGroup": graphs.set(graph.id, { ...graph, groups: insertUnique(graph.groups, operation.group, operation.index) }); return { type: "removeGroup", graphId: graph.id, groupId: operation.group.id };
    case "updateGroup": { const old = requireById(graph.groups, operation.groupId); graphs.set(graph.id, { ...graph, groups: replaceById(graph.groups, operation.groupId, operation.group) }); return { type: "updateGroup", graphId: graph.id, groupId: old.id, group: old }; }
    case "removeGroup": { const old = requireById(graph.groups, operation.groupId); const index = graph.groups.findIndex((item) => item.id === old.id); graphs.set(graph.id, { ...graph, groups: graph.groups.filter((item) => item.id !== old.id) }); return { type: "createGroup", graphId: graph.id, group: old, index }; }
    case "createModule": {
      for (const subtreeGraph of operation.subtree.graphs) {
        if (graphs.has(subtreeGraph.id)) throw new GraphKernelError("GRAPH_COLLISION", `Module graph ${subtreeGraph.id} already exists.`);
        graphs.set(subtreeGraph.id, structuredClone(subtreeGraph));
      }
      graphs.set(graph.id, { ...graph, modules: insertUnique(graph.modules, operation.module, operation.index) });
      return { type: "removeModule", graphId: graph.id, moduleId: operation.module.id };
    }
    case "updateModule": {
      const old = requireById(graph.modules, operation.moduleId);
      const oldSubtree = operation.subtree === undefined ? undefined : snapshotFor(graphs, old.graphId);
      if (operation.subtree !== undefined) {
        const replacedGraphIds = new Set(oldSubtree!.graphs.map((item) => item.id));
        const collision = operation.subtree.graphs.find((item) => graphs.has(item.id) && !replacedGraphIds.has(item.id));
        if (collision !== undefined) throw new GraphKernelError("GRAPH_COLLISION", `Module subtree update has a graph collision: ${collision.id}.`);
        oldSubtree!.graphs.forEach((item) => graphs.delete(item.id));
        operation.subtree.graphs.forEach((item) => graphs.set(item.id, structuredClone(item)));
      }
      graphs.set(graph.id, { ...graph, modules: replaceById(graph.modules, operation.moduleId, operation.module) });
      return { type: "updateModule", graphId: graph.id, moduleId: old.id, module: old, ...(oldSubtree === undefined ? {} : { subtree: oldSubtree }) };
    }
    case "removeModule": {
      const old = requireById(graph.modules, operation.moduleId);
      const connected = graph.edges.filter((edge) => (edge.from.kind === "module" && edge.from.moduleId === old.id) || (edge.to.kind === "module" && edge.to.moduleId === old.id));
      if (connected.length > 0) throw new GraphKernelError("MODULE_DEPENDENCIES_REMAIN", `Module ${old.id} still has connected edge dependencies: ${connected.map((edge) => edge.id).join(", ")}.`);
      const subtree = snapshotFor(graphs, old.graphId);
      const index = graph.modules.findIndex((item) => item.id === old.id);
      subtree.graphs.forEach((item) => graphs.delete(item.id));
      graphs.set(graph.id, { ...graph, modules: graph.modules.filter((item) => item.id !== old.id) });
      return { type: "createModule", graphId: graph.id, module: old, subtree, index };
    }
    case "updateModuleInterface": { const old = requireById(graph.modules, operation.moduleId); graphs.set(graph.id, { ...graph, modules: replaceById(graph.modules, old.id, { ...old, interface: operation.interface }) }); return { type: "updateModuleInterface", graphId: graph.id, moduleId: old.id, interface: old.interface }; }
    case "updateGraphProperties": { const inverse: GraphOperation = { type: "updateGraphProperties", graphId: graph.id, ...(operation.title === undefined ? {} : { title: graph.title }), ...(operation.viewState === undefined ? {} : { viewState: graph.viewState }) }; graphs.set(graph.id, { ...graph, ...(operation.title === undefined ? {} : { title: operation.title }), ...(operation.viewState === undefined ? {} : { viewState: operation.viewState }) }); return inverse; }
  }
}

function replay(inputGraphs: readonly EtherGraph[], operations: readonly GraphOperation[], captureInverse: boolean): { graphs: EtherGraph[]; inverse: GraphOperation[] } {
  const graphs = cloneGraphs(inputGraphs);
  const inverse: GraphOperation[] = [];
  for (const operation of operations) {
    const item = applyOne(graphs, GraphOperationSchema.parse(structuredClone(operation)));
    if (captureInverse) inverse.push(item);
  }
  return { graphs: [...graphs.values()].sort((left, right) => left.id.localeCompare(right.id)), inverse };
}

function validateResult(graphs: readonly EtherGraph[], capabilities: readonly string[]): void {
  const diagnostics = validateFullGraphState(graphs, capabilities);
  if (diagnostics.length > 0) throw new GraphKernelError("INVALID_POST_TRANSACTION_GRAPH", diagnostics.map((item) => `${item.code}: ${item.message}`).join("\n"), diagnostics);
}

function requireAffectedBaseRevisions(graphs: readonly EtherGraph[], operations: readonly GraphOperation[], baseGraphRevisions: Readonly<Record<string, string>>): void {
  const byId = new Map(graphs.map((graph) => [graph.id, graph]));
  const affected = new Set<string>();
  for (const operation of operations) {
    if (byId.has(operation.graphId)) affected.add(operation.graphId);
    if (operation.type === "removeModule" || (operation.type === "updateModule" && operation.subtree !== undefined)) {
      const parent = byId.get(operation.graphId);
      const module = parent?.modules.find((candidate) => candidate.id === operation.moduleId);
      if (module !== undefined) moduleSubtree(graphs, module.graphId).forEach((graph) => affected.add(graph.id));
    }
    if (operation.type === "updateModule" && operation.subtree !== undefined) {
      operation.subtree.graphs.forEach((graph) => { if (byId.has(graph.id)) affected.add(graph.id); });
    }
  }
  for (const graphId of affected) if (!Object.hasOwn(baseGraphRevisions, graphId)) throw new GraphKernelError("MISSING_BASE_GRAPH_REVISION", `A base graph revision is required for affected graph ${graphId}.`);
}

function enforceLockedModuleBoundaries(graphs: readonly EtherGraph[], operations: readonly GraphOperation[]): void {
  const byId = new Map(graphs.map((graph) => [graph.id, graph]));
  for (const operation of operations) {
    if (operation.type === "createModule" && operation.module.locked === false) {
      throw new GraphKernelError("MODULE_MUST_START_LOCKED", `Module ${operation.module.id} must be locked when it is created.`);
    }
    if (operation.type !== "updateModule" && operation.type !== "removeModule") continue;
    const module = byId.get(operation.graphId)?.modules.find((candidate) => candidate.id === operation.moduleId);
    // Pre-recovery 4.0 records did not persist this field. Their compatibility
    // behavior stays unchanged until an explicit conversion/relock writes it.
    if (module === undefined || module.locked !== true) continue;
    if (operation.type === "removeModule") {
      throw new GraphKernelError("MODULE_LOCKED", `Unlock module ${module.id} before dissolving or removing it.`);
    }
    const moved = module.position.x !== operation.module.position.x || module.position.y !== operation.module.position.y;
    const resized = module.size.width !== operation.module.size.width || module.size.height !== operation.module.size.height;
    const changedMembership = operation.subtree !== undefined || module.graphId !== operation.module.graphId;
    if (moved || resized || changedMembership) {
      throw new GraphKernelError("MODULE_LOCKED", `Unlock module ${module.id} in a separate transaction before moving, resizing, or changing membership.`);
    }
  }
}

export function previewGraphTransaction(input: { graphs: readonly EtherGraph[]; transaction: GraphTransaction; capabilities?: readonly string[]; idFactory?: TempFactory }): {
  graphs: EtherGraph[]; forwardOperations: GraphOperation[]; inverseOperations: GraphOperation[]; tempIds: Record<string, string>; forwardReplay: EtherGraph[]; inverseReplay: EtherGraph[];
} {
  if (input.transaction.layoutPolicy !== "preserve") throw new GraphKernelError("LAYOUT_OPERATIONS_REQUIRED", "Layout policies must be expanded into explicit move/resize operations before preview.");
  const parsed = GraphTransactionSchema.parse(structuredClone(input.transaction));
  const declared = declarations(parsed.operations);
  const occupied = entityIds(input.graphs);
  const resolved = new Map<string, string>();
  for (const [reference, kind] of declared) {
    const temporary = parseTemporaryReference(reference)!;
    const id = (input.idFactory ?? ((item) => `${item.kind}-${item.name}`))({ kind, name: temporary.name });
    if (occupied.has(id) || [...resolved.values()].includes(id)) throw new GraphKernelError("TEMP_ID_COLLISION", `Resolved temporary ID collision: ${id}.`);
    resolved.set(reference, id);
  }
  const forwardOperations = parsed.operations.map((operation) => GraphOperationSchema.parse(replaceTemporaryIds(operation, resolved)));
  requireAffectedBaseRevisions(input.graphs, forwardOperations, parsed.baseGraphRevisions);
  enforceLockedModuleBoundaries(input.graphs, forwardOperations);
  const forward = replay(input.graphs, forwardOperations, true);
  validateResult(forward.graphs, input.capabilities ?? []);
  const replayedForward = replay(input.graphs, forwardOperations, false).graphs;
  const replayedInverse = replay(forward.graphs, forward.inverse.slice().reverse(), false).graphs;
  if (!structurallyEqual(replayedForward, forward.graphs)) throw new GraphKernelError("FORWARD_REPLAY_PROOF_FAILED", "Forward graph transaction replay did not reproduce the preview snapshots.");
  const expectedInverse = [...input.graphs].sort((left, right) => left.id.localeCompare(right.id));
  if (!structurallyEqual(replayedInverse, expectedInverse)) throw new GraphKernelError("INVERSE_REPLAY_PROOF_FAILED", "Inverse graph transaction replay did not reproduce the input snapshots.");
  return { graphs: forward.graphs, forwardOperations, inverseOperations: forward.inverse, tempIds: Object.fromEntries(resolved), forwardReplay: replayedForward, inverseReplay: replayedInverse };
}
