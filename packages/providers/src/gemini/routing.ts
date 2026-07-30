import { GEMINI_IMAGE_PROVIDER_IDS, type GeminiImageProfile } from "./imageProvider.js";

/**
 * Keeps persisted route identity deliberate: old concrete IDs stay on the
 * explicit Antigravity route, while historical logical/default aliases select
 * the new Gemini API normal route. This function never infers from a display
 * label or an error condition.
 */
export function resolveGoogleImageProviderAlias(providerId: string, profileId?: string) {
  if (providerId === "google-nano-banana" || providerId === "google-nano-banana-default") {
    const profile = profileId === "nano-banana-pro" || profileId === "nano-banana-2-lite"
      ? profileId
      : "nano-banana-2";
    return {
      providerId: GEMINI_IMAGE_PROVIDER_IDS[profile as GeminiImageProfile],
      route: "gemini-api" as const,
      migratedLogicalAlias: true
    };
  }
  if (Object.values(GEMINI_IMAGE_PROVIDER_IDS).includes(providerId as typeof GEMINI_IMAGE_PROVIDER_IDS[GeminiImageProfile]) || providerId.startsWith("google-nano-banana-")) {
    return { providerId, route: providerId.startsWith("google-gemini-api-") ? "gemini-api" as const : "antigravity-fallback" as const, migratedLogicalAlias: false };
  }
  return { providerId, route: "other" as const, migratedLogicalAlias: false };
}

export const DEFAULT_GOOGLE_NANO_BANANA_PROVIDER_ID = GEMINI_IMAGE_PROVIDER_IDS["nano-banana-2"];
