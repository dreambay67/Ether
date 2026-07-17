import type {
  EtherEdge,
  EtherGraph,
  EtherGroup,
  EtherModule,
  GraphOperation,
  ModuleInterface,
  ModuleSubtreeSnapshot,
  PreparedGraphCommit,
  WorkspaceViewState
} from "./graph.js";

export type TemporaryReferenceKind = "graph" | "node" | "edge" | "group" | "module";

export interface TemporaryReference {
  kind: TemporaryReferenceKind;
  name: string;
}

export interface GraphIdentityReference {
  expectedKind: TemporaryReferenceKind | null;
  path: string[];
  value: string;
}

const TEMPORARY_REFERENCE_PATTERN = /^\$temp:(graph|node|edge|group|module):(.+)$/;

export function parseTemporaryReference(value: string): TemporaryReference | null {
  const match = TEMPORARY_REFERENCE_PATTERN.exec(value);
  return match === null
    ? null
    : { kind: match[1] as TemporaryReferenceKind, name: match[2]! };
}

function identity(
  value: string,
  path: readonly string[],
  expectedKind: TemporaryReferenceKind | null
): GraphIdentityReference {
  return { expectedKind, path: [...path], value };
}

function edgeIdentityReferences(
  edge: EtherEdge,
  path: readonly string[]
): GraphIdentityReference[] {
  const result = [identity(edge.id, [...path, "id"], "edge")];
  for (const [key, endpoint] of [["from", edge.from], ["to", edge.to]] as const) {
    if (endpoint.kind === "node") {
      result.push(identity(endpoint.nodeId, [...path, key, "nodeId"], "node"));
    } else {
      result.push(identity(endpoint.moduleId, [...path, key, "moduleId"], "module"));
      result.push(identity(endpoint.portId, [...path, key, "portId"], null));
    }
  }
  if (edge.selector.kind === "pinned") {
    result.push(identity(edge.selector.outputVersionId, [...path, "selector", "outputVersionId"], null));
  }
  if (edge.adapter.kind === "explicit") {
    result.push(identity(edge.adapter.adapterId, [...path, "adapter", "adapterId"], null));
  }
  return result;
}

function groupIdentityReferences(
  group: EtherGroup,
  path: readonly string[]
): GraphIdentityReference[] {
  return [
    identity(group.id, [...path, "id"], "group"),
    ...group.nodeIds.map((nodeId, index) =>
      identity(nodeId, [...path, "nodeIds", String(index)], "node")
    )
  ];
}

function interfaceIdentityReferences(
  moduleInterface: ModuleInterface,
  path: readonly string[]
): GraphIdentityReference[] {
  const result: GraphIdentityReference[] = [];
  for (const [direction, ports] of [
    ["inputs", moduleInterface.inputs],
    ["outputs", moduleInterface.outputs]
  ] as const) {
    for (const [index, port] of ports.entries()) {
      result.push(identity(port.id, [...path, direction, String(index), "id"], null));
      result.push(identity(
        port.internalNodeId,
        [...path, direction, String(index), "internalNodeId"],
        "node"
      ));
    }
  }
  for (const [index, parameter] of moduleInterface.parameters.entries()) {
    result.push(identity(parameter.id, [...path, "parameters", String(index), "id"], null));
    result.push(identity(
      parameter.nodeId,
      [...path, "parameters", String(index), "nodeId"],
      "node"
    ));
  }
  return result;
}

function moduleIdentityReferences(
  module: EtherModule,
  path: readonly string[]
): GraphIdentityReference[] {
  return [
    identity(module.id, [...path, "id"], "module"),
    identity(module.graphId, [...path, "graphId"], "graph"),
    ...interfaceIdentityReferences(module.interface, [...path, "interface"])
  ];
}

function viewStateIdentityReferences(
  viewState: WorkspaceViewState,
  path: readonly string[]
): GraphIdentityReference[] {
  const result = [
    ...viewState.selectedNodeIds.map((nodeId, index) =>
      identity(nodeId, [...path, "selectedNodeIds", String(index)], "node")
    ),
    ...viewState.selectedEdgeIds.map((edgeId, index) =>
      identity(edgeId, [...path, "selectedEdgeIds", String(index)], "edge")
    )
  ];
  if (viewState.inspectorTarget !== null) {
    result.push(identity(
      viewState.inspectorTarget.id,
      [...path, "inspectorTarget", "id"],
      viewState.inspectorTarget.kind
    ));
  }
  return result;
}

export function graphIdentityReferences(
  graph: EtherGraph,
  path: readonly string[] = []
): GraphIdentityReference[] {
  return [
    identity(graph.id, [...path, "id"], "graph"),
    ...graph.nodes.map((node, index) =>
      identity(node.id, [...path, "nodes", String(index), "id"], "node")
    ),
    ...graph.edges.flatMap((edge, index) =>
      edgeIdentityReferences(edge, [...path, "edges", String(index)])
    ),
    ...graph.groups.flatMap((group, index) =>
      groupIdentityReferences(group, [...path, "groups", String(index)])
    ),
    ...graph.modules.flatMap((module, index) =>
      moduleIdentityReferences(module, [...path, "modules", String(index)])
    ),
    ...viewStateIdentityReferences(graph.viewState, [...path, "viewState"])
  ];
}

function subtreeIdentityReferences(
  subtree: ModuleSubtreeSnapshot,
  path: readonly string[]
): GraphIdentityReference[] {
  return [
    identity(subtree.rootGraphId, [...path, "rootGraphId"], "graph"),
    ...subtree.graphs.flatMap((graph, index) =>
      graphIdentityReferences(graph, [...path, "graphs", String(index)])
    )
  ];
}

export function graphOperationIdentityReferences(
  operation: GraphOperation,
  path: readonly string[] = []
): GraphIdentityReference[] {
  const result = [identity(operation.graphId, [...path, "graphId"], "graph")];
  switch (operation.type) {
    case "addNode":
      result.push(identity(operation.node.id, [...path, "node", "id"], "node"));
      break;
    case "updateNode":
      result.push(identity(operation.nodeId, [...path, "nodeId"], "node"));
      result.push(identity(operation.node.id, [...path, "node", "id"], "node"));
      break;
    case "removeNode":
      result.push(identity(operation.nodeId, [...path, "nodeId"], "node"));
      break;
    case "addEdge":
      result.push(...edgeIdentityReferences(operation.edge, [...path, "edge"]));
      break;
    case "updateEdge":
      result.push(identity(operation.edgeId, [...path, "edgeId"], "edge"));
      result.push(...edgeIdentityReferences(operation.edge, [...path, "edge"]));
      break;
    case "removeEdge":
      result.push(identity(operation.edgeId, [...path, "edgeId"], "edge"));
      break;
    case "moveNodes":
      result.push(...operation.positions.map((entry, index) =>
        identity(entry.nodeId, [...path, "positions", String(index), "nodeId"], "node")
      ));
      break;
    case "resizeNodes":
      result.push(...operation.sizes.map((entry, index) =>
        identity(entry.nodeId, [...path, "sizes", String(index), "nodeId"], "node")
      ));
      break;
    case "createGroup":
      result.push(...groupIdentityReferences(operation.group, [...path, "group"]));
      break;
    case "updateGroup":
      result.push(identity(operation.groupId, [...path, "groupId"], "group"));
      result.push(...groupIdentityReferences(operation.group, [...path, "group"]));
      break;
    case "removeGroup":
      result.push(identity(operation.groupId, [...path, "groupId"], "group"));
      break;
    case "createModule":
      result.push(...moduleIdentityReferences(operation.module, [...path, "module"]));
      result.push(...subtreeIdentityReferences(operation.subtree, [...path, "subtree"]));
      break;
    case "updateModule":
      result.push(identity(operation.moduleId, [...path, "moduleId"], "module"));
      result.push(...moduleIdentityReferences(operation.module, [...path, "module"]));
      if (operation.subtree !== undefined) {
        result.push(...subtreeIdentityReferences(operation.subtree, [...path, "subtree"]));
      }
      break;
    case "removeModule":
      result.push(identity(operation.moduleId, [...path, "moduleId"], "module"));
      break;
    case "updateModuleInterface":
      result.push(identity(operation.moduleId, [...path, "moduleId"], "module"));
      result.push(...interfaceIdentityReferences(operation.interface, [...path, "interface"]));
      break;
    case "updateGraphProperties":
      if (operation.viewState !== undefined) {
        result.push(...viewStateIdentityReferences(operation.viewState, [...path, "viewState"]));
      }
      break;
  }
  return result;
}

export function preparedCommitIdentityReferences(
  commit: PreparedGraphCommit
): GraphIdentityReference[] {
  return [
    identity(commit.id, ["id"], null),
    identity(commit.baseDocumentRevisionId, ["baseDocumentRevisionId"], null),
    ...Object.entries(commit.baseGraphRevisions).flatMap(([graphId, revisionId]) => [
      identity(graphId, ["baseGraphRevisions", graphId], "graph"),
      identity(revisionId, ["baseGraphRevisions", graphId], null)
    ]),
    ...commit.graphSnapshots.flatMap((graph, index) =>
      graphIdentityReferences(graph, ["graphSnapshots", String(index)])
    ),
    ...(commit.deletedGraphIds ?? []).map((graphId, index) =>
      identity(graphId, ["deletedGraphIds", String(index)], "graph")
    ),
    ...commit.forwardOperations.flatMap((operation, index) =>
      graphOperationIdentityReferences(operation, ["forwardOperations", String(index)])
    ),
    ...commit.inverseOperations.flatMap((operation, index) =>
      graphOperationIdentityReferences(operation, ["inverseOperations", String(index)])
    )
  ];
}

export function firstTemporaryIdentityReference(
  references: readonly GraphIdentityReference[]
): GraphIdentityReference | null {
  return references.find((reference) => parseTemporaryReference(reference.value) !== null) ?? null;
}
