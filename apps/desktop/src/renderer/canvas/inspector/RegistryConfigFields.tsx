import { getNodeDefinition } from "@ether/graph-kernel";
import { payloadChannels, type EtherNode, type GraphOperation, type NodeConfig } from "@ether/schema";
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

export function RegistryConfigFields({ context }: { context: InspectorNodeContext }) {
  const { node, graph, apply, report, document } = context;
  const draft = useInspectorDraft<NodeConfig>(`${node.id}:registry`, node.config);
  if (purposeBuiltRegistryKinds.has(node.config.kind)) return null;
  const disabled = document.mode !== "writable";
  const definition = getNodeDefinition(node.definitionId);
  const fields = definition.inspector.sections.flatMap((section) => section.fields).filter((field) => field !== "kind");
  const config = draft.draft as unknown as Record<string, unknown>;
  const updateField = (field: string, value: unknown) => draft.update({ ...draft.draft, [field]: value } as NodeConfig);
  const save = async () => {
    if (draft.conflict) { report("Resolve the changed-base warning before saving this draft."); return; }
    const result = definition.configSchema.safeParse(draft.draft);
    if (!result.success) { report(result.error.issues[0]?.message ?? "This configuration is incomplete."); return; }
    const saved = await apply([{ type: "updateNode", graphId: graph.id, nodeId: node.id, node: { ...node, config: result.data } as EtherNode }] as GraphOperation[], `Update ${definition.title}`);
    if (saved) draft.markCommitted();
  };
  return <InspectorSection title={`${definition.title} settings`} help={`These controls come from the canonical ${node.definitionId} Inspector definition.`}>{draft.conflict ? <DraftConflict onLatest={draft.useLatest} onRebase={draft.rebaseDraft} /> : null}{fields.map((field) => {
    const value = config[field];
    const options = registrySelectOptions[`${node.config.kind}.${field}`];
    if (options) return <label key={field}>{labelFor(field)}<select aria-label={labelFor(field)} disabled={disabled} value={String(value ?? "")} onChange={(event) => updateField(field, event.target.value)}>{options.map((option) => <option key={option} value={option}>{labelFor(option)}</option>)}</select></label>;
    if (typeof value === "boolean") return <label key={field} className="inspector-checkbox"><input aria-label={labelFor(field)} disabled={disabled} type="checkbox" checked={value} onChange={(event) => updateField(field, event.target.checked)} />{labelFor(field)}</label>;
    if (typeof value === "number" || value === undefined && ["width", "height"].includes(field)) return <label key={field}>{labelFor(field)}<input aria-label={labelFor(field)} disabled={disabled} type="number" value={typeof value === "number" ? value : ""} placeholder="Automatic" onChange={(event) => updateField(field, event.target.value === "" ? undefined : Number(event.target.value))} /></label>;
    if (typeof value === "string") return <label key={field}>{labelFor(field)}{["body", "instruction", "namingTemplate"].includes(field) ? <textarea aria-label={labelFor(field)} disabled={disabled} value={value} onChange={(event) => updateField(field, event.target.value)} /> : <input aria-label={labelFor(field)} disabled={disabled} value={value} onChange={(event) => updateField(field, event.target.value)} />}</label>;
    if (Array.isArray(value)) return <ListEditor key={field} kind={node.config.kind} field={field} value={value} disabled={disabled} onChange={(next) => updateField(field, next)} />;
    if (value === undefined && field === "exclusions") return <ListEditor key={field} kind={node.config.kind} field={field} value={[]} disabled={disabled} onChange={(next) => updateField(field, next)} />;
    return <p key={field} className="inspector-unavailable">{labelFor(field)} is managed by its purpose-built workspace.</p>;
  })}<div className="inspector-actions"><button type="button" disabled={disabled || !draft.dirty || draft.conflict} onClick={() => void save()}>Save {definition.title.toLocaleLowerCase()}</button></div></InspectorSection>;
}
