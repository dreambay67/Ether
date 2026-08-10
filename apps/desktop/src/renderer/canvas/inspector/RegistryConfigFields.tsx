import { getNodeDefinition, interpolateVariables, renderVariableValue, variableMap, variableValueType } from "@ether/graph-kernel";
import { useMemo, useState } from "react";
import { payloadChannels, type EtherNode, type FlowVariablesConfig, type GraphOperation, type JsonValue, type NodeConfig } from "@ether/schema";
import { DraftConflict } from "./DraftConflict";
import { InspectorSection } from "./NodeSetup";
import { createRegistryListItem, parseInspectorKeyValues, purposeBuiltRegistryKinds, registrySelectOptions } from "./registryFieldModel";
import type { InspectorNodeContext } from "./types";
import { useInspectorDraft } from "./useInspectorDraft";

function labelFor(field: string) {
  return field.replace(/([A-Z])/g, " $1").replace(/^./, (character) => character.toUpperCase());
}

function ListEditor({ kind, field, value, disabled, onChange }: { kind: NodeConfig["kind"]; field: string; value: unknown[]; disabled: boolean; onChange(value: unknown[]): void }) {
  const sample = createRegistryListItem(kind, field, value.length);
  if (field === "artifactIds") return <div className="inspector-structured-summary"><strong>Saved members</strong><span>Managed with the Reference Set actions above</span></div>;
  if (field === "enabledChannels") return <fieldset className="inspector-channel-options"><legend>Enabled channels</legend>{payloadChannels.map((channel) => <label key={channel} className="inspector-checkbox"><input type="checkbox" disabled={disabled} checked={value.includes(channel)} onChange={(event) => onChange(event.target.checked ? [...value, channel] : value.filter((item) => item !== channel))} />{labelFor(channel)}</label>)}</fieldset>;
  if (sample === null && value.length === 0) return <div className="inspector-structured-summary"><strong>{labelFor(field)}</strong><span>No editable items</span></div>;
  return <fieldset className="inspector-list-editor" data-testid={`inspector-list-${field}`}><legend>{labelFor(field)}</legend>
    {value.map((entry, index) => {
      const item = typeof entry === "object" && entry !== null && !Array.isArray(entry) ? entry as Record<string, unknown> : { value: entry };
      const updateItem = (key: string, next: unknown) => onChange(value.map((candidate, candidateIndex) => candidateIndex === index ? { ...item, [key]: next } : candidate));
      return <article key={`${field}-${index}`} className="inspector-list-item">
        <header><strong>{labelFor(field)} {index + 1}</strong><button type="button" disabled={disabled} onClick={() => onChange(value.filter((_, candidateIndex) => candidateIndex !== index))}>Remove</button></header>
        {Object.entries(item).map(([key, nested]) => {
          if (key === "id") return <small key={key}>Stable ID · {String(nested).slice(0, 18)}</small>;
          const options = registrySelectOptions[`${kind}.${field}.${key}`];
          if (options) return <label key={key}>{labelFor(key)}<select disabled={disabled} value={String(nested)} onChange={(event) => updateItem(key, event.target.value)}>{options.map((option) => <option key={option} value={option}>{labelFor(option)}</option>)}</select></label>;
          if (Array.isArray(nested)) return <label key={key}>{labelFor(key)}<textarea disabled={disabled} value={nested.map(String).join("\n")} placeholder="One value per line" onChange={(event) => updateItem(key, event.target.value.split(/\r?\n|,/).map((part) => part.trim()).filter(Boolean))} /></label>;
          if (typeof nested === "object" && nested !== null) return <label key={key}>{labelFor(key)}<textarea disabled={disabled} value={Object.entries(nested).map(([name, itemValue]) => `${name}=${String(itemValue)}`).join("\n")} placeholder="name=value, one per line" onChange={(event) => updateItem(key, parseInspectorKeyValues(event.target.value))} /></label>;
          if (typeof nested === "number") return <label key={key}>{labelFor(key)}<input disabled={disabled} type="number" value={nested} onChange={(event) => updateItem(key, Number(event.target.value))} /></label>;
          if (typeof nested === "boolean") return <label key={key} className="inspector-checkbox"><input disabled={disabled} type="checkbox" checked={nested} onChange={(event) => updateItem(key, event.target.checked)} />{labelFor(key)}</label>;
          return <label key={key}>{labelFor(key)}<input disabled={disabled} value={String(nested ?? "")} onChange={(event) => updateItem(key, event.target.value)} /></label>;
        })}
      </article>;
    })}
    {sample !== null ? <button type="button" disabled={disabled} className="inspector-add-item" onClick={() => onChange([...value, createRegistryListItem(kind, field, value.length)!])}>Add {labelFor(field).toLocaleLowerCase().replace(/s$/, "")}</button> : null}
  </fieldset>;
}

const variableTypes = ["string", "number", "boolean", "object", "array", "null"] as const;
type VariableType = typeof variableTypes[number];

function variableType(value: JsonValue): VariableType {
  return variableValueType(value);
}

function defaultVariableValue(type: VariableType): JsonValue {
  switch (type) {
    case "string": return "";
    case "number": return 0;
    case "boolean": return false;
    case "object": return {};
    case "array": return [];
    case "null": return null;
  }
}

function parseStructuredValue(raw: string, type: "object" | "array"): { ok: true; value: JsonValue } | { ok: false } {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (type === "object" && parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) return { ok: true, value: parsed as JsonValue };
    if (type === "array" && Array.isArray(parsed)) return { ok: true, value: parsed as JsonValue };
  } catch {
    // The draft remains editable until blur/save validation.
  }
  return { ok: false };
}

function VariablesFields({ context }: { context: InspectorNodeContext }) {
  const { graph, apply, report, document } = context;
  const node = context.node as EtherNode & { config: FlowVariablesConfig };
  const draft = useInspectorDraft<FlowVariablesConfig>(`${node.id}:variables`, node.config);
  const disabled = document.mode !== "writable";
  const [previewTemplate, setPreviewTemplate] = useState("");
  const [valueDrafts, setValueDrafts] = useState<Record<number, string>>({});
  const validation = useMemo(() => {
    try {
      const values = variableMap(draft.draft.variables);
      return { values, error: null as string | null };
    } catch (error) {
      return { values: null, error: error instanceof Error ? error.message : "Variable definitions are invalid." };
    }
  }, [draft.draft.variables]);
  const preview = useMemo(() => {
    if (previewTemplate.length === 0 || validation.values === null) return null;
    try {
      return { value: interpolateVariables(previewTemplate, validation.values), error: null as string | null };
    } catch (error) {
      return { value: null, error: error instanceof Error ? error.message : "Preview could not be rendered." };
    }
  }, [previewTemplate, validation.values]);
  const updateVariables = (variables: FlowVariablesConfig["variables"]) => draft.update({ ...draft.draft, variables });
  const save = async () => {
    if (draft.conflict) { report("Resolve the changed-base warning before saving this draft."); return; }
    if (validation.error !== null) { report(validation.error); return; }
    for (const [indexText, raw] of Object.entries(valueDrafts)) {
      const index = Number(indexText);
      const value = draft.draft.variables[index]?.value;
      const type = value === undefined ? null : variableType(value);
      if (type === "object" || type === "array") {
        if (!parseStructuredValue(raw, type).ok) { report(`Variable ${index + 1} must contain valid JSON ${type}.`); return; }
      }
    }
    const result = await apply([{ type: "updateNode", graphId: graph.id, nodeId: node.id, node: { ...node, config: draft.draft } as EtherNode }] as GraphOperation[], "Update Variables");
    if (result) draft.markCommitted();
  };
  return <InspectorSection title="Variables" help={"Define typed values once, then reference them downstream with ${name}. Use $${name} when the token should remain literal."}>
    {draft.conflict ? <DraftConflict onLatest={draft.useLatest} onRebase={draft.rebaseDraft} /> : null}
    <div className="inspector-variable-list" data-testid="inspector-variables">
      {draft.draft.variables.map((variable, index) => {
        const type = variableType(variable.value);
        const update = (next: Partial<typeof variable>) => updateVariables(draft.draft.variables.map((candidate, candidateIndex) => candidateIndex === index ? { ...candidate, ...next } : candidate));
        return <article key={`variable-${index}`} className="inspector-list-item">
          <header><strong>{variable.name || `Variable ${index + 1}`}</strong><button type="button" disabled={disabled} onClick={() => updateVariables(draft.draft.variables.filter((_, candidateIndex) => candidateIndex !== index))}>Remove</button></header>
          <label>Name<input aria-label={`Variable ${index + 1} name`} disabled={disabled} value={variable.name} onChange={(event) => update({ name: event.target.value })} /></label>
          <label>Type<select aria-label={`Variable ${index + 1} type`} disabled={disabled} value={type} onChange={(event) => update({ value: defaultVariableValue(event.target.value as VariableType) })}>{variableTypes.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>
          {type === "boolean" ? <label className="inspector-checkbox">Value<input aria-label={`Variable ${index + 1} value`} disabled={disabled} type="checkbox" checked={variable.value === true} onChange={(event) => update({ value: event.target.checked })} /></label>
            : type === "null" ? <span className="inspector-structured-summary">Value · null</span>
              : type === "object" || type === "array" ? <label>Value<textarea aria-label={`Variable ${index + 1} value`} disabled={disabled} value={valueDrafts[index] ?? renderVariableValue(variable.value)} onChange={(event) => {
                const raw = event.target.value;
                setValueDrafts((current) => ({ ...current, [index]: raw }));
                const parsed = parseStructuredValue(raw, type);
                if (parsed.ok) update({ value: parsed.value });
              }} onBlur={() => {
                const raw = valueDrafts[index];
                if (raw !== undefined && !parseStructuredValue(raw, type).ok) report(`Value must remain valid JSON ${type}.`);
              }} /></label>
                : <label>Value<input aria-label={`Variable ${index + 1} value`} disabled={disabled} type={type === "number" ? "number" : "text"} value={String(variable.value)} onChange={(event) => update({ value: type === "number" ? Number(event.target.value) : event.target.value })} /></label>}
          <small>{renderVariableValue(variable.value)} · {type}</small>
        </article>;
      })}
    </div>
    <button type="button" disabled={disabled} className="inspector-add-item" onClick={() => {
      const used = new Set(draft.draft.variables.map((variable) => variable.name));
      let ordinal = 1;
      while (used.has(`variable${ordinal}`)) ordinal += 1;
      updateVariables([...draft.draft.variables, { name: `variable${ordinal}`, value: "" }]);
    }}>Add variable</button>
    <label>Interpolation preview<input aria-label="Variable interpolation preview" value={previewTemplate} placeholder="Hello ${name}" onChange={(event) => setPreviewTemplate(event.target.value)} /></label>
    {validation.error !== null ? <p className="inspector-unavailable" role="alert">{validation.error}</p> : null}
    {preview?.error !== null && preview?.error !== undefined ? <p className="inspector-unavailable" role="alert">{preview.error}</p> : null}
    {preview?.value !== null && preview?.value !== undefined ? <p className="inspector-structured-summary" data-testid="variables-preview">Preview · {preview.value}</p> : null}
    <div className="inspector-actions"><button type="button" disabled={disabled || !draft.dirty || draft.conflict || validation.error !== null} onClick={() => void save()}>Save variables</button></div>
  </InspectorSection>;
}

export function RegistryConfigFields({ context }: { context: InspectorNodeContext }) {
  const { node, graph, apply, report, document } = context;
  const draft = useInspectorDraft<NodeConfig>(`${node.id}:registry`, node.config);
  const [pathGrantDisplayName, setPathGrantDisplayName] = useState<string | null>(null);
  const [pathGrantBusy, setPathGrantBusy] = useState(false);
  if (node.config.kind === "flow.variables") return <VariablesFields context={context} />;
  if (purposeBuiltRegistryKinds.has(node.config.kind)) return null;
  const disabled = document.mode !== "writable";
  const definition = getNodeDefinition(node.definitionId);
  const fields = definition.inspector.sections.flatMap((section) => section.fields).filter((field) => field !== "kind");
  const config = draft.draft as unknown as Record<string, unknown>;
  const updateField = (field: string, value: unknown) => draft.update((current) => ({ ...current, [field]: value } as NodeConfig));
  const chooseExportFolder = async () => {
    if (disabled || node.config.kind !== "output.export") return;
    setPathGrantBusy(true);
    try {
      const grant = await window.ether.permissions.grantFolder(document.documentId, "export");
      if (grant === null) return;
      updateField("pathGrantId", grant.grantId);
      setPathGrantDisplayName(grant.displayName);
      report(`Export folder selected: ${grant.displayName}. Save the export settings to keep it on this node.`);
    } catch (cause) {
      report(cause instanceof Error ? cause.message : "The export folder could not be selected.");
    } finally {
      setPathGrantBusy(false);
    }
  };
  const save = async () => {
    if (draft.conflict) { report("Resolve the changed-base warning before saving this draft."); return; }
    const result = definition.configSchema.safeParse(draft.draft);
    if (!result.success) { report(result.error.issues[0]?.message ?? "This configuration is incomplete."); return; }
    const saved = await apply([{ type: "updateNode", graphId: graph.id, nodeId: node.id, node: { ...node, config: result.data } as EtherNode }] as GraphOperation[], `Update ${definition.title}`);
    if (saved) draft.markCommitted();
  };
  return <InspectorSection title={`${definition.title} settings`} help={`These controls come from the canonical ${node.definitionId} Inspector definition.`}>{draft.conflict ? <DraftConflict onLatest={draft.useLatest} onRebase={draft.rebaseDraft} /> : null}{fields.map((field) => {
    const value = config[field];
    if (node.config.kind === "output.export" && field === "pathGrantId") return <label className="inspector-path-grant" key={field}>Export folder
      <button type="button" aria-label="Choose export folder" disabled={disabled || pathGrantBusy} onClick={() => void chooseExportFolder()}>{pathGrantBusy ? "Choosing folder…" : pathGrantDisplayName ?? (typeof value === "string" && value.length > 0 ? "Choose a different folder…" : "Choose export folder…")}</button>
      <small>{typeof value === "string" && value.length > 0 ? `Opaque grant: ${pathGrantDisplayName ?? "selected folder"}.` : "Required before this node can write files."}</small>
    </label>;
    const options = registrySelectOptions[`${node.config.kind}.${field}`];
    if (options) return <label key={field}>{labelFor(field)}<select aria-label={labelFor(field)} disabled={disabled} value={String(value ?? "")} onChange={(event) => updateField(field, event.target.value)}>{options.map((option) => <option key={option} value={option}>{labelFor(option)}</option>)}</select></label>;
    if (typeof value === "boolean") return <label key={field} className="inspector-checkbox"><input aria-label={labelFor(field)} disabled={disabled} type="checkbox" checked={value} onChange={(event) => updateField(field, event.target.checked)} />{labelFor(field)}</label>;
    if (typeof value === "number" || value === undefined && ["angle", "width", "height"].includes(field)) return <label key={field}>{labelFor(field)}<input aria-label={labelFor(field)} disabled={disabled} type="number" value={typeof value === "number" ? value : ""} placeholder="Automatic" onChange={(event) => updateField(field, event.target.value === "" ? undefined : Number(event.target.value))} /></label>;
    if (typeof value === "string") return <label key={field}>{labelFor(field)}{["body", "instruction", "namingTemplate"].includes(field) ? <textarea aria-label={labelFor(field)} disabled={disabled} value={value} onChange={(event) => updateField(field, event.target.value)} /> : <input aria-label={labelFor(field)} disabled={disabled} value={value} onChange={(event) => updateField(field, event.target.value)} />}</label>;
    if (Array.isArray(value)) return <ListEditor key={field} kind={node.config.kind} field={field} value={value} disabled={disabled} onChange={(next) => updateField(field, next)} />;
    if (value === undefined && field === "exclusions") return <ListEditor key={field} kind={node.config.kind} field={field} value={[]} disabled={disabled} onChange={(next) => updateField(field, next)} />;
    return <p key={field} className="inspector-unavailable">{labelFor(field)} is managed by its purpose-built workspace.</p>;
  })}<div className="inspector-actions"><button type="button" disabled={disabled || !draft.dirty || draft.conflict} onClick={() => void save()}>Save {definition.title.toLocaleLowerCase()}</button></div></InspectorSection>;
}
