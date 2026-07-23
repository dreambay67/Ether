import { briefParameter, checkpoint, edge, graph, manifest, node, requirement, substitutionsFor } from "./shared.js";

const graphRef = "recipe.draft-lite-finish-pro";
const prompt = node("prompt", "prompt.text", "Creative brief", 54, 82, { kind: "prompt.text", body: "{{brief}}", assembly: "replace" });
const draft = node("draft", "generation.image", "Draft with Lite", 332, 82, { kind: "generation.image", providerId: "antigravity", profileId: "nano-banana-2", aspectRatio: "1:1", resolution: { width: 1024, height: 1024 }, outputCount: 2 });
const finish = node("finish", "edit.image", "Finish with Pro", 610, 82, { kind: "edit.image", providerId: "codex", profileId: "image-edit", strength: 0.45, outputCount: 1 });
const compare = node("compare", "review.compare", "Approve final", 888, 82, { kind: "review.compare", selectionMode: "one", minimumSelections: 1 });
const draftRequirement = requirement("draft", "generate-image", ["text"], ["image"], 0, 1);
const finishRequirement = requirement("finish", "edit-image", ["image"], ["image"], 0);
const substitutions = substitutionsFor([draftRequirement, finishRequirement]).map((item) => item.requirementId === "draft"
  ? { ...item, priority: item.providerId === "antigravity" ? 0 : 1 }
  : item);

export const draftLiteFinishProRecipe = manifest({
  id: "draft-lite-finish-pro", title: "Draft with Lite, Finish with Pro", description: "Use a low-cost draft pass to explore, then a deliberate edit pass to produce the final.",
  parameters: [briefParameter("A premium travel poster for a rain-washed coastal city at blue hour")],
  graph: graph(graphRef, "Draft with Lite, Finish with Pro", [prompt, draft, finish, compare], [edge("prompt-draft", "prompt", "draft", "text"), edge("draft-finish", "draft", "finish", "image"), edge("finish-compare", "finish", "compare", "image")]),
  requirements: [draftRequirement, finishRequirement], substitutions, checkpoints: [checkpoint(graphRef, "compare", "Approve the finished image")], calls: 2, workItems: 2,
  scenario: { id: "draft-lite-finish-pro-fake", steps: [
    { kind: "success", requirementId: "draft", latencyMs: 8, outputs: [{ graphRef, nodeRef: "draft", channel: "image", fixtureId: "lite-draft", mediaType: "image/png" }] },
    { kind: "success", requirementId: "finish", latencyMs: 10, outputs: [{ graphRef, nodeRef: "finish", channel: "image", fixtureId: "pro-final", mediaType: "image/png" }] }
  ] }
});
