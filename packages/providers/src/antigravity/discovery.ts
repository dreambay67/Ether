import { access } from "node:fs/promises";
import path from "node:path";
import { sanitizeProviderEnv } from "../env.js";
import type { ProviderProcessCall } from "../types.js";
import { runAntigravityProcess, redactSensitiveText } from "./processRunner.js";

export type AntigravityCliDiscovery = {
  executablePath: string | null;
  version: string | null;
  authenticated: boolean;
  visibleModels: string[];
  authentication: "unverified" | "probe-verified";
  message: string | null;
};

export type AntigravityCliDiscoveryOptions = {
  executablePath?: string;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  fileExists?: (filePath: string) => Promise<boolean> | boolean;
  /** Explicitly reserved for a user-initiated Connect or live conformance action. */
  authProbe?: boolean;
  run?: (call: ProviderProcessCall) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
};

const localInstall = (env: NodeJS.ProcessEnv | Record<string, string | undefined>) => {
  const root = env.LOCALAPPDATA ?? process.env.LOCALAPPDATA;
  return root ? path.join(root, "agy", "bin", process.platform === "win32" ? "agy.exe" : "agy") : null;
};

export async function resolveAntigravityCliPath(options: AntigravityCliDiscoveryOptions = {}) {
  const env = options.env ?? process.env;
  const exists = options.fileExists ?? fileExists;
  const names = process.platform === "win32" ? ["agy.exe", "agy"] : ["agy"];
  const fromPath = (env.PATH ?? process.env.PATH ?? "").split(path.delimiter).flatMap((directory) =>
    names.map((name) => path.join(directory, name))
  );
  const candidates = [options.executablePath, env.ANTIGRAVITY_CLI_PATH, localInstall(env), ...fromPath]
    .filter((candidate): candidate is string => Boolean(candidate));
  for (const candidate of [...new Set(candidates)]) {
    if (await exists(candidate)) return candidate;
  }
  return null;
}

export async function discoverAntigravityCli(options: AntigravityCliDiscoveryOptions = {}): Promise<AntigravityCliDiscovery> {
  const env = options.env ?? process.env;
  const executablePath = await resolveAntigravityCliPath(options);
  if (!executablePath) {
    return { executablePath: null, version: null, authenticated: false, visibleModels: [], authentication: "unverified", message: "Antigravity CLI was not found." };
  }
  const run = options.run ?? ((call: ProviderProcessCall) => runAntigravityProcess(call, { timeoutMs: 15_000 }));
  const call = (args: string[]): ProviderProcessCall => ({
    command: executablePath,
    args,
    cwd: process.cwd(),
    env: sanitizeProviderEnv(env)
  });
  try {
    const versionResult = await run(call(["--version"]));
    const version = versionResult.exitCode === 0 ? parseVersion(versionResult.stdout) : null;
    if (!version) {
      return { executablePath, version: null, authenticated: false, visibleModels: [], authentication: "unverified", message: "Antigravity CLI did not report a semantic version." };
    }
    if (!options.authProbe) {
      return {
        executablePath,
        version,
        authenticated: false,
        visibleModels: [],
        authentication: "unverified",
        message: "Antigravity CLI path/version detected; authentication is unverified until an explicit Connect or live conformance action."
      };
    }
    const models = await run(call(["models"]));
    if (models.exitCode !== 0) {
      return { executablePath, version, authenticated: false, visibleModels: [], authentication: "unverified", message: "Antigravity CLI authentication probe did not confirm authentication." };
    }
    const visibleModels = models.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 64);
    return {
      executablePath,
      version,
      authenticated: visibleModels.length > 0,
      visibleModels,
      authentication: visibleModels.length > 0 ? "probe-verified" : "unverified",
      message: visibleModels.length > 0 ? null : "Antigravity CLI authentication probe returned no visible models; use the official CLI Connect action."
    };
  } catch (error) {
    return {
      executablePath,
      version: null,
      authenticated: false,
      visibleModels: [],
      authentication: "unverified",
      message: redactSensitiveText(error instanceof Error ? error.message : String(error)).slice(0, 500)
    };
  }
}

function parseVersion(value: string) {
  return value.match(/\b(\d+\.\d+\.\d+)\b/)?.[1] ?? null;
}

async function fileExists(candidate: string) {
  try {
    await access(candidate);
    return true;
  } catch {
    return false;
  }
}
