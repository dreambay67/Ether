import { forwardRef, useCallback, useEffect, useImperativeHandle, useState } from "react";
import { ReactFlowProvider, type Viewport } from "@xyflow/react";
import type { EtherGraph, ExecutionJob, ExecutionPlan, GraphOperation, ModuleParameter } from "@ether/schema";
import type { DocumentDescriptor } from "../../shared/ipc/contracts";
import { CanvasSidePanels } from "./CanvasSidePanels";
import { CanvasSurface } from "./CanvasSurface";
import { CanvasToolbar } from "./CanvasToolbar";
import { useEdgeCommands } from "./commands/useEdgeCommands";
import { useNodeCommands } from "./commands/useNodeCommands";
import { useTransactionCommands, type GraphRevisionSeed } from "./commands/useTransactionCommands";
import type { InspectorContext } from "./inspector/types";
import type { NodeRuntimeStatus } from "./nodes/NodeStatusLayer";

export type EtherCanvasHandle = { addPrompt(): void; addImage(): void; };
export type EtherCanvasProps = { graph: EtherGraph | null; document: DocumentDescriptor; onGraph(graph: EtherGraph): void; onStatus(message: string): void; onInspectorChange?(context: InspectorContext | null): void; };
type ParentFrame = { graph: EtherGraph; moduleId: string; selectedIds: string[] };
type ApplicationQueryBridge = {
  query(query: unknown): Promise<{ payload?: Record<string, unknown> }>;
  onEvent?(listener: (event: { name?: string }) => void): () => void;
};
function emptyCanvasGraph(documentId: string): EtherGraph { return { id: `loading-${documentId}`, title: "Canvas", kind: "root", createdAt: "2026-07-22T00:00:00.000Z", updatedAt: "2026-07-22T00:00:00.000Z", nodes: [], edges: [], groups: [], modules: [], viewState: { viewport: { x: 0, y: 0, zoom: 1 }, selectedNodeIds: [], selectedEdgeIds: [], inspectorTarget: null } }; }
function typedQueryBridge() { return (window.ether as unknown as { application?: ApplicationQueryBridge }).application; }

function queryRequest(name: string, documentId: string, payload: unknown) {
  return { kind: "query", id: crypto.randomUUID(), correlationId: crypto.randomUUID(), name, documentId, payload };
}

function useNodeRuntimeStatuses(documentId: string, graphId: string) {
  const [statuses, setStatuses] = useState<Record<string, NodeRuntimeStatus>>({});
  useEffect(() => {
    let current = true;
    let expiryTimer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      if (expiryTimer !== undefined) clearTimeout(expiryTimer);
      const bridge = typedQueryBridge();
      if (!bridge) return;
      try {
        const jobsResponse = await bridge.query(queryRequest("job.list", documentId, { limit: 100 }));
        const jobs = (jobsResponse.payload?.jobs as ExecutionJob[] | undefined) ?? [];
        const plans = await Promise.all(jobs.map(async (job) => {
          const response = await bridge.query(queryRequest("plan.summary", documentId, { planId: job.planId }));
          return { job, plan: response.payload?.plan as ExecutionPlan | undefined };
        }));
        if (!current) return;
        const next: Record<string, NodeRuntimeStatus> = {};
        const priority = { done: 1, queued: 2, running: 3, attention: 4 } as const;
        const now = Date.now();
        let nextExpiry = Number.POSITIVE_INFINITY;
        for (const { job, plan } of plans) {
          if (!plan || plan.graphId !== graphId) continue;
          const status: Exclude<NodeRuntimeStatus, null> | null = job.status === "queued" || job.status === "planned"
            ? "queued"
            : job.status === "running"
            ? "running"
            : job.status === "failed" || job.status === "needs-attention" || job.status === "waiting-review"
              ? "attention"
              : job.status === "completed" && job.completedAt !== null && now - Date.parse(job.completedAt) <= 10_000
                ? "done"
                : null;
          if (!status) continue;
          if (status === "done" && job.completedAt !== null) nextExpiry = Math.min(nextExpiry, Date.parse(job.completedAt) + 10_000);
          for (const step of plan.steps) {
            const previous = next[step.nodeId];
            if (!previous || priority[status] > priority[previous]) next[step.nodeId] = status;
          }
        }
        setStatuses(next);
        if (Number.isFinite(nextExpiry)) expiryTimer = setTimeout(() => void refresh(), Math.max(25, nextExpiry - Date.now() + 25));
      } catch {
        if (current) setStatuses({});
      }
    };
    void refresh();
    const unsubscribe = typedQueryBridge()?.onEvent?.((event) => { if (event.name === "job.stateChanged") void refresh(); });
    return () => { current = false; if (expiryTimer !== undefined) clearTimeout(expiryTimer); unsubscribe?.(); };
  }, [documentId, graphId]);
  return statuses;
}

export const EtherCanvas = forwardRef<EtherCanvasHandle, EtherCanvasProps>(function EtherCanvas({ graph, document, onGraph, onStatus, onInspectorChange }, ref) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]); const [status, setStatus] = useState("Canvas ready"); const [activeGraph, setActiveGraph] = useState<EtherGraph | null>(null); const [parents, setParents] = useState<ParentFrame[]>([]); const [viewports, setViewports] = useState<Record<string, Viewport>>({}); const [revisionSeed, setRevisionSeed] = useState<GraphRevisionSeed | undefined>();
  const report = useCallback((message: string) => { setStatus(message); onStatus(message); }, [onStatus]);
  useEffect(() => { if (graph !== null && (activeGraph === null || activeGraph.id === graph.id)) setActiveGraph(graph); }, [activeGraph, graph]);
  useEffect(() => { setSelectedIds((ids) => ids.filter((id) => activeGraph?.nodes.some((node) => node.id === id))); }, [activeGraph]);
  const displayedGraph = activeGraph ?? graph ?? emptyCanvasGraph(document.documentId);
  const rememberViewport = useCallback((graphId: string, viewport: Viewport) => setViewports((current) => ({ ...current, [graphId]: viewport })), []);
  const enterModule = async (moduleId: string, parentGraph: EtherGraph) => {
    const module = parentGraph.modules.find((item) => item.id === moduleId); const bridge = typedQueryBridge();
    if (!module || !bridge) { report("Module navigation requires the typed application bridge."); return; }
    try { const response = await bridge.query(queryRequest("graph.snapshot", document.documentId, { graphId: module.graphId })); const child = response.payload?.graph as EtherGraph | undefined; const documentRevisionId = response.payload?.documentRevisionId as string | undefined; const graphRevisionId = response.payload?.graphRevisionId as string | undefined; if (!child || !documentRevisionId || !graphRevisionId) throw new Error("The module graph revision was unavailable."); setParents((stack) => [...stack, { graph: parentGraph, moduleId, selectedIds }]); setRevisionSeed({ graphId: child.id, documentRevisionId, graphRevisionId }); setActiveGraph(child); setSelectedIds([]); report(`Entered ${module.title}`); } catch (error) { report(error instanceof Error ? error.message : "The module could not be opened."); }
  };
  const leaveModule = () => { const parent = parents.at(-1); if (!parent) return; setParents((stack) => stack.slice(0, -1)); setActiveGraph(parent.graph); setSelectedIds(parent.selectedIds); report("Returned to parent canvas"); };
  const updateParentGraph = useCallback((nextGraph: EtherGraph) => setParents((stack) => stack.map((frame, index) => index === stack.length - 1 ? { ...frame, graph: nextGraph } : frame)), []);
  const acceptGraph = useCallback((next: EtherGraph) => { if (next.id === graph?.id) onGraph(next); setActiveGraph(next); }, [graph?.id, onGraph]);
  const parent = parents.at(-1);
  const acceptViewport = useCallback((viewport: Viewport) => rememberViewport(displayedGraph.id, viewport), [displayedGraph.id, rememberViewport]);
  return <ReactFlowProvider><CanvasInner graph={displayedGraph} viewport={viewports[displayedGraph.id]} revisionSeed={revisionSeed} parentFrame={parent} document={document} onGraph={acceptGraph} onParentGraph={updateParentGraph} status={status} report={report} selectedIds={selectedIds} setSelectedIds={setSelectedIds} onInspectorChange={onInspectorChange} onViewport={acceptViewport} onEnterModule={enterModule} onLeaveModule={parents.length > 0 ? leaveModule : undefined} ref={ref} /></ReactFlowProvider>;
});

const CanvasInner = forwardRef<EtherCanvasHandle, { graph: EtherGraph; viewport?: Viewport; revisionSeed?: GraphRevisionSeed; parentFrame?: ParentFrame; document: DocumentDescriptor; onGraph(graph: EtherGraph): void; onParentGraph(graph: EtherGraph): void; status: string; report(message: string): void; selectedIds: string[]; setSelectedIds(ids: string[]): void; onInspectorChange?(context: InspectorContext | null): void; onViewport(viewport: Viewport): void; onEnterModule(id: string, graph: EtherGraph): void; onLeaveModule?(): void; }>(function CanvasInner({ graph, viewport, revisionSeed, parentFrame, document, onGraph, onParentGraph, status, report, selectedIds, setSelectedIds, onInspectorChange, onViewport, onEnterModule, onLeaveModule }, ref) {
  const transactions = useTransactionCommands({ document, graph, revisionSeed, onGraph, onStatus: report }); const nodes = useNodeCommands(graph, transactions.apply, report); const edges = useEdgeCommands(graph, transactions.apply, report); const readOnly = document.mode !== "writable";
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const nodeStatuses = useNodeRuntimeStatuses(document.documentId, graph.id);
  const refreshGraph = useCallback(async () => {
    const bridge = typedQueryBridge();
    if (!bridge) return null;
    try {
      const response = await bridge.query(queryRequest("graph.snapshot", document.documentId, { graphId: graph.id }));
      const next = response.payload?.graph as EtherGraph | undefined;
      if (!next) throw new Error("The saved graph was unavailable.");
      onGraph(next);
      return next;
    } catch (error) {
      report(error instanceof Error ? error.message : "The saved graph could not be refreshed.");
      return null;
    }
  }, [document.documentId, graph.id, onGraph, report]);
  useEffect(() => { onInspectorChange?.(selectedEdgeId ? { graph, document, nodeId: null, edgeId: selectedEdgeId, apply: transactions.apply, refreshGraph, report } : selectedIds.length === 1 ? { graph, document, nodeId: selectedIds[0]!, edgeId: null, apply: transactions.apply, refreshGraph, report } : null); }, [document, graph, onInspectorChange, refreshGraph, report, selectedEdgeId, selectedIds, transactions.apply]);
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
  return <div className="ether-canvas" onDragOver={(event) => event.preventDefault()}><CanvasToolbar readOnly={readOnly} onPrompt={() => nodes.createNode("prompt.text")} onImage={() => nodes.createNode("generation.image")} onGroup={() => nodes.createGroup(selectedIds)} onModule={() => nodes.createModule(selectedIds)} onUndo={transactions.undo} onRedo={transactions.redo} /><CanvasSurface graph={graph} nodeStatuses={nodeStatuses} readOnly={readOnly} viewport={viewport} onMove={nodes.moveNodes} onMoveGroup={nodes.moveGroup} onMoveModule={nodes.moveModule} onResize={nodes.resizeNode} onDelete={nodes.removeNode} onTitle={nodes.rename} onConnect={edges.connect} onDeleteEdge={edges.deleteEdge} onRole={edges.setRole} onChannel={edges.setChannel} onModuleEnter={enter} onModuleToggle={toggleModule} onSelected={(ids) => { setSelectedEdgeId(null); setSelectedIds(ids); }} onEdgeSelected={(id) => { setSelectedIds([]); setSelectedEdgeId(id); }} onViewport={onViewport} /><CanvasSidePanels graph={graph} selectedIds={selectedIds} status={status} runPrompt={selectedIds.length > 1} onRunSelected={() => report("Selected run is ready for Run workspace review.")} onLeave={onLeaveModule ? leave : undefined} onExposeParameter={parentFrame ? exposeParameter : undefined} /></div>;
});
