import { useEffect, useState } from "react";
import { Bot, Play, ShieldCheck } from "lucide-react";
import type {
  ApplicationCommand,
  ArtifactDetail,
  EtherNode,
  ExecutionJob,
  ExecutionPlan,
  ReviewEvaluateConfig
} from "@ether/schema";

export type EvaluationNode = EtherNode<ReviewEvaluateConfig>;

export type EvaluationPanelProps = {
  documentId: string;
  graphId: string;
  node: EvaluationNode;
  artifactDetails?: readonly ArtifactDetail[];
  disabled?: boolean;
  onStarted?(job: ExecutionJob): void | Promise<void>;
  onStatus?(message: string): void;
};

/** Displays the exact evaluation configuration before launching the typed run contract. */
export function EvaluationPanel({
  documentId,
  graphId,
  node,
  artifactDetails = [],
  disabled = false,
  onStarted,
  onStatus
}: EvaluationPanelProps) {
  const [plan, setPlan] = useState<ExecutionPlan | null>(null);
  const [busy, setBusy] = useState<"preview" | "start" | null>(null);
  const [message, setMessage] = useState("Review the instruction and weighted rubric before asking Codex to evaluate.");
  const config = node.config;
  const configSignature = JSON.stringify(config);
  const evaluationStep = plan?.steps.find((step) => step.nodeId === node.id && step.executor === "codex-evaluation");
  const displayedInstruction = evaluationStep?.compiledPrompt ?? config.instruction;

  useEffect(() => {
    setPlan(null);
  }, [configSignature, graphId, node.id]);

  const report = (next: string) => {
    setMessage(next);
    onStatus?.(next);
  };

  const preview = async () => {
    setBusy("preview");
    setPlan(null);
    try {
      const command: ApplicationCommand = {
        kind: "command",
        id: crypto.randomUUID(),
        correlationId: crypto.randomUUID(),
        documentId,
        name: "run.preview",
        payload: { graphId, scope: { kind: "node", nodeId: node.id } }
      };
      const response = await window.ether.application.command(command);
      if (response.name !== "run.preview") throw new Error("Ether returned an unexpected evaluation preview.");
      setPlan(response.payload.plan);
      report("Evaluation plan ready. Starting it will make the displayed Codex call.");
    } catch (cause) {
      report(cause instanceof Error ? cause.message : "The evaluation plan could not be prepared.");
    } finally {
      setBusy(null);
    }
  };

  const start = async () => {
    if (plan === null) return;
    setBusy("start");
    try {
      const permitCommand: ApplicationCommand = {
        kind: "command",
        id: crypto.randomUUID(),
        correlationId: crypto.randomUUID(),
        documentId,
        name: "permission.grantRun",
        payload: { planId: plan.id, contentHash: plan.contentHash }
      };
      const permitResponse = await window.ether.application.command(permitCommand);
      if (permitResponse.name !== "permission.grantRun") throw new Error("Ether did not issue the evaluation run permit.");

      const startCommand: ApplicationCommand = {
        kind: "command",
        id: crypto.randomUUID(),
        correlationId: crypto.randomUUID(),
        documentId,
        name: "run.start",
        payload: {
          planId: plan.id,
          contentHash: plan.contentHash,
          runPermitId: permitResponse.payload.permitId
        }
      };
      const response = await window.ether.application.command(startCommand);
      if (response.name !== "run.start") throw new Error("Ether returned an unexpected evaluation start response.");
      report(`Codex evaluation queued as ${response.payload.job.id}.`);
      setPlan(null);
      await onStarted?.(response.payload.job);
    } catch (cause) {
      report(cause instanceof Error ? cause.message : "The Codex evaluation could not be started.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="evaluation-panel" aria-labelledby="evaluation-panel-title" data-testid="evaluation-panel">
      <header>
        <div>
          <span className="eyebrow">Visible model work</span>
          <h2 id="evaluation-panel-title"><Bot size={18} aria-hidden="true" /> Codex Evaluation</h2>
        </div>
        <strong>{config.profile} · {config.model}</strong>
      </header>

      <section className="evaluation-instruction" aria-labelledby="evaluation-instruction-title">
        <h3 id="evaluation-instruction-title">{plan ? "Instruction sent to Codex" : "Configured Codex instruction"}</h3>
        <pre>{displayedInstruction || "No instruction configured."}</pre>
        <small>{plan ? "This is the assembled instruction from the immutable run preview." : "Preview evaluation to reveal any assembled incoming context before the call."}</small>
      </section>

      <section aria-labelledby="evaluation-rubric-title">
        <h3 id="evaluation-rubric-title">Weighted rubric</h3>
        {config.rubric.length === 0 ? <p>No rubric criteria configured.</p> : (
          <ol className="evaluation-rubric">
            {config.rubric.map((criterion) => (
              <li key={criterion.id}>
                <strong>{criterion.label}</strong>
                <span>Weight {criterion.weight}</span>
                <small>{criterion.id}</small>
              </li>
            ))}
          </ol>
        )}
      </section>

      <dl className="evaluation-runtime">
        <div><dt>Provider route</dt><dd>Codex evaluation</dd></div>
        <div><dt>Profile</dt><dd>{config.profile}</dd></div>
        <div><dt>Model</dt><dd>{config.model}</dd></div>
        <div><dt>Reasoning</dt><dd>{config.reasoningEffort}</dd></div>
      </dl>

      {plan ? (
        <aside className="evaluation-plan" aria-label="Evaluation run preview">
          <ShieldCheck size={16} aria-hidden="true" />
          <div>
            <strong>{plan.estimatedCalls} provider call{plan.estimatedCalls === 1 ? "" : "s"}</strong>
            <span>{plan.workItems.length} work item{plan.workItems.length === 1 ? "" : "s"} · {plan.contentHash.slice(0, 22)}…</span>
          </div>
          {plan.warnings.map((warning) => <p key={`${warning.code}:${warning.nodeId ?? "graph"}`}>{warning.message}</p>)}
        </aside>
      ) : null}

      {artifactDetails.some((detail) => detail.evaluation !== null) ? (
        <section className="evaluation-provenance" aria-labelledby="evaluation-provenance-title">
          <h3 id="evaluation-provenance-title">Recorded provenance</h3>
          {artifactDetails.flatMap((detail) => detail.evaluation ? [{ artifactId: detail.artifact.id, provenance: detail.evaluation }] : []).map(({ artifactId, provenance }) => (
            <article key={artifactId}>
              <strong>{artifactId}</strong>
              <p>{provenance.summary}</p>
              <dl>
                <div><dt>Provider</dt><dd>{provenance.providerId}</dd></div>
                <div><dt>Model</dt><dd>{provenance.modelId}</dd></div>
                <div><dt>Reasoning</dt><dd>{provenance.reasoningEffort ?? "provider default"}</dd></div>
                <div><dt>Schema</dt><dd>{provenance.schemaId}</dd></div>
              </dl>
              <details><summary>Recorded instruction and rubric</summary><pre>{provenance.instruction}</pre><pre>{JSON.stringify(provenance.rubric, null, 2)}</pre></details>
            </article>
          ))}
        </section>
      ) : null}

      <footer>
        <p role="status">{message}</p>
        <div className="inspector-actions">
          <button type="button" disabled={disabled || busy !== null} onClick={() => void preview()} data-testid="evaluation-preview">
            {busy === "preview" ? "Preparing…" : "Preview evaluation"}
          </button>
          <button type="button" disabled={disabled || busy !== null || plan === null} onClick={() => void start()} data-testid="evaluation-start">
            <Play size={14} aria-hidden="true" /> {busy === "start" ? "Starting…" : "Start Codex evaluation"}
          </button>
        </div>
      </footer>
    </section>
  );
}
