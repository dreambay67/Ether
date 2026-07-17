import type { ConnectionRole, PayloadEnvelope } from "@ether/schema";

export const roleCaptions: Record<ConnectionRole, string> = {
  general: "General", negative: "Negative", subject: "Subject", product: "Product", face: "Face",
  clothing: "Clothing", pose: "Pose", setting: "Setting", composition: "Composition", style: "Style",
  lighting: "Lighting", colourPalette: "Colour Palette", typography: "Typography", motion: "Motion", timing: "Timing"
};

function shortHash(values: readonly string[]): string {
  let hash = 2_166_136_261;
  for (const character of values.join("\u001f")) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16_777_619) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export function deriveLineageKey(lanes: readonly { edgeId: string; payloads: readonly PayloadEnvelope[] }[]): string {
  const keys = [...new Set(lanes.flatMap((lane) => lane.payloads.map((payload) => payload.source.lineageKey)))].sort();
  if (lanes.length === 1 && keys.length === 1) return keys[0]!;
  return `fanin:${shortHash(keys)}`;
}

export function numberDirectRoles<T extends { role: ConnectionRole; edgeId: string; order: number }>(lanes: readonly T[]): Array<T & { caption: string; ordinal: number }> {
  const counts = new Map<ConnectionRole, number>();
  return [...lanes].sort((left, right) => left.order - right.order || left.edgeId.localeCompare(right.edgeId)).map((lane) => {
    const ordinal = (counts.get(lane.role) ?? 0) + 1;
    counts.set(lane.role, ordinal);
    const base = roleCaptions[lane.role];
    return { ...lane, ordinal, caption: ordinal === 1 ? base : `${base} ${ordinal}` };
  });
}
