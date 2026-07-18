import type { MemoryPolicy } from "@ether/schema";

export function resolveMemoryScopeKey(
  policy: MemoryPolicy,
  nodeId: string,
  lineageKey: string
): string | null {
  if (policy.mode === "stateless") return null;
  if (policy.mode === "per-node") return `node:${nodeId}`;
  return `branch:${lineageKey}`;
}
