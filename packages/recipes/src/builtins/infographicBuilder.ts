import { briefParameter, checkpoint, edge, graph, manifest, node, requirement } from "./shared.js";

const graphRef = "recipe.infographic-builder";
const prompt = node("prompt", "prompt.text", "Source brief", 54, 82, { kind: "prompt.text", body: "{{brief}}", assembly: "replace" });
const worker = node("structure", "prompt.worker", "Plan hierarchy", 332, 82, { kind: "prompt.worker", behavior: "extract", instruction: "Turn the source brief into a concise factual hierarchy, labels, and visual priorities.", profile: "balanced", model: "gpt-5", reasoningEffort: "medium", variation: 0.1, contextPolicy: { includeUpstream: true, includeDownstreamCapabilities: true, maxTokens: 3000 }, memoryPolicy: { mode: "stateless" }, outputContract: { channel: "text", count: 1, selectionPolicy: "latest" } });
const image = node("image", "generation.image", "Render infographic", 610, 82, { kind: "generation.image", providerId: "codex", profileId: "image-default", aspectRatio: "4:5", resolution: { width: 1024, height: 1280 }, outputCount: 1 });
const compare = node("compare", "review.compare", "Check legibility", 888, 82, { kind: "review.compare", selectionMode: "one", minimumSelections: 1 });
const llm = requirement("structure", "llm", ["text"], ["text"]);
const generate = requirement("image", "generate-image", ["text"], ["image"], 0, 1);

export const infographicBuilderRecipe = manifest({
  id: "infographic-builder", title: "Infographic Builder", description: "Separate factual hierarchy from rendering so an infographic is readable before it is visually polished.",
  parameters: [briefParameter("Explain the circular materials lifecycle of a refillable bottle in five clear steps")],
  graph: graph(graphRef, "Infographic Builder", [prompt, worker, image, compare], [edge("prompt-structure", "prompt", "structure", "text"), edge("structure-image", "structure", "image", "text"), edge("image-compare", "image", "compare", "image")]),
  requirements: [llm, generate], checkpoints: [checkpoint(graphRef, "compare", "Approve legibility and hierarchy")], calls: 2, workItems: 3,
  scenario: { id: "infographic-builder-fake", steps: [
    { kind: "success", requirementId: "structure", latencyMs: 4, outputs: [{ graphRef, nodeRef: "structure", channel: "text", fixtureId: "info-outline", mediaType: "text/plain" }] },
    { kind: "success", requirementId: "image", latencyMs: 12, outputs: [{ graphRef, nodeRef: "image", channel: "image", fixtureId: "info-render", mediaType: "image/png" }] }
  ] }
});
