export const BLOCKED_OPENAI_ENV_KEYS = [
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "OPENAI_ORG_ID",
  "OPENAI_PROJECT",
  "AZURE_OPENAI_API_KEY",
  "AZURE_OPENAI_ENDPOINT",
  "OPENAI_API_TYPE",
  "OPENAI_API_VERSION"
] as const;

const blockedOpenAiEnvKeys = new Set(BLOCKED_OPENAI_ENV_KEYS.map((key) => key.toLowerCase()));

export function hasBlockedOpenAiEnvKey(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
) {
  return Object.entries(env).some(
    ([key, value]) => Boolean(value) && blockedOpenAiEnvKeys.has(key.toLowerCase())
  );
}

export function sanitizeProviderEnv(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
) {
  const sanitized: Record<string, string> = {};

  for (const [key, value] of Object.entries(env)) {
    if (typeof value !== "string") {
      continue;
    }

    if (blockedOpenAiEnvKeys.has(key.toLowerCase())) {
      continue;
    }

    sanitized[key] = value;
  }

  return sanitized;
}
