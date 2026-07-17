import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import {
  applyEdgeChanges,
  applyNodeChanges,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type ReactFlowInstance,
  type Viewport
} from "@xyflow/react";
import * as engine from "@ether/engine";
import type { EtherGraph } from "@ether/engine";
import {
  coerceCanvasNodeData,
  type CanvasNodeData
} from "@ether/engine/graph/nodeCatalog";
import {
  type CanvasSnapshot,
  createCanvasHistory,
  pushCanvasHistory,
  pushCanvasHistoryFromBaseline,
  replaceCanvasHistoryWithDurableCommit,
  shouldPushNodeChangesToHistory,
  updateCanvasHistoryPresent,
  undoCanvasHistory,
  redoCanvasHistory
} from "../canvasHistory";

export const defaultViewport: Viewport = { x: 0, y: 0, zoom: 1 };

export function normalizeNodes(nodes: EtherGraph["nodes"]): Node<CanvasNodeData>[] {
  return nodes.map((node) => {
    const candidate = node as Node<CanvasNodeData>;
    return {
      ...candidate,
      type: "etherNode",
      data: coerceCanvasNodeData(candidate.data)
    };
  });
}

export function normalizeEdges(edges: EtherGraph["edges"]): Edge[] {
  return edges.map((edge) => {
    const candidate = edge as Edge;
    const label = String(candidate.label ?? candidate.data?.label ?? "context");

    return {
      ...candidate,
      label,
      data: { ...candidate.data, label },
      type: "etherEdge",
      labelBgPadding: [8, 4],
      labelBgBorderRadius: 4,
      labelBgStyle: { fill: "rgba(7, 11, 18, 0.92)", stroke: "rgba(55, 230, 234, 0.34)" },
      style: { stroke: "#37E6EA", strokeWidth: 2 }
    };
  });
}

export function edgeIsLocked(edge: Edge | null | undefined) {
  if (!edge) {
    return false;
  }

  const data = edge.data && typeof edge.data === "object" ? edge.data as { locked?: unknown } : {};

  return (edge as Edge & { locked?: unknown }).locked === true || data.locked === true;
}

export function edgeTouchesLockedNode(edge: Edge | null | undefined, nodes: Node<CanvasNodeData>[]) {
  if (!edge) {
    return false;
  }

  if (edgeIsLocked(edge)) {
    return true;
  }

  return nodes.some((node) => (node.id === edge.source || node.id === edge.target) && node.data.locked);
}

type GraphContent = Pick<EtherGraph, "nodes" | "edges">;

export type CanvasGraphPersistenceResult = {
  graph: EtherGraph;
  appliedToCanvas: boolean;
};

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

function stripVolatileGraphFields<T extends Record<string, unknown>>(entry: T) {
  const {
    dragging: _dragging,
    measured: _measured,
    resizing: _resizing,
    selected: _selected,
    ...content
  } = entry;

  return content;
}

export function graphContentFingerprint(graph: GraphContent): string {
  return stableStringify({
    nodes: graph.nodes.map((node) => stripVolatileGraphFields(node as Record<string, unknown>)),
    edges: graph.edges.map((edge) => stripVolatileGraphFields(edge as Record<string, unknown>))
  });
}

type UseCanvasGraphArgs = {
  graph: EtherGraph | null;
  projectId: string | null;
  onTrace(message: string): void;
  onDurableStatus(message: string): void;
  onRelationshipLocked(): void;
};

export function useCanvasGraph({
  graph,
  projectId,
  onTrace,
  onDurableStatus,
  onRelationshipLocked
}: UseCanvasGraphArgs) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const flowRef = useRef<ReactFlowInstance<Node<CanvasNodeData>, Edge> | null>(null);
  const nodeCounterRef = useRef(0);
  const resizeBaselineRef = useRef<CanvasSnapshot | null>(null);
  const dragBaselineRef = useRef<CanvasSnapshot | null>(null);
  const textEditBaselineRef = useRef<CanvasSnapshot | null>(null);
  const currentGraphRef = useRef<EtherGraph>({
    graphVersion: graph?.graphVersion ?? engine.LATEST_GRAPH_VERSION,
    nodes: normalizeNodes(graph?.nodes ?? []),
    edges: normalizeEdges(graph?.edges ?? []),
    viewport: graph?.viewport ?? defaultViewport,
    selectedSnapshotId: graph?.selectedSnapshotId ?? null,
    updatedAt: graph?.updatedAt ?? new Date().toISOString()
  });
  const [viewport, setViewport] = useState<Viewport>(graph?.viewport ?? defaultViewport);
  const [history, setHistory] = useState(() =>
    createCanvasHistory({
      nodes: normalizeNodes(graph?.nodes ?? []),
      edges: normalizeEdges(graph?.edges ?? [])
    })
  );

  const nodes = history.present.nodes as Node<CanvasNodeData>[];
  const edges = history.present.edges;
  const isDirty = history.past.length > 0;
  const assemblyGraph = useMemo<EtherGraph>(
    () => ({
      graphVersion: graph?.graphVersion ?? engine.LATEST_GRAPH_VERSION,
      nodes,
      edges,
      viewport,
      selectedSnapshotId: graph?.selectedSnapshotId ?? null,
      updatedAt: graph?.updatedAt ?? new Date().toISOString()
    }),
    [edges, graph?.graphVersion, graph?.selectedSnapshotId, graph?.updatedAt, nodes, viewport]
  );
  currentGraphRef.current = assemblyGraph;

  const replaceWithProjectGraph = useCallback((nextGraph: EtherGraph) => {
    resizeBaselineRef.current = null;
    dragBaselineRef.current = null;
    textEditBaselineRef.current = null;
    const nextViewport = nextGraph.viewport ?? defaultViewport;

    setViewport(nextViewport);
    flowRef.current?.setViewport(nextViewport);
    setHistory(
      createCanvasHistory({
        nodes: normalizeNodes(nextGraph.nodes),
        edges: normalizeEdges(nextGraph.edges)
      })
    );
  }, []);

  const serializeCurrentGraph = useCallback((): EtherGraph => {
    const currentGraph = currentGraphRef.current;
    const currentViewport = flowRef.current?.getViewport() ?? currentGraph.viewport;

    return {
      graphVersion: currentGraph.graphVersion,
      nodes: currentGraph.nodes,
      edges: currentGraph.edges,
      viewport: currentViewport,
      selectedSnapshotId: currentGraph.selectedSnapshotId,
      updatedAt: new Date().toISOString()
    };
  }, []);

  const isCurrentGraphContent = useCallback((graphOrFingerprint: GraphContent | string) => {
    const fingerprint =
      typeof graphOrFingerprint === "string"
        ? graphOrFingerprint
        : graphContentFingerprint(graphOrFingerprint);

    return graphContentFingerprint(serializeCurrentGraph()) === fingerprint;
  }, [serializeCurrentGraph]);

  useEffect(() => {
    if (!graph) {
      return;
    }

    replaceWithProjectGraph(graph);
  }, [graph, replaceWithProjectGraph]);

  const serialize = serializeCurrentGraph;

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
        onDurableStatus(traceMessage);
        onTrace(traceMessage);
      }
    },
    [onDurableStatus, onTrace]
  );

  const commitDurableSnapshotIfCurrent = useCallback(
    (
      expectedFingerprint: string,
      nextNodes: Node<CanvasNodeData>[],
      nextEdges: Edge[],
      traceMessage?: string,
      staleMessage = "Skipped stale canvas update; newer edits are still on the canvas"
    ) => {
      if (!isCurrentGraphContent(expectedFingerprint)) {
        onDurableStatus(staleMessage);
        onTrace(staleMessage);
        return false;
      }

      commitDurableSnapshot(nextNodes, nextEdges, traceMessage);
      return true;
    },
    [commitDurableSnapshot, isCurrentGraphContent, onDurableStatus, onTrace]
  );

  const commitDurableGraphIfCurrent = useCallback(
    (
      expectedFingerprint: string,
      nextGraph: EtherGraph,
      traceMessage?: string,
      staleMessage?: string
    ) =>
      commitDurableSnapshotIfCurrent(
        expectedFingerprint,
        normalizeNodes(nextGraph.nodes),
        normalizeEdges(nextGraph.edges),
        traceMessage,
        staleMessage
      ),
    [commitDurableSnapshotIfCurrent]
  );

  const saveProjectGraph = useCallback(async (): Promise<CanvasGraphPersistenceResult> => {
    if (!projectId) {
      throw new Error("Open a project before saving graph state");
    }

    const graphToSave = serializeCurrentGraph();
    const savedFingerprint = graphContentFingerprint(graphToSave);
    const savedGraph = await window.ether.project.saveGraph(projectId, graphToSave);
    const appliedToCanvas = isCurrentGraphContent(savedFingerprint);

    if (appliedToCanvas) {
      replaceWithProjectGraph(savedGraph);
      onTrace("Graph saved");
    } else {
      onTrace("Graph saved; newer canvas edits preserved");
    }

    return { graph: savedGraph, appliedToCanvas };
  }, [isCurrentGraphContent, onTrace, projectId, replaceWithProjectGraph, serializeCurrentGraph]);

  const loadProjectGraph = useCallback(async (): Promise<CanvasGraphPersistenceResult> => {
    if (!projectId) {
      throw new Error("Open a project before loading graph state");
    }

    const loadedGraph = await window.ether.project.loadGraph(projectId);
    replaceWithProjectGraph(loadedGraph);
    onTrace("Graph loaded");

    return { graph: loadedGraph, appliedToCanvas: true };
  }, [onTrace, projectId, replaceWithProjectGraph]);

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
        onRelationshipLocked();
        return;
      }

      setHistory((current) => {
        const nextEdges = applyEdgeChanges(changes, current.present.edges);
        const editsGraph = changes.some((change) => change.type !== "select");
        const next = { nodes: current.present.nodes, edges: nextEdges };

        return editsGraph ? pushCanvasHistory(current, next) : { ...current, present: next };
      });
    },
    [edges, nodes, onRelationshipLocked]
  );

  const undo = useCallback(() => {
    setHistory((current) => undoCanvasHistory(current));
    onTrace("Undo");
  }, [onTrace]);

  const redo = useCallback(() => {
    setHistory((current) => redoCanvasHistory(current));
    onTrace("Redo");
  }, [onTrace]);

  return {
    wrapperRef,
    flowRef,
    nodeCounterRef,
    dragBaselineRef,
    textEditBaselineRef,
    viewport,
    setViewport,
    history,
    isDirty,
    setHistory,
    nodes,
    edges,
    assemblyGraph,
    serialize,
    serializeCurrentGraph,
    graphContentFingerprint,
    isCurrentGraphContent,
    saveProjectGraph,
    loadProjectGraph,
    commitSnapshot,
    commitDurableSnapshot,
    commitDurableSnapshotIfCurrent,
    commitDurableGraphIfCurrent,
    onNodesChange,
    onEdgesChange,
    undo,
    redo
  };
}
