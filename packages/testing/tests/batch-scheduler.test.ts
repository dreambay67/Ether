import {
  DurableScheduler,
  ExecutorFailure,
  ExecutorRegistry,
  hashPlan,
  providerConcurrencyGroup,
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
    expect(fixture.maximumActive).toBe(1);
  });

  it("runs real work concurrently up to the provider cap and gives each item a distinct effective prompt", async () => {
    const fixture = new ConcurrentJobsFixture();
    const binding = providerBinding("codex-assistant", 2);
    const job = fixture.addJob("overlap", 4, binding, 4);
    const executor = new ControlledExecutor();
    const scheduler = fixture.scheduler(executor);

    const run = scheduler.run(job.id);
    await waitForExecutorActive(executor, 2, fixture);

    expect(executor.maximumActive).toBe(2);
    expect([...executor.prompts.values()].sort()).toEqual([
      "Base instruction\n\nBatch item:\n- variant: \"overlap-0\"",
      "Base instruction\n\nBatch item:\n- variant: \"overlap-1\""
    ]);
    expect([...executor.contexts.values()]).toEqual(expect.arrayContaining([
      expect.objectContaining({ batchItem: { variant: "overlap-0" } }),
      expect.objectContaining({ batchItem: { variant: "overlap-1" } })
    ]));

    executor.release();
    await run;
    expect(executor.maximumActive).toBe(2);
    expect((await fixture.getJob(job.id))?.status).toBe("completed");
  });

  it("shares provider-family capacity across jobs and treats an unknown cap as one", async () => {
    const fixture = new ConcurrentJobsFixture();
    const codex = providerBinding("codex-assistant");
    const antigravity = providerBinding("google-nano-banana-2", 2);
    const jobs = [
      fixture.addJob("codex-a", 2, codex, 2),
      fixture.addJob("codex-b", 2, codex, 2),
      fixture.addJob("antigravity-a", 2, antigravity, 2),
      fixture.addJob("antigravity-b", 2, antigravity, 2)
    ];
    const executor = new ControlledExecutor();
    const scheduler = fixture.scheduler(executor);

    const runs = jobs.map((job) => scheduler.run(job.id));
    await executor.waitForActive(3);

    expect(executor.activeByProvider.get("codex")).toBe(1);
    expect(executor.activeByProvider.get("antigravity")).toBe(2);
    expect(executor.maximumByProvider.get("codex")).toBe(1);
    expect(executor.maximumByProvider.get("antigravity")).toBe(2);

    executor.release();
    await Promise.all(runs);
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
    const override = providerBinding("google-nano-banana-2");
    const job = fixture.addJob("override", 2, stepBinding, 2, override);
    const executor = new ControlledExecutor();
    const resolved: string[] = [];
    const scheduler = fixture.scheduler(executor, (providerId) => resolved.push(providerId));

    const run = scheduler.run(job.id);
    await executor.waitForActive(1);
    await nextTurn();

    expect(executor.maximumActive).toBe(1);
    expect(resolved).toEqual(["google-nano-banana-2"]);
    executor.release();
    await run;
    expect(resolved).toEqual(["google-nano-banana-2", "google-nano-banana-2"]);
  });

  it("cancels a claim waiting for provider-family capacity without disturbing the active sibling", async () => {
    const fixture = new ConcurrentJobsFixture();
    const binding = providerBinding("codex-assistant");
    const activeJob = fixture.addJob("cancel-active", 1, binding, 1);
    const waitingJob = fixture.addJob("cancel-waiting", 1, binding, 1);
    const executor = new ControlledExecutor();
    const scheduler = fixture.scheduler(executor);

    const activeRun = scheduler.run(activeJob.id);
    await executor.waitForActive(1);
    const waitingRun = scheduler.run(waitingJob.id);
    await fixture.waitForState(waitingJob.id, "running");

    await scheduler.cancel(waitingJob.id, "cancel-waiting-command");
    await waitingRun;
    expect(executor.active).toBe(1);
    expect((await fixture.getJob(waitingJob.id))?.status).toBe("cancelled");

    executor.release();
    await activeRun;
  });

  it("retains scheduler ownership of in-flight siblings after one item fails", async () => {
    const fixture = new ConcurrentJobsFixture();
    const job = fixture.addJob("failure", 3, providerBinding("codex-assistant", 2), 2);
    const executor = new ControlledExecutor({ failOrdinal: 0, failAfterActive: 2 });
    const scheduler = fixture.scheduler(executor);

    const run = scheduler.run(job.id);
    await fixture.waitForState(job.id, "failed");
    let settled = false;
    void run.then(() => { settled = true; });
    await nextTurn();

    expect(settled).toBe(false);
    expect(executor.active).toBe(1);
    expect(scheduler.run(job.id)).toBe(run);
    expect(fixture.claimed(job.id)).toBe(2);

    executor.release();
    await run;
    expect(fixture.claimed(job.id)).toBe(2);
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

  constructor(private readonly options: { failOrdinal?: number; failAfterActive?: number } = {}) {
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
      if (context.plannedWorkItem.ordinal === this.options.failOrdinal) {
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

  scheduler(executor: StepExecutor, onResolved?: (providerId: string) => void): DurableScheduler {
    return new DurableScheduler({
      appDataRoot: "C:\\EtherTest",
      persistence: this,
      executors: new ExecutorRegistry([executor]),
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
      requestedParallelism: 1,
      effectiveParallelism: 1,
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
