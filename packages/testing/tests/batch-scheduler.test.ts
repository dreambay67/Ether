import {
  DurableScheduler,
  ExecutionConcurrencyDomains,
  ExecutorFailure,
  ExecutorRegistry,
  hashPlan,
  providerConcurrencyGroup,
  providerParallelismLimit,
  type ExecutorClaim,
  type ExecutorResult,
  type SchedulerPersistence,
  type StepExecutor
} from "@ether/execution";
import type { ExecutionJob, ExecutionPlan, PayloadEnvelope, ProviderBinding } from "@ether/schema";
import { describe, expect, it } from "vitest";

describe("DurableScheduler", () => {
  it("recovers a practical 500-item batch without accepting an output twice", async () => {
    const fixture = new RecoveryFixture(500);
    const first = new DurableScheduler({
      appDataRoot: "C:\\EtherTest",
      persistence: fixture,
      executors: new ExecutorRegistry([new RecoveryExecutor(true)])
    });
    const firstRun = first.run(fixture.job.id);
    await fixture.waitForAccepted(250);
    await first.detach();
    await firstRun;

    fixture.recoverInterruptedWork();
    const resumed = new DurableScheduler({
      appDataRoot: "C:\\EtherTest",
      persistence: fixture,
      executors: new ExecutorRegistry([new RecoveryExecutor(false)])
    });
    await resumed.run(fixture.job.id);

    expect(fixture.acceptedIds).toHaveLength(500);
    expect(new Set(fixture.acceptedIds).size).toBe(500);
    expect(fixture.job.status).toBe("completed");
    expect(fixture.maximumActive).toBe(8);
  });

  it("runs real work concurrently up to the four-call Codex family cap and gives each item a distinct effective prompt", async () => {
    const fixture = new ConcurrentJobsFixture();
    const binding = providerBinding("codex-assistant", 1);
    const job = fixture.addJob("overlap", 5, binding, 5);
    const executor = new ControlledExecutor();
    const scheduler = fixture.scheduler(executor);

    const run = scheduler.run(job.id);
    await waitForExecutorActive(executor, 4, fixture);

    expect(executor.maximumActive).toBe(4);
    expect([...executor.prompts.values()].sort()).toEqual([
      "Base instruction\n\nBatch item:\n- variant: \"overlap-0\"",
      "Base instruction\n\nBatch item:\n- variant: \"overlap-1\"",
      "Base instruction\n\nBatch item:\n- variant: \"overlap-2\"",
      "Base instruction\n\nBatch item:\n- variant: \"overlap-3\""
    ]);
    expect([...executor.contexts.values()]).toEqual(expect.arrayContaining([
      expect.objectContaining({ batchItem: { variant: "overlap-0" } }),
      expect.objectContaining({ batchItem: { variant: "overlap-1" } }),
      expect.objectContaining({ batchItem: { variant: "overlap-2" } }),
      expect.objectContaining({ batchItem: { variant: "overlap-3" } })
    ]));

    executor.release();
    await run;
    expect(executor.maximumActive).toBe(4);
    expect((await fixture.getJob(job.id))?.status).toBe("completed");
  });

  it("shares one app-wide 4/4/8 domain across schedulers, queues provider fifths, and queues ninth global work", async () => {
    const first = new ConcurrentJobsFixture();
    const second = new ConcurrentJobsFixture();
    const domains = new ExecutionConcurrencyDomains();
    const codex = providerBinding("codex-assistant", 1);
    const antigravity = providerBinding("google-nano-banana-2", 1);
    const firstJobs = [
      first.addJob("codex-batch-a", 3, codex, 8),
      first.addJob("antigravity-batch-a", 3, antigravity, 8)
    ];
    const secondJobs = [
      second.addJob("codex-batch-b", 2, codex, 8),
      second.addJob("antigravity-batch-b", 2, antigravity, 8)
    ];
    const executor = new ControlledExecutor();
    const firstScheduler = first.scheduler(executor, undefined, domains);
    const secondScheduler = second.scheduler(executor, undefined, domains);

    const runs = [
      ...firstJobs.map((job) => firstScheduler.run(job.id)),
      ...secondJobs.map((job) => secondScheduler.run(job.id))
    ];
    await waitForExecutorActive(executor, 8, first);

    expect(executor.activeByProvider.get("codex")).toBe(4);
    expect(executor.activeByProvider.get("antigravity")).toBe(4);
    expect(executor.maximumByProvider.get("codex")).toBe(4);
    expect(executor.maximumByProvider.get("antigravity")).toBe(4);
    expect(executor.maximumActive).toBe(8);
    await Promise.all([
      waitForClaimed(first, "codex-batch-a", 3),
      waitForClaimed(second, "codex-batch-b", 2),
      waitForClaimed(first, "antigravity-batch-a", 3),
      waitForClaimed(second, "antigravity-batch-b", 2)
    ]);
    expect([...executor.prompts.keys()].filter((id) => id.startsWith("codex-batch-"))).toHaveLength(4);
    expect([...executor.prompts.keys()].filter((id) => id.startsWith("antigravity-batch-"))).toHaveLength(4);

    const ninth = second.addJob("global-ninth", 1, providerBinding("unverified-external", 99), 1);
    const ninthRun = secondScheduler.run(ninth.id);
    await waitForClaimed(second, ninth.id, 1);
    expect(executor.prompts.has("global-ninth:step:work:0")).toBe(false);

    executor.release();
    await Promise.all([...runs, ninthRun]);
  });

  it("retries one failed item once while seven sibling calls fill the shared 4/4/8 domain", async () => {
    const fixture = new ConcurrentJobsFixture();
    const domains = new ExecutionConcurrencyDomains();
    const codex = providerBinding("codex-assistant", 4);
    const antigravity = providerBinding("google-nano-banana-2", 4);
    const retryJob = fixture.addJob("retry-target", 1, codex, 8);
    const firstWave = [
      retryJob,
      ...Array.from({ length: 3 }, (_, index) => fixture.addJob(`retry-codex-${index}`, 1, codex, 8)),
      ...Array.from({ length: 4 }, (_, index) => fixture.addJob(`retry-antigravity-${index}`, 1, antigravity, 8))
    ];
    const failingExecutor = new ControlledExecutor({
      failWorkItemId: "retry-target:step:work:0",
      failAfterActive: 8,
      failOnce: true
    });
    const firstScheduler = fixture.scheduler(failingExecutor, undefined, domains);
    const firstRuns = firstWave.map((job) => firstScheduler.run(job.id));

    await waitForExecutorActive(failingExecutor, 8, fixture);
    expect(failingExecutor.maximumByProvider.get("codex")).toBe(4);
    expect(failingExecutor.maximumByProvider.get("antigravity")).toBe(4);
    expect(failingExecutor.maximumActive).toBe(8);
    failingExecutor.release();
    await Promise.all(firstRuns);
    expect((await fixture.getJob(retryJob.id))?.status).toBe("failed");
    expect(fixture.claimed(retryJob.id)).toBe(1);

    const firstRetry = await fixture.retryFailed(retryJob.id, "retry-command");
    const duplicateRetry = await fixture.retryFailed(retryJob.id, "retry-command");
    expect(duplicateRetry).toEqual(firstRetry);
    expect(fixture.claimed(retryJob.id)).toBe(1);

    const secondWave = [
      retryJob,
      ...Array.from({ length: 3 }, (_, index) => fixture.addJob(`retry-second-codex-${index}`, 1, codex, 8)),
      ...Array.from({ length: 4 }, (_, index) => fixture.addJob(`retry-second-antigravity-${index}`, 1, antigravity, 8))
    ];
    const retryExecutor = new ControlledExecutor();
    const retryScheduler = fixture.scheduler(retryExecutor, undefined, domains);
    const retryRuns = secondWave.map((job) => retryScheduler.run(job.id));

    await waitForExecutorActive(retryExecutor, 8, fixture);
    expect(retryExecutor.maximumByProvider.get("codex")).toBe(4);
    expect(retryExecutor.maximumByProvider.get("antigravity")).toBe(4);
    expect(retryExecutor.maximumActive).toBe(8);
    expect([...retryExecutor.prompts.keys()].filter((id) => id === "retry-target:step:work:0")).toHaveLength(1);
    retryExecutor.release();
    await Promise.all(retryRuns);

    expect(fixture.claimed(retryJob.id)).toBe(2);
    expect((await fixture.getJob(retryJob.id))?.status).toBe("completed");
  });

  it("fails closed at one for unknown providers even when they advertise a larger cap", () => {
    expect(providerParallelismLimit(providerBinding("unverified-external", 99))).toBe(1);
  });

  it("shares the global gate across simultaneous jobs", async () => {
    const fixture = new ConcurrentJobsFixture();
    const jobs = Array.from({ length: 10 }, (_, index) =>
      fixture.addJob(`global-${index}`, 1, providerBinding(`provider-${index}`, 8), 8)
    );
    const executor = new ControlledExecutor();
    const scheduler = fixture.scheduler(executor);

    const runs = jobs.map((job) => scheduler.run(job.id));
    await executor.waitForActive(8);
    expect(executor.maximumActive).toBe(8);

    executor.release();
    await Promise.all(runs);
    expect(executor.maximumActive).toBe(8);
  });

  it("uses a work-item provider override before the step binding", async () => {
    const fixture = new ConcurrentJobsFixture();
    const stepBinding = providerBinding("codex-assistant", 8);
    const override = providerBinding("unverified-image");
    const job = fixture.addJob("override", 2, stepBinding, 2, override);
    const executor = new ControlledExecutor();
    const resolved: string[] = [];
    const scheduler = fixture.scheduler(executor, (providerId) => resolved.push(providerId));

    const run = scheduler.run(job.id);
    await executor.waitForActive(1);
    await nextTurn();

    expect(executor.maximumActive).toBe(1);
    expect(resolved).toEqual(["unverified-image"]);
    executor.release();
    await run;
    expect(resolved).toEqual(["unverified-image", "unverified-image"]);
  });

  it("cancels a claim waiting for provider-family capacity without disturbing the active sibling", async () => {
    const fixture = new ConcurrentJobsFixture();
    const binding = providerBinding("codex-assistant", 4);
    const activeJob = fixture.addJob("cancel-active", 4, binding, 4);
    const waitingJob = fixture.addJob("cancel-waiting", 1, binding, 1);
    const executor = new ControlledExecutor();
    const scheduler = fixture.scheduler(executor);

    const activeRun = scheduler.run(activeJob.id);
    await executor.waitForActive(4);
    const waitingRun = scheduler.run(waitingJob.id);
    await fixture.waitForState(waitingJob.id, "running");

    await scheduler.cancel(waitingJob.id, "cancel-waiting-command");
    await waitingRun;
    expect(executor.active).toBe(4);
    expect((await fixture.getJob(waitingJob.id))?.status).toBe("cancelled");

    executor.release();
    await activeRun;
  });

  it("retains scheduler ownership of in-flight siblings after one item fails", async () => {
    const fixture = new ConcurrentJobsFixture();
    const job = fixture.addJob("failure", 5, providerBinding("codex-assistant", 4), 4);
    const executor = new ControlledExecutor({ failOrdinal: 0, failAfterActive: 4 });
    const scheduler = fixture.scheduler(executor);

    const run = scheduler.run(job.id);
    await fixture.waitForState(job.id, "failed");
    let settled = false;
    void run.then(() => { settled = true; });
    await nextTurn();

    expect(settled).toBe(false);
    expect(executor.active).toBe(3);
    expect(scheduler.run(job.id)).toBe(run);
    expect(fixture.claimed(job.id)).toBe(4);

    executor.release();
    await run;
    expect(fixture.claimed(job.id)).toBe(4);
    expect((await fixture.getJob(job.id))?.status).toBe("failed");
  });
});

class ControlledExecutor implements StepExecutor {
  readonly kinds = ["codex-llm"] as const;
  readonly prompts = new Map<string, string>();
  readonly contexts = new Map<string, Record<string, unknown>>();
  readonly activeByProvider = new Map<string, number>();
  readonly maximumByProvider = new Map<string, number>();
  active = 0;
  maximumActive = 0;
  private readonly startedWaiters: Array<{ count: number; resolve: () => void }> = [];
  private readonly released: Promise<void>;
  private releaseBlocked!: () => void;

  private failed = false;

  constructor(private readonly options: {
    failOrdinal?: number;
    failWorkItemId?: string;
    failAfterActive?: number;
    failOnce?: boolean;
  } = {}) {
    this.released = new Promise<void>((resolve) => { this.releaseBlocked = resolve; });
  }

  async execute(context: Parameters<StepExecutor["execute"]>[0]): Promise<ExecutorResult> {
    const binding = context.plannedWorkItem.providerBindingOverride
      ?? context.step.providerBinding
      ?? context.step.provider;
    const group = providerConcurrencyGroup(binding.providerId);
    this.active += 1;
    this.maximumActive = Math.max(this.maximumActive, this.active);
    const providerActive = (this.activeByProvider.get(group) ?? 0) + 1;
    this.activeByProvider.set(group, providerActive);
    this.maximumByProvider.set(
      group,
      Math.max(this.maximumByProvider.get(group) ?? 0, providerActive)
    );
    this.prompts.set(context.plannedWorkItem.id, context.step.compiledPrompt);
    this.contexts.set(context.plannedWorkItem.id, context.step.compiledContext);
    this.resolveStartedWaiters();
    try {
      const shouldFail = (
        context.plannedWorkItem.ordinal === this.options.failOrdinal
        || context.plannedWorkItem.id === this.options.failWorkItemId
      ) && (!this.options.failOnce || !this.failed);
      if (shouldFail) {
        this.failed = true;
        await this.waitForActive(this.options.failAfterActive ?? 1);
        throw new ExecutorFailure("CONTROLLED_FAILURE", "Controlled scheduler failure.", true);
      }
      await this.released;
      return {
        kind: "complete",
        outputs: [{
          channel: "data",
          role: "general",
          content: {
            kind: "object",
            value: {
              ordinal: context.plannedWorkItem.ordinal,
              prompt: context.step.compiledPrompt
            }
          },
          metadata: {}
        }]
      };
    } finally {
      this.active -= 1;
      this.activeByProvider.set(group, (this.activeByProvider.get(group) ?? 1) - 1);
    }
  }

  waitForActive(count: number): Promise<void> {
    if (this.active >= count) return Promise.resolve();
    return new Promise<void>((resolve) => this.startedWaiters.push({ count, resolve }));
  }

  release(): void {
    this.releaseBlocked();
  }

  private resolveStartedWaiters(): void {
    for (let index = this.startedWaiters.length - 1; index >= 0; index -= 1) {
      const waiter = this.startedWaiters[index]!;
      if (this.active < waiter.count) continue;
      this.startedWaiters.splice(index, 1);
      waiter.resolve();
    }
  }
}

type ConcurrentWorkState = "queued" | "running" | "accepted" | "failed" | "cancelled";

class ConcurrentJobsFixture implements SchedulerPersistence {
  readonly documentId = "concurrency-document";
  readonly path = "C:\\EtherTest\\scheduler-concurrency.ether";
  readonly failures: Array<{ attemptId: string; code: string; message: string }> = [];
  private readonly retryResults = new Map<string, ExecutionJob>();
  private readonly records = new Map<string, {
    job: ExecutionJob;
    plan: ExecutionPlan;
    states: ConcurrentWorkState[];
    claimCount: number;
  }>();

  addJob(
    id: string,
    itemCount: number,
    binding: ProviderBinding,
    parallelism: number,
    override?: ProviderBinding
  ): ExecutionJob {
    const createdAt = "2026-07-26T12:00:00.000Z";
    const stepId = `${id}:step`;
    const workItems = Array.from({ length: itemCount }, (_, ordinal) => ({
      id: `${stepId}:work:${ordinal}`,
      stepId,
      ordinal,
      inputs: [],
      parameters: [
        { name: "variant", value: `${id}-${ordinal}` },
        { name: "instruction", value: "This duplicate step parameter must not enter the batch prompt." }
      ],
      ...(override === undefined ? {} : { providerBindingOverride: override })
    }));
    const draft = {
      id: `${id}:plan`,
      capsuleVersion: 1 as const,
      hashVersion: "sha256-v1" as const,
      documentId: this.documentId,
      documentRevisionId: "revision-1",
      graphId: "graph-concurrency",
      graphRevisionId: "graph-revision-1",
      scope: { kind: "graph" as const },
      steps: [{
        id: stepId,
        nodeId: `${id}:worker`,
        executor: "codex-llm" as const,
        dependencyStepIds: [],
        inputPayloadIds: [],
        workItemIds: workItems.map((workItem) => workItem.id),
        compiledPrompt: "Base instruction",
        compiledContext: { source: "test" },
        parameters: { instruction: "Base instruction" },
        selectors: [],
        provider: binding,
        providerBinding: binding
      }],
      workItems,
      providerCapabilitySnapshots: [
        binding.capabilitySnapshot,
        ...(override === undefined ? [] : [override.capabilitySnapshot])
      ],
      estimatedCalls: itemCount,
      requestedParallelism: parallelism,
      effectiveParallelism: parallelism,
      warnings: [],
      createdAt
    };
    const contentHash = hashPlan(draft);
    const plan = { ...draft, contentHash } as ExecutionPlan;
    const job: ExecutionJob = {
      id,
      planId: plan.id,
      planContentHash: contentHash,
      status: "queued",
      requestedParallelism: parallelism,
      effectiveParallelism: parallelism,
      createdAt,
      startedAt: null,
      completedAt: null,
      cancellationRequestedAt: null
    };
    this.records.set(id, {
      job,
      plan,
      states: Array.from({ length: itemCount }, () => "queued"),
      claimCount: 0
    });
    return job;
  }

  scheduler(
    executor: StepExecutor,
    onResolved?: (providerId: string) => void,
    concurrencyDomains?: ExecutionConcurrencyDomains
  ): DurableScheduler {
    return new DurableScheduler({
      appDataRoot: "C:\\EtherTest",
      persistence: this,
      executors: new ExecutorRegistry([executor]),
      concurrencyDomains,
      providerResolver: ({ binding }) => {
        if (binding !== null && binding !== undefined) onResolved?.(binding.providerId);
        return {};
      }
    });
  }

  async claimNext(jobId: string): Promise<ExecutorClaim | undefined> {
    const record = this.records.get(jobId);
    if (record === undefined || ["completed", "failed", "cancelled", "needs-attention"].includes(record.job.status)) {
      return undefined;
    }
    const ordinal = record.states.findIndex((state) => state === "queued");
    if (ordinal < 0) return undefined;
    record.states[ordinal] = "running";
    record.claimCount += 1;
    record.job = {
      ...record.job,
      status: "running",
      startedAt: record.job.startedAt ?? "2026-07-26T12:00:01.000Z"
    };
    const workItem = record.plan.workItems[ordinal]!;
    return {
      plan: record.plan,
      job: record.job,
      workItem: {
        id: `${jobId}:durable:${ordinal}`,
        plannedWorkItemId: workItem.id,
        status: "running"
      },
      attempt: {
        id: `${jobId}-attempt-${ordinal}`,
        ordinal: 1,
        status: "running",
        startedAt: "2026-07-26T12:00:01.000Z",
        createdAt: "2026-07-26T12:00:00.000Z"
      },
      providerAttemptId: `${jobId}:provider-attempt:${ordinal}`
    };
  }

  async getJob(jobId: string): Promise<ExecutionJob | undefined> {
    return this.records.get(jobId)?.job;
  }

  async retryFailed(jobId: string, commandId: string): Promise<ExecutionJob> {
    const duplicate = this.retryResults.get(commandId);
    if (duplicate !== undefined) return duplicate;
    const record = this.requireRecord(jobId);
    record.states = record.states.map((state) => state === "failed" ? "queued" : state);
    record.job = {
      ...record.job,
      status: "queued",
      startedAt: null,
      completedAt: null,
      cancellationRequestedAt: null
    };
    this.retryResults.set(commandId, record.job);
    return record.job;
  }

  async cancelJob(jobId: string): Promise<ExecutionJob> {
    const record = this.requireRecord(jobId);
    record.states = record.states.map((state) =>
      state === "queued" || state === "running" ? "cancelled" : state
    );
    record.job = {
      ...record.job,
      status: "cancelled",
      cancellationRequestedAt: "2026-07-26T12:00:02.000Z",
      completedAt: "2026-07-26T12:00:02.000Z"
    };
    return record.job;
  }

  async failAttempt(attemptId: string, code: string, message: string): Promise<boolean> {
    this.failures.push({ attemptId, code, message });
    const { record, ordinal } = this.attemptRecord(attemptId);
    if (record.states[ordinal] !== "running") return false;
    record.states[ordinal] = "failed";
    record.job = {
      ...record.job,
      status: "failed",
      completedAt: "2026-07-26T12:00:03.000Z"
    };
    return true;
  }

  async acceptCompletion(input: Record<string, unknown>): Promise<unknown> {
    const claim = input.claim as ExecutorClaim;
    const record = this.requireRecord(claim.job.id);
    const ordinal = record.plan.workItems.findIndex(
      (workItem) => workItem.id === claim.workItem.plannedWorkItemId
    );
    if (record.states[ordinal] !== "running") return {};
    record.states[ordinal] = "accepted";
    if (record.states.every((state) => state === "accepted")) {
      record.job = {
        ...record.job,
        status: "completed",
        completedAt: "2026-07-26T12:00:04.000Z"
      };
    }
    return {};
  }

  async acceptProviderOutput(): Promise<unknown> {
    throw new Error("Provider output is not used by the concurrency fixture.");
  }
  async prepareProviderCompletion(): Promise<unknown> { return undefined; }
  async stageProviderCompletion(): Promise<unknown> { return undefined; }
  async discardProviderCompletion(): Promise<boolean> { return true; }
  async resolvePayloads(): Promise<PayloadEnvelope[]> { return []; }
  async waitForReview(): Promise<void> {
    throw new Error("Review is not used by the concurrency fixture.");
  }

  claimed(jobId: string): number {
    return this.requireRecord(jobId).claimCount;
  }

  async waitForState(jobId: string, state: ExecutionJob["status"]): Promise<void> {
    while (this.requireRecord(jobId).job.status !== state) await nextTurn();
  }

  private requireRecord(jobId: string) {
    const record = this.records.get(jobId);
    if (record === undefined) throw new Error(`Unknown concurrency job ${jobId}.`);
    return record;
  }

  private attemptRecord(attemptId: string) {
    const marker = "-attempt-";
    const markerIndex = attemptId.lastIndexOf(marker);
    const jobId = attemptId.slice(0, markerIndex);
    const ordinal = Number(attemptId.slice(markerIndex + marker.length));
    return { record: this.requireRecord(jobId), ordinal };
  }
}

function providerBinding(providerId: string, maxParallelism?: number): ProviderBinding {
  return {
    providerId,
    profileId: `${providerId}:profile`,
    modelId: `${providerId}:model`,
    settings: {},
    capabilitySnapshot: {
      providerId,
      profileId: `${providerId}:profile`,
      operation: "llm",
      inputChannels: ["text"],
      outputChannels: ["text"],
      aspectRatios: [],
      resolutions: [],
      maxReferences: 0,
      maxOutputsPerCall: 1,
      ...(maxParallelism === undefined ? {} : { maxParallelism }),
      supportsCancellation: true,
      supportsSeed: false,
      provenance: "static-constraint",
      limitations: []
    }
  };
}

function nextTurn(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function waitForExecutorActive(
  executor: ControlledExecutor,
  count: number,
  fixture: ConcurrentJobsFixture
): Promise<void> {
  return Promise.race([
    executor.waitForActive(count),
    new Promise<never>((_, reject) => setTimeout(
      () => reject(new Error(`Executor did not reach ${count} active calls: ${JSON.stringify(fixture.failures)}`)),
      1_000
    ))
  ]);
}

async function waitForClaimed(fixture: ConcurrentJobsFixture, jobId: string, count: number): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (fixture.claimed(jobId) < count) {
    if (Date.now() > deadline) throw new Error(`Job ${jobId} did not claim ${count} work items.`);
    await nextTurn();
  }
}

class RecoveryExecutor implements StepExecutor {
  readonly kinds = ["deterministic"] as const;

  constructor(private readonly pauseAfterFirstHalf: boolean) {}

  async execute(context: Parameters<StepExecutor["execute"]>[0]): Promise<ExecutorResult> {
    if (this.pauseAfterFirstHalf && context.plannedWorkItem.ordinal >= 250) {
      await untilAborted(context.signal);
    }
    return {
      kind: "complete",
      outputs: [{
        channel: "data",
        role: "general",
        content: { kind: "object", value: { ordinal: context.plannedWorkItem.ordinal } },
        metadata: {}
      }]
    };
  }
}

class RecoveryFixture implements SchedulerPersistence {
  readonly documentId = "doc-500";
  readonly path = "C:\\EtherTest\\recovery.ether";
  readonly plan: ExecutionPlan;
  readonly acceptedIds: string[] = [];
  readonly states: Array<"queued" | "running" | "accepted">;
  maximumActive = 0;
  active = 0;
  job: ExecutionJob;

  constructor(count: number) {
    const createdAt = "2026-07-22T10:00:00.000Z";
    const capability = {
      providerId: "local",
      profileId: "local",
      operation: "generate-image" as const,
      inputChannels: [],
      outputChannels: ["image" as const],
      aspectRatios: ["1:1"],
      resolutions: [{ id: "1k", width: 1024, height: 1024, label: "1K" }],
      maxReferences: 0,
      maxOutputsPerCall: 1,
      maxParallelism: 8,
      supportsCancellation: true,
      supportsSeed: false,
      provenance: "static-constraint" as const,
      limitations: []
    };
    const workItems = Array.from({ length: count }, (_, ordinal) => ({
      id: `step-local:work-${ordinal}`,
      stepId: "step-local",
      ordinal,
      inputs: [],
      parameters: []
    }));
    const draft = {
      id: "plan-500",
      capsuleVersion: 1 as const,
      hashVersion: "sha256-v1" as const,
      documentId: this.documentId,
      documentRevisionId: "revision-1",
      graphId: "graph-1",
      graphRevisionId: "graph-revision-1",
      scope: { kind: "graph" as const },
      steps: [{
        id: "step-local",
        nodeId: "filter-1",
        executor: "deterministic" as const,
        dependencyStepIds: [],
        inputPayloadIds: [],
        workItemIds: workItems.map((work) => work.id),
        compiledPrompt: "",
        compiledContext: {},
        parameters: {},
        selectors: [],
        provider: {
          providerId: "local",
          profileId: "local",
          modelId: "local",
          settings: {},
          capabilitySnapshot: capability
        }
      }],
      workItems,
      providerCapabilitySnapshots: [capability],
      estimatedCalls: count,
      warnings: [],
      createdAt
    };
    const contentHash = hashPlan(draft);
    this.plan = { ...draft, contentHash };
    this.states = Array.from({ length: count }, () => "queued");
    this.job = {
      id: "job-500",
      planId: this.plan.id,
      planContentHash: contentHash,
      status: "queued",
      requestedParallelism: 8,
      effectiveParallelism: 8,
      createdAt,
      startedAt: null,
      completedAt: null,
      cancellationRequestedAt: null
    };
  }

  async claimNext(jobId: string): Promise<ExecutorClaim | undefined> {
    if (jobId !== this.job.id || this.job.status === "completed") return undefined;
    const ordinal = this.states.findIndex((state) => state === "queued");
    if (ordinal < 0) return undefined;
    this.states[ordinal] = "running";
    this.active += 1;
    this.maximumActive = Math.max(this.maximumActive, this.active);
    this.job = { ...this.job, status: "running", startedAt: this.job.startedAt ?? "2026-07-22T10:00:01.000Z" };
    const work = this.plan.workItems[ordinal]!;
    return {
      plan: this.plan,
      job: this.job,
      workItem: { id: `durable-${ordinal}`, plannedWorkItemId: work.id, status: "running" },
      attempt: {
        id: `attempt-${ordinal}`,
        ordinal: 1,
        status: "running",
        startedAt: "2026-07-22T10:00:01.000Z",
        createdAt: "2026-07-22T10:00:00.000Z"
      },
      providerAttemptId: `provider-attempt-${ordinal}`
    };
  }

  async getJob(jobId: string): Promise<ExecutionJob | undefined> {
    return jobId === this.job.id ? this.job : undefined;
  }

  async cancelJob(): Promise<ExecutionJob> { return this.job; }
  async failAttempt(): Promise<boolean> { return true; }
  async acceptProviderOutput(): Promise<unknown> { throw new Error("Provider output is not used in this fixture."); }
  async prepareProviderCompletion(): Promise<unknown> { return undefined; }
  async stageProviderCompletion(): Promise<unknown> { return undefined; }
  async discardProviderCompletion(): Promise<boolean> { return true; }
  async resolvePayloads(): Promise<PayloadEnvelope[]> { return []; }
  async waitForReview(): Promise<void> { throw new Error("Review is not used in this fixture."); }

  async acceptCompletion(input: Record<string, unknown>): Promise<unknown> {
    const claim = input.claim as ExecutorClaim;
    const ordinal = this.plan.workItems.findIndex((work) => work.id === claim.workItem.plannedWorkItemId);
    if (this.states[ordinal] !== "running") throw new Error(`Work ${ordinal} was accepted from an invalid state.`);
    const outputId = ((input.outputs as Array<{ version: { id: string } }>)[0]?.version.id);
    if (outputId === undefined || this.acceptedIds.includes(outputId)) throw new Error(`Duplicate accepted output ${String(outputId)}.`);
    this.acceptedIds.push(outputId);
    this.states[ordinal] = "accepted";
    this.active -= 1;
    if (this.acceptedIds.length === this.states.length) {
      this.job = { ...this.job, status: "completed", completedAt: "2026-07-22T10:10:00.000Z" };
    }
    return {};
  }

  recoverInterruptedWork(): void {
    this.states.forEach((state, index) => {
      if (state === "running") this.states[index] = "queued";
    });
    this.active = 0;
    this.job = { ...this.job, status: "queued" };
  }

  async waitForAccepted(count: number): Promise<void> {
    while (this.acceptedIds.length < count) {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
  }
}

function untilAborted(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Cancelled", "AbortError"));
      return;
    }
    signal.addEventListener("abort", () => reject(new DOMException("Cancelled", "AbortError")), { once: true });
  });
}
