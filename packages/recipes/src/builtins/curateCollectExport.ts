import { checkpoint, edge, graph, manifest, node, referenceParameter, requirement } from "./shared.js";

const graphRef = "recipe.curate-collect-export";
const inputs = node("inputs", "reference.set", "Candidate artifacts", 54, 82, { kind: "reference.set", artifactIds: [], enabledChannels: ["image"], ordering: "created" });
const compare = node("compare", "review.compare", "Curate candidates", 332, 82, { kind: "review.compare", selectionMode: "many", minimumSelections: 1 });
const evaluate = node("evaluate", "review.evaluate", "Quality check", 610, 82, { kind: "review.evaluate", instruction: "Explain whether candidates are ready for delivery and flag visible defects.", rubric: [{ id: "quality", label: "Quality", weight: 1 }], profile: "balanced", model: "gpt-5", reasoningEffort: "medium" });
const filter = node("filter", "review.filter", "Keep approved", 888, 82, { kind: "review.filter", match: "all", rules: [{ id: "approved", field: "approval", operator: "eq", value: "approved" }], routes: [{ id: "approved", label: "Approved", outcome: "matched" }, { id: "hold", label: "Hold", outcome: "unmatched" }] });
const collection = node("collection", "output.collection", "Delivery collection", 1166, 82, { kind: "output.collection", collectionId: "delivery", membershipMode: "add", makePrimary: true });
const exportNode = node("export", "output.export", "Prepare export", 1444, 82, { kind: "output.export", pathGrantId: "export-folder", namingTemplate: "{collection}-{index}", format: "original", collisionPolicy: "rename", includeMetadata: true });
const llm = requirement("evaluate", "llm", ["image", "data"], ["data"], 1);

export const curateCollectExportRecipe = manifest({
  id: "curate-collect-export", title: "Curate, Collect, and Export", description: "Curate delivery candidates, route them into a durable collection, and prepare an explicit export without hidden files.",
  parameters: [referenceParameter("Candidate artifacts")],
  graph: graph(graphRef, "Curate, Collect, and Export", [inputs, compare, evaluate, filter, collection, exportNode], [edge("inputs-compare", "inputs", "compare", "image"), edge("compare-evaluate", "compare", "evaluate", "image"), edge("evaluate-filter", "evaluate", "filter", "data"), edge("filter-collection", "filter", "collection", "data"), edge("collection-export", "collection", "export", "image")], "inputs"),
  requirements: [llm], checkpoints: [checkpoint(graphRef, "compare", "Approve delivery candidates")], calls: 1, workItems: 1,
  scenario: { id: "curate-collect-export-fake", steps: [{ kind: "success", requirementId: "evaluate", latencyMs: 8, outputs: [{ graphRef, nodeRef: "evaluate", channel: "data", fixtureId: "delivery-evaluation", mediaType: "application/json" }] }] }
});
