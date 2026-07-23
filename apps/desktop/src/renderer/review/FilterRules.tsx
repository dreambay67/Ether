import { useMemo } from "react";
import { CheckCircle2, GitBranch, XCircle } from "lucide-react";
import type { Artifact, FilterRule, JsonValue, ReviewFilterConfig } from "@ether/schema";

export type FilterRuleExplanation = {
  ruleId: string;
  field: string;
  operator: FilterRule["operator"];
  expected: JsonValue | undefined;
  actual: JsonValue | undefined;
  matched: boolean;
  text: string;
};

export type FilterRoutePreview = {
  artifact: Artifact;
  matched: boolean;
  routeIds: string[];
  routeLabels: string[];
  rules: FilterRuleExplanation[];
};

export type FilterRulesProps = {
  config: ReviewFilterConfig;
  artifacts: readonly Artifact[];
};

/** Mirrors the deterministic-filter executor. It never invokes a provider. */
export function FilterRules({ config, artifacts }: FilterRulesProps) {
  const preview = useMemo(() => previewFilterRoutes(config, artifacts), [artifacts, config]);

  return (
    <section className="filter-rules" aria-labelledby="filter-rules-title" data-testid="filter-rules">
      <header>
        <div>
          <span className="eyebrow">Deterministic routing</span>
          <h2 id="filter-rules-title"><GitBranch size={18} aria-hidden="true" /> Filter Rules</h2>
        </div>
        <strong data-testid="filter-match-mode">match:{config.match}</strong>
      </header>

      <p className="filter-rules-disclosure">Rules run in the order shown against artifact metadata. No model is called. The graph run persists routed outputs.</p>

      <ol className="filter-rule-list" aria-label={`Ordered match ${config.match} rules`}>
        {config.rules.map((rule, index) => (
          <li key={rule.id} data-testid={`filter-rule-${rule.id}`}>
            <span>{index + 1}</span>
            <code>{rule.field}</code>
            <strong>{operatorLabel(rule.operator)}</strong>
            <code>{displayValue(rule.value)}</code>
          </li>
        ))}
      </ol>
      {config.rules.length === 0 ? <p>No rules configured. match:all accepts every item; match:any accepts none.</p> : null}

      <section aria-labelledby="filter-routes-title">
        <h3 id="filter-routes-title">Routes</h3>
        <ul className="filter-route-list">
          {config.routes.map((route) => <li key={route.id}><strong>{route.label}</strong><span>{route.outcome}</span><code>{route.id}</code></li>)}
        </ul>
      </section>

      <section aria-labelledby="filter-explanations-title">
        <h3 id="filter-explanations-title">Per-item route explanations</h3>
        {preview.length === 0 ? <p>No artifacts to preview.</p> : (
          <div className="filter-route-explanations">
            {preview.map((item) => (
              <article key={item.artifact.id} data-testid={`filter-result-${item.artifact.id}`}>
                <header>
                  <div>
                    {item.matched ? <CheckCircle2 size={16} aria-hidden="true" /> : <XCircle size={16} aria-hidden="true" />}
                    <strong>{artifactTitle(item.artifact)}</strong>
                  </div>
                  <span>{item.matched ? "matched" : "unmatched"}</span>
                </header>
                <p>Route: {item.routeLabels.length > 0 ? item.routeLabels.join(", ") : "No configured route for this outcome"}</p>
                <ol>
                  {item.rules.map((rule, index) => (
                    <li key={rule.ruleId} data-matched={rule.matched ? "true" : "false"}>
                      <span>Rule {index + 1}</span>
                      <strong>{rule.matched ? "Matched" : "Did not match"}</strong>
                      <p>{rule.text}</p>
                    </li>
                  ))}
                </ol>
              </article>
            ))}
          </div>
        )}
      </section>
    </section>
  );
}

export function previewFilterRoutes(
  config: ReviewFilterConfig,
  artifacts: readonly Artifact[]
): FilterRoutePreview[] {
  return artifacts.map((artifact) => {
    const rules = config.rules.map((rule) => explainRule(artifact.metadata, rule));
    const matched = config.match === "any" ? rules.some((rule) => rule.matched) : rules.every((rule) => rule.matched);
    const routes = config.routes.filter((route) => route.outcome === (matched ? "matched" : "unmatched"));
    return {
      artifact,
      matched,
      routeIds: routes.map((route) => route.id),
      routeLabels: routes.map((route) => route.label),
      rules
    };
  });
}

function explainRule(metadata: Artifact["metadata"], rule: FilterRule): FilterRuleExplanation {
  const actual = metadata[rule.field];
  const matched = matchesValue(actual, rule.operator, rule.value);
  return {
    ruleId: rule.id,
    field: rule.field,
    operator: rule.operator,
    expected: rule.value,
    actual,
    matched,
    text: `${rule.field} ${rule.operator} ${displayValue(rule.value)}; actual ${displayValue(actual)}: ${matched ? "matched" : "did not match"}.`
  };
}

function matchesValue(actual: JsonValue | undefined, operator: FilterRule["operator"], expected: JsonValue | undefined) {
  switch (operator) {
    case "exists": return actual !== undefined;
    case "eq": return JSON.stringify(actual) === JSON.stringify(expected);
    case "neq": return JSON.stringify(actual) !== JSON.stringify(expected);
    case "contains": return typeof actual === "string" && actual.includes(String(expected ?? ""));
    case "gt": return typeof actual === "number" && typeof expected === "number" && actual > expected;
    case "gte": return typeof actual === "number" && typeof expected === "number" && actual >= expected;
    case "lt": return typeof actual === "number" && typeof expected === "number" && actual < expected;
    case "lte": return typeof actual === "number" && typeof expected === "number" && actual <= expected;
  }
}

function operatorLabel(operator: FilterRule["operator"]) {
  return ({
    eq: "equals",
    neq: "does not equal",
    gt: "greater than",
    gte: "at least",
    lt: "less than",
    lte: "at most",
    contains: "contains",
    exists: "exists"
  } as const)[operator];
}

function displayValue(value: JsonValue | undefined) {
  const encoded = JSON.stringify(value);
  return encoded === undefined ? "missing" : encoded;
}

function artifactTitle(artifact: Artifact) {
  const title = artifact.metadata.title ?? artifact.metadata.label ?? artifact.metadata.originalName;
  return typeof title === "string" && title.trim() ? title : artifact.id;
}
