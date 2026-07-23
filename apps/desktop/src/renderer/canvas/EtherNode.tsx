import { memo, useState } from "react";
import { Handle, NodeResizer, Position, type NodeProps } from "@xyflow/react";
import { Trash2 } from "lucide-react";
import type { EtherNode as SchemaNode, PayloadChannel } from "@ether/schema";
import { ChannelRail } from "./ports/ChannelRail";
import { NodePreview } from "./nodes/NodePreview";
import { NodeStatusLayer, type NodeRuntimeStatus } from "./nodes/NodeStatusLayer";

export type EtherCanvasNodeData = { node: SchemaNode; connectedInput: PayloadChannel[]; connectedOutput: PayloadChannel[]; status?: NodeRuntimeStatus; readOnly: boolean; onSelect(id: string, additive: boolean): void; onDelete(id: string): void; onResize(id: string, size: { width: number; height: number }): void; onTitle(id: string, title: string): void; };
const familyLabel: Record<string, string> = { prompt: "Prompt", reference: "Reference", generation: "Generation", edit: "Edit", review: "Review", flow: "Flow", output: "Output", canvas: "Canvas" };

export const EtherNode = memo(function EtherNode({ id, data, selected }: NodeProps & { data: EtherCanvasNodeData }) {
  const { node } = data; const [editing, setEditing] = useState(false); const [titleDraft, setTitleDraft] = useState(node.title); const family = node.definitionId.split(".")[0] ?? "canvas"; const subtitle = node.definitionId.split(".")[1]?.replace(/(^|[-.])(\w)/g, (_, __, character) => String(character).toUpperCase()) ?? "";
  return <article className={`ether-node ether-node-family-${family}${selected ? " is-selected" : ""}`} data-testid="ether-node" data-node-id={id} data-node-family={family} onPointerDown={(event) => data.onSelect(id, event.ctrlKey || event.metaKey || event.shiftKey)} onClick={(event) => { event.stopPropagation(); data.onSelect(id, event.ctrlKey || event.metaKey || event.shiftKey); }}>
    <NodeResizer color="var(--ether-cyan)" isVisible={selected && !data.readOnly} minWidth={190} minHeight={132} onResizeEnd={(_, params) => { if (!data.readOnly) data.onResize(id, { width: Math.round(params.width), height: Math.round(params.height) }); }} />
    <ChannelRail direction="input" nodeTitle={node.title} nodeDefinitionId={node.definitionId} connectedChannels={data.connectedInput} />
    <header className="ether-node-header"><span className="ether-node-family">{familyLabel[family] ?? family}</span><span className="ether-node-subtype">{subtitle}</span></header>
    <div className="ether-node-main">{editing ? <input autoFocus className="ether-node-title-input nodrag" value={titleDraft} aria-label="Node title" onChange={(event) => setTitleDraft(event.target.value)} onBlur={() => { const nextTitle = titleDraft.trim(); setEditing(false); if (!data.readOnly && nextTitle && nextTitle !== node.title) data.onTitle(id, nextTitle); }} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); if (event.key === "Escape") { setTitleDraft(node.title); setEditing(false); } }} /> : <button type="button" className="ether-node-title" onDoubleClick={() => { if (!data.readOnly) { setTitleDraft(node.title); setEditing(true); } }} onClick={(event) => event.stopPropagation()} title={data.readOnly ? "Node title" : "Double click to rename"}>{node.title}</button>}<NodePreview node={node} /></div>
    <NodeStatusLayer status={data.status ?? null} />
    <footer className="ether-node-footer"><span>{node.presentation.collapsed ? "Collapsed" : "Ready"}</span><button type="button" className="nodrag" aria-label={`Delete ${node.title}`} disabled={data.readOnly} onClick={() => { if (!data.readOnly) data.onDelete(id); }}><Trash2 size={14} /></button></footer>
    <ChannelRail direction="output" nodeTitle={node.title} nodeDefinitionId={node.definitionId} connectedChannels={data.connectedOutput} />
  </article>;
});

export function ModuleNode({ id, data, selected }: NodeProps & { data: { title: string; collapsed: boolean; inputs: Array<{ id: string; channel: PayloadChannel }>; outputs: Array<{ id: string; channel: PayloadChannel }>; readOnly: boolean; onEnter(id: string): void; onToggle(id: string): void } }) {
  return <article className={`ether-module-node${selected ? " is-selected" : ""}`} data-testid="ether-module-node">
    {data.inputs.map((port, index) => <Handle key={`in-${port.id}`} id={`in:${port.id}`} type="target" position={Position.Left} style={{ top: `${18 + index * 18}px` }} aria-label={`Input ${port.id} ${port.channel}`} />)}
    <button type="button" className="ether-module-title nodrag" onDoubleClick={() => data.onEnter(id)}>{data.title}</button><p>{data.collapsed ? "Collapsed module" : "Double click to enter"}</p><button type="button" className="ether-module-collapse nodrag" disabled={data.readOnly} onClick={() => { if (!data.readOnly) data.onToggle(id); }}>{data.collapsed ? "Expand" : "Collapse"}</button>
    {data.outputs.map((port, index) => <Handle key={`out-${port.id}`} id={`out:${port.id}`} type="source" position={Position.Right} style={{ top: `${18 + index * 18}px` }} aria-label={`Output ${port.id} ${port.channel}`} />)}
  </article>;
}
