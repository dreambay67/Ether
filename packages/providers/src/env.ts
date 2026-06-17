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

export function hasBlockedOpenAiEnvKey(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
) {
  return BLOCKED_OPENAI_ENV_KEYS.some((key) => Boolean(env[key]));
}

export function sanitizeProviderEnv(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
) {
  const sanitized: Record<string, string> = {};

  for (const [key, value] of Object.entries(env)) {
    if (typeof value !== "string") {
      continue;
    }

    if ((BLOCKED_OPENAI_ENV_KEYS as readonly string[]).includes(key)) {
      continue;
    }

    sanitized[key] = value;
  }

  return sanitized;
}
