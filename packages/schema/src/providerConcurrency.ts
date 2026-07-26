/**
 * Ether's fixed application-wide provider capacity contract.
 *
 * Known provider families must expose these effective limits when usable.
 * Every other provider fails closed to one active call.
 */
export const SAFE_GLOBAL_PARALLELISM = 8;
export const SAFE_CODEX_PROVIDER_PARALLELISM = 4;
export const SAFE_ANTIGRAVITY_PROVIDER_PARALLELISM = 4;
export const SAFE_UNKNOWN_PROVIDER_PARALLELISM = 1;
