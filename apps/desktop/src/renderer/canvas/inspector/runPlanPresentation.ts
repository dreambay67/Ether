import type { ExecutionPlan } from "@ether/schema";

export type RunPlanPresentation = {
  providers: string[];
  adapters: string[];
  warnings: string[];
  workItems: number;
};

export function runPlanPresentation(plan: Partial<ExecutionPlan>): RunPlanPresentation {
  const steps = plan.steps ?? [];
  return {
    providers: [...new Set(steps.map((step) => `${step.provider.providerId} · ${step.provider.modelId}`))],
    adapters: [...new Set(steps.flatMap((step) => step.subject?.kind === "adapter" ? [step.subject.adapterId] : []))],
    warnings: (plan.warnings ?? []).map((warning) => warning.message),
    workItems: plan.workItems?.length ?? 0
  };
}
