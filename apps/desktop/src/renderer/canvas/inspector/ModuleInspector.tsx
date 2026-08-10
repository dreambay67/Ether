import { useEffect, useState } from "react";
import type { EtherGraph, EtherModule, EtherNode, GraphOperation, ModuleParameter } from "@ether/schema";
import { DraftConflict } from "./DraftConflict";
import { InspectorSection } from "./NodeSetup";
import type { InspectorModuleContext } from "./types";
import { useInspectorDraft } from "./useInspectorDraft";
import { MODULE_ACCENTS, moduleAccent, moduleIsLocked } from "../modules/moduleModel";
import { moduleParameterMetadata, moduleParameterValue, type ModuleParameterMetadata, type ModuleParameterValue } from "../modules/moduleParameters";

type ModuleDraft = { title: string; description: string; accent: string };
type ApplicationBridge = { query(query: unknown): Promise<{ payload?: Record<string, unknown> }> };
function bridge() { return (window.ether as unknown as { application?: ApplicationBridge }).application; }

function ExposedParameterControl({ parameter, node, metadata, disabled, onCommit, report }: { parameter: ModuleParameter; node: EtherNode; metadata: ModuleParameterMetadata; disabled: boolean; onCommit(value: ModuleParameterValue): Promise<void>; report(message: string): void }) {
  const value = moduleParameterValue(node, parameter);
  const [draft, setDraft] = useState(value === null ? "" : String(value));
  useEffect(() => { setDraft(value === null ? "" : String(value)); }, [value]);
  if (value === null) return <p className="inspector-unavailable">{parameter.name} is unavailable because its member setting is no longer safe to edit.</p>;
  const label = `Exposed ${parameter.name}`;
  const commitNumber = async () => {
    if (draft.trim() === "") { report(`${parameter.name} needs a number.`); return; }
    const next = Number(draft);
    if (!Number.isFinite(next)) { report(`${parameter.name} needs a finite number.`); return; }
    if (next === value) return;
    await onCommit(next);
  };
  if (metadata.control === "boolean") return <label className="inspector-checkbox"><input aria-label={label} disabled={disabled} type="checkbox" checked={value === true} onChange={(event) => void onCommit(event.target.checked)} />{parameter.name}</label>;
  if (metadata.control === "select") return <label>{parameter.name}<select aria-label={label} disabled={disabled} value={value as string} onChange={(event) => void onCommit(event.target.value)}>{metadata.options?.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>;
  if (metadata.control === "number") return <label>{parameter.name}<input aria-label={label} disabled={disabled} type="number" value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={() => void commitNumber()} onKeyDown={(event) => { if (event.key === "Enter") void commitNumber(); }} /></label>;
  const multiline = parameter.configPath[0] === "body" || parameter.configPath[0] === "instruction" || parameter.configPath[0] === "namingTemplate";
  const commitText = () => draft === value ? Promise.resolve() : onCommit(draft);
  return <label>{parameter.name}{multiline ? <textarea aria-label={label} disabled={disabled} value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={() => void commitText()} /> : <input aria-label={label} disabled={disabled} value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={() => void commitText()} onKeyDown={(event) => { if (event.key === "Enter") void commitText(); }} />}</label>;
}

export function ModuleInspector({ context }: { context: InspectorModuleContext }) {
  const { module, graph, document, apply, report } = context;
  const disabled = document.mode !== "writable";
  const locked = moduleIsLocked(module);
  const draft = useInspectorDraft<ModuleDraft>(`${module.id}:module`, {
    title: module.title,
    description: module.description ?? "",
    accent: moduleAccent(module)
  });
  const [memberCount, setMemberCount] = useState<number | null>(null);
  const [memberGraph, setMemberGraph] = useState<EtherGraph | null>(null);
  const [membershipRevision, setMembershipRevision] = useState(0);
  useEffect(() => {
    let current = true;
    void bridge()?.query({ kind: "query", id: crypto.randomUUID(), correlationId: crypto.randomUUID(), name: "graph.snapshot", documentId: document.documentId, payload: { graphId: module.graphId } })
      .then((response) => { const child = response.payload?.graph as EtherGraph | undefined; if (current) { setMemberGraph(child ?? null); setMemberCount(child?.nodes.length ?? null); } })
      .catch(() => { if (current) { setMemberGraph(null); setMemberCount(null); } });
    return () => { current = false; };
  }, [document.documentId, graph.updatedAt, membershipRevision, module.graphId]);

  const update = async (next: EtherModule, title: string) => apply([
    { type: "updateModule", graphId: graph.id, moduleId: module.id, module: next } as GraphOperation
  ], title);
  const save = async () => {
    const title = draft.draft.title.trim();
    if (!title) { report("A module title cannot be empty."); return; }
    if (!draft.dirty || draft.conflict) return;
    if (await update({ ...module, title, description: draft.draft.description.trim(), accent: draft.draft.accent }, "Update module details")) draft.markCommitted();
  };
  const toggleLock = async () => {
    if (await update({ ...module, locked: !locked }, locked ? "Unlock module" : "Lock module")) {
      report(locked ? "Module unlocked. Parent-canvas movement and membership changes are enabled." : "Module locked. Its members are protected from the parent canvas.");
    }
  };
  const toggleCollapse = () => void update({ ...module, collapsed: !module.collapsed }, module.collapsed ? "Expand module" : "Collapse module");
  const addSelectedMembers = async () => {
    if (context.addSelectedToModule !== undefined && await context.addSelectedToModule(module.id, context.selectedNodeIds)) {
      setMembershipRevision((current) => current + 1);
    }
  };
  const hideParameter = async (parameterId: string) => {
    const nextInterface = { ...module.interface, parameters: module.interface.parameters.filter((parameter) => parameter.id !== parameterId) };
    await apply([{ type: "updateModuleInterface", graphId: graph.id, moduleId: module.id, interface: nextInterface }], "Hide module parameter");
  };
  const commitParameter = async (parameter: ModuleParameter, value: ModuleParameterValue) => {
    if (context.updateModuleParameter === undefined) { report("Module parameter editing is unavailable until the module graph is loaded."); return; }
    const nextMemberGraph = await context.updateModuleParameter(module.id, parameter.id, value);
    if (nextMemberGraph !== null) setMemberGraph(nextMemberGraph);
  };

  return <div className="ether-inspector" data-testid="module-inspector">
    <InspectorSection title="Module" help="A Module is Ether's only organizational container. Its internal graph stays durable and independently editable.">
      {draft.conflict ? <DraftConflict onLatest={draft.useLatest} onRebase={draft.rebaseDraft} /> : null}
      <div className="inspector-node-kind" style={{ borderColor: draft.draft.accent }}><span>{locked ? "Locked module" : "Unlocked module"}</span><small>{memberCount === null ? "Loading membership…" : `${memberCount} member${memberCount === 1 ? "" : "s"}`} · {module.interface.inputs.length} inputs · {module.interface.outputs.length} outputs · {module.interface.parameters.length} exposed parameters</small></div>
      <label>Title<input aria-label="Module title" value={draft.draft.title} disabled={disabled} onChange={(event) => draft.update((current) => ({ ...current, title: event.target.value }))} onKeyDown={(event) => { if (event.key === "Enter") void save(); if (event.key === "Escape") draft.useLatest(); }} /></label>
      <label>Description<textarea aria-label="Module description" value={draft.draft.description} disabled={disabled} onChange={(event) => draft.update((current) => ({ ...current, description: event.target.value }))} /></label>
      <fieldset className="module-accent-picker" disabled={disabled}><legend>Highlight color</legend>{MODULE_ACCENTS.map((accent) => <label key={accent.value} title={accent.name}><input type="radio" name={`module-accent-${module.id}`} value={accent.value} checked={draft.draft.accent === accent.value} onChange={() => draft.update((current) => ({ ...current, accent: accent.value }))} /><span style={{ "--module-accent-choice": accent.value } as React.CSSProperties}>{accent.name}</span></label>)}</fieldset>
      <div className="inspector-actions"><button type="button" disabled={disabled || !draft.dirty || draft.conflict} onClick={() => void save()}>Save details</button><button type="button" disabled={disabled} onClick={() => void toggleLock()}>{locked ? "Unlock module" : "Relock module"}</button></div>
    </InspectorSection>
    <InspectorSection title="Workspace" help="Enter the internal graph to edit protected members. Collapse changes presentation only; ports and execution remain intact.">
      <div className="inspector-actions"><button type="button" onClick={() => context.enterModule?.(module.id)}>Enter module</button><button type="button" disabled={disabled} onClick={toggleCollapse}>{module.collapsed ? "Expand" : "Collapse"}</button></div>
      {context.selectedNodeIds.length > 0 ? <><small>{context.selectedNodeIds.length} parent node{context.selectedNodeIds.length === 1 ? "" : "s"} selected for membership.</small><div className="inspector-actions"><button type="button" disabled={disabled || locked || context.addSelectedToModule === undefined} onClick={() => void addSelectedMembers()}>Add selected to module</button></div>{locked ? <p className="inspector-unavailable">Unlock the module before changing membership from the parent canvas.</p> : null}</> : <small>Shift-click this module after selecting parent nodes to add them as members.</small>}
    </InspectorSection>
    <InspectorSection title="Exposed parameters" help="These intentional controls update the matching member setting in an undoable graph transaction. They stay available while the module is locked; locking protects membership and layout, not the module interface.">
      {module.interface.parameters.length === 0 ? <p>No parameters are exposed.</p> : memberGraph === null ? <p>Loading exposed member controls…</p> : <div className="inspector-role-list">{module.interface.parameters.map((parameter) => {
        const node = memberGraph.nodes.find((candidate) => candidate.id === parameter.nodeId);
        const metadata = node === undefined ? null : moduleParameterMetadata(node, parameter);
        return <span key={parameter.id}><strong>{parameter.name}</strong><small>{parameter.configPath.join(".")}</small>{node === undefined || metadata === null ? <p className="inspector-unavailable">This exposure no longer targets a safe editable member setting.</p> : <ExposedParameterControl parameter={parameter} node={node} metadata={metadata} disabled={disabled} onCommit={(value) => commitParameter(parameter, value)} report={report} />}<button type="button" disabled={disabled} onClick={() => void hideParameter(parameter.id)}>Hide</button></span>;
      })}</div>}
    </InspectorSection>
    <InspectorSection advanced title="Structure and dissolution" help="Dissolution restores members and rewrites boundary connections in one undoable transaction.">
      <div className="inspector-actions"><button type="button" disabled={disabled || locked || context.dissolveModule === undefined} onClick={() => void context.dissolveModule?.(module.id)}>Dissolve module…</button></div>
      {locked ? <small>Unlock before dissolving this module.</small> : null}
    </InspectorSection>
  </div>;
}
