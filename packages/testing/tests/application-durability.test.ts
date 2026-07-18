import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { EtherApplication } from "@ether/application";
import { DocumentStore, listRecoveryJournalPaths } from "@ether/document";
import {
  FakeImageProvider,
  type GenerationProviderInput,
  type ImageEditProviderInput,
  type ProviderExecutionContext
} from "@ether/providers";
import type { EtherGraph, GraphTransaction } from "@ether/schema";
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

async function temp(prefix: string): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  roots.push(root);
  return root;
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

function graphTransaction(documentRevisionId: string, graphRevisionId: string): GraphTransaction {
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
            outputCount: 1
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
  provider?: FakeImageProvider;
  dispatchMode?: "automatic" | "manual";
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
    transaction: graphTransaction(initial.documentRevisionId, initial.graphRevisions["graph-root"]!)
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
    ).rejects.toMatchObject({ code: "PROVIDER_MISMATCH" });
    await application.closeDocument();
  });
});
