import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { ReactFlowProvider, type Viewport } from "@xyflow/react";
import type { EtherGraph, GraphOperation, ModuleParameter } from "@ether/schema";
import type { DocumentDescriptor } from "../../shared/ipc/contracts";
import { CanvasSidePanels } from "./CanvasSidePanels";
import { CanvasSurface } from "./CanvasSurface";
import { CanvasToolbar } from "./CanvasToolbar";
import { useEdgeCommands } from "./commands/useEdgeCommands";
import { useNodeCommands } from "./commands/useNodeCommands";
import { useTransactionCommands, type GraphRevisionSeed } from "./commands/useTransactionCommands";

export type EtherCanvasHandle = { addPrompt(): void; addImage(): void; };
export type EtherCanvasProps = { graph: EtherGraph | null; document: DocumentDescriptor; onGraph(graph: EtherGraph): void; onStatus(message: string): void; };
type ParentFrame = { graph: EtherGraph; moduleId: string; selectedIds: string[] };
type ApplicationQueryBridge = { query(query: unknown): Promise<{ payload?: { graph?: EtherGraph; documentRevisionId?: string; graphRevisionId?: string } }> };
function emptyCanvasGraph(documentId: string): EtherGraph { return { id: `loading-${documentId}`, title: "Canvas", kind: "root", createdAt: "2026-07-22T00:00:00.000Z", updatedAt: "2026-07-22T00:00:00.000Z", nodes: [], edges: [], groups: [], modules: [], viewState: { viewport: { x: 0, y: 0, zoom: 1 }, selectedNodeIds: [], selectedEdgeIds: [], inspectorTarget: null } }; }
function typedQueryBridge() { return (window.ether as unknown as { application?: ApplicationQueryBridge }).application; }

export const EtherCanvas = forwardRef<EtherCanvasHandle, EtherCanvasProps>(function EtherCanvas({ graph, document, onGraph, onStatus }, ref) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]); const [status, setStatus] = useState("Canvas ready"); const [activeGraph, setActiveGraph] = useState<EtherGraph | null>(null); const [parents, setParents] = useState<ParentFrame[]>([]); const [viewports, setViewports] = useState<Record<string, Viewport>>({}); const [revisionSeed, setRevisionSeed] = useState<GraphRevisionSeed | undefined>();
  const report = (message: string) => { setStatus(message); onStatus(message); };
  useEffect(() => { if (graph !== null && (activeGraph === null || activeGraph.id === graph.id)) setActiveGraph(graph); }, [activeGraph, graph]);
  useEffect(() => { setSelectedIds((ids) => ids.filter((id) => activeGraph?.nodes.some((node) => node.id === id))); }, [activeGraph]);
  const displayedGraph = activeGraph ?? graph ?? emptyCanvasGraph(document.documentId);
  const rememberViewport = (graphId: string, viewport: Viewport) => setViewports((current) => ({ ...current, [graphId]: viewport }));
  const enterModule = async (moduleId: string, parentGraph: EtherGraph) => {
    const module = parentGraph.modules.find((item) => item.id === moduleId); const bridge = typedQueryBridge();
    if (!module || !bridge) { report("Module navigation requires the typed application bridge."); return; }
    try { const response = await bridge.query({ kind: "query", id: crypto.randomUUID(), correlationId: crypto.randomUUID(), name: "graph.snapshot", documentId: document.documentId, payload: { graphId: module.graphId } }); const child = response.payload?.graph; const documentRevisionId = response.payload?.documentRevisionId; const graphRevisionId = response.payload?.graphRevisionId; if (!child || !documentRevisionId || !graphRevisionId) throw new Error("The module graph revision was unavailable."); setParents((stack) => [...stack, { graph: parentGraph, moduleId, selectedIds }]); setRevisionSeed({ graphId: child.id, documentRevisionId, graphRevisionId }); setActiveGraph(child); setSelectedIds([]); report(`Entered ${module.title}`); } catch (error) { report(error instanceof Error ? error.message : "The module could not be opened."); }
  };
  const leaveModule = () => { const parent = parents.at(-1); if (!parent) return; setParents((stack) => stack.slice(0, -1)); setActiveGraph(parent.graph); setSelectedIds(parent.selectedIds); report("Returned to parent canvas"); };
  const updateParentGraph = (nextGraph: EtherGraph) => setParents((stack) => stack.map((frame, index) => index === stack.length - 1 ? { ...frame, graph: nextGraph } : frame));
  const parent = parents.at(-1);
  return <ReactFlowProvider><CanvasInner graph={displayedGraph} viewport={viewports[displayedGraph.id]} revisionSeed={revisionSeed} parentFrame={parent} document={document} onGraph={(next) => { if (next.id === graph?.id) onGraph(next); setActiveGraph(next); }} onParentGraph={updateParentGraph} status={status} report={report} selectedIds={selectedIds} setSelectedIds={setSelectedIds} onViewport={(viewport) => rememberViewport(displayedGraph.id, viewport)} onEnterModule={enterModule} onLeaveModule={parents.length > 0 ? leaveModule : undefined} ref={ref} /></ReactFlowProvider>;
});

const CanvasInner = forwardRef<EtherCanvasHandle, { graph: EtherGraph; viewport?: Viewport; revisionSeed?: GraphRevisionSeed; parentFrame?: ParentFrame; document: DocumentDescriptor; onGraph(graph: EtherGraph): void; onParentGraph(graph: EtherGraph): void; status: string; report(message: string): void; selectedIds: string[]; setSelectedIds(ids: string[]): void; onViewport(viewport: Viewport): void; onEnterModule(id: string, graph: EtherGraph): void; onLeaveModule?(): void; }>(function CanvasInner({ graph, viewport, revisionSeed, parentFrame, document, onGraph, onParentGraph, status, report, selectedIds, setSelectedIds, onViewport, onEnterModule, onLeaveModule }, ref) {
  const transactions = useTransactionCommands({ document, graph, revisionSeed, onGraph, onStatus: report }); const nodes = useNodeCommands(graph, transactions.apply, report); const edges = useEdgeCommands(graph, transactions.apply, report); const readOnly = document.mode !== "writable";
  useImperativeHandle(ref, () => ({ addPrompt: () => nodes.createNode("prompt.text"), addImage: () => nodes.createNode("generation.image") }), [nodes]);
  const persistViewport = async () => { const next = viewport ?? graph.viewState.viewport; return transactions.apply([{ type: "updateGraphProperties", graphId: graph.id, viewState: { ...graph.viewState, viewport: next } }], "Save canvas viewport"); };
  const toggleModule = (id: string) => { if (readOnly) return; const module = graph.modules.find((item) => item.id === id); if (module) void transactions.apply([{ type: "updateModule", graphId: graph.id, moduleId: id, module: { ...module, collapsed: !module.collapsed } }], module.collapsed ? "Expand module" : "Collapse module"); };
  const enter = async (id: string) => { if (readOnly || await persistViewport()) onEnterModule(id, graph); };
  const leave = async () => { if (readOnly || await persistViewport()) onLeaveModule?.(); };
  const exposeParameter = (nodeId: string) => {
    if (readOnly || parentFrame === undefined) return;
    const module = parentFrame.graph.modules.find((item) => item.id === parentFrame.moduleId); const node = graph.nodes.find((item) => item.id === nodeId); if (!module || !node) return;
    const configPath = Object.keys(node.config).find((key) => key !== "kind"); if (!configPath) { report("This node has no configurable parameter to expose."); return; }
    const parameter: ModuleParameter = { id: `parameter-${node.id}-${configPath}`, name: `${node.title} ${configPath}`, nodeId: node.id, configPath: [configPath], required: false };
    if (module.interface.parameters.some((item) => item.id === parameter.id)) { report("That parameter is already exposed."); return; }
    const nextInterface = { ...module.interface, parameters: [...module.interface.parameters, parameter] };
    const operations: GraphOperation[] = [{ type: "updateModuleInterface", graphId: parentFrame.graph.id, moduleId: module.id, interface: nextInterface }];
    void transactions.apply(operations, "Expose module parameter").then((saved) => { if (saved) onParentGraph({ ...parentFrame.graph, modules: parentFrame.graph.modules.map((item) => item.id === module.id ? { ...item, interface: nextInterface } : item) }); });
  };
  return <div className="ether-canvas" onDragOver={(event) => event.preventDefault()}><CanvasToolbar readOnly={readOnly} onPrompt={() => nodes.createNode("prompt.text")} onImage={() => nodes.createNode("generation.image")} onGroup={() => nodes.createGroup(selectedIds)} onModule={() => nodes.createModule(selectedIds)} onUndo={transactions.undo} onRedo={transactions.redo} /><CanvasSurface graph={graph} readOnly={readOnly} viewport={viewport} onMove={nodes.moveNodes} onMoveGroup={nodes.moveGroup} onMoveModule={nodes.moveModule} onResize={nodes.resizeNode} onDelete={nodes.removeNode} onTitle={nodes.rename} onConnect={edges.connect} onDeleteEdge={edges.deleteEdge} onRole={edges.setRole} onChannel={edges.setChannel} onModuleEnter={enter} onModuleToggle={toggleModule} onSelected={setSelectedIds} onViewport={onViewport} /><CanvasSidePanels graph={graph} selectedIds={selectedIds} status={status} runPrompt={selectedIds.length > 1} onRunSelected={() => report("Selected run is ready for Run workspace review.")} onLeave={onLeaveModule ? leave : undefined} onExposeParameter={parentFrame ? exposeParameter : undefined} /></div>;
});
