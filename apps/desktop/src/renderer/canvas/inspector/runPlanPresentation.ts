import type { ExecutionPlan, ExecutionScope } from "@ether/schema";

export type RunPlanStepPresentation = {
  id: string;
  subject: string;
  executor: string;
  provider: string;
  inputs: string[];
  compiledPrompt: string;
};

export type RunPlanPresentation = {
  scope: string;
  boundaryNodeIds: string[];
  estimatedCalls: number;
  providers: string[];
  adapters: string[];
  warnings: string[];
  blockingWarnings: string[];
  workItems: number;
  stepCount: number;
  requestedParallelism: number | null;
  effectiveParallelism: number | null;
  steps: RunPlanStepPresentation[];
};

export function runPlanPresentation(plan: Partial<ExecutionPlan>): RunPlanPresentation {
  const steps = plan.steps ?? [];
  return {
    scope: scopeLabel(plan.scope),
    boundaryNodeIds: [...new Set(steps.map((step) => step.nodeId))],
    estimatedCalls: plan.estimatedCalls ?? 0,
    providers: [...new Set(steps.flatMap((step) => step.providerBinding === null ? [] : [`${step.provider.providerId} · ${step.provider.modelId}`]))],
    adapters: [...new Set(steps.flatMap((step) => step.subject?.kind === "adapter" ? [step.subject.adapterId] : []))],
    warnings: (plan.warnings ?? []).map((warning) => warning.message),
    blockingWarnings: (plan.warnings ?? []).filter((warning) => warning.blocking).map((warning) => warning.message),
    workItems: plan.workItems?.length ?? 0,
    stepCount: steps.length,
    requestedParallelism: plan.requestedParallelism ?? null,
    effectiveParallelism: plan.effectiveParallelism ?? null,
    steps: steps.map((step) => ({
      id: step.id,
      subject: step.subject?.kind === "adapter" ? `Adapter · ${step.subject.adapterId}` : `Node · ${step.nodeId}`,
      executor: step.executor,
      provider: step.providerBinding === null ? "Local / human" : `${step.provider.providerId} · ${step.provider.modelId}`,
      inputs: step.resolvedInputBindings?.map((input) => `${input.name}: ${input.payloadId}${input.selector ? ` (${input.selector})` : ""}`) ?? step.inputPayloadIds,
      compiledPrompt: step.compiledPrompt
    }))
  };
}

function scopeLabel(scope: ExecutionScope | undefined): string {
  if (!scope) return "Prepared boundary";
  switch (scope.kind) {
    case "node": return "Node only";
    case "selected": return `Selected · ${scope.nodeIds.length} nodes`;
    case "branch": return "Branch · root and downstream";
    case "downstream": return scope.includeRoot === false ? "Downstream only" : "Downstream · including root";
    case "graph": return "Entire graph";
    case "recipe": return "Recipe instance";
  }
}
