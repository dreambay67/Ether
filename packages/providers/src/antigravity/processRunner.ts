import { spawn, type ChildProcess } from "node:child_process";
import type { ProviderProcessCall, ProviderProcessResult } from "../types.js";

export type AntigravityProcessOptions = {
  timeoutMs: number;
  outputLimitBytes?: number;
  signal?: AbortSignal;
};

/** Runs the official CLI without a shell and owns its complete child process tree. */
export function runAntigravityProcess(
  call: ProviderProcessCall,
  options: AntigravityProcessOptions
): Promise<ProviderProcessResult> {
  const outputLimitBytes = options.outputLimitBytes ?? 64 * 1024;

  return new Promise((resolve, reject) => {
    const stdout = new BoundedTextCapture(outputLimitBytes);
    const stderr = new BoundedTextCapture(outputLimitBytes);
    let settled = false;
    let failure: Error | null = null;
    const child = spawn(call.command, call.args, {
      cwd: call.cwd,
      env: call.env,
      detached: process.platform !== "win32",
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    const finish = (error?: Error, result?: ProviderProcessResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve(result!);
    };
    const stop = (error: Error) => {
      if (failure) return;
      failure = error;
      terminateProcessTree(child);
    };
    const abort = () => stop(new Error("Antigravity image generation was cancelled."));
    const timeout = setTimeout(
      () => stop(new Error(`Antigravity image generation timed out after ${options.timeoutMs} ms.`)),
      options.timeoutMs
    );

    if (options.signal?.aborted) {
      abort();
    } else {
      options.signal?.addEventListener("abort", abort, { once: true });
    }

    child.stdout?.on("data", (chunk) => stdout.append(chunk));
    child.stderr?.on("data", (chunk) => stderr.append(chunk));
    child.on("error", (error) => finish(error));
    child.on("close", (code) => {
      if (failure) {
        finish(new Error(`${failure.message}\n${redactProcessOutput(stdout.toString(), stderr.toString())}`));
        return;
      }
      finish(undefined, { stdout: stdout.toString(), stderr: stderr.toString(), exitCode: code ?? 1 });
    });
  });
}

function terminateProcessTree(child: ChildProcess) {
  if (!child.pid) {
    child.kill("SIGKILL");
    return;
  }
  if (process.platform === "win32") {
    const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    killer.on("error", () => child.kill("SIGKILL"));
    return;
  }
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    child.kill("SIGKILL");
  }
}

function redactProcessOutput(stdout: string, stderr: string) {
  const output = [stdout, stderr].filter(Boolean).join("\n").trim();
  return output ? `Antigravity output: ${redactSensitiveText(output).slice(0, 2_000)}` : "";
}

export function redactSensitiveText(value: string) {
  return value
    .replace(/https?:\/\/[^\s"'<>]+/gi, (url) =>
      /(?:accounts\.google|oauth|authorize|authorization|auth(?:entication)?|sign[ -]?in|login|token|callback)/i.test(url)
        ? "<redacted-auth-url>"
        : url
    )
    .replace(/[A-Za-z]:\\(?:[^\r\n"']+)/g, "<redacted-path>")
    .replace(/\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g, "<redacted-email>")
    .replace(/\b(bearer)\s+[^\s,;]+/gi, "$1 <redacted>")
    .replace(/\b(token|api[ _-]?key|auth(?:orization)?)\s*(?::|=|\s+)\s*[^\s,;]+/gi, "$1=<redacted>")
    .replace(/\b(?:expires?|expiry|expiration)[=:]?\s*[^\s,;]+/gi, "<redacted-expiry>")
    .replace(/\b(?:trace|installation|conversation)[_-]?id[=:]?\s*[A-Za-z0-9_-]+/gi, "<redacted-id>")
    .replace(/\b(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,}\b/g, "<redacted-host>");
}

class BoundedTextCapture {
  private readonly chunks: Buffer[] = [];
  private size = 0;
  private truncated = false;

  constructor(private readonly limit: number) {}

  append(chunk: string | Buffer | Uint8Array) {
    if (this.truncated) return;
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    const remaining = this.limit - this.size;
    if (remaining <= 0) {
      this.truncated = true;
      return;
    }
    this.chunks.push(value.subarray(0, remaining));
    this.size += Math.min(value.length, remaining);
    this.truncated ||= value.length > remaining;
  }

  toString() {
    return `${Buffer.concat(this.chunks).toString("utf8")}${this.truncated ? "\n...[truncated]..." : ""}`;
  }
}
