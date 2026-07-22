import { DurableScheduler, ExecutorRegistry, hashPlan, type ExecutorClaim, type ExecutorResult, type SchedulerPersistence, type StepExecutor } from "@ether/execution";
import type { ExecutionJob, ExecutionPlan, PayloadEnvelope } from "@ether/schema";
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
});

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
