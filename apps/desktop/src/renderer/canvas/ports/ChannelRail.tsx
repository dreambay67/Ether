import { useState, type CSSProperties } from "react";
import { Handle, Position } from "@xyflow/react";
import { PAYLOAD_CHANNELS, channelLabel, type PayloadChannel } from "./channelRegistry";

type ChannelRailProps = {
  direction: "input" | "output";
  nodeTitle: string;
  connectedChannels?: PayloadChannel[];
};

export function ChannelRail({ direction, nodeTitle, connectedChannels = [] }: ChannelRailProps) {
  const [activeChannel, setActiveChannel] = useState<PayloadChannel | null>(null);
  const isInput = direction === "input";

  return (
    <div
      className={`ether-channel-rail ether-channel-rail-${direction}`}
      aria-label={`${nodeTitle} ${isInput ? "input" : "output"} channels`}
    >
      {PAYLOAD_CHANNELS.map((channel, index) => {
        const label = channelLabel(channel);
        const isActive = activeChannel === channel;
        const isConnected = connectedChannels.includes(channel);

        return (
          <span
            key={channel}
            className={`channel-zone channel-zone-${direction} channel-zone-${channel} nodrag nopan${isActive ? " is-active" : ""}${isConnected ? " is-connected" : ""}`}
            data-testid={`channel-zone-${direction}-${channel}`}
            data-channel={channel}
            data-connected={isConnected ? "true" : "false"}
            title={`${label} ${isInput ? "input" : "output"} channel`}
            aria-label={`${nodeTitle} ${label} ${isInput ? "input" : "output"} channel`}
            tabIndex={0}
            style={{ "--channel-index": index } as CSSProperties}
            onMouseEnter={() => setActiveChannel(channel)}
            onMouseLeave={() => setActiveChannel((current) => (current === channel ? null : current))}
            onFocus={() => setActiveChannel(channel)}
            onBlur={() => setActiveChannel((current) => (current === channel ? null : current))}
          >
            <Handle
              id={channel}
              type={isInput ? "target" : "source"}
              position={isInput ? Position.Left : Position.Right}
              className={`channel-handle-dot channel-handle-${channel} nodrag nopan`}
              aria-label={`${label} ${isInput ? "input" : "output"} handle`}
              style={{ top: "50%" }}
            />
            {isActive ? <span className="channel-zone-label">{label}</span> : null}
          </span>
        );
      })}
    </div>
  );
}
