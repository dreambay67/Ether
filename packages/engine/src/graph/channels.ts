export const PAYLOAD_CHANNELS = ["text", "image", "mask", "data", "video", "audio"] as const;

export type PayloadChannel = (typeof PAYLOAD_CHANNELS)[number];

export const CONNECTION_ROLES = [
  "general",
  "negative",
  "subject",
  "product",
  "face",
  "clothing",
  "pose",
  "setting",
  "composition",
  "style",
  "lighting",
  "colourPalette",
  "typography",
  "motion",
  "timing"
] as const;

export type ConnectionRole = (typeof CONNECTION_ROLES)[number];

export const DEFAULT_CONNECTION_ROLE: ConnectionRole = "general";

const PAYLOAD_CHANNEL_SET = new Set<string>(PAYLOAD_CHANNELS);
const CONNECTION_ROLE_SET = new Set<string>(CONNECTION_ROLES);

const PAYLOAD_CHANNEL_ALIASES = new Map<string, PayloadChannel>([
  ["prompt", "text"],
  ["text", "text"],
  ["note", "text"],
  ["negativeprompt", "text"],
  ["assembledprompt", "text"],
  ["reference", "image"],
  ["image", "image"],
  ["editedimage", "image"],
  ["outputimage", "image"],
  ["metadata", "data"],
  ["data", "data"],
  ["collection", "data"],
  ["route", "data"],
  ["evaluation", "data"],
  ["filterrule", "data"],
  ["compare", "data"],
  ["json", "data"],
  ["mask", "mask"],
  ["matte", "mask"],
  ["selection", "mask"],
  ["video", "video"],
  ["clip", "video"],
  ["movie", "video"],
  ["audio", "audio"],
  ["sound", "audio"],
  ["voice", "audio"],
  ["music", "audio"]
]);

const CONNECTION_ROLE_ALIASES = new Map<string, ConnectionRole>([
  ["general", "general"],
  ["context", "general"],
  ["prompt", "general"],
  ["instruction", "general"],
  ["reference", "general"],
  ["custom", "general"],
  ["unknown", "general"],
  ["negative", "negative"],
  ["negativeprompt", "negative"],
  ["exclude", "negative"],
  ["avoid", "negative"],
  ["subject", "subject"],
  ["product", "product"],
  ["face", "face"],
  ["clothing", "clothing"],
  ["pose", "pose"],
  ["setting", "setting"],
  ["composition", "composition"],
  ["style", "style"],
  ["lighting", "lighting"],
  ["colourpalette", "colourPalette"],
  ["colour", "colourPalette"],
  ["color", "colourPalette"],
  ["palette", "colourPalette"],
  ["colorpalette", "colourPalette"],
  ["typography", "typography"],
  ["type", "typography"],
  ["font", "typography"],
  ["motion", "motion"],
  ["movement", "motion"],
  ["action", "motion"],
  ["cameramove", "motion"],
  ["timing", "timing"],
  ["rhythm", "timing"],
  ["pace", "timing"],
  ["duration", "timing"],
  ["time", "timing"],
  ["timecode", "timing"]
]);

const CHANNEL_LABELS: Record<PayloadChannel, string> = {
  text: "Text",
  image: "Image",
  mask: "Mask",
  data: "Data",
  video: "Video",
  audio: "Audio"
};

const ROLE_LABELS: Record<ConnectionRole, string> = {
  general: "General",
  negative: "Negative",
  subject: "Subject",
  product: "Product",
  face: "Face",
  clothing: "Clothing",
  pose: "Pose",
  setting: "Setting",
  composition: "Composition",
  style: "Style",
  lighting: "Lighting",
  colourPalette: "Colour palette",
  typography: "Typography",
  motion: "Motion",
  timing: "Timing"
};

function aliasKey(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  return value.trim().toLowerCase();
}

export function isPayloadChannel(value: unknown): value is PayloadChannel {
  return typeof value === "string" && PAYLOAD_CHANNEL_SET.has(value);
}

export function isConnectionRole(value: unknown): value is ConnectionRole {
  return typeof value === "string" && CONNECTION_ROLE_SET.has(value);
}

export function normalizePayloadChannel(value: unknown): PayloadChannel | undefined {
  const key = aliasKey(value);

  if (!key) {
    return undefined;
  }

  return PAYLOAD_CHANNEL_ALIASES.get(key);
}

export function normalizeConnectionRole(value: unknown): ConnectionRole {
  const key = aliasKey(value);

  if (!key) {
    return DEFAULT_CONNECTION_ROLE;
  }

  return CONNECTION_ROLE_ALIASES.get(key) ?? DEFAULT_CONNECTION_ROLE;
}

export function channelLabel(channel: PayloadChannel): string {
  return CHANNEL_LABELS[channel];
}

export function roleLabel(role: ConnectionRole): string {
  return ROLE_LABELS[role];
}
