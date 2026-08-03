import { useState, type CSSProperties } from "react";
import { Handle, Position } from "@xyflow/react";
import type { NodeDefinitionId, PayloadChannel } from "@ether/schema";
import { PAYLOAD_CHANNELS, channelLabel, channelsFor } from "./channelRegistry";

export function ChannelRail({ direction, nodeTitle, nodeDefinitionId, connectedChannels = [], intentChannels = null, disabled = false }: {
  direction: "input" | "output";
  nodeTitle: string;
  nodeDefinitionId: NodeDefinitionId;
  connectedChannels?: PayloadChannel[];
  intentChannels?: readonly PayloadChannel[] | null;
  disabled?: boolean;
}) {
  const [revealed, setRevealed] = useState(false); const available = channelsFor(nodeDefinitionId, direction);
  const intentActive = intentChannels !== null;
  return <div className={`ether-channel-rail ether-channel-rail-${direction}${revealed ? " is-revealed" : ""}${intentActive ? " is-connection-intent" : ""}`} onMouseEnter={() => setRevealed(true)} onMouseLeave={() => setRevealed(false)} onFocus={() => setRevealed(true)} onBlur={() => setRevealed(false)} aria-label={`${nodeTitle} ${direction} channels`}>
    {PAYLOAD_CHANNELS.map((channel, index) => { const connected = connectedChannels.includes(channel); const supported = available.includes(channel); const compatible = intentChannels?.includes(channel) ?? false; return <span key={channel} className={`channel-zone channel-zone-${direction} channel-zone-${channel}${connected ? " is-connected" : ""}${supported ? " is-supported" : ""}${compatible ? " is-compatible" : ""} nodrag nopan`} data-testid={`channel-zone-${direction}-${channel}`} data-connected={connected ? "true" : "false"} data-compatible={compatible ? "true" : "false"} style={{ "--channel-index": index } as CSSProperties}>{supported ? <Handle id={channel} type={direction === "input" ? "target" : "source"} position={direction === "input" ? Position.Left : Position.Right} className={`channel-handle-dot channel-handle-${channel}`} aria-label={`${channelLabel(channel)} ${direction}`} aria-disabled={disabled} role="button" tabIndex={disabled ? -1 : 0} onKeyDown={(event) => { if (!disabled && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); event.currentTarget.click(); } }} style={{ top: "50%" }} /> : null}<span className="channel-zone-label">{channelLabel(channel)}</span></span>; })}
  </div>;
}
