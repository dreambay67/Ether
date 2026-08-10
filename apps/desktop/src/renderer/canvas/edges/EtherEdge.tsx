import { useState, type FocusEvent } from "react";
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from "@xyflow/react";
import type { ConnectionRole, EtherEdge as SchemaEdge, PayloadChannel } from "@ether/schema";
import { CONNECTION_ROLES, PAYLOAD_CHANNELS, channelLabel, roleLabel } from "../ports/channelRegistry";
import { bundledBezierPath, edgeLabelPlacement, type EdgeBounds } from "./edgeGeometry";

export type EtherEdgeEditor = "role" | "source" | "target" | null;
export type EtherFlowEdgeData = {
  edge: SchemaEdge;
  editor: EtherEdgeEditor;
  readOnly: boolean;
  selected: boolean;
  laneIndex: number;
  laneCount: number;
  sourceBounds?: EdgeBounds;
  targetBounds?: EdgeBounds;
  compatibleSourceChannels: PayloadChannel[];
  compatibleTargetChannels: PayloadChannel[];
  onDelete(id: string): void;
  onRole(id: string, role: ConnectionRole): void;
  onChannel(id: string, endpoint: "source" | "target", channel: PayloadChannel): void;
  onEdit(id: string, editor: EtherEdgeEditor): void;
  onSelect(id: string): void;
};
export function EtherEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, data }: EdgeProps & { data: EtherFlowEdgeData }) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const edge = data.edge;
  const bundled = bundledBezierPath({ x: sourceX, y: sourceY, targetX, targetY, lane: { index: data.laneIndex, count: data.laneCount } });
  const [defaultPath, defaultLabelX, defaultLabelY] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });
  const path = bundled?.path ?? defaultPath;
  const source = edge.from.channel;
  const target = edge.to.channel;
  const labelPosition = edgeLabelPlacement({ x: sourceX, y: sourceY, targetX, targetY, lane: { index: data.laneIndex, count: data.laneCount }, sourceBounds: data.sourceBounds, targetBounds: data.targetBounds });
  const rolesOpen = data.editor === "role";
  const picker = data.editor === "source" || data.editor === "target" ? data.editor : null;
  const labelVisible = hovered || focused || data.selected || edge.role !== "general";
  const compatible = (endpoint: "source" | "target", channel: PayloadChannel) => (endpoint === "source" ? data.compatibleSourceChannels : data.compatibleTargetChannels).includes(channel);
  const chooseChannel = (endpoint: "source" | "target", channel: PayloadChannel) => { if (!data.readOnly && compatible(endpoint, channel)) data.onChannel(id, endpoint, channel); data.onEdit(id, null); };
  const openPicker = (endpoint: "source" | "target") => { if (!data.readOnly) data.onEdit(id, endpoint); };
  const leaveDisclosure = (event: FocusEvent<HTMLDivElement>) => {
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
    setFocused(false);
  };
  const hitStrokeWidth = data.laneCount > 1 ? Math.max(12, Math.min(18, 96 / data.laneCount - 3)) : 18;
  return <><path d={path} fill="none" stroke="transparent" strokeWidth={hitStrokeWidth} className="ether-edge-hit-target" data-lane-index={data.laneIndex} data-lane-count={data.laneCount} onClick={(event) => { event.stopPropagation(); data.onSelect(id); }} onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); if (!data.readOnly) data.onDelete(id); }} /><BaseEdge id={id} path={path} markerEnd={markerEnd} style={{ stroke: `var(--ether-channel-${source})`, strokeWidth: data.selected ? 3 : 2 }} />
    <EdgeLabelRenderer><div className={`ether-edge-label nodrag nopan${data.selected ? " is-selected" : ""}${edge.role !== "general" ? " is-named-role" : ""}${focused ? " is-focused" : ""}`} style={{ transform: `translate(-50%, -50%) translate(${labelPosition.x ?? defaultLabelX}px, ${labelPosition.y ?? defaultLabelY}px)`, opacity: labelVisible ? 1 : 0 }} data-testid="edge-role-chip" data-lane-index={data.laneIndex} data-lane-count={data.laneCount} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} onFocus={() => setFocused(true)} onBlur={leaveDisclosure} onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); if (!data.readOnly) data.onDelete(id); }}>
      <button type="button" disabled={data.readOnly} className={`ether-edge-channel-dot ether-edge-channel-${source}`} aria-label={`Source channel ${channelLabel(source)}`} aria-haspopup="menu" aria-expanded={picker === "source"} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); openPicker("source"); }} onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); if (!data.readOnly) data.onDelete(id); }} />
      <button type="button" disabled={data.readOnly} className={`ether-edge-role-chip${edge.role === "general" ? " is-general-role" : ""}`} aria-haspopup="menu" aria-expanded={rolesOpen} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); if (!data.readOnly) data.onEdit(id, rolesOpen ? null : "role"); }}>{edge.role === "general" ? <><span className="sr-only">General</span><span aria-hidden="true">•</span></> : roleLabel(edge.role)}</button>
      <button type="button" disabled={data.readOnly} className={`ether-edge-channel-dot ether-edge-channel-${target}`} aria-label={`Target channel ${channelLabel(target)}`} aria-haspopup="menu" aria-expanded={picker === "target"} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); openPicker("target"); }} onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); if (!data.readOnly) data.onDelete(id); }} />
      {rolesOpen ? <div className="ether-edge-role-grid" data-testid="edge-role-grid" role="menu" aria-label="Connection roles" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()} onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); }} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); data.onEdit(id, null); } }}>{CONNECTION_ROLES.map((role) => <button key={role} type="button" disabled={data.readOnly} aria-pressed={role === edge.role} onClick={() => { if (!data.readOnly) data.onRole(id, role); data.onEdit(id, null); }}>{roleLabel(role)}</button>)}</div> : null}
      {picker ? <div className="ether-edge-channel-picker" role="menu" aria-label={`${picker === "source" ? "Source" : "Target"} compatible channels`} data-testid={`edge-channel-picker-${picker}`} onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); }} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); data.onEdit(id, null); } }}>{PAYLOAD_CHANNELS.map((channel) => { const allowed = compatible(picker, channel); return <button key={channel} type="button" disabled={data.readOnly || !allowed} aria-disabled={!allowed} title={allowed ? `Move endpoint to ${channelLabel(channel)}` : `${channelLabel(channel)} is unavailable for this endpoint`} onClick={() => chooseChannel(picker, channel)}><span className={`ether-edge-channel-dot ether-edge-channel-${channel}`} />{channelLabel(channel)}</button>; })}</div> : null}
    </div></EdgeLabelRenderer></>;
}
