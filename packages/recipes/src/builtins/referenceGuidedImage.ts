import { briefParameter, checkpoint, edge, graph, manifest, node, referenceParameter, requirement } from "./shared.js";

const graphRef = "recipe.reference-guided-image";
const references = node("references", "reference.set", "Reference images", 54, 82, { kind: "reference.set", artifactIds: [], enabledChannels: ["image"], ordering: "manual" });
const prompt = node("prompt", "prompt.text", "Creative brief", 54, 272, { kind: "prompt.text", body: "{{brief}}", assembly: "replace" });
const image = node("image", "generation.image", "Guided image", 354, 158, { kind: "generation.image", providerId: "codex", profileId: "image-default", aspectRatio: "4:5", resolution: { width: 1024, height: 1280 }, outputCount: 1 });
const compare = node("compare", "review.compare", "Reference fidelity", 650, 158, { kind: "review.compare", selectionMode: "one", minimumSelections: 1 });
const generate = requirement("image", "generate-image", ["text", "image"], ["image"], 1, 1);

export const referenceGuidedImageRecipe = manifest({
  id: "reference-guided-image",
  title: "Reference-Guided Image",
  description: "Keep an image generation grounded in a required set of visual references.",
  parameters: [briefParameter("An elevated product portrait with the supplied material and lighting cues"), referenceParameter()],
  graph: graph(graphRef, "Reference-Guided Image", [references, prompt, image, compare], [
    edge("references-image", "references", "image", "image", "style"), edge("prompt-image", "prompt", "image", "text"), edge("image-compare", "image", "compare", "image")
  ], "references"),
  requirements: [generate], checkpoints: [checkpoint(graphRef, "compare", "Approve reference fidelity")], calls: 1, workItems: 1,
  scenario: { id: "reference-guided-image-fake", steps: [{ kind: "success", requirementId: "image", latencyMs: 12, outputs: [{ graphRef, nodeRef: "image", channel: "image", fixtureId: "guided-image-1", mediaType: "image/png" }] }] }
});
