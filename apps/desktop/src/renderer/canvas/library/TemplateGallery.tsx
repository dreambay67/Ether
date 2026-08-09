import { useEffect, useMemo, useRef, useState } from "react";
import type { ApplicationQuery, Artifact, GraphTransaction, JsonValue, RecipeManifest, RecipeParameter, RecipeParameterValue } from "@ether/schema";

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
  documentId: string;
  recipes: readonly RecipeManifest[];
  readOnly?: boolean;
  onLoadSetup(recipeId: string, version: string): Promise<RecipeSetup>;
  onPreviewRecipe(request: RecipeSetupRequest): Promise<RecipePreview>;
  onInstantiateRecipe(request: RecipeSetupRequest): Promise<void>;
  onRequestPathGrant?(): Promise<{ grantId: string; displayName: string } | null>;
  onInserted?(): void;
};

type ArtifactChoices = Readonly<Record<string, readonly Artifact[]>>;

function artifactDisplayName(artifact: Artifact): string {
  return typeof artifact.metadata.title === "string" && artifact.metadata.title.trim().length > 0
    ? artifact.metadata.title
    : artifact.id;
}

function artifactIds(value: JsonValue | undefined): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function artifactParameterReady(
  parameter: Extract<RecipeParameter, { type: "artifact" }>,
  value: JsonValue | undefined,
  choices: readonly Artifact[]
): boolean {
  return parameterReady(parameter, value)
    && artifactIds(value).every((id) => choices.some((artifact) => artifact.id === id));
}

async function loadArtifactChoices(documentId: string, parameters: readonly RecipeParameter[]): Promise<ArtifactChoices> {
  const artifactParameters = parameters.filter((parameter): parameter is Extract<RecipeParameter, { type: "artifact" }> => parameter.type === "artifact");
  const entries = await Promise.all(artifactParameters.map(async (parameter) => {
    const response = await window.ether.application.query({
      kind: "query",
      id: crypto.randomUUID(),
      correlationId: crypto.randomUUID(),
      documentId,
      name: "artifact.search",
      payload: {
        text: "",
        channels: parameter.channels,
        collectionIds: [],
        tags: [],
        minimumRating: null,
        providerId: null,
        modelId: null,
        runId: null,
        graphId: null,
        createdAfter: null,
        createdBefore: null,
        cursor: null,
        limit: 500
      }
    } as ApplicationQuery);
    if (response.name !== "artifact.search") {
      throw new Error("Ether returned an unexpected artifact search response.");
    }
    return [parameter.id, response.payload.artifacts.filter((artifact) => parameter.channels.includes(artifact.channel))] as const;
  }));
  return Object.fromEntries(entries);
}

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

export function TemplateGallery({ documentId, recipes, readOnly = false, onLoadSetup, onPreviewRecipe, onInstantiateRecipe, onRequestPathGrant, onInserted }: TemplateGalleryProps) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [parameters, setParameters] = useState<readonly RecipeParameter[]>([]);
  const [capabilities, setCapabilities] = useState<readonly RecipeCapabilitySetup[]>([]);
  const [values, setValues] = useState<Record<string, JsonValue>>({});
  const [artifactChoices, setArtifactChoices] = useState<ArtifactChoices>({});
  const [pathGrantDisplayName, setPathGrantDisplayName] = useState<string | null>(null);
  const [busy, setBusy] = useState<"setup" | "preview" | "insert" | null>(null);
  const [status, setStatus] = useState("Choose a recipe to inspect its setup.");
  const setupRequest = useRef(0);
  const selected = useMemo(() => recipes.find((recipe) => `${recipe.id}@${recipe.version}` === selectedKey) ?? null, [recipes, selectedKey]);
  const pathGrantParameter = parameters.find((parameter): parameter is Extract<RecipeParameter, { type: "string" }> => parameter.id === "exportPathGrantId" && parameter.type === "string");
  const pathGrantReady = pathGrantParameter === undefined || values[pathGrantParameter.id] !== pathGrantParameter.defaultValue;
  const ready = selected !== null
    && busy === null
    && parameters.length > 0
    && parameters.every((parameter) => parameter.type === "artifact"
      ? artifactParameterReady(parameter, values[parameter.id], artifactChoices[parameter.id] ?? [])
      : parameterReady(parameter, values[parameter.id]))
    && capabilities.every((capability) => capability.state !== "missing")
    && pathGrantReady;

  useEffect(() => {
    if (selectedKey !== null && !recipes.some((recipe) => `${recipe.id}@${recipe.version}` === selectedKey)) {
      setSelectedKey(null);
      setParameters([]);
      setCapabilities([]);
      setValues({});
      setArtifactChoices({});
      setPathGrantDisplayName(null);
    }
  }, [recipes, selectedKey]);

  useEffect(() => {
    setupRequest.current += 1;
    setSelectedKey(null);
    setParameters([]);
    setCapabilities([]);
    setValues({});
    setArtifactChoices({});
    setPathGrantDisplayName(null);
    setBusy(null);
    setStatus("Choose a recipe to inspect its setup.");
  }, [documentId]);

  const choose = async (recipe: RecipeManifest) => {
    const requestId = ++setupRequest.current;
    setSelectedKey(`${recipe.id}@${recipe.version}`);
    setParameters([]);
    setCapabilities([]);
    setValues({});
    setArtifactChoices({});
    setPathGrantDisplayName(null);
    setBusy("setup");
    setStatus(`Loading ${recipe.title} setup…`);
    try {
      const setup = await onLoadSetup(recipe.id, recipe.version);
      if (requestId !== setupRequest.current) return;
      setParameters(setup.parameters);
      setCapabilities(setup.capabilities);
      const initialValues = valuesFor(setup.parameters);
      const grantParameter = setup.parameters.find((parameter): parameter is Extract<RecipeParameter, { type: "string" }> => parameter.id === "exportPathGrantId" && parameter.type === "string");
      const choices = await loadArtifactChoices(documentId, setup.parameters);
      if (requestId !== setupRequest.current) return;
      setValues(initialValues);
      setArtifactChoices(choices);
      const missing = setup.capabilities.filter((capability) => capability.state === "missing").length;
      const substitutions = setup.capabilities.filter((capability) => capability.state === "substitution").length;
      setStatus(missing > 0
        ? `Blocked: ${missing} provider requirement${missing === 1 ? "" : "s"} need configuration.`
        : grantParameter !== undefined && initialValues[grantParameter.id] === grantParameter.defaultValue
          ? "Blocked: choose an export folder so Ether can issue a document-scoped path grant."
        : substitutions > 0
          ? `${recipe.title} setup is ready with ${substitutions} declared substitution${substitutions === 1 ? "" : "s"}.`
          : `${recipe.title} setup is ready.`);
    } catch (error) {
      if (requestId !== setupRequest.current) return;
      setParameters([]);
      setCapabilities([]);
      setValues({});
      setArtifactChoices({});
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
                parameter.id === "exportPathGrantId" ? (
                  <div className="recipe-path-grant-field">
                    <button type="button" aria-label="Choose export folder" onClick={() => void (onRequestPathGrant === undefined
                      ? Promise.resolve(null)
                      : onRequestPathGrant()).then((grant) => {
                        if (grant === null || grant === undefined) return;
                        setValues((current) => ({ ...current, [parameter.id]: grant.grantId }));
                        setPathGrantDisplayName(grant.displayName);
                      })}>{pathGrantDisplayName ?? "Choose export folder…"}</button>
                    {values[parameter.id] === parameter.defaultValue ? <em>Required before insertion</em> : <small>Opaque grant: {pathGrantDisplayName ?? "selected folder"}</small>}
                  </div>
                ) : (
                <textarea value={typeof values[parameter.id] === "string" ? values[parameter.id] as string : ""} minLength={parameter.minLength} maxLength={parameter.maxLength} onChange={(event) => setValues((current) => ({ ...current, [parameter.id]: event.target.value }))} />
                )
              ) : parameter.type === "number" ? (
                <input type="number" value={typeof values[parameter.id] === "number" ? values[parameter.id] as number : parameter.minimum} min={parameter.minimum} max={parameter.maximum} step={parameter.step} onChange={(event) => setValues((current) => ({ ...current, [parameter.id]: event.target.valueAsNumber }))} />
              ) : parameter.type === "boolean" ? (
                <input type="checkbox" checked={values[parameter.id] === true} onChange={(event) => setValues((current) => ({ ...current, [parameter.id]: event.target.checked }))} />
              ) : parameter.type === "choice" ? (
                <select value={parameter.options.find((option) => Object.is(option.value, values[parameter.id]))?.id ?? ""} onChange={(event) => setValues((current) => ({ ...current, [parameter.id]: parameter.options.find((option) => option.id === event.target.value)?.value ?? "" }))}>
                  {parameter.options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                </select>
              ) : (() => {
                const choices = artifactChoices[parameter.id] ?? [];
                const selectedIds = artifactIds(values[parameter.id]);
                return <>
                  <select
                    aria-label={`${parameter.title} artifact choices`}
                    multiple={parameter.maximumItems > 1}
                    size={parameter.maximumItems > 1 ? Math.min(Math.max(choices.length, 1), 6) : undefined}
                    value={parameter.maximumItems === 1 ? selectedIds[0] ?? "" : selectedIds}
                    onChange={(event) => {
                      const available = new Set(choices.map((artifact) => artifact.id));
                      const next = Array.from(event.currentTarget.selectedOptions)
                        .map((option) => option.value)
                        .filter((id) => available.has(id))
                        .slice(0, parameter.maximumItems);
                      setValues((current) => ({ ...current, [parameter.id]: next }));
                    }}
                  >
                    {parameter.maximumItems === 1 ? <option value="">Choose an artifact…</option> : null}
                    {choices.map((artifact) => <option key={artifact.id} value={artifact.id}>{artifactDisplayName(artifact)} · {artifact.mediaType}</option>)}
                  </select>
                  {choices.length === 0 ? (
                    <em data-testid={`recipe-artifact-empty-${parameter.id}`}>No {parameter.channels.join(" or ")} artifacts are available in this document.</em>
                  ) : (
                    <small>{selectedIds.length}/{parameter.maximumItems} selected from this document · {parameter.channels.join(" or ")}</small>
                  )}
                </>;
              })()
              }
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
