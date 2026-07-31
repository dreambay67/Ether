import { useEffect, useMemo, useRef, useState } from "react";
import type { GraphTransaction, JsonValue, RecipeManifest, RecipeParameter, RecipeParameterValue } from "@ether/schema";

export type RecipeSetupRequest = {
  recipeId: string;
  version: string;
  parameters: readonly RecipeParameterValue[];
};

export type RecipeCapabilitySetup = {
  requirementId: string;
  operation: RecipeManifest["capabilityRequirements"][number]["operation"];
  inputChannels: RecipeManifest["capabilityRequirements"][number]["inputChannels"];
  outputChannels: RecipeManifest["capabilityRequirements"][number]["outputChannels"];
  state: "primary" | "substitution" | "compatible" | "missing";
  selectedProviderId: string | null;
  selectedProfileId: string | null;
  options: readonly {
    providerId: string;
    profileId: string;
    priority: number;
    available: boolean;
  }[];
};

export type RecipeSetup = {
  parameters: readonly RecipeParameter[];
  capabilities: readonly RecipeCapabilitySetup[];
};

type RecipePreview = { transaction: GraphTransaction; warnings: readonly string[] };

type TemplateGalleryProps = {
  recipes: readonly RecipeManifest[];
  readOnly?: boolean;
  onLoadSetup(recipeId: string, version: string): Promise<RecipeSetup>;
  onPreviewRecipe(request: RecipeSetupRequest): Promise<RecipePreview>;
  onInstantiateRecipe(request: RecipeSetupRequest): Promise<void>;
  onInserted?(): void;
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

function capabilityStateLabel(state: RecipeCapabilitySetup["state"]): string {
  switch (state) {
    case "primary": return "Primary ready";
    case "substitution": return "Substitution ready";
    case "compatible": return "Compatible provider";
    case "missing": return "Provider missing";
  }
}

export function TemplateGallery({ recipes, readOnly = false, onLoadSetup, onPreviewRecipe, onInstantiateRecipe, onInserted }: TemplateGalleryProps) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [parameters, setParameters] = useState<readonly RecipeParameter[]>([]);
  const [capabilities, setCapabilities] = useState<readonly RecipeCapabilitySetup[]>([]);
  const [values, setValues] = useState<Record<string, JsonValue>>({});
  const [busy, setBusy] = useState<"setup" | "preview" | "insert" | null>(null);
  const [status, setStatus] = useState("Choose a recipe to inspect its setup.");
  const setupRequest = useRef(0);
  const selected = useMemo(() => recipes.find((recipe) => `${recipe.id}@${recipe.version}` === selectedKey) ?? null, [recipes, selectedKey]);
  const ready = selected !== null
    && busy === null
    && parameters.length > 0
    && parameters.every((parameter) => parameterReady(parameter, values[parameter.id]))
    && capabilities.every((capability) => capability.state !== "missing");

  useEffect(() => {
    if (selectedKey !== null && !recipes.some((recipe) => `${recipe.id}@${recipe.version}` === selectedKey)) {
      setSelectedKey(null);
      setParameters([]);
      setCapabilities([]);
      setValues({});
    }
  }, [recipes, selectedKey]);

  const choose = async (recipe: RecipeManifest) => {
    const requestId = ++setupRequest.current;
    setSelectedKey(`${recipe.id}@${recipe.version}`);
    setParameters([]);
    setCapabilities([]);
    setValues({});
    setBusy("setup");
    setStatus(`Loading ${recipe.title} setup…`);
    try {
      const setup = await onLoadSetup(recipe.id, recipe.version);
      if (requestId !== setupRequest.current) return;
      setParameters(setup.parameters);
      setCapabilities(setup.capabilities);
      setValues(valuesFor(setup.parameters));
      const missing = setup.capabilities.filter((capability) => capability.state === "missing").length;
      const substitutions = setup.capabilities.filter((capability) => capability.state === "substitution").length;
      setStatus(missing > 0
        ? `Blocked: ${missing} provider requirement${missing === 1 ? "" : "s"} need configuration.`
        : substitutions > 0
          ? `${recipe.title} setup is ready with ${substitutions} declared substitution${substitutions === 1 ? "" : "s"}.`
          : `${recipe.title} setup is ready.`);
    } catch (error) {
      if (requestId !== setupRequest.current) return;
      setParameters([]);
      setCapabilities([]);
      setValues({});
      setStatus(`Blocked: ${errorMessage(error)}`);
    } finally {
      if (requestId === setupRequest.current) setBusy(null);
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
      onInserted?.();
    } catch (error) {
      setStatus(`Blocked: ${errorMessage(error)}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="template-gallery" data-testid="recipe-gallery" aria-label="Recipe Gallery">
      <header className="template-gallery-header">
        <span>Starter catalog</span>
        <strong>Choose a workflow</strong>
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
          <section className="recipe-provider-readiness" aria-label="Provider readiness">
            <header>
              <span>Provider readiness</span>
              <small>{capabilities.length === 0 ? "This recipe uses local graph operations only." : `${capabilities.length} typed requirement${capabilities.length === 1 ? "" : "s"}`}</small>
            </header>
            {capabilities.map((capability) => (
              <article
                key={capability.requirementId}
                className={`recipe-capability recipe-capability-${capability.state}`}
                data-testid={`recipe-capability-${capability.requirementId}`}
              >
                <div>
                  <strong>{capability.operation}</strong>
                  <span>{capabilityStateLabel(capability.state)}</span>
                </div>
                <small>{capability.inputChannels.join(" + ")} → {capability.outputChannels.join(" + ")}</small>
                <p>
                  {capability.selectedProviderId === null
                    ? "No enabled provider"
                    : `${capability.selectedProviderId} · ${capability.selectedProfileId}`}
                </p>
                {capability.options.length > 0 ? (
                  <ul aria-label={`${capability.operation} substitutions`}>
                    {capability.options.map((option) => (
                      <li key={`${option.providerId}:${option.profileId}`}>
                        <span>{option.priority === 0 ? "Primary" : "Fallback"} · {option.providerId} · {option.profileId}</span>
                        <em>{option.available ? "available" : "unavailable"}</em>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </article>
            ))}
          </section>
          <div className="recipe-setup-actions">
            <button type="button" disabled={!ready} onClick={() => void preview()}>Preview</button>
            <button type="submit" disabled={!ready || readOnly}>{busy === "insert" ? "Inserting…" : "Insert recipe"}</button>
          </div>
        </form>
      ) : (
        <section className="recipe-setup-empty" aria-label="Recipe setup">
          <span>Setup</span>
          <strong>No recipe selected</strong>
        </section>
      )}
      <p className="recipe-gallery-status" aria-live="polite" data-testid="recipe-gallery-status">{status}</p>
    </section>
  );
}
