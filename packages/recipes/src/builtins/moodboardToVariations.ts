import { briefParameter, checkpoint, edge, graph, manifest, node, referenceParameter, requirement } from "./shared.js";

const graphRef = "recipe.moodboard-to-variations";
const references = node("moodboard", "reference.set", "Moodboard", 54, 82, { kind: "reference.set", artifactIds: [], enabledChannels: ["image"], ordering: "manual" });
const worker = node("worker", "prompt.worker", "Extract visual direction", 332, 82, { kind: "prompt.worker", behavior: "extract", instruction: "Extract a concise visual direction from the moodboard and brief: {{brief}}", profile: "balanced", model: "gpt-5", reasoningEffort: "medium", variation: 0.2, reviewPolicy: "inspect-first", contextPolicy: { includeUpstream: true, includeDownstreamCapabilities: true, maxTokens: 2400 }, memoryPolicy: { mode: "stateless" }, outputContract: { channel: "text", count: 1, selectionPolicy: "latest" } });
const image = node("image", "generation.image", "Generate variations", 610, 82, { kind: "generation.image", providerId: "codex", profileId: "image-default", aspectRatio: "1:1", resolution: { width: 1024, height: 1024 }, outputCount: 4 });
const compare = node("compare", "review.compare", "Pick a variation", 888, 82, { kind: "review.compare", selectionMode: "many", minimumSelections: 1 });
const llm = requirement("worker", "llm", ["text", "image"], ["text"], 1);
const generate = requirement("image", "generate-image", ["text"], ["image"], 0, 4);

export const moodboardToVariationsRecipe = manifest({
  id: "moodboard-to-variations", title: "Moodboard to Variations", description: "Distill a reference moodboard into an explicit visual direction and a small variation set.",
  parameters: [briefParameter("A polished editorial campaign that feels tactile, optimistic, and precise"), referenceParameter("Moodboard images")],
  graph: graph(graphRef, "Moodboard to Variations", [references, worker, image, compare], [edge("moodboard-worker", "moodboard", "worker", "image", "style"), edge("worker-image", "worker", "image", "text"), edge("image-compare", "image", "compare", "image")], "moodboard"),
  requirements: [llm, generate], checkpoints: [checkpoint(graphRef, "compare", "Choose the most promising variation")], calls: 2, workItems: 3,
  scenario: { id: "moodboard-to-variations-fake", steps: [
    { kind: "success", requirementId: "worker", latencyMs: 4, outputs: [{ graphRef, nodeRef: "worker", channel: "text", fixtureId: "moodboard-direction", mediaType: "text/plain" }] },
    { kind: "success", requirementId: "image", latencyMs: 12, outputs: [
      { graphRef, nodeRef: "image", channel: "image", fixtureId: "moodboard-variation-1", mediaType: "image/png" },
      { graphRef, nodeRef: "image", channel: "image", fixtureId: "moodboard-variation-2", mediaType: "image/png" },
      { graphRef, nodeRef: "image", channel: "image", fixtureId: "moodboard-variation-3", mediaType: "image/png" },
      { graphRef, nodeRef: "image", channel: "image", fixtureId: "moodboard-variation-4", mediaType: "image/png" }
    ] }
  ] }
});
