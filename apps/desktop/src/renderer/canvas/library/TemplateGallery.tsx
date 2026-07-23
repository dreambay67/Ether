import { useEffect, useMemo, useState } from "react";
import type { GraphTransaction, JsonValue, RecipeManifest, RecipeParameter, RecipeParameterValue } from "@ether/schema";

export type RecipeSetupRequest = {
  recipeId: string;
  version: string;
  parameters: readonly RecipeParameterValue[];
};

type RecipePreview = { transaction: GraphTransaction; warnings: readonly string[] };

type TemplateGalleryProps = {
  recipes: readonly RecipeManifest[];
  readOnly?: boolean;
  onLoadSetup(recipeId: string, version: string): Promise<readonly RecipeParameter[]>;
  onPreviewRecipe(request: RecipeSetupRequest): Promise<RecipePreview>;
  onInstantiateRecipe(request: RecipeSetupRequest): Promise<void>;
};

function defaultValue(parameter: RecipeParameter): JsonValue {
  switch (parameter.type) {
    case "string": return parameter.defaultValue ?? "";
    case "number": return parameter.defaultValue;
    case "boolean": return parameter.defaultValue ?? false;
    case "choice": return parameter.options.find((option) => option.id === parameter.defaultOptionId)?.value ?? parameter.options[0]?.value ?? "";
    case "artifact": return [];
  }
}

function valuesFor(parameters: readonly RecipeParameter[]): Record<string, JsonValue> {
  return Object.fromEntries(parameters.map((parameter) => [parameter.id, defaultValue(parameter)]));
}

function requestFor(recipe: RecipeManifest, parameters: readonly RecipeParameter[], values: Readonly<Record<string, JsonValue>>): RecipeSetupRequest {
  return {
    recipeId: recipe.id,
    version: recipe.version,
    parameters: parameters.map((parameter) => ({ parameterId: parameter.id, value: values[parameter.id] ?? defaultValue(parameter) }))
  };
}

function parameterReady(parameter: RecipeParameter, value: JsonValue | undefined): boolean {
  if (!parameter.required && value === undefined) return true;
  switch (parameter.type) {
    case "string": return typeof value === "string" && value.length >= parameter.minLength && value.length <= parameter.maxLength;
    case "number": return typeof value === "number" && Number.isFinite(value) && value >= parameter.minimum && value <= parameter.maximum;
    case "boolean": return typeof value === "boolean";
    case "choice": return parameter.options.some((option) => Object.is(option.value, value));
    case "artifact": return Array.isArray(value) && value.length >= parameter.minimumItems && value.length <= parameter.maximumItems;
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string") return error.message;
  return "The recipe backend did not complete this request.";
}

export function TemplateGallery({ recipes, readOnly = false, onLoadSetup, onPreviewRecipe, onInstantiateRecipe }: TemplateGalleryProps) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [parameters, setParameters] = useState<readonly RecipeParameter[]>([]);
  const [values, setValues] = useState<Record<string, JsonValue>>({});
  const [busy, setBusy] = useState<"setup" | "preview" | "insert" | null>(null);
  const [status, setStatus] = useState("Choose a recipe to inspect its setup.");
  const selected = useMemo(() => recipes.find((recipe) => `${recipe.id}@${recipe.version}` === selectedKey) ?? null, [recipes, selectedKey]);
  const ready = selected !== null && busy === null && parameters.length > 0 && parameters.every((parameter) => parameterReady(parameter, values[parameter.id]));

  useEffect(() => {
    if (selectedKey !== null && !recipes.some((recipe) => `${recipe.id}@${recipe.version}` === selectedKey)) {
      setSelectedKey(null);
      setParameters([]);
      setValues({});
    }
  }, [recipes, selectedKey]);

  const choose = async (recipe: RecipeManifest) => {
    setSelectedKey(`${recipe.id}@${recipe.version}`);
    setParameters([]);
    setValues({});
    setBusy("setup");
    setStatus(`Loading ${recipe.title} setup…`);
    try {
      const setup = await onLoadSetup(recipe.id, recipe.version);
      setParameters(setup);
      setValues(valuesFor(setup));
      setStatus(`${recipe.title} setup is ready.`);
    } catch (error) {
      setParameters([]);
      setValues({});
      setStatus(`Blocked: ${errorMessage(error)}`);
    } finally {
      setBusy(null);
    }
  };

  const preview = async () => {
    if (selected === null || !ready) return;
    setBusy("preview");
    setStatus(`Checking ${selected.title} against this document and its providers…`);
    try {
      const result = await onPreviewRecipe(requestFor(selected, parameters, values));
      setStatus(result.warnings.length === 0 ? "Preview ready. The graph will be inserted as one change." : `Preview ready. ${result.warnings.join(" ")}`);
    } catch (error) {
      setStatus(`Blocked: ${errorMessage(error)}`);
    } finally {
      setBusy(null);
    }
  };

  const insert = async () => {
    if (selected === null || !ready || readOnly) return;
    setBusy("insert");
    setStatus(`Inserting ${selected.title} as one graph change…`);
    try {
      await onInstantiateRecipe(requestFor(selected, parameters, values));
      setStatus(`${selected.title} inserted. Its focus node is selected on the canvas.`);
    } catch (error) {
      setStatus(`Blocked: ${errorMessage(error)}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="template-gallery" data-testid="recipe-gallery" aria-label="Recipe Gallery">
      <header className="template-gallery-header">
        <span>Graph starters</span>
        <strong>Recipe Gallery</strong>
        <small>{recipes.length} versioned workflows</small>
      </header>
      <div className="template-gallery-list">
        {recipes.map((recipe) => (
          <button
            key={`${recipe.id}@${recipe.version}`}
            type="button"
            className="template-gallery-item"
            aria-pressed={selectedKey === `${recipe.id}@${recipe.version}`}
            onClick={() => void choose(recipe)}
            data-testid={`recipe-card-${recipe.id}`}
          >
            <span>{recipe.capabilityRequirements.map((requirement) => requirement.operation).join(" + ") || "local graph"}</span>
            <strong>{recipe.title}</strong>
            <small>{recipe.description}</small>
            <em>{recipe.expectedWork.minimumCalls}–{recipe.expectedWork.maximumCalls} calls · {recipe.expectedWork.minimumWorkItems}–{recipe.expectedWork.maximumWorkItems} work items</em>
          </button>
        ))}
      </div>
      {selected !== null ? (
        <form className="recipe-setup-sheet" aria-label={`${selected.title} setup`} data-testid="recipe-setup-sheet" onSubmit={(event) => { event.preventDefault(); void insert(); }}>
          <div>
            <span>Setup</span>
            <strong>{selected.title}</strong>
          </div>
          {parameters.map((parameter) => (
            <label key={parameter.id} className={`recipe-field recipe-field-${parameter.type}`}>
              <span>{parameter.title}{parameter.required ? " *" : ""}</span>
              <small>{parameter.description}</small>
              {parameter.type === "string" ? (
                <textarea value={typeof values[parameter.id] === "string" ? values[parameter.id] as string : ""} minLength={parameter.minLength} maxLength={parameter.maxLength} onChange={(event) => setValues((current) => ({ ...current, [parameter.id]: event.target.value }))} />
              ) : parameter.type === "number" ? (
                <input type="number" value={typeof values[parameter.id] === "number" ? values[parameter.id] as number : parameter.minimum} min={parameter.minimum} max={parameter.maximum} step={parameter.step} onChange={(event) => setValues((current) => ({ ...current, [parameter.id]: event.target.valueAsNumber }))} />
              ) : parameter.type === "boolean" ? (
                <input type="checkbox" checked={values[parameter.id] === true} onChange={(event) => setValues((current) => ({ ...current, [parameter.id]: event.target.checked }))} />
              ) : parameter.type === "choice" ? (
                <select value={parameter.options.find((option) => Object.is(option.value, values[parameter.id]))?.id ?? ""} onChange={(event) => setValues((current) => ({ ...current, [parameter.id]: parameter.options.find((option) => option.id === event.target.value)?.value ?? "" }))}>
                  {parameter.options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                </select>
              ) : (
                <input
                  type="text"
                  value={Array.isArray(values[parameter.id]) ? (values[parameter.id] as JsonValue[]).filter((item): item is string => typeof item === "string").join(", ") : ""}
                  placeholder={parameter.maximumItems === 1 ? "Artifact ID" : "Artifact IDs, comma separated"}
                  onChange={(event) => setValues((current) => ({ ...current, [parameter.id]: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) }))}
                />
              )}
            </label>
          ))}
          <div className="recipe-setup-actions">
            <button type="button" disabled={!ready} onClick={() => void preview()}>Preview</button>
            <button type="submit" disabled={!ready || readOnly}>{busy === "insert" ? "Inserting…" : "Insert recipe"}</button>
          </div>
        </form>
      ) : null}
      <p className="recipe-gallery-status" aria-live="polite" data-testid="recipe-gallery-status">{status}</p>
    </section>
  );
}
