import {
  useCallback,
  useEffect,
  useMemo,
  type Dispatch,
  type DragEvent,
  type RefObject,
  type SetStateAction
} from "react";
import {
  addEdge,
  type Connection,
  type Edge,
  type Node,
  type OnNodeDrag,
  type ReactFlowInstance,
  type Viewport
} from "@xyflow/react";
import { LATEST_GRAPH_VERSION, type AssetRecord, type EtherGraph } from "@ether/engine";
import {
  applyGraphPatch,
  previewGraphPatch,
  type GraphPatch,
  type GraphPatchPreview
} from "../../../../../../packages/engine/src/graph/graphPatch";
import type {
  CanvasTemplateId
} from "@ether/engine/graph/reviewRouterTemplate";
import { createCanvasTemplate } from "@ether/engine/graph/reviewRouterTemplate";
import {
  type CanvasNodeData,
  type EtherNodeDefinition,
  type ReferenceAssetEntry,
  createGraphNodeData,
  getNodeDefinition,
  referenceAssetsFromNodeData
} from "@ether/engine/graph/nodeCatalog";
import { decorateEdgeForNodes, defaultHandlesForConnection } from "@ether/engine/graph/edgeDecoration";
import { canConnectNodeKinds } from "@ether/engine/graph/connectionRules";
import { findEdgeInsertionTarget } from "@ether/engine/graph/canvasGeometry";
import { markDownstreamStale } from "@ether/engine/run/rerunState";
import { linkDroppedReferenceFilesSequentially } from "../assetDrop";
import { DEFAULT_REFERENCE_ROLE, normalizeReferenceRole } from "../referenceRoles";
import {
  deleteCanvasElements,
  pushCanvasHistory,
  pushCanvasHistoryFromBaseline,
  pushCanvasHistoryIfChanged,
  updateCanvasHistoryPresent,
  type CanvasHistory,
  type CanvasSnapshot
} from "../canvasHistory";
import {
  edgeTouchesLockedNode,
  normalizeEdges,
  normalizeNodes
} from "./useCanvasGraph";
import {
  DEFAULT_CONNECTION_ROLE,
  EDGE_GRAPH_VERSION,
  normalizeConnectionRole,
  normalizePayloadChannel,
  type ConnectionRole,
  type PayloadChannel
} from "../ports/channelRegistry";

type ContextMenuSetter = (value: {
  x: number;
  y: number;
  position: { x: number; y: number };
} | null) => void;

type EdgeChannelEndpoint = "source" | "target";

type ImageAssetDragPayload = {
  nodeId: string;
  assetId?: string;
  assetKind?: string;
  assetPath: string;
  assetMetadata?: Record<string, unknown>;
  title?: string;
};

export type ReferenceUploadMode = "replace" | "add";

const imageFileExtensionPattern = /\.(avif|bmp|gif|jpe?g|png|tiff?|webp)$/i;
const DEFAULT_NODE_WIDTH = 236;
const DEFAULT_NODE_HEIGHT = 188;
const DEFAULT_EDIT_NODE_WIDTH = 276;
const DEFAULT_EDIT_NODE_HEIGHT = 220;

function channelFromHandle(handle: unknown): PayloadChannel | undefined {
  return normalizePayloadChannel(handle);
}

function edgeDataForChannels(
  label: string,
  sourceChannel: PayloadChannel,
  targetChannel: PayloadChannel,
  role: ConnectionRole = DEFAULT_CONNECTION_ROLE,
  extra?: { adapter?: unknown; disabledReason?: string }
) {
  return {
    label,
    graphVersion: EDGE_GRAPH_VERSION,
    sourceChannel,
    targetChannel,
    role,
    ...(extra?.adapter ? { adapter: extra.adapter } : {}),
    ...(extra?.disabledReason ? { disabledReason: extra.disabledReason } : {})
  };
}

function normalizeEdgeChannelHandles(edge: Edge): Edge {
  const data = edge.data && typeof edge.data === "object" ? edge.data : {};
  const sourceChannel = channelFromHandle((data as { sourceChannel?: unknown }).sourceChannel) ?? channelFromHandle(edge.sourceHandle);
  const targetChannel = channelFromHandle((data as { targetChannel?: unknown }).targetChannel) ?? channelFromHandle(edge.targetHandle);

  return {
    ...edge,
    sourceHandle: sourceChannel ?? edge.sourceHandle,
    targetHandle: targetChannel ?? edge.targetHandle
  };
}

function decorateAndNormalizeEdges(edges: Edge[], nodes: Node<CanvasNodeData>[]) {
  return normalizeEdges(
    edges
      .map((edge) => decorateEdgeForNodes(edge, nodes) as Edge | null)
      .map((edge) => edge ? normalizeEdgeChannelHandles(edge) : null)
      .filter((edge): edge is Edge => edge !== null)
  );
}

function edgeChannel(edge: Edge, endpoint: EdgeChannelEndpoint): PayloadChannel {
  const data = edge.data && typeof edge.data === "object" ? edge.data : {};
  const dataChannel = endpoint === "source"
    ? (data as { sourceChannel?: unknown }).sourceChannel
    : (data as { targetChannel?: unknown }).targetChannel;
  const handle = endpoint === "source" ? edge.sourceHandle : edge.targetHandle;

  return channelFromHandle(dataChannel) ?? channelFromHandle(handle) ?? "text";
}

function edgeDataRecord(edge: Edge): Record<string, unknown> {
  return edge.data && typeof edge.data === "object" ? edge.data as Record<string, unknown> : {};
}

function edgeConnectionRole(edge: Edge): ConnectionRole {
  const data = edgeDataRecord(edge);

  return normalizeConnectionRole(data.role ?? data.label ?? edge.label);
}

function hasExactEdgeLane(
  candidateEdges: Edge[],
  sourceId: string,
  targetId: string,
  sourceChannel: PayloadChannel | undefined,
  targetChannel: PayloadChannel | undefined,
  role: ConnectionRole,
  excludedEdgeId?: string
) {
  if (!sourceChannel || !targetChannel) {
    return false;
  }

  return candidateEdges.some((edge) =>
    edge.id !== excludedEdgeId &&
    edge.source === sourceId &&
    edge.target === targetId &&
    edgeChannel(edge, "source") === sourceChannel &&
    edgeChannel(edge, "target") === targetChannel &&
    edgeConnectionRole(edge) === role
  );
}

function getBasename(filePath: string) {
  return filePath.split(/[\\/]/).filter(Boolean).at(-1) ?? filePath;
}

function referenceAssetEntryFromAsset(asset: AssetRecord): ReferenceAssetEntry {
  const originalName =
    typeof asset.metadata.originalName === "string" && asset.metadata.originalName.trim()
      ? asset.metadata.originalName
      : getBasename(asset.path);
  const artifactOnly = asset.metadata.artifactOnly === true;

  return {
    ...(artifactOnly ? {} : { assetId: asset.id }),
    assetKind: asset.kind,
    assetPath: asset.path,
    assetMetadata: asset.metadata,
    title: originalName,
    role: normalizeReferenceRole(asset.metadata.role),
    addedAt: new Date().toISOString()
  };
}

function primaryReferenceAsset(entries: ReferenceAssetEntry[]) {
  return entries.at(-1) ?? entries.at(0);
}

function isSupportedImageFile(file: File) {
  return file.type.startsWith("image/") || imageFileExtensionPattern.test(file.name);
}

function connectionTouchesLockedNode(
  source: Node<CanvasNodeData> | undefined,
  target: Node<CanvasNodeData> | undefined
) {
  return source?.data.locked === true || target?.data.locked === true;
}

function nodeDeletionWouldRemoveLockedRelationship(
  deletedNodeIds: string[],
  nodes: Node<CanvasNodeData>[],
  edges: Edge[]
) {
  const deleted = new Set(deletedNodeIds);

  return edges.some((edge) => {
    if (!deleted.has(edge.source) && !deleted.has(edge.target)) {
      return false;
    }

    const otherNodeId = deleted.has(edge.source) ? edge.target : edge.source;
    const otherNode = nodes.find((node) => node.id === otherNodeId);

    return otherNode?.data.locked === true;
  });
}

function createReferenceNodeData(asset: AssetRecord): CanvasNodeData {
  const baseData = createGraphNodeData("reference-image");
  const entry = referenceAssetEntryFromAsset(asset);
  const originalName = entry.title ?? getBasename(asset.path);
  const role = normalizeReferenceRole(asset.metadata.role);

  return {
    ...baseData,
    title: originalName,
    label: originalName,
    instruction: `Linked ${role} image reference`,
    notes: "",
    status: "complete",
    assetId: entry.assetId,
    assetKind: entry.assetKind,
    assetPath: entry.assetPath,
    assetMetadata: entry.assetMetadata,
    referenceAssets: [entry]
  };
}

function linkedReferenceAssetUpdates(
  asset: AssetRecord,
  mode: ReferenceUploadMode = "replace",
  currentData?: Partial<CanvasNodeData>
): Partial<CanvasNodeData> {
  const entry = referenceAssetEntryFromAsset(asset);
  const nextAssets = mode === "add"
    ? [...referenceAssetsFromNodeData(currentData), entry]
    : [entry];
  const primaryAsset = primaryReferenceAsset(nextAssets) ?? entry;
  const originalName = primaryAsset.title ?? getBasename(primaryAsset.assetPath);
  const role = normalizeReferenceRole(primaryAsset.role ?? primaryAsset.assetMetadata?.role);
  const title = nextAssets.length > 1 ? `${nextAssets.length} references` : originalName;

  return {
    title,
    label: title,
    instruction: nextAssets.length > 1
      ? `Linked ${nextAssets.length} image references`
      : `Linked ${role} image reference`,
    notes: "",
    status: "complete",
    rerunState: "complete",
    assetId: primaryAsset.assetId,
    assetKind: primaryAsset.assetKind,
    assetPath: primaryAsset.assetPath,
    assetMetadata: primaryAsset.assetMetadata,
    referenceAssets: nextAssets
  };
}

function parseImageAssetDragPayload(value: string): ImageAssetDragPayload | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as unknown;

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }

    const candidate = parsed as Partial<ImageAssetDragPayload>;

    if (typeof candidate.nodeId !== "string" || typeof candidate.assetPath !== "string") {
      return null;
    }

    return {
      nodeId: candidate.nodeId,
      assetId: typeof candidate.assetId === "string" ? candidate.assetId : undefined,
      assetKind: typeof candidate.assetKind === "string" ? candidate.assetKind : undefined,
      assetPath: candidate.assetPath,
      assetMetadata:
        candidate.assetMetadata && typeof candidate.assetMetadata === "object" && !Array.isArray(candidate.assetMetadata)
          ? candidate.assetMetadata
          : undefined,
      title: typeof candidate.title === "string" ? candidate.title : undefined
    };
  } catch {
    return null;
  }
}

function assetFromImagePayload(payload: ImageAssetDragPayload): AssetRecord {
  const now = new Date().toISOString();
  const assetKind =
    payload.assetKind === "reference" || payload.assetKind === "mask"
      ? payload.assetKind
      : "generated";
  const artifactId =
    typeof payload.assetMetadata?.artifactId === "string" ? payload.assetMetadata.artifactId : undefined;
  const artifactOnly = !payload.assetId && Boolean(artifactId);

  return {
    id: payload.assetId ?? `artifact-${artifactId ?? payload.nodeId}`,
    kind: assetKind,
    path: payload.assetPath,
    metadata: {
      ...(payload.assetMetadata ?? {}),
      ...(artifactOnly ? { artifactOnly: true } : {}),
      originalName: payload.title ?? getBasename(payload.assetPath)
    },
    createdAt: now,
    updatedAt: now
  };
}

type UseCanvasCommandsArgs = {
  graph: EtherGraph | null;
  projectId: string | null;
  wrapperRef: RefObject<HTMLDivElement | null>;
  flowRef: RefObject<ReactFlowInstance<Node<CanvasNodeData>, Edge> | null>;
  nodeCounterRef: RefObject<number>;
  dragBaselineRef: RefObject<CanvasSnapshot | null>;
  textEditBaselineRef: RefObject<CanvasSnapshot | null>;
  viewport: Viewport;
  nodes: Node<CanvasNodeData>[];
  edges: Edge[];
  serializeCurrentGraph(): EtherGraph;
  setHistory: Dispatch<SetStateAction<CanvasHistory>>;
  commitSnapshot(nextNodes: Node<CanvasNodeData>[], nextEdges: Edge[], traceMessage?: string): void;
  commitDurableSnapshot(nextNodes: Node<CanvasNodeData>[], nextEdges: Edge[], traceMessage?: string): void;
  setContextMenu: ContextMenuSetter;
  setLocalRunStatus(message: string | null): void;
  setConnectionHint(message: string | null): void;
  onStatus(message: string): void;
  onTrace(message: string): void;
  reportRelationshipLocked(): void;
  undo(): void;
  redo(): void;
};

export function useCanvasCommands({
  graph,
  projectId,
  wrapperRef,
  flowRef,
  nodeCounterRef,
  dragBaselineRef,
  textEditBaselineRef,
  viewport,
  nodes,
  edges,
  serializeCurrentGraph,
  setHistory,
  commitSnapshot,
  commitDurableSnapshot,
  setContextMenu,
  setLocalRunStatus,
  setConnectionHint,
  onStatus,
  onTrace,
  reportRelationshipLocked,
  undo,
  redo
}: UseCanvasCommandsArgs) {
  const createNode = useCallback(
    (definition: EtherNodeDefinition, position: { x: number; y: number }) => {
      nodeCounterRef.current += 1;
      const node: Node<CanvasNodeData> = {
        id: `node-${definition.id}-${Date.now()}-${nodeCounterRef.current}`,
        type: "etherNode",
        position,
        width: DEFAULT_NODE_WIDTH,
        height: DEFAULT_NODE_HEIGHT,
        selected: true,
        data: createGraphNodeData(definition.id)
      };
      const nextNodes = [...nodes.map((candidate) => ({ ...candidate, selected: false })), node];
      const nextEdges = edges.map((edge) => ({ ...edge, selected: false }));

      commitSnapshot(nextNodes, nextEdges, `Added ${definition.title}`);
      onStatus(`Added ${definition.title}`);
      setContextMenu(null);
    },
    [commitSnapshot, edges, nodeCounterRef, nodes, onStatus, setContextMenu]
  );

  const addNodeFromLibrary = useCallback(
    (definition: EtherNodeDefinition) => {
      const offset = nodes.length * 28;
      createNode(definition, { x: 320 + offset, y: 160 + offset });
    },
    [createNode, nodes.length]
  );

  const getCanvasCenterPosition = useCallback(() => {
    const bounds = wrapperRef.current?.getBoundingClientRect();

    if (!bounds || !flowRef.current) {
      return { x: 320 + nodes.length * 28, y: 160 + nodes.length * 28 };
    }

    return flowRef.current.screenToFlowPosition({
      x: bounds.left + bounds.width / 2,
      y: bounds.top + bounds.height / 2
    });
  }, [flowRef, nodes.length, wrapperRef]);

  const addCanvasTemplate = useCallback((templateId: CanvasTemplateId) => {
    nodeCounterRef.current += 1;
    const prefix = `${templateId}-${Date.now()}-${nodeCounterRef.current}`;
    const fragment = createCanvasTemplate(templateId, {
      idPrefix: prefix,
      origin: getCanvasCenterPosition()
    });
    const firstNodeId = fragment.nodes[0]?.id;
    const templateNodes = normalizeNodes(fragment.nodes).map((node) => ({
      ...node,
      type: "etherNode",
      selected: node.id === firstNodeId
    }));
    const nextNodes = [...nodes.map((candidate) => ({ ...candidate, selected: false })), ...templateNodes];
    const styledEdges = decorateAndNormalizeEdges(normalizeEdges(fragment.edges), nextNodes);
    const nextEdges = [...edges.map((edge) => ({ ...edge, selected: false })), ...styledEdges];
    const message = `Added ${fragment.title}`;

    commitSnapshot(nextNodes, nextEdges, message);
    onStatus(message);
    setContextMenu(null);
  }, [commitSnapshot, edges, getCanvasCenterPosition, nodeCounterRef, nodes, onStatus, setContextMenu]);

  const addReviewRouterTemplate = useCallback(() => {
    addCanvasTemplate("review-router");
  }, [addCanvasTemplate]);

  const createReferenceNodes = useCallback(
    (assets: AssetRecord[], position: { x: number; y: number }) => {
      if (assets.length === 0) {
        return;
      }

      const definition = getNodeDefinition("reference-image");
      const currentGraph = serializeCurrentGraph();
      const currentNodes = normalizeNodes(currentGraph.nodes);
      const currentEdges = normalizeEdges(currentGraph.edges);
      const referenceNodes: Node<CanvasNodeData>[] = assets.map((asset, index) => {
        nodeCounterRef.current += 1;

        return {
          id: `node-${definition.id}-${Date.now()}-${nodeCounterRef.current}`,
          type: "etherNode",
          position: {
            x: position.x + index * 32,
            y: position.y + index * 32
          },
          width: DEFAULT_NODE_WIDTH,
          height: DEFAULT_NODE_HEIGHT,
          selected: true,
          data: createReferenceNodeData(asset)
        };
      });
      const nextNodes = [...currentNodes.map((candidate) => ({ ...candidate, selected: false })), ...referenceNodes];
      const nextEdges = currentEdges.map((edge) => ({ ...edge, selected: false }));
      const message =
        assets.length === 1
          ? `Linked ${referenceNodes[0]?.data.title ?? "reference"}`
          : `Linked ${assets.length} references as separate nodes`;

      commitDurableSnapshot(nextNodes, nextEdges, message);
      onStatus(message);
      setContextMenu(null);
    },
    [commitDurableSnapshot, nodeCounterRef, onStatus, serializeCurrentGraph, setContextMenu]
  );

  const createEditNodeFromImage = useCallback(
    (payload: ImageAssetDragPayload, position: { x: number; y: number }) => {
      const sourceNode = nodes.find((node) => node.id === payload.nodeId);
      const definition = getNodeDefinition("edit-inpaint");

      if (!sourceNode) {
        const currentGraph = serializeCurrentGraph();
        const currentNodes = normalizeNodes(currentGraph.nodes);
        const currentEdges = normalizeEdges(currentGraph.edges);
        const referenceDefinition = getNodeDefinition("reference-image");
        const referenceAsset = assetFromImagePayload(payload);
        nodeCounterRef.current += 1;
        const referenceNodeId = `node-${referenceDefinition.id}-${Date.now()}-${nodeCounterRef.current}`;
        nodeCounterRef.current += 1;
        const editNodeId = `node-${definition.id}-${Date.now()}-${nodeCounterRef.current}`;
        const referenceNode: Node<CanvasNodeData> = {
          id: referenceNodeId,
          type: "etherNode",
          position: { x: position.x - 292, y: position.y },
          width: DEFAULT_NODE_WIDTH,
          height: DEFAULT_NODE_HEIGHT,
          selected: false,
          data: createReferenceNodeData(referenceAsset)
        };
        const editNode: Node<CanvasNodeData> = {
          id: editNodeId,
          type: "etherNode",
          position,
          width: DEFAULT_EDIT_NODE_WIDTH,
          height: DEFAULT_EDIT_NODE_HEIGHT,
          selected: true,
          data: {
            ...createGraphNodeData(definition.id),
            instruction: `Edit ${payload.title ?? referenceNode.data.title}`,
            ...(referenceAsset.metadata.artifactOnly === true ? {} : { sourceAssetId: referenceAsset.id }),
            sourceAssetKind: referenceAsset.kind,
            sourceAssetPath: referenceAsset.path,
            sourceAssetMetadata: referenceAsset.metadata
          }
        };
        const edge = normalizeEdges([
          {
            id: `edge-${referenceNodeId}-${editNodeId}-${Date.now()}`,
            source: referenceNodeId,
            target: editNodeId,
            sourceHandle: "image",
            targetHandle: "image",
            label: "image",
            data: edgeDataForChannels("image", "image", "image")
          }
        ])[0]!;
        const nextNodes = [
          ...currentNodes.map((node) => ({ ...node, selected: false })),
          referenceNode,
          editNode
        ];
        const nextEdges = [...currentEdges.map((candidate) => ({ ...candidate, selected: false })), edge];
        const message = "Created Inpaint edit from image";

        commitSnapshot(nextNodes, nextEdges, message);
        window.requestAnimationFrame(() => {
          flowRef.current?.setCenter(position.x + 130, position.y + 110, {
            zoom: viewport.zoom,
            duration: 0
          });
        });
        setLocalRunStatus(message);
        onStatus(message);
        setContextMenu(null);
        return;
      }

      if (sourceNode.data.locked) {
        reportRelationshipLocked();
        return;
      }

      const connection = canConnectNodeKinds(sourceNode.data.kind, definition.category, {
        sourceId: sourceNode.id
      });

      if (!connection.allowed) {
        onStatus(connection.reason ?? "Image source cannot connect to an Edit node.");
        return;
      }

      nodeCounterRef.current += 1;
      const editNodeId = `node-${definition.id}-${Date.now()}-${nodeCounterRef.current}`;
      const editNode: Node<CanvasNodeData> = {
        id: editNodeId,
        type: "etherNode",
        position,
        width: DEFAULT_EDIT_NODE_WIDTH,
        height: DEFAULT_EDIT_NODE_HEIGHT,
        selected: true,
        data: {
          ...createGraphNodeData(definition.id),
          instruction: `Edit ${payload.title ?? sourceNode.data.title}`,
          sourceAssetId: payload.assetId,
          sourceAssetKind: payload.assetKind,
          sourceAssetPath: payload.assetPath,
          sourceAssetMetadata: payload.assetMetadata
        }
      };
      const edge = normalizeEdges([
        {
          id: `edge-${sourceNode.id}-${editNodeId}-${Date.now()}`,
          source: sourceNode.id,
        target: editNodeId,
        sourceHandle: "image",
        targetHandle: "image",
        label: "image",
        data: edgeDataForChannels("image", "image", "image")
      }
    ])[0]!;
      const nextNodes = [...nodes.map((node) => ({ ...node, selected: false })), editNode];
      const nextEdges = [...edges.map((candidate) => ({ ...candidate, selected: false })), edge];
      const message = "Created Inpaint edit from image";

      commitSnapshot(nextNodes, nextEdges, message);
      window.requestAnimationFrame(() => {
        flowRef.current?.setCenter(position.x + 130, position.y + 110, {
          zoom: viewport.zoom,
          duration: 0
        });
      });
      setLocalRunStatus(message);
      onStatus(message);
      setContextMenu(null);
    },
    [
      commitSnapshot,
      edges,
      flowRef,
      nodeCounterRef,
      nodes,
      onStatus,
      reportRelationshipLocked,
      serializeCurrentGraph,
      setContextMenu,
      setLocalRunStatus,
      viewport.zoom
    ]
  );

  const linkReferenceImage = useCallback(async () => {
    if (!projectId) {
      const message = "Open a project to link references";
      setLocalRunStatus(message);
      onStatus(message);
      return;
    }

    try {
      const asset = await window.ether.asset.selectReferenceImage(projectId, { role: DEFAULT_REFERENCE_ROLE });

      if (!asset) {
        onStatus("Reference selection cancelled");
        return;
      }

      createReferenceNodes([asset], getCanvasCenterPosition());
    } catch (error) {
      onStatus(error instanceof Error ? error.message : "Reference link failed");
    }
  }, [createReferenceNodes, getCanvasCenterPosition, onStatus, projectId, setLocalRunStatus]);

  const uploadReferenceForNode = useCallback(
    async (nodeId: string, mode: ReferenceUploadMode = "replace") => {
      if (!projectId) {
        const message = "Open a project to link references";
        setLocalRunStatus(message);
        onStatus(message);
        return;
      }

      const target = nodes.find((node) => node.id === nodeId);

      if (!target || target.data.kind !== "Reference") {
        onStatus("Select a Reference node before uploading into it.");
        return;
      }

      if (target.data.locked) {
        reportRelationshipLocked();
        return;
      }

      try {
        const role = normalizeReferenceRole(target.data.assetMetadata?.role);
        const asset = await window.ether.asset.selectReferenceImage(projectId, { role });

        if (!asset) {
          onStatus("Reference selection cancelled");
          return;
        }

        const currentGraph = serializeCurrentGraph();
        const currentNodes = normalizeNodes(currentGraph.nodes);
        const currentEdges = normalizeEdges(currentGraph.edges);
        const latestTarget = currentNodes.find((node) => node.id === nodeId);

        if (!latestTarget || latestTarget.data.kind !== "Reference") {
          onStatus("Reference upload skipped; the target node changed.");
          return;
        }

        if (latestTarget.data.locked) {
          reportRelationshipLocked();
          return;
        }

        const updates = linkedReferenceAssetUpdates(asset, mode, latestTarget.data);
        const nextNodes = currentNodes.map((node) =>
          node.id === nodeId
            ? {
                ...node,
                data: {
                  ...node.data,
                  ...updates
                }
              }
            : node
        );
        const staleGraph = markDownstreamStale(
          {
            graphVersion: currentGraph.graphVersion,
            nodes: nextNodes,
            edges: currentEdges,
            viewport: currentGraph.viewport,
            selectedSnapshotId: currentGraph.selectedSnapshotId,
            updatedAt: new Date().toISOString()
          },
          [nodeId]
        );
        const message = `${mode === "add" ? "Added" : "Uploaded"} ${updates.title ?? "reference"} into Reference node`;

        commitDurableSnapshot(normalizeNodes(staleGraph.nodes), normalizeEdges(staleGraph.edges), message);
        onStatus(message);
      } catch (error) {
        onStatus(error instanceof Error ? error.message : "Reference upload failed");
      }
    },
    [
      commitDurableSnapshot,
      nodes,
      onStatus,
      projectId,
      reportRelationshipLocked,
      serializeCurrentGraph,
      setLocalRunStatus,
    ]
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) {
        return;
      }

      const source = nodes.find((node) => node.id === connection.source);
      const target = nodes.find((node) => node.id === connection.target);
      const sourceChannel = channelFromHandle(connection.sourceHandle);
      const targetChannel = channelFromHandle(connection.targetHandle);

      if (connectionTouchesLockedNode(source, target)) {
        reportRelationshipLocked();
        return;
      }

      const result = canConnectNodeKinds(source?.data.kind ?? "", target?.data.kind ?? "", {
        sourceId: connection.source,
        targetId: connection.target,
        sourceDefinitionId: source?.data.definitionId,
        targetDefinitionId: target?.data.definitionId,
        sourceChannel,
        targetChannel
      });

      if (!result.allowed) {
        const message = result.reason ?? "Connection rejected";
        setConnectionHint(message);
        setLocalRunStatus(message);
        onStatus(message);
        return;
      }

      const label = result.defaultLabel ?? "context";
      const resolvedSourceChannel = result.sourceChannel ?? sourceChannel;
      const resolvedTargetChannel = result.targetChannel ?? targetChannel;
      const role = normalizeConnectionRole(result.defaultRole);

      if (!resolvedSourceChannel || !resolvedTargetChannel) {
        const message = "Choose source and target channel handles before connecting.";
        setConnectionHint(message);
        setLocalRunStatus(message);
        onStatus(message);
        return;
      }

      if (hasExactEdgeLane(edges, connection.source, connection.target, resolvedSourceChannel, resolvedTargetChannel, role)) {
        const message = "This exact channel and role connection already exists.";
        setConnectionHint(message);
        setLocalRunStatus(message);
        onStatus(message);
        return;
      }

      const edge: Edge = {
        ...connection,
        id: `edge-${connection.source}-${connection.target}-${Date.now()}`,
        sourceHandle: resolvedSourceChannel,
        targetHandle: resolvedTargetChannel,
        label,
        data: edgeDataForChannels(
          label,
          resolvedSourceChannel,
          resolvedTargetChannel,
          role,
          { adapter: result.adapter, disabledReason: result.disabledReason }
        ),
        type: "etherEdge",
        labelBgPadding: [8, 4],
        labelBgBorderRadius: 4,
        labelBgStyle: { fill: "rgba(7, 11, 18, 0.92)", stroke: "rgba(55, 230, 234, 0.34)" },
        style: { stroke: "#37E6EA", strokeWidth: 2 }
      };

      commitSnapshot(nodes, addEdge(edge, edges), `Connected ${source?.data.title} to ${target?.data.title}`);
      setConnectionHint(null);
      onStatus(`Connected with ${label} edge`);
    },
    [commitSnapshot, edges, nodes, onStatus, reportRelationshipLocked, setConnectionHint, setLocalRunStatus]
  );

  const connectFirstValidPair = useCallback(() => {
    let skippedLockedEndpoint = false;
    let firstRejectedReason: string | null = null;

    for (const source of nodes) {
      for (const target of nodes) {
        if (source.id === target.id) {
          continue;
        }

        if (connectionTouchesLockedNode(source, target)) {
          skippedLockedEndpoint = true;
          continue;
        }

        const handles = defaultHandlesForConnection(source, target);
        const sourceChannel = channelFromHandle(handles.sourceHandle);
        const targetChannel = channelFromHandle(handles.targetHandle);
        const result = canConnectNodeKinds(source.data.kind, target.data.kind, {
          sourceId: source.id,
          targetId: target.id,
          sourceDefinitionId: source.data.definitionId,
          targetDefinitionId: target.data.definitionId,
          sourceChannel,
          targetChannel
        });

        if (!result.allowed) {
          firstRejectedReason ??= result.reason ?? null;
          continue;
        }

        const label = result.defaultLabel ?? "context";
        const resolvedSourceChannel = result.sourceChannel ?? sourceChannel;
        const resolvedTargetChannel = result.targetChannel ?? targetChannel;
        const role = normalizeConnectionRole(result.defaultRole);

        if (!resolvedSourceChannel || !resolvedTargetChannel) {
          firstRejectedReason ??= "Choose source and target channel handles before connecting.";
          continue;
        }

        if (hasExactEdgeLane(edges, source.id, target.id, resolvedSourceChannel, resolvedTargetChannel, role)) {
          firstRejectedReason ??= "This exact channel and role connection already exists.";
          continue;
        }

        const edge: Edge = {
          id: `edge-${source.id}-${target.id}-${Date.now()}`,
          source: source.id,
          target: target.id,
          sourceHandle: resolvedSourceChannel,
          targetHandle: resolvedTargetChannel,
          label,
          selected: true,
          data: edgeDataForChannels(
            label,
            resolvedSourceChannel,
            resolvedTargetChannel,
            role,
            { adapter: result.adapter, disabledReason: result.disabledReason }
          ),
          type: "etherEdge",
          labelBgPadding: [8, 4],
          labelBgBorderRadius: 4,
          labelBgStyle: { fill: "rgba(7, 11, 18, 0.92)", stroke: "rgba(55, 230, 234, 0.34)" },
          style: { stroke: "#37E6EA", strokeWidth: 2 }
        };
        const nextNodes = nodes.map((node) => ({ ...node, selected: false }));
        const nextEdges = [...edges.map((candidate) => ({ ...candidate, selected: false })), edge];

        commitSnapshot(nextNodes, nextEdges, `Connected ${source.data.title} to ${target.data.title}`);
        setConnectionHint(null);
        onStatus(`Connected with ${label} edge`);
        return;
      }
    }

    if (skippedLockedEndpoint) {
      reportRelationshipLocked();
      return;
    }

    const message = firstRejectedReason ?? "Add a valid source and target node before connecting.";
    setConnectionHint(message);
    setLocalRunStatus(message);
    onStatus(message);
  }, [commitSnapshot, edges, nodes, onStatus, reportRelationshipLocked, setConnectionHint, setLocalRunStatus]);

  const previewNode = useCallback(
    (id: string, updates: Partial<CanvasNodeData>) => {
      setHistory((current) => {
        const target = (current.present.nodes as Node<CanvasNodeData>[]).find((node) => node.id === id);
        const updateKeys = Object.keys(updates);
        const updatesOnlyLock = updateKeys.length === 1 && updateKeys[0] === "locked";
        const updatesManualOutput = updateKeys.some((key) =>
          ["assembledPrompt", "assembledNegativePrompt", "textOutput"].includes(key)
        );

        if (target?.data.locked && !updatesOnlyLock) {
          return current;
        }

        textEditBaselineRef.current ??= current.present;
        const editedNodes = (current.present.nodes as Node<CanvasNodeData>[]).map((node) =>
          node.id === id ? { ...node, data: { ...node.data, ...updates } } : node
        );

        if (updatesOnlyLock) {
          return updateCanvasHistoryPresent(current, {
            nodes: editedNodes,
            edges: current.present.edges
          });
        }

        const staleGraph = markDownstreamStale(
          {
            graphVersion: graph?.graphVersion ?? LATEST_GRAPH_VERSION,
            nodes: editedNodes,
            edges: current.present.edges,
            viewport,
            selectedSnapshotId: graph?.selectedSnapshotId ?? null,
            updatedAt: new Date().toISOString()
          },
          [id],
          undefined,
          { includeChanged: !updatesManualOutput }
        );

        return updateCanvasHistoryPresent(current, {
          nodes: normalizeNodes(staleGraph.nodes),
          edges: current.present.edges
        });
      });
    },
    [graph?.graphVersion, graph?.selectedSnapshotId, setHistory, textEditBaselineRef, viewport]
  );

  const previewEdge = useCallback(
    (id: string, label: string) => {
      if (edgeTouchesLockedNode(edges.find((edge) => edge.id === id), nodes)) {
        reportRelationshipLocked();
        return;
      }

      setHistory((current) => {
        textEditBaselineRef.current ??= current.present;
        const nextEdges = current.present.edges.map((edge) => {
          if (edge.id !== id) {
            return edge;
          }

          const role = normalizeConnectionRole(label);

          return {
            ...edge,
            label,
            data: { ...edge.data, label, role, graphVersion: EDGE_GRAPH_VERSION }
          };
        });
        const changedEdge = current.present.edges.find((edge) => edge.id === id);
        const staleGraph = changedEdge
          ? markDownstreamStale(
              {
                graphVersion: graph?.graphVersion ?? LATEST_GRAPH_VERSION,
                nodes: current.present.nodes,
                edges: nextEdges,
                viewport,
                selectedSnapshotId: graph?.selectedSnapshotId ?? null,
                updatedAt: new Date().toISOString()
              },
              [changedEdge.source],
              undefined,
              { includeChanged: false }
            )
          : null;

        return updateCanvasHistoryPresent(current, {
          nodes: staleGraph ? normalizeNodes(staleGraph.nodes) : current.present.nodes,
          edges: nextEdges
        });
      });
    },
    [edges, graph?.graphVersion, graph?.selectedSnapshotId, nodes, reportRelationshipLocked, setHistory, textEditBaselineRef, viewport]
  );

  const commitTextEdit = useCallback(() => {
    const baseline = textEditBaselineRef.current;

    if (!baseline) {
      return;
    }

    textEditBaselineRef.current = null;
    setHistory((current) => pushCanvasHistoryFromBaseline(current, baseline, current.present));
    onTrace("Updated inspector text");
  }, [onTrace, setHistory, textEditBaselineRef]);

  const toggleNodeLock = useCallback(
    (id: string, locked: boolean) => {
      const target = nodes.find((node) => node.id === id);

      if (!target) {
        return;
      }

      const nextNodes = nodes.map((node) =>
        node.id === id ? { ...node, data: { ...node.data, locked } } : node
      );
      const message = locked ? "Node locked" : "Node unlocked";

      commitSnapshot(nextNodes, edges, message);
      setLocalRunStatus(message);
      onStatus(message);
    },
    [commitSnapshot, edges, nodes, onStatus, setLocalRunStatus]
  );

  const updateNodeDataDurable = useCallback(
    (id: string, updates: Partial<CanvasNodeData>, traceMessage = "Updated node data") => {
      const currentGraph = serializeCurrentGraph();
      const currentNodes = normalizeNodes(currentGraph.nodes);
      const currentEdges = normalizeEdges(currentGraph.edges);
      const target = currentNodes.find((node) => node.id === id);

      if (!target) {
        return false;
      }

      if (target.data.locked) {
        const message = "Unlock the node before changing it.";
        setLocalRunStatus(message);
        onStatus(message);
        return false;
      }

      const nextNodes = currentNodes.map((node) =>
        node.id === id
          ? {
              ...node,
              data: {
                ...node.data,
                ...updates
              }
            }
          : node
      );
      const staleGraph = markDownstreamStale(
        {
          graphVersion: currentGraph.graphVersion,
          nodes: nextNodes,
          edges: currentEdges,
          viewport: currentGraph.viewport,
          selectedSnapshotId: currentGraph.selectedSnapshotId,
          updatedAt: new Date().toISOString()
        },
        [id]
      );

      commitDurableSnapshot(normalizeNodes(staleGraph.nodes), normalizeEdges(staleGraph.edges), traceMessage);
      return true;
    },
    [commitDurableSnapshot, onStatus, serializeCurrentGraph, setLocalRunStatus]
  );

  const deleteElements = useCallback(
    (selection?: { nodeIds?: string[]; edgeIds?: string[] }) => {
      const requestedNodeIds =
        selection ? selection.nodeIds ?? [] : nodes.filter((node) => node.selected).map((node) => node.id);
      const hasLockedNode = nodes.some(
        (node) => requestedNodeIds.includes(node.id) && node.data.locked
      );
      const requestedEdgeIds =
        selection ? selection.edgeIds ?? [] : edges.filter((edge) => edge.selected).map((edge) => edge.id);
      const hasLockedRelationship = requestedEdgeIds.some((edgeId) =>
        edgeTouchesLockedNode(edges.find((edge) => edge.id === edgeId), nodes)
      ) || nodeDeletionWouldRemoveLockedRelationship(requestedNodeIds, nodes, edges);

      if (hasLockedNode) {
        const message = "Unlock the node before changing it.";
        setLocalRunStatus(message);
        onStatus(message);
        return;
      }

      if (hasLockedRelationship) {
        reportRelationshipLocked();
        return;
      }

      const next = deleteCanvasElements(
        { nodes, edges },
        { nodeIds: requestedNodeIds, edgeIds: requestedEdgeIds }
      );

      if (!next) {
        return;
      }

      setHistory((current) => pushCanvasHistoryIfChanged(current, next));
      onTrace("Deleted selection");
      onStatus("Selection deleted");
    },
    [edges, nodes, onStatus, onTrace, reportRelationshipLocked, setHistory, setLocalRunStatus]
  );

  const deleteSelection = useCallback(() => {
    deleteElements();
  }, [deleteElements]);

  const deleteNodeById = useCallback(
    (id: string) => {
      deleteElements({ nodeIds: [id] });
    },
    [deleteElements]
  );

  const deleteEdgeById = useCallback(
    (id: string) => {
      deleteElements({ edgeIds: [id] });
    },
    [deleteElements]
  );

  const setEdgeRole = useCallback(
    (id: string, role: ConnectionRole) => {
      const targetEdge = edges.find((edge) => edge.id === id);

      if (!targetEdge) {
        return;
      }

      if (edgeTouchesLockedNode(targetEdge, nodes)) {
        reportRelationshipLocked();
        return;
      }

      const nextRole = normalizeConnectionRole(role);
      const nextEdges = edges.map((edge) =>
        edge.id === id
          ? {
              ...edge,
              selected: true,
              data: {
                ...edge.data,
                role: nextRole,
                graphVersion: EDGE_GRAPH_VERSION
              }
            }
          : { ...edge, selected: false }
      );
      const nextNodes = nodes.map((node) => ({ ...node, selected: false }));

      commitSnapshot(nextNodes, nextEdges, "Updated connection role");
      onTrace("Updated connection role");
      onStatus("Connection role updated");
    },
    [commitSnapshot, edges, nodes, onStatus, onTrace, reportRelationshipLocked]
  );

  const setEdgeChannel = useCallback(
    (id: string, endpoint: EdgeChannelEndpoint, channel: PayloadChannel) => {
      const targetEdge = edges.find((edge) => edge.id === id);

      if (!targetEdge) {
        return;
      }

      if (edgeTouchesLockedNode(targetEdge, nodes)) {
        reportRelationshipLocked();
        return;
      }

      const sourceNode = nodes.find((node) => node.id === targetEdge.source);
      const targetNode = nodes.find((node) => node.id === targetEdge.target);

      if (!sourceNode || !targetNode) {
        const message = "Connection endpoints are missing.";
        setConnectionHint(message);
        setLocalRunStatus(message);
        onStatus(message);
        return;
      }

      const currentSourceChannel = edgeChannel(targetEdge, "source");
      const currentTargetChannel = edgeChannel(targetEdge, "target");
      const nextSourceChannel = endpoint === "source" ? channel : currentSourceChannel;
      const nextTargetChannel = endpoint === "target" ? channel : currentTargetChannel;

      if (nextSourceChannel === currentSourceChannel && nextTargetChannel === currentTargetChannel) {
        return;
      }

      const result = canConnectNodeKinds(sourceNode.data.kind, targetNode.data.kind, {
        sourceId: sourceNode.id,
        targetId: targetNode.id,
        sourceDefinitionId: sourceNode.data.definitionId,
        targetDefinitionId: targetNode.data.definitionId,
        sourceChannel: nextSourceChannel,
        targetChannel: nextTargetChannel
      });

      if (!result.allowed) {
        const message = result.reason ?? "Connection rejected";
        setConnectionHint(message);
        setLocalRunStatus(message);
        onStatus(message);
        return;
      }

      const resolvedSourceChannel = result.sourceChannel ?? nextSourceChannel;
      const resolvedTargetChannel = result.targetChannel ?? nextTargetChannel;

      if (!resolvedSourceChannel || !resolvedTargetChannel) {
        const message = "Choose source and target channel handles before updating this connection.";
        setConnectionHint(message);
        setLocalRunStatus(message);
        onStatus(message);
        return;
      }

      const data = edgeDataRecord(targetEdge);
      const currentRole = normalizeConnectionRole(data.role ?? targetEdge.label ?? data.label);

      if (
        hasExactEdgeLane(
          edges,
          targetEdge.source,
          targetEdge.target,
          resolvedSourceChannel,
          resolvedTargetChannel,
          currentRole,
          id
        )
      ) {
        const message = "This exact channel and role connection already exists.";
        setConnectionHint(message);
        setLocalRunStatus(message);
        onStatus(message);
        return;
      }

      const {
        adapter: _adapter,
        disabledReason: _disabledReason,
        graphVersion: _graphVersion,
        sourceChannel: _sourceChannel,
        targetChannel: _targetChannel,
        role: _role,
        label: _label,
        ...restData
      } = data;
      const label = String(targetEdge.label ?? data.label ?? result.defaultLabel ?? "context");
      const nextData = {
        ...restData,
        label,
        graphVersion: EDGE_GRAPH_VERSION,
        sourceChannel: resolvedSourceChannel,
        targetChannel: resolvedTargetChannel,
        role: currentRole,
        ...(result.adapter ? { adapter: result.adapter } : {}),
        ...(result.disabledReason ? { disabledReason: result.disabledReason } : {})
      };
      const nextEdges = edges.map((edge) =>
        edge.id === id
          ? {
              ...edge,
              selected: true,
              sourceHandle: resolvedSourceChannel,
              targetHandle: resolvedTargetChannel,
              label,
              data: nextData
            }
          : { ...edge, selected: false }
      );
      const nextNodes = nodes.map((node) => ({ ...node, selected: false }));

      commitSnapshot(nextNodes, nextEdges, "Updated connection channel");
      setConnectionHint(null);
      onTrace("Updated connection channel");
      onStatus("Connection channel updated");
    },
    [
      commitSnapshot,
      edges,
      nodes,
      onStatus,
      onTrace,
      reportRelationshipLocked,
      setConnectionHint,
      setLocalRunStatus
    ]
  );

  const previewGraphPatchForCanvas = useCallback(
    (patch: GraphPatch): GraphPatchPreview => previewGraphPatch(serializeCurrentGraph(), patch),
    [serializeCurrentGraph]
  );

  const applyGraphPatchToCanvas = useCallback(
    (patch: GraphPatch) => {
      const currentGraph = serializeCurrentGraph();
      const nextGraph = applyGraphPatch(currentGraph, patch);
      const nextNodes = normalizeNodes(nextGraph.nodes);
      const nextEdges = decorateAndNormalizeEdges(normalizeEdges(nextGraph.edges), nextNodes);
      const message = "Patch applied; run controls are still explicit";

      commitSnapshot(nextNodes, nextEdges, message);
      setLocalRunStatus(message);
      onStatus(message);
    },
    [commitSnapshot, onStatus, serializeCurrentGraph, setLocalRunStatus]
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const target = event.target as HTMLElement | null;

      if (target?.matches("input, textarea")) {
        return;
      }

      if ((event.ctrlKey || event.metaKey) && key === "z") {
        event.preventDefault();
        undo();
      }

      if ((event.ctrlKey || event.metaKey) && (key === "y" || (event.shiftKey && key === "z"))) {
        event.preventDefault();
        redo();
      }

      if (key === "delete" || key === "backspace") {
        event.preventDefault();
        deleteSelection();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [deleteSelection, redo, undo]);

  const onDrop = useCallback(
    async (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      const imagePayload = parseImageAssetDragPayload(
        event.dataTransfer.getData("application/ether-image-asset")
      );

      if (event.shiftKey && imagePayload && flowRef.current) {
        createEditNodeFromImage(
          imagePayload,
          flowRef.current.screenToFlowPosition({ x: event.clientX, y: event.clientY })
        );
        return;
      }

      if (imagePayload && flowRef.current) {
        createReferenceNodes(
          [assetFromImagePayload(imagePayload)],
          flowRef.current.screenToFlowPosition({ x: event.clientX, y: event.clientY })
        );
        return;
      }

      const definitionId = event.dataTransfer.getData("application/ether-node-definition");
      const definition = definitionId ? getNodeDefinition(definitionId) : null;

      if (!definition || !flowRef.current) {
        const droppedFiles = Array.from(event.dataTransfer.files);
        const imageFiles = droppedFiles.filter(isSupportedImageFile);

        if (droppedFiles.length === 0) {
          return;
        }

        if (imageFiles.length === 0) {
          onStatus("Drop image files to create Reference nodes.");
          return;
        }

        if (!projectId) {
          const message = "Open a project to link references";
          setLocalRunStatus(message);
          onStatus(message);
          return;
        }

        const filePaths = imageFiles
          .map((file) => window.ether.file.getDroppedFilePath(file))
          .filter((filePath): filePath is string => Boolean(filePath));

        if (filePaths.length !== imageFiles.length) {
          onStatus("Dropped images need Electron file paths before they can be linked.");
          return;
        }

        try {
          const assets = await linkDroppedReferenceFilesSequentially(
            projectId,
            filePaths,
            window.ether.asset.linkDroppedReference,
            { role: DEFAULT_REFERENCE_ROLE }
          );
          const position = flowRef.current?.screenToFlowPosition({ x: event.clientX, y: event.clientY }) ?? {
            x: 320,
            y: 160
          };

          createReferenceNodes(assets, position);

          if (imageFiles.length > 1 && !event.ctrlKey && !event.metaKey) {
            onTrace("Multiple dropped images linked as separate Reference nodes");
          }
        } catch (error) {
          onStatus(error instanceof Error ? error.message : "Dropped reference link failed");
        }

        return;
      }

      createNode(
        definition,
        flowRef.current.screenToFlowPosition({ x: event.clientX, y: event.clientY })
      );
    },
    [
      createEditNodeFromImage,
      createNode,
      createReferenceNodes,
      flowRef,
      onStatus,
      onTrace,
      projectId,
      setLocalRunStatus
    ]
  );

  const onNodeDragStop: OnNodeDrag<Node<CanvasNodeData>> = useCallback(
    (_event, draggedNode) => {
      const baseline = dragBaselineRef.current;
      const originalDraggedNode = nodes.find((node) => node.id === draggedNode.id);

      if (originalDraggedNode?.data.locked) {
        dragBaselineRef.current = null;

        if (baseline) {
          setHistory((current) =>
            updateCanvasHistoryPresent(current, {
              nodes: baseline.nodes,
              edges: baseline.edges
            })
          );
        }

        reportRelationshipLocked();
        return;
      }

      const latestNodes = nodes.map((node) => (node.id === draggedNode.id ? draggedNode : node));
      const commitDragOnly = () => {
        dragBaselineRef.current = null;

        if (baseline) {
          setHistory((current) =>
            pushCanvasHistoryFromBaseline(current, baseline, {
              nodes: latestNodes,
              edges: current.present.edges
            })
          );
        }
      };
      const targetEdge = findEdgeInsertionTarget({
        draggedNodeId: draggedNode.id,
        nodes: latestNodes,
        edges
      });

      if (!targetEdge) {
        commitDragOnly();
        return;
      }

      const sourceNode = latestNodes.find((node) => node.id === targetEdge.source);
      const dragged = latestNodes.find((node) => node.id === draggedNode.id);
      const targetNode = latestNodes.find((node) => node.id === targetEdge.target);

      if (!sourceNode || !dragged || !targetNode) {
        commitDragOnly();
        return;
      }

      if (dragged.data.locked || edgeTouchesLockedNode(targetEdge, latestNodes)) {
        commitDragOnly();
        reportRelationshipLocked();
        return;
      }

      const firstHandles = defaultHandlesForConnection(sourceNode, dragged);
      const secondHandles = defaultHandlesForConnection(dragged, targetNode);
      const firstRule = canConnectNodeKinds(sourceNode.data.kind, dragged.data.kind, {
        sourceId: sourceNode.id,
        targetId: dragged.id,
        sourceDefinitionId: sourceNode.data.definitionId,
        targetDefinitionId: dragged.data.definitionId,
        sourcePortId: firstHandles.sourceHandle,
        targetPortId: firstHandles.targetHandle
      });
      const secondRule = canConnectNodeKinds(dragged.data.kind, targetNode.data.kind, {
        sourceId: dragged.id,
        targetId: targetNode.id,
        sourceDefinitionId: dragged.data.definitionId,
        targetDefinitionId: targetNode.data.definitionId,
        sourcePortId: secondHandles.sourceHandle,
        targetPortId: secondHandles.targetHandle
      });

      if (!firstRule.allowed || !secondRule.allowed) {
        commitDragOnly();
        onStatus("Dropped node is near an edge, but that insertion would create an invalid route.");
        return;
      }

      const originalLabel = String(targetEdge.label ?? targetEdge.data?.label ?? "route");
      const insertedEdges = [
        decorateEdgeForNodes(
          {
            id: `edge-${sourceNode.id}-${dragged.id}-${Date.now()}`,
            source: sourceNode.id,
            target: dragged.id,
            sourceHandle: firstHandles.sourceHandle,
            targetHandle: firstHandles.targetHandle,
            label: originalLabel,
            data: { label: originalLabel },
            type: "etherEdge"
          },
          latestNodes
        ) as Edge | null,
        decorateEdgeForNodes(
          {
            id: `edge-${dragged.id}-${targetNode.id}-${Date.now()}`,
            source: dragged.id,
            target: targetNode.id,
            sourceHandle: secondHandles.sourceHandle,
            targetHandle: secondHandles.targetHandle,
            label: secondRule.defaultLabel ?? "route",
            data: secondRule.defaultRole
              ? { label: secondRule.defaultLabel ?? "route", role: secondRule.defaultRole }
              : { label: secondRule.defaultLabel ?? "route" },
            type: "etherEdge"
          },
          latestNodes
        ) as Edge | null
      ].filter((edge): edge is Edge => edge !== null);

      if (insertedEdges.length !== 2) {
        commitDragOnly();
        onStatus("Dropped node is near an edge, but that insertion would create an invalid route.");
        return;
      }

      const nextEdges = [
        ...edges.filter((edge) => edge.id !== targetEdge.id),
        ...decorateAndNormalizeEdges(insertedEdges, latestNodes)
      ];

      dragBaselineRef.current = null;
      setHistory((current) =>
        baseline
          ? pushCanvasHistoryFromBaseline(current, baseline, { nodes: latestNodes, edges: nextEdges })
          : pushCanvasHistory(current, { nodes: latestNodes, edges: nextEdges })
      );
      onTrace("Inserted node onto edge");
      onStatus("Node inserted between connected nodes");
    },
    [dragBaselineRef, edges, nodes, onStatus, onTrace, reportRelationshipLocked, setHistory]
  );

  const onNodeDragStart = useCallback(() => {
    dragBaselineRef.current = { nodes, edges };
  }, [dragBaselineRef, edges, nodes]);

  const actionDefinitions = useMemo(
    () => [
      getNodeDefinition("prompt-general"),
      getNodeDefinition("reference-image"),
      getNodeDefinition("generation-image"),
      getNodeDefinition("note-cloud")
    ],
    []
  );

  return {
    actionDefinitions,
    createNode,
    addNodeFromLibrary,
    addCanvasTemplate,
    addReviewRouterTemplate,
    createReferenceNodes,
    createEditNodeFromImage,
    linkReferenceImage,
    uploadReferenceForNode,
    onConnect,
    connectFirstValidPair,
    previewNode,
    previewEdge,
    commitTextEdit,
    toggleNodeLock,
    updateNodeDataDurable,
    deleteElements,
    deleteSelection,
    deleteNodeById,
    deleteEdgeById,
    setEdgeRole,
    setEdgeChannel,
    previewGraphPatchForCanvas,
    applyGraphPatchToCanvas,
    onDrop,
    onNodeDragStart,
    onNodeDragStop
  };
}
