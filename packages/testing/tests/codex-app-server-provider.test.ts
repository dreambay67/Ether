import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { resolveMemoryScopeKey } from "@ether/intelligence";
import { CodexAppServerClient } from "../../providers/src/codex/appServer/client.js";
import { CodexAppServerSessionPool } from "../../providers/src/codex/appServer/sessionPool.js";
import { CodexAppServerTurnRunner } from "../../providers/src/codex/appServer/turnRunner.js";
import { CodexAppServerRuntime } from "../../providers/src/runtime.js";
import { createCodexAppServerProviderBundle } from "../../providers/src/codex/appServerProvider.js";
import type {
  AssistantProviderInput,
  ProviderExecutionContext,
  VisionEvaluationProviderInput
} from "../../providers/src/types.js";

const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "codex-app-server", "fake-app-server.mjs");
const children = new Set<ChildProcessWithoutNullStreams>();

function client() {
  const child = spawn(process.execPath, [fixture], { stdio: "pipe", windowsHide: true });
  children.add(child);
  child.once("close", () => children.delete(child));
  return new CodexAppServerClient({
    stdin: child.stdin,
    stdout: child.stdout,
    stderr: child.stderr,
    close: () => { child.kill(); }
  });
}

function runtime(mode = "normal") {
  return new CodexAppServerRuntime({
    executablePath: process.execPath,
    appServerArgs: [fixture],
    env: { ...process.env, ETHER_FAKE_APP_SERVER_MODE: mode },
    initializationTimeoutMs: 1_000,
    restartBudget: 1
  });
}

function assistantInput(): AssistantProviderInput {
  return {
    projectPath: process.cwd(), runId: "run-a", assistantNodeId: "node-a", assistantSubtype: "Worker",
    prompt: "hello", instruction: "answer", notes: "", sections: [], references: [], edgeRoles: [],
    requestedAt: new Date(0).toISOString()
  };
}

function evaluationInput(): VisionEvaluationProviderInput {
  return {
    projectPath: process.cwd(), runId: "run-e", evaluationNodeId: "node-e", instruction: "STRUCTURED",
    criteria: "quality", threshold: 80, images: [], requestedAt: new Date(0).toISOString()
  };
}

function executionContext<T>(signal = new AbortController().signal): ProviderExecutionContext<T> {
  return {
    signal, providerAttemptId: "attempt-1", attemptOrdinal: 1, stagingDirectory: process.cwd(),
    complete: async () => undefined
  };
}

afterEach(async () => {
  for (const child of children) child.kill();
  await new Promise((resolve) => setTimeout(resolve, 10));
});

describe("Codex App Server session and turn providers", () => {
  it("uses Task 11 graph-safe scope keys and serializes turns per key", async () => {
    const appServer = client();
    await appServer.initialize();
    const pool = new CodexAppServerSessionPool(() => ({ client: appServer, generation: 1 }));
    const scopeKey = resolveMemoryScopeKey(
      { mode: "per-branch" },
      { documentId: "doc:1", graphId: "graph:1", nodeId: "node:1", lineageKey: "edge/1" }
    );
    const session = { documentId: "doc:1", memoryScopeKey: scopeKey };
    const order: string[] = [];

    const first = pool.withThread(session, { cwd: process.cwd() }, async () => {
      order.push("first-start");
      await new Promise((resolve) => setTimeout(resolve, 20));
      order.push("first-end");
    });
    const second = pool.withThread(session, { cwd: process.cwd() }, async (_threadId) => order.push("second"));
    await Promise.all([first, second]);

    expect(order).toEqual(["first-start", "first-end", "second"]);
    expect(pool.size).toBe(1);
    pool.invalidateGeneration(2);
    expect(pool.size).toBe(0);
    await pool.close();
    await appServer.close();
  });

  it("keeps stateless calls unpooled and clears only one document", async () => {
    const appServer = client();
    await appServer.initialize();
    const pool = new CodexAppServerSessionPool(() => ({ client: appServer, generation: 1 }));
    await pool.withThread({ documentId: "doc-a", memoryScopeKey: "scope-a" }, { cwd: process.cwd() }, async () => undefined);
    await pool.withThread({ documentId: "doc-b", memoryScopeKey: "scope-b" }, { cwd: process.cwd() }, async () => undefined);
    await pool.withThread({ documentId: "doc-a", memoryScopeKey: null }, { cwd: process.cwd() }, async () => undefined);
    expect(pool.size).toBe(2);
    pool.clearDocument("doc-a");
    expect(pool.keys()).toEqual(["scope-b"]);
    await pool.close();
    await appServer.close();
  });

  it("passes outputSchema and validated image inputs and assembles structured output", async () => {
    const appServer = client();
    await appServer.initialize();
    const pool = new CodexAppServerSessionPool(() => ({ client: appServer, generation: 1 }));
    const runner = new CodexAppServerTurnRunner(() => ({ client: appServer, generation: 1 }), pool);
    const result = await runner.run({
      documentId: "doc", memoryScopeKey: null, cwd: process.cwd(), prompt: "STRUCTURED",
      images: [{ kind: "data-url", value: "data:image/png;base64,iVBORw0KGgo=" }],
      outputSchema: { type: "object", required: ["score", "decision"], properties: { score: { type: "number" }, decision: { type: "string" } } }
    });
    expect(result.structuredOutput).toEqual({ score: 91, decision: "pass" });
    expect(result.provenance).toMatchObject({ transport: "app-server", manifestHash: expect.any(String), threadId: expect.any(String), turnId: expect.any(String) });
    await pool.close();
    await appServer.close();
  });

  it("sends strict evaluation schemas accepted by the live structured-output contract", async () => {
    const appRuntime = runtime("strict-schema");
    const bundle = createCodexAppServerProviderBundle({ runtime: appRuntime });

    await expect(bundle.evaluation.evaluate(evaluationInput(), executionContext())).resolves.toMatchObject({
      providerId: "codex-vision-evaluation"
    });

    await bundle.close();
  });

  it("rejects unsupported image inputs before dispatch", async () => {
    const appServer = client();
    await appServer.initialize();
    const pool = new CodexAppServerSessionPool(() => ({ client: appServer, generation: 1 }));
    const runner = new CodexAppServerTurnRunner(() => ({ client: appServer, generation: 1 }), pool);
    await expect(runner.run({
      documentId: "doc", memoryScopeKey: null, cwd: process.cwd(), prompt: "vision",
      images: [{ kind: "data-url", value: "data:text/plain;base64,SGVsbG8=" }]
    })).rejects.toMatchObject({ code: "CODEX_IMAGE_INPUT_INVALID" });
    await pool.close();
    await appServer.close();
  });

  it("preserves facet IDs through one runtime-backed bundle", async () => {
    const appRuntime = runtime();
    const bundle = createCodexAppServerProviderBundle({ runtime: appRuntime });
    const assistant = await bundle.assistant.run(assistantInput(), executionContext());
    const evaluation = await bundle.evaluation.evaluate(evaluationInput(), executionContext());
    expect(bundle.generation.descriptor.id).toBe("codex-chatgpt-image-2");
    expect(assistant.providerId).toBe("codex-vision-assistant");
    expect(evaluation.providerId).toBe("codex-vision-evaluation");
    expect(assistant.metadata).toMatchObject({ transport: "app-server", manifestHash: expect.any(String) });
    await bundle.close();
  });

  it("activates explicit exec fallback only after handshake failure and never for turn errors", async () => {
    let assistantFallbackCalls = 0;
    const fallback = {
      assistant: { descriptor: { id: "codex-vision-assistant", name: "fallback", route: "codex-cli" as const, capabilities: ["assistant.text" as const] }, diagnose: () => ({ id: "codex-vision-assistant", name: "fallback", route: "codex-cli" as const, capabilities: ["assistant.text" as const], availability: "available" as const, messages: [] }), run: async () => { assistantFallbackCalls += 1; return { providerId: "codex-vision-assistant", providerName: "fallback", capabilities: ["assistant.text" as const], text: "fallback" }; } }
    };
    const failedRuntime = runtime("die-init");
    const failedBundle = createCodexAppServerProviderBundle({ runtime: failedRuntime, execFallback: fallback });
    await expect(failedBundle.assistant.run(assistantInput(), executionContext())).resolves.toMatchObject({ text: "fallback" });
    expect(failedRuntime.health().transport).toBe("exec-fallback");
    await failedBundle.close();

    const turnErrorRuntime = runtime("turn-error");
    const turnErrorBundle = createCodexAppServerProviderBundle({ runtime: turnErrorRuntime, execFallback: fallback });
    await expect(turnErrorBundle.assistant.run(assistantInput(), executionContext())).rejects.toThrow(/ordinary turn error/i);
    expect(assistantFallbackCalls).toBe(1);
    expect(turnErrorRuntime.health().transport).toBe("app-server");
    await turnErrorBundle.close();

    const cancelRuntime = runtime();
    const cancelBundle = createCodexAppServerProviderBundle({ runtime: cancelRuntime, execFallback: fallback });
    await cancelRuntime.start();
    const controller = new AbortController();
    const cancelledInput = { ...assistantInput(), prompt: "WAIT_FOR_INTERRUPT" };
    const cancelled = cancelBundle.assistant.run(cancelledInput, executionContext(controller.signal));
    setTimeout(() => controller.abort(), 20);
    await expect(cancelled).rejects.toMatchObject({ name: "AbortError", completedStatus: "interrupted" });
    expect(assistantFallbackCalls).toBe(1);
    expect(cancelRuntime.health().transport).toBe("app-server");
    await cancelBundle.close();

    const activeDeathRuntime = runtime("die-active");
    const activeDeathBundle = createCodexAppServerProviderBundle({ runtime: activeDeathRuntime, execFallback: fallback });
    await expect(activeDeathBundle.assistant.run(assistantInput(), executionContext())).rejects.toThrow(/active turn|closed|exited/i);
    expect(assistantFallbackCalls).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(activeDeathRuntime.health().transport).toBe("unavailable");
    await activeDeathBundle.close();
  });
});
