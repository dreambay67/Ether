import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  fsyncSync,
  statSync,
  symlinkSync,
  writeFileSync,
  writeSync
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import { normalizeDesktopError } from "../../../apps/desktop/src/shared/ipc/contracts";
import {
  redactSensitiveText as redactDesktopSensitiveText
} from "../../../apps/desktop/src/shared/redaction";
import {
  LocalDiagnosticLogger,
  cleanupOwnedDiagnosticFiles
} from "../../../apps/desktop/src/main/diagnostics/localDiagnostics";
import { EtherErrorSchema } from "@ether/schema";
import type { EtherGraph } from "@ether/schema";
import { EtherApplication } from "@ether/application";
import { FakeImageProvider } from "@ether/providers";
import { createCodexProviderProcessCall, runProviderProcess } from "../../providers/src/codex/processRunner";
import { redactSensitiveText } from "../../providers/src/antigravity/processRunner";
import { ExecutionRepository } from "../../document/src/repositories/execution";
import {
  MAX_CACHED_JOB_CORRELATIONS,
  createRepositoryContext
} from "../../document/src/repositories/graphs";

const roots: string[] = [];

function tempRoot(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "ether-observability-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("error observability boundary", () => {
  it("preserves a typed correlation cause while redacting local and UNC paths", () => {
    const normalized = normalizeDesktopError(Object.assign(
      new Error("Provider failed for C:\\Users\\Ada\\secret.png and \\\\server\\share\\secret.png"),
      { code: "PROVIDER_FAILED", category: "provider", causeId: "correlation-1", retryable: true }
    ));
    expect(EtherErrorSchema.parse(normalized)).toMatchObject({
      code: "PROVIDER_FAILED", category: "provider", causeId: "correlation-1", retryable: true
    });
    expect(normalized.message).not.toMatch(/Users|server|secret\.png/);
  });

  it("does not permit arbitrary error fields to cross the renderer bridge", () => {
    expect(EtherErrorSchema.safeParse({
      code: "SECURITY", category: "security", message: "blocked", retryable: false, stack: "private"
    }).success).toBe(false);
  });

  it("flushes queued diagnostics explicitly on orderly shutdown and fatal process failure", () => {
    const mainSource = readFileSync(
      path.resolve(import.meta.dirname, "../../../apps/desktop/src/main/main.ts"),
      "utf8"
    );
    expect(mainSource).toMatch(/diagnosticLogger\.flush\?\.\(\)/);
    expect(mainSource).toMatch(/process\.on\("uncaughtExceptionMonitor", flushDiagnosticsAfterCrash\)/);
    expect(mainSource).toMatch(/diagnosticLogger\.flushSync\?\.\(\)/);
  });

  it("uses argv and stdin literally, strips platform API credentials, and redacts process diagnostics", async () => {
    const marker = "$(whoami) & echo owned";
    const call = createCodexProviderProcessCall({
      command: process.execPath,
      args: ["--eval", "process.stdin.on('data', value => process.stdout.write(value))"],
      cwd: process.cwd(),
      stdin: marker,
      env: { PATH: process.env.PATH, OPENAI_API_KEY: "never-forward", SAFE_VALUE: "kept" }
    });
    expect(call.env).toEqual(expect.objectContaining({ SAFE_VALUE: "kept" }));
    expect(call.env.OPENAI_API_KEY).toBeUndefined();
    await expect(runProviderProcess(call, { timeoutMs: 5_000 })).resolves.toMatchObject({ stdout: marker, exitCode: 0 });
    const redacted = redactSensitiveText("Bearer token-value C:\\Users\\Ada\\secret.png ada@example.test");
    expect(redacted).not.toMatch(/token-value|Ada|example\.test/);
  });

  it("redacts quoted spaced paths and exact secret components without corrupting benign structured text", () => {
    const message = redactDesktopSensitiveText(
      String.raw`tokenCount=7 secretary=Jordan token = "value with spaces" ` +
      String.raw`"C:\Users\Ada Lovelace\Private Work\image final.png" ` +
      String.raw`"\\server\Design Share\Private Work\image final.png" ` +
      `"/Users/Ada Lovelace/Private Work/image final.png" ` +
      `https://example.test/api/v1 /components/schemas/tokenCount ` +
      String.raw`then C:\Users\Grace Hopper\Final Work\terminal file.png; ` +
      String.raw`C:\Users\Ada Lovelace\Documents failed; ` +
      `/home/Ada Lovelace/private failed`
    );
    expect(message).toContain("tokenCount=7");
    expect(message).toContain("secretary=Jordan");
    expect(message).toContain("https://example.test/api/v1");
    expect(message).toContain("/components/schemas/tokenCount");
    expect(message).toContain("token=[REDACTED]");
    expect(message).toContain('"[LOCAL_PATH]"');
    expect(message).toContain('"[NETWORK_PATH]"');
    expect(message).not.toMatch(/value with spaces|Ada Lovelace|Design Share|Private Work|Grace Hopper|Final Work|\\Documents|\/private/u);
    expect(message.match(/\[LOCAL_PATH\]/gu)?.length).toBeGreaterThanOrEqual(5);
    expect(message.match(/\bfailed\b/gu)).toHaveLength(2);

    expect(redactDesktopSensitiveText(
      String.raw`C:\Ada Lovelace failed /Ada Lovelace failed ` +
      `https://example.test/Ada Lovelace failed file:///Ada%20Lovelace failed ` +
      `/components/schemas/Ada Lovelace failed tokenCount=7`
    )).toBe(
      `[LOCAL_PATH] failed [LOCAL_PATH] failed ` +
      `https://example.test/Ada Lovelace failed file:///Ada%20Lovelace failed ` +
      `/components/schemas/Ada Lovelace failed tokenCount=7`
    );

    expect(normalizeDesktopError(new Error(
      String.raw`Failed at "C:\Users\Ada Lovelace\Private Work\image final.png" with secret = "never show"`
    )).message).toBe('Failed at "the selected file" with secret=[REDACTED]');
  });

  it("persists bounded JSONL with preserved correlation identity, redaction, age, and size rotation", async () => {
    const appDataRoot = tempRoot();
    let now = Date.parse("2026-07-23T00:00:00.000Z");
    const logger = new LocalDiagnosticLogger({
      appDataRoot,
      appVersion: "4.0.0",
      maxAgeMs: 1_000,
      maxBytes: 512,
      maxFiles: 2,
      now: () => now
    });
    for (let index = 0; index < 5; index += 1) {
      logger.log({
        causeId: "provider-attempt-1",
        correlationId: "correlation-release-1",
        details: {
          apiKey: "sk-never-persist",
          sourcePath: "C:\\Users\\Ada\\secret-reference.png"
        },
        event: "provider.output.import",
        level: index === 4 ? "error" : "info",
        message: `Bearer token-${index} failed at \\\\server\\share\\secret-${index}.png ${"x".repeat(120)}`
      });
      now += 10;
    }
    await logger.flush();
    const diagnosticsRoot = path.join(appDataRoot, "diagnostics");
    const manifest = JSON.parse(readFileSync(path.join(diagnosticsRoot, "manifest.json"), "utf8")) as {
      files: Array<{ path: string }>;
    };
    expect(manifest.files.length).toBeLessThanOrEqual(2);
    const serialized = manifest.files.map(({ path: relativePath }) => {
      const absolute = path.join(diagnosticsRoot, ...relativePath.split("/"));
      expect(statSync(absolute).size).toBeLessThanOrEqual(512);
      return readFileSync(absolute, "utf8");
    }).join("");
    expect(serialized).toContain('"appVersion":"4.0.0"');
    expect(serialized).toContain('"correlationId":"correlation-release-1"');
    expect(serialized).toContain('"causeId":"provider-attempt-1"');
    expect(serialized).not.toMatch(/token-\d|sk-never|Users|server|secret-reference|secret-\d/);

    now += 2_000;
    logger.log({
      correlationId: "correlation-after-age-rotation",
      event: "desktop.lifecycle.ready",
      level: "info",
      message: "ready"
    });
    await logger.flush();
    const afterAge = JSON.parse(readFileSync(path.join(diagnosticsRoot, "manifest.json"), "utf8")) as {
      files: Array<{ path: string }>;
    };
    expect(afterAge.files.length).toBeLessThanOrEqual(2);
    expect(afterAge.files.some(({ path: relativePath }) => relativePath === "logs/ether-current.jsonl")).toBe(true);
  });

  it("cleans only manifest-owned regular files and refuses traversal, symlinks, and untracked AppData", async () => {
    const appDataRoot = tempRoot();
    const logger = new LocalDiagnosticLogger({ appDataRoot, appVersion: "4.0.0", maxBytes: 512 });
    logger.log({
      correlationId: "cleanup-1",
      event: "cleanup.probe",
      level: "info",
      message: "tracked"
    });
    await logger.flush();
    const unrelated = path.join(appDataRoot, "settings.json");
    const untracked = path.join(appDataRoot, "diagnostics", "logs", "user-note.txt");
    writeFileSync(unrelated, "preserve");
    writeFileSync(untracked, "preserve");
    cleanupOwnedDiagnosticFiles({ appDataRoot, maxAgeMs: 0, maxFiles: 1, now: Date.now() + 10_000 });
    expect(readFileSync(unrelated, "utf8")).toBe("preserve");
    expect(readFileSync(untracked, "utf8")).toBe("preserve");

    const manifestPath = path.join(appDataRoot, "diagnostics", "manifest.json");
    const outside = path.join(appDataRoot, "outside.jsonl");
    writeFileSync(outside, "outside");
    writeFileSync(manifestPath, JSON.stringify({
      version: 1,
      files: [{ path: "logs/../outside.jsonl", createdAt: "2026-07-23T00:00:00.000Z" }]
    }));
    expect(() => cleanupOwnedDiagnosticFiles({ appDataRoot }))
      .toThrowError(expect.objectContaining({ code: "DIAGNOSTIC_MANIFEST_UNSAFE" }));
    expect(readFileSync(outside, "utf8")).toBe("outside");

    const symlinkRoot = tempRoot();
    const logs = path.join(symlinkRoot, "diagnostics", "logs");
    mkdirSync(logs, { recursive: true });
    const external = path.join(symlinkRoot, "external.jsonl");
    writeFileSync(external, "external");
    writeFileSync(path.join(symlinkRoot, "diagnostics", "manifest.json"), JSON.stringify({
      version: 1,
      files: [{ path: "logs/ether-current.jsonl", createdAt: "2026-07-23T00:00:00.000Z" }]
    }));
    try {
      symlinkSync(external, path.join(logs, "ether-current.jsonl"), "file");
      expect(() => cleanupOwnedDiagnosticFiles({ appDataRoot: symlinkRoot }))
        .toThrowError(expect.objectContaining({ code: "DIAGNOSTIC_SYMLINK_REFUSED" }));
      expect(readFileSync(external, "utf8")).toBe("external");
    } catch (error) {
      expect(["EPERM", "EACCES"]).toContain((error as { code?: string }).code);
    }
    expect(readdirSync(path.dirname(untracked))).toContain("user-note.txt");
  });

  it("self-heals when an owned current log disappears between writes", async () => {
    const appDataRoot = tempRoot();
    const logger = new LocalDiagnosticLogger({ appDataRoot, appVersion: "4.0.0", maxBytes: 1_024 });
    logger.log({
      correlationId: "missing-current-before",
      event: "diagnostic.before-delete",
      level: "info",
      message: "before"
    });
    await logger.flush();
    const current = path.join(appDataRoot, "diagnostics", "logs", "ether-current.jsonl");
    rmSync(current, { force: true });
    logger.log({
      correlationId: "missing-current-after",
      event: "diagnostic.after-delete",
      level: "info",
      message: "after"
    });
    await logger.flush();
    expect(readFileSync(current, "utf8")).toContain('"correlationId":"missing-current-after"');
    const manifest = JSON.parse(
      readFileSync(path.join(appDataRoot, "diagnostics", "manifest.json"), "utf8")
    ) as { files: Array<{ path: string }> };
    expect(manifest.files.filter(({ path: relativePath }) =>
      relativePath === "logs/ether-current.jsonl"
    )).toHaveLength(1);
  });

  it("adopts an owned rotation orphan after a crash gap and keeps retention bounded", async () => {
    const appDataRoot = tempRoot();
    let now = Date.parse("2026-07-23T01:00:00.000Z");
    let failRotation = true;
    const interrupted = new LocalDiagnosticLogger({
      appDataRoot,
      appVersion: "4.0.0",
      maxBytes: 512,
      maxFiles: 2,
      now: () => now,
      checkpoint: (stage) => {
        if (stage === "rotation-renamed" && failRotation) {
          failRotation = false;
          throw new Error("simulated hard stop after rotation rename");
        }
      }
    });
    interrupted.log({
      correlationId: "rotation-before-crash",
      event: "diagnostic.rotation.before",
      level: "info",
      message: `first record ${"x".repeat(250)}`
    });
    await interrupted.flush();
    now += 10;
    interrupted.log({
      correlationId: "rotation-crash-gap",
      event: "diagnostic.rotation.crash",
      level: "warning",
      message: "x".repeat(420)
    });
    await expect(interrupted.flush()).rejects.toThrow("simulated hard stop");

    const recovered = new LocalDiagnosticLogger({
      appDataRoot,
      appVersion: "4.0.0",
      maxBytes: 512,
      maxFiles: 2,
      now: () => now
    });
    recovered.log({
      correlationId: "rotation-after-restart",
      event: "diagnostic.rotation.recovered",
      level: "info",
      message: "recovered"
    });
    await recovered.flush();
    const diagnosticsRoot = path.join(appDataRoot, "diagnostics");
    const manifest = JSON.parse(
      readFileSync(path.join(diagnosticsRoot, "manifest.json"), "utf8")
    ) as { files: Array<{ path: string }> };
    expect(manifest.files).toHaveLength(2);
    const content = manifest.files.map(({ path: relativePath }) =>
      readFileSync(path.join(diagnosticsRoot, ...relativePath.split("/")), "utf8")
    ).join("");
    expect(content).toContain('"correlationId":"rotation-before-crash"');
    expect(content).toContain('"correlationId":"rotation-after-restart"');
  });

  it("retains ordered records across manifest, append, and rename faults without duplicate admission", async () => {
    for (const fault of ["manifest-written", "append-written", "rotation-renamed"] as const) {
      const appDataRoot = tempRoot();
      let now = Date.parse("2026-07-23T02:00:00.000Z");
      let armed = fault !== "rotation-renamed";
      const logger = new LocalDiagnosticLogger({
        appDataRoot,
        appVersion: "4.0.0",
        maxBytes: 512,
        maxFiles: 4,
        now: () => now,
        checkpoint: (stage) => {
          if (stage === fault && armed) {
            armed = false;
            throw new Error(`injected ${fault} fault`);
          }
        }
      });
      if (fault === "rotation-renamed") {
        logger.log({
          correlationId: `${fault}-seed`,
          event: "diagnostic.fault.seed",
          level: "info",
          message: "x".repeat(250)
        });
        await logger.flush();
        now += 10;
        armed = true;
      }
      logger.log({
        correlationId: `${fault}-first`,
        event: "diagnostic.fault.first",
        level: "warning",
        message: fault === "rotation-renamed" ? "x".repeat(420) : "first"
      });
      logger.log({
        correlationId: `${fault}-second`,
        event: "diagnostic.fault.second",
        level: "info",
        message: "second"
      });
      await expect(logger.flush()).rejects.toThrow(`injected ${fault} fault`);
      await expect(logger.flush()).resolves.toBeUndefined();

      const diagnosticsRoot = path.join(appDataRoot, "diagnostics");
      const manifest = JSON.parse(
        readFileSync(path.join(diagnosticsRoot, "manifest.json"), "utf8")
      ) as { files: Array<{ path: string }> };
      const content = manifest.files.map(({ path: relativePath }) =>
        readFileSync(path.join(diagnosticsRoot, ...relativePath.split("/")), "utf8")
      ).join("");
      for (const suffix of ["first", "second"]) {
        const identity = `${fault}-${suffix}`;
        expect(content.match(new RegExp(identity, "gu"))).toHaveLength(1);
      }
      expect(content.indexOf(`${fault}-first`)).toBeLessThan(content.indexOf(`${fault}-second`));
    }
  });

  it("drains new records before reporting a prior background write error", async () => {
    const appDataRoot = tempRoot();
    let failOnce = true;
    const logger = new LocalDiagnosticLogger({
      appDataRoot,
      appVersion: "4.0.0",
      maxBytes: 2_048,
      checkpoint: (stage) => {
        if (stage === "manifest-written" && failOnce) {
          failOnce = false;
          throw new Error("background manifest failure");
        }
      }
    });
    logger.log({
      correlationId: "background-first",
      event: "diagnostic.background.first",
      level: "warning",
      message: "first"
    });
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    logger.log({
      correlationId: "background-second",
      event: "diagnostic.background.second",
      level: "info",
      message: "second"
    });
    await expect(logger.flush()).rejects.toThrow("background manifest failure");
    await expect(logger.flush()).resolves.toBeUndefined();
    const content = readFileSync(
      path.join(appDataRoot, "diagnostics", "logs", "ether-current.jsonl"),
      "utf8"
    );
    expect(content.match(/background-first/gu)).toHaveLength(1);
    expect(content.match(/background-second/gu)).toHaveLength(1);
    expect(content.indexOf("background-first")).toBeLessThan(content.indexOf("background-second"));
  });

  it("reconciles framed tails after true partial-write and post-write fsync failures", async () => {
    for (const fault of ["partial-write", "fsync-after-write"] as const) {
      const appDataRoot = tempRoot();
      let failOnce = true;
      const logger = new LocalDiagnosticLogger({
        appDataRoot,
        appVersion: "4.0.0",
        maxBytes: 4_096,
        fileOperations: {
          fsync: (descriptor) => {
            if (fault === "fsync-after-write" && failOnce) {
              failOnce = false;
              throw new Error("injected fsync failure after complete write");
            }
            fsyncSync(descriptor);
          },
          write: (descriptor, buffer, offset, length) => {
            if (fault === "partial-write" && failOnce) {
              failOnce = false;
              const partialLength = Math.max(1, Math.floor(length * 0.6));
              writeSync(descriptor, buffer, offset, partialLength);
              throw new Error("injected failure after partial append");
            }
            return writeSync(descriptor, buffer, offset, length);
          }
        }
      });
      logger.log({
        correlationId: `${fault}-first`,
        event: "diagnostic.tail.first",
        level: "warning",
        message: "first framed record"
      });
      logger.log({
        correlationId: `${fault}-second`,
        event: "diagnostic.tail.second",
        level: "info",
        message: "second framed record"
      });
      await expect(logger.flush()).rejects.toThrow(
        fault === "partial-write" ? "partial append" : "fsync failure"
      );
      await expect(logger.flush()).resolves.toBeUndefined();

      const current = readFileSync(
        path.join(appDataRoot, "diagnostics", "logs", "ether-current.jsonl"),
        "utf8"
      );
      const frames = current.trimEnd().split("\n").map((line) => JSON.parse(line) as {
        correlationId: string;
        frameVersion: number;
        recordId: string;
      });
      expect(frames.map(({ correlationId }) => correlationId)).toEqual([
        `${fault}-first`,
        `${fault}-second`
      ]);
      expect(frames.every(({ frameVersion }) => frameVersion === 1)).toBe(true);
      expect(new Set(frames.map(({ recordId }) => recordId)).size).toBe(2);
    }
  });

  it("redacts forward-slash Windows, POSIX, nested array, and raw token values", async () => {
    const appDataRoot = tempRoot();
    const logger = new LocalDiagnosticLogger({
      appDataRoot,
      appVersion: "4.0.0",
      maxBytes: 16 * 1024
    });
    logger.log({
      correlationId: "redaction-shapes",
      event: "diagnostic.redaction.shapes",
      level: "warning",
      message: "C:/Users/Ada/private.png /tmp/private.txt /var/lib/private /mnt/c/private /opt/ether/config.json /srv/ether/private.db /etc/ether/secret.conf /run/ether/private.sock sk-secret-token-123",
      details: {
        nested: [{
          credential: "raw-credential",
          values: [
            "C:/Users/Ada/nested.png",
            "/tmp/nested.txt",
            "ghp_privateToken123",
            "https://example.test/opt/public",
            "file:///etc/example",
            "/components/schemas/Artifact",
            "/api/v1/jobs"
          ]
        }]
      }
    });
    await logger.flush();
    const serialized = readFileSync(
      path.join(appDataRoot, "diagnostics", "logs", "ether-current.jsonl"),
      "utf8"
    );
    expect(serialized).not.toMatch(/Ada|\/tmp|\/var|\/mnt|\/opt\/ether|\/srv\/ether|\/etc\/ether|\/run\/ether|privateToken|secret-token|raw-credential/);
    expect(serialized).toContain("[LOCAL_PATH]");
    expect(serialized).toContain("[REDACTED]");
    expect(serialized).toContain("https://example.test/opt/public");
    expect(serialized).toContain("file:///etc/example");
    expect(serialized).toContain("/components/schemas/Artifact");
    expect(serialized).toContain("/api/v1/jobs");
  });

  it("queues and batch-flushes 500 events without a 100 ms heartbeat stall", async () => {
    const appDataRoot = tempRoot();
    const logger = new LocalDiagnosticLogger({
      appDataRoot,
      appVersion: "4.0.0",
      maxBytes: 256 * 1024
    });
    const frameGaps: number[] = [];
    let heartbeatAt = performance.now();
    const heartbeat = setInterval(() => {
      const current = performance.now();
      frameGaps.push(current - heartbeatAt);
      heartbeatAt = current;
    }, 5);
    await new Promise((resolve) => setTimeout(resolve, 10));
    const startedAt = performance.now();
    for (let index = 0; index < 500; index += 1) {
      logger.log({
        correlationId: `burst-${index}`,
        event: "diagnostic.burst",
        level: "info",
        message: "bounded diagnostic event"
      });
    }
    const enqueueMs = performance.now() - startedAt;
    await logger.flush();
    await new Promise((resolve) => setTimeout(resolve, 10));
    clearInterval(heartbeat);
    expect(enqueueMs).toBeLessThan(50);
    expect(Math.max(...frameGaps)).toBeLessThan(100);
    logger.log({
      correlationId: "crash-flush",
      event: "diagnostic.crash.flush",
      level: "error",
      message: "flush synchronously before process termination"
    });
    logger.flushSync();
    const manifest = JSON.parse(readFileSync(
      path.join(appDataRoot, "diagnostics", "manifest.json"),
      "utf8"
    )) as { files: Array<{ path: string }> };
    expect(manifest.files).toEqual([expect.objectContaining({ path: "logs/ether-current.jsonl" })]);
    expect(readFileSync(
      path.join(appDataRoot, "diagnostics", "logs", "ether-current.jsonl"),
      "utf8"
    )).toContain('"correlationId":"crash-flush"');
  });

  it("reads 500-item execution correlation in three statements and supports pre-correlation receipts", () => {
    const database = new DatabaseSync(":memory:");
    try {
      database.exec(`
        CREATE TABLE execution_jobs (
          job_id TEXT PRIMARY KEY, plan_id TEXT NOT NULL, start_command_id TEXT NOT NULL
        );
        CREATE TABLE command_receipts (
          command_id TEXT PRIMARY KEY, result_json TEXT NOT NULL
        );
        CREATE TABLE work_items (
          work_item_id TEXT PRIMARY KEY, job_id TEXT NOT NULL, item_index INTEGER NOT NULL
        );
        CREATE TABLE attempts (
          attempt_id TEXT PRIMARY KEY, work_item_id TEXT NOT NULL, attempt_number INTEGER NOT NULL,
          provider_run_id TEXT, output_version_ids_json TEXT NOT NULL
        );
        CREATE TABLE node_output_versions (
          output_version_id TEXT PRIMARY KEY, work_item_id TEXT, attempt_id TEXT
        );
        CREATE TABLE artifacts (
          artifact_id TEXT PRIMARY KEY, source_output_version_id TEXT NOT NULL
        );
        INSERT INTO execution_jobs VALUES ('job-500', 'plan-500', 'old-start-command');
        INSERT INTO command_receipts VALUES ('old-start-command', '{"jobId":"job-500"}');
      `);
      const insertWork = database.prepare(
        "INSERT INTO work_items VALUES (?, 'job-500', ?)"
      );
      const insertAttempt = database.prepare(
        "INSERT INTO attempts VALUES (?, ?, 1, NULL, ?)"
      );
      database.exec("BEGIN");
      for (let index = 0; index < 500; index += 1) {
        insertWork.run(`work-${index}`, index);
        insertAttempt.run(`attempt-${index}`, `work-${index}`, JSON.stringify([`output-${index}`]));
      }
      database.exec("COMMIT");

      const originalPrepare = database.prepare.bind(database);
      let statementCount = 0;
      database.prepare = ((sql: string) => {
        statementCount += 1;
        return originalPrepare(sql);
      }) as typeof database.prepare;
      const context = createRepositoryContext(database);
      const repository = new ExecutionRepository(context);
      const correlation = repository.getExecutionCorrelation("job-500");
      expect(statementCount).toBe(3);
      expect(correlation.correlationId).toBe("old-start-command");
      expect(correlation.workItems).toHaveLength(500);
      expect(correlation.workItems[499]).toEqual({
        workItemId: "work-499",
        attempts: [{
          artifactIds: [],
          attemptId: "attempt-499",
          outputVersionIds: ["output-499"],
          providerRunId: null
        }]
      });

      const insertJob = originalPrepare(
        "INSERT INTO execution_jobs VALUES (?, ?, ?)"
      );
      const insertReceipt = originalPrepare(
        "INSERT INTO command_receipts VALUES (?, ?)"
      );
      database.exec("BEGIN");
      for (let index = 0; index < 1_000; index += 1) {
        const jobId = `bounded-job-${index}`;
        const commandId = `bounded-command-${index}`;
        insertJob.run(jobId, `bounded-plan-${index}`, commandId);
        insertReceipt.run(commandId, JSON.stringify({
          __etherCorrelationId: `bounded-correlation-${index}`
        }));
      }
      database.exec("COMMIT");
      for (let index = 0; index < 1_000; index += 1) {
        expect(repository.getExecutionCorrelation(`bounded-job-${index}`).correlationId)
          .toBe(`bounded-correlation-${index}`);
      }
      expect(context.executionIdentity.correlationByJob.size)
        .toBe(MAX_CACHED_JOB_CORRELATIONS);
      expect(context.executionIdentity.correlationByJob.has("bounded-job-0")).toBe(false);
      expect(context.executionIdentity.correlationByJob.get("bounded-job-999"))
        .toBe("bounded-correlation-999");
    } finally {
      database.close();
    }
  });

  it("preserves one real correlation and cause chain through plan, job, work item, attempt, provider run, and artifact", async () => {
    const root = tempRoot();
    const appDataRoot = path.join(root, "appdata");
    const correlationId = "correlation-real-execution-chain";
    const timestamp = "2026-07-23T00:00:00.000Z";
    const graph: EtherGraph = {
      id: "root",
      title: "Correlation chain",
      kind: "root",
      createdAt: timestamp,
      updatedAt: timestamp,
      nodes: [
        {
          id: "prompt",
          definitionId: "prompt.text",
          title: "Prompt",
          position: { x: 0, y: 0 },
          size: { width: 240, height: 180 },
          config: { kind: "prompt.text", body: "A studio product photograph.", assembly: "append" },
          presentation: { collapsed: false, accent: "default", previewMode: "content" }
        },
        {
          id: "image",
          definitionId: "generation.image",
          title: "Image",
          position: { x: 320, y: 0 },
          size: { width: 240, height: 180 },
          config: {
            kind: "generation.image",
            providerId: "ether-fake-local",
            profileId: "fake-image-default",
            aspectRatio: "1:1",
            resolution: { width: 32, height: 32 },
            outputCount: 1
          },
          presentation: { collapsed: false, accent: "default", previewMode: "summary" }
        }
      ],
      edges: [{
        id: "prompt-image",
        from: { kind: "node", nodeId: "prompt", channel: "text" },
        to: { kind: "node", nodeId: "image", channel: "text" },
        role: "subject",
        order: 0,
        selector: { kind: "latest-approved" },
        adapter: { kind: "auto" },
        enabled: true
      }],
      groups: [],
      modules: [],
      viewState: {
        viewport: { x: 0, y: 0, zoom: 1 },
        selectedNodeIds: [],
        selectedEdgeIds: [],
        inspectorTarget: null
      }
    };
    const diagnosticLogger = new LocalDiagnosticLogger({
      appDataRoot,
      appVersion: "4.0.0",
      maxBytes: 16 * 1024
    });
    const publishedEvents: Array<{ correlationId: string; name: string }> = [];
    const app = new EtherApplication({
      appDataRoot,
      appVersion: "4.0.0",
      provider: new FakeImageProvider(),
      dispatchMode: "manual",
      onDiagnostic: (record) => diagnosticLogger.log(record)
    });
    app.events.subscribe((event) => publishedEvents.push({
      correlationId: event.correlationId,
      name: event.name
    }));
    try {
      const created = await app.createDocument({
        path: path.join(root, "Correlation.ether"),
        title: "Correlation",
        initialGraph: graph
      });
      const preview = await app.execute({
        kind: "command",
        id: "correlation-preview-command",
        correlationId,
        documentId: created.documentId,
        name: "run.preview",
        payload: { graphId: graph.id, scope: { kind: "graph" } }
      });
      if (preview.kind !== "response" || preview.name !== "run.preview") {
        throw new Error(`Preview failed: ${JSON.stringify(preview)}`);
      }
      expect(preview.correlationId).toBe(correlationId);
      const permit = await app.execute({
        kind: "command",
        id: "correlation-permit-command",
        correlationId,
        documentId: created.documentId,
        name: "permission.grantRun",
        payload: {
          planId: preview.payload.plan.id,
          contentHash: preview.payload.plan.contentHash
        }
      });
      if (permit.kind !== "response" || permit.name !== "permission.grantRun") {
        throw new Error(`Permit failed: ${JSON.stringify(permit)}`);
      }
      const started = await app.execute({
        kind: "command",
        id: "correlation-start-command",
        correlationId,
        documentId: created.documentId,
        name: "run.start",
        payload: {
          planId: preview.payload.plan.id,
          contentHash: preview.payload.plan.contentHash,
          runPermitId: permit.payload.permitId
        }
      });
      if (started.kind !== "response" || started.name !== "run.start") {
        throw new Error(`Start failed: ${JSON.stringify(started)}`);
      }
      expect(started.correlationId).toBe(correlationId);
      await app.runPending(started.payload.job.id);
      const job = await app.queryJob(started.payload.job.id);
      const workItems = await app.queryWorkItems(job.id);
      const attempts = await app.queryAttempts(job.id);
      const artifacts = await app.searchArtifacts({ text: "" });
      const correlation = await app.boundaryStore().read(({ execution }) =>
        execution.getExecutionCorrelation(job.id)
      );
      expect(job.planId).toBe(preview.payload.plan.id);
      expect(workItems).toHaveLength(1);
      const generatedWork = workItems.find((item) =>
        attempts.some((attempt) => attempt.workItemId === item.id && attempt.providerRunId !== null)
      )!;
      const attempt = attempts.find((candidate) => candidate.workItemId === generatedWork.id)!;
      expect(generatedWork.jobId).toBe(job.id);
      expect(attempt.status).toBe("accepted");
      expect(attempt.providerRunId).not.toBeNull();
      const artifact = artifacts[0]!;
      const lineage = await app.queryArtifactLineage(artifact.id);
      expect(lineage.outputVersion).toMatchObject({
        runId: job.id,
        workItemId: generatedWork.id,
        attemptId: attempt.id
      });
      expect(lineage.providerRun.id).toBe(attempt.providerRunId);
      expect(artifact.source.outputVersionId).toBe(lineage.outputVersion.id);
      expect(correlation).toEqual({
        commandId: "correlation-start-command",
        correlationId,
        jobId: job.id,
        planId: preview.payload.plan.id,
        workItems: [{
          workItemId: generatedWork.id,
          attempts: [{
            artifactIds: [artifact.id],
            attemptId: attempt.id,
            outputVersionIds: [lineage.outputVersion.id],
            providerRunId: lineage.providerRun.id
          }]
        }]
      });
      expect(lineage.providerRun.metadata.correlationId).toBe(correlationId);
      expect(artifact.metadata.correlationId).toBe(correlationId);
      const payload = await app.boundaryStore().read(({ outputs }) =>
        outputs.getPayload(artifact.source.payloadId)
      );
      expect(payload?.metadata.correlationId).toBe(correlationId);
      const timeline = await app.boundaryStore().read(({ execution }) =>
        execution.listTimeline(job.id)
      );
      expect(timeline.length).toBeGreaterThanOrEqual(2);
      for (const entry of timeline) expect(entry.payload.correlationId).toBe(correlationId);
      const executionEvents = publishedEvents.filter((event) =>
        ["plan.stateChanged", "job.stateChanged", "workItem.stateChanged", "attempt.stateChanged", "artifact.accepted"]
          .includes(event.name)
      );
      expect(executionEvents.length).toBeGreaterThanOrEqual(8);
      for (const event of executionEvents) expect(event.correlationId).toBe(correlationId);
      await diagnosticLogger.flush();
      const diagnosticsRoot = path.join(appDataRoot, "diagnostics");
      const manifest = JSON.parse(
        readFileSync(path.join(diagnosticsRoot, "manifest.json"), "utf8")
      ) as { files: Array<{ path: string }> };
      const diagnostics = manifest.files.flatMap(({ path: relativePath }) =>
        readFileSync(path.join(diagnosticsRoot, ...relativePath.split("/")), "utf8")
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line) as {
            appVersion: string;
            correlationId: string;
            event: string;
          })
      ).filter((record) =>
        record.event === "application.command.completed" ||
        record.event.startsWith("application.event.")
      );
      expect(diagnostics.length).toBeGreaterThanOrEqual(executionEvents.length + 3);
      for (const record of diagnostics) {
        expect(record.appVersion).toBe("4.0.0");
        expect(record.correlationId).toBe(correlationId);
      }

      const actualFailure = await app.query({
        kind: "query",
        id: "correlation-missing-artifact-query",
        correlationId,
        documentId: created.documentId,
        name: "artifact.detail",
        payload: { artifactId: "missing-artifact" }
      });
      expect(actualFailure).toMatchObject({
        kind: "error",
        correlationId,
        error: { code: "APPLICATION_COMMAND_FAILED", causeId: correlationId }
      });
    } finally {
      await app.closeDocument();
    }
  }, 20_000);
});
