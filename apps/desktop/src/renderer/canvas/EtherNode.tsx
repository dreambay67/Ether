import { memo, useState, type FocusEvent } from "react";
import { Handle, NodeResizer, Position, type NodeProps } from "@xyflow/react";
import { Check, Pencil, Trash2, X } from "lucide-react";
import type { EtherNode as SchemaNode, PayloadChannel } from "@ether/schema";
import { ChannelRail } from "./ports/ChannelRail";
import { NodePreview } from "./nodes/NodePreview";
import { NodeStatusLayer, type NodeRuntimeStatus } from "./nodes/NodeStatusLayer";
import { primaryEditorFor, type CanvasEditorField } from "./commands/directEditing";

export type EtherCanvasNodeData = {
  node: SchemaNode;
  connectedInput: PayloadChannel[];
  connectedOutput: PayloadChannel[];
  status?: NodeRuntimeStatus;
  readOnly: boolean;
  activeEditor: CanvasEditorField | null;
  onDelete(id: string): void;
  onResizeStart(): void;
  onResize(id: string, size: { width: number; height: number }): void;
  onResizeEnd(): void;
  onSelect(id: string, additive: boolean): void;
  onEditRequest(id: string, field: CanvasEditorField): void;
  onEditCommit(id: string, field: CanvasEditorField, value: string): Promise<boolean>;
  onEditCancel(): void;
};
const familyLabel: Record<string, string> = { prompt: "Prompt", reference: "Reference", generation: "Generation", edit: "Edit", review: "Review", flow: "Flow", output: "Output", canvas: "Canvas" };

export const EtherNode = memo(function EtherNode({ id, data, selected }: NodeProps & { data: EtherCanvasNodeData }) {
  const { node } = data;
  const family = node.definitionId.split(".")[0] ?? "canvas";
  const subtitle = node.definitionId.split(".")[1]?.replace(/(^|[-.])(\w)/g, (_, __, character) => String(character).toUpperCase()) ?? "";
  const primaryEditor = primaryEditorFor(node);
  return <article className={`ether-node ether-node-family-${family}${selected ? " is-selected" : ""}${data.activeEditor ? " is-editing" : ""}`} data-testid="ether-node" data-node-id={id} data-node-family={family} data-node-definition={node.definitionId}>
    <NodeResizer color="var(--ether-cyan)" isVisible={selected && !data.readOnly && !data.activeEditor} minWidth={190} minHeight={132} onResizeStart={data.onResizeStart} onResizeEnd={(_, params) => { if (!data.readOnly) data.onResize(id, { width: Math.round(params.width), height: Math.round(params.height) }); data.onResizeEnd(); }} />
    <ChannelRail direction="input" nodeTitle={node.title} nodeDefinitionId={node.definitionId} connectedChannels={data.connectedInput} />
    <header className="ether-node-header"><span className="ether-node-family">{familyLabel[family] ?? family}</span><span className="ether-node-subtype">{subtitle}</span></header>
    <div className="ether-node-main">
      {data.activeEditor === "title" ? <InlineNodeEditor label="Node title" value={node.title} singleLine onCommit={(value) => data.onEditCommit(id, "title", value)} onCancel={data.onEditCancel} /> : <button type="button" className="ether-node-title" onClick={(event) => { event.stopPropagation(); data.onSelect(id, event.ctrlKey || event.metaKey || event.shiftKey); }} onDoubleClick={() => { if (!data.readOnly) data.onEditRequest(id, "title"); }} title={data.readOnly ? "Node title" : "Double-click or press F2 to rename"}>{node.title}</button>}
      {data.activeEditor === "primary" && primaryEditor ? <InlineNodeEditor label={primaryEditor.label} value={primaryEditor.value} placeholder={primaryEditor.placeholder} onCommit={(value) => data.onEditCommit(id, "primary", value)} onCancel={data.onEditCancel} /> : <div className={`ether-node-primary${primaryEditor ? " is-editable" : ""}`} role={primaryEditor ? "button" : undefined} tabIndex={primaryEditor ? 0 : undefined} aria-label={primaryEditor ? `Edit ${primaryEditor.label}` : undefined} title={primaryEditor && !data.readOnly ? "Double-click or press Enter to edit" : undefined} onClick={(event) => { event.stopPropagation(); data.onSelect(id, event.ctrlKey || event.metaKey || event.shiftKey); }} onDoubleClick={() => { if (!data.readOnly && primaryEditor) data.onEditRequest(id, "primary"); }} onKeyDown={(event) => { if (event.key === "Enter" && !data.readOnly && primaryEditor) { event.preventDefault(); data.onSelect(id, false); data.onEditRequest(id, "primary"); } }}><NodePreview node={node} />{primaryEditor && !data.readOnly ? <Pencil size={11} aria-hidden="true" /> : null}</div>}
    </div>
    <NodeStatusLayer status={data.status ?? null} />
    <footer className="ether-node-footer"><span>{data.activeEditor ? "Editing" : node.presentation.collapsed ? "Collapsed" : "Ready"}</span><button type="button" className="nodrag" aria-label={`Delete ${node.title}`} disabled={data.readOnly || data.activeEditor !== null} onClick={() => { if (!data.readOnly) data.onDelete(id); }}><Trash2 size={14} /></button></footer>
    <ChannelRail direction="output" nodeTitle={node.title} nodeDefinitionId={node.definitionId} connectedChannels={data.connectedOutput} />
  </article>;
});

function InlineNodeEditor({ label, value, placeholder, singleLine = false, onCommit, onCancel }: { label: string; value: string; placeholder?: string; singleLine?: boolean; onCommit(value: string): Promise<boolean>; onCancel(): void }) {
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const commit = async () => {
    if (saving) return;
    setSaving(true);
    const saved = await onCommit(draft);
    if (!saved) setSaving(false);
  };
  const leaveEditor = (event: FocusEvent<HTMLDivElement>) => {
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
    void commit();
  };
  const common = {
    autoFocus: true,
    className: "ether-node-inline-input nodrag nowheel",
    value: draft,
    placeholder,
    "aria-label": label,
    disabled: saving,
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(event.target.value),
    onPointerDown: (event: React.PointerEvent) => event.stopPropagation(),
    onKeyDown: (event: React.KeyboardEvent) => {
      event.stopPropagation();
      if (event.key === "Escape") { event.preventDefault(); onCancel(); }
      if (event.key === "Enter" && (singleLine || event.ctrlKey || event.metaKey)) { event.preventDefault(); void commit(); }
    }
  };
  return <div className={`ether-node-inline-editor nodrag nowheel${singleLine ? " is-single-line" : ""}`} onBlur={leaveEditor}>
    {singleLine ? <input {...common} /> : <textarea {...common} rows={4} />}
    <div className="ether-node-inline-actions"><span>{singleLine ? "Enter to save" : "Ctrl+Enter to save"}</span><button type="button" className="nodrag" aria-label={`Cancel ${label}`} disabled={saving} onClick={onCancel}><X size={12} /></button><button type="button" className="nodrag" aria-label={`Save ${label}`} disabled={saving} onClick={() => void commit()}><Check size={12} /></button></div>
  </div>;
}

export function ModuleNode({ id, data, selected }: NodeProps & { data: { title: string; collapsed: boolean; inputs: Array<{ id: string; channel: PayloadChannel }>; outputs: Array<{ id: string; channel: PayloadChannel }>; readOnly: boolean; onEnter(id: string): void; onToggle(id: string): void } }) {
  return <article className={`ether-module-node${selected ? " is-selected" : ""}`} data-testid="ether-module-node" data-module-id={id}>
    {data.inputs.map((port, index) => <Handle key={`in-${port.id}`} id={`in:${port.id}`} type="target" position={Position.Left} style={{ top: `${18 + index * 18}px` }} aria-label={`Input ${port.id} ${port.channel}`} />)}
    <button type="button" className="ether-module-title nodrag" onDoubleClick={() => data.onEnter(id)}>{data.title}</button><p>{data.collapsed ? "Collapsed module" : "Double click to enter"}</p><button type="button" className="ether-module-collapse nodrag" disabled={data.readOnly} onClick={() => { if (!data.readOnly) data.onToggle(id); }}>{data.collapsed ? "Expand" : "Collapse"}</button>
    {data.outputs.map((port, index) => <Handle key={`out-${port.id}`} id={`out:${port.id}`} type="source" position={Position.Right} style={{ top: `${18 + index * 18}px` }} aria-label={`Output ${port.id} ${port.channel}`} />)}
  </article>;
}
