import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { getViewportForBounds, ReactFlowProvider, useReactFlow, type Viewport } from "@xyflow/react";
import type { EtherGraph, EtherNode, ExecutionJob, ExecutionPlan, GraphOperation, NodeDefinitionId, NodeLibraryItem, NodePosition, ReferenceSetConfig } from "@ether/schema";
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
import { runPlanContextFingerprint, runPlanPresentation, type RunPlanPresentation } from "./inspector/runPlanPresentation";
import type { NodeRuntimeStatus } from "./nodes/NodeStatusLayer";
import { centeredCanvasPosition, openCanvasPosition } from "./placement";
import { addNodesToModuleOperations, createModuleOperations, moduleIsLocked, removeNodesFromModuleOperations } from "./modules/moduleModel";
import { moduleParameterCandidates, updateModuleParameterNode, type ModuleParameterCandidate, type ModuleParameterValue } from "./modules/moduleParameters";
import { importReferenceFilesSequentially, type CanvasReferenceDropHandler } from "./commands/useDropCommands";

export type EtherCanvasHandle = { addNode(definitionId: NodeDefinitionId): void; addPrompt(): void; addImage(): void; focusNode(nodeId: string): void; };
export type EtherCanvasProps = { graph: EtherGraph; revisionSeed: GraphRevisionSeed; catalog: readonly NodeLibraryItem[]; document: DocumentDescriptor; onGraph(graph: EtherGraph): void; onStatus(message: string): void; onInspectorChange?(context: InspectorContext | null): void; };
type ParentFrame = { graph: EtherGraph; moduleId: string; selectedIds: string[] };
type ApplicationQueryBridge = {
  query(query: unknown): Promise<{ payload?: Record<string, unknown> }>;
  command(command: unknown): Promise<{ payload?: Record<string, unknown> }>;
  onEvent?(listener: (event: { name?: string }) => void): () => void;
};
type PreparedSelectionPlan = { id: string; contentHash: string; identity: string } & RunPlanPresentation;
type ModuleParameterPicker = { candidates: readonly ModuleParameterCandidate[]; selectedId: string };
function graphContentBounds(graph: EtherGraph) {
  const items = [...graph.nodes, ...graph.modules];
  if (items.length === 0) return null;
  const left = Math.min(...items.map((item) => item.position.x));
  const top = Math.min(...items.map((item) => item.position.y));
  const right = Math.max(...items.map((item) => item.position.x + item.size.width));
  const bottom = Math.max(...items.map((item) => item.position.y + item.size.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}
function typedQueryBridge() { return (window.ether as unknown as { application?: ApplicationQueryBridge }).application; }

function queryRequest(name: string, documentId: string, payload: unknown) {
  return { kind: "query", id: crypto.randomUUID(), correlationId: crypto.randomUUID(), name, documentId, payload };
}

function commandRequest(name: string, documentId: string, payload: unknown) {
  return { kind: "command", id: crypto.randomUUID(), correlationId: crypto.randomUUID(), name, documentId, payload };
}

async function loadModuleSubtree(documentId: string, rootGraphId: string): Promise<{ graphs: EtherGraph[]; revisions: GraphRevisionSeed[] }> {
  const bridge = typedQueryBridge();
  if (!bridge) throw new Error("Module membership requires the typed application bridge.");
  const pending = [rootGraphId];
  const graphs: EtherGraph[] = [];
  const revisions: GraphRevisionSeed[] = [];
  while (pending.length > 0) {
    const graphId = pending.shift()!;
    if (graphs.some((graph) => graph.id === graphId)) continue;
    const response = await bridge.query(queryRequest("graph.snapshot", documentId, { graphId }));
    const graph = response.payload?.graph as EtherGraph | undefined;
    const documentRevisionId = response.payload?.documentRevisionId;
    const graphRevisionId = response.payload?.graphRevisionId;
    if (!graph || typeof documentRevisionId !== "string" || typeof graphRevisionId !== "string") throw new Error(`Module graph ${graphId} is unavailable.`);
    graphs.push(graph);
    revisions.push({ graphId, documentRevisionId, graphRevisionId });
    pending.push(...graph.modules.map((module) => module.graphId));
  }
  return { graphs, revisions };
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
            : job.status === "waiting-review"
              ? "review"
            : job.status === "failed" || job.status === "needs-attention"
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
    const unsubscribe = typedQueryBridge()?.onEvent?.((event) => { if (event.name === "job.stateChanged" || event.name === "workItem.stateChanged" || event.name === "attempt.stateChanged" || event.name === "plan.stateChanged") void refresh(); });
    return () => { current = false; if (expiryTimer !== undefined) clearTimeout(expiryTimer); unsubscribe?.(); };
  }, [documentId, graphId]);
  return statuses;
}

export const EtherCanvas = forwardRef<EtherCanvasHandle, EtherCanvasProps>(function EtherCanvas({ graph, revisionSeed: rootRevisionSeed, catalog, document, onGraph, onStatus, onInspectorChange }, ref) {
  const rootGraphId = rootRevisionSeed.graphId;
  const rootDocumentRevisionId = rootRevisionSeed.documentRevisionId;
  const rootGraphRevisionId = rootRevisionSeed.graphRevisionId;
  const [selectedIds, setSelectedIds] = useState<string[]>([]); const [status, setStatus] = useState("Canvas ready"); const [activeGraph, setActiveGraph] = useState<EtherGraph>(graph); const [parents, setParents] = useState<ParentFrame[]>([]); const [restoredModuleId, setRestoredModuleId] = useState<string | null>(null); const [viewports, setViewports] = useState<Record<string, Viewport>>({}); const [revisionSeed, setRevisionSeed] = useState<GraphRevisionSeed>(rootRevisionSeed);
  const activeGraphId = useRef(activeGraph.id);
  activeGraphId.current = activeGraph.id;
  const report = useCallback((message: string) => { setStatus(message); onStatus(message); }, [onStatus]);
  useEffect(() => {
    setActiveGraph((current) => current.id === graph.id ? graph : current);
  }, [graph]);
  useEffect(() => {
    if (activeGraphId.current === rootGraphId) setRevisionSeed({ graphId: rootGraphId, documentRevisionId: rootDocumentRevisionId, graphRevisionId: rootGraphRevisionId });
  }, [rootDocumentRevisionId, rootGraphId, rootGraphRevisionId]);
  useEffect(() => {
    setSelectedIds((ids) => activeGraphId.current === activeGraph.id
      ? ids.filter((id) => activeGraph.nodes.some((node) => node.id === id))
      : ids);
  }, [activeGraph]);
  const displayedGraph = activeGraph;
  const rememberViewport = useCallback((graphId: string, viewport: Viewport) => setViewports((current) => ({ ...current, [graphId]: viewport })), []);
  const enterModule = useCallback(async (moduleId: string, parentGraph: EtherGraph) => {
    const module = parentGraph.modules.find((item) => item.id === moduleId); const bridge = typedQueryBridge();
    if (!module || !bridge) { report("Module navigation requires the typed application bridge."); return; }
    try { const response = await bridge.query(queryRequest("graph.snapshot", document.documentId, { graphId: module.graphId })); const child = response.payload?.graph as EtherGraph | undefined; const documentRevisionId = response.payload?.documentRevisionId as string | undefined; const graphRevisionId = response.payload?.graphRevisionId as string | undefined; if (!child || !documentRevisionId || !graphRevisionId) throw new Error("The module graph revision was unavailable."); setParents((stack) => [...stack, { graph: parentGraph, moduleId, selectedIds }]); setRevisionSeed({ graphId: child.id, documentRevisionId, graphRevisionId }); setRestoredModuleId(null); setActiveGraph(child); setSelectedIds([]); report(`Entered ${module.title}`); } catch (error) { report(error instanceof Error ? error.message : "The module could not be opened."); }
  }, [document.documentId, report, selectedIds]);
  const leaveModule = useCallback(async () => {
    const parent = parents.at(-1);
    const bridge = typedQueryBridge();
    if (!parent || !bridge) return;
    try {
      const response = await bridge.query(queryRequest("graph.snapshot", document.documentId, { graphId: parent.graph.id }));
      const nextParent = response.payload?.graph as EtherGraph | undefined;
      const documentRevisionId = response.payload?.documentRevisionId;
      const graphRevisionId = response.payload?.graphRevisionId;
      if (!nextParent || typeof documentRevisionId !== "string" || typeof graphRevisionId !== "string") throw new Error("The parent graph revision was unavailable.");
      setParents((stack) => stack.slice(0, -1));
      setRevisionSeed({ graphId: nextParent.id, documentRevisionId, graphRevisionId });
      setRestoredModuleId(parent.moduleId);
      setActiveGraph(nextParent);
      setSelectedIds(parent.selectedIds);
      report("Returned to parent canvas");
    } catch (error) {
      report(error instanceof Error ? error.message : "The parent canvas could not be restored.");
    }
  }, [document.documentId, parents, report]);
  const updateParentGraph = useCallback((nextGraph: EtherGraph) => setParents((stack) => stack.map((frame, index) => index === stack.length - 1 ? { ...frame, graph: nextGraph } : frame)), []);
  const acceptGraph = useCallback((next: EtherGraph) => { if (next.id === graph.id) onGraph(next); setActiveGraph(next); }, [graph.id, onGraph]);
  const parent = parents.at(-1);
  const acceptViewport = useCallback((viewport: Viewport) => rememberViewport(displayedGraph.id, viewport), [displayedGraph.id, rememberViewport]);
  return <ReactFlowProvider><CanvasInner graph={displayedGraph} catalog={catalog} viewport={viewports[displayedGraph.id]} revisionSeed={revisionSeed} parentFrame={parent} restoredModuleId={restoredModuleId} document={document} onGraph={acceptGraph} onParentGraph={updateParentGraph} status={status} report={report} selectedIds={selectedIds} setSelectedIds={setSelectedIds} onInspectorChange={onInspectorChange} onViewport={acceptViewport} onEnterModule={enterModule} onLeaveModule={parents.length > 0 ? leaveModule : undefined} ref={ref} /></ReactFlowProvider>;
});

const CanvasInner = forwardRef<EtherCanvasHandle, { graph: EtherGraph; catalog: readonly NodeLibraryItem[]; viewport?: Viewport; revisionSeed?: GraphRevisionSeed; parentFrame?: ParentFrame; restoredModuleId?: string | null; document: DocumentDescriptor; onGraph(graph: EtherGraph): void; onParentGraph(graph: EtherGraph): void; status: string; report(message: string): void; selectedIds: string[]; setSelectedIds(ids: string[]): void; onInspectorChange?(context: InspectorContext | null): void; onViewport(viewport: Viewport): void; onEnterModule(id: string, graph: EtherGraph): void; onLeaveModule?(): void | Promise<void>; }>(function CanvasInner({ graph, catalog, viewport, revisionSeed, parentFrame, restoredModuleId, document, onGraph, onParentGraph, status, report, selectedIds, setSelectedIds, onInspectorChange, onViewport, onEnterModule, onLeaveModule }, ref) {
  const transactions = useTransactionCommands({ document, graph, revisionSeed, onGraph, onStatus: report });
  const { apply: applyTransaction, seedRevision, undo, redo } = transactions;
  const nodes = useNodeCommands(graph, catalog, applyTransaction, report); const edges = useEdgeCommands(graph, applyTransaction, report); const readOnly = document.mode !== "writable";
  const flow = useReactFlow();
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [selectedModuleId, setSelectedModuleId] = useState<string | null>(null);
  const [activeEditor, setActiveEditor] = useState<{ nodeId: string; field: CanvasEditorField } | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [parameterPicker, setParameterPicker] = useState<ModuleParameterPicker | null>(null);
  const [preparedSelection, setPreparedSelection] = useState<PreparedSelectionPlan | null>(null);
  const [selectionBusy, setSelectionBusy] = useState(false);
  const selectEdge = useCallback((id: string | null) => {
    setActiveEditor(null);
    if (selectedIds.length > 0) setSelectedIds([]);
    setSelectedEdgeId(id);
  }, [selectedIds.length, setSelectedIds]);
  const nodeStatuses = useNodeRuntimeStatuses(document.documentId, graph.id);
  const selectionFingerprint = selectedIds.join("\u001f");
  const graphRevisionId = revisionSeed?.graphId === graph.id ? revisionSeed.graphRevisionId : document.graphRevisionId;
  const selectionIdentity = `${document.documentId}\u001f${graph.id}\u001f${graphRevisionId}\u001f${runPlanContextFingerprint(graph)}\u001f${selectionFingerprint}`;
  const selectionIdentityRef = useRef(selectionIdentity);
  const selectionPreviewRequest = useRef(0);
  selectionIdentityRef.current = selectionIdentity;
  useEffect(() => { selectionPreviewRequest.current += 1; setPreparedSelection(null); setSelectionBusy(false); }, [selectionIdentity]);
  useEffect(() => {
    if (activeEditor !== null && !graph.nodes.some((node) => node.id === activeEditor.nodeId)) setActiveEditor(null);
    if (selectedEdgeId !== null && !graph.edges.some((edge) => edge.id === selectedEdgeId)) setSelectedEdgeId(null);
    if (selectedModuleId !== null && !graph.modules.some((module) => module.id === selectedModuleId)) setSelectedModuleId(null);
  }, [activeEditor, graph.edges, graph.modules, graph.nodes, selectedEdgeId, selectedModuleId]);
  useEffect(() => {
    if (restoredModuleId && graph.modules.some((module) => module.id === restoredModuleId)) setSelectedModuleId(restoredModuleId);
  }, [graph.id, graph.modules, restoredModuleId]);
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
  const dropReferences: CanvasReferenceDropHandler = useCallback(async (files, position, targetNodeId) => {
    if (readOnly) {
      report("This document is read-only.");
      return;
    }
    let nodeId = graph.nodes.find((node) => node.id === targetNodeId && node.config.kind === "reference.set")?.id;
    if (nodeId === undefined) {
      const definition = catalog.find((item) => item.definitionId === "reference.set");
      if (definition === undefined) {
        report("The Reference Set definition is unavailable.");
        return;
      }
      const ordinal = graph.nodes.filter((node) => node.definitionId === "reference.set").length + 1;
      const node: EtherNode<ReferenceSetConfig> = {
        id: crypto.randomUUID(),
        definitionId: "reference.set",
        title: `${definition.title} ${ordinal}`,
        position,
        size: { width: definition.presentation.width, height: definition.presentation.height },
        config: structuredClone(definition.defaultConfig) as ReferenceSetConfig,
        presentation: { collapsed: false, accent: "default", previewMode: definition.presentation.previewMode }
      };
      if (!await applyTransaction([{ type: "addNode", graphId: graph.id, node }], "Add Reference Set")) return;
      nodeId = node.id;
      report("Created a Reference Set. Linking dropped files by default; use Reference Desk to embed copies.");
    }
    const referenceSetId = nodeId;
    if (referenceSetId === undefined) return;
    const results = await importReferenceFilesSequentially(files, (file) => window.ether.references.importDropped(file, {
        documentId: document.documentId,
        graphId: graph.id,
        nodeId: referenceSetId,
        role: "general",
        storage: "link"
      }));
    const imported = results.filter((result) => !result.cancelled).length;
    await refreshGraph();
    report(`${imported} dropped reference${imported === 1 ? "" : "s"} linked to the Reference Set.`);
  }, [applyTransaction, catalog, document.documentId, graph.id, graph.nodes, readOnly, refreshGraph, report]);
  const insertionCenter = useCallback((definitionId: NodeDefinitionId): NodePosition => {
    const surface = globalThis.document.querySelector<HTMLElement>("[data-testid='ether-canvas-surface']");
    if (surface === null) return { x: 120 + graph.nodes.length * 28, y: 120 + graph.nodes.length * 20 };
    const bounds = surface.getBoundingClientRect();
    const definition = catalog.find((item) => item.definitionId === definitionId);
    const size = definition?.presentation ?? { width: 220, height: 140 };
    return openCanvasPosition(
      centeredCanvasPosition(
        flow.screenToFlowPosition({ x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 }),
        size
      ),
      [...graph.nodes, ...graph.modules],
      size
    );
  }, [catalog, flow, graph.modules, graph.nodes]);
  const addAtCenter = useCallback((definitionId: NodeDefinitionId) => {
    if (!readOnly) void nodes.createNode(definitionId, insertionCenter(definitionId));
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
  const persistViewport = useCallback(async () => { const next = viewport ?? graph.viewState.viewport; return applyTransaction([{ type: "updateGraphProperties", graphId: graph.id, viewState: { ...graph.viewState, viewport: next } }], "Save canvas viewport"); }, [applyTransaction, graph.id, graph.viewState, viewport]);
  const toggleModule = (id: string) => { if (readOnly) return; const module = graph.modules.find((item) => item.id === id); if (module) void applyTransaction([{ type: "updateModule", graphId: graph.id, moduleId: id, module: { ...module, collapsed: !module.collapsed } }], module.collapsed ? "Expand module" : "Collapse module"); };
  const enter = useCallback(async (id: string) => { if (readOnly || await persistViewport()) onEnterModule(id, graph); }, [graph, onEnterModule, persistViewport, readOnly]);
  const leave = useCallback(async () => { if (readOnly || await persistViewport()) await onLeaveModule?.(); }, [onLeaveModule, persistViewport, readOnly]);
  const exposeParameter = (nodeId: string) => {
    if (readOnly || parentFrame === undefined) return;
    const module = parentFrame.graph.modules.find((item) => item.id === parentFrame.moduleId); const node = graph.nodes.find((item) => item.id === nodeId); if (!module || !node) return;
    const candidates = moduleParameterCandidates(node).filter((parameter) => !module.interface.parameters.some((item) => item.id === parameter.id));
    if (candidates.length === 0) { report("This member has no safe editable parameter left to expose."); return; }
    setParameterPicker({ candidates, selectedId: candidates[0]!.id });
  };
  const confirmParameterExposure = () => {
    if (parameterPicker === null || parentFrame === undefined) return;
    const module = parentFrame.graph.modules.find((item) => item.id === parentFrame.moduleId);
    const parameter = parameterPicker.candidates.find((item) => item.id === parameterPicker.selectedId);
    if (!module || !parameter) { setParameterPicker(null); return; }
    const nextInterface = { ...module.interface, parameters: [...module.interface.parameters, parameter] };
    const operations: GraphOperation[] = [{ type: "updateModuleInterface", graphId: parentFrame.graph.id, moduleId: module.id, interface: nextInterface }];
    void applyTransaction(operations, "Expose module parameter").then((saved) => {
      if (saved) {
        onParentGraph({ ...parentFrame.graph, modules: parentFrame.graph.modules.map((item) => item.id === module.id ? { ...item, interface: nextInterface } : item) });
        report(`${parameter.name} is now exposed on ${module.title}.`);
      }
      setParameterPicker(null);
    });
  };
  const runSelected = async () => {
    const bridge = typedQueryBridge();
    if (!bridge || selectedIds.length === 0) return;
    const operationIdentity = selectionIdentityRef.current;
    let previewRequestId: number | null = null;
    setSelectionBusy(true);
    try {
      if (preparedSelection === null) {
        const requestId = selectionPreviewRequest.current + 1;
        selectionPreviewRequest.current = requestId;
        previewRequestId = requestId;
        setPreparedSelection(null);
        const response = await bridge.command(commandRequest("run.preview", document.documentId, { graphId: graph.id, scope: { kind: "selected", nodeIds: selectedIds } }));
        if (selectionPreviewRequest.current !== requestId || selectionIdentityRef.current !== operationIdentity) return;
        const plan = response.payload?.plan as Partial<ExecutionPlan> | undefined;
        if (!plan || typeof plan.id !== "string" || typeof plan.contentHash !== "string" || typeof plan.estimatedCalls !== "number") throw new Error("Ether could not prepare the selected-node plan.");
        setPreparedSelection({ identity: operationIdentity, ...runPlanPresentation(plan), id: plan.id, contentHash: plan.contentHash });
        report(`Selected plan ready: ${plan.estimatedCalls} provider call${plan.estimatedCalls === 1 ? "" : "s"}. Review, then start it.`);
        return;
      }
      if (preparedSelection.identity !== selectionIdentityRef.current) throw new Error("The selected run context changed. Preview the intended selection again.");
      const permit = await bridge.command(commandRequest("permission.grantRun", document.documentId, { planId: preparedSelection.id, contentHash: preparedSelection.contentHash }));
      const permitId = permit.payload?.permitId;
      if (typeof permitId !== "string") throw new Error("Ether did not issue a permit for the selected-node plan.");
      const response = await bridge.command(commandRequest("run.start", document.documentId, { planId: preparedSelection.id, contentHash: preparedSelection.contentHash, runPermitId: permitId }));
      const job = response.payload?.job as { id?: string } | undefined;
      setPreparedSelection(null);
      report(typeof job?.id === "string" ? `Selected run started: ${job.id}` : "Selected run started. Follow it in the Run desk.");
    } catch (error) {
      if (previewRequestId === null || (selectionPreviewRequest.current === previewRequestId && selectionIdentityRef.current === operationIdentity)) {
        setPreparedSelection(null);
        report(error instanceof Error ? error.message : "The selected-node run needs attention.");
      }
    } finally {
      if (previewRequestId === null || (selectionPreviewRequest.current === previewRequestId && selectionIdentityRef.current === operationIdentity)) setSelectionBusy(false);
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
    if (moduleIsLocked(module)) { report("Unlock this module before dissolving it."); return false; }
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
      seedRevision({ graphId: child.id, documentRevisionId, graphRevisionId });
      const restoredNodes = child.nodes.map((node) => ({ ...node, position: { x: module.position.x + node.position.x, y: module.position.y + node.position.y } }));
      const operations: GraphOperation[] = [
        ...restoredNodes.map((node) => ({ type: "addNode", graphId: graph.id, node } as GraphOperation)),
        ...child.edges.map((edge) => ({ type: "addEdge", graphId: graph.id, edge } as GraphOperation)),
        ...rewrittenEdges.map((edge) => ({ type: "updateEdge", graphId: graph.id, edgeId: edge.id, edge } as GraphOperation)),
        { type: "removeModule", graphId: graph.id, moduleId: module.id }
      ];
      const saved = await applyTransaction(operations, "Dissolve module", { requiredGraphIds: [child.id] });
      if (saved) { setSelectedModuleId(null); setSelectedIds(restoredNodes.map((node) => node.id)); }
      return saved;
    } catch (error) {
      report(error instanceof Error ? error.message : "The module could not be dissolved.");
      return false;
    }
  }, [applyTransaction, document.documentId, graph.edges, graph.id, graph.modules, readOnly, report, seedRevision, setSelectedIds]);
  const addSelectedToModule = useCallback(async (moduleId: string, nodeIds: readonly string[]) => {
    const module = graph.modules.find((candidate) => candidate.id === moduleId);
    if (!module || readOnly) return false;
    try {
      const loaded = await loadModuleSubtree(document.documentId, module.graphId);
      loaded.revisions.forEach(seedRevision);
      const result = addNodesToModuleOperations(graph, module, loaded.graphs, nodeIds);
      if (!result.ok) { report(result.message); return false; }
      const saved = await applyTransaction(result.operations, "Add module members", { requiredGraphIds: loaded.graphs.map((item) => item.id) });
      if (saved) setSelectedIds([]);
      return saved;
    } catch (error) {
      report(error instanceof Error ? error.message : "Module membership could not be changed.");
      return false;
    }
  }, [applyTransaction, document.documentId, graph, readOnly, report, seedRevision, setSelectedIds]);
  const removeSelectedFromModule = useCallback(async (nodeIds: readonly string[]) => {
    if (!parentFrame || readOnly) return false;
    const module = parentFrame.graph.modules.find((candidate) => candidate.id === parentFrame.moduleId);
    if (!module) return false;
    if (moduleIsLocked(module)) { report("Leave this module, unlock it, then re-enter before removing members."); return false; }
    try {
      const loaded = await loadModuleSubtree(document.documentId, module.graphId);
      loaded.revisions.forEach(seedRevision);
      const result = removeNodesFromModuleOperations(parentFrame.graph, module, loaded.graphs, nodeIds);
      if (!result.ok) { report(result.message); return false; }
      const saved = await applyTransaction(result.operations, "Move module members to parent", { requiredGraphIds: loaded.graphs.map((item) => item.id) });
      if (!saved) return false;
      setSelectedIds([]);
      const response = await typedQueryBridge()?.query(queryRequest("graph.snapshot", document.documentId, { graphId: parentFrame.graph.id }));
      const nextParent = response?.payload?.graph as EtherGraph | undefined;
      if (nextParent) onParentGraph(nextParent);
      return true;
    } catch (error) {
      report(error instanceof Error ? error.message : "Module members could not be moved to the parent canvas.");
      return false;
    }
  }, [applyTransaction, document.documentId, onParentGraph, parentFrame, readOnly, report, seedRevision, setSelectedIds]);
  const updateModuleParameter = useCallback(async (moduleId: string, parameterId: string, value: ModuleParameterValue): Promise<EtherGraph | null> => {
    if (readOnly) return null;
    const module = graph.modules.find((candidate) => candidate.id === moduleId);
    const parameter = module?.interface.parameters.find((candidate) => candidate.id === parameterId);
    const bridge = typedQueryBridge();
    if (!module || !parameter || !bridge) { report("This exposed parameter is no longer available."); return null; }
    try {
      const response = await bridge.query(queryRequest("graph.snapshot", document.documentId, { graphId: module.graphId }));
      const child = response.payload?.graph as EtherGraph | undefined;
      const documentRevisionId = response.payload?.documentRevisionId;
      const graphRevisionId = response.payload?.graphRevisionId;
      if (!child || typeof documentRevisionId !== "string" || typeof graphRevisionId !== "string") throw new Error("The module member graph revision was unavailable.");
      const node = child.nodes.find((candidate) => candidate.id === parameter.nodeId);
      if (!node) { report(`${parameter.name} no longer has a member node.`); return null; }
      const updated = updateModuleParameterNode(node, parameter, value);
      if (!updated.ok) { report(updated.message); return null; }
      seedRevision({ graphId: child.id, documentRevisionId, graphRevisionId });
      const saved = await applyTransaction([{ type: "updateNode", graphId: child.id, nodeId: node.id, node: updated.node }], `Update module parameter ${parameter.name}`);
      return saved ? { ...child, nodes: child.nodes.map((candidate) => candidate.id === node.id ? updated.node : candidate) } : null;
    } catch (error) {
      report(error instanceof Error ? error.message : "The exposed module parameter could not be saved.");
      return null;
    }
  }, [applyTransaction, document.documentId, graph.modules, readOnly, report, seedRevision]);
  const convertLegacyGroup = useCallback(async (groupId: string) => {
    const group = graph.groups.find((candidate) => candidate.id === groupId);
    if (!group || readOnly) return false;
    const uniqueNodeIds = [...new Set(group.nodeIds)];
    const missing = uniqueNodeIds.filter((nodeId) => !graph.nodes.some((node) => node.id === nodeId));
    const overlap = graph.groups.find((candidate) => candidate.id !== group.id && candidate.nodeIds.some((nodeId) => uniqueNodeIds.includes(nodeId)));
    if (uniqueNodeIds.length === 0 || missing.length > 0 || overlap !== undefined) {
      report(missing.length > 0
        ? `Repair preview: ${group.title} references ${missing.length} missing node${missing.length === 1 ? "" : "s"}. No change was made.`
        : overlap !== undefined
          ? `Repair preview: ${group.title} overlaps ${overlap.title}. Separate their membership before conversion; no change was made.`
          : `Repair preview: ${group.title} has no members. No change was made.`);
      return false;
    }
    const preview = createModuleOperations(graph, uniqueNodeIds, { title: group.title, accent: group.color, removeGroupId: group.id });
    if (preview === null) { report(`Repair preview: ${group.title} cannot be converted without losing content. No change was made.`); return false; }
    const accepted = window.confirm(`Convert ${group.title} to a locked Module?\n\n${uniqueNodeIds.length} member${uniqueNodeIds.length === 1 ? "" : "s"}, connections, and positions will be preserved in one undoable transaction.`);
    if (!accepted) { report("Group conversion cancelled; no change was made."); return false; }
    const saved = await applyTransaction(preview.operations, "Convert group to locked module");
    if (saved) { setSelectedIds([]); setSelectedModuleId(preview.module.id); }
    return saved;
  }, [applyTransaction, graph, readOnly, report, setSelectedIds]);
  useEffect(() => {
    const base = { graph, document, selectedNodeIds: selectedIds, apply: applyTransaction, refreshGraph, report, enterModule: (moduleId: string) => void enter(moduleId), dissolveModule, addSelectedToModule, updateModuleParameter };
    onInspectorChange?.(selectedModuleId
      ? { ...base, nodeId: null, edgeId: null, moduleId: selectedModuleId }
      : selectedEdgeId
        ? { ...base, nodeId: null, edgeId: selectedEdgeId, moduleId: null }
        : selectedIds.length === 1
          ? { ...base, nodeId: selectedIds[0]!, edgeId: null, moduleId: null }
          : null);
  }, [addSelectedToModule, applyTransaction, dissolveModule, document, enter, graph, onInspectorChange, refreshGraph, report, selectedEdgeId, selectedIds, selectedModuleId, updateModuleParameter]);
  const fitGraph = useCallback(() => {
    const content = graphContentBounds(graph);
    if (content === null) return;
    const surface = globalThis.document.querySelector<HTMLElement>("[data-testid='ether-canvas-surface']");
    const frame = surface?.getBoundingClientRect();
    if (frame === undefined || frame.width <= 0 || frame.height <= 0) return;
    const next = getViewportForBounds(content, frame.width, frame.height, 0.1, 1.25, {
      top: "86px", right: "42px", bottom: "42px", left: "42px"
    });
    // Chromium throttles animation frames and viewport transitions for background windows.
    // Home must still fit the graph immediately and deterministically.
    void flow.setViewport(next, { duration: 0 });
  }, [flow, graph]);
  const commands = useGraphCommands({
    graph, readOnly, selectedNodeIds: selectedIds, selectedEdgeId, selectedModuleId,
    apply: applyTransaction, createModule: nodes.createModule, dissolveModule,
    undo, redo,
    onSelectNodes: (ids) => { setActiveEditor(null); setSelectedIds(ids); },
    onSelectEdge: setSelectedEdgeId,
    onSelectModule: setSelectedModuleId,
    onEdit: beginEdit,
    onRenameModule: () => globalThis.requestAnimationFrame(() => globalThis.document.querySelector<HTMLInputElement>('input[aria-label="Module title"]')?.focus()),
    onEnterModule: (moduleId) => void enter(moduleId),
    onRunSelected: () => void runSelected(),
    onFit: fitGraph,
    onPalette: () => setPaletteOpen(true),
    onStatus: report
  });
  const selectionCalls = preparedSelection?.estimatedCalls ?? 0;
  const moduleTitle = parentFrame?.graph.modules.find((module) => module.id === parentFrame.moduleId)?.title;
  return <div className="ether-canvas"><CanvasToolbar commands={commands} paletteOpen={paletteOpen} onPaletteClose={() => setPaletteOpen(false)} /><CanvasSurface graph={graph} catalog={catalog} nodeStatuses={nodeStatuses} readOnly={readOnly} selectedIds={selectedIds} selectedEdgeId={selectedEdgeId} selectedModuleId={selectedModuleId} activeEditor={activeEditor} commands={commands} viewport={viewport} onAddNode={(definitionId, position) => { const size = catalog.find((item) => item.definitionId === definitionId)?.presentation ?? { width: 220, height: 140 }; void nodes.createNode(definitionId, openCanvasPosition(position, [...graph.nodes, ...graph.modules], size)); }} onReferenceDrop={dropReferences} onMove={nodes.moveNodes} onMoveModule={nodes.moveModule} onResize={nodes.resizeNode} onDelete={nodes.removeNode} onEditRequest={beginEdit} onEditCommit={commitEdit} onEditCancel={() => setActiveEditor(null)} onConnect={edges.connect} onDeleteEdge={edges.deleteEdge} onRole={edges.setRole} onChannel={edges.setChannel} onModuleEnter={enter} onModuleToggle={toggleModule} onSelected={(ids) => { setSelectedEdgeId(null); setSelectedModuleId(null); setSelectedIds(ids); }} onEdgeSelected={selectEdge} onModuleSelected={(id, additive) => { setActiveEditor(null); setSelectedEdgeId(null); setSelectedIds(additive ? [...selectedIds] : []); setSelectedModuleId(id); }} onViewport={onViewport} onCommandUnavailable={report} /><CanvasSidePanels graph={graph} title={moduleTitle} selectedIds={selectedIds} status={status} runPrompt={selectedIds.length > 0 && selectedModuleId === null} runLabel={preparedSelection ? `Start ${selectionCalls} call${selectionCalls === 1 ? "" : "s"}` : "Preview selected run"} runPlan={preparedSelection} runBusy={selectionBusy} onRunSelected={() => void runSelected()} onDismissRun={() => setSelectedIds([])} onLeave={onLeaveModule ? leave : undefined} onExposeParameter={parentFrame ? exposeParameter : undefined} onRemoveFromModule={parentFrame ? (nodeIds) => void removeSelectedFromModule(nodeIds) : undefined} onConvertGroup={readOnly ? undefined : (groupId) => void convertLegacyGroup(groupId)} />{parameterPicker ? <aside className="canvas-parameter-picker" aria-label="Expose module parameter"><strong>Expose member parameter</strong><label>Parameter<select aria-label="Module parameter" value={parameterPicker.selectedId} onChange={(event) => setParameterPicker((current) => current === null ? null : { ...current, selectedId: event.target.value })}>{parameterPicker.candidates.map((parameter) => <option key={parameter.id} value={parameter.id}>{parameter.name} · {parameter.exposure.control === "select" ? "choice" : parameter.exposure.valueType}</option>)}</select></label><small>Only registry-declared scalar settings are available. Provider bindings, grants, artifacts, and managed workspaces stay private.</small><div><button type="button" onClick={confirmParameterExposure}>Expose parameter</button><button type="button" onClick={() => setParameterPicker(null)}>Cancel</button></div></aside> : null}</div>;
});
