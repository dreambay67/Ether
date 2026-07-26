import { EtherApplication } from "@ether/application";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { FakeImageProvider } from "@ether/providers";
import type { EtherGraph } from "@ether/schema";
import { CodexAppServerClient } from "../../../providers/src/codex/appServer/client.js";
import { CodexAppServerSessionPool } from "../../../providers/src/codex/appServer/sessionPool.js";
import { CodexAppServerTurnRunner } from "../../../providers/src/codex/appServer/turnRunner.js";
import { createFiveHundredWorkItemFixture } from "../../fixtures/performance/index.js";

const fixture = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fixtures/codex-app-server/fake-app-server.mjs");
const children = new Set<ChildProcessWithoutNullStreams>();
const temporaryRoots = new Set<string>();
const nativePrepare = DatabaseSync.prototype.prepare;
afterEach(async () => {
  DatabaseSync.prototype.prepare = nativePrepare;
  for (const child of children) child.kill();
  children.clear();
  await Promise.all([...temporaryRoots].map((root) => rm(root, { recursive: true, force: true })));
  temporaryRoots.clear();
});

describe("warm provider dispatch performance", () => {
  it("labels deterministic fake app-server transport timing and keeps warm dispatch under one second", async () => {
    const processStarted = performance.now();
    const child = spawn(process.execPath, [fixture], { stdio: "pipe", windowsHide: true });
    children.add(child);
    const client = new CodexAppServerClient({ stdin: child.stdin, stdout: child.stdout, stderr: child.stderr, close: () => { child.kill(); } });
    await client.initialize();
    const processStartupMs = performance.now() - processStarted;
    const pool = new CodexAppServerSessionPool(() => ({ client, generation: 1 }));
    const runner = new CodexAppServerTurnRunner(() => ({ client, generation: 1 }), pool);
    const first = await runner.run({ documentId: "performance", memoryScopeKey: "memory:v1:performance", cwd: process.cwd(), prompt: "first" });
    const started = performance.now();
    const warm = await runner.run({ documentId: "performance", memoryScopeKey: "memory:v1:performance", cwd: process.cwd(), prompt: "warm" });
    expect(performance.now() - started).toBeLessThan(1_000);
    expect(pool.size).toBe(1);
    expect(warm.provenance.threadId).toBe(first.provenance.threadId);
    expect(warm.provenance.timing).toMatchObject({
      queueMs: expect.any(Number),
      dispatchToFirstEventMs: expect.any(Number),
      generationMs: expect.any(Number),
      totalMs: expect.any(Number)
    });
    const transportPhases = {
      evidence: "deterministic fake app-server protocol; excludes product scheduler persistence and generation",
      queueMs: warm.provenance.timing.queueMs,
      processStartupMs,
      dispatchToFirstEventMs: warm.provenance.timing.dispatchToFirstEventMs,
      generationMs: warm.provenance.timing.generationMs,
      totalMs: warm.provenance.timing.totalMs
    };
    expect(Object.values(transportPhases).filter((value): value is number => typeof value === "number")
      .every((value) => Number.isFinite(value) && value >= 0)).toBe(true);
    console.info(`ETHER_PERFORMANCE_METRIC deterministic-app-server-transport ${JSON.stringify(transportPhases)}`);
    await pool.close();
    await client.close();
  });

  it("persists, dispatches, imports, closes, and reopens a real 500-work-item Ether lifecycle", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ether-500-work-lifecycle-"));
    temporaryRoots.add(root);
    const documentPath = path.join(root, "Durable 500 work items.ether");
    const checkpoints = new Map<string, number>();
    const eventTimes = new Map<string, number>();
    const identityStatementCounts = {
      attemptOrWorkCorrelation: 0,
      documentIdentity: 0,
      jobCorrelation: 0
    };
    DatabaseSync.prototype.prepare = function countedPrepare(sql: string) {
      const normalized = sql.replace(/\s+/g, " ").trim().toLowerCase();
      if (normalized === "select document_id from document where singleton = 1") {
        identityStatementCounts.documentIdentity += 1;
      }
      if (
        normalized.includes("from execution_jobs j left join command_receipts r") &&
        normalized.includes("where j.job_id = ?")
      ) {
        identityStatementCounts.jobCorrelation += 1;
      }
      if (
        normalized.includes("select w.job_id from attempts a") ||
        normalized === "select job_id from work_items where work_item_id = ?"
      ) {
        identityStatementCounts.attemptOrWorkCorrelation += 1;
      }
      return nativePrepare.call(this, sql);
    };
    const application = new EtherApplication({
      appDataRoot: path.join(root, "app-data"),
      appVersion: "4.0.0-performance",
      provider: new FakeImageProvider(),
      executionCheckpoint: (name) => {
        if (!checkpoints.has(name)) checkpoints.set(name, performance.now());
      }
    });
    application.events.subscribe((event) => {
      if (!eventTimes.has(event.name)) eventTimes.set(event.name, performance.now());
    });
    performance.clearMarks();
    performance.clearMeasures();
    await application.createDocument({
      path: documentPath,
      title: "Durable 500 work items",
      initialGraph: fiveHundredWorkItemGraph()
    });

    const compileStarted = performance.now();
    const plan = await application.previewRun({
      commandId: "performance-preview-500",
      graphId: "performance-500",
      scope: { kind: "node", nodeId: "image" }
    });
    const planCompilationMs = performance.now() - compileStarted;
    expect(plan.workItems).toHaveLength(createFiveHundredWorkItemFixture().length);
    expect(plan.estimatedCalls).toBe(500);

    const permit = await application.grantRunPermit({
      commandId: "performance-permit-500",
      planId: plan.id,
      contentHash: plan.contentHash
    });
    const schedulerStarted = performance.now();
    const job = await application.startRun({
      commandId: "performance-start-500",
      planId: plan.id,
      contentHash: plan.contentHash,
      runPermitId: permit.id
    });
    const persisted = await application.queryWorkItems(job.id);
    const schedulerPersistenceMs = performance.now() - schedulerStarted;
    expect(persisted).toHaveLength(500);

    const completed = await application.waitForJob(job.id);
    const completedAt = performance.now();
    expect(completed.status).toBe("completed");
    const accepted = await application.queryWorkItems(job.id);
    const artifacts = await application.searchArtifacts({ text: "" });
    expect(accepted.every((item) => item.status === "accepted")).toBe(true);
    expect(artifacts).toHaveLength(500);
    const lifecycleMs = completedAt - schedulerStarted;
    const firstProviderDispatch = checkpoints.get("provider-dispatch-started");
    const firstProviderEvent = checkpoints.get("provider-first-event");
    const firstGenerationComplete = checkpoints.get("provider-generation-completed");
    const firstValidationAndStagingComplete = checkpoints.get("provider-output-staged");
    const firstImportComplete = checkpoints.get("provider-output-accepted");
    expect(firstProviderDispatch).toBeTypeOf("number");
    expect(firstProviderEvent).toBeTypeOf("number");
    expect(firstGenerationComplete).toBeTypeOf("number");
    expect(firstValidationAndStagingComplete).toBeTypeOf("number");
    expect(firstImportComplete).toBeTypeOf("number");
    expect(eventTimes.get("workItem.stateChanged")).toBeTypeOf("number");
    expect(eventTimes.get("artifact.accepted")).toBeTypeOf("number");

    await application.closeDocument();
    const reopened = new EtherApplication({
      appDataRoot: path.join(root, "reopen-app-data"),
      appVersion: "4.0.0-performance",
      provider: new FakeImageProvider()
    });
    const recoveryStarted = performance.now();
    await reopened.openDocument({ path: documentPath, access: "read-only" });
    const recoveredJob = await reopened.queryJob(job.id);
    const recoveredWork = await reopened.queryWorkItems(job.id);
    const recoveredArtifacts = await reopened.searchArtifacts({ text: "" });
    const recoveryQueryMs = performance.now() - recoveryStarted;
    expect(recoveredJob.status).toBe("completed");
    expect(recoveredWork).toHaveLength(500);
    expect(recoveredArtifacts).toHaveLength(500);
    await reopened.closeDocument();

    const lifecyclePhases = {
      evidence: "real EtherApplication, DocumentStore, ExecutionRepository, scheduler, and deterministic local provider",
      workItemCount: plan.workItems.length,
      planCompilationMs,
      schedulerPersistenceMs,
      queueToProviderDispatchMs: firstProviderDispatch! - schedulerStarted,
      providerDispatchToFirstEventMs: firstProviderEvent! - firstProviderDispatch!,
      providerGenerationMs: firstGenerationComplete! - firstProviderEvent!,
      providerValidationAndStagingMs: firstValidationAndStagingComplete! - firstGenerationComplete!,
      artifactImportMs: firstImportComplete! - firstValidationAndStagingComplete!,
      lifecycleMs,
      recoveryQueryMs,
      identityStatementCounts
    };
    expect(identityStatementCounts.documentIdentity).toBeLessThanOrEqual(2);
    expect(identityStatementCounts.jobCorrelation).toBe(0);
    expect(identityStatementCounts.attemptOrWorkCorrelation).toBe(0);
    expect(Object.values(lifecyclePhases).filter((value): value is number => typeof value === "number")
      .every((value) => Number.isFinite(value) && value >= 0)).toBe(true);
    expect(performance.getEntriesByName("plan-compilation").length).toBeGreaterThan(0);
    const phaseMeasureGroups = [
      performance.getEntriesByName("provider-queue", "measure"),
      performance.getEntriesByName("provider-dispatch:first-event", "measure"),
      performance.getEntriesByName("provider-generation", "measure"),
      performance.getEntriesByName("provider-output-validation", "measure"),
      performance.getEntriesByName("artifact-import", "measure")
    ];
    for (const measures of phaseMeasureGroups) expect(measures).toHaveLength(500);
    const phaseMeasures = phaseMeasureGroups.flat();
    expect(phaseMeasures.every((entry) =>
      Number.isFinite(entry.duration) && entry.duration >= 0)).toBe(true);
    console.info(`ETHER_PERFORMANCE_METRIC durable-500-work-item-lifecycle ${JSON.stringify(lifecyclePhases)}`);
  });
});

function fiveHundredWorkItemGraph(): EtherGraph {
  const timestamp = "2026-07-23T00:00:00.000Z";
  return {
    id: "performance-500",
    title: "Durable 500 work items",
    kind: "root",
    createdAt: timestamp,
    updatedAt: timestamp,
    nodes: [{
      id: "batch",
      definitionId: "flow.batch",
      title: "500 variations",
      position: { x: 0, y: 0 },
      size: { width: 240, height: 180 },
      config: {
        kind: "flow.batch",
        dimensions: [{
          id: "variation",
          name: "Variation",
          values: createFiveHundredWorkItemFixture().map((item) => item.id)
        }],
        parallelism: 32
      },
      presentation: { collapsed: false, accent: "default", previewMode: "summary" }
    }, {
      id: "image",
      definitionId: "generation.image",
      title: "Deterministic image",
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
    }],
    edges: [{
      id: "batch-image",
      from: { kind: "node", nodeId: "batch", channel: "data" },
      to: { kind: "node", nodeId: "image", channel: "data" },
      role: "general",
      order: 0,
      selector: { kind: "latest" },
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
}
