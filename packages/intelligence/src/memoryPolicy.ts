import type { MemoryPolicy } from "@ether/schema";
import { canonicalEncodeStringList, sha256Hex } from "@ether/graph-kernel";

export type MemoryScopeIdentity = {
  documentId: string;
  graphId: string;
  nodeId: string;
  lineageKey: string;
};

function memoryIdentity(kind: "node" | "branch", components: readonly string[]): string {
  const digest = sha256Hex(canonicalEncodeStringList(["ether-memory", "v1", kind, ...components]));
  return `memory:v1:${kind}:sha256:${digest}`;
}

export function resolveMemoryScopeKey(
  policy: MemoryPolicy,
  scope: MemoryScopeIdentity
): string | null {
  if (policy.mode === "stateless") return null;
  const nodeScope = [scope.documentId, scope.graphId, scope.nodeId];
  if (policy.mode === "per-node") return memoryIdentity("node", nodeScope);
  return memoryIdentity("branch", [...nodeScope, scope.lineageKey]);
}
