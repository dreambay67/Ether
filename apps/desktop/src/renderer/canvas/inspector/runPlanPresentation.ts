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

export type ReferenceInputPresentation = {
  key: string;
  displayName: string | null;
  inclusion: "included" | "excluded" | null;
  role: string | null;
  channel: string | null;
  memberKind: "linked-reference" | "embedded-reference" | "embedded-artifact" | null;
  edgeId: string | null;
  sourceNodeId: string | null;
  bindingId: string | null;
  payloadId: string | null;
  referenceId: string | null;
  artifactId: string | null;
  fingerprint: {
    byteLength: number | null;
    modifiedAt: number | null;
    sampleSha256: string | null;
  } | null;
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
  referenceInputs: ReferenceInputPresentation[];
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
    referenceInputs: referenceInputsForPlan(steps.map((step) => step.compiledContext)),
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

/**
 * `compiledContext` is persisted JSON, so preview it defensively instead of
 * resolving the live Reference Set. A member appears here only when it was
 * sealed into the immutable plan by the application compiler.
 */
function referenceInputsForPlan(compiledContexts: readonly unknown[]): ReferenceInputPresentation[] {
  const candidates = compiledContexts.flatMap((compiledContext) =>
    isRecord(compiledContext) && Array.isArray(compiledContext.referenceInputs) ? compiledContext.referenceInputs : []
  );
  return candidates
    .map((candidate, index) => referenceInputPresentation(candidate, index))
    .filter((candidate): candidate is { order: number | null; index: number; presentation: ReferenceInputPresentation } => candidate !== null)
    .sort((left, right) => (left.order ?? Number.MAX_SAFE_INTEGER) - (right.order ?? Number.MAX_SAFE_INTEGER) || left.index - right.index)
    .map(({ presentation }) => presentation);
}

function referenceInputPresentation(candidate: unknown, index: number): { order: number | null; index: number; presentation: ReferenceInputPresentation } | null {
  if (!isRecord(candidate)) return null;
  const memberKind = candidate.memberKind;
  const fingerprint = isRecord(candidate.fingerprint) ? {
    byteLength: nonnegativeNumber(candidate.fingerprint.byteLength),
    modifiedAt: nonnegativeNumber(candidate.fingerprint.modifiedAt),
    sampleSha256: stringValue(candidate.fingerprint.sampleSha256)
  } : null;
  const bindingId = stringValue(candidate.id);
  const payloadId = stringValue(candidate.payloadId);
  return {
    order: nonnegativeNumber(candidate.order),
    index,
    presentation: {
      key: bindingId ?? payloadId ?? `reference-input-${index}`,
      displayName: stringValue(candidate.displayName),
      inclusion: typeof candidate.enabled === "boolean" ? candidate.enabled ? "included" : "excluded" : "included",
      role: stringValue(candidate.role),
      channel: stringValue(candidate.channel),
      memberKind: memberKind === "linked-reference" || memberKind === "embedded-reference" || memberKind === "embedded-artifact" ? memberKind : null,
      edgeId: stringValue(candidate.edgeId),
      sourceNodeId: stringValue(candidate.sourceNodeId),
      bindingId,
      payloadId,
      referenceId: stringValue(candidate.referenceId),
      artifactId: stringValue(candidate.artifactId),
      fingerprint
    }
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function nonnegativeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
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
