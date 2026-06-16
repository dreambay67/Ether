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
import { Eye, EyeOff, Link2, Redo2, Undo2 } from "lucide-react";
import {
  type CanvasNodeData,
  type EtherNodeDefinition
} from "@ether/engine/graph/nodeCatalog";
import { canConnectNodeKinds } from "@ether/engine/graph/connectionRules";
import { findEdgeInsertionTarget } from "@ether/engine/graph/canvasGeometry";
import { createGraphNodeData, getNodeDefinition } from "@ether/engine/graph/nodeCatalog";
import type { EtherGraph } from "@ether/engine";
import { EtherNode } from "./EtherNode";
import { InspectorPanel } from "./InspectorPanel";
import { NodeLibrary } from "./NodeLibrary";
import { createCanvasHistory, pushCanvasHistory, redoCanvasHistory, undoCanvasHistory } from "./canvasHistory";

type EtherCanvasProps = {
  graph: EtherGraph | null;
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

function normalizeNodes(nodes: EtherGraph["nodes"]): Node<CanvasNodeData>[] {
  return nodes.map((node) => {
    const candidate = node as Node<CanvasNodeData>;
    return {
      ...candidate,
      type: "etherNode",
      data: candidate.data
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

function InnerEtherCanvas(
  { graph, onStatus, onTrace }: EtherCanvasProps,
  ref: React.ForwardedRef<EtherCanvasHandle>
) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const flowRef = useRef<ReactFlowInstance<Node<CanvasNodeData>, Edge> | null>(null);
  const nodeCounterRef = useRef(0);
  const [viewport, setViewport] = useState<Viewport>(graph?.viewport ?? defaultViewport);
  const [history, setHistory] = useState(() =>
    createCanvasHistory({
      nodes: normalizeNodes(graph?.nodes ?? []),
      edges: normalizeEdges(graph?.edges ?? [])
    })
  );
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
  const [showMiniMap, setShowMiniMap] = useState(true);

  const nodes = history.present.nodes as Node<CanvasNodeData>[];
  const edges = history.present.edges;
  const selectedNode = nodes.find((node) => node.selected) ?? null;
  const selectedEdge = edges.find((edge) => edge.selected) ?? null;

  useEffect(() => {
    if (!graph) {
      return;
    }

    setViewport(graph.viewport);
    setHistory(
      createCanvasHistory({
        nodes: normalizeNodes(graph.nodes),
        edges: normalizeEdges(graph.edges)
      })
    );
  }, [graph]);

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
      const nextNodes = applyNodeChanges(changes, current.present.nodes);
      const editsGraph = changes.some((change) => change.type !== "select" && change.type !== "dimensions");
      const next = { nodes: nextNodes, edges: current.present.edges };

      return editsGraph ? pushCanvasHistory(current, next) : { ...current, present: next };
    });
  }, []);

  const onEdgesChange = useCallback((changes: EdgeChange<Edge>[]) => {
    setHistory((current) => {
      const nextEdges = applyEdgeChanges(changes, current.present.edges);
      const editsGraph = changes.some((change) => change.type !== "select");
      const next = { nodes: current.present.nodes, edges: nextEdges };

      return editsGraph ? pushCanvasHistory(current, next) : { ...current, present: next };
    });
  }, []);

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
    [commitSnapshot, edges, nodes, onStatus]
  );

  const connectFirstValidPair = useCallback(() => {
    for (const source of nodes) {
      for (const target of nodes) {
        if (source.id === target.id) {
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

    onStatus("Add a valid source and target node before connecting.");
  }, [commitSnapshot, edges, nodes, onStatus]);

  const updateNode = useCallback(
    (id: string, updates: Partial<CanvasNodeData>) => {
      const nextNodes = nodes.map((node) =>
        node.id === id ? { ...node, data: { ...node.data, ...updates } } : node
      );

      commitSnapshot(nextNodes, edges, "Updated node");
    },
    [commitSnapshot, edges, nodes]
  );

  const updateEdge = useCallback(
    (id: string, label: string) => {
      const nextEdges = edges.map((edge) =>
        edge.id === id ? { ...edge, label, data: { ...edge.data, label } } : edge
      );

      commitSnapshot(nodes, nextEdges, "Updated edge label");
    },
    [commitSnapshot, edges, nodes]
  );

  const deleteSelection = useCallback(() => {
    const selectedNodeIds = new Set(nodes.filter((node) => node.selected).map((node) => node.id));
    const selectedEdgeIds = new Set(edges.filter((edge) => edge.selected).map((edge) => edge.id));
    const nextNodes = nodes.filter((node) => !selectedNodeIds.has(node.id));
    const nextEdges = edges.filter(
      (edge) =>
        !selectedEdgeIds.has(edge.id) &&
        !selectedNodeIds.has(edge.source) &&
        !selectedNodeIds.has(edge.target)
    );

    if (nextNodes.length !== nodes.length || nextEdges.length !== edges.length) {
      commitSnapshot(nextNodes, nextEdges, "Deleted selection");
      onStatus("Selection deleted");
    }
  }, [commitSnapshot, edges, nodes, onStatus]);

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
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [redo, undo]);

  const onDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      const definitionId = event.dataTransfer.getData("application/ether-node-definition");
      const definition = definitionId ? getNodeDefinition(definitionId) : null;

      if (!definition || !flowRef.current) {
        return;
      }

      createNode(
        definition,
        flowRef.current.screenToFlowPosition({ x: event.clientX, y: event.clientY })
      );
    },
    [createNode]
  );

  const onNodeDragStop = useCallback(
    (_event: React.MouseEvent, draggedNode: Node<CanvasNodeData>) => {
      const latestNodes = nodes.map((node) => (node.id === draggedNode.id ? draggedNode : node));
      const targetEdge = findEdgeInsertionTarget({
        draggedNodeId: draggedNode.id,
        nodes: latestNodes,
        edges
      });

      if (!targetEdge) {
        return;
      }

      const sourceNode = latestNodes.find((node) => node.id === targetEdge.source);
      const dragged = latestNodes.find((node) => node.id === draggedNode.id);
      const targetNode = latestNodes.find((node) => node.id === targetEdge.target);

      if (!sourceNode || !dragged || !targetNode) {
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

      commitSnapshot(latestNodes, nextEdges, "Inserted node onto edge");
      onStatus("Node inserted between connected nodes");
    },
    [commitSnapshot, edges, nodes, onStatus]
  );

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
          onUpdateNode={updateNode}
          onUpdateEdge={updateEdge}
          onDeleteSelection={deleteSelection}
        />
      </aside>
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
        deleteKeyCode={["Backspace", "Delete"]}
        fitView
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
        {selectedNode ? `Selected ${selectedNode.data.title}` : selectedEdge ? `Selected ${selectedEdge.label}` : "Canvas ready"}
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
