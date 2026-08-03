import { checkpoint, edge, graph, manifest, node, referenceParameter, requirement } from "./shared.js";

const graphRef = "recipe.evaluate-and-route";
const inputs = node("inputs", "reference.set", "Artifacts to review", 54, 82, { kind: "reference.set", artifactIds: [], enabledChannels: ["image"], ordering: "created" });
const compare = node("compare", "review.compare", "Human compare", 332, 82, { kind: "review.compare", selectionMode: "many", minimumSelections: 1 });
const evaluate = node("evaluate", "review.evaluate", "Evaluate quality", 610, 82, { kind: "review.evaluate", instruction: "Score fidelity, composition, and production readiness.", rubric: [{ id: "fidelity", label: "Reference fidelity", weight: 1 }, { id: "readiness", label: "Production readiness", weight: 1 }], profile: "balanced", model: "gpt-5", reasoningEffort: "medium" });
const filter = node("filter", "review.filter", "Route decisions", 888, 82, { kind: "review.filter", match: "all", rules: [{ id: "approved", field: "approval", operator: "eq", value: "approved" }], routes: [{ id: "selects", label: "Selects", outcome: "matched" }, { id: "rework", label: "Needs rework", outcome: "unmatched" }] });
const selects = node("selects", "output.collection", "Selects", 1166, 36, { kind: "output.collection", collectionId: "selects", membershipMode: "add", makePrimary: true });
const rework = node("rework", "output.collection", "Needs rework", 1166, 210, { kind: "output.collection", collectionId: "needs-rework", membershipMode: "add", makePrimary: false });
const llm = requirement("evaluate", "evaluate", ["image", "data"], ["data"], 1);

export const evaluateAndRouteRecipe = manifest({
  id: "evaluate-and-route", title: "Evaluate and Route", description: "Pair a visible human comparison with transparent evaluation rules and non-destructive collection routes.",
  parameters: [referenceParameter("Artifacts to evaluate")],
  graph: graph(graphRef, "Evaluate and Route", [inputs, compare, evaluate, filter, selects, rework], [edge("inputs-compare", "inputs", "compare", "image"), edge("compare-evaluate", "compare", "evaluate", "image"), edge("evaluate-filter", "evaluate", "filter", "data"), edge("filter-selects", "filter", "selects", "data"), edge("filter-rework", "filter", "rework", "data", "negative")], "inputs"),
  requirements: [llm], checkpoints: [checkpoint(graphRef, "compare", "Confirm the candidate set")], calls: 1, workItems: 5,
  scenario: { id: "evaluate-and-route-fake", steps: [{ kind: "success", requirementId: "evaluate", latencyMs: 8, outputs: [{ graphRef, nodeRef: "evaluate", channel: "data", fixtureId: "evaluation-data", mediaType: "application/json" }] }] }
});
