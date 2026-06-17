import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState
} from "react";
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type OnSelectionChangeParams,
  type ReactFlowInstance,
  type Viewport
} from "@xyflow/react";
import { Eye, EyeOff, ImagePlus, Link2, Redo2, Undo2 } from "lucide-react";
import {
  type CanvasNodeData,
  type EtherNodeDefinition
} from "@ether/engine/graph/nodeCatalog";
import { canConnectNodeKinds } from "@ether/engine/graph/connectionRules";
import { findEdgeInsertionTarget } from "@ether/engine/graph/canvasGeometry";
import {
  coerceCanvasNodeData,
  createGraphNodeData,
  getNodeDefinition
} from "@ether/engine/graph/nodeCatalog";
import { freezePromptNode } from "@ether/engine/graph/promptAssembly";
import { markDownstreamStale } from "@ether/engine/run/rerunState";
import type { AssetRecord, EtherGraph, ExecutionPolicy } from "@ether/engine";
import { EtherNode, EtherNodeDeleteContext } from "./EtherNode";
import { linkDroppedReferenceFilesSequentially } from "./assetDrop";
import { InspectorPanel } from "./InspectorPanel";
import { NodeLibrary } from "./NodeLibrary";
import {
  type CanvasSnapshot,
  createCanvasHistory,
  deleteCanvasElements,
  pushCanvasHistory,
  pushCanvasHistoryFromBaseline,
  pushCanvasHistoryIfChanged,
  redoCanvasHistory,
  replaceCanvasHistoryWithDurableCommit,
  shouldPushNodeChangesToHistory,
  updateCanvasHistoryPresent,
  undoCanvasHistory
} from "./canvasHistory";

type EtherCanvasProps = {
  graph: EtherGraph | null;
  projectId: string | null;
  onStatus(message: string): void;
  onTrace(message: string): void;
};

export type EtherCanvasHandle = {
  serialize(): EtherGraph;
};

type ContextMenuState = {
  x: number;
  y: number;
  position: { x: number; y: number };
} | null;

const nodeTypes = { etherNode: EtherNode };

const defaultViewport: Viewport = { x: 0, y: 0, zoom: 1 };
const imageFileExtensionPattern = /\.(avif|bmp|gif|jpe?g|png|tiff?|webp)$/i;
const relationshipLockMessage = "Unlock connected nodes before changing relationships";

function normalizeNodes(nodes: EtherGraph["nodes"]): Node<CanvasNodeData>[] {
  return nodes.map((node) => {
    const candidate = node as Node<CanvasNodeData>;
    return {
      ...candidate,
      type: "etherNode",
      data: coerceCanvasNodeData(candidate.data)
    };
  });
}

function normalizeEdges(edges: EtherGraph["edges"]): Edge[] {
  return edges.map((edge) => {
    const candidate = edge as Edge;
    const label = String(candidate.label ?? candidate.data?.label ?? "context");

    return {
      ...candidate,
      label,
      data: { ...candidate.data, label },
      type: "default",
      labelBgPadding: [8, 4],
      labelBgBorderRadius: 4,
      labelBgStyle: { fill: "rgba(7, 11, 18, 0.92)", stroke: "rgba(55, 230, 234, 0.34)" },
      style: { stroke: "#37E6EA", strokeWidth: 2 }
    };
  });
}

function getBasename(filePath: string) {
  return filePath.split(/[\\/]/).filter(Boolean).at(-1) ?? filePath;
}

function isSupportedImageFile(file: File) {
  return file.type.startsWith("image/") || imageFileExtensionPattern.test(file.name);
}

function edgeTouchesLockedNode(edge: Edge | null | undefined, nodes: Node<CanvasNodeData>[]) {
  if (!edge) {
    return false;
  }

  return nodes.some((node) => (node.id === edge.source || node.id === edge.target) && node.data.locked);
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
  const originalName =
    typeof asset.metadata.originalName === "string" && asset.metadata.originalName.trim()
      ? asset.metadata.originalName
      : getBasename(asset.path);
  const role =
    typeof asset.metadata.role === "string" && asset.metadata.role.trim()
      ? asset.metadata.role
      : "reference";

  return {
    ...baseData,
    title: originalName,
    label: "Linked reference",
    instruction: `Linked ${role} image reference`,
    notes: asset.path,
    status: "complete",
    assetId: asset.id,
    assetKind: asset.kind,
    assetPath: asset.path,
    assetMetadata: asset.metadata
  };
}

function InnerEtherCanvas(
  { graph, projectId, onStatus, onTrace }: EtherCanvasProps,
  ref: React.ForwardedRef<EtherCanvasHandle>
) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const flowRef = useRef<ReactFlowInstance<Node<CanvasNodeData>, Edge> | null>(null);
  const nodeCounterRef = useRef(0);
  const resizeBaselineRef = useRef<CanvasSnapshot | null>(null);
  const dragBaselineRef = useRef<CanvasSnapshot | null>(null);
  const textEditBaselineRef = useRef<CanvasSnapshot | null>(null);
  const [viewport, setViewport] = useState<Viewport>(graph?.viewport ?? defaultViewport);
  const [history, setHistory] = useState(() =>
    createCanvasHistory({
      nodes: normalizeNodes(graph?.nodes ?? []),
      edges: normalizeEdges(graph?.edges ?? [])
    })
  );
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
  const [showMiniMap, setShowMiniMap] = useState(true);
  const [localRunStatus, setLocalRunStatus] = useState<string | null>(null);
  const [pendingGeneratedAssetId, setPendingGeneratedAssetId] = useState<string | null>(null);
  const [executionPolicy, setExecutionPolicy] = useState<ExecutionPolicy>("cached-inputs");
  const [runCountCap, setRunCountCap] = useState(1);
  const [parallelExecution, setParallelExecution] = useState(false);

  const nodes = history.present.nodes as Node<CanvasNodeData>[];
  const edges = history.present.edges;
  const selectedNode = nodes.find((node) => node.selected) ?? null;
  const selectedNodeIds = nodes.filter((node) => node.selected).map((node) => node.id);
  const selectedEdge = edges.find((edge) => edge.selected) ?? null;
  const assemblyGraph = useMemo<EtherGraph>(
    () => ({
      nodes,
      edges,
      viewport,
      selectedSnapshotId: graph?.selectedSnapshotId ?? null,
      updatedAt: graph?.updatedAt ?? new Date().toISOString()
    }),
    [edges, graph?.selectedSnapshotId, graph?.updatedAt, nodes, viewport]
  );

  useEffect(() => {
    if (!graph) {
      return;
    }

    resizeBaselineRef.current = null;
    dragBaselineRef.current = null;
    textEditBaselineRef.current = null;
    setPendingGeneratedAssetId(null);
    setViewport(graph.viewport);
    flowRef.current?.setViewport(graph.viewport);
    setHistory(
      createCanvasHistory({
        nodes: normalizeNodes(graph.nodes),
        edges: normalizeEdges(graph.edges)
      })
    );
  }, [graph]);

  useEffect(() => {
    if (projectId) {
      setLocalRunStatus(null);
    }
  }, [projectId]);

  useImperativeHandle(
    ref,
    () => ({
      serialize() {
        const currentViewport = flowRef.current?.getViewport() ?? viewport;

        return {
          nodes,
          edges,
          viewport: currentViewport,
          selectedSnapshotId: graph?.selectedSnapshotId ?? null,
          updatedAt: new Date().toISOString()
        };
      }
    }),
    [edges, graph?.selectedSnapshotId, nodes, viewport]
  );

  const commitSnapshot = useCallback(
    (nextNodes: Node<CanvasNodeData>[], nextEdges: Edge[], traceMessage?: string) => {
      setHistory((current) => pushCanvasHistory(current, { nodes: nextNodes, edges: nextEdges }));
      if (traceMessage) {
        onTrace(traceMessage);
      }
    },
    [onTrace]
  );

  const commitDurableSnapshot = useCallback(
    (nextNodes: Node<CanvasNodeData>[], nextEdges: Edge[], traceMessage?: string) => {
      resizeBaselineRef.current = null;
      dragBaselineRef.current = null;
      textEditBaselineRef.current = null;
      setHistory((current) =>
        replaceCanvasHistoryWithDurableCommit(current, { nodes: nextNodes, edges: nextEdges })
      );
      if (traceMessage) {
        setLocalRunStatus(traceMessage);
        onTrace(traceMessage);
      }
    },
    [onTrace]
  );

  const reportRelationshipLocked = useCallback(() => {
    setLocalRunStatus(relationshipLockMessage);
    onStatus(relationshipLockMessage);
  }, [onStatus]);

  const replaceSelection = useCallback((selection: OnSelectionChangeParams<Node<CanvasNodeData>, Edge>) => {
    setHistory((current) => ({
      ...current,
      present: {
        nodes: current.present.nodes.map((node) => ({
          ...node,
          selected: selection.nodes.some((selected) => selected.id === node.id)
        })),
        edges: current.present.edges.map((edge) => ({
          ...edge,
          selected: selection.edges.some((selected) => selected.id === edge.id)
        }))
      }
    }));
  }, []);

  const onNodesChange = useCallback((changes: NodeChange<Node<CanvasNodeData>>[]) => {
    setHistory((current) => {
      const lockedNodeIds = new Set(
        (current.present.nodes as Node<CanvasNodeData>[])
          .filter((node) => node.data.locked)
          .map((node) => node.id)
      );
      const editableChanges = changes.filter(
        (change) => change.type === "select" || !("id" in change) || !lockedNodeIds.has(change.id)
      );

      if (editableChanges.length === 0) {
        return current;
      }

      const nextNodes = applyNodeChanges(editableChanges, current.present.nodes);
      const hasActiveResize = editableChanges.some(
        (change) => change.type === "dimensions" && change.resizing === true
      );
      const hasCompletedResize = editableChanges.some(
        (change) => change.type === "dimensions" && change.resizing === false
      );
      const hasDragPosition = editableChanges.some(
        (change) => change.type === "position" && typeof change.dragging === "boolean"
      );
      const editsGraph = shouldPushNodeChangesToHistory(editableChanges);
      const next = { nodes: nextNodes, edges: current.present.edges };

      if (hasDragPosition) {
        dragBaselineRef.current ??= current.present;
        return updateCanvasHistoryPresent(current, next);
      }

      if (hasActiveResize) {
        resizeBaselineRef.current ??= current.present;
        return updateCanvasHistoryPresent(current, next);
      }

      if (hasCompletedResize && resizeBaselineRef.current) {
        const baseline = resizeBaselineRef.current;
        resizeBaselineRef.current = null;
        return pushCanvasHistoryFromBaseline(current, baseline, next);
      }

      return editsGraph ? pushCanvasHistory(current, next) : updateCanvasHistoryPresent(current, next);
    });
  }, []);

  const onEdgesChange = useCallback(
    (changes: EdgeChange<Edge>[]) => {
      const blockedRelationshipChange = changes.some((change) => {
        if (change.type === "select" || !("id" in change)) {
          return false;
        }

        return edgeTouchesLockedNode(edges.find((edge) => edge.id === change.id), nodes);
      });

      if (blockedRelationshipChange) {
        reportRelationshipLocked();
        return;
      }

      setHistory((current) => {
        const nextEdges = applyEdgeChanges(changes, current.present.edges);
        const editsGraph = changes.some((change) => change.type !== "select");
        const next = { nodes: current.present.nodes, edges: nextEdges };

        return editsGraph ? pushCanvasHistory(current, next) : { ...current, present: next };
      });
    },
    [edges, nodes, reportRelationshipLocked]
  );

  const createNode = useCallback(
    (definition: EtherNodeDefinition, position: { x: number; y: number }) => {
      nodeCounterRef.current += 1;
      const node: Node<CanvasNodeData> = {
        id: `node-${definition.id}-${Date.now()}-${nodeCounterRef.current}`,
        type: "etherNode",
        position,
        width: 224,
        height: 138,
        selected: true,
        data: createGraphNodeData(definition.id)
      };
      const nextNodes = nodes.map((candidate) => ({ ...candidate, selected: false })).concat(node);
      const nextEdges = edges.map((edge) => ({ ...edge, selected: false }));

      commitSnapshot(nextNodes, nextEdges, `Added ${definition.title}`);
      onStatus(`Added ${definition.title}`);
      setContextMenu(null);
    },
    [commitSnapshot, edges, nodes, onStatus]
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
  }, [nodes.length]);

  const createReferenceNodes = useCallback(
    (assets: AssetRecord[], position: { x: number; y: number }) => {
      if (assets.length === 0) {
        return;
      }

      const definition = getNodeDefinition("reference-image");
      const referenceNodes: Node<CanvasNodeData>[] = assets.map((asset, index) => {
        nodeCounterRef.current += 1;

        return {
          id: `node-${definition.id}-${Date.now()}-${nodeCounterRef.current}`,
          type: "etherNode",
          position: {
            x: position.x + index * 32,
            y: position.y + index * 32
          },
          width: 224,
          height: 138,
          selected: true,
          data: createReferenceNodeData(asset)
        };
      });
      const nextNodes = nodes.map((candidate) => ({ ...candidate, selected: false })).concat(referenceNodes);
      const nextEdges = edges.map((edge) => ({ ...edge, selected: false }));
      const message =
        assets.length === 1
          ? `Linked ${referenceNodes[0]?.data.title ?? "reference"}`
          : `Linked ${assets.length} references as separate nodes`;

      commitDurableSnapshot(nextNodes, nextEdges, message);
      onStatus(message);
      setContextMenu(null);
    },
    [commitDurableSnapshot, edges, nodes, onStatus]
  );

  const linkReferenceImage = useCallback(async () => {
    if (!projectId) {
      const message = "Open a project to link references";
      setLocalRunStatus(message);
      onStatus(message);
      return;
    }

    try {
      const asset = await window.ether.asset.selectReferenceImage(projectId);

      if (!asset) {
        onStatus("Reference selection cancelled");
        return;
      }

      createReferenceNodes([asset], getCanvasCenterPosition());
    } catch (error) {
      onStatus(error instanceof Error ? error.message : "Reference link failed");
    }
  }, [createReferenceNodes, getCanvasCenterPosition, onStatus, projectId]);

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) {
        return;
      }

      const source = nodes.find((node) => node.id === connection.source);
      const target = nodes.find((node) => node.id === connection.target);
      const duplicate = edges.some(
        (edge) => edge.source === connection.source && edge.target === connection.target
      );

      if (connectionTouchesLockedNode(source, target)) {
        reportRelationshipLocked();
        return;
      }

      const result = canConnectNodeKinds(source?.data.kind ?? "", target?.data.kind ?? "", {
        sourceId: connection.source,
        targetId: connection.target,
        duplicate
      });

      if (!result.allowed) {
        onStatus(result.reason ?? "Connection rejected");
        return;
      }

      const label = result.defaultLabel ?? "context";
      const edge: Edge = {
        ...connection,
        id: `edge-${connection.source}-${connection.target}-${Date.now()}`,
        label,
        data: { label },
        type: "default",
        labelBgPadding: [8, 4],
        labelBgBorderRadius: 4,
        labelBgStyle: { fill: "rgba(7, 11, 18, 0.92)", stroke: "rgba(55, 230, 234, 0.34)" },
        style: { stroke: "#37E6EA", strokeWidth: 2 }
      };

      commitSnapshot(nodes, addEdge(edge, edges), `Connected ${source?.data.title} to ${target?.data.title}`);
      onStatus(`Connected with ${label} edge`);
    },
    [commitSnapshot, edges, nodes, onStatus, reportRelationshipLocked]
  );

  const connectFirstValidPair = useCallback(() => {
    let skippedLockedEndpoint = false;

    for (const source of nodes) {
      for (const target of nodes) {
        if (source.id === target.id) {
          continue;
        }

        if (connectionTouchesLockedNode(source, target)) {
          skippedLockedEndpoint = true;
          continue;
        }

        const duplicate = edges.some((edge) => edge.source === source.id && edge.target === target.id);
        const result = canConnectNodeKinds(source.data.kind, target.data.kind, {
          sourceId: source.id,
          targetId: target.id,
          duplicate
        });

        if (!result.allowed) {
          continue;
        }

        const label = result.defaultLabel ?? "context";
        const edge: Edge = {
          id: `edge-${source.id}-${target.id}-${Date.now()}`,
          source: source.id,
          target: target.id,
          label,
          selected: true,
          data: { label },
          type: "default",
          labelBgPadding: [8, 4],
          labelBgBorderRadius: 4,
          labelBgStyle: { fill: "rgba(7, 11, 18, 0.92)", stroke: "rgba(55, 230, 234, 0.34)" },
          style: { stroke: "#37E6EA", strokeWidth: 2 }
        };
        const nextNodes = nodes.map((node) => ({ ...node, selected: false }));
        const nextEdges = edges.map((candidate) => ({ ...candidate, selected: false })).concat(edge);

        commitSnapshot(nextNodes, nextEdges, `Connected ${source.data.title} to ${target.data.title}`);
        onStatus(`Connected with ${label} edge`);
        return;
      }
    }

    if (skippedLockedEndpoint) {
      reportRelationshipLocked();
      return;
    }

    onStatus("Add a valid source and target node before connecting.");
  }, [commitSnapshot, edges, nodes, onStatus, reportRelationshipLocked]);

  const previewNode = useCallback(
    (id: string, updates: Partial<CanvasNodeData>) => {
      setHistory((current) => {
        const target = (current.present.nodes as Node<CanvasNodeData>[]).find((node) => node.id === id);
        const updateKeys = Object.keys(updates);
        const updatesOnlyLock = updateKeys.length === 1 && updateKeys[0] === "locked";

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
            nodes: editedNodes,
            edges: current.present.edges,
            viewport,
            selectedSnapshotId: graph?.selectedSnapshotId ?? null,
            updatedAt: new Date().toISOString()
          },
          [id]
        );

        return updateCanvasHistoryPresent(current, {
          nodes: normalizeNodes(staleGraph.nodes),
          edges: current.present.edges
        });
      });
    },
    [graph?.selectedSnapshotId, viewport]
  );

  const previewEdge = useCallback(
    (id: string, label: string) => {
      if (edgeTouchesLockedNode(edges.find((edge) => edge.id === id), nodes)) {
        reportRelationshipLocked();
        return;
      }

      setHistory((current) => {
        textEditBaselineRef.current ??= current.present;
        const nextEdges = current.present.edges.map((edge) =>
          edge.id === id ? { ...edge, label, data: { ...edge.data, label } } : edge
        );
        const changedEdge = current.present.edges.find((edge) => edge.id === id);
        const staleGraph = changedEdge
          ? markDownstreamStale(
              {
                nodes: current.present.nodes,
                edges: nextEdges,
                viewport,
                selectedSnapshotId: graph?.selectedSnapshotId ?? null,
                updatedAt: new Date().toISOString()
              },
              [changedEdge.source]
            )
          : null;

        return updateCanvasHistoryPresent(current, {
          nodes: staleGraph ? normalizeNodes(staleGraph.nodes) : current.present.nodes,
          edges: nextEdges
        });
      });
    },
    [edges, graph?.selectedSnapshotId, nodes, reportRelationshipLocked, viewport]
  );

  const commitTextEdit = useCallback(() => {
    const baseline = textEditBaselineRef.current;

    if (!baseline) {
      return;
    }

    textEditBaselineRef.current = null;
    setHistory((current) => pushCanvasHistoryFromBaseline(current, baseline, current.present));
    onTrace("Updated inspector text");
  }, [onTrace]);

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
    [commitSnapshot, edges, nodes, onStatus]
  );

  const deleteElements = useCallback(
    (selection?: { nodeIds?: string[]; edgeIds?: string[] }) => {
      const requestedNodeIds =
        selection?.nodeIds ?? nodes.filter((node) => node.selected).map((node) => node.id);
      const hasLockedNode = nodes.some(
        (node) => requestedNodeIds.includes(node.id) && node.data.locked
      );
      const requestedEdgeIds =
        selection?.edgeIds ?? edges.filter((edge) => edge.selected).map((edge) => edge.id);
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

      const next = deleteCanvasElements({ nodes, edges }, selection);

      if (!next) {
        return;
      }

      setHistory((current) => pushCanvasHistoryIfChanged(current, next));
      onTrace("Deleted selection");
      onStatus("Selection deleted");
    },
    [edges, nodes, onStatus, onTrace, reportRelationshipLocked]
  );

  const deleteSelection = useCallback(() => {
    deleteElements();
  }, [deleteElements]);

  const runNode = useCallback(
    (id: string) => {
      const target = nodes.find((node) => node.id === id);

      if (!target || target.data.kind !== "Prompt") {
        onStatus("Only prompt nodes can be assembled locally in this phase.");
        return;
      }

      if (target.data.locked) {
        const message = "Node is locked";
        setLocalRunStatus(message);
        onStatus(message);
        return;
      }

      const nextGraph = freezePromptNode(assemblyGraph, id);
      const nextNodes = normalizeNodes(nextGraph.nodes).map((node) => ({
        ...node,
        data: node.id === id ? { ...node.data, rerunState: "complete" as const } : node.data,
        selected: node.id === id
      }));
      const nextEdges = normalizeEdges(nextGraph.edges);
      const message = `Assembled ${target.data.title}`;

      commitSnapshot(nextNodes, nextEdges, message);
      setLocalRunStatus(message);
      onStatus(message);
    },
    [assemblyGraph, commitSnapshot, nodes, onStatus]
  );

  const ensureStoreFolderForNode = useCallback(
    async (id: string) => {
      const target = nodes.find((node) => node.id === id);

      if (!target || target.data.kind !== "Store") {
        onStatus("Select a Collection or Directory node first.");
        return;
      }

      if (target.data.subtype !== "Collection" && target.data.subtype !== "Directory") {
        onStatus("Only Collection and Directory nodes mirror folders in this phase.");
        return;
      }

      if (target.data.locked) {
        const message = "Node is locked";
        setLocalRunStatus(message);
        onStatus(message);
        return;
      }

      if (!projectId) {
        const message = "Open a project to mirror folders";
        setLocalRunStatus(message);
        onStatus(message);
        return;
      }

      try {
        const name = target.data.label.trim() || target.data.title;
        const asset =
          target.data.subtype === "Collection"
            ? await window.ether.asset.ensureCollection(projectId, { name, nodeId: target.id })
            : await window.ether.asset.ensureDirectory(projectId, { name, nodeId: target.id });
        const nextNodes = nodes.map((node) =>
          node.id === target.id
            ? {
                ...node,
                data: {
                  ...node.data,
                  status: "complete" as const,
                  rerunState: "complete" as const,
                  storeAssetId: asset.id,
                  storePath: asset.path,
                  storeMetadata: asset.metadata
                }
              }
            : { ...node, selected: false }
        );
        const message = `${target.data.subtype} folder ready`;

        commitDurableSnapshot(nextNodes, edges, message);
        onStatus(message);
      } catch (error) {
        onStatus(error instanceof Error ? error.message : "Folder mirror failed");
      }
    },
    [commitDurableSnapshot, edges, nodes, onStatus, projectId]
  );

  const saveFakeGeneratedAssetForNode = useCallback(
    async (id: string) => {
      const target = nodes.find((node) => node.id === id);

      if (!target || target.data.kind !== "Generation") {
        onStatus("Select a Generation node first.");
        return;
      }

      if (target.data.locked) {
        const message = "Node is locked";
        setLocalRunStatus(message);
        onStatus(message);
        return;
      }

      if (!projectId) {
        const message = "Open a project to save fake generated output";
        setLocalRunStatus(message);
        onStatus(message);
        return;
      }

      try {
        const asset = await window.ether.asset.saveFakeGenerated(projectId, {
          generationNodeId: target.id,
          fileName: `fake-output-${target.id}-${Date.now()}.png`,
          content: `fake generated output for ${target.data.title}\n`,
          mimeType: "image/png"
        });
        const nextNodes = nodes.map((node) =>
          node.id === target.id
            ? {
                ...node,
                data: {
                  ...node.data,
                  status: "complete" as const,
                  rerunState: "complete" as const,
                  assetId: asset.id,
                  assetKind: asset.kind,
                  assetPath: asset.path,
                  assetMetadata: asset.metadata
                }
              }
            : { ...node, selected: false }
        );
        const message = "Saved fake generated output";

        setPendingGeneratedAssetId(asset.id);
        commitDurableSnapshot(nextNodes, edges, message);
        onStatus(message);
      } catch (error) {
        onStatus(error instanceof Error ? error.message : "Fake generated output save failed");
      }
    },
    [commitDurableSnapshot, edges, nodes, onStatus, projectId]
  );

  const moveLatestGeneratedAssetToCollection = useCallback(
    async (collectionNodeId: string) => {
      const collectionNode = nodes.find((node) => node.id === collectionNodeId);

      if (
        !collectionNode ||
        collectionNode.data.kind !== "Store" ||
        collectionNode.data.subtype !== "Collection"
      ) {
        onStatus("Select a Collection node first.");
        return;
      }

      if (collectionNode.data.locked) {
        const message = "Node is locked";
        setLocalRunStatus(message);
        onStatus(message);
        return;
      }

      if (!projectId) {
        const message = "Open a project to move generated assets";
        setLocalRunStatus(message);
        onStatus(message);
        return;
      }

      if (!pendingGeneratedAssetId) {
        const message = "No pending generated output to move.";
        setLocalRunStatus(message);
        onStatus(message);
        return;
      }

      const sourceNode = nodes.find(
        (node) =>
          node.data.kind === "Generation" &&
          node.data.assetKind === "generated" &&
          node.data.assetId === pendingGeneratedAssetId
      );

      if (!sourceNode?.data.assetId) {
        const message = "No pending generated output to move.";
        setPendingGeneratedAssetId(null);
        setLocalRunStatus(message);
        onStatus(message);
        return;
      }

      if (sourceNode.data.locked) {
        const message = "Unlock the generated output before moving it.";
        setLocalRunStatus(message);
        onStatus(message);
        return;
      }

      try {
        const collectionName = collectionNode.data.label.trim() || collectionNode.data.title;
        const collectionAsset =
          collectionNode.data.storeAssetId && collectionNode.data.storePath
            ? {
                id: collectionNode.data.storeAssetId,
                path: collectionNode.data.storePath,
                metadata: collectionNode.data.storeMetadata ?? {}
              }
            : await window.ether.asset.ensureCollection(projectId, {
                name: collectionName,
                nodeId: collectionNode.id
              });
        const movedAsset = await window.ether.asset.moveToCollection(projectId, {
          assetId: sourceNode.data.assetId,
          collectionId: collectionAsset.id,
          reason: "manual-inspector-validation"
        });
        const nextNodes = nodes.map((node) => {
          if (node.id === sourceNode.id) {
            return {
              ...node,
              selected: false,
              data: {
                ...node.data,
                assetPath: movedAsset.path,
                assetMetadata: movedAsset.metadata
              }
            };
          }

          if (node.id === collectionNode.id) {
            return {
              ...node,
              selected: true,
              data: {
                ...node.data,
                status: "complete" as const,
                rerunState: "complete" as const,
                storeAssetId: collectionAsset.id,
                storePath: collectionAsset.path,
                storeMetadata: collectionAsset.metadata,
                lastMovedAssetId: movedAsset.id,
                lastMovedAssetPath: movedAsset.path,
                lastMovedAt: movedAsset.updatedAt
              }
            };
          }

          return { ...node, selected: false };
        });
        const message = "Moved pending generated output to Collection";

        setPendingGeneratedAssetId(null);
        commitDurableSnapshot(nextNodes, edges, message);
        onStatus(message);
      } catch (error) {
        onStatus(error instanceof Error ? error.message : "Generated asset move failed");
      }
    },
    [commitDurableSnapshot, edges, nodes, onStatus, pendingGeneratedAssetId, projectId]
  );

  const executeRun = useCallback(
    async (policy: ExecutionPolicy) => {
      const targetNodeIds =
        policy === "selected" ? selectedNodeIds : selectedNode ? [selectedNode.id] : selectedNodeIds;

      if (targetNodeIds.length === 0) {
        onStatus("Select a node before running.");
        return;
      }

      if (!projectId) {
        const message = "Open a project to run the execution engine";
        setLocalRunStatus(message);
        onStatus(message);
        return;
      }

      const cappedRunCount = Math.max(0, Math.min(100, Math.floor(runCountCap)));
      const queueMessage = `Queued ${policy} run for ${targetNodeIds.length} node${
        targetNodeIds.length === 1 ? "" : "s"
      }`;

      setLocalRunStatus(queueMessage);
      onTrace(queueMessage);

      try {
        const result = await window.ether.execution.run(projectId, assemblyGraph, {
          policy,
          targetNodeIds,
          runCountCap: cappedRunCount,
          parallel: parallelExecution
        });
        const completed = result.results.filter((entry) => entry.status === "complete").length;
        const skipped = result.results.filter((entry) => entry.status === "skipped").length;
        const failed = result.results.filter((entry) => entry.status === "error").length;
        const lastGeneratedAsset = [...result.results]
          .reverse()
          .find((entry) => entry.action === "fake-generate");
        const summary = failed > 0
          ? `Run finished with ${failed} error${failed === 1 ? "" : "s"}`
          : `Run complete: ${completed} complete, ${skipped} skipped`;

        if (lastGeneratedAsset?.assetId) {
          setPendingGeneratedAssetId(lastGeneratedAsset.assetId);
        }

        commitDurableSnapshot(normalizeNodes(result.graph.nodes), normalizeEdges(result.graph.edges), summary);
        for (const entry of result.results) {
          onTrace(`${entry.status} ${entry.nodeId} (${entry.action})`);
        }
        onStatus(summary);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Execution run failed";
        setLocalRunStatus(message);
        onStatus(message);
      }
    },
    [
      assemblyGraph,
      commitDurableSnapshot,
      parallelExecution,
      projectId,
      runCountCap,
      selectedNode,
      selectedNodeIds,
      onStatus,
      onTrace
    ]
  );

  const deleteNodeById = useCallback(
    (id: string) => {
      deleteElements({ nodeIds: [id] });
    },
    [deleteElements]
  );

  const undo = useCallback(() => {
    setHistory((current) => undoCanvasHistory(current));
    onTrace("Undo");
  }, [onTrace]);

  const redo = useCallback(() => {
    setHistory((current) => redoCanvasHistory(current));
    onTrace("Redo");
  }, [onTrace]);

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
    async (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
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
            window.ether.asset.linkDroppedReference
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
    [createNode, createReferenceNodes, onStatus, onTrace, projectId]
  );

  const onNodeDragStop = useCallback(
    (_event: React.MouseEvent, draggedNode: Node<CanvasNodeData>) => {
      const latestNodes = nodes.map((node) => (node.id === draggedNode.id ? draggedNode : node));
      const commitDragOnly = () => {
        const baseline = dragBaselineRef.current;
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

      const firstRule = canConnectNodeKinds(sourceNode.data.kind, dragged.data.kind, {
        sourceId: sourceNode.id,
        targetId: dragged.id
      });
      const secondRule = canConnectNodeKinds(dragged.data.kind, targetNode.data.kind, {
        sourceId: dragged.id,
        targetId: targetNode.id
      });

      if (!firstRule.allowed || !secondRule.allowed) {
        commitDragOnly();
        onStatus("Dropped node is near an edge, but that insertion would create an invalid route.");
        return;
      }

      const originalLabel = String(targetEdge.label ?? targetEdge.data?.label ?? "route");
      const nextEdges = edges
        .filter((edge) => edge.id !== targetEdge.id)
        .concat(
          normalizeEdges([
            {
              id: `edge-${sourceNode.id}-${dragged.id}-${Date.now()}`,
              source: sourceNode.id,
              target: dragged.id,
              label: originalLabel,
              data: { label: originalLabel }
            },
            {
              id: `edge-${dragged.id}-${targetNode.id}-${Date.now()}`,
              source: dragged.id,
              target: targetNode.id,
              label: secondRule.defaultLabel ?? "route",
              data: { label: secondRule.defaultLabel ?? "route" }
            }
          ])
        );

      const baseline = dragBaselineRef.current;
      dragBaselineRef.current = null;
      setHistory((current) =>
        baseline
          ? pushCanvasHistoryFromBaseline(current, baseline, { nodes: latestNodes, edges: nextEdges })
          : pushCanvasHistory(current, { nodes: latestNodes, edges: nextEdges })
      );
      onTrace("Inserted node onto edge");
      onStatus("Node inserted between connected nodes");
    },
    [edges, nodes, onStatus, onTrace, reportRelationshipLocked]
  );

  const onNodeDragStart = useCallback(() => {
    dragBaselineRef.current = { nodes, edges };
  }, [edges, nodes]);

  const actionDefinitions = useMemo(
    () => [
      getNodeDefinition("prompt-general"),
      getNodeDefinition("reference-image"),
      getNodeDefinition("generation-image"),
      getNodeDefinition("note-cloud")
    ],
    []
  );

  return (
    <div className="flow-shell" ref={wrapperRef}>
      <div className="canvas-toolbar" aria-label="Canvas history controls">
        <button
          type="button"
          aria-label="Undo"
          data-testid="canvas-undo"
          onClick={undo}
          disabled={history.past.length === 0}
        >
          <Undo2 size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label="Redo"
          data-testid="canvas-redo"
          onClick={redo}
          disabled={history.future.length === 0}
        >
          <Redo2 size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label={showMiniMap ? "Hide minimap" : "Show minimap"}
          onClick={() => setShowMiniMap((current) => !current)}
        >
          {showMiniMap ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
        </button>
        <button
          type="button"
          aria-label="Link reference image"
          data-testid="canvas-link-reference"
          onClick={linkReferenceImage}
          disabled={!projectId}
          title={projectId ? "Link reference image" : "Open a project to link references"}
        >
          <ImagePlus size={16} aria-hidden="true" />
        </button>
        <button type="button" aria-label="Connect first valid pair" onClick={connectFirstValidPair}>
          <Link2 size={16} aria-hidden="true" />
        </button>
      </div>
      <aside className="canvas-overlay-panel canvas-node-library" aria-label="Node Library" data-testid="panel-node-library">
        <div className="overlay-panel-title">
          <p>Input</p>
          <h2>Node Library</h2>
        </div>
        <NodeLibrary onAddNode={addNodeFromLibrary} />
      </aside>
      <aside className="canvas-overlay-panel canvas-inspector" aria-label="Inspector" data-testid="panel-inspector">
        <div className="overlay-panel-title">
          <p>State</p>
          <h2>Inspector</h2>
        </div>
        <InspectorPanel
          selectedNode={selectedNode}
          selectedEdge={selectedEdge}
          graph={assemblyGraph}
          onPreviewNode={previewNode}
          onPreviewEdge={previewEdge}
          onCommitTextEdit={commitTextEdit}
          onRunNode={runNode}
          onToggleNodeLock={toggleNodeLock}
          onExecuteRun={executeRun}
          onEnsureStoreFolder={ensureStoreFolderForNode}
          onSaveFakeGeneratedAsset={saveFakeGeneratedAssetForNode}
          onMoveLatestGeneratedAssetToCollection={moveLatestGeneratedAssetToCollection}
          onDeleteSelection={deleteSelection}
          executionPolicy={executionPolicy}
          runCountCap={runCountCap}
          parallelExecution={parallelExecution}
          selectedNodeCount={selectedNodeIds.length}
          onExecutionPolicyChange={setExecutionPolicy}
          onRunCountCapChange={(cap) =>
            setRunCountCap(Number.isFinite(cap) ? Math.max(0, Math.min(100, Math.floor(cap))) : 0)
          }
          onParallelExecutionChange={setParallelExecution}
          hasOpenProject={Boolean(projectId)}
        />
      </aside>
      <EtherNodeDeleteContext.Provider value={deleteNodeById}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onInit={(instance) => {
          flowRef.current = instance;
          instance.setViewport(viewport);
        }}
        onMoveEnd={(_event, nextViewport) => setViewport(nextViewport)}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onSelectionChange={replaceSelection}
        onNodeDragStart={onNodeDragStart}
        onNodeDragStop={onNodeDragStop}
        onDrop={onDrop}
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        }}
        onPaneContextMenu={(event) => {
          event.preventDefault();
          const position = flowRef.current?.screenToFlowPosition({ x: event.clientX, y: event.clientY }) ?? {
            x: 0,
            y: 0
          };
          setContextMenu({ x: event.clientX, y: event.clientY, position });
        }}
        onPaneClick={() => setContextMenu(null)}
        deleteKeyCode={null}
      >
        <Background color="rgba(153, 168, 186, 0.16)" gap={36} />
        <Controls position="bottom-right" />
        {showMiniMap ? (
          <MiniMap
            data-testid="canvas-minimap"
            pannable
            zoomable
            nodeColor={(node) => (node.data as CanvasNodeData).kind === "Generation" ? "#37E6EA" : "#1470DB"}
          />
        ) : null}
      </ReactFlow>
      </EtherNodeDeleteContext.Provider>
      {contextMenu ? (
        <div
          className="canvas-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          role="menu"
          aria-label="Canvas actions"
        >
          {actionDefinitions.map((definition) => (
            <button
              key={definition.id}
              type="button"
              role="menuitem"
              onClick={() => createNode(definition, contextMenu.position)}
            >
              Add {definition.category}
            </button>
          ))}
        </div>
      ) : null}
      <div className="canvas-status" aria-live="polite" data-testid="canvas-status">
        {localRunStatus ??
          (selectedNode
            ? `Selected ${selectedNode.data.title}`
            : selectedEdge
              ? `Selected ${selectedEdge.label}`
              : projectId
                ? "Canvas ready"
                : "Open a project to link references")}
      </div>
    </div>
  );
}

export const EtherCanvas = forwardRef(InnerEtherCanvas);

export function EtherCanvasWithProvider(
  props: EtherCanvasProps & { canvasRef: React.Ref<EtherCanvasHandle> }
) {
  const { canvasRef, ...canvasProps } = props;

  return (
    <ReactFlowProvider>
      <EtherCanvas ref={canvasRef} {...canvasProps} />
    </ReactFlowProvider>
  );
}

export type { CanvasNodeData };
