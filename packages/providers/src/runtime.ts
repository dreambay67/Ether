import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

import { sanitizeProviderEnv } from "./env.js";
import { CodexAppServerClient } from "./codex/appServer/client.js";
import {
  CODEX_APP_SERVER_MANIFEST_SHA256,
  CODEX_APP_SERVER_VERSION
} from "./codex/appServer/protocol.js";
import {
  isWindowsAppsCodexAlias,
  pathExists,
  resolveCodexCliPath,
  windowsAppsCodexMessage
} from "./codex/processRunner.js";

export type CodexRuntimeStatus =
  | "stopped"
  | "starting"
  | "ready"
  | "restarting"
  | "degraded"
  | "fallback";

export type CodexRuntimeTransport = "app-server" | "exec-fallback" | "unavailable";

export type CodexRuntimeHealth = {
  status: CodexRuntimeStatus;
  transport: CodexRuntimeTransport;
  version: string;
  manifestHash: string;
  generation: number;
  restartCount: number;
  restartReason: string | null;
  fallbackReason: string | null;
  pid: number | null;
  processPhase: "none" | "initializing" | "idle" | "active";
  startedAt: number | null;
  initializedAt: number | null;
  lastExitAt: number | null;
  initializationMs: number | null;
};

export type CodexAppServerRuntimeOptions = {
  executablePath?: string;
  appServerArgs?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  fileExists?: (filePath: string) => Promise<boolean> | boolean;
  initializationTimeoutMs?: number;
  restartBudget?: number;
  restartWindowMs?: number;
  clientOptions?: {
    maxFrameBytes?: number;
    maxEvents?: number;
    maxToolEvents?: number;
    maxTextBytes?: number;
    maxStderrBytes?: number;
  };
};

export class CodexRuntimeUnavailableError extends Error {
  readonly code = "CODEX_APP_SERVER_UNAVAILABLE";
  readonly health: CodexRuntimeHealth;

  constructor(health: CodexRuntimeHealth) {
    super(health.fallbackReason ?? health.restartReason ?? "Codex App Server is unavailable.");
    this.name = "CodexRuntimeUnavailableError";
    this.health = health;
  }
}

export class CodexAppServerRuntime {
  private readonly options: CodexAppServerRuntimeOptions;
  private readonly listeners = new Set<(health: CodexRuntimeHealth) => void>();
  private child: ChildProcessWithoutNullStreams | null = null;
  private client: CodexAppServerClient | null = null;
  private startPromise: Promise<CodexRuntimeHealth> | null = null;
  private stopping = false;
  private restartTimestamps: number[] = [];
  private state: CodexRuntimeHealth = {
    status: "stopped",
    transport: "unavailable",
    version: CODEX_APP_SERVER_VERSION,
    manifestHash: CODEX_APP_SERVER_MANIFEST_SHA256,
    generation: 0,
    restartCount: 0,
    restartReason: null,
    fallbackReason: null,
    pid: null,
    processPhase: "none",
    startedAt: null,
    initializedAt: null,
    lastExitAt: null,
    initializationMs: null
  };

  constructor(options: CodexAppServerRuntimeOptions = {}) {
    this.options = options;
  }

  health(): CodexRuntimeHealth {
    const phase = this.client?.activeTurnCount ? "active" : this.state.processPhase;
    return { ...this.state, processPhase: phase };
  }

  subscribe(listener: (health: CodexRuntimeHealth) => void) {
    this.listeners.add(listener);
    listener(this.health());
    return () => this.listeners.delete(listener);
  }

  async start(): Promise<CodexRuntimeHealth> {
    if (this.state.status === "ready" && this.client && !this.client.isClosed) return this.health();
    if (this.startPromise) return this.startPromise;
    this.stopping = false;
    this.startPromise = this.startProcess(this.state.generation > 0).finally(() => {
      this.startPromise = null;
    });
    return this.startPromise;
  }

  async ensureAvailable(): Promise<CodexAppServerClient> {
    if (this.state.status === "ready" && this.client && !this.client.isClosed) return this.client;
    if (this.state.transport === "exec-fallback") throw new CodexRuntimeUnavailableError(this.health());
    if (this.state.generation > 0 && !this.canRestart()) {
      this.activateFallback("Codex App Server restart budget was exhausted.");
      throw new CodexRuntimeUnavailableError(this.health());
    }
    if (this.state.generation > 0) {
      this.restartTimestamps.push(Date.now());
      this.patch({ status: "restarting", restartCount: this.state.restartCount + 1 });
    }
    await this.start();
    if (!this.client || this.client.isClosed || this.state.status !== "ready") {
      throw new CodexRuntimeUnavailableError(this.health());
    }
    return this.client;
  }

  getClient(): CodexAppServerClient {
    if (!this.client || this.client.isClosed || this.state.status !== "ready") {
      throw new CodexRuntimeUnavailableError(this.health());
    }
    return this.client;
  }

  async stop(): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    const child = this.child;
    const client = this.client;
    this.child = null;
    this.client = null;
    if (client && !client.isClosed) client.notifyTransportClosed(new Error("Codex App Server runtime stopped."));
    if (child) await terminateProcessTree(child);
    this.patch({
      status: "stopped",
      transport: "unavailable",
      pid: null,
      processPhase: "none"
    });
  }

  private async startProcess(restarting: boolean): Promise<CodexRuntimeHealth> {
    const startedAt = Date.now();
    this.patch({
      status: restarting ? "restarting" : "starting",
      transport: "unavailable",
      fallbackReason: null,
      startedAt,
      initializedAt: null,
      initializationMs: null,
      processPhase: "initializing"
    });
    let executablePath: string;
    try {
      executablePath = await this.resolveExecutable();
    } catch (error) {
      this.activateFallback(messageOf(error));
      return this.health();
    }
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(executablePath, this.options.appServerArgs ?? ["app-server", "--stdio"], {
        cwd: this.options.cwd ?? process.cwd(),
        env: sanitizeProviderEnv(this.options.env ?? process.env),
        detached: process.platform !== "win32",
        shell: false,
        stdio: "pipe",
        windowsHide: true
      });
    } catch (error) {
      this.activateFallback(`Codex App Server spawn failed: ${messageOf(error)}`);
      return this.health();
    }
    this.child = child;
    const client = new CodexAppServerClient({
      stdin: child.stdin,
      stdout: child.stdout,
      stderr: child.stderr,
      ...this.options.clientOptions
    });
    this.client = client;
    let initialized = false;
    child.once("error", (error) => {
      if (!initialized) client.notifyTransportClosed(error);
    });
    child.once("close", (code, signal) => this.onProcessClose(child, client, initialized, code, signal));
    this.patch({ pid: child.pid ?? null });
    try {
      await withTimeout(
        client.initialize(),
        this.options.initializationTimeoutMs ?? 10_000,
        `Codex App Server initialization timed out after ${this.options.initializationTimeoutMs ?? 10_000} ms.`
      );
      initialized = true;
    } catch (error) {
      client.notifyTransportClosed(error instanceof Error ? error : new Error("Codex App Server initialization failed."));
      await terminateProcessTree(child);
      if (this.child === child) this.child = null;
      if (this.client === client) this.client = null;
      this.activateFallback(`Codex App Server handshake failed: ${messageOf(error)}`);
      return this.health();
    }
    const initializedAt = Date.now();
    this.patch({
      status: "ready",
      transport: "app-server",
      generation: this.state.generation + 1,
      restartReason: restarting ? this.state.restartReason : null,
      fallbackReason: null,
      processPhase: "idle",
      initializedAt,
      initializationMs: initializedAt - startedAt
    });
    return this.health();
  }

  private onProcessClose(
    child: ChildProcessWithoutNullStreams,
    client: CodexAppServerClient,
    initialized: boolean,
    code: number | null,
    signal: NodeJS.Signals | null
  ) {
    if (this.child !== child && this.client !== client) return;
    const active = client.activeTurnCount > 0;
    client.notifyTransportClosed(new Error(
      `Codex App Server exited ${active ? "during an active turn" : initialized ? "while idle" : "during initialization"} (code ${code ?? "none"}, signal ${signal ?? "none"}).`
    ));
    if (this.child === child) this.child = null;
    if (this.client === client) this.client = null;
    if (this.stopping) return;
    if (!initialized) {
      this.activateFallback(`Codex App Server died during initialization (code ${code ?? "none"}).`);
      return;
    }
    this.patch({
      status: "degraded",
      transport: "unavailable",
      pid: null,
      processPhase: "none",
      lastExitAt: Date.now(),
      restartReason: `Codex App Server died ${active ? "during an active turn" : "while idle"} (code ${code ?? "none"}).`
    });
  }

  private async resolveExecutable() {
    const executable = this.options.executablePath ?? resolveCodexCliPath(this.options.env ?? process.env);
    if (!executable) throw new Error("CODEX_CLI_PATH was not found in the user Codex config.");
    if (isWindowsAppsCodexAlias(executable)) throw new Error(windowsAppsCodexMessage);
    const exists = await (this.options.fileExists ?? pathExists)(executable);
    if (!exists) throw new Error(`Configured Codex CLI does not exist or is not readable: ${executable}`);
    return executable;
  }

  private canRestart() {
    const now = Date.now();
    const windowMs = this.options.restartWindowMs ?? 60_000;
    this.restartTimestamps = this.restartTimestamps.filter((timestamp) => now - timestamp <= windowMs);
    return this.restartTimestamps.length < (this.options.restartBudget ?? 2);
  }

  private activateFallback(reason: string) {
    this.patch({
      status: "fallback",
      transport: "exec-fallback",
      fallbackReason: reason,
      pid: null,
      processPhase: "none"
    });
  }

  private patch(next: Partial<CodexRuntimeHealth>) {
    this.state = { ...this.state, ...next };
    const snapshot = this.health();
    for (const listener of this.listeners) listener(snapshot);
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); }
    );
  });
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function terminateProcessTree(child: ChildProcessWithoutNullStreams) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const closed = new Promise<void>((resolve) => child.once("close", () => resolve()));
  const pid = child.pid;
  if (process.platform === "win32" && pid) {
    await new Promise<void>((resolve) => {
      const killer = spawn("taskkill", ["/pid", String(pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true
      });
      killer.once("error", () => { child.kill(); resolve(); });
      killer.once("close", () => resolve());
    });
  } else if (pid) {
    try { process.kill(-pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
  } else {
    child.kill("SIGKILL");
  }
  await Promise.race([closed, new Promise<void>((resolve) => setTimeout(resolve, 2_000))]);
}
