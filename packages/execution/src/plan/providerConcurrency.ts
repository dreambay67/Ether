import type { ProviderBinding } from "@ether/schema";

export const SAFE_GLOBAL_PARALLELISM = 8;
export const SAFE_UNKNOWN_PROVIDER_PARALLELISM = 1;

export function providerConcurrencyGroup(providerId: string): string {
  if (providerId.startsWith("codex-")) return "codex";
  if (providerId.startsWith("google-nano-banana-")) return "antigravity";
  return providerId;
}

export function providerParallelismLimit(binding: ProviderBinding): number {
  const advertised = binding.capabilitySnapshot.maxParallelism
    ?? SAFE_UNKNOWN_PROVIDER_PARALLELISM;
  return Math.min(Math.max(Math.trunc(advertised), 1), SAFE_GLOBAL_PARALLELISM);
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
