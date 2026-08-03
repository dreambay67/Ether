import { useId } from "react";
import type { EtherNode } from "@ether/schema";
import { ContextHelp } from "../../help/ContextHelp";
import { DraftConflict } from "./DraftConflict";
import { controlHelp, inspectorDefinition, nodeDisplayName } from "./inspectorConfig";
import { useInspectorDraft } from "./useInspectorDraft";

export function Help({ text, label }: { text: string; label: string }) {
  const id = useId().replaceAll(":", "");
  return <ContextHelp id={`inspector-${id}`} label={label}>{text}</ContextHelp>;
}

export function InspectorSection({ title, help, children, advanced = false }: { title: string; help: string; children: React.ReactNode; advanced?: boolean }) {
  const content = <div className="inspector-section-content">{children}</div>;
  return advanced ? <details className="inspector-section inspector-disclosure"><summary>{title}<Help label={title} text={help} /></summary>{content}</details> : <section className="inspector-section"><div className="inspector-section-heading"><h3>{title}</h3><Help label={title} text={help} /></div>{content}</section>;
}

export function NodeSetup({ node, disabled, onUpdate }: { node: EtherNode; disabled: boolean; onUpdate(next: EtherNode, title: string): Promise<boolean> }) {
  const definition = inspectorDefinition(node.definitionId);
  const title = useInspectorDraft(`${node.id}:title`, node.title);
  const commitTitle = async () => { const next = title.draft.trim(); if (title.conflict || !next || !title.dirty) return; if (await onUpdate({ ...node, title: next }, "Rename node")) title.markCommitted(); };
  return <InspectorSection title="Setup" help={`${nodeDisplayName(node)} controls are driven by the canonical node registry.`}>
    {title.conflict ? <DraftConflict onLatest={title.useLatest} onRebase={title.rebaseDraft} /> : null}
    <div className="inspector-node-kind"><span>{nodeDisplayName(node)}</span><small>{definition.sections.flatMap((section) => section.fields).join(" / ")}</small></div>
    <label>Title <Help label="Title" text={controlHelp.title} /><input aria-label="Title" value={title.draft} disabled={disabled} onChange={(event) => title.update(event.target.value)} onBlur={() => void commitTitle()} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); if (event.key === "Escape") title.useLatest(); }} /></label>
    <div className="inspector-actions"><button type="button" disabled={disabled || !title.dirty || title.conflict} onClick={() => void commitTitle()}>Save title</button></div>
  </InspectorSection>;
}
