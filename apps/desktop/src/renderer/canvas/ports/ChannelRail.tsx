import { useState, type CSSProperties, type FocusEvent } from "react";
import { Handle, Position } from "@xyflow/react";
import type { NodeDefinitionId, PayloadChannel } from "@ether/schema";
import { PAYLOAD_CHANNELS, channelLabel, channelsFor } from "./channelRegistry";

export function ChannelRail({ direction, nodeTitle, nodeDefinitionId, connectedChannels = [], intentChannels = null, disabled = false, onActivate }: {
  direction: "input" | "output";
  nodeTitle: string;
  nodeDefinitionId: NodeDefinitionId;
  connectedChannels?: PayloadChannel[];
  intentChannels?: readonly PayloadChannel[] | null;
  disabled?: boolean;
  onActivate?(channel: PayloadChannel): void;
}) {
  const [revealed, setRevealed] = useState(false);
  const [focusedChannel, setFocusedChannel] = useState<PayloadChannel | null>(null);
  const available = channelsFor(nodeDefinitionId, direction);
  const intentActive = intentChannels !== null;
  const handleRailBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
    setFocusedChannel(null);
    setRevealed(false);
  };
  return <div className={`ether-channel-rail ether-channel-rail-${direction}${revealed ? " is-revealed" : ""}${intentActive ? " is-connection-intent" : ""}`} onMouseEnter={() => setRevealed(true)} onMouseLeave={() => setRevealed(false)} onFocus={() => setRevealed(true)} onBlur={handleRailBlur} aria-label={`${nodeTitle} ${direction} channels`}>
    {PAYLOAD_CHANNELS.map((channel, index) => {
      const connected = connectedChannels.includes(channel);
      const supported = available.includes(channel);
      const compatible = intentChannels?.includes(channel) ?? false;
      const focused = focusedChannel === channel;
      const blockedByIntent = intentActive && !compatible && !focused;
      const interactive = !disabled && !blockedByIntent;
      const visible = supported && (connected || revealed || compatible || focused);
      const top = `${((index + 1) / (PAYLOAD_CHANNELS.length + 1)) * 100}%`;
      return <span key={channel} className={`channel-zone channel-zone-${direction} channel-zone-${channel}${connected ? " is-connected" : ""}${supported ? " is-supported" : ""}${compatible ? " is-compatible" : ""} nodrag nopan`} data-testid={`channel-zone-${direction}-${channel}`} data-connected={connected ? "true" : "false"} data-compatible={compatible ? "true" : "false"} data-visible={visible ? "true" : "false"} data-keyboard-blocked={blockedByIntent ? "true" : "false"} style={{ "--channel-index": index, position: "absolute", top, transform: "translateY(-50%)" } as CSSProperties}>
        {supported ? <Handle id={channel} type={direction === "input" ? "target" : "source"} position={direction === "input" ? Position.Left : Position.Right} className={`channel-handle-dot channel-handle-${channel}`} aria-label={`${channelLabel(channel)} ${direction}`} aria-disabled={!interactive} role="button" tabIndex={interactive ? 0 : -1} isConnectable={interactive} onFocus={() => setFocusedChannel(channel)} onBlur={(event) => { if (!(event.relatedTarget instanceof Node && event.currentTarget.parentElement?.parentElement?.contains(event.relatedTarget))) setFocusedChannel(null); }} onClick={(event) => { event.stopPropagation(); if (interactive) onActivate?.(channel); }} onKeyDown={(event) => { if (interactive && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); event.currentTarget.click(); } }} style={{ top: "50%", opacity: visible ? 1 : 0, pointerEvents: visible ? "auto" : "none" }} /> : null}
        <span className="channel-zone-label">{channelLabel(channel)}</span>
      </span>;
    })}
  </div>;
}
