import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveMemoryScopeKey } from "@ether/intelligence";
import { CodexAppServerClient } from "../../providers/src/codex/appServer/client.js";
import { CodexAppServerSessionPool } from "../../providers/src/codex/appServer/sessionPool.js";
import { CodexAppServerTurnRunner } from "../../providers/src/codex/appServer/turnRunner.js";
import { CodexAppServerRuntime } from "../../providers/src/runtime.js";
import { createCodexAppServerProviderBundle } from "../../providers/src/codex/appServerProvider.js";
import type {
  AssistantProviderInput,
  GenerationProviderInput,
  ProviderExecutionContext,
  VisionEvaluationProviderInput
} from "../../providers/src/types.js";

const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "codex-app-server", "fake-app-server.mjs");
const children = new Set<ChildProcessWithoutNullStreams>();
const tempRoots: string[] = [];
const tinyPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");

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

function runtime(mode = "normal", extraEnv: Record<string, string> = {}) {
  return new CodexAppServerRuntime({
    executablePath: process.execPath,
    appServerArgs: [fixture],
    env: { ...process.env, ...extraEnv, ETHER_FAKE_APP_SERVER_MODE: mode },
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
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
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
    await pool.withThread({ documentId: "doc-a", memoryScopeKey: "same-scope" }, { cwd: process.cwd() }, async () => undefined);
    await pool.withThread({ documentId: "doc-b", memoryScopeKey: "same-scope" }, { cwd: process.cwd() }, async () => undefined);
    await pool.withThread({ documentId: "doc-a", memoryScopeKey: null }, { cwd: process.cwd() }, async () => undefined);
    expect(pool.size).toBe(2);
    pool.clearDocument("doc-a");
    expect(pool.keys()).toEqual([JSON.stringify(["doc-b", "same-scope"])]);
    await pool.close();
    await appServer.close();
  });

  it("forwards selected model and reasoning effort to thread and turn requests", async () => {
    const requestLog = path.join(os.tmpdir(), `ether-codex-requests-${Date.now()}.jsonl`);
    const appRuntime = runtime("normal", { ETHER_FAKE_APP_SERVER_REQUEST_LOG: requestLog });
    const bundle = createCodexAppServerProviderBundle({ runtime: appRuntime });
    await bundle.assistant.run({ ...assistantInput(), model: "gpt-5.4", reasoningEffort: "low" }, executionContext());
    const requests = (await readFile(requestLog, "utf8")).trim().split(/\r?\n/).map((line) => JSON.parse(line));
    expect(requests.find((request) => request.method === "thread/start")?.params).toMatchObject({
      model: "gpt-5.4",
      config: { model_reasoning_effort: "low" }
    });
    expect(requests.find((request) => request.method === "turn/start")?.params).toMatchObject({
      model: "gpt-5.4",
      effort: "low"
    });
    await bundle.close();
    await rm(requestLog, { force: true });
  });

  it("preserves discovered PNGs, validates provider-determined aspect, and completes with a distinct staged copy", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ether-app-server-image-"));
    tempRoots.push(root);
    const originalPath = path.join(root, "original.png");
    const stagingDirectory = path.join(root, "staging");
    const requestLog = path.join(root, "requests.jsonl");
    await writeFile(originalPath, tinyPng);
    const originalHash = sha256(tinyPng);
    const appRuntime = runtime("normal", {
      ETHER_FAKE_APP_SERVER_IMAGE_OUTPUT_PATH: originalPath,
      ETHER_FAKE_APP_SERVER_REQUEST_LOG: requestLog
    });
    const bundle = createCodexAppServerProviderBundle({ runtime: appRuntime });
    const complete = vi.fn(async () => undefined);
    const generated = await bundle.generation.generate(generationInput(root), {
      signal: new AbortController().signal,
      providerAttemptId: "image-attempt",
      attemptOrdinal: 1,
      stagingDirectory,
      complete
    });

    const artifact = generated.artifacts[0]!;
    expect(artifact.sourcePath).not.toBe(originalPath);
    expect(path.dirname(artifact.sourcePath!)).toBe(stagingDirectory);
    expect(sha256(await readFile(artifact.sourcePath!))).toBe(originalHash);
    expect(sha256(await readFile(originalPath))).toBe(originalHash);
    expect(artifact.metadata).toMatchObject({
      outputDiscovery: "imageGeneration.savedPath",
      originalPreserved: true,
      dimensionMode: "provider-determined",
      exactResolution: false,
      requestedDimensions: { width: 1024, height: 1024, aspectRatio: "1:1" },
      actualDimensions: { width: 1, height: 1 }
    });
    expect(complete).toHaveBeenCalledWith(generated);
    const requests = await readFile(requestLog, "utf8");
    expect(requests).toContain("provider-determined");
    expect(requests).not.toContain("1024x1024");
    await bundle.close();
  });

  it("rejects output whose aspect conflicts with the manifest profile without modifying the original", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ether-app-server-aspect-"));
    tempRoots.push(root);
    const originalPath = path.join(root, "original.png");
    const content = pngWithDimensions(2, 1);
    await writeFile(originalPath, content);
    const appRuntime = runtime("normal", { ETHER_FAKE_APP_SERVER_IMAGE_OUTPUT_PATH: originalPath });
    const bundle = createCodexAppServerProviderBundle({ runtime: appRuntime });
    await expect(bundle.generation.generate(generationInput(root), {
      signal: new AbortController().signal,
      providerAttemptId: "aspect-attempt",
      attemptOrdinal: 1,
      stagingDirectory: path.join(root, "staging"),
      complete: async () => undefined
    })).rejects.toMatchObject({
      code: "CODEX_IMAGE_ASPECT_MISMATCH",
      category: "malformed-output",
      retryable: false
    });
    expect(sha256(await readFile(originalPath))).toBe(sha256(content));
    await bundle.close();
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
    await expect(turnErrorBundle.assistant.run(assistantInput(), executionContext())).rejects.toMatchObject({
      code: "CODEX_APP_SERVER_INVALID_INPUT",
      category: "invalid-input",
      retryable: false
    });
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

function generationInput(projectPath: string): GenerationProviderInput {
  return {
    projectPath,
    runId: "run-image",
    generationNodeId: "image-node",
    iteration: 1,
    prompt: "fixture image",
    negativePrompt: "",
    sections: [],
    references: [],
    edgeRoles: [],
    outputCount: 1,
    output: { aspectRatio: "1:1", resolution: "1024", width: 1024, height: 1024 },
    requestedAt: new Date(0).toISOString()
  };
}

function sha256(content: Buffer) {
  return createHash("sha256").update(content).digest("hex");
}

function pngWithDimensions(width: number, height: number) {
  const content = Buffer.from(tinyPng);
  content.writeUInt32BE(width, 16);
  content.writeUInt32BE(height, 20);
  content.writeUInt32BE(crc32(content.subarray(12, 29)), 29);
  return content;
}

function crc32(content: Buffer) {
  let crc = 0xffffffff;
  for (const byte of content) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
