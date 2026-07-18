import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  CODEX_APP_SERVER_MANIFEST_SHA256,
  CODEX_APP_SERVER_VERSION
} from "../../providers/src/codex/appServer/protocol.js";
import { CodexAppServerClient } from "../../providers/src/codex/appServer/client.js";

const fixtureDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "codex-app-server");
const children = new Set<ChildProcessWithoutNullStreams>();

function fake(mode = "normal") {
  const child = spawn(process.execPath, [path.join(fixtureDir, "fake-app-server.mjs")], {
    env: { ...process.env, ETHER_FAKE_APP_SERVER_MODE: mode },
    stdio: "pipe",
    windowsHide: true
  });
  children.add(child);
  child.once("close", () => children.delete(child));
  return child;
}

function clientFor(mode = "normal", options: { maxFrameBytes?: number; maxEvents?: number; maxToolEvents?: number } = {}) {
  const child = fake(mode);
  return {
    child,
    client: new CodexAppServerClient({
      stdin: child.stdin,
      stdout: child.stdout,
      stderr: child.stderr,
      close: () => { child.kill(); },
      ...options
    })
  };
}

afterEach(async () => {
  for (const child of children) child.kill();
  await new Promise((resolve) => setTimeout(resolve, 10));
});

describe("Codex App Server protocol 0.144.2", () => {
  it("pins generated schema metadata and a checked-in transcript", async () => {
    expect(CODEX_APP_SERVER_VERSION).toBe("0.144.2");
    expect(CODEX_APP_SERVER_MANIFEST_SHA256).toBe("579e6d66fe30749682413b6a32289b896c314db8a3e51b11d65874214e098ee6");
    const transcript = await readFile(path.join(fixtureDir, "codex-0.144.2-transcript.jsonl"), "utf8");
    expect(transcript.trim().split(/\r?\n/)).toHaveLength(13);
    expect(transcript).toContain('"method":"turn/completed"');

    const manifest = JSON.parse(await readFile(
      path.join(fixtureDir, "..", "..", "..", "providers", "protocol", "codex-0.144.2", "manifest.json"),
      "utf8"
    )) as {
      generatedFileCount: number;
      generatedFiles: Array<{ path: string; bytes: number; sha256: string }>;
      selectedSchemas: string[];
      manifestSha256: string;
      [key: string]: unknown;
    };
    const { manifestSha256, ...manifestPayload } = manifest;
    expect(createHash("sha256").update(JSON.stringify(manifestPayload)).digest("hex")).toBe(manifestSha256);
    expect(manifest.generatedFiles).toHaveLength(manifest.generatedFileCount);
    for (const selectedPath of manifest.selectedSchemas) {
      const content = await readFile(path.join(
        fixtureDir,
        "..", "..", "..", "providers", "protocol", "codex-0.144.2", "schema",
        selectedPath.replaceAll("/", "-")
      ));
      const entry = manifest.generatedFiles.find((candidate) => candidate.path === selectedPath);
      expect(entry).toBeDefined();
      expect(content.byteLength).toBe(entry?.bytes);
      expect(createHash("sha256").update(content).digest("hex")).toBe(entry?.sha256);
    }
  });

  it("frames split CRLF messages, initializes, and correlates paginated model requests", async () => {
    const { client } = clientFor("crlf-split");
    const initialized = await client.initialize({ clientName: "ether-tests", clientVersion: "4.0.0" });
    const models = await client.listModels({ includeHidden: true, pageSize: 1 });

    expect(initialized.userAgent).toBe("codex-cli/0.144.2");
    expect(models.map((model) => model.id)).toEqual(["gpt-5.4", "hidden-model"]);
    expect(models[0]).toMatchObject({ isDefault: true, hidden: false, defaultReasoningEffort: "medium" });
    expect(models[0]?.supportedReasoningEfforts.map((effort) => effort.reasoningEffort)).toEqual(["low", "medium"]);
    await client.close();
  });

  it("preserves ordered deltas, final items, warnings, image events, and unknown events", async () => {
    const { client } = clientFor();
    await client.initialize();
    const thread = await client.startThread({ cwd: process.cwd(), model: "gpt-5.4" });
    const seen: string[] = [];
    const unsubscribe = client.subscribe((event) => seen.push(event.method));
    const result = await client.runTurn({
      threadId: thread.threadId,
      input: [{ type: "text", text: "hello" }]
    });

    expect(result.text).toBe("fixture response");
    expect(result.warnings).toEqual(["fixture warning"]);
    expect(result.imageViews).toEqual(["C:\\Fixture\\view.png"]);
    expect(result.imageGenerations[0]).toMatchObject({ savedPath: "C:\\Fixture\\generated.png" });
    expect(result.unknownEvents).toHaveLength(1);
    expect(seen.indexOf("turn/started")).toBeLessThan(seen.indexOf("turn/completed"));
    unsubscribe();
    await client.close();
  });

  it("distinguishes interrupt acknowledgement from completed-interrupted", async () => {
    const { client } = clientFor();
    await client.initialize();
    const thread = await client.startThread({ cwd: process.cwd() });
    const controller = new AbortController();
    const running = client.runTurn({
      threadId: thread.threadId,
      input: [{ type: "text", text: "WAIT_FOR_INTERRUPT" }],
      signal: controller.signal,
      interruptCompletionTimeoutMs: 500
    });
    setTimeout(() => controller.abort(), 20);

    await expect(running).rejects.toMatchObject({ name: "AbortError", completedStatus: "interrupted" });
    await client.close();
  });

  it("times out when interrupt is acknowledged but never completes", async () => {
    const { client } = clientFor("interrupt-never-completes");
    await client.initialize();
    const thread = await client.startThread({ cwd: process.cwd() });
    const controller = new AbortController();
    const running = client.runTurn({
      threadId: thread.threadId,
      input: [{ type: "text", text: "WAIT_FOR_INTERRUPT" }],
      signal: controller.signal,
      interruptCompletionTimeoutMs: 30
    });
    setTimeout(() => controller.abort(), 10);
    await expect(running).rejects.toThrow(/did not complete as interrupted/i);
    await client.close();
  });

  it("rejects malformed and oversized frames and closes pending requests exactly once", async () => {
    const malformed = clientFor("malformed-init");
    await expect(malformed.client.initialize()).rejects.toThrow(/malformed/i);
    await malformed.client.close();

    const oversized = clientFor("oversized-frame", { maxFrameBytes: 1024 });
    await oversized.client.initialize();
    const thread = await oversized.client.startThread({ cwd: process.cwd() });
    await expect(oversized.client.runTurn({
      threadId: thread.threadId,
      input: [{ type: "text", text: "large" }]
    })).rejects.toThrow(/frame.*limit/i);
    await oversized.client.close();
  });

  it("accepts bounded multi-megabyte image-generation frames by default", async () => {
    const { client } = clientFor("large-image-frame");
    await client.initialize();
    const thread = await client.startThread({ cwd: process.cwd() });
    const result = await client.runTurn({
      threadId: thread.threadId,
      input: [{ type: "text", text: "generate" }]
    });

    expect(result.imageGenerations).toHaveLength(1);
    expect(result.imageGenerations[0]?.savedPath).toBe("C:\\Fixture\\large-generated.png");
    await client.close();
  });

  it("bounds retained events while preserving completion", async () => {
    const { client } = clientFor("flood-tools", { maxEvents: 3, maxToolEvents: 2 });
    await client.initialize();
    const thread = await client.startThread({ cwd: process.cwd() });
    const result = await client.runTurn({ threadId: thread.threadId, input: [{ type: "text", text: "bounded" }] });
    expect(result.events.length).toBeLessThanOrEqual(3);
    expect(result.toolEvents).toHaveLength(2);
    expect(result.truncated.events).toBe(true);
    expect(result.truncated.toolEvents).toBe(true);
    expect(client.capturedStderr).toContain("fake app server diagnostic noise");
    await client.close();
  });

  it("treats duplicate and unknown response IDs as fatal protocol errors", async () => {
    const duplicate = clientFor("duplicate-response");
    await expect(duplicate.client.initialize()).rejects.toThrow(/duplicate response id/i);
    expect(duplicate.client.isClosed).toBe(true);

    const unknown = clientFor("unknown-response");
    await expect(unknown.client.initialize()).rejects.toThrow(/unknown response id/i);
    expect(unknown.client.isClosed).toBe(true);
  });

  it("rejects a pending turn once when the client closes and makes repeated close idempotent", async () => {
    const { client } = clientFor();
    await client.initialize();
    const thread = await client.startThread({ cwd: process.cwd() });
    let rejectionCount = 0;
    const running = client.runTurn({
      threadId: thread.threadId,
      input: [{ type: "text", text: "WAIT_FOR_INTERRUPT" }]
    }).catch((error) => {
      rejectionCount += 1;
      throw error;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    await client.close();
    await client.close();
    await expect(running).rejects.toThrow(/closed/i);
    expect(rejectionCount).toBe(1);
  });
});
