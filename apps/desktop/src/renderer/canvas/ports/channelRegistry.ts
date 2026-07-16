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
export const EDGE_GRAPH_VERSION = "2.5" as const;

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

const CHANNEL_ALIASES = new Map<string, PayloadChannel>([
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

const ROLE_ALIASES = new Map<string, ConnectionRole>([
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

function aliasKey(value: unknown): string | undefined {
  return typeof value === "string" ? value.trim().toLowerCase() : undefined;
}

export function normalizePayloadChannel(value: unknown): PayloadChannel | undefined {
  const key = aliasKey(value);

  return key ? CHANNEL_ALIASES.get(key) : undefined;
}

export function normalizeConnectionRole(value: unknown): ConnectionRole {
  const key = aliasKey(value);

  return key ? ROLE_ALIASES.get(key) ?? DEFAULT_CONNECTION_ROLE : DEFAULT_CONNECTION_ROLE;
}

export function channelLabel(channel: PayloadChannel) {
  return CHANNEL_LABELS[channel];
}

export function roleLabel(role: ConnectionRole) {
  return ROLE_LABELS[role];
}
