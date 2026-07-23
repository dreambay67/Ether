import { briefParameter, edge, graph, manifest, node, referenceParameter, requirement } from "./shared.js";

const graphRef = "recipe.reference-description-to-prompt";
const references = node("references", "reference.set", "Reference images", 54, 82, { kind: "reference.set", artifactIds: [], enabledChannels: ["image"], ordering: "manual" });
const worker = node("describe", "prompt.worker", "Describe visual language", 332, 82, { kind: "prompt.worker", behavior: "extract", instruction: "Describe the visual language of the supplied reference images, then shape it for this goal: {{brief}}", profile: "balanced", model: "gpt-5", reasoningEffort: "medium", variation: 0.15, contextPolicy: { includeUpstream: true, includeDownstreamCapabilities: false, maxTokens: 2600 }, memoryPolicy: { mode: "stateless" }, outputContract: { channel: "text", count: 1, selectionPolicy: "latest" } });
const prompt = node("prompt", "prompt.text", "Ready-to-use prompt", 610, 82, { kind: "prompt.text", body: "Use the extracted visual direction as the production prompt.", assembly: "replace" });
const llm = requirement("describe", "llm", ["text", "image"], ["text"], 1);

export const referenceDescriptionToPromptRecipe = manifest({
  id: "reference-description-to-prompt", title: "Reference Description to Prompt", description: "Extract the useful visual language from references into an editable, provider-ready text prompt.",
  parameters: [briefParameter("Create a concise prompt for an editorial portrait using this visual language"), referenceParameter()],
  graph: graph(graphRef, "Reference Description to Prompt", [references, worker, prompt], [edge("references-describe", "references", "describe", "image", "style"), edge("describe-prompt", "describe", "prompt", "text")], "references"),
  requirements: [llm], calls: 1, workItems: 1,
  scenario: { id: "reference-description-to-prompt-fake", steps: [{ kind: "success", requirementId: "describe", latencyMs: 5, outputs: [{ graphRef, nodeRef: "describe", channel: "text", fixtureId: "reference-prompt", mediaType: "text/plain" }] }] }
});
