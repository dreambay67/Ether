import type { EtherGraph, ExecutionPlan, ExecutionScope } from "@ether/schema";

export type RunPlanStepPresentation = {
  id: string;
  subject: string;
  executor: string;
  provider: string;
  inputs: string[];
  compiledPrompt: string;
};

export type ProviderSettingsPresentation = {
  stepId: string;
  provider: string;
  settings: string;
};

export type RunPlanPresentation = {
  planId: string | null;
  contentHash: string | null;
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
  batchSummary: { dimensions: number; exclusions: number; workItemCount: number } | null;
  providerSettings: ProviderSettingsPresentation[];
  steps: RunPlanStepPresentation[];
};

export function runPlanPresentation(plan: Partial<ExecutionPlan>): RunPlanPresentation {
  const steps = plan.steps ?? [];
  return {
    planId: typeof plan.id === "string" ? plan.id : null,
    contentHash: typeof plan.contentHash === "string" ? plan.contentHash : null,
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
    batchSummary: plan.batchSummary ?? null,
    providerSettings: steps.flatMap((step) => {
      // providerBinding: null explicitly denotes local or human work. Do not
      // fall back to the legacy provider snapshot in that case.
      const binding = step.providerBinding === null ? null : step.providerBinding ?? step.provider;
      if (!binding) return [];
      return [{
        stepId: step.id,
        provider: `${binding.providerId} · ${binding.modelId}`,
        settings: sanitizedProviderSettings(binding.settings)
      }];
    }),
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

// This deliberately excludes updatedAt. Timestamps are not revision identities;
// the rendered graph content and the supplied graph revision together form the
// preview context used to invalidate a prepared plan.
export function runPlanContextFingerprint(graph: EtherGraph): string {
  return JSON.stringify({
    id: graph.id,
    title: graph.title,
    kind: graph.kind,
    createdAt: graph.createdAt,
    nodes: graph.nodes,
    edges: graph.edges,
    groups: graph.groups,
    modules: graph.modules,
    viewState: graph.viewState
  });
}

function sanitizedProviderSettings(settings: unknown): string {
  return JSON.stringify(sanitize(settings), null, 2);
}

function sanitize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitize);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, sensitiveProviderSetting(key) ? "[redacted]" : sanitize(nested)])
  );
}

function sensitiveProviderSetting(key: string): boolean {
  return /(?:api[-_]?key|access[-_]?key|token|secret|password|credential|authorization|private[-_]?key|\bauth\b)/i.test(key);
}

function scopeLabel(scope: ExecutionScope | undefined): string {
  if (!scope) return "Prepared boundary";
  switch (scope.kind) {
    case "node": return "Node only";
    case "selected": return `Selected · ${scope.nodeIds.length} nodes`;
    case "branch": return "Branch · root and downstream";
    case "downstream": return scope.includeRoot === false ? "Downstream only" : "Downstream · including root";
    case "batch": return "Batch · expanded dimensions and downstream work";
    case "graph": return "Entire graph";
    case "recipe": return "Recipe instance";
  }
}
