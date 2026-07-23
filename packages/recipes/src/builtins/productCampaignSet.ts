import { briefParameter, checkpoint, edge, graph, manifest, node, referenceParameter, requirement } from "./shared.js";

const graphRef = "recipe.product-campaign-set";
const references = node("product", "reference.set", "Product references", 54, 82, { kind: "reference.set", artifactIds: [], enabledChannels: ["image"], ordering: "manual" });
const prompt = node("prompt", "prompt.text", "Campaign brief", 54, 272, { kind: "prompt.text", body: "{{brief}}", assembly: "replace" });
const batch = node("formats", "flow.batch", "Campaign formats", 332, 82, { kind: "flow.batch", dimensions: [{ id: "format", name: "Format", values: ["hero", "detail", "social", "editorial"] }], parallelism: 2 });
const image = node("image", "generation.image", "Produce campaign images", 610, 82, { kind: "generation.image", providerId: "codex", profileId: "image-default", aspectRatio: "4:5", resolution: { width: 1024, height: 1280 }, outputCount: 1 });
const compare = node("compare", "review.compare", "Select campaign set", 888, 82, { kind: "review.compare", selectionMode: "many", minimumSelections: 2 });
const collection = node("collection", "output.collection", "Campaign selects", 1166, 82, { kind: "output.collection", collectionId: "campaign-selects", membershipMode: "add", makePrimary: true });
const generate = requirement("image", "generate-image", ["text", "image", "data"], ["image"], 1, 1);

export const productCampaignSetRecipe = manifest({
  id: "product-campaign-set", title: "Product Campaign Set", description: "Build a coherent, reviewable campaign set across hero, detail, social, and editorial formats.",
  parameters: [briefParameter("A launch campaign for a sculptural refillable fragrance bottle, cool stone and reflected water"), referenceParameter("Product reference images")],
  graph: graph(graphRef, "Product Campaign Set", [references, prompt, batch, image, compare, collection], [edge("product-image", "product", "image", "image", "product"), edge("prompt-image", "prompt", "image", "text"), edge("formats-image", "formats", "image", "data"), edge("image-compare", "image", "compare", "image"), edge("compare-collection", "compare", "collection", "image")], "product"),
  requirements: [generate], checkpoints: [checkpoint(graphRef, "compare", "Approve the campaign set")], calls: 4, workItems: 4,
  scenario: { id: "product-campaign-set-fake", steps: [
    { kind: "success", requirementId: "image", latencyMs: 5, outputs: [{ graphRef, nodeRef: "image", channel: "image", fixtureId: "campaign-hero", mediaType: "image/png" }] },
    { kind: "success", requirementId: "image", latencyMs: 5, outputs: [{ graphRef, nodeRef: "image", channel: "image", fixtureId: "campaign-detail", mediaType: "image/png" }] },
    { kind: "success", requirementId: "image", latencyMs: 5, outputs: [{ graphRef, nodeRef: "image", channel: "image", fixtureId: "campaign-social", mediaType: "image/png" }] },
    { kind: "success", requirementId: "image", latencyMs: 5, outputs: [{ graphRef, nodeRef: "image", channel: "image", fixtureId: "campaign-editorial", mediaType: "image/png" }] }
  ] }
});
