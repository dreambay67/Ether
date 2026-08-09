import type { RunPlanPresentation } from "./runPlanPresentation";

export function RunPlanDetails({ plan, title = "Prepared plan" }: { plan: RunPlanPresentation; title?: string }) {
  const parallelism = plan.effectiveParallelism ?? plan.requestedParallelism;
  return <div className="run-plan-details" aria-label={title}>
    <strong>{title}</strong>
    <div className="run-plan-identity">
      <small>Plan ID · {plan.planId ?? "Unavailable"}</small>
      <small>Content hash · {plan.contentHash ?? "Unavailable"}</small>
    </div>
    <div className="run-plan-facts">
      <span>{plan.scope}</span>
      <span>{plan.stepCount} step{plan.stepCount === 1 ? "" : "s"}</span>
      <span>{plan.workItems} work item{plan.workItems === 1 ? "" : "s"}</span>
      <span>{plan.estimatedCalls} provider call{plan.estimatedCalls === 1 ? "" : "s"}</span>
      {parallelism !== null ? <span>Concurrency {parallelism}</span> : null}
    </div>
    {plan.boundaryNodeIds.length > 0 ? <small>Boundary · {plan.boundaryNodeIds.join(", ")}</small> : null}
    {plan.batchSummary ? <small>Batch · {plan.batchSummary.dimensions} dimension{plan.batchSummary.dimensions === 1 ? "" : "s"} · {plan.batchSummary.exclusions} exclusion{plan.batchSummary.exclusions === 1 ? "" : "s"} · {plan.batchSummary.workItemCount} work item{plan.batchSummary.workItemCount === 1 ? "" : "s"}</small> : null}
    {plan.providers.map((provider) => <small key={provider}>Provider · {provider}</small>)}
    {plan.adapters.map((adapter) => <small key={adapter}>Adapter · {adapter}</small>)}
    {plan.providerSettings.length > 0 ? <details aria-label="Sanitized provider settings">
      <summary>Sanitized provider settings</summary>
      <div className="run-plan-step-list">{plan.providerSettings.map((provider) => <article key={provider.stepId}>
        <strong>{provider.provider}</strong>
        <pre>{provider.settings}</pre>
      </article>)}</div>
    </details> : null}
    {plan.warnings.map((warning) => <em key={warning}>{plan.blockingWarnings.includes(warning) ? "Blocked · " : "Warning · "}{warning}</em>)}
    {plan.steps.length > 0 ? <details>
      <summary>Compiled steps and inputs</summary>
      <div className="run-plan-step-list">{plan.steps.map((step) => <article key={step.id}>
        <strong>{step.subject}</strong>
        <small>{step.executor} · {step.provider}</small>
        {step.inputs.length > 0 ? <small>Inputs · {step.inputs.join("; ")}</small> : <small>No resolved inputs</small>}
        {step.compiledPrompt.trim() ? <pre>{step.compiledPrompt}</pre> : <small>No compiled prompt text</small>}
      </article>)}</div>
    </details> : null}
    <small className="run-plan-permit-note">Starting requires a permit for this exact content hash.</small>
  </div>;
}
