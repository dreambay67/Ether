import { useEffect, useRef, useState } from "react";
import { Play, Sparkles } from "lucide-react";
import type { EtherNode, ExecutionPlan, ExecutionScope } from "@ether/schema";
import { getNodeDefinition } from "@ether/graph-kernel";
import { documentCommand } from "./applicationRequests";
import { Help } from "./NodeSetup";
import { RunPlanDetails } from "./RunPlanDetails";
import { runPlanPresentation, type RunPlanPresentation } from "./runPlanPresentation";
import { markPerformance, measurePerformance } from "../../performance/marks";

type PreparedPlan = { id: string; contentHash: string; identity: string } & RunPlanPresentation;
type RunScopeKind = "node" | "branch" | "downstream" | "batch";
type Bridge = { command(command: unknown): Promise<{ payload?: { plan?: Partial<ExecutionPlan>; permitId?: string; job?: { id?: string } } }> };
const appBridge = () => (window.ether as unknown as { application?: Bridge }).application;

export function RunControls({ node, graphId, graphRevisionId, graphContextFingerprint, documentId, disabled, hasDownstream, report }: { node: EtherNode; graphId: string; graphRevisionId: string; graphContextFingerprint: string; documentId: string; disabled: boolean; hasDownstream: boolean; report(message: string): void }) {
  const executor = getNodeDefinition(node.definitionId).executor;
  const defaultScope: RunScopeKind = executor === "batch" ? "batch" : "node";
  const [scopeKind, setScopeKind] = useState<RunScopeKind>(defaultScope);
  const [preparedPlan, setPreparedPlan] = useState<PreparedPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const identity = `${documentId}\u001f${graphId}\u001f${graphRevisionId}\u001f${graphContextFingerprint}\u001f${node.id}\u001f${scopeKind}`;
  const identityRef = useRef(identity);
  const previewRequest = useRef(0);
  identityRef.current = identity;
  useEffect(() => { previewRequest.current += 1; setPreparedPlan(null); setBusy(false); }, [identity]);
  useEffect(() => { setScopeKind(defaultScope); }, [defaultScope, documentId, graphId, node.id]);
  useEffect(() => { if (!hasDownstream && scopeKind !== "node" && scopeKind !== "batch") setScopeKind(defaultScope); }, [defaultScope, hasDownstream, scopeKind]);
  const action = ({
    "codex-llm": ["Generate Output", "Build the real Codex worker plan for this node."],
    "image-provider": ["Generate Image", "Build the real provider-backed image plan for this node."],
    "edit-provider": ["Generate Edit", "Build the real provider-backed edit plan for this node."],
    "codex-evaluation": ["Evaluate Outputs", "Build the real Codex evaluation plan for this node."],
    mask: ["Run Mask", "Build the deterministic mask plan for this node."],
    transform: ["Run Transform", "Build the deterministic transform plan for this node."],
    deterministic: ["Run Node", "Build the deterministic execution plan for this node."],
    "deterministic-filter": ["Run Filter", "Build the deterministic routing plan for this node."],
    batch: ["Build Batch", "Build the batch expansion plan rooted at this node."],
    join: ["Run Join", "Build the deterministic join plan for this node."],
    collection: ["Update Collection", "Build the collection membership plan for this node."],
    export: ["Export Outputs", "Build the durable export plan for this node."]
  } as Record<string, [string, string] | undefined>)[executor];
  if (!action) return null;
  const scope = (): ExecutionScope => {
    switch (scopeKind) {
      case "branch": return { kind: "branch", rootNodeId: node.id };
      case "downstream": return { kind: "downstream", rootNodeId: node.id, includeRoot: false };
      case "batch": return { kind: "batch", batchNodeId: node.id };
      case "node": return { kind: "node", nodeId: node.id };
    }
  };
  const preview = async (): Promise<PreparedPlan | null> => {
    const requestId = previewRequest.current + 1;
    previewRequest.current = requestId;
    const requestIdentity = identityRef.current;
    setPreparedPlan(null);
    try {
      const bridge = appBridge();
      if (!bridge) throw new Error("The typed application bridge is unavailable.");
      setBusy(true);
      markPerformance("plan-compilation:start");
      const response = await bridge.command(documentCommand("run.preview", documentId, { graphId, scope: scope() }));
      markPerformance("plan-compilation:complete");
      measurePerformance("plan-compilation", "plan-compilation:start", "plan-compilation:complete");
      if (previewRequest.current !== requestId || identityRef.current !== requestIdentity) return null;
      const plan = response.payload?.plan;
      if (!plan || typeof plan.id !== "string" || typeof plan.contentHash !== "string" || typeof plan.estimatedCalls !== "number") {
        report(plan && typeof plan.estimatedCalls === "number" ? `Output plan is ready: ${plan.estimatedCalls} provider call${plan.estimatedCalls === 1 ? "" : "s"}.` : "The output plan is ready for Run workspace confirmation.");
        return null;
      }
      const prepared = { identity: requestIdentity, ...runPlanPresentation(plan), id: plan.id, contentHash: plan.contentHash };
      setPreparedPlan(prepared);
      report(`Plan ready: ${prepared.estimatedCalls} provider call${prepared.estimatedCalls === 1 ? "" : "s"}. Review it, then start the exact plan.`);
      return prepared;
    } catch (error) {
      if (previewRequest.current === requestId && identityRef.current === requestIdentity) {
        setPreparedPlan(null);
        report(error instanceof Error ? error.message : "Output planning needs attention.");
      }
      return null;
    } finally { if (previewRequest.current === requestId && identityRef.current === requestIdentity) setBusy(false); }
  };
  const start = async () => {
    if (!preparedPlan) { await preview(); return; }
    if (preparedPlan.identity !== identityRef.current) { setPreparedPlan(null); report("The visible run context changed. Preview the intended work again."); return; }
    try {
      const bridge = appBridge();
      if (!bridge) throw new Error("The typed application bridge is unavailable.");
      setBusy(true);
      const permitResponse = await bridge.command(documentCommand("permission.grantRun", documentId, { planId: preparedPlan.id, contentHash: preparedPlan.contentHash }));
      const permitId = permitResponse.payload?.permitId;
      if (typeof permitId !== "string") throw new Error("Ether did not issue a permit for the prepared plan.");
      const startResponse = await bridge.command(documentCommand("run.start", documentId, { planId: preparedPlan.id, contentHash: preparedPlan.contentHash, runPermitId: permitId }));
      const jobId = startResponse.payload?.job?.id;
      setPreparedPlan(null);
      report(typeof jobId === "string" ? `Run started: ${jobId}` : "Run started. Follow progress in the Run desk.");
    } catch (error) {
      setPreparedPlan(null);
      report(error instanceof Error ? error.message : "The prepared run needs attention.");
    } finally { setBusy(false); }
  };
  const calls = preparedPlan?.estimatedCalls ?? 0;
  const primaryLabel = preparedPlan ? `Start ${calls} call${calls === 1 ? "" : "s"}` : action[0];
  return <section className="inspector-run-controls">
    {executor === "batch" ? <div className="inspector-run-scope"><strong>Run scope</strong><span>Batch branch · expanded dimensions and downstream work</span></div> : hasDownstream ? <label className="inspector-run-scope">Run scope<select aria-label="Run scope" value={scopeKind} disabled={busy} onChange={(event) => { previewRequest.current += 1; setScopeKind(event.target.value as RunScopeKind); setPreparedPlan(null); setBusy(false); }}><option value="node">Node only</option><option value="branch">Branch · node and downstream</option><option value="downstream">Downstream only</option></select></label> : <div className="inspector-run-scope"><strong>Run scope</strong><span>Node only</span></div>}
    {preparedPlan ? <RunPlanDetails plan={preparedPlan} /> : null}
    <button type="button" className="inspector-primary-action" disabled={disabled || busy || (preparedPlan?.blockingWarnings.length ?? 0) > 0} onClick={() => void start()} title={preparedPlan ? "Start the exact immutable plan shown by the latest preview." : action[1]}><Sparkles size={15} aria-hidden="true" />{primaryLabel}</button>
    <button type="button" disabled={disabled || busy} onClick={() => void preview()} title="Inspect or refresh the actual execution plan without starting work."><Play size={14} aria-hidden="true" />{preparedPlan ? "Refresh plan" : "Preview plan"}</button>
    <Help label={primaryLabel} text="The first click prepares an immutable plan. Starting it requires a second explicit click and runs exactly that reviewed plan." />
  </section>;
}
