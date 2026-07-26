import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Background, Controls, MiniMap, ReactFlow, SelectionMode, type Connection, type Node, type NodeProps, type OnNodeDrag, type Viewport, type XYPosition } from "@xyflow/react";
import type { EtherGraph, PayloadChannel } from "@ether/schema";
import { EtherEdge, type EtherFlowEdgeData } from "./edges/EtherEdge";
import { EtherNode, type EtherCanvasNodeData, ModuleNode } from "./EtherNode";
import type { NodeRuntimeStatus } from "./nodes/NodeStatusLayer";
import { useMarqueeSelection } from "./hooks/useMarqueeSelection";
import { channelsFor } from "./ports/ChannelRail";
import { projectCanvasChannelActivity } from "./projection";
import { markPerformance, measurePerformance } from "../performance/marks";
import { notifyRendererInteractive } from "../runtime/interactive";

function GroupNode({ data }: { data: { title: string; color: string } }) { return <div className="ether-group-frame" style={{ "--group-color": data.color } as React.CSSProperties}><span>{data.title}</span></div>; }
function OverviewCluster({ data }: NodeProps & { data: { count: number; title: string } }) {
  return <article className="ether-node ether-node-overview ether-node-family-canvas" data-testid="ether-node" data-cluster-node-count={data.count} aria-label={`${data.count} nodes in this canvas region`}><header className="ether-node-header"><span className="ether-node-family">Overview</span></header><strong>{data.title}</strong><span>{data.count} nodes</span></article>;
}
const nodeTypes = { etherNode: EtherNode, overviewCluster: OverviewCluster, module: ModuleNode, group: GroupNode }; const edgeTypes = { etherEdge: EtherEdge };
export function CanvasSurface({ graph, nodeStatuses, readOnly, viewport, onMove, onMoveGroup, onMoveModule, onResize, onDelete, onTitle, onConnect, onDeleteEdge, onRole, onChannel, onModuleEnter, onModuleToggle, onSelected, onEdgeSelected, onViewport }: {
  graph: EtherGraph; nodeStatuses: Record<string, NodeRuntimeStatus>; readOnly: boolean; viewport?: Viewport; onMove(positions: { nodeId: string; position: XYPosition }[]): void; onMoveGroup(id: string, position: XYPosition): void; onMoveModule(id: string, position: XYPosition): void; onResize(id: string, size: { width: number; height: number }): void; onDelete(id: string): void; onTitle(id: string, title: string): void; onConnect(sourceId: string, sourceHandle: string, targetId: string, targetHandle: string): void; onDeleteEdge(id: string): void; onRole(id: string, role: import("@ether/schema").ConnectionRole): void; onChannel(id: string, endpoint: "source" | "target", channel: PayloadChannel): void; onModuleEnter(id: string): void; onModuleToggle(id: string): void; onSelected(ids: string[]): void; onEdgeSelected(id: string | null): void; onViewport(viewport: Viewport): void;
}) {
  markPerformance("canvas:projection:start");
  const selection = useMarqueeSelection(onSelected);
  const marqueeActive = useRef(false);
  const viewportInitialized = useRef(false);
  const initialViewport = viewport ?? graph.viewState.viewport;
  const largeGraph = graph.nodes.length >= 500;
  const [semanticOverview, setSemanticOverview] = useState(largeGraph && initialViewport.zoom < 0.4);
  const showSemanticOverview = largeGraph && semanticOverview;
  useEffect(() => {
    setSemanticOverview(largeGraph && initialViewport.zoom < 0.4);
  }, [graph.id, initialViewport.zoom, largeGraph]);
  const compatibleChannels = useCallback((edge: EtherGraph["edges"][number], endpoint: "source" | "target") => {
    const value = endpoint === "source" ? edge.from : edge.to; const oppositeChannel = endpoint === "source" ? edge.to.channel : edge.from.channel;
    if (value.kind === "module") return [value.channel];
    const node = graph.nodes.find((item) => item.id === value.nodeId);
    const available = node === undefined ? [value.channel] : channelsFor(node.definitionId, endpoint === "source" ? "output" : "input");
    // Same-channel moves are always valid. Keep an existing adapted channel available, but do not
    // claim a cross-channel adapter exists without an application capability decision.
    return available.filter((channel) => channel === value.channel || channel === oppositeChannel);
  }, [graph.nodes]);
  const activity = useMemo(() => projectCanvasChannelActivity(graph), [graph]);
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
      style: { width: cellWidth - 80, height: cellHeight - 80, zIndex: 1 }
    } satisfies Node));
  }, [graph.nodes, showSemanticOverview]);
  const nodes = useMemo<Node[]>(() => [
    ...graph.groups.map((group) => ({ id: `group:${group.id}`, type: "group", position: group.position, draggable: !readOnly, selectable: false, data: { title: group.title, color: group.color }, style: { width: group.size.width, height: group.size.height, zIndex: 0 } })),
    ...graph.modules.map((module) => ({ id: `module:${module.id}`, type: "module", position: module.position, draggable: !readOnly, data: { title: module.title, collapsed: module.collapsed, inputs: module.interface.inputs.map((port) => ({ id: port.id, channel: port.channel })), outputs: module.interface.outputs.map((port) => ({ id: port.id, channel: port.channel })), readOnly, onEnter: () => onModuleEnter(module.id), onToggle: () => onModuleToggle(module.id) }, style: { width: module.size.width, height: module.size.height, zIndex: 1 } })),
    ...(showSemanticOverview ? overviewClusters : graph.nodes.map((node) => ({ id: node.id, type: "etherNode", position: node.position, selected: selection.selectedIds.includes(node.id), data: { node, connectedInput: activity[node.id]?.input ?? [], connectedOutput: activity[node.id]?.output ?? [], status: nodeStatuses[node.id] ?? null, readOnly, onSelect: selection.selectNode, onDelete, onResize, onTitle } satisfies EtherCanvasNodeData, style: { width: node.size.width, height: node.size.height, zIndex: 1 } })))
  ], [activity, graph.groups, graph.modules, graph.nodes, nodeStatuses, onDelete, onModuleEnter, onModuleToggle, onResize, onTitle, overviewClusters, readOnly, selection.selectNode, selection.selectedIds, showSemanticOverview]);
  const edges = useMemo(() => showSemanticOverview ? [] : graph.edges.map((edge) => ({ id: edge.id, type: "etherEdge", source: edge.from.kind === "node" ? edge.from.nodeId : `module:${edge.from.moduleId}`, target: edge.to.kind === "node" ? edge.to.nodeId : `module:${edge.to.moduleId}`, sourceHandle: edge.from.kind === "node" ? edge.from.channel : `out:${edge.from.portId}`, targetHandle: edge.to.kind === "node" ? edge.to.channel : `in:${edge.to.portId}`, data: { edge, readOnly, compatibleSourceChannels: compatibleChannels(edge, "source"), compatibleTargetChannels: compatibleChannels(edge, "target"), onDelete: onDeleteEdge, onRole, onChannel } satisfies EtherFlowEdgeData })), [compatibleChannels, graph.edges, onChannel, onDeleteEdge, onRole, readOnly, showSemanticOverview]);
  markPerformance("canvas:projection:end");
  measurePerformance("canvas:projection", "canvas:projection:start", "canvas:projection:end");
  const onConnectFlow = useCallback((connection: Connection) => { if (readOnly || !connection.source || !connection.target || !connection.sourceHandle || !connection.targetHandle) return; onConnect(connection.source, connection.sourceHandle, connection.target, connection.targetHandle); }, [onConnect, readOnly]);
  const onNodeDragStop: OnNodeDrag = useCallback((_event, node) => {
    if (readOnly) return;
    if (node.id.startsWith("group:")) { onMoveGroup(node.id.slice("group:".length), node.position); return; }
    if (node.id.startsWith("module:")) { onMoveModule(node.id.slice("module:".length), node.position); return; }
    const original = graph.nodes.find((item) => item.id === node.id); if (!original) return;
    const selected = selection.selectedIds.includes(node.id) ? selection.selectedIds : [node.id]; const delta = { x: node.position.x - original.position.x, y: node.position.y - original.position.y };
    onMove(graph.nodes.filter((item) => selected.includes(item.id)).map((item) => ({ nodeId: item.id, position: { x: item.position.x + delta.x, y: item.position.y + delta.y } })));
  }, [graph.nodes, onMove, onMoveGroup, onMoveModule, readOnly, selection.selectedIds]);
  const fitSmallGraph = graph.nodes.length > 0 && graph.nodes.length < 250;
  const updateSemanticZoom = useCallback((_event: MouseEvent | TouchEvent | null, nextViewport: Viewport) => {
    if (!viewportInitialized.current) return;
    const nextOverview = graph.nodes.length >= 500 && nextViewport.zoom < 0.4;
    setSemanticOverview((current) => current === nextOverview ? current : nextOverview);
  }, [graph.nodes.length]);
  return <div className="canvas-surface" data-testid="ether-canvas-surface" data-graph-node-count={graph.nodes.length} data-semantic-overview={showSemanticOverview ? "true" : "false"} onClickCapture={(event) => { const node = (event.target as HTMLElement).closest<HTMLElement>("[data-node-id]"); if (node) selection.selectNode(node.dataset.nodeId ?? "", event.ctrlKey || event.metaKey || event.shiftKey); }}><ReactFlow key={graph.id} nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} defaultViewport={initialViewport} minZoom={0.1} fitView={fitSmallGraph} onlyRenderVisibleElements={!showSemanticOverview} nodesDraggable={!readOnly} nodesConnectable={!readOnly} elementsSelectable selectionOnDrag panOnDrag={[2]} selectionMode={SelectionMode.Partial} selectNodesOnDrag={false} onInit={(instance) => { viewportInitialized.current = true; const current = instance.getViewport(); setSemanticOverview(graph.nodes.length >= 500 && current.zoom < 0.4); markPerformance("graph-hydration:interactive"); measurePerformance("graph-hydration:interactive", "graph-hydration:start", "graph-hydration:interactive"); notifyRendererInteractive(); }} onMove={updateSemanticZoom} onSelectionStart={() => { marqueeActive.current = true; }} onSelectionChange={({ nodes: selected }) => { if (marqueeActive.current) selection.onSelectionChange({ nodes: selected.filter((node) => graph.nodes.some((item) => item.id === node.id)) }); }} onSelectionEnd={() => { marqueeActive.current = false; }} onNodeClick={(event, node) => { if (graph.nodes.some((item) => item.id === node.id)) selection.selectNode(node.id, event.ctrlKey || event.metaKey || event.shiftKey); }} onEdgeClick={(_event, edge) => onEdgeSelected(edge.id)} onNodeDragStop={onNodeDragStop} onConnect={onConnectFlow} onMoveEnd={(_event, nextViewport) => onViewport(nextViewport)} onPaneClick={(event) => { if ((event.target as HTMLElement).closest(".react-flow__node")) return; selection.clearSelection(); onEdgeSelected(null); }} onPaneContextMenu={(event) => event.preventDefault()}><Background color="#304051" gap={24} size={1} /><Controls showInteractive={false} />{fitSmallGraph ? <MiniMap pannable zoomable nodeColor="#37e6ea" /> : null}</ReactFlow></div>;
}
