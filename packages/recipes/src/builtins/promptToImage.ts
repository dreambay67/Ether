import { briefParameter, checkpoint, edge, graph, manifest, node, requirement } from "./shared.js";

const graphRef = "recipe.prompt-to-image";
const prompt = node("prompt", "prompt.text", "Creative brief", 54, 82, {
  kind: "prompt.text", body: "{{brief}}", assembly: "replace"
});
const image = node("image", "generation.image", "Generate image", 332, 82, {
  kind: "generation.image", providerId: "codex", profileId: "image-default", aspectRatio: "1:1", resolution: { width: 1024, height: 1024 }, outputCount: 1
});
const compare = node("compare", "review.compare", "Choose a direction", 610, 82, {
  kind: "review.compare", selectionMode: "one", minimumSelections: 1
});
const collection = node("collection", "output.collection", "First selects", 888, 82, {
  kind: "output.collection", collectionId: "first-selects", membershipMode: "add", makePrimary: true
});
const generate = requirement("image", "generate-image", ["text", "image"], ["image"], 0, 1);

export const promptToImageRecipe = manifest({
  id: "prompt-to-image",
  title: "Prompt to Image",
  description: "Turn one focused creative brief into a reviewable first image and a selects collection.",
  parameters: [briefParameter("A quiet editorial still life of cobalt glass and silver paper")],
  graph: graph(graphRef, "Prompt to Image", [prompt, image, compare, collection], [
    edge("prompt-image", "prompt", "image", "text"),
    edge("image-compare", "image", "compare", "image"),
    edge("compare-collection", "compare", "collection", "image")
  ]),
  requirements: [generate],
  checkpoints: [checkpoint(graphRef, "compare", "Approve a first direction")],
  calls: 1,
  workItems: 3,
  scenario: { id: "prompt-to-image-fake", steps: [{ kind: "success", requirementId: "image", latencyMs: 12, outputs: [{ graphRef, nodeRef: "image", channel: "image", fixtureId: "prompt-image-1", mediaType: "image/png" }] }] }
});
