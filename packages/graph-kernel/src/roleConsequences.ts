import type { ConnectionRole, PayloadEnvelope } from "@ether/schema";
import { canonicalEncodeStringList, sha256Hex } from "./lineageIdentity.js";

export const roleCaptions: Record<ConnectionRole, string> = {
  general: "General", negative: "Negative", subject: "Subject", product: "Product", face: "Face",
  clothing: "Clothing", pose: "Pose", setting: "Setting", composition: "Composition", style: "Style",
  lighting: "Lighting", colourPalette: "Colour Palette", typography: "Typography", motion: "Motion", timing: "Timing"
};

const LINEAGE_KEY_VERSION = "v2";

function derivedLineageKey(kind: "empty" | "fanin", values: readonly string[]): string {
  return `${kind}:${LINEAGE_KEY_VERSION}:sha256:${sha256Hex(canonicalEncodeStringList(values))}`;
}

/**
 * Derived identities use `fanin:v2:sha256:<64 lowercase hex>` or
 * `empty:v2:sha256:<64 lowercase hex>`. A single non-empty source lineage key
 * remains unchanged so source identity preservation continues to work.
 */
export function deriveLineageKey(lanes: readonly { edgeId: string; payloads: readonly PayloadEnvelope[] }[]): string {
  const keys = [...new Set(lanes.flatMap((lane) => lane.payloads.map((payload) => payload.source.lineageKey)))].sort();
  if (lanes.length === 1 && keys.length === 1 && keys[0]!.length > 0) return keys[0]!;
  if (keys.length === 0) return derivedLineageKey("empty", lanes.map((lane) => lane.edgeId).sort());
  return derivedLineageKey("fanin", keys);
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
