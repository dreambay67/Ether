import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { CodexAppServerRuntime } from "@ether/providers";
import { createCodexRuntimeService } from "../../../apps/desktop/src/main/services/codexRuntime.js";
import { createProviderService } from "../../../apps/desktop/src/main/services/providerService.js";

const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "codex-app-server", "fake-app-server.mjs");
const runtimes: CodexAppServerRuntime[] = [];

async function waitFor(condition: () => boolean, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for runtime state.");
}

function runtime(mode = "normal", extraEnv: Record<string, string> = {}) {
  const instance = new CodexAppServerRuntime({
    executablePath: process.execPath,
    appServerArgs: [fixture],
    env: { ...process.env, ...extraEnv, ETHER_FAKE_APP_SERVER_MODE: mode },
    initializationTimeoutMs: 500,
    restartBudget: 1,
    restartWindowMs: 2_000
  });
  runtimes.push(instance);
  return instance;
}

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((instance) => instance.stop()));
});

describe("Codex runtime lifecycle", () => {
  it("sanitizes child environment and keeps one process alive while idle", async () => {
    const environmentLog = path.join(os.tmpdir(), `ether-runtime-env-${Date.now()}.json`);
    const instance = runtime("normal", {
      OPENAI_API_KEY: "must-not-leak",
      ETHER_RUNTIME_MARKER: "kept",
      ETHER_FAKE_APP_SERVER_ENV_LOG: environmentLog
    });
    await instance.start();
    const first = instance.health();
    await instance.getClient().listModels();
    await instance.getClient().listModels();
    const captured = JSON.parse(await readFile(environmentLog, "utf8"));
    expect(captured).toMatchObject({ openAiApiKey: null, marker: "kept" });
    expect(instance.health()).toMatchObject({ pid: first.pid, generation: 1, transport: "app-server", version: "0.144.2" });
  });

  it("publishes health, rejects active work on death, and bounds restart generation", async () => {
    const instance = runtime("die-active");
    const states: string[] = [];
    const unsubscribe = instance.subscribe((health) => states.push(health.status));
    await instance.start();
    const client = instance.getClient();
    const thread = await client.startThread({ cwd: process.cwd() });
    await expect(client.runTurn({ threadId: thread.threadId, input: [{ type: "text", text: "die" }] })).rejects.toThrow(/closed|exited/i);
    await expect(instance.ensureAvailable()).resolves.toBeDefined();
    expect(instance.health().generation).toBe(2);
    expect(states).toContain("restarting");
    unsubscribe();
  });

  it("activates explicit fallback for initialization timeout or initialization death", async () => {
    const timedOut = runtime("no-init");
    await timedOut.start();
    expect(timedOut.health()).toMatchObject({
      status: "fallback",
      transport: "exec-fallback",
      generation: 0,
      fallbackReason: expect.stringMatching(/initialization timed out/i)
    });

    const died = runtime("die-init");
    await died.start();
    expect(died.health()).toMatchObject({
      status: "fallback",
      transport: "exec-fallback",
      generation: 0,
      fallbackReason: expect.stringMatching(/handshake failed|died during initialization/i)
    });
  });

  it("classifies idle death and exhausts a bounded restart budget", async () => {
    const instance = runtime("die-idle");
    await instance.start();
    await waitFor(() => instance.health().status === "degraded");
    expect(instance.health()).toMatchObject({
      transport: "unavailable",
      generation: 1,
      restartReason: expect.stringMatching(/while idle/i)
    });

    await instance.ensureAvailable();
    await waitFor(() => instance.health().status === "degraded");
    expect(instance.health()).toMatchObject({ generation: 2, restartCount: 1 });
    await expect(instance.ensureAvailable()).rejects.toMatchObject({ code: "CODEX_APP_SERVER_UNAVAILABLE" });
    expect(instance.health()).toMatchObject({
      status: "fallback",
      transport: "exec-fallback",
      fallbackReason: expect.stringMatching(/restart budget/i)
    });
  });

  it("invalidates document sessions without replacing the application runtime", async () => {
    const codex = createCodexRuntimeService({ runtime: runtime() });
    const providers = createProviderService({ codex });
    await providers.start();
    const identity = providers.runtimeIdentity;
    providers.clearDocument("doc-a");
    providers.clearDocument("doc-b");
    expect(providers.runtimeIdentity).toBe(identity);
    expect(providers.health().transport).toBe("app-server");
    await providers.close();
    expect(providers.health().status).toBe("stopped");
  });
});
