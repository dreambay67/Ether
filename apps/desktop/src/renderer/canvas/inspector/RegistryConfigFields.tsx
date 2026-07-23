import { getNodeDefinition } from "@ether/graph-kernel";
import type { EtherNode, GraphOperation, NodeConfig } from "@ether/schema";
import { DraftConflict } from "./DraftConflict";
import { InspectorSection } from "./NodeSetup";
import type { InspectorNodeContext } from "./types";
import { useInspectorDraft } from "./useInspectorDraft";

const customEditors = new Set<NodeConfig["kind"]>(["prompt.text", "prompt.worker", "reference.set", "generation.image", "edit.image"]);

function labelFor(field: string) {
  return field.replace(/([A-Z])/g, " $1").replace(/^./, (character) => character.toUpperCase());
}

export function RegistryConfigFields({ context }: { context: InspectorNodeContext }) {
  const { node, graph, apply, report } = context;
  const draft = useInspectorDraft<NodeConfig>(`${node.id}:registry`, node.config);
  if (customEditors.has(node.config.kind)) return null;
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
    if (typeof value === "boolean") return <label key={field} className="inspector-checkbox"><input aria-label={labelFor(field)} type="checkbox" checked={value} onChange={(event) => updateField(field, event.target.checked)} />{labelFor(field)}</label>;
    if (typeof value === "number") return <label key={field}>{labelFor(field)}<input aria-label={labelFor(field)} type="number" value={value} onChange={(event) => updateField(field, Number(event.target.value))} /></label>;
    if (typeof value === "string") return <label key={field}>{labelFor(field)}<input aria-label={labelFor(field)} value={value} onChange={(event) => updateField(field, event.target.value)} /></label>;
    if (Array.isArray(value)) return <div key={field} className="inspector-structured-summary"><strong>{labelFor(field)}</strong><span>{value.length} configured item{value.length === 1 ? "" : "s"}</span></div>;
    return null;
  })}<div className="inspector-actions"><button type="button" disabled={!draft.dirty || draft.conflict} onClick={() => void save()}>Save {definition.title.toLocaleLowerCase()}</button></div></InspectorSection>;
}
