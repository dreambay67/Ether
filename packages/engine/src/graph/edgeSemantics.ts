import {
  DEFAULT_CONNECTION_ROLE,
  channelLabel,
  isPayloadChannel,
  normalizeConnectionRole,
  normalizePayloadChannel,
  type ConnectionRole,
  type PayloadChannel
} from "./channels.js";

export const EDGE_GRAPH_VERSION = "2.5" as const;

export type EdgeAdapterOperation = "transcribe" | "caption" | "extract" | "interpret" | "transform";
export type EdgeAdapterStatus = "available" | "unavailable" | "blocked";

export type EdgeAdapter = {
  operation: EdgeAdapterOperation;
  providerId: string;
  status: EdgeAdapterStatus;
  reason?: string;
};

export type CanonicalEdgeData = {
  graphVersion: typeof EDGE_GRAPH_VERSION;
  sourceChannel: PayloadChannel;
  targetChannel: PayloadChannel;
  role: ConnectionRole;
  adapter?: EdgeAdapter;
  disabledReason?: string;
  migratedFrom?: Record<string, unknown>;
};

export type EdgeSemanticsResult = {
  allowed: boolean;
  reason?: string;
  sourceChannel?: PayloadChannel;
  targetChannel?: PayloadChannel;
  defaultRole: ConnectionRole;
  adapter?: EdgeAdapter;
  disabledReason?: string;
};

function disabledAdapter(
  operation: EdgeAdapterOperation,
  providerId: string,
  reason: string,
  status: EdgeAdapterStatus = "unavailable"
): { adapter: EdgeAdapter; disabledReason: string } {
  return {
    adapter: {
      operation,
      providerId,
      status,
      reason
    },
    disabledReason: reason
  };
}

export function canonicalRole(value: unknown): ConnectionRole {
  return normalizeConnectionRole(value);
}

export function canonicalChannel(value: unknown): PayloadChannel | undefined {
  if (isPayloadChannel(value)) {
    return value;
  }

  return normalizePayloadChannel(value);
}

export function resolveEdgeSemantics(
  sourceChannelValue: unknown,
  targetChannelValue: unknown,
  roleValue: unknown = DEFAULT_CONNECTION_ROLE
): EdgeSemanticsResult {
  const sourceChannel = canonicalChannel(sourceChannelValue);
  const targetChannel = canonicalChannel(targetChannelValue);
  const defaultRole = canonicalRole(roleValue);

  if (!sourceChannel || !targetChannel) {
    return {
      allowed: false,
      defaultRole,
      sourceChannel,
      targetChannel,
      reason: "Unknown payload channel for this connection."
    };
  }

  if (sourceChannel === targetChannel) {
    return {
      allowed: true,
      sourceChannel,
      targetChannel,
      defaultRole
    };
  }

  if (sourceChannel === "text" && targetChannel === "image") {
    return {
      allowed: true,
      sourceChannel,
      targetChannel,
      defaultRole
    };
  }

  if (sourceChannel === "image" && targetChannel === "text") {
    const adapter = disabledAdapter(
      "caption",
      "visual-description",
      "Image to Text connections require a caption or visual-description provider; this edge is disabled until one is configured."
    );

    return { allowed: true, sourceChannel, targetChannel, defaultRole, ...adapter };
  }

  if (sourceChannel === "audio" && targetChannel === "text") {
    const adapter = disabledAdapter(
      "transcribe",
      "audio-transcription",
      "Audio to Text connections require an audio transcription provider; this edge is disabled until one is configured."
    );

    return { allowed: true, sourceChannel, targetChannel, defaultRole, ...adapter };
  }

  if (sourceChannel === "video" && targetChannel === "text") {
    const adapter = disabledAdapter(
      "caption",
      "video-caption",
      "Video to Text connections require a video caption or transcription provider; this edge is disabled until one is configured."
    );

    return { allowed: true, sourceChannel, targetChannel, defaultRole, ...adapter };
  }

  if (sourceChannel === "video" && targetChannel === "image") {
    const adapter = disabledAdapter(
      "extract",
      "video-frame-extraction",
      "Video to Image connections require a frame extraction provider; this edge is disabled until one is configured."
    );

    return { allowed: true, sourceChannel, targetChannel, defaultRole, ...adapter };
  }

  if (sourceChannel === "data" && targetChannel === "mask") {
    const adapter = disabledAdapter(
      "transform",
      "mask-rasterization",
      "Data to Mask connections require a transform/rasterization provider; this edge is disabled until one is configured."
    );

    return { allowed: true, sourceChannel, targetChannel, defaultRole, ...adapter };
  }

  if (sourceChannel === "text" && targetChannel === "audio") {
    const adapter = disabledAdapter(
      "transform",
      "text-to-audio",
      "Text to Audio connections require a configured audio provider; this edge is disabled until one is configured.",
      "blocked"
    );

    return { allowed: true, sourceChannel, targetChannel, defaultRole, ...adapter };
  }

  const reason = `No adapter is configured for ${channelLabel(sourceChannel)} to ${channelLabel(targetChannel)} connections.`;

  return {
    allowed: false,
    sourceChannel,
    targetChannel,
    defaultRole,
    reason,
    disabledReason: reason
  };
}
