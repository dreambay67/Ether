import type { EdgeAdapter, PayloadChannel, ResolvedAdapter } from "@ether/schema";

export type AdapterDefinition = ResolvedAdapter & { id: string; priority: number; semantic: boolean };

export const adapterDefinitions: readonly AdapterDefinition[] = [
  { id: "codex.image-to-text", adapterId: "codex.image-to-text", fromChannel: "image", toChannel: "text", requiredCapability: "codex.vision", priority: 10, semantic: true },
  { id: "native.audio-to-text", adapterId: "native.audio-to-text", fromChannel: "audio", toChannel: "text", requiredCapability: "native.transcription", priority: 10, semantic: true },
  { id: "codex.audio-to-text", adapterId: "codex.audio-to-text", fromChannel: "audio", toChannel: "text", requiredCapability: "codex.audio", priority: 20, semantic: true },
  { id: "codex.video-to-text", adapterId: "codex.video-to-text", fromChannel: "video", toChannel: "text", requiredCapability: "codex.video", priority: 10, semantic: true },
  { id: "local.video-to-image", adapterId: "local.video-to-image", fromChannel: "video", toChannel: "image", requiredCapability: null, priority: 10, semantic: false },
  { id: "local.video-to-audio", adapterId: "local.video-to-audio", fromChannel: "video", toChannel: "audio", requiredCapability: null, priority: 10, semantic: false },
  ...(["image", "audio", "video"] as const).flatMap((channel, index) => [
    { id: `local.${channel}-to-data`, adapterId: `local.${channel}-to-data`, fromChannel: channel, toChannel: "data" as const, requiredCapability: null, priority: 10 + index, semantic: false },
    { id: `codex.${channel}-to-semantic-data`, adapterId: `codex.${channel}-to-semantic-data`, fromChannel: channel, toChannel: "data" as const, requiredCapability: `codex.${channel}`, priority: 20 + index, semantic: true }
  ]),
  { id: "local.text-to-data", adapterId: "local.text-to-data", fromChannel: "text", toChannel: "data", requiredCapability: null, priority: 10, semantic: false },
  { id: "local.data-to-text", adapterId: "local.data-to-text", fromChannel: "data", toChannel: "text", requiredCapability: null, priority: 10, semantic: false },
  { id: "local.mask-to-data", adapterId: "local.mask-to-data", fromChannel: "mask", toChannel: "data", requiredCapability: null, priority: 10, semantic: false },
  { id: "local.data-to-mask", adapterId: "local.data-to-mask", fromChannel: "data", toChannel: "mask", requiredCapability: null, priority: 10, semantic: false }
];

export const FULL_ADAPTER_CAPABILITIES = ["codex.vision", "native.transcription", "codex.audio", "codex.video", "codex.image"] as const;

export function adapterCandidates(from: PayloadChannel, to: PayloadChannel): AdapterDefinition[] {
  return adapterDefinitions.filter((adapter) => adapter.fromChannel === from && adapter.toChannel === to).sort((left, right) => left.priority - right.priority || left.id.localeCompare(right.id));
}

export function resolveAdapter(from: PayloadChannel, to: PayloadChannel, selection: EdgeAdapter | "auto", capabilities: ReadonlySet<string>): AdapterDefinition | null {
  if (from === to) return null;
  const candidates = adapterCandidates(from, to);
  const selected = selection === "auto" || selection.kind === "auto" ? candidates.find((candidate) => candidate.requiredCapability === null || capabilities.has(candidate.requiredCapability)) : candidates.find((candidate) => candidate.id === selection.adapterId);
  return selected ?? null;
}
