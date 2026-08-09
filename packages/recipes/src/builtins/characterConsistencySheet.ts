import { briefParameter, checkpoint, edge, graph, manifest, node, referenceParameter, requirement } from "./shared.js";

const graphRef = "recipe.character-consistency-sheet";
const references = node("character", "reference.set", "Character references", 54, 82, { kind: "reference.set", artifactIds: [], enabledChannels: ["image"], ordering: "manual" });
const prompt = node("prompt", "prompt.text", "Character brief", 54, 272, { kind: "prompt.text", body: "{{brief}}", assembly: "replace" });
const batch = node("views", "flow.batch", "Sheet views", 332, 82, { kind: "flow.batch", dimensions: [{ id: "view", name: "View", values: ["front", "three-quarter", "profile", "expression"] }], parallelism: 2 });
const image = node("image", "generation.image", "Generate sheet", 610, 82, { kind: "generation.image", providerId: "codex", profileId: "image-default", aspectRatio: "4:5", resolution: { width: 1024, height: 1280 }, outputCount: 1 });
const join = node("sheet", "flow.join", "Assemble sheet", 888, 82, { kind: "flow.join", strategy: "ordered", requireComplete: true });
const compare = node("compare", "review.compare", "Check consistency", 1166, 82, { kind: "review.compare", selectionMode: "many", minimumSelections: 1 });
const collect = node("collection", "output.collection", "Character sheet", 1444, 82, { kind: "output.collection", collectionId: "character-sheet", membershipMode: "add", makePrimary: false });
const generate = requirement("image", "generate-image", ["text", "image"], ["image"], 1, 1);

export const characterConsistencySheetRecipe = manifest({
  id: "character-consistency-sheet", title: "Character Consistency Sheet", description: "Turn approved character references into a clear multi-view sheet with a human consistency check.",
  parameters: [briefParameter("A thoughtful ceramicist in a navy work apron, warm studio light, consistent facial features"), referenceParameter("Character reference images")],
  graph: graph(graphRef, "Character Consistency Sheet", [references, prompt, batch, image, join, compare, collect], [edge("character-image", "character", "image", "image", "face"), edge("prompt-image", "prompt", "image", "text"), edge("views-image", "views", "image", "data"), { ...edge("image-sheet", "image", "sheet", "image"), selector: { kind: "all" } }, { ...edge("sheet-compare", "sheet", "compare", "image"), selector: { kind: "all" } }, edge("compare-collection", "compare", "collection", "image")], "character"),
  requirements: [generate], checkpoints: [checkpoint(graphRef, "compare", "Approve the consistent views")], calls: 4, workItems: 7,
  scenario: { id: "character-consistency-sheet-fake", steps: [
    { kind: "success", requirementId: "image", latencyMs: 5, outputs: [{ graphRef, nodeRef: "image", channel: "image", fixtureId: "character-front", mediaType: "image/png" }] },
    { kind: "success", requirementId: "image", latencyMs: 5, outputs: [{ graphRef, nodeRef: "image", channel: "image", fixtureId: "character-three-quarter", mediaType: "image/png" }] },
    { kind: "success", requirementId: "image", latencyMs: 5, outputs: [{ graphRef, nodeRef: "image", channel: "image", fixtureId: "character-profile", mediaType: "image/png" }] },
    { kind: "success", requirementId: "image", latencyMs: 5, outputs: [{ graphRef, nodeRef: "image", channel: "image", fixtureId: "character-expression", mediaType: "image/png" }] }
  ] }
});
