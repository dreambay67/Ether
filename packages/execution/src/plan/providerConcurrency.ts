import {
  SAFE_ANTIGRAVITY_PROVIDER_PARALLELISM,
  SAFE_CODEX_PROVIDER_PARALLELISM,
  SAFE_GLOBAL_PARALLELISM,
  SAFE_UNKNOWN_PROVIDER_PARALLELISM,
  type ProviderBinding
} from "@ether/schema";

export {
  SAFE_ANTIGRAVITY_PROVIDER_PARALLELISM,
  SAFE_CODEX_PROVIDER_PARALLELISM,
  SAFE_GLOBAL_PARALLELISM,
  SAFE_UNKNOWN_PROVIDER_PARALLELISM
} from "@ether/schema";

export function providerConcurrencyGroup(providerId: string): string {
  if (providerId.startsWith("codex-")) return "codex";
  if (providerId.startsWith("google-nano-banana-")) return "antigravity";
  return providerId;
}

export function providerParallelismLimit(binding: ProviderBinding): number {
  const group = providerConcurrencyGroup(binding.providerId);
  if (group === "codex") return SAFE_CODEX_PROVIDER_PARALLELISM;
  if (group === "antigravity") return SAFE_ANTIGRAVITY_PROVIDER_PARALLELISM;
  return SAFE_UNKNOWN_PROVIDER_PARALLELISM;
}

export function combinedProviderParallelismLimit(
  bindings: readonly ProviderBinding[]
): number {
  if (bindings.length === 0) return SAFE_GLOBAL_PARALLELISM;
  const limits = new Map<string, number>();
  for (const binding of bindings) {
    const group = providerConcurrencyGroup(binding.providerId);
    const limit = providerParallelismLimit(binding);
    limits.set(group, Math.min(limits.get(group) ?? limit, limit));
  }
  return [...limits.values()].reduce((total, limit) => total + limit, 0);
}
