import { spawn } from "node:child_process";
import { access, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { EtherApplication } from "@ether/application";
import { DocumentStore, listRecoveryJournalPaths } from "@ether/document";
import { hashPlan } from "@ether/execution";
import {
  FakeImageProvider,
  type GenerationProvider,
  type GenerationProviderInput,
  type ImageEditProviderInput,
  type ProviderExecutionContext,
  type ProviderGenerationResult
} from "@ether/providers";
import type { EtherGraph, ExecutionPlan, GraphTransaction } from "@ether/schema";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];
const timestamp = "2026-07-18T08:00:00.000Z";

class CountingFakeProvider extends FakeImageProvider {
  calls = 0;

  override async generate(input: GenerationProviderInput, context?: ProviderExecutionContext) {
    this.calls += 1;
    return super.generate(input, context);
  }
}

class CompleteThenThrowProvider extends CountingFakeProvider {
  override async generate(
    input: GenerationProviderInput,
    context?: ProviderExecutionContext
  ): Promise<ProviderGenerationResult> {
    await super.generate(input, context);
    throw new Error("provider failed after durable completion");
  }
}

class ArtifactProbeProvider extends FakeImageProvider {
  constructor(
    private readonly transform: (
      result: ProviderGenerationResult,
      context: ProviderExecutionContext
    ) => Promise<ProviderGenerationResult> | ProviderGenerationResult
  ) {
    super();
  }

  override async generate(input: GenerationProviderInput, context?: ProviderExecutionContext) {
    const result = await super.generate(
      input,
      context === undefined ? undefined : { ...context, complete: async () => undefined }
    );
    if (context === undefined) throw new Error("Provider execution context is required.");
    const transformed = await this.transform(result, context);
    await context.complete(transformed);
    return transformed;
  }
}

async function temp(prefix: string): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  roots.push(root);
  return root;
}

async function pathExists(filePath: string): Promise<boolean> {
  return access(filePath).then(() => true, () => false);
}

function blankGraph(): EtherGraph {
  return {
    id: "graph-root",
    title: "Campaign",
    kind: "root",
    createdAt: timestamp,
    updatedAt: timestamp,
    nodes: [],
    edges: [],
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

function graphTransaction(
  documentRevisionId: string,
  graphRevisionId: string,
  outputCount = 1
): GraphTransaction {
  return {
    id: `graph-${documentRevisionId}`,
    baseDocumentRevisionId: documentRevisionId,
    baseGraphRevisions: { "graph-root": graphRevisionId },
    title: "Prompt to image",
    actor: "user",
    layoutPolicy: "preserve",
    operations: [
      {
        type: "addNode",
        graphId: "graph-root",
        node: {
          id: "prompt",
          definitionId: "prompt.text",
          title: "Prompt",
          position: { x: 0, y: 0 },
          size: { width: 220, height: 140 },
          config: { kind: "prompt.text", body: "Durable campaign image.", assembly: "append" },
          presentation: { collapsed: false, accent: "default", previewMode: "content" }
        }
      },
      {
        type: "addNode",
        graphId: "graph-root",
        node: {
          id: "generator",
          definitionId: "generation.image",
          title: "Generator",
          position: { x: 300, y: 0 },
          size: { width: 220, height: 140 },
          config: {
            kind: "generation.image",
            providerId: "ether-fake-local",
            profileId: "fake-image-default",
            aspectRatio: "1:1",
            resolution: { width: 32, height: 32 },
            outputCount
          },
          presentation: { collapsed: false, accent: "default", previewMode: "summary" }
        }
      },
      {
        type: "addEdge",
        graphId: "graph-root",
        edge: {
          id: "lane",
          from: { kind: "node", nodeId: "prompt", channel: "text" },
          to: { kind: "node", nodeId: "generator", channel: "text" },
          role: "subject",
          order: 0,
          selector: { kind: "latest-approved" },
          adapter: { kind: "auto" },
          enabled: true
        }
      }
    ]
  };
}

async function createReadyApplication(options: {
  provider?: GenerationProvider;
  dispatchMode?: "automatic" | "manual";
  outputCount?: number;
  onExecutionCheckpoint?: (name: string, appDataRoot: string) => void;
}) {
  const documentsRoot = await temp("ether-durability-doc-");
  const appDataRoot = await temp("ether-durability-appdata-");
  const documentPath = path.join(documentsRoot, "Campaign.ether");
  const provider = options.provider ?? new FakeImageProvider();
  const application = new EtherApplication({
    appDataRoot,
    appVersion: "4.0.0-test",
    provider,
    dispatchMode: options.dispatchMode,
    executionCheckpoint: (name) => options.onExecutionCheckpoint?.(name, appDataRoot)
  });
  await application.createDocument({ path: documentPath, title: "Campaign", initialGraph: blankGraph() });
  const initial = await application.queryDocument();
  await application.applyGraphTransaction({
    commandId: "graph-command",
    transaction: graphTransaction(
      initial.documentRevisionId,
      initial.graphRevisions["graph-root"]!,
      options.outputCount
    )
  });
  const plan = await application.previewRun({
    commandId: "preview-command",
    graphId: "graph-root",
    scope: { kind: "graph" }
  });
  const permit = await application.grantRunPermit({
    commandId: "permit-command",
    planId: plan.id,
    contentHash: plan.contentHash
  });
  return { application, appDataRoot, documentPath, plan, permit, provider };
}

async function waitFor(
  condition: () => Promise<boolean>,
  timeoutMs = 3000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Condition did not become true before timeout.");
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("durable application execution", () => {
  it("returns typed STALE_PLAN after the graph revision changes", async () => {
    const { application, plan, permit } = await createReadyApplication({ dispatchMode: "manual" });
    const head = await application.queryDocument();
    await application.applyGraphTransaction({
      commandId: "mutate-after-preview",
      transaction: {
        id: "mutate-after-preview",
        baseDocumentRevisionId: head.documentRevisionId,
        baseGraphRevisions: { "graph-root": head.graphRevisions["graph-root"]! },
        title: "Invalidate plan",
        actor: "user",
        layoutPolicy: "preserve",
        operations: [{ type: "updateGraphProperties", graphId: "graph-root", title: "Changed" }]
      }
    });

    await expect(
      application.startRun({
        commandId: "stale-start",
        planId: plan.id,
        contentHash: plan.contentHash,
        runPermitId: permit.id
      })
    ).rejects.toMatchObject({ code: "STALE_PLAN" });
    await application.closeDocument();
  });

  it("deduplicates duplicate starts and concurrent claimers", async () => {
    const provider = new CountingFakeProvider();
    const { application, plan, permit } = await createReadyApplication({
      provider,
      dispatchMode: "manual"
    });
    const input = {
      commandId: "same-start-command",
      planId: plan.id,
      contentHash: plan.contentHash,
      runPermitId: permit.id
    };
    const first = await application.startRun(input);
    const duplicate = await application.startRun(input);
    expect(duplicate.id).toBe(first.id);

    await Promise.all([application.runPending(first.id), application.runPending(first.id)]);
    expect(provider.calls).toBe(1);
    expect((await application.queryAttempts(first.id))).toHaveLength(1);
    expect(await application.searchArtifacts({ text: "" })).toHaveLength(1);
    await application.closeDocument();
  });

  it("returns the original command snapshot after execution state changes", async () => {
    const ready = await createReadyApplication({ dispatchMode: "manual" });
    const input = {
      commandId: "stable-start-result",
      planId: ready.plan.id,
      contentHash: ready.plan.contentHash,
      runPermitId: ready.permit.id
    };
    const original = await ready.application.startRun(input);
    await ready.application.runPending(original.id);

    expect((await ready.application.startRun(input)).status).toBe("queued");
    expect((await ready.application.queryJob(original.id)).status).toBe("completed");
    await ready.application.closeDocument();
  });

  it("deduplicates save milestones by durable command ID", async () => {
    const ready = await createReadyApplication({ dispatchMode: "manual" });
    await ready.application.saveDocument({ commandId: "same-save-command" });
    await ready.application.saveDocument({ commandId: "same-save-command" });
    await ready.application.closeDocument();

    const store = await DocumentStore.open(ready.documentPath, { access: "read-only" });
    const milestones = await store.read(({ revisions }) => revisions.listMilestones());
    expect(milestones.filter((milestone) => milestone.name === "Manual save")).toHaveLength(1);
    await store.close();
  });

  it("creates a new ordinal attempt when retrying retryable failure", async () => {
    const { application, plan, permit } = await createReadyApplication({
      provider: new FakeImageProvider({ failAttempts: [1] })
    });
    const started = await application.startRun({
      commandId: "retry-start",
      planId: plan.id,
      contentHash: plan.contentHash,
      runPermitId: permit.id
    });
    expect((await application.waitForJob(started.id)).status).toBe("failed");
    const failedWork = await application.queryWorkItems(started.id);
    await application.retryRun({
      commandId: "retry-command",
      jobId: started.id,
      workItemIds: failedWork.map((item) => item.id)
    });

    expect((await application.waitForJob(started.id)).status).toBe("completed");
    expect((await application.queryAttempts(started.id)).map((attempt) => attempt.ordinal)).toEqual([1, 2]);
    expect(await application.searchArtifacts({ text: "" })).toHaveLength(1);
    await application.closeDocument();
  });

  it("lets cancellation win against a late provider completion", async () => {
    class LateProvider extends FakeImageProvider {
      override async generate(input: GenerationProviderInput, _context?: ProviderExecutionContext) {
        await new Promise((resolve) => setTimeout(resolve, 80));
        return super.generate(input);
      }

      override async edit(input: ImageEditProviderInput, _context?: ProviderExecutionContext) {
        return super.edit(input);
      }
    }
    const { application, plan, permit } = await createReadyApplication({ provider: new LateProvider() });
    const started = await application.startRun({
      commandId: "cancel-start",
      planId: plan.id,
      contentHash: plan.contentHash,
      runPermitId: permit.id
    });
    await waitFor(async () => (await application.queryAttempts(started.id))[0]?.status === "running");
    expect((await application.cancelRun({ commandId: "cancel", jobId: started.id })).status).toBe("cancelled");
    expect(await application.searchArtifacts({ text: "" })).toHaveLength(0);
    expect((await application.queryAttempts(started.id))[0]?.status).toBe("cancelled");
    await application.closeDocument();
  });

  it("keeps cancelled job, work, and attempt states when a late provider failure arrives", async () => {
    class LateFailureProvider extends FakeImageProvider {
      override async generate(
        _input: GenerationProviderInput,
        _context?: ProviderExecutionContext
      ): Promise<ProviderGenerationResult> {
        await new Promise((resolve) => setTimeout(resolve, 80));
        throw new Error("late provider failure");
      }
    }
    const ready = await createReadyApplication({ provider: new LateFailureProvider() });
    const started = await ready.application.startRun({
      commandId: "late-failure-start",
      planId: ready.plan.id,
      contentHash: ready.plan.contentHash,
      runPermitId: ready.permit.id
    });
    await waitFor(async () => (await ready.application.queryAttempts(started.id))[0]?.status === "running");

    expect((await ready.application.cancelRun({ commandId: "late-failure-cancel", jobId: started.id })).status)
      .toBe("cancelled");
    expect((await ready.application.queryWorkItems(started.id)).map((item) => item.status)).toEqual(["cancelled"]);
    expect((await ready.application.queryAttempts(started.id)).map((attempt) => attempt.status)).toEqual(["cancelled"]);
    await ready.application.closeDocument();
  });

  it("recovers process-lost running work after close and reopen", async () => {
    const ready = await createReadyApplication({ provider: new FakeImageProvider({ delayMs: 200 }) });
    const started = await ready.application.startRun({
      commandId: "process-loss-start",
      planId: ready.plan.id,
      contentHash: ready.plan.contentHash,
      runPermitId: ready.permit.id
    });
    await waitFor(async () => (await ready.application.queryAttempts(started.id))[0]?.status === "running");
    await ready.application.closeDocument();

    const reopened = new EtherApplication({
      appDataRoot: ready.appDataRoot,
      appVersion: "4.0.0-test",
      provider: new FakeImageProvider()
    });
    await reopened.openDocument({ path: ready.documentPath, access: "require-write" });
    expect((await reopened.waitForJob(started.id)).status).toBe("completed");
    expect(await reopened.searchArtifacts({ text: "" })).toHaveLength(1);
    await reopened.closeDocument();
  });

  it("resumes queued work on reopen", async () => {
    const ready = await createReadyApplication({ dispatchMode: "manual" });
    const started = await ready.application.startRun({
      commandId: "queued-start",
      planId: ready.plan.id,
      contentHash: ready.plan.contentHash,
      runPermitId: ready.permit.id
    });
    expect((await ready.application.queryJob(started.id)).status).toBe("queued");
    await ready.application.closeDocument();

    const reopened = new EtherApplication({
      appDataRoot: ready.appDataRoot,
      appVersion: "4.0.0-test",
      provider: new FakeImageProvider()
    });
    await reopened.openDocument({ path: ready.documentPath, access: "require-write" });
    expect((await reopened.waitForJob(started.id)).status).toBe("completed");
    await reopened.closeDocument();
  });

  it("does not dispatch accepted work again after reopen", async () => {
    const provider = new CountingFakeProvider();
    const ready = await createReadyApplication({ provider });
    const started = await ready.application.startRun({
      commandId: "accepted-start",
      planId: ready.plan.id,
      contentHash: ready.plan.contentHash,
      runPermitId: ready.permit.id
    });
    await ready.application.waitForJob(started.id);
    await ready.application.closeDocument();

    const reopened = new EtherApplication({
      appDataRoot: ready.appDataRoot,
      appVersion: "4.0.0-test",
      provider
    });
    await reopened.openDocument({ path: ready.documentPath, access: "require-write" });
    await reopened.resumeRun({ commandId: "resume-complete", jobId: started.id });
    expect(provider.calls).toBe(1);
    expect(await reopened.searchArtifacts({ text: "" })).toHaveLength(1);
    await reopened.closeDocument();
  });

  it("allows read-only queries and rejects mutation or execution", async () => {
    const ready = await createReadyApplication({ dispatchMode: "manual" });
    await ready.application.closeDocument();
    const readOnly = new EtherApplication({
      appDataRoot: ready.appDataRoot,
      appVersion: "4.0.0-test",
      provider: new FakeImageProvider()
    });
    await readOnly.openDocument({ path: ready.documentPath, access: "read-only" });
    await expect(readOnly.queryPlan(ready.plan.id)).resolves.toEqual(ready.plan);
    await expect(
      readOnly.previewRun({ commandId: "readonly-preview", graphId: "graph-root", scope: { kind: "graph" } })
    ).rejects.toMatchObject({ code: "READ_ONLY" });
    await expect(readOnly.saveDocument({ commandId: "readonly-save" })).rejects.toMatchObject({ code: "READ_ONLY" });
    await readOnly.closeDocument();
  });

  it("publishes approved events only after committed commands", async () => {
    const ready = await createReadyApplication({ dispatchMode: "manual" });
    const events: string[] = [];
    ready.application.events.subscribe((event) => events.push(event.name));
    const head = await ready.application.queryDocument();
    await ready.application.applyGraphTransaction({
      commandId: "event-commit",
      transaction: {
        id: "event-commit",
        baseDocumentRevisionId: head.documentRevisionId,
        baseGraphRevisions: { "graph-root": head.graphRevisions["graph-root"]! },
        title: "Committed event",
        actor: "user",
        layoutPolicy: "preserve",
        operations: [{ type: "updateGraphProperties", graphId: "graph-root", title: "Committed" }]
      }
    });
    expect(events).toEqual(["graph.revisionChanged"]);

    await expect(
      ready.application.applyGraphTransaction({
        commandId: "event-rollback",
        transaction: {
          id: "event-rollback",
          baseDocumentRevisionId: head.documentRevisionId,
          baseGraphRevisions: { "graph-root": head.graphRevisions["graph-root"]! },
          title: "Rolled back event",
          actor: "user",
          layoutPolicy: "preserve",
          operations: [{ type: "updateGraphProperties", graphId: "graph-root", title: "Rejected" }]
        }
      })
    ).rejects.toBeInstanceOf(Error);
    expect(events).toEqual(["graph.revisionChanged"]);
    await ready.application.closeDocument();
  });

  it("deduplicates preview and permit commands by durable command ID", async () => {
    const ready = await createReadyApplication({ dispatchMode: "manual" });

    const duplicatePlan = await ready.application.previewRun({
      commandId: "preview-command",
      graphId: "graph-root",
      scope: { kind: "graph" }
    });
    const duplicatePermit = await ready.application.grantRunPermit({
      commandId: "permit-command",
      planId: ready.plan.id,
      contentHash: ready.plan.contentHash
    });

    expect(duplicatePlan).toEqual(ready.plan);
    expect(duplicatePermit).toEqual(ready.permit);
    await ready.application.closeDocument();
  });

  it("deduplicates graph transactions by durable command ID", async () => {
    const documentsRoot = await temp("ether-graph-command-doc-");
    const application = new EtherApplication({
      appDataRoot: await temp("ether-graph-command-appdata-"),
      appVersion: "4.0.0-test",
      provider: new FakeImageProvider(),
      dispatchMode: "manual"
    });
    await application.createDocument({
      path: path.join(documentsRoot, "Campaign.ether"),
      title: "Campaign",
      initialGraph: blankGraph()
    });
    const initial = await application.queryDocument();
    const input = {
      commandId: "same-graph-command",
      transaction: graphTransaction(initial.documentRevisionId, initial.graphRevisions["graph-root"]!)
    };
    const first = await application.applyGraphTransaction(input);
    const duplicate = await application.applyGraphTransaction(input);

    expect(duplicate).toEqual(first);
    await application.closeDocument();
  });

  it("deduplicates retry, cancel, and resume commands", async () => {
    const retryReady = await createReadyApplication({
      provider: new FakeImageProvider({ failAttempts: [1] }),
      dispatchMode: "manual"
    });
    const retryStarted = await retryReady.application.startRun({
      commandId: "idempotent-retry-start",
      planId: retryReady.plan.id,
      contentHash: retryReady.plan.contentHash,
      runPermitId: retryReady.permit.id
    });
    await retryReady.application.runPending(retryStarted.id);
    const retryInput = { commandId: "same-retry", jobId: retryStarted.id };
    const retryFirst = await retryReady.application.retryRun(retryInput);
    const retryDuplicate = await retryReady.application.retryRun(retryInput);
    expect(retryDuplicate).toEqual(retryFirst);
    expect(await retryReady.application.queryAttempts(retryStarted.id)).toHaveLength(2);
    await retryReady.application.closeDocument();

    const cancelReady = await createReadyApplication({ dispatchMode: "manual" });
    const cancelStarted = await cancelReady.application.startRun({
      commandId: "idempotent-cancel-start",
      planId: cancelReady.plan.id,
      contentHash: cancelReady.plan.contentHash,
      runPermitId: cancelReady.permit.id
    });
    const cancelInput = { commandId: "same-cancel", jobId: cancelStarted.id };
    expect(await cancelReady.application.cancelRun(cancelInput)).toEqual(
      await cancelReady.application.cancelRun(cancelInput)
    );
    await cancelReady.application.closeDocument();

    const resumeProvider = new CountingFakeProvider();
    const resumeReady = await createReadyApplication({ provider: resumeProvider, dispatchMode: "manual" });
    const resumeStarted = await resumeReady.application.startRun({
      commandId: "idempotent-resume-start",
      planId: resumeReady.plan.id,
      contentHash: resumeReady.plan.contentHash,
      runPermitId: resumeReady.permit.id
    });
    const resumeInput = { commandId: "same-resume", jobId: resumeStarted.id };
    expect(await resumeReady.application.resumeRun(resumeInput)).toEqual(
      await resumeReady.application.resumeRun(resumeInput)
    );
    expect(resumeProvider.calls).toBe(1);
    await resumeReady.application.closeDocument();
  });

  it("persists complete execution transition events in commit order", async () => {
    const ready = await createReadyApplication({ dispatchMode: "manual" });
    const events: Array<{ name: string; state?: string }> = [];
    ready.application.events.subscribe((event) => events.push({
      name: event.name,
      state: "state" in event.payload ? String(event.payload.state) : undefined
    }));
    const started = await ready.application.startRun({
      commandId: "transition-event-start",
      planId: ready.plan.id,
      contentHash: ready.plan.contentHash,
      runPermitId: ready.permit.id
    });
    await ready.application.runPending(started.id);

    expect(events).toEqual(expect.arrayContaining([
      { name: "plan.stateChanged", state: "started" },
      { name: "job.stateChanged", state: "queued" },
      { name: "workItem.stateChanged", state: "queued" },
      { name: "attempt.stateChanged", state: "queued" },
      { name: "job.stateChanged", state: "running" },
      { name: "workItem.stateChanged", state: "running" },
      { name: "attempt.stateChanged", state: "running" },
      { name: "attempt.stateChanged", state: "accepted" },
      { name: "workItem.stateChanged", state: "accepted" },
      { name: "artifact.accepted", state: undefined },
      { name: "job.stateChanged", state: "completed" }
    ]));
    await ready.application.closeDocument();
  });

  it("keeps committed commands successful and replays outbox events after listener failure", async () => {
    const ready = await createReadyApplication({ dispatchMode: "manual" });
    const head = await ready.application.queryDocument();
    ready.application.events.subscribe(() => {
      throw new Error("listener unavailable");
    });

    await expect(ready.application.applyGraphTransaction({
      commandId: "listener-failure-command",
      transaction: {
        id: "listener-failure-command",
        baseDocumentRevisionId: head.documentRevisionId,
        baseGraphRevisions: { "graph-root": head.graphRevisions["graph-root"]! },
        title: "Committed despite listener",
        actor: "user",
        layoutPolicy: "preserve",
        operations: [{ type: "updateGraphProperties", graphId: "graph-root", title: "Delivered later" }]
      }
    })).resolves.toBeDefined();
    await ready.application.closeDocument();

    const replayed: string[] = [];
    const reopened = new EtherApplication({
      appDataRoot: ready.appDataRoot,
      appVersion: "4.0.0-test",
      provider: new FakeImageProvider(),
      dispatchMode: "manual"
    });
    reopened.events.subscribe((event) => replayed.push(event.correlationId));
    await reopened.openDocument({ path: ready.documentPath, access: "require-write" });
    expect(replayed).toContain("listener-failure-command");
    await reopened.closeDocument();
  });

  it("prevents mutation of a persisted plan capsule", async () => {
    const ready = await createReadyApplication({ dispatchMode: "manual" });
    await ready.application.closeDocument();
    const database = new DatabaseSync(ready.documentPath);
    expect(() =>
      database
        .prepare("UPDATE execution_plans SET capsule_json = json_set(capsule_json, '$.estimatedCalls', 99) WHERE plan_id = ?")
        .run(ready.plan.id)
    ).toThrow(/immutable plan capsule/i);
    database.close();
  });

  it("journals staged provider output and removes the journal after acceptance", async () => {
    let observedJournal = false;
    const ready = await createReadyApplication({
      onExecutionCheckpoint: (name, appDataRoot) => {
        if (name === "provider-output-journal-created") {
          observedJournal = listRecoveryJournalPaths(appDataRoot).length === 1;
        }
      }
    });
    const started = await ready.application.startRun({
      commandId: "journal-start",
      planId: ready.plan.id,
      contentHash: ready.plan.contentHash,
      runPermitId: ready.permit.id
    });

    expect((await ready.application.waitForJob(started.id)).status).toBe("completed");
    expect(observedJournal).toBe(true);
    expect(listRecoveryJournalPaths(ready.appDataRoot)).toEqual([]);
    await ready.application.closeDocument();
  });

  it("accepts every provider artifact in deterministic order", async () => {
    const provider = new ArtifactProbeProvider((result) => ({
      ...result,
      artifacts: [
        result.artifacts[0]!,
        {
          ...result.artifacts[0]!,
          fileName: "second-output.png",
          metadata: { ...result.artifacts[0]!.metadata, ordinal: 2 }
        }
      ]
    }));
    const ready = await createReadyApplication({ provider, outputCount: 2, dispatchMode: "manual" });
    const started = await ready.application.startRun({
      commandId: "multi-output-start",
      planId: ready.plan.id,
      contentHash: ready.plan.contentHash,
      runPermitId: ready.permit.id
    });

    expect((await ready.application.runPending(started.id)).status).toBe("completed");
    const attempts = await ready.application.queryAttempts(started.id);
    const outputs = await ready.application.queryNodeOutputs("generator");
    const artifacts = await ready.application.searchArtifacts({ text: "" });
    expect(attempts[0]!.outputVersionIds).toEqual(outputs.map((output) => output.id));
    expect(outputs).toHaveLength(2);
    expect(artifacts).toHaveLength(2);
    expect(artifacts.map((artifact) => artifact.metadata.title)).toEqual([
      expect.stringContaining("fake-output"),
      "second-output.png"
    ]);
    await Promise.all(artifacts.map((artifact) => ready.application.queryArtifactLineage(artifact.id)));
    await ready.application.closeDocument();
  });

  it("sends outputCount to the fake provider and accepts every deterministic PNG", async () => {
    const ready = await createReadyApplication({
      provider: new FakeImageProvider(),
      outputCount: 2,
      dispatchMode: "manual"
    });
    const started = await ready.application.startRun({
      commandId: "fake-two-output-start",
      planId: ready.plan.id,
      contentHash: ready.plan.contentHash,
      runPermitId: ready.permit.id
    });

    expect((await ready.application.runPending(started.id)).status).toBe("completed");
    const artifacts = await ready.application.searchArtifacts({ text: "" });
    expect(artifacts).toHaveLength(2);
    expect(artifacts.map((artifact) => artifact.metadata.ordinal)).toEqual([0, 1]);
    await ready.application.closeDocument();
  });

  it("rolls back provider acceptance when artifact count differs from outputCount", async () => {
    const ready = await createReadyApplication({
      provider: new ArtifactProbeProvider((result) => ({
        ...result,
        artifacts: result.artifacts.slice(0, 1)
      })),
      outputCount: 2,
      dispatchMode: "manual"
    });
    const started = await ready.application.startRun({
      commandId: "output-count-mismatch-start",
      planId: ready.plan.id,
      contentHash: ready.plan.contentHash,
      runPermitId: ready.permit.id
    });

    expect((await ready.application.runPending(started.id)).status).toBe("failed");
    expect(await ready.application.queryNodeOutputs("generator")).toEqual([]);
    expect(await ready.application.searchArtifacts({ text: "" })).toEqual([]);
    expect((await ready.application.queryAttempts(started.id))[0]!.failure).toMatchObject({
      code: "PROVIDER_OUTPUT_COUNT_MISMATCH",
      retryable: false
    });
    await ready.application.closeDocument();
  });

  it("accepts a durable completion when the provider throws after complete", async () => {
    const provider = new CompleteThenThrowProvider();
    const ready = await createReadyApplication({ provider, dispatchMode: "manual" });
    const started = await ready.application.startRun({
      commandId: "complete-then-throw-start",
      planId: ready.plan.id,
      contentHash: ready.plan.contentHash,
      runPermitId: ready.permit.id
    });

    expect((await ready.application.runPending(started.id)).status).toBe("completed");
    expect(provider.calls).toBe(1);
    expect(await ready.application.searchArtifacts({ text: "" })).toHaveLength(1);
    expect(listRecoveryJournalPaths(ready.appDataRoot)).toEqual([]);
    await ready.application.closeDocument();
  });

  it("does not leak staging or a completion intent when journal publication fails", async () => {
    const provider = new CountingFakeProvider();
    const ready = await createReadyApplication({ provider, dispatchMode: "manual" });
    const recoveryRoot = path.join(ready.appDataRoot, "recovery");
    await rm(recoveryRoot, { recursive: true, force: true });
    await writeFile(recoveryRoot, "journal path blocked", "utf8");
    const started = await ready.application.startRun({
      commandId: "unwritable-journal-start",
      planId: ready.plan.id,
      contentHash: ready.plan.contentHash,
      runPermitId: ready.permit.id
    });

    expect((await ready.application.runPending(started.id)).status).toBe("failed");
    expect(provider.calls).toBe(0);
    const attempt = (await ready.application.queryAttempts(started.id))[0]!;
    const stagingDirectory = path.join(
      ready.appDataRoot,
      "staging",
      "provider",
      ready.plan.documentId,
      started.id,
      attempt.id
    );
    expect(await pathExists(stagingDirectory)).toBe(false);
    await ready.application.closeDocument();
    await rm(recoveryRoot, { force: true });

    const store = await DocumentStore.open(ready.documentPath, { access: "require-write" });
    expect(await store.transaction(({ execution }) => execution.getProviderCompletion(attempt.id))).toBeUndefined();
    await store.close();
  });

  it("redispatches after recovery only when completion intent has no produced output", async () => {
    const provider = new CountingFakeProvider();
    let interrupt = true;
    const ready = await createReadyApplication({
      provider,
      dispatchMode: "manual",
      onExecutionCheckpoint: (name) => {
        if (name === "provider-output-intent-created" && interrupt) {
          interrupt = false;
          throw new Error("simulated process loss before provider dispatch");
        }
      }
    });
    const started = await ready.application.startRun({
      commandId: "intent-recovery-start",
      planId: ready.plan.id,
      contentHash: ready.plan.contentHash,
      runPermitId: ready.permit.id
    });
    await ready.application.runPending(started.id);
    expect(provider.calls).toBe(0);
    await ready.application.closeDocument();

    const reopened = new EtherApplication({
      appDataRoot: ready.appDataRoot,
      appVersion: "4.0.0-test",
      provider,
      dispatchMode: "manual"
    });
    await reopened.openDocument({ path: ready.documentPath, access: "require-write" });
    await reopened.runPending(started.id);
    expect(provider.calls).toBe(1);
    expect((await reopened.queryJob(started.id)).status).toBe("completed");
    expect(listRecoveryJournalPaths(ready.appDataRoot)).toEqual([]);
    await reopened.closeDocument();
  });

  it("accepts a durably staged provider result on reopen without a second provider call", async () => {
    const provider = new CountingFakeProvider();
    let interrupt = true;
    const ready = await createReadyApplication({
      provider,
      dispatchMode: "manual",
      onExecutionCheckpoint: (name) => {
        if (name === "provider-output-staged" && interrupt) {
          interrupt = false;
          throw new Error("simulated process loss after staging");
        }
      }
    });
    const started = await ready.application.startRun({
      commandId: "staged-recovery-start",
      planId: ready.plan.id,
      contentHash: ready.plan.contentHash,
      runPermitId: ready.permit.id
    });
    await ready.application.runPending(started.id);
    expect(provider.calls).toBe(1);
    expect(listRecoveryJournalPaths(ready.appDataRoot)).toHaveLength(1);
    await ready.application.closeDocument();

    const reopened = new EtherApplication({
      appDataRoot: ready.appDataRoot,
      appVersion: "4.0.0-test",
      provider,
      dispatchMode: "manual"
    });
    await reopened.openDocument({ path: ready.documentPath, access: "require-write" });
    expect((await reopened.queryJob(started.id)).status).toBe("completed");
    expect(provider.calls).toBe(1);
    expect(await reopened.searchArtifacts({ text: "" })).toHaveLength(1);
    expect(listRecoveryJournalPaths(ready.appDataRoot)).toEqual([]);
    await reopened.closeDocument();
  });

  it("cleans an accepted completion journal on reopen without re-import or redispatch", async () => {
    const provider = new CountingFakeProvider();
    let interrupt = true;
    const ready = await createReadyApplication({
      provider,
      dispatchMode: "manual",
      onExecutionCheckpoint: (name) => {
        if (name === "provider-output-accepted" && interrupt) {
          interrupt = false;
          throw new Error("simulated process loss after acceptance commit");
        }
      }
    });
    const started = await ready.application.startRun({
      commandId: "accepted-recovery-start",
      planId: ready.plan.id,
      contentHash: ready.plan.contentHash,
      runPermitId: ready.permit.id
    });
    await ready.application.runPending(started.id);
    expect((await ready.application.queryJob(started.id)).status).toBe("completed");
    expect(listRecoveryJournalPaths(ready.appDataRoot)).toHaveLength(1);
    await ready.application.closeDocument();

    const reopened = new EtherApplication({
      appDataRoot: ready.appDataRoot,
      appVersion: "4.0.0-test",
      provider,
      dispatchMode: "manual"
    });
    await reopened.openDocument({ path: ready.documentPath, access: "require-write" });
    expect((await reopened.queryJob(started.id)).status).toBe("completed");
    expect(provider.calls).toBe(1);
    expect(await reopened.searchArtifacts({ text: "" })).toHaveLength(1);
    expect(listRecoveryJournalPaths(ready.appDataRoot)).toEqual([]);
    await reopened.closeDocument();
  });

  it.each([
    ["provider-output-before-journal", false, 1],
    ["provider-output-intent-created", false, 1],
    ["provider-output-staged", true, 0],
    ["provider-output-accepted", true, 0]
  ] as const)(
  "recovers after the provider process is hard-killed at %s",
  async (checkpoint, completedOnOpen, expectedProviderCalls) => {
    const documentsRoot = await temp("ether-hard-kill-doc-");
    const appDataRoot = await temp("ether-hard-kill-appdata-");
    const documentPath = path.join(documentsRoot, "Campaign.ether");
    const readyPath = path.join(appDataRoot, "child-ready.json");
    const markerPath = path.join(appDataRoot, "checkpoint.marker");
    const operations = graphTransaction("placeholder", "placeholder").operations;
    const childSource = `
      import { writeFileSync } from "node:fs";
      import { EtherApplication } from "@ether/application";
      import { FakeImageProvider } from "@ether/providers";
      const application = new EtherApplication({
        appDataRoot: process.env.ETHER_CHILD_APPDATA,
        appVersion: "4.0.0-test",
        provider: new FakeImageProvider(),
        dispatchMode: "manual",
        executionCheckpoint: (name) => {
          if (name === process.env.ETHER_CHILD_CHECKPOINT) {
            writeFileSync(process.env.ETHER_CHILD_MARKER, name);
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60000);
          }
        }
      });
      await application.createDocument({
        path: process.env.ETHER_CHILD_DOCUMENT,
        title: "Campaign",
        initialGraph: ${JSON.stringify(blankGraph())}
      });
      const initial = await application.queryDocument();
      await application.applyGraphTransaction({
        commandId: "hard-kill-graph",
        transaction: {
          id: "hard-kill-graph",
          baseDocumentRevisionId: initial.documentRevisionId,
          baseGraphRevisions: { "graph-root": initial.graphRevisions["graph-root"] },
          title: "Prompt to image",
          actor: "user",
          layoutPolicy: "preserve",
          operations: ${JSON.stringify(operations)}
        }
      });
      const plan = await application.previewRun({
        commandId: "hard-kill-preview",
        graphId: "graph-root",
        scope: { kind: "graph" }
      });
      const permit = await application.grantRunPermit({
        commandId: "hard-kill-permit",
        planId: plan.id,
        contentHash: plan.contentHash
      });
      const job = await application.startRun({
        commandId: "hard-kill-start",
        planId: plan.id,
        contentHash: plan.contentHash,
        runPermitId: permit.id
      });
      writeFileSync(process.env.ETHER_CHILD_READY, JSON.stringify({ jobId: job.id }));
      await application.runPending(job.id);
    `;
    const child = spawn(process.execPath, ["--input-type=module", "--eval", childSource], {
      cwd: path.dirname(path.dirname(fileURLToPath(import.meta.url))),
      env: {
        ...process.env,
        ETHER_CHILD_APPDATA: appDataRoot,
        ETHER_CHILD_CHECKPOINT: checkpoint,
        ETHER_CHILD_DOCUMENT: documentPath,
        ETHER_CHILD_MARKER: markerPath,
        ETHER_CHILD_READY: readyPath
      },
      stdio: ["ignore", "ignore", "pipe"]
    });
    let childError = "";
    child.stderr?.on("data", (chunk) => {
      childError += String(chunk);
    });
    try {
      await waitFor(async () => {
        if (child.exitCode !== null || child.signalCode !== null) {
          throw new Error(`Execution child exited before ${checkpoint}: ${childError}`);
        }
        return (await readFile(markerPath, "utf8").catch(() => "")) === checkpoint;
      }, 10000);
      const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
      child.kill("SIGKILL");
      await exited;
      const { jobId } = JSON.parse(await readFile(readyPath, "utf8")) as { jobId: string };
      const provider = new CountingFakeProvider();
      const reopened = new EtherApplication({
        appDataRoot,
        appVersion: "4.0.0-test",
        provider,
        dispatchMode: "manual",
        documentEnvironment: {
          staleMs: 0,
          processIsAlive: () => false
        }
      });
      await reopened.openDocument({ path: documentPath, access: "require-write" });
      expect((await reopened.queryJob(jobId)).status).toBe(completedOnOpen ? "completed" : "queued");
      if (!completedOnOpen) await reopened.runPending(jobId);
      expect((await reopened.queryJob(jobId)).status).toBe("completed");
      expect(provider.calls).toBe(expectedProviderCalls);
      expect(await reopened.searchArtifacts({ text: "" })).toHaveLength(1);
      expect(listRecoveryJournalPaths(appDataRoot)).toEqual([]);
      await reopened.closeDocument();
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }
  }, 20000);

  it("rejects a persisted capsule whose content does not match its SHA-256", async () => {
    const ready = await createReadyApplication({ dispatchMode: "manual" });
    await ready.application.closeDocument();
    const store = await DocumentStore.open(ready.documentPath, { access: "require-write" });

    await expect(
      store.transaction(({ execution }) =>
        execution.savePlan({
          ...ready.plan,
          id: "plan-with-invalid-content-hash",
          estimatedCalls: ready.plan.estimatedCalls + 1
        })
      )
    ).rejects.toMatchObject({ code: "PLAN_HASH_INVALID" });
    await store.close();
  });

  it("rejects preview when the injected provider does not match the graph provider", async () => {
    const baseDescriptor = new FakeImageProvider().descriptor;
    class MismatchedProvider extends FakeImageProvider {
      override readonly descriptor = {
        ...baseDescriptor,
        id: "different-provider"
      };
    }
    const documentsRoot = await temp("ether-provider-mismatch-doc-");
    const appDataRoot = await temp("ether-provider-mismatch-appdata-");
    const application = new EtherApplication({
      appDataRoot,
      appVersion: "4.0.0-test",
      provider: new MismatchedProvider(),
      dispatchMode: "manual"
    });
    await application.createDocument({
      path: path.join(documentsRoot, "Campaign.ether"),
      title: "Campaign",
      initialGraph: blankGraph()
    });
    const initial = await application.queryDocument();
    await application.applyGraphTransaction({
      commandId: "provider-mismatch-graph",
      transaction: graphTransaction(initial.documentRevisionId, initial.graphRevisions["graph-root"]!)
    });

    await expect(
      application.previewRun({
        commandId: "provider-mismatch-preview",
        graphId: "graph-root",
        scope: { kind: "graph" }
      })
    ).rejects.toMatchObject({ code: "PROVIDER_CAPABILITY_UNAVAILABLE" });
    await application.closeDocument();
  });

  it.each([
    ["parameters", (plan: ExecutionPlan, value: string) => { plan.steps[0]!.parameters.contentHash = value; }],
    ["settings", (plan: ExecutionPlan, value: string) => { plan.steps[0]!.provider.settings.contentHash = value; }],
    ["context", (plan: ExecutionPlan, value: string) => { plan.steps[0]!.compiledContext.contentHash = value; }],
    ["metadata", (plan: ExecutionPlan, value: string) => {
      plan.steps[0]!.provider.settings.metadata = { contentHash: value };
    }]
  ])("includes nested %s contentHash fields in the plan digest", async (_name, mutate) => {
    const ready = await createReadyApplication({ dispatchMode: "manual" });
    const first = structuredClone(ready.plan);
    const second = structuredClone(ready.plan);
    mutate(first, "nested-alpha");
    mutate(second, "nested-beta");

    expect(hashPlan(first)).not.toBe(hashPlan(second));
    await ready.application.closeDocument();
  });

  it("rejects a source-document plan after Save Copy rewrites document identity", async () => {
    const ready = await createReadyApplication({ dispatchMode: "manual" });
    await ready.application.closeDocument();
    const copyPath = path.join(await temp("ether-save-copy-"), "Campaign Copy.ether");
    const source = await DocumentStore.open(ready.documentPath, { access: "require-write" });
    const copied = await source.saveCopy(copyPath);
    await source.close();
    expect(copied.documentId).not.toBe(ready.plan.documentId);

    const copy = new EtherApplication({
      appDataRoot: ready.appDataRoot,
      appVersion: "4.0.0-test",
      provider: new FakeImageProvider(),
      dispatchMode: "manual"
    });
    await copy.openDocument({ path: copyPath, access: "require-write" });
    await expect(
      copy.startRun({
        commandId: "copied-source-plan-start",
        planId: ready.plan.id,
        contentHash: ready.plan.contentHash,
        runPermitId: ready.permit.id
      })
    ).rejects.toMatchObject({ code: "PERMIT_REVOKED" });
    await copy.closeDocument();
  });

  it("quarantines a queued source-document job when its Save Copy is reopened", async () => {
    const ready = await createReadyApplication({ dispatchMode: "manual" });
    const started = await ready.application.startRun({
      commandId: "queued-copy-start",
      planId: ready.plan.id,
      contentHash: ready.plan.contentHash,
      runPermitId: ready.permit.id
    });
    await ready.application.closeDocument();
    const copyPath = path.join(await temp("ether-queued-save-copy-"), "Campaign Copy.ether");
    const source = await DocumentStore.open(ready.documentPath, { access: "require-write" });
    await source.saveCopy(copyPath);
    await source.close();
    const provider = new CountingFakeProvider();
    const copy = new EtherApplication({
      appDataRoot: ready.appDataRoot,
      appVersion: "4.0.0-test",
      provider,
      dispatchMode: "manual"
    });

    await copy.openDocument({ path: copyPath, access: "require-write" });
    expect((await copy.runPending(started.id)).status).toBe("needs-attention");
    expect(provider.calls).toBe(0);
    expect((await copy.queryAttempts(started.id))[0]!.failure).toMatchObject({
      code: "STALE_PLAN",
      retryable: false
    });
    await copy.closeDocument();
  });

  it("leaves resumed work queued when the injected provider differs from the persisted capsule", async () => {
    const ready = await createReadyApplication({ dispatchMode: "manual" });
    const started = await ready.application.startRun({
      commandId: "provider-reopen-start",
      planId: ready.plan.id,
      contentHash: ready.plan.contentHash,
      runPermitId: ready.permit.id
    });
    await ready.application.closeDocument();
    const baseDescriptor = new FakeImageProvider().descriptor;
    class ReopenedProvider extends CountingFakeProvider {
      override readonly descriptor = { ...baseDescriptor, id: "reopened-different-provider" };
    }
    const provider = new ReopenedProvider();
    const reopened = new EtherApplication({
      appDataRoot: ready.appDataRoot,
      appVersion: "4.0.0-test",
      provider
    });
    await reopened.openDocument({ path: ready.documentPath, access: "require-write" });

    expect((await reopened.queryJob(started.id)).status).toBe("queued");
    expect(provider.calls).toBe(0);
    expect(await reopened.queryAttempts(started.id)).toEqual([
      expect.objectContaining({ status: "queued", startedAt: null, failure: null })
    ]);
    await reopened.closeDocument();
  });

  it("rejects preview when the selected scope has no runnable steps", async () => {
    const ready = await createReadyApplication({ dispatchMode: "manual" });

    await expect(
      ready.application.previewRun({
        commandId: "empty-selected-preview",
        graphId: "graph-root",
        scope: { kind: "selected", nodeIds: ["prompt"] }
      })
    ).rejects.toMatchObject({ code: "NO_RUNNABLE_SCOPE" });
    await ready.application.closeDocument();
  });

  it.each(["../../escaped.png", "..\\..\\escaped.png", "CON.png"])(
    "rejects provider-controlled artifact name %s",
    async (fileName) => {
      const provider = new ArtifactProbeProvider((result) => ({
        ...result,
        artifacts: [{ ...result.artifacts[0]!, fileName }]
      }));
      const ready = await createReadyApplication({ provider });
      const started = await ready.application.startRun({
        commandId: `unsafe-name-${fileName}`,
        planId: ready.plan.id,
        contentHash: ready.plan.contentHash,
        runPermitId: ready.permit.id
      });

      expect((await ready.application.waitForJob(started.id)).status).toBe("failed");
      expect((await ready.application.queryAttempts(started.id))[0]?.failure).toMatchObject({
        code: "PROVIDER_OUTPUT_PATH_INVALID"
      });
      await ready.application.closeDocument();
    }
  );

  it("rejects an absolute provider-controlled artifact name", async () => {
    const outsideRoot = await temp("ether-provider-absolute-");
    const fileName = path.join(outsideRoot, "escaped.png");
    const provider = new ArtifactProbeProvider((result) => ({
      ...result,
      artifacts: [{ ...result.artifacts[0]!, fileName }]
    }));
    const ready = await createReadyApplication({ provider });
    const started = await ready.application.startRun({
      commandId: "unsafe-absolute-name",
      planId: ready.plan.id,
      contentHash: ready.plan.contentHash,
      runPermitId: ready.permit.id
    });

    expect((await ready.application.waitForJob(started.id)).status).toBe("failed");
    expect((await ready.application.queryAttempts(started.id))[0]?.failure).toMatchObject({
      code: "PROVIDER_OUTPUT_PATH_INVALID"
    });
    await ready.application.closeDocument();
  });

  it("rejects a provider source path outside its owned attempt staging directory", async () => {
    const outsideRoot = await temp("ether-provider-source-");
    const outsidePath = path.join(outsideRoot, "outside.png");
    const provider = new ArtifactProbeProvider(async (result) => {
      await writeFile(outsidePath, result.artifacts[0]!.content!);
      return {
        ...result,
        artifacts: [{ ...result.artifacts[0]!, content: undefined, sourcePath: outsidePath }]
      };
    });
    const ready = await createReadyApplication({ provider });
    const started = await ready.application.startRun({
      commandId: "unsafe-source-path",
      planId: ready.plan.id,
      contentHash: ready.plan.contentHash,
      runPermitId: ready.permit.id
    });

    expect((await ready.application.waitForJob(started.id)).status).toBe("failed");
    expect((await ready.application.queryAttempts(started.id))[0]?.failure).toMatchObject({
      code: "PROVIDER_OUTPUT_PATH_INVALID"
    });
    await ready.application.closeDocument();
  });

  it("rejects a provider source path that escapes through a directory link", async () => {
    const outsideRoot = await temp("ether-provider-link-source-");
    const outsidePath = path.join(outsideRoot, "outside.png");
    let attemptStagingDirectory = "";
    let ownedLinkPath = "";
    const provider = new ArtifactProbeProvider(async (result, context) => {
      await writeFile(outsidePath, result.artifacts[0]!.content!);
      const linkPath = path.join(context.stagingDirectory, "linked-outside");
      attemptStagingDirectory = context.stagingDirectory;
      ownedLinkPath = linkPath;
      await symlink(outsideRoot, linkPath, "junction");
      return {
        ...result,
        artifacts: [{
          ...result.artifacts[0]!,
          content: undefined,
          sourcePath: path.join(linkPath, "outside.png")
        }]
      };
    });
    const ready = await createReadyApplication({ provider });
    const started = await ready.application.startRun({
      commandId: "unsafe-linked-source-path",
      planId: ready.plan.id,
      contentHash: ready.plan.contentHash,
      runPermitId: ready.permit.id
    });

    expect((await ready.application.waitForJob(started.id)).status).toBe("failed");
    expect((await ready.application.queryAttempts(started.id))[0]?.failure).toMatchObject({
      code: "PROVIDER_OUTPUT_PATH_INVALID"
    });
    expect(await readFile(outsidePath)).toEqual(expect.any(Buffer));
    expect(await pathExists(ownedLinkPath)).toBe(false);
    expect(await pathExists(attemptStagingDirectory)).toBe(false);
    expect(listRecoveryJournalPaths(ready.appDataRoot)).toEqual([]);
    await ready.application.closeDocument();
  });

  it("cleans a dangling provider staging junction without touching its deleted target on Windows", async () => {
    if (process.platform !== "win32") return;
    const externalParent = await temp("ether-dangling-junction-parent-");
    const externalTarget = path.join(externalParent, "target");
    const externalSentinel = path.join(externalParent, "keep.txt");
    await mkdir(externalTarget);
    await writeFile(externalSentinel, "keep");
    let attemptStagingDirectory = "";
    let ownedLinkPath = "";
    const provider = new ArtifactProbeProvider(async (result, context) => {
      const linkPath = path.join(context.stagingDirectory, "dangling-target");
      attemptStagingDirectory = context.stagingDirectory;
      ownedLinkPath = linkPath;
      await symlink(externalTarget, linkPath, "junction");
      await rm(externalTarget, { recursive: true, force: true });
      return {
        ...result,
        artifacts: [{
          ...result.artifacts[0]!,
          content: undefined,
          sourcePath: path.join(linkPath, "missing.png")
        }]
      };
    });
    const ready = await createReadyApplication({ provider });
    const started = await ready.application.startRun({
      commandId: "dangling-linked-source-path",
      planId: ready.plan.id,
      contentHash: ready.plan.contentHash,
      runPermitId: ready.permit.id
    });

    expect((await ready.application.waitForJob(started.id)).status).toBe("failed");
    expect((await ready.application.queryAttempts(started.id))[0]?.failure).toMatchObject({
      code: "PROVIDER_OUTPUT_PATH_INVALID"
    });
    await ready.application.closeDocument();

    const reopened = new EtherApplication({
      appDataRoot: ready.appDataRoot,
      appVersion: "4.0.0-test",
      provider,
      dispatchMode: "manual"
    });
    await reopened.openDocument({ path: ready.documentPath, access: "require-write" });
    try {
      await expect(lstat(ownedLinkPath)).rejects.toMatchObject({ code: "ENOENT" });
      await expect(lstat(attemptStagingDirectory)).rejects.toMatchObject({ code: "ENOENT" });
      expect(listRecoveryJournalPaths(ready.appDataRoot)).toEqual([]);
      expect(await pathExists(externalTarget)).toBe(false);
      expect(await readFile(externalSentinel, "utf8")).toBe("keep");
    } finally {
      await reopened.closeDocument();
    }
  });
});
