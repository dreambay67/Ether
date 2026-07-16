import type { EtherGraph } from "../project/schema.js";
import { canConnectNodeKinds } from "./connectionRules.js";
import { EDGE_GRAPH_VERSION, canonicalChannel, canonicalRole } from "./edgeSemantics.js";
import {
  createCanvasTemplate,
  type CanvasTemplateId,
  type CanvasTemplateOptions
} from "./reviewRouterTemplate.js";

export type GraphPatchOperation =
  | { type: "addNode"; node: EtherGraph["nodes"][number] & { id: string } }
  | { type: "updateNodeConfig"; nodeId: string; config: Record<string, unknown> }
  | { type: "deleteNode"; nodeId: string }
  | { type: "addEdge"; edge: EtherGraph["edges"][number] & { id: string; source: string; target: string } }
  | { type: "updateEdge"; edgeId: string; patch: Record<string, unknown> }
  | { type: "deleteEdge"; edgeId: string }
  | { type: "insertTemplate"; templateId: CanvasTemplateId; options?: CanvasTemplateOptions };

export type GraphPatch = {
  id?: string;
  title?: string;
  description?: string;
  operations: GraphPatchOperation[];
};

export type GraphPatchEntityChange = "added" | "changed" | "removed";

export type GraphPatchNodeDiff = {
  id: string;
  change: GraphPatchEntityChange;
  before?: EtherGraph["nodes"][number];
  after?: EtherGraph["nodes"][number];
};

export type GraphPatchEdgeDiff = {
  id: string;
  change: GraphPatchEntityChange;
  before?: EtherGraph["edges"][number];
  after?: EtherGraph["edges"][number];
};

export type GraphPatchDiffSummary = {
  addedNodes: number;
  changedNodes: number;
  removedNodes: number;
  addedEdges: number;
  changedEdges: number;
  removedEdges: number;
};

export type GraphPatchPreview = {
  patch: GraphPatch;
  summary: GraphPatchDiffSummary;
  nodeDiffs: GraphPatchNodeDiff[];
  edgeDiffs: GraphPatchEdgeDiff[];
  nextGraph: EtherGraph;
};

type GraphNode = EtherGraph["nodes"][number] & {
  id?: unknown;
  data?: unknown;
};

type GraphEdge = EtherGraph["edges"][number] & {
  id?: unknown;
  source?: unknown;
  target?: unknown;
  sourceHandle?: unknown;
  targetHandle?: unknown;
  locked?: unknown;
  data?: unknown;
};

export function applyGraphPatch(graph: EtherGraph, patch: GraphPatch): EtherGraph {
  const nextGraph: EtherGraph = cloneGraph(graph);

  for (const operation of patch.operations) {
    applyGraphPatchOperation(nextGraph, operation);
  }

  return {
    ...nextGraph,
    updatedAt: new Date().toISOString()
  };
}

export function previewGraphPatch(graph: EtherGraph, patch: GraphPatch): GraphPatchPreview {
  const nextGraph = applyGraphPatch(graph, patch);
  const nodeDiffs = diffEntities(graph.nodes, nextGraph.nodes) as GraphPatchNodeDiff[];
  const edgeDiffs = diffEntities(graph.edges, nextGraph.edges) as GraphPatchEdgeDiff[];

  return {
    patch,
    summary: {
      addedNodes: nodeDiffs.filter((diff) => diff.change === "added").length,
      changedNodes: nodeDiffs.filter((diff) => diff.change === "changed").length,
      removedNodes: nodeDiffs.filter((diff) => diff.change === "removed").length,
      addedEdges: edgeDiffs.filter((diff) => diff.change === "added").length,
      changedEdges: edgeDiffs.filter((diff) => diff.change === "changed").length,
      removedEdges: edgeDiffs.filter((diff) => diff.change === "removed").length
    },
    nodeDiffs,
    edgeDiffs,
    nextGraph
  };
}

function applyGraphPatchOperation(graph: EtherGraph, operation: GraphPatchOperation) {
  switch (operation.type) {
    case "addNode":
      assertUniqueId(graph.nodes, requiredEntityId(operation.node, "node"), "node");
      graph.nodes.push(cloneRecord(operation.node));
      return;
    case "updateNodeConfig": {
      const index = findEntityIndex(graph.nodes, operation.nodeId, "node");
      const node = graph.nodes[index] as GraphNode;
      const data = recordOrEmpty(node.data);

      assertNodeUnlocked(node);
      graph.nodes[index] = {
        ...node,
        data: {
          ...data,
          ...operation.config
        }
      };
      return;
    }
    case "deleteNode":
      assertNodeDeletionAllowed(graph, operation.nodeId);
      graph.nodes = graph.nodes.filter((node) => requiredEntityId(node, "node") !== operation.nodeId);
      graph.edges = graph.edges.filter((edge) => {
        const candidate = edge as GraphEdge;
        return candidate.source !== operation.nodeId && candidate.target !== operation.nodeId;
      });
      return;
    case "addEdge":
      assertUniqueId(graph.edges, requiredEntityId(operation.edge, "edge"), "edge");
      graph.edges.push(validatePatchEdge(graph, operation.edge, null));
      return;
    case "updateEdge": {
      const index = findEntityIndex(graph.edges, operation.edgeId, "edge");
      const edge = graph.edges[index] as GraphEdge;

      if ("id" in operation.patch) {
        throw new Error("Graph edge id cannot be changed.");
      }

      assertRelationshipUnlocked(graph, edge);
      const nextEdge = {
        ...edge,
        ...operation.patch
      } as GraphEdge;

      graph.edges[index] = validatePatchEdge(graph, nextEdge, operation.edgeId);
      return;
    }
    case "deleteEdge":
      assertRelationshipUnlocked(graph, graph.edges[findEntityIndex(graph.edges, operation.edgeId, "edge")] as GraphEdge);
      graph.edges = graph.edges.filter((edge) => requiredEntityId(edge, "edge") !== operation.edgeId);
      return;
    case "insertTemplate": {
      const template = createCanvasTemplate(operation.templateId, operation.options);

      for (const node of template.nodes) {
        assertUniqueId(graph.nodes, node.id, "node");
      }

      for (const edge of template.edges) {
        assertUniqueId(graph.edges, edge.id, "edge");
      }

      graph.nodes.push(...template.nodes.map((node) => cloneRecord(node)));
      graph.edges.push(...template.edges.map((edge) => cloneRecord(edge)));
      return;
    }
    default:
      assertNever(operation);
  }
}

function diffEntities(
  beforeEntities: Array<Record<string, unknown>>,
  afterEntities: Array<Record<string, unknown>>
) {
  const before = new Map(beforeEntities.map((entity) => [requiredEntityId(entity, "entity"), entity]));
  const after = new Map(afterEntities.map((entity) => [requiredEntityId(entity, "entity"), entity]));
  const ids = Array.from(new Set([...before.keys(), ...after.keys()])).sort();

  return ids
    .map((id) => {
      const beforeEntity = before.get(id);
      const afterEntity = after.get(id);

      if (!beforeEntity && afterEntity) {
        return { id, change: "added", after: afterEntity };
      }

      if (beforeEntity && !afterEntity) {
        return { id, change: "removed", before: beforeEntity };
      }

      if (beforeEntity && afterEntity && stableStringify(beforeEntity) !== stableStringify(afterEntity)) {
        return { id, change: "changed", before: beforeEntity, after: afterEntity };
      }

      return null;
    })
    .filter((diff): diff is NonNullable<typeof diff> => diff !== null);
}

function cloneGraph(graph: EtherGraph): EtherGraph {
  return {
    graphVersion: graph.graphVersion,
    nodes: graph.nodes.map((node) => cloneRecord(node)),
    edges: graph.edges.map((edge) => cloneRecord(edge)),
    viewport: { ...graph.viewport },
    selectedSnapshotId: graph.selectedSnapshotId,
    updatedAt: graph.updatedAt
  };
}

function cloneRecord<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function recordOrEmpty(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function requiredEntityId(entity: Record<string, unknown>, kind: string) {
  const id = entity.id;

  if (typeof id !== "string" || !id.trim()) {
    throw new Error(`Graph patch ${kind} is missing an id.`);
  }

  return id;
}

function findEntityIndex(entities: Array<Record<string, unknown>>, id: string, kind: string) {
  const index = entities.findIndex((entity) => entity.id === id);

  if (index === -1) {
    throw new Error(`Unknown graph ${kind}: ${id}`);
  }

  return index;
}

function assertUniqueId(entities: Array<Record<string, unknown>>, id: string, kind: string) {
  if (entities.some((entity) => entity.id === id)) {
    throw new Error(`Graph ${kind} already exists: ${id}`);
  }
}

function requiredEdgeEndpoint(edge: GraphEdge, field: "source" | "target") {
  const value = edge[field];

  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Graph edge ${field} is required.`);
  }

  return value;
}

function findEndpointNode(graph: EtherGraph, nodeId: string, field: "source" | "target") {
  const node = graph.nodes.find((candidate) => candidate.id === nodeId) as GraphNode | undefined;

  if (!node) {
    throw new Error(`Graph edge ${field} node does not exist: ${nodeId}`);
  }

  return node;
}

function validatePatchEdge(graph: EtherGraph, edge: GraphEdge, existingEdgeId: string | null): GraphEdge {
  const source = requiredEdgeEndpoint(edge, "source");
  const target = requiredEdgeEndpoint(edge, "target");
  const sourceNode = findEndpointNode(graph, source, "source");
  const targetNode = findEndpointNode(graph, target, "target");
  const edgeData = recordOrEmpty(edge.data);

  assertNodeEndpointUnlocked(sourceNode);
  assertNodeEndpointUnlocked(targetNode);

  const rule = canConnectNodeKinds(
    String(recordOrEmpty(sourceNode.data).kind ?? ""),
    String(recordOrEmpty(targetNode.data).kind ?? ""),
    {
      sourceId: source,
      targetId: target,
      sourceDefinitionId: stringOrNull(recordOrEmpty(sourceNode.data).definitionId),
      targetDefinitionId: stringOrNull(recordOrEmpty(targetNode.data).definitionId),
      sourcePortId: stringOrNull(edge.sourceHandle),
      targetPortId: stringOrNull(edge.targetHandle),
      sourceChannel: explicitEdgeChannel(edgeData.sourceChannel, edge.sourceHandle),
      targetChannel: explicitEdgeChannel(edgeData.targetChannel, edge.targetHandle)
    }
  );

  if (!rule.allowed) {
    throw new Error(rule.reason ?? "Connection is not allowed.");
  }

  if (rule.adapter && rule.adapter.status !== "available") {
    const reason = rule.disabledReason ?? rule.adapter.reason ?? "This connection requires an unavailable adapter.";
    throw new Error(`Unavailable adapter: ${reason}`);
  }

  const sourceChannel = rule.sourceChannel ?? "text";
  const targetChannel = rule.targetChannel ?? "text";
  const label = String(edge.label ?? edgeData.label ?? rule.defaultLabel ?? "context");
  const role = canonicalRole(edgeData.role ?? rule.defaultRole ?? label);

  if (hasExactPatchEdgeLane(graph, source, target, sourceChannel, targetChannel, role, existingEdgeId)) {
    throw new Error("This connection already exists.");
  }

  return {
    ...edge,
    label,
    type: "etherEdge",
    data: {
      ...stripCanonicalEdgeData(edgeData),
      label,
      graphVersion: EDGE_GRAPH_VERSION,
      sourceChannel,
      targetChannel,
      role
    }
  };
}

function hasExactPatchEdgeLane(
  graph: EtherGraph,
  source: string,
  target: string,
  sourceChannel: unknown,
  targetChannel: unknown,
  role: unknown,
  existingEdgeId: string | null
) {
  const normalizedSourceChannel = canonicalChannel(sourceChannel);
  const normalizedTargetChannel = canonicalChannel(targetChannel);
  const normalizedRole = canonicalRole(role);

  return graph.edges.some((candidate) => {
    const graphEdge = candidate as GraphEdge;
    const candidateData = recordOrEmpty(graphEdge.data);
    const candidateSourceChannel =
      canonicalChannel(explicitEdgeChannel(candidateData.sourceChannel, graphEdge.sourceHandle)) ?? "text";
    const candidateTargetChannel =
      canonicalChannel(explicitEdgeChannel(candidateData.targetChannel, graphEdge.targetHandle)) ?? "text";
    const candidateRole = canonicalRole(candidateData.role ?? candidateData.label ?? graphEdge.label);

    return (
      graphEdge.id !== existingEdgeId &&
      graphEdge.source === source &&
      graphEdge.target === target &&
      candidateSourceChannel === normalizedSourceChannel &&
      candidateTargetChannel === normalizedTargetChannel &&
      candidateRole === normalizedRole
    );
  });
}

function explicitEdgeChannel(edgeDataChannel: unknown, handle: unknown) {
  return edgeDataChannel ?? (typeof handle === "string" && handle.trim() ? handle : undefined);
}

function stripCanonicalEdgeData(edgeData: Record<string, unknown>) {
  const {
    graphVersion: _graphVersion,
    sourceChannel: _sourceChannel,
    targetChannel: _targetChannel,
    role: _role,
    adapter: _adapter,
    disabledReason: _disabledReason,
    ...legacyEdgeData
  } = edgeData;

  return legacyEdgeData;
}

function assertNodeDeletionAllowed(graph: EtherGraph, nodeId: string) {
  const node = graph.nodes[findEntityIndex(graph.nodes, nodeId, "node")] as GraphNode;

  assertNodeUnlocked(node);

  for (const edge of graph.edges as GraphEdge[]) {
    if (edge.source !== nodeId && edge.target !== nodeId) {
      continue;
    }

    if (isLockedEdge(edge)) {
      throw new Error("Unlock the edge before changing it.");
    }

    const otherNodeId = edge.source === nodeId ? edge.target : edge.source;
    const otherNode = typeof otherNodeId === "string"
      ? (graph.nodes.find((candidate) => candidate.id === otherNodeId) as GraphNode | undefined)
      : undefined;

    if (otherNode && isLockedNode(otherNode)) {
      throw new Error("Unlock connected nodes before changing relationships.");
    }
  }
}

function assertRelationshipUnlocked(graph: EtherGraph, edge: GraphEdge) {
  if (isLockedEdge(edge)) {
    throw new Error("Unlock the edge before changing it.");
  }

  const source = typeof edge.source === "string"
    ? (graph.nodes.find((node) => node.id === edge.source) as GraphNode | undefined)
    : undefined;
  const target = typeof edge.target === "string"
    ? (graph.nodes.find((node) => node.id === edge.target) as GraphNode | undefined)
    : undefined;

  if (source && isLockedNode(source)) {
    throw new Error("Unlock connected nodes before changing relationships.");
  }

  if (target && isLockedNode(target)) {
    throw new Error("Unlock connected nodes before changing relationships.");
  }
}

function assertNodeUnlocked(node: GraphNode) {
  if (isLockedNode(node)) {
    throw new Error("Unlock the node before changing it.");
  }
}

function assertNodeEndpointUnlocked(node: GraphNode) {
  if (isLockedNode(node)) {
    throw new Error("Unlock connected nodes before changing relationships.");
  }
}

function isLockedNode(node: GraphNode) {
  return node.locked === true || recordOrEmpty(node.data).locked === true;
}

function isLockedEdge(edge: GraphEdge) {
  return edge.locked === true || recordOrEmpty(edge.data).locked === true;
}

function stringOrNull(value: unknown) {
  return typeof value === "string" ? value : null;
}

function stableStringify(value: unknown): string {
  if (value === undefined) {
    return "undefined";
  }

  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }

  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}

function assertNever(value: never): never {
  throw new Error(`Unsupported graph patch operation: ${JSON.stringify(value)}`);
}
