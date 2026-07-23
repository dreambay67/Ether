import { briefParameter, checkpoint, edge, graph, manifest, node, referenceParameter, requirement } from "./shared.js";

const graphRef = "recipe.image-edit-with-mask";
const source = node("source", "reference.set", "Source image", 54, 82, { kind: "reference.set", artifactIds: [], enabledChannels: ["image"], ordering: "manual" });
const prompt = node("prompt", "prompt.text", "Edit instruction", 54, 272, { kind: "prompt.text", body: "{{brief}}", assembly: "replace" });
const mask = node("mask", "edit.mask", "Paint mask", 332, 82, { kind: "edit.mask", mode: "manual", feather: 8 });
const edit = node("edit", "edit.image", "Apply edit", 610, 158, { kind: "edit.image", providerId: "codex", profileId: "image-edit", strength: 0.65, outputCount: 1 });
const compare = node("compare", "review.compare", "Approve edit", 888, 158, { kind: "review.compare", selectionMode: "one", minimumSelections: 1 });
const editRequirement = requirement("edit", "edit-image", ["text", "image", "mask"], ["image"]);

export const imageEditWithMaskRecipe = manifest({
  id: "image-edit-with-mask", title: "Image Edit with Mask", description: "Bring a supplied image, an explicit local mask, and a precise instruction into one immutable edit output.",
  parameters: [briefParameter("Remove the background distraction while preserving the product edge and existing light"), referenceParameter("Source image", 1)],
  graph: graph(graphRef, "Image Edit with Mask", [source, prompt, mask, edit, compare], [edge("source-mask", "source", "mask", "image"), edge("source-edit", "source", "edit", "image"), edge("mask-edit", "mask", "edit", "mask"), edge("prompt-edit", "prompt", "edit", "text"), edge("edit-compare", "edit", "compare", "image")], "source"),
  requirements: [editRequirement], checkpoints: [checkpoint(graphRef, "compare", "Approve the edited output")], calls: 1, workItems: 3,
  scenario: { id: "image-edit-with-mask-fake", steps: [{ kind: "success", requirementId: "edit", latencyMs: 14, outputs: [{ graphRef, nodeRef: "edit", channel: "image", fixtureId: "masked-edit", mediaType: "image/png" }] }] }
});
