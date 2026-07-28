import { spawn, type ChildProcess } from "node:child_process";
import { constants, readFileSync } from "node:fs";
import { access } from "node:fs/promises";
import path from "node:path";
import { sanitizeProviderEnv } from "../env.js";
import type {
  ProviderDescriptor,
  ProviderDiagnostic,
  ProviderProcessCall,
  ProviderProcessResult,
  ProviderProcessRunner
} from "../types.js";

export type CodexCliProviderOptions = {
  codexCliPath?: string;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  fileExists?: (filePath: string) => Promise<boolean> | boolean;
  runner?: ProviderProcessRunner;
  processTimeoutMs?: number;
  processOutputLimitBytes?: number;
};

export type CodexFailureClassification = {
  category: "local-runtime-or-sandbox" | "codex-worker";
  message: string;
};

export type ProviderProcessOptions = {
  timeoutMs?: number;
  outputLimitBytes?: number;
};

export type CodexCliDiagnosticInput = {
  descriptor: ProviderDescriptor;
  codexCliPath: string | null;
  fileExists: (filePath: string) => Promise<boolean> | boolean;
  featureDetails: Record<string, unknown>;
};

const runtimeFailureHints = [
  "readonly database",
  "failed to initialize state runtime",
  "failed to initialize in-process app-server client",
  "operation not permitted"
];

export const windowsAppsCodexMessage =
  "WindowsApps Codex alias paths are blocked because they can return Access is denied. Configure a real user-local CODEX_CLI_PATH in C:\\Users\\<you>\\.codex\\config.toml.";
export const defaultProcessTimeoutMs = 10 * 60 * 1000;
export const defaultOutputLimitBytes = 1024 * 1024;

export function classifyCodexCliFailure(output: string): CodexFailureClassification {
  const lowered = output.toLowerCase();

  if (runtimeFailureHints.some((hint) => lowered.includes(hint))) {
    return {
      category: "local-runtime-or-sandbox",
      message:
        "Codex exec failed before image generation while accessing local Codex state or sandboxed filesystem writes."
    };
  }

  return {
    category: "codex-worker",
    message: output.trim() || "Codex exec image worker failed without stdout or stderr."
  };
}

export function resolveCodexCliPath(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
) {
  const explicitPath = env.CODEX_CLI_PATH;
  if (explicitPath && !isWindowsAppsCodexAlias(explicitPath)) {
    return explicitPath;
  }

  const configPath = path.join(env.USERPROFILE ?? process.env.USERPROFILE ?? "", ".codex", "config.toml");

  try {
    const raw = readFileSync(configPath, "utf8");
    const match = raw.match(/CODEX_CLI_PATH\s*=\s*['"]([^'"]+)['"]/);

    if (match) {
      return match[1];
    }
  } catch {
    // Fall through to the explicit environment override.
  }

  if (explicitPath) {
    return explicitPath;
  }

  return null;
}

export function isWindowsAppsCodexAlias(filePath: string) {
  const normalized = path.normalize(filePath).toLowerCase();
  const segments = normalized.split(path.sep).filter(Boolean);
  const fileName = segments.at(-1);

  return fileName === "codex.exe" && segments.includes("windowsapps");
}

export async function pathExists(filePath: string) {
  try {
    await access(filePath, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

export function createCodexProviderProcessCall(
  call: Omit<ProviderProcessCall, "env"> & {
    env: NodeJS.ProcessEnv | Record<string, string | undefined>;
  }
): ProviderProcessCall {
  return {
    ...call,
    env: sanitizeProviderEnv(call.env)
  };
}

export async function diagnoseCodexCliProvider({
  descriptor,
  codexCliPath,
  fileExists,
  featureDetails
}: CodexCliDiagnosticInput): Promise<ProviderDiagnostic> {
  if (!codexCliPath) {
    return {
      ...descriptor,
      capabilities: [...descriptor.capabilities],
      availability: "unavailable",
      messages: ["CODEX_CLI_PATH was not found in the user Codex config. PATH lookup is intentionally not used."],
      details: {
        ...featureDetails
      }
    };
  }

  if (isWindowsAppsCodexAlias(codexCliPath)) {
    return {
      ...descriptor,
      capabilities: [...descriptor.capabilities],
      availability: "unavailable",
      messages: [windowsAppsCodexMessage],
      details: {
        codexCliPath,
        ...featureDetails
      }
    };
  }

  if (!(await fileExists(codexCliPath))) {
    return {
      ...descriptor,
      capabilities: [...descriptor.capabilities],
      availability: "unavailable",
      messages: [`Configured Codex CLI does not exist or is not readable: ${codexCliPath}`],
      details: {
        codexCliPath,
        ...featureDetails
      }
    };
  }

  return {
    ...descriptor,
    capabilities: [...descriptor.capabilities],
    availability: "available",
    messages: ["Configured user-local Codex CLI is available."],
    details: {
      codexCliPath,
      ...featureDetails
    }
  };
}

export function runProviderProcess(
  call: ProviderProcessCall,
  options: ProviderProcessOptions = {}
): Promise<ProviderProcessResult> {
  const timeoutMs = options.timeoutMs ?? defaultProcessTimeoutMs;
  const outputLimitBytes = options.outputLimitBytes ?? defaultOutputLimitBytes;

  return new Promise((resolve, reject) => {
    const stdout = new BoundedTextCapture(outputLimitBytes);
    const stderr = new BoundedTextCapture(outputLimitBytes);
    let timedOut = false;
    let settled = false;
    const child = spawn(call.command, call.args, {
      cwd: call.cwd,
      env: call.env,
      detached: process.platform !== "win32",
      shell: false,
      stdio: [typeof call.stdin === "string" ? "pipe" : "ignore", "pipe", "pipe"],
      windowsHide: true
    });
    const timeout = setTimeout(() => {
      timedOut = true;
      terminateProviderProcessTree(child);
    }, timeoutMs);
    const childStdout = child.stdout;
    const childStderr = child.stderr;
    const childStdin = child.stdin;
    const finishReject = (error: Error) => {
      if (settled) {
        return;
      }

      settled = true;
      if (timeout) {
        clearTimeout(timeout);
      }
      reject(error);
    };

    if (!childStdout || !childStderr) {
      finishReject(new Error("Provider process stdout/stderr pipes were not created."));
      return;
    }

    if (typeof call.stdin === "string" && !childStdin) {
      finishReject(new Error("Provider process stdin pipe was not created."));
      return;
    }

    childStdout.on("data", (chunk) => {
      stdout.append(chunk);
    });
    childStderr.on("data", (chunk) => {
      stderr.append(chunk);
    });
    if (typeof call.stdin === "string") {
      childStdin!.end(call.stdin);
    }
    child.on("error", finishReject);
    child.on("close", (code) => {
      if (settled) {
        return;
      }

      settled = true;
      if (timeout) {
        clearTimeout(timeout);
      }

      if (timedOut) {
        reject(
          new Error(
            [
              `Provider process timed out after ${timeoutMs} ms: ${call.command}`,
              `stdout:\n${stdout.toString()}`,
              `stderr:\n${stderr.toString()}`
            ].join("\n")
          )
        );
        return;
      }

      resolve({
        stdout: stdout.toString(),
        stderr: stderr.toString(),
        exitCode: code ?? 1
      });
    });

  });
}

function terminateProviderProcessTree(child: ChildProcess) {
  const pid = child.pid;

  if (!pid) {
    child.kill("SIGKILL");
    return;
  }

  if (process.platform === "win32") {
    const killer = spawn("taskkill", ["/pid", String(pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true
    });

    killer.on("error", () => {
      child.kill();
    });
    return;
  }

  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    child.kill("SIGKILL");
  }
}

class BoundedTextCapture {
  private readonly limitBytes: number;
  private readonly headLimitBytes: number;
  private readonly tailLimitBytes: number;
  private full = Buffer.alloc(0);
  private head = Buffer.alloc(0);
  private tail = Buffer.alloc(0);
  private totalBytes = 0;
  private truncated = false;

  constructor(limitBytes: number) {
    this.limitBytes = Math.max(1, Math.floor(limitBytes));
    this.headLimitBytes = Math.max(1, Math.ceil(this.limitBytes / 2));
    this.tailLimitBytes = Math.max(1, Math.floor(this.limitBytes / 2));
  }

  append(chunk: string | Buffer | Uint8Array) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    this.totalBytes += buffer.length;

    if (!this.truncated) {
      const next = Buffer.concat([this.full, buffer]);

      if (next.length <= this.limitBytes) {
        this.full = next;
        return;
      }

      this.truncated = true;
      this.head = next.subarray(0, this.headLimitBytes);
      this.tail = next.subarray(Math.max(0, next.length - this.tailLimitBytes));
      this.full = Buffer.alloc(0);
      return;
    }

    const combinedTail = Buffer.concat([this.tail, buffer]);
    this.tail = combinedTail.subarray(Math.max(0, combinedTail.length - this.tailLimitBytes));
  }

  toString() {
    if (!this.truncated) {
      return this.full.toString("utf8");
    }

    const omittedBytes = Math.max(0, this.totalBytes - this.head.length - this.tail.length);

    return [
      this.head.toString("utf8"),
      `\n...[truncated ${omittedBytes} bytes]...\n`,
      this.tail.toString("utf8")
    ].join("");
  }
}
