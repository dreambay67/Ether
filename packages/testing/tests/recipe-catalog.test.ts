import { describe, expect, it } from "vitest";
import { BUILTIN_RECIPES, validateRecipeCatalog } from "../../recipes/src/index.js";

const normativeIds = [
  "prompt-to-image",
  "reference-guided-image",
  "moodboard-to-variations",
  "draft-lite-finish-pro",
  "character-consistency-sheet",
  "product-campaign-set",
  "infographic-builder",
  "image-edit-with-mask",
  "reference-description-to-prompt",
  "batch-variations-contact-sheet",
  "evaluate-and-route",
  "curate-collect-export"
];

describe("Ether 4.0 executable recipe catalog", () => {
  it("ships the twelve normative versioned recipes with valid typed graphs", () => {
    expect(BUILTIN_RECIPES.map((recipe) => recipe.id)).toEqual(normativeIds);
    expect(BUILTIN_RECIPES.every((recipe) => recipe.version === "4.0.0")).toBe(true);
    expect(validateRecipeCatalog(BUILTIN_RECIPES)).toMatchObject({ valid: true, diagnostics: [] });
  });

  it("gives every recipe an honest setup and fake-provider acceptance contract", () => {
    for (const recipe of BUILTIN_RECIPES) {
      expect(recipe.parameters.length).toBeGreaterThan(0);
      expect(recipe.graph.nodes.length).toBeGreaterThan(0);
      expect(recipe.graph.edges.length).toBeGreaterThan(0);
      expect(recipe.graph.groups).toHaveLength(1);
      expect(recipe.layout.focusNodeRef).toBeTruthy();
      expect(recipe.expectedWork.minimumCalls).toBeGreaterThan(0);
      expect(recipe.acceptanceScenario.steps.length).toBeGreaterThanOrEqual(recipe.capabilityRequirements.length);
      expect(recipe.acceptanceScenario.steps.length).toBe(recipe.expectedWork.maximumCalls);
      expect(recipe.substitutions).toHaveLength(recipe.capabilityRequirements.length * 2);
      for (const requirement of recipe.capabilityRequirements) {
        expect([recipe.graph, ...recipe.moduleGraphs].some((graph) => graph.nodes.some((node) => node.id === requirement.id)), `${recipe.id}:${requirement.id}`).toBe(true);
        expect(recipe.substitutions.some((item) => item.requirementId === requirement.id && item.priority === 0)).toBe(true);
        expect(recipe.substitutions.some((item) => item.requirementId === requirement.id && item.priority === 1)).toBe(true);
      }
    }
  });

  it("keeps single-source edit and Lite-to-Pro routing explicit", () => {
    const imageEdit = BUILTIN_RECIPES.find((recipe) => recipe.id === "image-edit-with-mask")!;
    expect(imageEdit.parameters.find((parameter) => parameter.id === "references")).toMatchObject({ type: "artifact", minimumItems: 1, maximumItems: 1 });
    const draft = BUILTIN_RECIPES.find((recipe) => recipe.id === "draft-lite-finish-pro")!;
    expect(draft.substitutions.find((item) => item.requirementId === "draft" && item.priority === 0)).toMatchObject({ providerId: "antigravity", profileId: "nano-banana-2" });
    expect(draft.substitutions.find((item) => item.requirementId === "finish" && item.priority === 0)).toMatchObject({ providerId: "codex", profileId: "image-edit" });
  });
});
