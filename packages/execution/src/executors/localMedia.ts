import type { ExecutorContext, ExecutorResult, StepExecutor } from "./types.js";

export class LocalMediaExecutor implements StepExecutor {
  readonly kinds = ["mask", "transform", "deterministic", "batch", "join", "deterministic-filter"] as const;

  async execute(context: ExecutorContext): Promise<ExecutorResult> {
    if (context.step.executor === "deterministic-filter") return filter(context);
    if (context.step.executor === "batch" || context.step.executor === "join" || context.step.executor === "deterministic") {
      return {
        kind: "complete",
        outputs: context.inputs.map((input) => ({
          channel: input.channel,
          role: input.role,
          content: input.content,
          metadata: { ...input.metadata, executor: context.step.executor }
        }))
      };
    }
    const localMedia = context.providers.localMedia;
    if (localMedia === undefined) {
      throw new Error(`The ${context.step.executor} step requires the local media executor facet.`);
    }
    const operation = context.step.executor === "mask"
      ? "mask"
      : stringOperation(context.step.parameters.operation);
    const outputs = await localMedia.transform({ operation, inputs: context.inputs, parameters: context.step.parameters, signal: context.signal });
    return { kind: "complete", outputs };
  }
}

function filter(context: ExecutorContext): ExecutorResult {
  const rules = Array.isArray(context.step.parameters.rules) ? context.step.parameters.rules : [];
  const matched = context.inputs.filter((input) => rules.every((rule) => matchesRule(input.metadata, rule)));
  return {
    kind: "complete",
    outputs: [{
      channel: "data",
      role: "general",
      content: {
        kind: "object",
        value: {
          matchedPayloadIds: matched.map((input) => input.id),
          unmatchedPayloadIds: context.inputs.filter((input) => !matched.includes(input)).map((input) => input.id)
        },
        schemaId: "ether.filter-result.v1"
      },
      metadata: { ruleCount: rules.length }
    }]
  };
}

function matchesRule(metadata: Record<string, unknown>, rule: unknown): boolean {
  if (rule === null || typeof rule !== "object" || Array.isArray(rule)) return false;
  const value = rule as { field?: unknown; operator?: unknown; value?: unknown };
  if (typeof value.field !== "string" || typeof value.operator !== "string") return false;
  const actual = metadata[value.field];
  switch (value.operator) {
    case "exists": return actual !== undefined;
    case "eq": return JSON.stringify(actual) === JSON.stringify(value.value);
    case "neq": return JSON.stringify(actual) !== JSON.stringify(value.value);
    case "contains": return typeof actual === "string" && String(actual).includes(String(value.value ?? ""));
    case "gt": return typeof actual === "number" && typeof value.value === "number" && actual > value.value;
    case "gte": return typeof actual === "number" && typeof value.value === "number" && actual >= value.value;
    case "lt": return typeof actual === "number" && typeof value.value === "number" && actual < value.value;
    case "lte": return typeof actual === "number" && typeof value.value === "number" && actual <= value.value;
    default: return false;
  }
}

function stringOperation(value: unknown): "resize" | "crop" | "rotate" | "upscale" {
  return value === "crop" || value === "rotate" || value === "upscale" ? value : "resize";
}
