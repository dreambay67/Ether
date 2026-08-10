import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent } from "react";
import { Background, Controls, MiniMap, ReactFlow, SelectionMode, useReactFlow, useUpdateNodeInternals, type Connection, type Node, type NodeProps, type OnNodeDrag, type Viewport, type XYPosition } from "@xyflow/react";
import { validateConnection } from "@ether/graph-kernel";
import { NodeDefinitionIdSchema, type EtherGraph, type NodeDefinitionId, type NodeLibraryItem, type NodePosition, type PayloadChannel } from "@ether/schema";
import { EtherEdge, type EtherEdgeEditor, type EtherFlowEdgeData } from "./edges/EtherEdge";
import { edgeBundleKey, type EdgeBounds } from "./edges/edgeGeometry";
import { EtherNode, type EtherCanvasNodeData, ModuleNode } from "./EtherNode";
import type { NodeRuntimeStatus } from "./nodes/NodeStatusLayer";
import { marqueeHitIds, marqueeRectangle, useCanvasInteraction } from "./hooks/useCanvasInteraction";
import { PAYLOAD_CHANNELS, channelsFor } from "./ports/channelRegistry";
import { projectCanvasChannelActivity } from "./projection";
import { markPerformance, measurePerformance } from "../performance/marks";
import { notifyRendererInteractive } from "../runtime/interactive";
import { NODE_LIBRARY_DRAG_TYPE, QuickAddPalette } from "./library/NodeLibrary";
import { commandIdForKeyboard, commandPreservesCanvasFocus, type GraphCommand } from "./commands/useGraphCommands";
import type { CanvasEditorField } from "./commands/directEditing";
import { moduleAccent, moduleIsLocked } from "./modules/moduleModel";
import { classifyCanvasFileDrop, useDropCommands, type CanvasReferenceDropHandler } from "./commands/useDropCommands";

function OverviewCluster({ data }: NodeProps & { data: { count: number; title: string } }) {
  return <article className="ether-node ether-node-overview ether-node-family-canvas" data-testid="ether-node" data-cluster-node-count={data.count} aria-label={`${data.count} nodes in this canvas region`}><header className="ether-node-header"><span className="ether-node-family">Overview</span></header><strong>{data.title}</strong><span>{data.count} nodes</span></article>;
}
const nodeTypes = { etherNode: EtherNode, overviewCluster: OverviewCluster, module: ModuleNode }; const edgeTypes = { etherEdge: EtherEdge };
type ConnectionIntent = { nodeId: string; handleId: string; handleType: "source" | "target" };
function projectAtVersion<T>(_version: string, project: () => T): T { return project(); }
function endpointBounds(graph: EtherGraph, endpoint: EtherGraph["edges"][number]["from"]): EdgeBounds | undefined {
  if (endpoint.kind === "node") {
    const node = graph.nodes.find((candidate) => candidate.id === endpoint.nodeId);
    return node === undefined ? undefined : { x: node.position.x, y: node.position.y, width: node.size.width, height: node.size.height };
  }
  const module = graph.modules.find((candidate) => candidate.id === endpoint.moduleId);
  return module === undefined ? undefined : { x: module.position.x, y: module.position.y, width: module.size.width, height: module.collapsed ? 112 : module.size.height };
}
export function CanvasSurface({ graph, catalog, nodeStatuses, readOnly, selectedIds, selectedEdgeId, selectedModuleId, activeEditor, commands, viewport, onAddNode, onMove, onMoveModule, onResize, onDelete, onEditRequest, onEditCommit, onEditCancel, onConnect, onDeleteEdge, onRole, onChannel, onModuleEnter, onModuleToggle, onSelected, onEdgeSelected, onModuleSelected, onViewport, onCommandUnavailable, onReferenceDrop }: {
  graph: EtherGraph; catalog: readonly NodeLibraryItem[]; nodeStatuses: Record<string, NodeRuntimeStatus>; readOnly: boolean; selectedIds: readonly string[]; selectedEdgeId: string | null; selectedModuleId: string | null; activeEditor: { nodeId: string; field: CanvasEditorField } | null; commands: readonly GraphCommand[]; viewport?: Viewport; onAddNode(definitionId: NodeDefinitionId, position: NodePosition): void; onMove(positions: { nodeId: string; position: XYPosition }[]): void; onMoveModule(id: string, position: XYPosition): void; onResize(id: string, size: { width: number; height: number }): void; onDelete(id: string): void; onEditRequest(id: string, field: CanvasEditorField): void; onEditCommit(id: string, field: CanvasEditorField, value: string): Promise<boolean>; onEditCancel(): void; onConnect(sourceId: string, sourceHandle: string, targetId: string, targetHandle: string): void; onDeleteEdge(id: string): void; onRole(id: string, role: import("@ether/schema").ConnectionRole): void; onChannel(id: string, endpoint: "source" | "target", channel: PayloadChannel): void; onModuleEnter(id: string): void; onModuleToggle(id: string): void; onSelected(ids: string[]): void; onEdgeSelected(id: string | null): void; onModuleSelected(id: string | null, additive?: boolean): void; onViewport(viewport: Viewport): void; onCommandUnavailable(message: string): void; onReferenceDrop?: CanvasReferenceDropHandler;
}) {
  markPerformance("canvas:projection:start");
  const flow = useReactFlow();
  const updateNodeInternals = useUpdateNodeInternals();
  const surfaceRef = useRef<HTMLDivElement>(null);
  const marqueeGesture = useRef<{ start: { x: number; y: number }; pointerId: number; moved: boolean } | null>(null);
  const marqueeWasActive = useRef(false);
  const previousSurfaceSize = useRef<{ width: number; height: number } | null>(null);
  const interaction = useCanvasInteraction(selectedIds, onSelected);
  const { beginEdit: beginInteractionEdit, mode: interactionMode, settle: settleInteraction } = interaction;
  const viewportInitialized = useRef(false);
  const initialViewport = viewport ?? graph.viewState.viewport;
  const largeGraph = graph.nodes.length >= 500;
  const [semanticOverview, setSemanticOverview] = useState(largeGraph && initialViewport.zoom < 0.4);
  const [placementPreview, setPlacementPreview] = useState<{ x: number; y: number; title: string } | null>(null);
  const [quickAdd, setQuickAdd] = useState<{ anchor: { x: number; y: number }; position: NodePosition } | null>(null);
  const [marqueeRect, setMarqueeRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const [dragConnectionIntent, setDragConnectionIntent] = useState<ConnectionIntent | null>(null);
  const [clickConnectionIntent, setClickConnectionIntent] = useState<ConnectionIntent | null>(null);
  const [edgeEditor, setEdgeEditor] = useState<{ edgeId: string; editor: Exclude<EtherEdgeEditor, null> } | null>(null);
  const connectionIntent = clickConnectionIntent ?? dragConnectionIntent;
  const focusCanvas = useCallback(() => surfaceRef.current?.focus({ preventScroll: true }), []);
  const commitInlineEdit = useCallback(async (nodeId: string, field: CanvasEditorField, value: string) => {
    const saved = await onEditCommit(nodeId, field, value);
    if (saved) globalThis.requestAnimationFrame(focusCanvas);
    return saved;
  }, [focusCanvas, onEditCommit]);
  const cancelInlineEdit = useCallback(() => {
    onEditCancel();
    globalThis.requestAnimationFrame(focusCanvas);
  }, [focusCanvas, onEditCancel]);
  const editEdge = useCallback((edgeId: string, editor: EtherEdgeEditor) => {
    onEdgeSelected(edgeId);
    setEdgeEditor(editor === null ? null : { edgeId, editor });
  }, [onEdgeSelected]);
  const internalNodeIds = [...graph.nodes.map((node) => node.id), ...graph.modules.map((module) => `module:${module.id}`)].join("\u001f");
  const edgeProjectionVersion = graph.edges.map((edge) => JSON.stringify(edge)).join("\u001f");
  const moduleProjectionVersion = graph.modules.map((module) => JSON.stringify(module)).join("\u001f");
  const handleLayoutVersion = [
    edgeProjectionVersion,
    moduleProjectionVersion,
    ...graph.nodes.map((node) => `${node.id}:${node.definitionId}`),
  ].join("\u001e");
  const { onDrop: handleReferenceDrop } = useDropCommands(onCommandUnavailable, onReferenceDrop);
  const showSemanticOverview = largeGraph && semanticOverview;
  useEffect(() => {
    if (activeEditor !== null) beginInteractionEdit();
    else if (interactionMode === "editing") settleInteraction();
  }, [activeEditor, beginInteractionEdit, interactionMode, settleInteraction]);
  useEffect(() => {
    setSemanticOverview(largeGraph && initialViewport.zoom < 0.4);
  }, [graph.id, initialViewport.zoom, largeGraph]);
  useEffect(() => {
    if (internalNodeIds === "") return;
    updateNodeInternals(internalNodeIds.split("\u001f"));
  }, [handleLayoutVersion, internalNodeIds, updateNodeInternals]);
  useEffect(() => {
    const handleWorkspaceShortcut = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isTextEditingTarget(event.target) || isNativeEnterTarget(event)) return;
      const commandId = commandIdForKeyboard(event);
      const command = commandId === null ? undefined : commands.find((item) => item.id === commandId);
      if (command === undefined) return;
      event.preventDefault();
      if (!command.enabled) {
        if (command.disabledReason) onCommandUnavailable(command.disabledReason);
        return;
      }
      if (commandPreservesCanvasFocus(command.id)) surfaceRef.current?.focus({ preventScroll: true });
      void command.execute();
    };
    document.addEventListener("keydown", handleWorkspaceShortcut);
    return () => document.removeEventListener("keydown", handleWorkspaceShortcut);
  }, [commands, onCommandUnavailable]);
  useEffect(() => {
    const canvasBridge = window.ether.canvas;
    if (typeof canvasBridge?.onCommand !== "function") return;
    return canvasBridge.onCommand(({ command: commandId }) => {
      if (isTextEditingTarget(document.activeElement)) return;
      const command = commands.find((item) => item.id === commandId);
      if (command === undefined) return;
      if (!command.enabled) {
        if (command.disabledReason) onCommandUnavailable(command.disabledReason);
        return;
      }
      if (commandPreservesCanvasFocus(command.id)) surfaceRef.current?.focus({ preventScroll: true });
      void command.execute();
    });
  }, [commands, onCommandUnavailable]);
  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface || typeof ResizeObserver === "undefined") return;
    let frame: number | null = null;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const next = { width: entry.contentRect.width, height: entry.contentRect.height };
      const previous = previousSurfaceSize.current;
      previousSurfaceSize.current = next;
      if (!previous || graph.nodes.length === 0 || next.width <= 0 || next.height <= 0) return;
      const xShift = (next.width - previous.width) / 2;
      const yShift = (next.height - previous.height) / 2;
      if (Math.abs(xShift) < 0.5 && Math.abs(yShift) < 0.5) return;
      if (frame !== null) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const current = flow.getViewport();
        void flow.setViewport({ ...current, x: current.x + xShift, y: current.y + yShift }, { duration: 0 });
      });
    });
    observer.observe(surface);
    return () => {
      observer.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
      previousSurfaceSize.current = null;
    };
  }, [flow, graph.id, graph.nodes.length]);
  const compatibleChannels = useCallback((edge: EtherGraph["edges"][number], endpoint: "source" | "target") => {
    const value = endpoint === "source" ? edge.from : edge.to;
    if (value.kind === "module") return [value.channel];
    const node = graph.nodes.find((item) => item.id === value.nodeId);
    const available = node === undefined ? [value.channel] : channelsFor(node.definitionId, endpoint === "source" ? "output" : "input");
    const from = edge.from; const to = edge.to;
    if (from.kind !== "node" || to.kind !== "node") return [value.channel];
    const source = graph.nodes.find((item) => item.id === from.nodeId);
    const target = graph.nodes.find((item) => item.id === to.nodeId);
    if (source === undefined || target === undefined) return [value.channel];
    return available.filter((channel) => {
      if (channel === value.channel) return true;
      const candidate = endpoint === "source" ? { ...edge, from: { ...edge.from, channel } } : { ...edge, to: { ...edge.to, channel } };
      return validateConnection({
        sourceDefinitionId: source.definitionId,
        sourceChannel: candidate.from.channel,
        targetDefinitionId: target.definitionId,
        targetChannel: candidate.to.channel,
        role: candidate.role,
        adapter: candidate.adapter,
        candidate,
        existingEdges: graph.edges,
        capabilities: [],
        topology: { graphs: [graph] }
      }).allowed;
    });
  }, [graph]);
  const activity = useMemo(() => projectAtVersion(edgeProjectionVersion, () => projectCanvasChannelActivity(graph)), [edgeProjectionVersion, graph]);
  const intentChannelsFor = useCallback((nodeId: string, definitionId: NodeDefinitionId, direction: "input" | "output"): readonly PayloadChannel[] | null => {
    if (connectionIntent === null) return null;
    if (connectionIntent.nodeId === nodeId) return [];
    const origin = graph.nodes.find((node) => node.id === connectionIntent.nodeId);
    if (origin === undefined) return [];
    if (connectionIntent.handleType === "source" && direction === "input") {
      return channelsFor(definitionId, "input").filter((targetChannel) => validateConnection({
        sourceDefinitionId: origin.definitionId,
        sourceChannel: connectionIntent.handleId,
        targetDefinitionId: definitionId,
        targetChannel,
        role: "general",
        capabilities: []
      }).allowed);
    }
    if (connectionIntent.handleType === "target" && direction === "output") {
      return channelsFor(definitionId, "output").filter((sourceChannel) => validateConnection({
        sourceDefinitionId: definitionId,
        sourceChannel,
        targetDefinitionId: origin.definitionId,
        targetChannel: connectionIntent.handleId,
        role: "general",
        capabilities: []
      }).allowed);
    }
    return [];
  }, [connectionIntent, graph.nodes]);
  const overviewClusters = useMemo(() => {
    if (!showSemanticOverview) return [];
    const cellWidth = 1_040;
    const cellHeight = 680;
    const clusters = new Map<string, { column: number; row: number; count: number }>();
    for (const node of graph.nodes) {
      const column = Math.floor(node.position.x / cellWidth);
      const row = Math.floor(node.position.y / cellHeight);
      const key = `${column}:${row}`;
      const cluster = clusters.get(key);
      if (cluster === undefined) clusters.set(key, { column, row, count: 1 });
      else cluster.count += 1;
    }
    return [...clusters.values()].map((cluster) => ({
      id: `overview:${cluster.column}:${cluster.row}`,
      type: "overviewCluster",
      position: { x: cluster.column * cellWidth, y: cluster.row * cellHeight },
      draggable: false,
      selectable: false,
      data: { count: cluster.count, title: `Region ${cluster.column + 1}.${cluster.row + 1}` },
      width: cellWidth - 80,
      height: cellHeight - 80,
      style: { width: cellWidth - 80, height: cellHeight - 80, zIndex: 1 }
    } satisfies Node));
  }, [graph.nodes, showSemanticOverview]);
  const activateHandle = useCallback((nodeId: string, handleId: string, handleType: "source" | "target") => {
    if (readOnly) return;
    const next = { nodeId, handleId, handleType } satisfies ConnectionIntent;
    if (clickConnectionIntent === null) {
      setClickConnectionIntent(next);
      interaction.beginConnect();
      return;
    }
    if (clickConnectionIntent.nodeId === nodeId && clickConnectionIntent.handleId === handleId && clickConnectionIntent.handleType === handleType) {
      setClickConnectionIntent(null);
      interaction.cancel();
      return;
    }
    if (clickConnectionIntent.handleType === handleType) {
      setClickConnectionIntent(next);
      interaction.beginConnect();
      return;
    }
    const source = handleType === "source" ? next : clickConnectionIntent;
    const target = handleType === "target" ? next : clickConnectionIntent;
    setClickConnectionIntent(null);
    interaction.settle();
    onConnect(source.nodeId, source.handleId, target.nodeId, target.handleId);
  }, [clickConnectionIntent, interaction, onConnect, readOnly]);
  const selectModule = useCallback((moduleId: string, additive: boolean) => {
    if (!additive) interaction.clearSelection();
    onEdgeSelected(null);
    onModuleSelected(moduleId, additive);
  }, [interaction, onEdgeSelected, onModuleSelected]);
  const nodes = useMemo<Node[]>(() => projectAtVersion(moduleProjectionVersion, () => [
    ...graph.modules.map((module) => {
      const height = module.collapsed ? 112 : module.size.height;
      return { id: `module:${module.id}`, type: "module", position: module.position, width: module.size.width, height, draggable: !readOnly && !moduleIsLocked(module), selected: selectedModuleId === module.id, data: { title: module.title, description: module.description ?? "", accent: moduleAccent(module), locked: moduleIsLocked(module), collapsed: module.collapsed, inputs: module.interface.inputs.map((port) => ({ id: port.id, channel: port.channel })), outputs: module.interface.outputs.map((port) => ({ id: port.id, channel: port.channel })), readOnly, onSelect: selectModule, onEnter: () => onModuleEnter(module.id), onToggle: () => onModuleToggle(module.id), onHandleActivate: activateHandle }, style: { width: module.size.width, height, zIndex: 1 } };
    }),
    ...(showSemanticOverview ? overviewClusters : graph.nodes.map((node) => { const editing = activeEditor?.nodeId === node.id; const height = editing ? Math.max(250, node.size.height) : node.size.height; return { id: node.id, type: "etherNode", position: node.position, width: node.size.width, height, selected: selectedIds.includes(node.id), data: { node, connectedInput: activity[node.id]?.input ?? [], connectedOutput: activity[node.id]?.output ?? [], intentInput: intentChannelsFor(node.id, node.definitionId, "input"), intentOutput: intentChannelsFor(node.id, node.definitionId, "output"), status: nodeStatuses[node.id] ?? null, readOnly, activeEditor: editing ? activeEditor.field : null, onDelete, onResizeStart: interaction.beginResize, onResize, onResizeEnd: interaction.settle, onSelect: interaction.selectNode, onEditRequest, onEditCommit: commitInlineEdit, onEditCancel: cancelInlineEdit, onHandleActivate: activateHandle } satisfies EtherCanvasNodeData, style: { width: node.size.width, height, zIndex: 1 } }; }))
  ]), [activeEditor, activateHandle, activity, cancelInlineEdit, commitInlineEdit, graph.modules, graph.nodes, intentChannelsFor, interaction.beginResize, interaction.selectNode, interaction.settle, moduleProjectionVersion, nodeStatuses, onDelete, onEditRequest, onModuleEnter, onModuleToggle, onResize, overviewClusters, readOnly, selectModule, selectedIds, selectedModuleId, showSemanticOverview]);
  const edgeCount = graph.edges.length;
  const edgeLaneLayout = useMemo(() => {
    const groups = new Map<string, EtherGraph["edges"]>();
    for (const edge of graph.edges) {
      const key = edgeBundleKey(edge);
      const group = groups.get(key);
      if (group === undefined) groups.set(key, [edge]);
      else group.push(edge);
    }
    const layout = new Map<string, { index: number; count: number }>();
    for (const group of groups.values()) {
      const ordered = [...group].sort((left, right) => {
        const channelOrder = PAYLOAD_CHANNELS.indexOf(left.from.channel) - PAYLOAD_CHANNELS.indexOf(right.from.channel);
        return channelOrder || left.order - right.order || left.id.localeCompare(right.id);
      });
      ordered.forEach((edge, index) => layout.set(edge.id, { index, count: ordered.length }));
    }
    return layout;
  }, [graph.edges]);
  const edges = useMemo(() => projectAtVersion(edgeProjectionVersion, () => showSemanticOverview || edgeCount === 0 ? [] : graph.edges.map((edge) => {
    const lane = edgeLaneLayout.get(edge.id) ?? { index: 0, count: 1 };
    return { id: edge.id, type: "etherEdge", source: edge.from.kind === "node" ? edge.from.nodeId : `module:${edge.from.moduleId}`, target: edge.to.kind === "node" ? edge.to.nodeId : `module:${edge.to.moduleId}`, sourceHandle: edge.from.kind === "node" ? edge.from.channel : `out:${edge.from.portId}`, targetHandle: edge.to.kind === "node" ? edge.to.channel : `in:${edge.to.portId}`, selectable: false, data: { edge, editor: edgeEditor?.edgeId === edge.id ? edgeEditor.editor : null, readOnly, selected: selectedEdgeId === edge.id, laneIndex: lane.index, laneCount: lane.count, sourceBounds: endpointBounds(graph, edge.from), targetBounds: endpointBounds(graph, edge.to), compatibleSourceChannels: compatibleChannels(edge, "source"), compatibleTargetChannels: compatibleChannels(edge, "target"), onDelete: onDeleteEdge, onRole, onChannel, onEdit: editEdge, onSelect: onEdgeSelected } satisfies EtherFlowEdgeData };
  })), [compatibleChannels, edgeCount, edgeEditor, edgeLaneLayout, edgeProjectionVersion, editEdge, graph, onChannel, onDeleteEdge, onEdgeSelected, onRole, readOnly, selectedEdgeId, showSemanticOverview]);
  markPerformance("canvas:projection:end");
  measurePerformance("canvas:projection", "canvas:projection:start", "canvas:projection:end");
  const onConnectFlow = useCallback((connection: Connection) => { setDragConnectionIntent(null); setClickConnectionIntent(null); if (readOnly || !connection.source || !connection.target || !connection.sourceHandle || !connection.targetHandle) return; onConnect(connection.source, connection.sourceHandle, connection.target, connection.targetHandle); }, [onConnect, readOnly]);
  const insertionAt = useCallback((clientX: number, clientY: number) => flow.screenToFlowPosition({ x: clientX, y: clientY }), [flow]);
  const renderedNodeRects = useCallback((surface: HTMLElement) => [...surface.querySelectorAll<HTMLElement>(".react-flow__node[data-id]")]
    .flatMap((element) => {
      const id = element.dataset.id;
      return id !== undefined && graph.nodes.some((node) => node.id === id)
        ? [{ id, rect: element.getBoundingClientRect() }]
        : [];
    }), [graph.nodes]);
  const updateMarqueeGesture = useCallback((start: { x: number; y: number }, end: { x: number; y: number }, surface: HTMLElement) => {
    const bounds = surface.getBoundingClientRect();
    const distance = Math.hypot(end.x - start.x, end.y - start.y);
    if (marqueeGesture.current !== null) marqueeGesture.current.moved = distance > 1;
    setMarqueeRect(distance > 1 ? marqueeRectangle(start, end, bounds) : null);
    interaction.updateMarquee(marqueeHitIds(renderedNodeRects(surface), start, end));
  }, [interaction, renderedNodeRects]);
  const openQuickAdd = useCallback((clientX: number, clientY: number) => {
    if (readOnly || catalog.length === 0) return;
    const bounds = surfaceRef.current?.getBoundingClientRect();
    if (bounds === undefined) return;
    setQuickAdd({
      anchor: {
        x: Math.max(18, Math.min(bounds.width - 18, clientX - bounds.left)),
        y: Math.max(18, Math.min(bounds.height - 18, clientY - bounds.top))
      },
      position: insertionAt(clientX, clientY)
    });
  }, [catalog.length, insertionAt, readOnly]);
  const draggedDefinition = useCallback((event: ReactDragEvent<HTMLElement>) => {
    const value = event.dataTransfer.getData(NODE_LIBRARY_DRAG_TYPE) || event.dataTransfer.getData("text/plain");
    const parsed = NodeDefinitionIdSchema.safeParse(value);
    return parsed.success ? parsed.data : null;
  }, []);
  const previewDraggedNode = useCallback((event: ReactDragEvent<HTMLElement>) => {
    if (readOnly) return;
    if (event.dataTransfer.types.includes("Files")) {
      if (classifyCanvasFileDrop(Array.from(event.dataTransfer.files)) === "reference" && onReferenceDrop !== undefined) {
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }
      return;
    }
    if (!event.dataTransfer.types.includes(NODE_LIBRARY_DRAG_TYPE)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    const bounds = surfaceRef.current?.getBoundingClientRect();
    if (bounds === undefined) return;
    const definitionId = draggedDefinition(event);
    const item = catalog.find((candidate) => candidate.definitionId === definitionId);
    setPlacementPreview({ x: event.clientX - bounds.left, y: event.clientY - bounds.top, title: item?.title ?? "Place node" });
  }, [catalog, draggedDefinition, onReferenceDrop, readOnly]);
  const dropNode = useCallback((event: ReactDragEvent<HTMLElement>) => {
    if (event.dataTransfer.files.length > 0) {
      if (classifyCanvasFileDrop(Array.from(event.dataTransfer.files)) === "reference" && onReferenceDrop !== undefined) {
        const bounds = surfaceRef.current?.getBoundingClientRect();
        if (bounds !== undefined) {
          const targetElement = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>(".react-flow__node[data-id]") : null;
          const targetNodeId = targetElement?.dataset.id ?? null;
          handleReferenceDrop(event, insertionAt(event.clientX, event.clientY), targetNodeId);
        }
        setPlacementPreview(null);
        return;
      }
    }
    const definitionId = draggedDefinition(event);
    setPlacementPreview(null);
    if (readOnly || definitionId === null) return;
    event.preventDefault();
    onAddNode(definitionId, insertionAt(event.clientX, event.clientY));
  }, [draggedDefinition, handleReferenceDrop, insertionAt, onAddNode, onReferenceDrop, readOnly]);
  const onNodeDragStop: OnNodeDrag = useCallback((_event, node) => {
    if (readOnly) return;
    if (node.id.startsWith("module:")) { onMoveModule(node.id.slice("module:".length), node.position); interaction.settle(); return; }
    const original = graph.nodes.find((item) => item.id === node.id); if (!original) return;
    const selected = selectedIds.includes(node.id) ? selectedIds : [node.id]; const delta = { x: node.position.x - original.position.x, y: node.position.y - original.position.y };
    onMove(graph.nodes.filter((item) => selected.includes(item.id)).map((item) => ({ nodeId: item.id, position: { x: item.position.x + delta.x, y: item.position.y + delta.y } })));
    interaction.settle();
  }, [graph.nodes, interaction, onMove, onMoveModule, readOnly, selectedIds]);
  const fitSmallGraph = graph.nodes.length > 0 && graph.nodes.length < 250;
  const fitViewOnMount = useRef({ graphId: graph.id, enabled: fitSmallGraph });
  if (fitViewOnMount.current.graphId !== graph.id) {
    fitViewOnMount.current = { graphId: graph.id, enabled: fitSmallGraph };
  }
  const updateSemanticZoom = useCallback((_event: MouseEvent | TouchEvent | null, nextViewport: Viewport) => {
    if (!viewportInitialized.current) return;
    const nextOverview = graph.nodes.length >= 500 && nextViewport.zoom < 0.4;
    setSemanticOverview((current) => current === nextOverview ? current : nextOverview);
  }, [graph.nodes.length]);
  const beginConnection = useCallback((params: { nodeId: string | null; handleId: string | null; handleType: "source" | "target" | null }) => {
    interaction.beginConnect();
    const channel = params.handleId === null ? null : PAYLOAD_CHANNELS.find((candidate) => candidate === params.handleId) ?? null;
    if (params.nodeId !== null && channel !== null && params.handleType !== null) {
      setDragConnectionIntent({ nodeId: params.nodeId, handleId: channel, handleType: params.handleType });
    }
  }, [interaction]);
  const endConnection = useCallback(() => {
    setDragConnectionIntent(null);
    interaction.settle();
  }, [interaction]);
  return (
    <div
      ref={surfaceRef}
      className="canvas-surface"
      data-testid="ether-canvas-surface"
      data-graph-id={graph.id}
      data-graph-kind={graph.kind}
      data-graph-node-count={graph.nodes.length}
      data-projected-edge-count={edges.length}
      data-semantic-overview={showSemanticOverview ? "true" : "false"}
      data-interaction-mode={interaction.mode}
      aria-label="Authoring canvas"
      tabIndex={0}
      onPointerDownCapture={(event) => {
        if (!isCanvasPaneTarget(event.target)) return;
        focusCanvas();
        if (event.button !== 0) return;
        event.preventDefault();
        marqueeGesture.current = { start: { x: event.clientX, y: event.clientY }, pointerId: event.pointerId, moved: false };
        marqueeWasActive.current = false;
        setMarqueeRect(null);
        setClickConnectionIntent(null);
        setDragConnectionIntent(null);
        onEdgeSelected(null);
        onModuleSelected(null);
        interaction.beginMarquee(event.shiftKey);
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMoveCapture={(event) => {
        const gesture = marqueeGesture.current;
        if (gesture === null || gesture.pointerId !== event.pointerId) return;
        updateMarqueeGesture(gesture.start, { x: event.clientX, y: event.clientY }, event.currentTarget);
      }}
      onPointerUpCapture={(event) => {
        const gesture = marqueeGesture.current;
        if (event.button !== 0 || gesture === null || gesture.pointerId !== event.pointerId) return;
        updateMarqueeGesture(gesture.start, { x: event.clientX, y: event.clientY }, event.currentTarget);
        marqueeWasActive.current = gesture.moved;
        marqueeGesture.current = null;
        setMarqueeRect(null);
        interaction.endMarquee();
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancelCapture={(event) => {
        if (marqueeGesture.current === null) return;
        marqueeGesture.current = null;
        marqueeWasActive.current = false;
        setMarqueeRect(null);
        interaction.cancel();
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onDoubleClick={(event) => {
        if (isCanvasPaneTarget(event.target)) openQuickAdd(event.clientX, event.clientY);
      }}
      onKeyDown={(event) => {
        if (isTextEditingTarget(event.target)) return;
        if (event.target !== event.currentTarget && event.target instanceof Element && event.target.closest("button, input, select, textarea, summary, a[href], [role='button'], [role='option'], [role='menuitem'], [role='separator']")) return;
        const commandId = commandIdForKeyboard(event.nativeEvent);
        const command = commandId === null ? undefined : commands.find((item) => item.id === commandId);
        if (command !== undefined) {
          event.preventDefault();
          if (command.enabled) {
            if (commandPreservesCanvasFocus(command.id)) event.currentTarget.focus({ preventScroll: true });
            void command.execute();
          }
          else if (command.disabledReason) onCommandUnavailable(command.disabledReason);
        } else if (event.key === "Escape") {
          event.preventDefault();
          marqueeGesture.current = null;
          marqueeWasActive.current = false;
          setMarqueeRect(null);
          setClickConnectionIntent(null);
          setDragConnectionIntent(null);
          if (quickAdd !== null) setQuickAdd(null);
          else interaction.cancel();
        } else if (
          event.target === event.currentTarget &&
          event.key.toLocaleLowerCase() === "n" &&
          !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey
        ) {
          event.preventDefault();
          const bounds = event.currentTarget.getBoundingClientRect();
          openQuickAdd(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
        }
      }}
      onDragOver={previewDraggedNode}
      onDragLeave={(event) => {
        if (!(event.relatedTarget instanceof HTMLElement) || !event.currentTarget.contains(event.relatedTarget)) {
          setPlacementPreview(null);
        }
      }}
      onDrop={dropNode}
    >
      <ReactFlow
        key={graph.id}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        defaultViewport={initialViewport}
        minZoom={0.1}
        maxZoom={1.25}
        fitView={fitViewOnMount.current.enabled}
        onlyRenderVisibleElements={!showSemanticOverview}
        nodesDraggable={!readOnly}
        nodesConnectable={!readOnly}
        elementsSelectable={false}
        selectionOnDrag={false}
        selectionKeyCode={null}
        multiSelectionKeyCode="Shift"
        panOnDrag={[2]}
        selectionMode={SelectionMode.Partial}
        selectNodesOnDrag={false}
        onInit={(instance) => {
          viewportInitialized.current = true;
          const current = instance.getViewport();
          setSemanticOverview(graph.nodes.length >= 500 && current.zoom < 0.4);
          markPerformance("graph-hydration:interactive");
          measurePerformance("graph-hydration:interactive", "graph-hydration:start", "graph-hydration:interactive");
          notifyRendererInteractive();
        }}
        onMove={updateSemanticZoom}
        onNodeClick={(event, node) => {
          if (graph.nodes.some((item) => item.id === node.id)) {
            interaction.selectNode(node.id, event.ctrlKey || event.metaKey || event.shiftKey);
          } else if (node.id.startsWith("module:")) {
            selectModule(node.id.slice("module:".length), event.ctrlKey || event.metaKey || event.shiftKey);
          }
        }}
        onEdgeClick={(_event, edge) => { interaction.clearSelection(); onModuleSelected(null); onEdgeSelected(edge.id); }}
        onNodeDragStart={(_event, node) => interaction.beginMove(graph.nodes.some((item) => item.id === node.id) ? node.id : undefined)}
        onNodeDragStop={onNodeDragStop}
        onConnectStart={(_event, params) => beginConnection(params)}
        onConnectEnd={endConnection}
        onClickConnectStart={(_event, params) => beginConnection(params)}
        onClickConnectEnd={endConnection}
        onConnect={onConnectFlow}
        onMoveStart={(event) => {
          if (event instanceof MouseEvent && event.button === 2) interaction.beginPan();
        }}
        onMoveEnd={(event, nextViewport) => {
          interaction.settle();
          if (event !== null && event !== undefined) onViewport(nextViewport);
        }}
        onPaneClick={(event) => {
          if (marqueeWasActive.current) {
            marqueeWasActive.current = false;
            return;
          }
          if ((event.target as HTMLElement).closest(".react-flow__node")) return;
          setClickConnectionIntent(null);
          setDragConnectionIntent(null);
          interaction.clearSelection();
          onEdgeSelected(null);
          onModuleSelected(null);
        }}
        onPaneContextMenu={(event) => event.preventDefault()}
      >
        <Background color="#304051" gap={24} size={1} />
        <Controls showInteractive={false} />
        {fitSmallGraph ? <MiniMap pannable zoomable nodeColor="#37e6ea" /> : null}
      </ReactFlow>
      {marqueeRect !== null ? <div className="canvas-marquee-selection" style={marqueeRect} aria-hidden="true" /> : null}
      {graph.nodes.length === 0 && quickAdd === null ? (
        <div className="empty-canvas-actions">
          <span>Blank workflow</span>
          <strong>Start in three moves.</strong>
          <ol><li>Add a node from the Library.</li><li>Connect its named channel to a compatible input.</li><li>Preview the plan before you run.</li></ol>
          <p>Press N or double-click the canvas to add at the pointer. The keyboard button in the Canvas toolbar lists every command and gesture.</p>
          <button type="button" disabled={readOnly || catalog.length === 0} onClick={() => {
            const bounds = surfaceRef.current?.getBoundingClientRect();
            if (bounds !== undefined) openQuickAdd(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
          }}>Add a node <kbd>N</kbd></button>
        </div>
      ) : null}
      {placementPreview !== null ? (
        <div className="canvas-placement-preview" style={{ left: placementPreview.x, top: placementPreview.y }}>
          <span>{placementPreview.title}</span>
        </div>
      ) : null}
      {quickAdd !== null ? (
        <QuickAddPalette
          anchor={quickAdd.anchor}
          catalog={catalog}
          onClose={() => { setQuickAdd(null); focusCanvas(); }}
          onPick={(item) => {
            onAddNode(item.definitionId, quickAdd.position);
            setQuickAdd(null);
            focusCanvas();
            globalThis.requestAnimationFrame(focusCanvas);
          }}
        />
      ) : null}
    </div>
  );
}

function isTextEditingTarget(target: EventTarget | null) {
  return target instanceof HTMLElement && (target.matches("input, textarea, select") || target.isContentEditable || target.closest("[contenteditable='true']") !== null);
}

function isCanvasPaneTarget(target: EventTarget | null) {
  if (!(target instanceof Element) || target.closest(".react-flow__pane") === null) return false;
  return target.closest([
    ".react-flow__node",
    ".react-flow__edge",
    ".react-flow__handle",
    ".react-flow__controls",
    ".react-flow__minimap",
    "button",
    "input",
    "select",
    "textarea",
    "[role='button']",
    "[role='menuitem']"
  ].join(", ")) === null;
}

function isNativeEnterTarget(event: KeyboardEvent) {
  return event.key === "Enter"
    && event.target instanceof Element
    && event.target.closest("button, summary, a[href], [role='button'], [role='option'], [role='menuitem']") !== null;
}
