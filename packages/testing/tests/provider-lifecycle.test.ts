import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  CODEX_IMAGE_CAPABILITY_MANIFEST_SHA256,
  CodexAppServerRuntime,
  type CodexRuntimeHealth,
  type CodexAppServerRuntimeOptions
} from "@ether/providers";
import { createCodexRuntimeService } from "../../../apps/desktop/src/main/services/codexRuntime.js";
import {
  createProviderService,
  startProviderServiceInBackground
} from "../../../apps/desktop/src/main/services/providerService.js";
import {
  createRendererInteractiveGate,
  drainLifecycleSteps,
  startContainedLifecycle
} from "../../../apps/desktop/src/main/lifecycle.js";

const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "codex-app-server", "fake-app-server.mjs");
const runtimes: CodexAppServerRuntime[] = [];

async function waitFor(condition: () => boolean, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for runtime state.");
}

function processExists(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function runtime(
  mode = "normal",
  extraEnv: Record<string, string> = {},
  extraOptions: Partial<CodexAppServerRuntimeOptions> = {}
) {
  const instance = new CodexAppServerRuntime({
    executablePath: process.execPath,
    appServerArgs: [fixture],
    env: { ...process.env, ...extraEnv, ETHER_FAKE_APP_SERVER_MODE: mode },
    initializationTimeoutMs: 500,
    restartBudget: 1,
    restartWindowMs: 2_000,
    ...extraOptions
  });
  runtimes.push(instance);
  return instance;
}

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((instance) => instance.stop()));
});

describe("Codex runtime lifecycle", () => {
  it("drains every desktop lifecycle participant after an earlier closer rejects", async () => {
    const order: string[] = [];
    const failures = await drainLifecycleSteps([
      {
        name: "mcp",
        close: async () => {
          order.push("mcp");
          throw new Error("MCP startup rejected");
        }
      },
      { name: "application", close: async () => { order.push("application"); } },
      { name: "provider", close: async () => { order.push("provider"); } },
      { name: "diagnostics", close: async () => { order.push("diagnostics"); } }
    ]);

    expect(order).toEqual(["mcp", "application", "provider", "diagnostics"]);
    expect(failures).toMatchObject([{ step: "mcp", error: { message: "MCP startup rejected" } }]);
  });

  it("contains synchronous and asynchronous optional lifecycle startup failures", async () => {
    const failures: string[] = [];
    await expect(startContainedLifecycle(
      () => { throw new Error("synchronous startup failure"); },
      (error) => { failures.push((error as Error).message); }
    )).resolves.toBeNull();
    await expect(startContainedLifecycle(
      async () => { throw new Error("asynchronous startup failure"); },
      (error) => { failures.push((error as Error).message); }
    )).resolves.toBeNull();
    expect(failures).toEqual(["synchronous startup failure", "asynchronous startup failure"]);
  });

  it("bounds renderer readiness while preserving an explicit early signal", async () => {
    const explicit = createRendererInteractiveGate();
    explicit.mark();
    await expect(explicit.wait(50)).resolves.toBe("renderer");

    const fallback = createRendererInteractiveGate();
    await expect(fallback.wait(10)).resolves.toBe("timeout");
    await expect(fallback.wait(10)).resolves.toBe("renderer");
  });

  it("does not block the usable shell and closes safely while deferred discovery is in flight", async () => {
    let releaseStart!: () => void;
    let closed = false;
    const failures: unknown[] = [];
    const startGate = new Promise<void>((resolve) => { releaseStart = resolve; });
    const background = startProviderServiceInBackground({
      start: async () => {
        await startGate;
        return {} as never;
      },
      close: async () => {
        closed = true;
        releaseStart();
      }
    }, (error) => failures.push(error));

    expect(closed).toBe(false);
    await background.close();
    await background.done;
    expect(closed).toBe(true);
    expect(failures).toEqual([]);
  });

  it("reports a deferred discovery failure without rejecting the shell lifecycle", async () => {
    const failure = new Error("provider probe failed");
    const failures: unknown[] = [];
    const background = startProviderServiceInBackground({
      start: async () => { throw failure; },
      close: async () => undefined
    }, (error) => failures.push(error));

    await expect(background.done).resolves.toBeUndefined();
    expect(failures).toEqual([failure]);
    await background.close();
  });

  it("contains a synchronous provider startup throw", async () => {
    const failure = new Error("provider start threw synchronously");
    const failures: unknown[] = [];
    const background = startProviderServiceInBackground({
      start: () => { throw failure; },
      close: async () => undefined
    }, (error) => failures.push(error));

    await expect(background.done).resolves.toBeUndefined();
    expect(failures).toEqual([failure]);
    await expect(background.close()).resolves.toBeUndefined();
  });

  it("bounds a never-settling provider shutdown and still advances the quit drain", async () => {
    let closeAttempts = 0;
    let quitAttempted = false;
    const neverStart = new Promise<CodexRuntimeHealth>(() => undefined);
    const background = startProviderServiceInBackground({
      start: () => neverStart,
      close: async () => {
        closeAttempts += 1;
        await neverStart;
      }
    }, () => undefined, { shutdownTimeoutMs: 10 });

    const failures = await drainLifecycleSteps([
      { name: "provider", close: () => background.close() },
      {
        name: "quit",
        close: async () => {
          quitAttempted = true;
        }
      }
    ]);

    expect(closeAttempts).toBe(1);
    expect(quitAttempted).toBe(true);
    expect(failures).toMatchObject([{
      step: "provider",
      error: { code: "PROVIDER_SHUTDOWN_TIMEOUT" }
    }]);
  });

  it("aborts a provider shutdown wait without skipping the close attempt", async () => {
    let closeAttempts = 0;
    const neverStart = new Promise<CodexRuntimeHealth>(() => undefined);
    const background = startProviderServiceInBackground({
      start: () => neverStart,
      close: async () => {
        closeAttempts += 1;
        await neverStart;
      }
    }, () => undefined, { shutdownTimeoutMs: 5_000 });
    const controller = new AbortController();
    controller.abort();

    await expect(background.close(controller.signal)).rejects.toMatchObject({
      code: "PROVIDER_SHUTDOWN_ABORTED"
    });
    expect(closeAttempts).toBe(1);
  });

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
    expect(instance.health()).toMatchObject({
      pid: first.pid,
      generation: 1,
      transport: "app-server",
      version: "0.144.2",
      reportedVersion: "0.144.2",
      versionCompatible: true,
      defaultModelId: "gpt-5.4",
      models: [expect.objectContaining({ id: "gpt-5.4", reasoningEfforts: ["low", "medium"] })],
      imageCapability: "available"
    });
    expect(instance.health()).toMatchObject({
      imageCapabilityManifestHash: CODEX_IMAGE_CAPABILITY_MANIFEST_SHA256,
      imageCapabilityProfile: {
        dimensionMode: "provider-determined",
        exactResolution: false,
        verifiedAspectRatios: ["1:1"]
      }
    });
  });

  it("keeps text ready but image generation unavailable without a matching capability manifest", async () => {
    const instance = runtime("normal", {}, { imageCapabilityManifest: null });
    await instance.start();
    expect(instance.health()).toMatchObject({
      status: "ready",
      transport: "app-server",
      versionCompatible: true,
      imageCapability: "unavailable",
      imageCapabilityManifestHash: null,
      imageCapabilityProfile: null
    });
  });

  it("rejects an initialized server whose reported CLI version differs from the pin", async () => {
    const instance = runtime("version-mismatch");
    await instance.start();
    expect(instance.health()).toMatchObject({
      status: "degraded",
      transport: "unavailable",
      version: "0.144.2",
      reportedVersion: "0.145.0",
      versionCompatible: false,
      imageCapability: "unavailable",
      fallbackReason: null
    });
    await expect(instance.ensureAvailable()).rejects.toMatchObject({
      code: "CODEX_APP_SERVER_VERSION_MISMATCH",
      category: "capability"
    });
  });

  it("accepts the pinned version reported by the real Codex Desktop user agent", async () => {
    const instance = runtime("desktop-user-agent");
    await instance.start();
    expect(instance.health()).toMatchObject({
      status: "ready",
      transport: "app-server",
      reportedVersion: "0.144.2",
      versionCompatible: true,
      imageCapability: "available"
    });
  });

  it("reports a prerelease version accurately while preserving the exact-version gate", async () => {
    const instance = runtime("prerelease-version");
    await instance.start();
    expect(instance.health()).toMatchObject({
      status: "degraded",
      transport: "unavailable",
      reportedVersion: "0.146.0-alpha.3.1",
      versionCompatible: false,
      restartReason: "Codex App Server reported 0.146.0-alpha.3.1; Ether requires 0.144.2."
    });
    const providers = createProviderService({ codex: createCodexRuntimeService({ runtime: instance }) });
    expect(providers.providerHealth()).toMatchObject({
      status: "unavailable",
      version: "0.146.0-alpha.3.1",
      message: "Codex App Server reported 0.146.0-alpha.3.1; Ether requires 0.144.2."
    });
  });

  it("accepts the pinned CLI version when App Server prefixes the user agent with the client name", async () => {
    const instance = runtime("client-user-agent");
    await instance.start();
    expect(instance.health()).toMatchObject({
      status: "ready",
      transport: "app-server",
      reportedVersion: "0.144.2",
      versionCompatible: true,
      imageCapability: "available"
    });
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

  it("terminates a protocol-failed process before starting its replacement", async () => {
    const instance = runtime("oversized-frame", {}, {
      clientOptions: { maxFrameBytes: 1_024 }
    });
    await instance.start();
    const originalPid = instance.health().pid;
    expect(originalPid).not.toBeNull();
    const client = instance.getClient();
    const thread = await client.startThread({ cwd: process.cwd() });
    await expect(client.runTurn({
      threadId: thread.threadId,
      input: [{ type: "text", text: "trigger protocol failure" }]
    })).rejects.toThrow(/frame exceeded/i);

    await instance.ensureAvailable();
    expect(instance.health().pid).not.toBe(originalPid);
    await waitFor(() => !processExists(originalPid as number));
  });

  it("does not spawn a replacement when stop races with protocol recovery", async () => {
    const instance = runtime("oversized-frame", {}, {
      clientOptions: { maxFrameBytes: 1_024 }
    });
    await instance.start();
    const originalPid = instance.health().pid;
    expect(originalPid).not.toBeNull();
    const client = instance.getClient();
    const thread = await client.startThread({ cwd: process.cwd() });
    await expect(client.runTurn({
      threadId: thread.threadId,
      input: [{ type: "text", text: "trigger protocol failure" }]
    })).rejects.toThrow(/frame exceeded/i);

    const restart = instance.ensureAvailable();
    await instance.stop();
    await expect(restart).rejects.toMatchObject({ code: "CODEX_APP_SERVER_UNAVAILABLE" });
    await waitFor(() => !processExists(originalPid as number));
    expect(instance.health()).toMatchObject({ status: "stopped", pid: null, processPhase: "none" });
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
      status: "degraded",
      transport: "unavailable",
      restartReason: expect.stringMatching(/restart budget/i),
      fallbackReason: null
    });
  });

  it("invalidates document sessions without replacing the application runtime", async () => {
    const codex = createCodexRuntimeService({ runtime: runtime() });
    const providers = createProviderService({ codex });
    await providers.start();
    const identity = providers.runtimeIdentity;
    const capabilities = await providers.capabilities();
    expect(capabilities).toEqual(expect.arrayContaining([
      expect.objectContaining({
        providerId: "codex-chatgpt-image-2",
        profileId: "image-default",
        modelId: "gpt-5.4",
        operation: "generate-image",
        aspectRatios: ["1:1"],
        maxParallelism: 4
      }),
      expect.objectContaining({
        providerId: "codex-vision-assistant",
        profileId: "worker:gpt-5.4",
        modelId: "gpt-5.4",
        operation: "llm",
        maxParallelism: 4
      }),
      expect.objectContaining({
        providerId: "codex-vision-evaluation",
        profileId: "evaluation:gpt-5.4",
        modelId: "gpt-5.4",
        operation: "llm",
        maxParallelism: 4
      })
    ]));
    expect(providers.resolveExecutionProviders({
      providerId: "google-nano-banana-2"
    }).image?.descriptor.id).toBe("google-nano-banana-2");
    expect(providers.resolveExecutionProviders({
      providerId: "codex-vision-assistant"
    }).worker?.descriptor.id).toBe("codex-vision-assistant");
    expect(providers.resolveExecutionProviders({
      providerId: "unregistered-image-provider"
    }).image).toBeUndefined();
    expect(providers.antigravityPolicy()).toEqual({
      creditOveragesConfirmed: false
    });
    await providers.setAntigravityCreditOveragesConfirmed(true);
    expect(providers.antigravityPolicy()).toEqual({
      creditOveragesConfirmed: true
    });
    await expect(
      providers.generation.diagnose("google-nano-banana-2")
    ).resolves.toMatchObject({
      details: { creditOveragesPolicy: "never-confirmed" }
    });
    await providers.setAntigravityCreditOveragesConfirmed(false);
    await expect(
      providers.generation.diagnose("google-nano-banana-2")
    ).resolves.toMatchObject({
      details: { creditOveragesPolicy: "unverified" }
    });
    await Promise.all([
      providers.setAntigravityCreditOveragesConfirmed(true),
      providers.setAntigravityCreditOveragesConfirmed(false)
    ]);
    expect(providers.antigravityPolicy()).toEqual({
      creditOveragesConfirmed: false
    });
    providers.clearDocument("doc-a");
    providers.clearDocument("doc-b");
    expect(providers.runtimeIdentity).toBe(identity);
    expect(providers.health().transport).toBe("app-server");
    await providers.close();
    expect(providers.health().status).toBe("stopped");
  });
});
