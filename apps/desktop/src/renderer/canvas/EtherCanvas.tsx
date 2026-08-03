import { forwardRef, useCallback, useEffect, useImperativeHandle, useState } from "react";
import { ReactFlowProvider, useReactFlow, type Viewport } from "@xyflow/react";
import type { EtherGraph, ExecutionJob, ExecutionPlan, GraphOperation, ModuleParameter, NodeDefinitionId, NodeLibraryItem, NodePosition } from "@ether/schema";
import type { DocumentDescriptor } from "../../shared/ipc/contracts";
import { CanvasSidePanels } from "./CanvasSidePanels";
import { CanvasSurface } from "./CanvasSurface";
import { CanvasToolbar } from "./CanvasToolbar";
import { useEdgeCommands } from "./commands/useEdgeCommands";
import { useNodeCommands } from "./commands/useNodeCommands";
import { useTransactionCommands, type GraphRevisionSeed } from "./commands/useTransactionCommands";
import { configFromPrimaryDraft, primaryEditorFor, type CanvasEditorField } from "./commands/directEditing";
import { useGraphCommands } from "./commands/useGraphCommands";
import type { InspectorContext } from "./inspector/types";
import type { NodeRuntimeStatus } from "./nodes/NodeStatusLayer";

export type EtherCanvasHandle = { addNode(definitionId: NodeDefinitionId): void; addPrompt(): void; addImage(): void; focusNode(nodeId: string): void; };
export type EtherCanvasProps = { graph: EtherGraph | null; catalog: readonly NodeLibraryItem[]; document: DocumentDescriptor; onGraph(graph: EtherGraph): void; onStatus(message: string): void; onInspectorChange?(context: InspectorContext | null): void; };
type ParentFrame = { graph: EtherGraph; moduleId: string; selectedIds: string[] };
type ApplicationQueryBridge = {
  query(query: unknown): Promise<{ payload?: Record<string, unknown> }>;
  command(command: unknown): Promise<{ payload?: Record<string, unknown> }>;
  onEvent?(listener: (event: { name?: string }) => void): () => void;
};
type PreparedSelectionPlan = { id: string; contentHash: string; estimatedCalls: number };
function emptyCanvasGraph(documentId: string): EtherGraph { return { id: `loading-${documentId}`, title: "Canvas", kind: "root", createdAt: "2026-07-22T00:00:00.000Z", updatedAt: "2026-07-22T00:00:00.000Z", nodes: [], edges: [], groups: [], modules: [], viewState: { viewport: { x: 0, y: 0, zoom: 1 }, selectedNodeIds: [], selectedEdgeIds: [], inspectorTarget: null } }; }
function typedQueryBridge() { return (window.ether as unknown as { application?: ApplicationQueryBridge }).application; }

function queryRequest(name: string, documentId: string, payload: unknown) {
  return { kind: "query", id: crypto.randomUUID(), correlationId: crypto.randomUUID(), name, documentId, payload };
}

function commandRequest(name: string, documentId: string, payload: unknown) {
  return { kind: "command", id: crypto.randomUUID(), correlationId: crypto.randomUUID(), name, documentId, payload };
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
        const candidates: Record<string, { active: boolean; at: number; status: Exclude<NodeRuntimeStatus, null> }> = {};
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
          const candidate = {
            active: status === "queued" || status === "running",
            at: Date.parse(job.startedAt ?? job.createdAt),
            status
          };
          for (const step of plan.steps) {
            const previous = candidates[step.nodeId];
            const replacesPrevious = previous === undefined ||
              (candidate.active && !previous.active) ||
              (candidate.active === previous.active && (
                candidate.at > previous.at ||
                (candidate.at === previous.at && candidate.status === "running" && previous.status === "queued")
              ));
            if (replacesPrevious) candidates[step.nodeId] = candidate;
          }
        }
        const next = Object.fromEntries(
          Object.entries(candidates).map(([nodeId, candidate]) => [nodeId, candidate.status])
        );
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

export const EtherCanvas = forwardRef<EtherCanvasHandle, EtherCanvasProps>(function EtherCanvas({ graph, catalog, document, onGraph, onStatus, onInspectorChange }, ref) {
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
  return <ReactFlowProvider><CanvasInner graph={displayedGraph} catalog={catalog} viewport={viewports[displayedGraph.id]} revisionSeed={revisionSeed} parentFrame={parent} document={document} onGraph={acceptGraph} onParentGraph={updateParentGraph} status={status} report={report} selectedIds={selectedIds} setSelectedIds={setSelectedIds} onInspectorChange={onInspectorChange} onViewport={acceptViewport} onEnterModule={enterModule} onLeaveModule={parents.length > 0 ? leaveModule : undefined} ref={ref} /></ReactFlowProvider>;
});

const CanvasInner = forwardRef<EtherCanvasHandle, { graph: EtherGraph; catalog: readonly NodeLibraryItem[]; viewport?: Viewport; revisionSeed?: GraphRevisionSeed; parentFrame?: ParentFrame; document: DocumentDescriptor; onGraph(graph: EtherGraph): void; onParentGraph(graph: EtherGraph): void; status: string; report(message: string): void; selectedIds: string[]; setSelectedIds(ids: string[]): void; onInspectorChange?(context: InspectorContext | null): void; onViewport(viewport: Viewport): void; onEnterModule(id: string, graph: EtherGraph): void; onLeaveModule?(): void; }>(function CanvasInner({ graph, catalog, viewport, revisionSeed, parentFrame, document, onGraph, onParentGraph, status, report, selectedIds, setSelectedIds, onInspectorChange, onViewport, onEnterModule, onLeaveModule }, ref) {
  const transactions = useTransactionCommands({ document, graph, revisionSeed, onGraph, onStatus: report }); const nodes = useNodeCommands(graph, catalog, transactions.apply, report); const edges = useEdgeCommands(graph, transactions.apply, report); const readOnly = document.mode !== "writable";
  const flow = useReactFlow();
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [selectedModuleId, setSelectedModuleId] = useState<string | null>(null);
  const [activeEditor, setActiveEditor] = useState<{ nodeId: string; field: CanvasEditorField } | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [preparedSelection, setPreparedSelection] = useState<PreparedSelectionPlan | null>(null);
  const [selectionBusy, setSelectionBusy] = useState(false);
  const nodeStatuses = useNodeRuntimeStatuses(document.documentId, graph.id);
  const selectionFingerprint = selectedIds.join("\u001f");
  useEffect(() => { setPreparedSelection(null); }, [document.documentId, graph.id, graph.updatedAt, selectionFingerprint]);
  useEffect(() => {
    if (activeEditor !== null && !graph.nodes.some((node) => node.id === activeEditor.nodeId)) setActiveEditor(null);
    if (selectedModuleId !== null && !graph.modules.some((module) => module.id === selectedModuleId)) setSelectedModuleId(null);
  }, [activeEditor, graph.modules, graph.nodes, selectedModuleId]);
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
  const insertionCenter = useCallback((): NodePosition => {
    const surface = globalThis.document.querySelector<HTMLElement>("[data-testid='ether-canvas-surface']");
    if (surface === null) return { x: 120 + graph.nodes.length * 28, y: 120 + graph.nodes.length * 20 };
    const bounds = surface.getBoundingClientRect();
    return openCanvasPosition(
      flow.screenToFlowPosition({ x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 }),
      [...graph.nodes, ...graph.modules]
    );
  }, [flow, graph.modules, graph.nodes]);
  const addAtCenter = useCallback((definitionId: NodeDefinitionId) => {
    if (!readOnly) void nodes.createNode(definitionId, insertionCenter());
  }, [insertionCenter, nodes, readOnly]);
  useImperativeHandle(ref, () => ({
    addNode: addAtCenter,
    addPrompt: () => addAtCenter("prompt.text"),
    addImage: () => addAtCenter("generation.image"),
    focusNode: (nodeId: string) => {
      if (graph.nodes.some((node) => node.id === nodeId)) {
        setSelectedEdgeId(null);
        setSelectedIds([nodeId]);
        window.requestAnimationFrame(() => {
          void flow.fitView({ nodes: [{ id: nodeId }], padding: 0.65, minZoom: 0.35, maxZoom: 1, duration: 240 });
        });
        report("Focused the inserted recipe node");
      }
    }
  }), [addAtCenter, flow, graph.nodes, report, setSelectedIds]);
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
  const runSelected = async () => {
    const bridge = typedQueryBridge();
    if (!bridge || selectedIds.length === 0) return;
    setSelectionBusy(true);
    try {
      if (preparedSelection === null) {
        const response = await bridge.command(commandRequest("run.preview", document.documentId, { graphId: graph.id, scope: { kind: "selected", nodeIds: selectedIds } }));
        const plan = response.payload?.plan as Partial<ExecutionPlan> | undefined;
        if (!plan || typeof plan.id !== "string" || typeof plan.contentHash !== "string" || typeof plan.estimatedCalls !== "number") throw new Error("Ether could not prepare the selected-node plan.");
        setPreparedSelection({ id: plan.id, contentHash: plan.contentHash, estimatedCalls: plan.estimatedCalls });
        report(`Selected plan ready: ${plan.estimatedCalls} provider call${plan.estimatedCalls === 1 ? "" : "s"}. Review, then start it.`);
        return;
      }
      const permit = await bridge.command(commandRequest("permission.grantRun", document.documentId, { planId: preparedSelection.id, contentHash: preparedSelection.contentHash }));
      const permitId = permit.payload?.permitId;
      if (typeof permitId !== "string") throw new Error("Ether did not issue a permit for the selected-node plan.");
      const response = await bridge.command(commandRequest("run.start", document.documentId, { planId: preparedSelection.id, contentHash: preparedSelection.contentHash, runPermitId: permitId }));
      const job = response.payload?.job as { id?: string } | undefined;
      setPreparedSelection(null);
      report(typeof job?.id === "string" ? `Selected run started: ${job.id}` : "Selected run started. Follow it in the Run desk.");
    } catch (error) {
      setPreparedSelection(null);
      report(error instanceof Error ? error.message : "The selected-node run needs attention.");
    } finally {
      setSelectionBusy(false);
    }
  };
  const beginEdit = useCallback((nodeId: string, field: CanvasEditorField) => {
    const node = graph.nodes.find((item) => item.id === nodeId);
    if (!node || readOnly) return;
    if (field === "primary" && primaryEditorFor(node) === null) { report(`${node.title} uses the Inspector for its primary configuration.`); return; }
    setSelectedEdgeId(null);
    setSelectedModuleId(null);
    setSelectedIds([nodeId]);
    setActiveEditor({ nodeId, field });
  }, [graph.nodes, readOnly, report, setSelectedIds]);
  const commitEdit = useCallback(async (nodeId: string, field: CanvasEditorField, value: string) => {
    const node = graph.nodes.find((item) => item.id === nodeId);
    if (!node || readOnly) return false;
    try {
      const saved = field === "title"
        ? await nodes.rename(nodeId, value)
        : await nodes.updateConfig(nodeId, configFromPrimaryDraft(node, value));
      if (saved) setActiveEditor(null);
      return saved;
    } catch (error) {
      report(error instanceof Error ? error.message : "The node content could not be saved.");
      return false;
    }
  }, [graph.nodes, nodes, readOnly, report]);
  const dissolveModule = useCallback(async (moduleId: string) => {
    const module = graph.modules.find((item) => item.id === moduleId);
    const bridge = typedQueryBridge();
    if (!module || !bridge || readOnly) return false;
    try {
      const response = await bridge.query(queryRequest("graph.snapshot", document.documentId, { graphId: module.graphId }));
      const child = response.payload?.graph as EtherGraph | undefined;
      const documentRevisionId = response.payload?.documentRevisionId;
      const graphRevisionId = response.payload?.graphRevisionId;
      if (!child || typeof documentRevisionId !== "string" || typeof graphRevisionId !== "string") throw new Error("The module contents were unavailable for dissolution.");
      if (child.groups.length > 0 || child.modules.length > 0) throw new Error("Enter this nested module and dissolve its inner containers first.");
      const affectedEdges = graph.edges.filter((edge) => (edge.from.kind === "module" && edge.from.moduleId === module.id) || (edge.to.kind === "module" && edge.to.moduleId === module.id));
      const rewrittenEdges = affectedEdges.map((edge) => {
        const fromPortId = edge.from.kind === "module" && edge.from.moduleId === module.id ? edge.from.portId : null;
        const toPortId = edge.to.kind === "module" && edge.to.moduleId === module.id ? edge.to.portId : null;
        const from = fromPortId !== null
          ? module.interface.outputs.find((port) => port.id === fromPortId)
          : null;
        const to = toPortId !== null
          ? module.interface.inputs.find((port) => port.id === toPortId)
          : null;
        if (fromPortId !== null && !from) throw new Error(`Module output ${fromPortId} is missing.`);
        if (toPortId !== null && !to) throw new Error(`Module input ${toPortId} is missing.`);
        return {
          ...edge,
          from: from ? { kind: "node" as const, nodeId: from.internalNodeId, channel: from.internalChannel } : edge.from,
          to: to ? { kind: "node" as const, nodeId: to.internalNodeId, channel: to.internalChannel } : edge.to
        };
      });
      const accepted = window.confirm(`Dissolve ${module.title}?\n\nRestore ${child.nodes.length} node${child.nodes.length === 1 ? "" : "s"} and ${child.edges.length + affectedEdges.length} connection${child.edges.length + affectedEdges.length === 1 ? "" : "s"} to this canvas. This is undoable.`);
      if (!accepted) { report("Module dissolution cancelled."); return false; }
      transactions.seedRevision({ graphId: child.id, documentRevisionId, graphRevisionId });
      const restoredNodes = child.nodes.map((node) => ({ ...node, position: { x: module.position.x + node.position.x, y: module.position.y + node.position.y } }));
      const operations: GraphOperation[] = [
        ...restoredNodes.map((node) => ({ type: "addNode", graphId: graph.id, node } as GraphOperation)),
        ...child.edges.map((edge) => ({ type: "addEdge", graphId: graph.id, edge } as GraphOperation)),
        ...rewrittenEdges.map((edge) => ({ type: "updateEdge", graphId: graph.id, edgeId: edge.id, edge } as GraphOperation)),
        { type: "removeModule", graphId: graph.id, moduleId: module.id }
      ];
      const saved = await transactions.apply(operations, "Dissolve module", { requiredGraphIds: [child.id] });
      if (saved) { setSelectedModuleId(null); setSelectedIds(restoredNodes.map((node) => node.id)); }
      return saved;
    } catch (error) {
      report(error instanceof Error ? error.message : "The module could not be dissolved.");
      return false;
    }
  }, [document.documentId, graph.edges, graph.id, graph.modules, readOnly, report, setSelectedIds, transactions]);
  const fitGraph = useCallback(() => {
    void flow.fitView({ padding: 0.2, minZoom: 0.1, maxZoom: 1.25, duration: 240 });
  }, [flow]);
  const commands = useGraphCommands({
    graph, readOnly, selectedNodeIds: selectedIds, selectedEdgeId, selectedModuleId,
    apply: transactions.apply, createModule: nodes.createModule, dissolveModule,
    undo: transactions.undo, redo: transactions.redo,
    onSelectNodes: (ids) => { setActiveEditor(null); setSelectedIds(ids); },
    onSelectEdge: setSelectedEdgeId,
    onSelectModule: setSelectedModuleId,
    onEdit: beginEdit,
    onRunSelected: () => void runSelected(),
    onFit: fitGraph,
    onPalette: () => setPaletteOpen(true),
    onStatus: report
  });
  const selectionCalls = preparedSelection?.estimatedCalls ?? 0;
  return <div className="ether-canvas"><CanvasToolbar commands={commands} paletteOpen={paletteOpen} onPaletteClose={() => setPaletteOpen(false)} /><CanvasSurface graph={graph} catalog={catalog} nodeStatuses={nodeStatuses} readOnly={readOnly} selectedIds={selectedIds} selectedEdgeId={selectedEdgeId} selectedModuleId={selectedModuleId} activeEditor={activeEditor} commands={commands} viewport={viewport} onAddNode={(definitionId, position) => void nodes.createNode(definitionId, openCanvasPosition(position, [...graph.nodes, ...graph.modules]))} onMove={nodes.moveNodes} onMoveGroup={nodes.moveGroup} onMoveModule={nodes.moveModule} onResize={nodes.resizeNode} onDelete={nodes.removeNode} onEditRequest={beginEdit} onEditCommit={commitEdit} onEditCancel={() => setActiveEditor(null)} onConnect={edges.connect} onDeleteEdge={edges.deleteEdge} onRole={edges.setRole} onChannel={edges.setChannel} onModuleEnter={enter} onModuleToggle={toggleModule} onSelected={(ids) => { setSelectedEdgeId(null); setSelectedModuleId(null); setSelectedIds(ids); }} onEdgeSelected={(id) => { setActiveEditor(null); setSelectedIds([]); setSelectedEdgeId(id); }} onModuleSelected={(id) => { setActiveEditor(null); setSelectedEdgeId(null); setSelectedIds([]); setSelectedModuleId(id); }} onViewport={onViewport} onCommandUnavailable={report} /><CanvasSidePanels graph={graph} selectedIds={selectedIds} status={status} runPrompt={selectedIds.length > 0} runLabel={preparedSelection ? `Start ${selectionCalls} call${selectionCalls === 1 ? "" : "s"}` : "Preview selected run"} runDetail={preparedSelection ? "The exact selected-node plan is ready." : "Prepare an exact plan before any provider work starts."} runBusy={selectionBusy} onRunSelected={() => void runSelected()} onDismissRun={() => setSelectedIds([])} onLeave={onLeaveModule ? leave : undefined} onExposeParameter={parentFrame ? exposeParameter : undefined} /></div>;
});

export function openCanvasPosition(origin: NodePosition, obstacles: readonly { position: NodePosition; size: { width: number; height: number } }[]): NodePosition {
  const horizontalStep = 260;
  const verticalStep = 180;
  for (let radius = 0; radius <= 12; radius += 1) {
    for (let row = -radius; row <= radius; row += 1) {
      for (let column = -radius; column <= radius; column += 1) {
        if (radius > 0 && Math.abs(row) !== radius && Math.abs(column) !== radius) continue;
        const candidate = { x: origin.x + column * horizontalStep, y: origin.y + row * verticalStep };
        const occupied = obstacles.some((obstacle) => candidate.x < obstacle.position.x + obstacle.size.width + 20 && candidate.x + 220 > obstacle.position.x - 20 && candidate.y < obstacle.position.y + obstacle.size.height + 20 && candidate.y + 140 > obstacle.position.y - 20);
        if (!occupied) return candidate;
      }
    }
  }
  return { x: origin.x + obstacles.length * 32, y: origin.y + obstacles.length * 24 };
}
