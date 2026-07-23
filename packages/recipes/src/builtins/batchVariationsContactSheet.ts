import { briefParameter, checkpoint, edge, graph, manifest, node, requirement } from "./shared.js";

const graphRef = "recipe.batch-variations-contact-sheet";
const prompt = node("prompt", "prompt.text", "Creative brief", 54, 82, { kind: "prompt.text", body: "{{brief}}", assembly: "replace" });
const batch = node("batch", "flow.batch", "Variation matrix", 332, 82, { kind: "flow.batch", dimensions: [{ id: "lighting", name: "Lighting", values: ["daylight", "studio", "twilight"] }, { id: "crop", name: "Crop", values: ["wide", "close"] }], parallelism: 3 });
const image = node("image", "generation.image", "Generate batch", 610, 82, { kind: "generation.image", providerId: "codex", profileId: "image-default", aspectRatio: "1:1", resolution: { width: 1024, height: 1024 }, outputCount: 1 });
const join = node("contact-sheet", "flow.join", "Assemble contact sheet", 888, 82, { kind: "flow.join", strategy: "ordered", requireComplete: true });
const compare = node("compare", "review.compare", "Review contact sheet", 1166, 82, { kind: "review.compare", selectionMode: "many", minimumSelections: 1 });
const collection = node("collection", "output.collection", "Variation selects", 1444, 82, { kind: "output.collection", collectionId: "variation-selects", membershipMode: "add", makePrimary: false });
const generate = requirement("image", "generate-image", ["text", "data"], ["image"], 0, 1);

export const batchVariationsContactSheetRecipe = manifest({
  id: "batch-variations-contact-sheet", title: "Batch Variations and Contact Sheet", description: "Expand an intentional variation matrix, rejoin the results, and make the review decision in one place.",
  parameters: [briefParameter("A minimal lamp on a mirrored plinth, controlled materials and clear product silhouette")],
  graph: graph(graphRef, "Batch Variations and Contact Sheet", [prompt, batch, image, join, compare, collection], [edge("prompt-image", "prompt", "image", "text"), edge("batch-image", "batch", "image", "data"), edge("image-contact-sheet", "image", "contact-sheet", "image"), edge("contact-sheet-compare", "contact-sheet", "compare", "image"), edge("compare-collection", "compare", "collection", "image")]),
  requirements: [generate], checkpoints: [checkpoint(graphRef, "compare", "Approve batch selects")], calls: 6, workItems: 18,
  scenario: { id: "batch-variations-contact-sheet-fake", steps: [
    { kind: "success", requirementId: "image", latencyMs: 4, outputs: [{ graphRef, nodeRef: "image", channel: "image", fixtureId: "batch-daylight-wide", mediaType: "image/png" }] },
    { kind: "success", requirementId: "image", latencyMs: 4, outputs: [{ graphRef, nodeRef: "image", channel: "image", fixtureId: "batch-daylight-close", mediaType: "image/png" }] },
    { kind: "success", requirementId: "image", latencyMs: 4, outputs: [{ graphRef, nodeRef: "image", channel: "image", fixtureId: "batch-studio-wide", mediaType: "image/png" }] },
    { kind: "success", requirementId: "image", latencyMs: 4, outputs: [{ graphRef, nodeRef: "image", channel: "image", fixtureId: "batch-studio-close", mediaType: "image/png" }] },
    { kind: "success", requirementId: "image", latencyMs: 4, outputs: [{ graphRef, nodeRef: "image", channel: "image", fixtureId: "batch-twilight-wide", mediaType: "image/png" }] },
    { kind: "success", requirementId: "image", latencyMs: 4, outputs: [{ graphRef, nodeRef: "image", channel: "image", fixtureId: "batch-twilight-close", mediaType: "image/png" }] }
  ] }
});
