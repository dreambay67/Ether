import { createContext, useContext, useState } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  useReactFlow,
  type EdgeProps
} from "@xyflow/react";
import {
  CONNECTION_ROLES,
  PAYLOAD_CHANNELS,
  channelLabel,
  normalizeConnectionRole,
  normalizePayloadChannel,
  roleLabel,
  type ConnectionRole,
  type PayloadChannel
} from "../ports/channelRegistry";

type EtherEdgeCommands = {
  deleteEdgeById(id: string): void;
  setEdgeRole(id: string, role: ConnectionRole): void;
  setEdgeChannel(id: string, endpoint: EdgeChannelEndpoint, channel: PayloadChannel): void;
};

type EdgeChannelEndpoint = "source" | "target";

type EtherEdgeData = {
  label?: unknown;
  role?: unknown;
  sourceChannel?: unknown;
  targetChannel?: unknown;
};

export const EtherEdgeCommandContext = createContext<EtherEdgeCommands | null>(null);

function edgeData(data: unknown): EtherEdgeData {
  return data && typeof data === "object" ? data as EtherEdgeData : {};
}

function channelFromDataOrHandle(value: unknown, handle?: string | null): PayloadChannel {
  return normalizePayloadChannel(value) ?? normalizePayloadChannel(handle) ?? "text";
}

export function EtherEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  selected,
  style,
  data,
  label,
  sourceHandleId,
  targetHandleId
}: EdgeProps) {
  const edgeCommands = useContext(EtherEdgeCommandContext);
  const { setEdges, setNodes } = useReactFlow();
  const [isRoleGridOpen, setIsRoleGridOpen] = useState(false);
  const [channelPickerEndpoint, setChannelPickerEndpoint] = useState<EdgeChannelEndpoint | null>(null);
  const [dragChannelEndpoint, setDragChannelEndpoint] = useState<EdgeChannelEndpoint | null>(null);
  const details = edgeData(data);
  const role = normalizeConnectionRole(details.role ?? label ?? details.label);
  const sourceChannel = channelFromDataOrHandle(details.sourceChannel, sourceHandleId);
  const targetChannel = channelFromDataOrHandle(details.targetChannel, targetHandleId);
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition
  });

  const selectEdge = () => {
    setNodes((nodes) => nodes.map((node) => ({ ...node, selected: false })));
    setEdges((edges) => edges.map((edge) => ({ ...edge, selected: edge.id === id })));
  };

  const deleteEdge = () => {
    edgeCommands?.deleteEdgeById(id);
  };

  const chooseRole = (nextRole: ConnectionRole) => {
    edgeCommands?.setEdgeRole(id, nextRole);
    setIsRoleGridOpen(false);
  };

  const openChannelPicker = (endpoint: EdgeChannelEndpoint) => {
    selectEdge();
    setIsRoleGridOpen(false);
    setChannelPickerEndpoint(endpoint);
  };

  const chooseChannel = (endpoint: EdgeChannelEndpoint, channel: PayloadChannel) => {
    edgeCommands?.setEdgeChannel(id, endpoint, channel);
    setChannelPickerEndpoint(null);
    setDragChannelEndpoint(null);
  };

  const renderChannelDot = (endpoint: EdgeChannelEndpoint, channel: PayloadChannel) => {
    const endpointLabel = endpoint === "source" ? "source" : "target";

    return (
      <button
        type="button"
        className={`ether-edge-channel-dot ether-edge-channel-${channel}`}
        data-testid={`edge-channel-dot-${endpoint}`}
        title={`${channelLabel(channel)} ${endpointLabel} channel`}
        aria-label={`${endpointLabel} channel ${channelLabel(channel)}. Click to edit channel; right click to remove connection.`}
        aria-haspopup="menu"
        aria-expanded={channelPickerEndpoint === endpoint}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          openChannelPicker(endpoint);
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          deleteEdge();
        }}
        onPointerDown={(event) => {
          event.stopPropagation();

          if (event.button === 2) {
            event.preventDefault();
          }
        }}
        onWheel={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onKeyDown={(event) => {
          event.stopPropagation();

          if (event.key === "Enter" || event.key === " " || event.key === "ArrowDown") {
            event.preventDefault();
            openChannelPicker(endpoint);
            return;
          }

          if (event.key === "Escape") {
            event.preventDefault();
            setChannelPickerEndpoint(null);
            setDragChannelEndpoint(null);
          }
        }}
      />
    );
  };

  const pickerChannel = channelPickerEndpoint === "source" ? sourceChannel : targetChannel;

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          ...style,
          stroke: selected ? "var(--ether-channel-text)" : `var(--ether-channel-${sourceChannel})`,
          strokeWidth: selected ? 3 : 2
        }}
      />
      <EdgeLabelRenderer>
        <div
          className={`ether-edge-label nodrag nopan${selected ? " is-selected" : ""}${role !== "general" ? " is-named-role" : ""}`}
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          data-testid="edge-role-chip"
          data-source-channel={sourceChannel}
          data-target-channel={targetChannel}
          role="button"
          tabIndex={0}
          aria-label={`Connection role ${roleLabel(role)}. Click to choose role; right click to remove.`}
          onClick={(event) => {
            event.stopPropagation();
            selectEdge();
            setChannelPickerEndpoint(null);
            setDragChannelEndpoint(null);
            setIsRoleGridOpen((current) => !current);
          }}
          onPointerDown={(event) => event.stopPropagation()}
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
            deleteEdge();
          }}
          onWheel={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              selectEdge();
              setIsRoleGridOpen((current) => !current);
              return;
            }

            if (event.key === "Escape") {
              event.preventDefault();
              setIsRoleGridOpen(false);
              setChannelPickerEndpoint(null);
              setDragChannelEndpoint(null);
            }
          }}
        >
          <span className="ether-edge-channel-bundle">
            {renderChannelDot("source", sourceChannel)}
            {renderChannelDot("target", targetChannel)}
          </span>
          <span className="ether-edge-role-chip">{roleLabel(role)}</span>
          {channelPickerEndpoint ? (
            <div
              className={`ether-edge-channel-picker ether-edge-channel-picker-${channelPickerEndpoint}`}
              data-testid={`edge-channel-picker-${channelPickerEndpoint}`}
              role="menu"
              aria-label={`Set ${channelPickerEndpoint} channel`}
              onClick={(event) => event.stopPropagation()}
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
              onPointerDown={(event) => event.stopPropagation()}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === "Escape") {
                  event.preventDefault();
                  setChannelPickerEndpoint(null);
                  setDragChannelEndpoint(null);
                }
              }}
            >
              {PAYLOAD_CHANNELS.map((option) => (
                <button
                  key={option}
                  type="button"
                  role="menuitem"
                  aria-pressed={option === pickerChannel}
                  aria-label={`Set ${channelPickerEndpoint} channel ${channelLabel(option)}`}
                  className={option === pickerChannel ? "is-selected" : ""}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    chooseChannel(channelPickerEndpoint, option);
                  }}
                  onPointerUp={(event) => {
                    event.stopPropagation();
                    if (dragChannelEndpoint === channelPickerEndpoint && event.button === 2) {
                      event.preventDefault();
                      chooseChannel(channelPickerEndpoint, option);
                    }
                  }}
                  onKeyDown={(event) => {
                    event.stopPropagation();
                  }}
                >
                  <span className={`ether-edge-channel-dot ether-edge-channel-${option}`} aria-hidden="true" />
                  <span>{channelLabel(option)}</span>
                </button>
              ))}
            </div>
          ) : null}
          {isRoleGridOpen ? (
            <div
              className="ether-edge-role-grid"
              data-testid="edge-role-grid"
              role="menu"
              aria-label="Connection roles"
              onClick={(event) => event.stopPropagation()}
              onPointerDown={(event) => event.stopPropagation()}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === "Escape") {
                  event.preventDefault();
                  setIsRoleGridOpen(false);
                }
              }}
            >
              {CONNECTION_ROLES.map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={option === role}
                  aria-label={`Set role ${roleLabel(option)}`}
                  className={option === role ? "is-selected" : ""}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    chooseRole(option);
                  }}
                  onKeyDown={(event) => {
                    event.stopPropagation();
                  }}
                >
                  {roleLabel(option)}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
