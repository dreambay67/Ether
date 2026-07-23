import { validateRecipeManifest as validateKernelRecipeManifest } from "@ether/graph-kernel";
import type { RecipeManifest } from "@ether/schema";
import type { RecipeCatalogValidation, RecipeDiagnostic } from "./types.js";

export function validateRecipe(manifest: unknown): RecipeCatalogValidation {
  const result = validateKernelRecipeManifest(manifest);
  if (!result.valid) {
    return {
      valid: false,
      diagnostics: result.diagnostics.map((diagnostic) => ({
        ...diagnostic,
        recipeId: typeof manifest === "object" && manifest !== null && "id" in manifest && typeof manifest.id === "string"
          ? manifest.id
          : undefined
      }))
    };
  }
  return { valid: true, recipes: [result.manifest], diagnostics: [] };
}

export function validateRecipeCatalog(recipes: readonly RecipeManifest[]): RecipeCatalogValidation {
  const diagnostics: RecipeDiagnostic[] = [];
  const seen = new Set<string>();
  for (const recipe of recipes) {
    const identity = `${recipe.id}@${recipe.version}`;
    if (seen.has(identity)) {
      diagnostics.push({
        code: "RECIPE_DUPLICATE_VERSION",
        message: `Recipe ${identity} is declared more than once.`,
        recipeId: recipe.id
      });
      continue;
    }
    seen.add(identity);
    const validation = validateRecipe(recipe);
    if (!validation.valid) diagnostics.push(...validation.diagnostics);
  }
  return diagnostics.length === 0
    ? { valid: true, recipes, diagnostics: [] }
    : { valid: false, diagnostics };
}
