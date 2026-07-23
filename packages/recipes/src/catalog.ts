import type { RecipeManifest } from "@ether/schema";
import { batchVariationsContactSheetRecipe } from "./builtins/batchVariationsContactSheet.js";
import { characterConsistencySheetRecipe } from "./builtins/characterConsistencySheet.js";
import { curateCollectExportRecipe } from "./builtins/curateCollectExport.js";
import { draftLiteFinishProRecipe } from "./builtins/draftLiteFinishPro.js";
import { evaluateAndRouteRecipe } from "./builtins/evaluateAndRoute.js";
import { imageEditWithMaskRecipe } from "./builtins/imageEditWithMask.js";
import { infographicBuilderRecipe } from "./builtins/infographicBuilder.js";
import { moodboardToVariationsRecipe } from "./builtins/moodboardToVariations.js";
import { productCampaignSetRecipe } from "./builtins/productCampaignSet.js";
import { promptToImageRecipe } from "./builtins/promptToImage.js";
import { referenceDescriptionToPromptRecipe } from "./builtins/referenceDescriptionToPrompt.js";
import { referenceGuidedImageRecipe } from "./builtins/referenceGuidedImage.js";

export const BUILTIN_RECIPES: readonly RecipeManifest[] = [
  promptToImageRecipe,
  referenceGuidedImageRecipe,
  moodboardToVariationsRecipe,
  draftLiteFinishProRecipe,
  characterConsistencySheetRecipe,
  productCampaignSetRecipe,
  infographicBuilderRecipe,
  imageEditWithMaskRecipe,
  referenceDescriptionToPromptRecipe,
  batchVariationsContactSheetRecipe,
  evaluateAndRouteRecipe,
  curateCollectExportRecipe
];

export function recipeById(id: string, version = "4.0.0"): RecipeManifest | undefined {
  return BUILTIN_RECIPES.find((recipe) => recipe.id === id && recipe.version === version);
}
