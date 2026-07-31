import { useEffect, useState } from "react";
import { Play, Sparkles } from "lucide-react";
import type { EtherNode, ExecutionPlan } from "@ether/schema";
import { getNodeDefinition } from "@ether/graph-kernel";
import { documentCommand } from "./applicationRequests";
import { Help } from "./NodeSetup";
import { markPerformance, measurePerformance } from "../../performance/marks";

type PreparedPlan = { id: string; contentHash: string; estimatedCalls: number; workItems: number; providers: string[]; warnings: string[] };
type Bridge = { command(command: unknown): Promise<{ payload?: { plan?: Partial<ExecutionPlan>; permitId?: string; job?: { id?: string } } }> };
const appBridge = () => (window.ether as unknown as { application?: Bridge }).application;

export function RunControls({ node, graphId, documentId, disabled, report }: { node: EtherNode; graphId: string; documentId: string; disabled: boolean; report(message: string): void }) {
  const [preparedPlan, setPreparedPlan] = useState<PreparedPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const nodeConfigFingerprint = JSON.stringify(node.config);
  useEffect(() => { setPreparedPlan(null); }, [documentId, graphId, node.id, nodeConfigFingerprint]);
  const executor = getNodeDefinition(node.definitionId).executor;
  const action = ({
    "codex-llm": ["Generate Output", "Build the real Codex worker plan for this node."],
    "image-provider": ["Generate Image", "Build the real provider-backed image plan for this node."],
    "edit-provider": ["Generate Edit", "Build the real provider-backed edit plan for this node."],
    "codex-evaluation": ["Evaluate Outputs", "Build the real Codex evaluation plan for this node."],
    mask: ["Run Mask", "Build the deterministic mask plan for this node."],
    transform: ["Run Transform", "Build the deterministic transform plan for this node."],
    deterministic: ["Run Node", "Build the deterministic execution plan for this node."],
    "deterministic-filter": ["Run Filter", "Build the deterministic routing plan for this node."],
    batch: ["Build Batch", "Build the batch expansion plan for this node."],
    join: ["Run Join", "Build the deterministic join plan for this node."],
    collection: ["Update Collection", "Build the collection membership plan for this node."],
    export: ["Export Outputs", "Build the durable export plan for this node."]
  } as Record<string, [string, string] | undefined>)[executor];
  if (!action) return null;
  const preview = async (): Promise<PreparedPlan | null> => {
    try {
      const bridge = appBridge();
      if (!bridge) throw new Error("The typed application bridge is unavailable.");
      setBusy(true);
      markPerformance("plan-compilation:start");
      const response = await bridge.command(documentCommand("run.preview", documentId, { graphId, scope: { kind: "node", nodeId: node.id } }));
      markPerformance("plan-compilation:complete");
      measurePerformance("plan-compilation", "plan-compilation:start", "plan-compilation:complete");
      const plan = response.payload?.plan;
      if (!plan || typeof plan.id !== "string" || typeof plan.contentHash !== "string" || typeof plan.estimatedCalls !== "number") {
        report(plan && typeof plan.estimatedCalls === "number" ? `Output plan is ready: ${plan.estimatedCalls} provider call${plan.estimatedCalls === 1 ? "" : "s"}.` : "The output plan is ready for Run workspace confirmation.");
        return null;
      }
      const providers = [...new Set((plan.steps ?? []).map((step) => `${step.provider.providerId} · ${step.provider.modelId}`))];
      const prepared = {
        id: plan.id,
        contentHash: plan.contentHash,
        estimatedCalls: plan.estimatedCalls,
        workItems: plan.workItems?.length ?? 0,
        providers,
        warnings: (plan.warnings ?? []).map((warning) => warning.message)
      };
      setPreparedPlan(prepared);
      report(`Plan ready: ${prepared.estimatedCalls} provider call${prepared.estimatedCalls === 1 ? "" : "s"}. Review it, then start the exact plan.`);
      return prepared;
    } catch (error) {
      report(error instanceof Error ? error.message : "Output planning needs attention.");
      return null;
    } finally { setBusy(false); }
  };
  const start = async () => {
    if (!preparedPlan) { await preview(); return; }
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
  const output = node.config.kind === "generation.image" ? `${node.config.aspectRatio} · ${node.config.resolution.width} × ${node.config.resolution.height} · ${node.config.outputCount} output${node.config.outputCount === 1 ? "" : "s"}` : null;
  return <section className="inspector-run-controls">{preparedPlan ? <div className="inspector-prepared-plan" aria-label="Prepared plan"><strong>Prepared plan</strong><span>{preparedPlan.estimatedCalls} provider call{preparedPlan.estimatedCalls === 1 ? "" : "s"} · {preparedPlan.workItems} work item{preparedPlan.workItems === 1 ? "" : "s"}</span>{preparedPlan.providers.map((provider) => <small key={provider}>{provider}</small>)}{output ? <small>{output}</small> : null}{preparedPlan.warnings.map((warning) => <em key={warning}>{warning}</em>)}</div> : null}<button type="button" className="inspector-primary-action" disabled={disabled || busy} onClick={() => void start()} title={preparedPlan ? "Start the exact immutable plan shown by the latest preview." : action[1]}><Sparkles size={15} aria-hidden="true" />{primaryLabel}</button><button type="button" disabled={disabled || busy} onClick={() => void preview()} title="Inspect or refresh the actual execution plan without starting work."><Play size={14} aria-hidden="true" />{preparedPlan ? "Refresh plan" : "Preview plan"}</button><Help label={primaryLabel} text="The first click prepares an immutable plan. Starting it requires a second explicit click and runs exactly that reviewed plan." /></section>;
}
