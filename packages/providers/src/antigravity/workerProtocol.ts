import path from "node:path";
import { sanitizeProviderEnv } from "../env.js";
import type { GenerationProviderInput, ProviderProcessCall } from "../types.js";

export const ANTIGRAVITY_MODEL = "Gemini 3.5 Flash (Medium)";

export const ANTIGRAVITY_PROFILE_IDS = [
  "nano-banana-2",
  "nano-banana-pro",
  "nano-banana-2-lite"
] as const;

export type AntigravityProfile = (typeof ANTIGRAVITY_PROFILE_IDS)[number];

export type AntigravityWorkerRequest = {
  profile: AntigravityProfile;
  prompt: string;
  attemptDirectory: string;
  logPath: string;
  timeoutMs: number;
  addDirectories: string[];
};

export function buildAntigravityPrompt(profile: AntigravityProfile, input: Pick<GenerationProviderInput, "prompt" | "negativePrompt">) {
  const profileName = profile === "nano-banana-2"
    ? "Nano Banana 2"
    : profile === "nano-banana-pro"
      ? "Nano Banana Pro"
      : "Nano Banana 2 Lite";
  const prompt = input.prompt.trim().slice(0, 12_000);
  const negative = input.negativePrompt.trim().slice(0, 4_000);
  return [
    "Use the built-in generative image tool exactly once.",
    `Generate exactly one image using ${profileName}.`,
    "Do not use terminal, file-write, browser, or any other tools.",
    "Report provider model identity only if it is explicitly returned by the provider.",
    "Do not claim a model identity from the prompt, filenames, or local files.",
    "Image request:",
    prompt || "Create a simple square color study.",
    negative ? `Avoid: ${negative}` : ""
  ].filter(Boolean).join("\n\n");
}

export function buildAntigravityProcessCall(input: {
  executablePath: string;
  env: NodeJS.ProcessEnv | Record<string, string | undefined>;
  projectPath: string;
  request: AntigravityWorkerRequest;
}): ProviderProcessCall {
  const args = ["--new-project", "--model", ANTIGRAVITY_MODEL];
  for (const directory of input.request.addDirectories) args.push("--add-dir", directory);
  args.push(
    "--print-timeout",
    `${Math.max(1, Math.ceil(input.request.timeoutMs / 1_000))}s`,
    "--log-file",
    input.request.logPath,
    "--print",
    input.request.prompt
  );
  return {
    command: input.executablePath,
    args,
    cwd: path.resolve(input.projectPath),
    env: sanitizeProviderEnv(input.env)
  };
}

/** Accept identity only from a labelled provider response, never from request text or artifact names. */
export function extractExplicitProviderIdentity(stdout: string) {
  const match = /^provider model identity:\s*([^\r\n]{1,160})$/im.exec(stdout);
  return match?.[1]?.trim() || null;
}
