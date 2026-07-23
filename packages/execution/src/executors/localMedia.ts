import type { ExecutorContext, ExecutorResult, StepExecutor } from "./types.js";
import { jsonValue } from "./input.js";

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
  const mode = context.step.parameters.match === "any" ? "any" : "all";
  const routes = Array.isArray(context.step.parameters.routes) ? context.step.parameters.routes : [];
  const items = context.inputs.map((input) => {
    const explanations = rules.map((rule, index) => explainRule(input.metadata, rule, index));
    const matched = mode === "any" ? explanations.some((rule) => rule.matched) : explanations.every((rule) => rule.matched);
    const routeIds = routes.flatMap((route, index) => {
      if (route === null || typeof route !== "object" || Array.isArray(route)) return [];
      const value = route as { id?: unknown; outcome?: unknown };
      const outcome = value.outcome === "unmatched" ? "unmatched" : "matched";
      return matched === (outcome === "matched") ? [typeof value.id === "string" ? value.id : `route-${index + 1}`] : [];
    });
    return { input, matched, routeIds, explanations };
  });
  return {
    kind: "complete",
    outputs: [{
      channel: "data",
      role: "general",
      content: {
        kind: "object",
        value: jsonValue({
          match: mode,
          matchedPayloadIds: items.filter((item) => item.matched).map((item) => item.input.id),
          unmatchedPayloadIds: items.filter((item) => !item.matched).map((item) => item.input.id),
          items: items.map((item) => ({ payloadId: item.input.id, matched: item.matched, routeIds: item.routeIds, rules: item.explanations }))
        }),
        schemaId: "ether.filter-result.v1"
      },
      metadata: { ruleCount: rules.length, match: mode }
    }, ...items.map((item) => ({
      channel: item.input.channel,
      role: item.input.role,
      content: item.input.content,
      metadata: {
        ...item.input.metadata,
        filterMatched: item.matched,
        filterRouteIds: item.routeIds,
        filterExplanations: item.explanations
      }
    }))]
  };
}

function explainRule(metadata: Record<string, unknown>, rule: unknown, index: number) {
  if (rule === null || typeof rule !== "object" || Array.isArray(rule)) {
    return { ruleId: `rule-${index + 1}`, field: "", operator: "invalid", matched: false, explanation: "Rule is not an object." };
  }
  const value = rule as { field?: unknown; operator?: unknown; value?: unknown };
  const ruleId = typeof (rule as { id?: unknown }).id === "string" ? String((rule as { id?: unknown }).id) : `rule-${index + 1}`;
  if (typeof value.field !== "string" || typeof value.operator !== "string") {
    return { ruleId, field: "", operator: "invalid", matched: false, explanation: "Rule needs a field and operator." };
  }
  const actual = metadata[value.field];
  const matched = matchesValue(actual, value.operator, value.value);
  return {
    ruleId,
    field: value.field,
    operator: value.operator,
    matched,
    explanation: `${value.field} ${value.operator} ${displayValue(value.value)}; actual ${displayValue(actual)}: ${matched ? "matched" : "did not match"}.`
  };
}

function matchesValue(actual: unknown, operator: string, expected: unknown): boolean {
  switch (operator) {
    case "exists": return actual !== undefined;
    case "eq": return JSON.stringify(actual) === JSON.stringify(expected);
    case "neq": return JSON.stringify(actual) !== JSON.stringify(expected);
    case "contains": return typeof actual === "string" && actual.includes(String(expected ?? ""));
    case "gt": return typeof actual === "number" && typeof expected === "number" && actual > expected;
    case "gte": return typeof actual === "number" && typeof expected === "number" && actual >= expected;
    case "lt": return typeof actual === "number" && typeof expected === "number" && actual < expected;
    case "lte": return typeof actual === "number" && typeof expected === "number" && actual <= expected;
    default: return false;
  }
}

function displayValue(value: unknown): string {
  const encoded = JSON.stringify(value);
  return encoded === undefined ? "missing" : encoded;
}

function stringOperation(value: unknown): "resize" | "crop" | "rotate" | "upscale" {
  return value === "crop" || value === "rotate" || value === "upscale" ? value : "resize";
}
