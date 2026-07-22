import {
  ArtifactSchema,
  ApplicationEventSchema,
  canonicalPlanJson,
  ExecutionAttemptSchema,
  ExecutionJobSchema,
  ExecutionPlanSchema,
  ExecutionWorkItemSchema,
  NodeOutputVersionSchema,
  PayloadEnvelopeSchema,
  ProviderCapabilitySchema,
  type Artifact,
  type ApplicationEvent,
  type ApplicationEventName,
  type ExecutionAttempt,
  type ExecutionJob,
  type ExecutionPlan,
  type ExecutionWorkItem,
  type NodeOutputVersion,
  type PayloadEnvelope,
  type ProviderCompletionRecovery,
  type ProviderCapability
} from "@ether/schema";
import { createHash } from "node:crypto";

import { ArtifactRepository } from "./artifacts.js";
import { BlobRepository } from "./blobs.js";
import type { RepositoryTransactionContext } from "./graphs.js";
import { OutputRepository } from "./outputs.js";

type JobRow = {
  job_id: string;
  plan_id: string;
  plan_content_hash: string;
  requested_parallelism: number;
  effective_parallelism: number;
  status: string;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  cancellation_requested_at: string | null;
};

type WorkRow = {
  work_item_id: string;
  job_id: string;
  planned_work_item_id: string;
  status: string;
  accepted_attempt_id: string | null;
  created_at: string;
  updated_at: string;
};

type AttemptRow = {
  attempt_id: string;
  work_item_id: string;
  attempt_number: number;
  status: string;
  provider_run_id: string | null;
  output_version_ids_json: string;
  error_json: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
};

export type ClaimedExecution = {
  plan: ExecutionPlan;
  job: ExecutionJob;
  workItem: ExecutionWorkItem;
  attempt: ExecutionAttempt;
  providerAttemptId: string;
};

export type ProviderRunSnapshot = {
  id: string;
  providerId: string;
  modelId: string;
  status: string;
  request: Record<string, unknown>;
  response: Record<string, unknown> | null;
  metadata: Record<string, unknown>;
  startedAt: string;
  completedAt: string | null;
};

export type ArtifactLineageSnapshot = {
  artifact: Artifact;
  outputVersion: NodeOutputVersion;
  providerRun: ProviderRunSnapshot;
  relations: Array<Record<string, unknown>>;
};

export type ProviderCompletionIntentSnapshot = {
  state: "prepared" | "staged" | "accepted";
  completion: ProviderCompletionRecovery;
  stagingPath: string;
};

export type PendingApplicationEvent = {
  name: ApplicationEventName;
  payload: Record<string, unknown>;
  occurredAt?: string;
};

export type CompletionOutput = {
  artifacts?: Artifact[];
  payloads: PayloadEnvelope[];
  version: NodeOutputVersion;
};

export type AdapterIntermediateCompletion = {
  adapterId: string;
  id?: string;
  inputPayloadIds: string[];
  metadata?: Record<string, unknown>;
  outputPayloadIds: string[];
};

export type CompletionAcceptance = {
  artifacts: Artifact[];
  outputVersions: NodeOutputVersion[];
  providerRun: ProviderRunSnapshot | null;
};

export type ReviewCheckpoint = {
  completedAt: string | null;
  completion: Record<string, unknown> | null;
  id: string;
  planId: string;
  selectedOutputVersionIds: string[];
  state: "waiting-review" | "completed" | "rejected" | "needs-attention" | "cancelled";
  stepId: string;
  workItemId: string | null;
};

export type ExecutionTimelineEvent = {
  attemptId: string | null;
  eventName: string;
  id: string;
  occurredAt: string;
  payload: Record<string, unknown>;
  state: string;
  workItemId: string | null;
};

export type ExecutionJobSummary = {
  attempts: number;
  job: ExecutionJob;
  workItems: Record<string, number>;
};

export type ExecutionRepositorySnapshot = {
  attempts: ExecutionAttempt[];
  job: ExecutionJob;
  summary: ExecutionJobSummary;
  timeline: ExecutionTimelineEvent[];
  workItems: ExecutionWorkItem[];
};

export class ExecutionRepositoryError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ExecutionRepositoryError";
    this.code = code;
  }
}

export class ExecutionRepository {
  constructor(private readonly context: RepositoryTransactionContext) {}

  getCommandResult(commandId: string, commandName: string): Record<string, unknown> | undefined {
    if (typeof commandId !== "string" || commandId.length === 0) {
      throw new ExecutionRepositoryError(
        "COMMAND_ID_INVALID",
        `Command ID must be a non-empty string; received ${String(commandId)}.`
      );
    }
    const receipt = this.commandReceipt(commandId);
    if (receipt === undefined) return undefined;
    if (receipt.commandName !== commandName) {
      throw new ExecutionRepositoryError(
        "COMMAND_ID_CONFLICT",
        `Command ID ${commandId} was already used for ${receipt.commandName}.`
      );
    }
    return receipt.result;
  }

  completeCommand(
    commandId: string,
    commandName: string,
    result: Record<string, unknown>,
    events: readonly PendingApplicationEvent[] = []
  ): Record<string, unknown> {
    const existing = this.getCommandResult(commandId, commandName);
    if (existing !== undefined) return existing;
    const occurredAt = this.context.now();
    this.saveCommandReceipt(commandId, commandName, result);
    for (const event of events) {
      this.recordOutbox(event.name, commandId, event.payload, event.occurredAt ?? occurredAt);
    }
    return result;
  }

  listPendingEvents(): ApplicationEvent[] {
    const rows = this.context.database
      .prepare(
        `SELECT event_id, event_name, correlation_id, payload_json, occurred_at
         FROM event_outbox WHERE delivered_at IS NULL ORDER BY occurred_at, rowid`
      )
      .all() as unknown as Array<{
        event_id: string;
        event_name: string;
        correlation_id: string;
        payload_json: string;
        occurred_at: string;
      }>;
    const documentId = this.documentId();
    return rows.map((row) => ApplicationEventSchema.parse({
      kind: "event",
      id: row.event_id,
      correlationId: row.correlation_id,
      name: row.event_name,
      documentId,
      occurredAt: row.occurred_at,
      payload: JSON.parse(row.payload_json) as unknown
    }));
  }

  markEventDelivered(eventId: string): boolean {
    return this.context.database
      .prepare("UPDATE event_outbox SET delivered_at = ? WHERE event_id = ? AND delivered_at IS NULL")
      .run(this.context.now(), eventId).changes === 1;
  }

  savePlan(input: ExecutionPlan): ExecutionPlan {
    const plan = ExecutionPlanSchema.parse(input);
    if (!verifyPlanContentHash(plan)) {
      throw new ExecutionRepositoryError("PLAN_HASH_INVALID", "The plan capsule does not match its content hash.");
    }
    this.context.database
      .prepare(
        `INSERT INTO execution_plans (
           plan_id, document_revision_id, graph_id, graph_revision_id, capsule_version,
           hash_version, content_hash, scope_json, capsule_json, status, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'previewed', ?, ?)`
      )
      .run(
        plan.id,
        plan.documentRevisionId,
        plan.graphId,
        plan.graphRevisionId,
        plan.capsuleVersion,
        plan.hashVersion,
        plan.contentHash,
        JSON.stringify(plan.scope),
        JSON.stringify(plan),
        plan.createdAt,
        plan.createdAt
      );
    const insertStep = this.context.database.prepare(
      `INSERT INTO plan_steps (
         step_id, plan_id, node_id, step_order, dependencies_json, config_json, status
       ) VALUES (?, ?, ?, ?, ?, ?, 'planned')`
    );
    plan.steps.forEach((step, index) =>
      insertStep.run(
        step.id,
        plan.id,
        step.nodeId,
        index,
        JSON.stringify(step.dependencyStepIds),
        JSON.stringify(step)
      )
    );
    return plan;
  }

  getPlan(planId: string): ExecutionPlan | undefined {
    const row = this.context.database
      .prepare("SELECT capsule_json FROM execution_plans WHERE plan_id = ?")
      .get(planId) as { capsule_json: string } | undefined;
    if (row === undefined) return undefined;
    const plan = ExecutionPlanSchema.parse(JSON.parse(row.capsule_json));
    if (!verifyPlanContentHash(plan)) {
      throw new ExecutionRepositoryError("PLAN_HASH_INVALID", "The persisted plan capsule does not match its content hash.");
    }
    return plan;
  }

  grantRunPermit(
    planId: string,
    contentHash: string,
    commandId: string
  ): { id: string; planId: string; contentHash: string } {
    const existing = this.getCommandResult(commandId, "permission.grantRun");
    if (existing !== undefined) {
      return {
        id: String(existing.id),
        planId: String(existing.planId),
        contentHash: String(existing.contentHash)
      };
    }
    const plan = this.getPlan(planId);
    if (plan === undefined || plan.contentHash !== contentHash) {
      throw new ExecutionRepositoryError("STALE_PLAN", "Run permit does not match a persisted plan capsule.");
    }
    const id = this.context.createId("permit");
    this.context.database
      .prepare(
        `INSERT INTO run_permits (permit_id, plan_id, content_hash, state, created_at, consumed_at)
         VALUES (?, ?, ?, 'granted', ?, NULL)`
      )
      .run(id, planId, contentHash, this.context.now());
    const permit = { id, planId, contentHash };
    this.completeCommand(commandId, "permission.grantRun", permit, [{
      name: "permission.changed",
      payload: { permitId: id, permission: "run", state: "granted" }
    }]);
    return permit;
  }

  startJob(input: {
    commandId: string;
    planId: string;
    contentHash: string;
    runPermitId: string;
  }): ExecutionJob {
    const receipt = this.getCommandResult(input.commandId, "run.start");
    if (receipt !== undefined) return ExecutionJobSchema.parse(receipt.job);
    const plan = this.getPlan(input.planId);
    if (plan === undefined || plan.contentHash !== input.contentHash) {
      throw new ExecutionRepositoryError("STALE_PLAN", "The persisted plan or content hash is no longer valid.");
    }
    const current = this.context.database
      .prepare(
        `SELECT d.document_id,
                ds.current_document_revision_id AS document_revision_id,
                gh.graph_revision_id AS graph_revision_id
         FROM document d
         JOIN document_state ds ON ds.singleton = d.singleton
         JOIN graph_heads gh ON gh.graph_id = ?
         WHERE d.singleton = 1`
      )
      .get(plan.graphId) as {
        document_id: string;
        document_revision_id: string;
        graph_revision_id: string;
      } | undefined;
    if (
      current === undefined ||
      current.document_id !== plan.documentId ||
      current.document_revision_id !== plan.documentRevisionId ||
      current.graph_revision_id !== plan.graphRevisionId
    ) {
      this.context.database
        .prepare("UPDATE execution_plans SET status = 'invalidated', updated_at = ? WHERE plan_id = ?")
        .run(this.context.now(), plan.id);
      throw new ExecutionRepositoryError("STALE_PLAN", "The document or graph revision changed after preview.");
    }
    const consumed = this.context.database
      .prepare(
        `UPDATE run_permits SET state = 'consumed', consumed_at = ?
         WHERE permit_id = ? AND plan_id = ? AND content_hash = ? AND state = 'granted'`
      )
      .run(this.context.now(), input.runPermitId, plan.id, plan.contentHash);
    if (consumed.changes !== 1) {
      throw new ExecutionRepositoryError("RUN_PERMIT_INVALID", "The run permit is missing, consumed, or mismatched.");
    }
    const existing = this.context.database
      .prepare("SELECT job_id FROM execution_jobs WHERE plan_id = ?")
      .get(plan.id) as { job_id: string } | undefined;
    if (existing !== undefined) {
      const job = this.requireJob(existing.job_id);
      this.completeCommand(input.commandId, "run.start", { job });
      return job;
    }
    const now = this.context.now();
    const jobId = this.context.createId("job");
    this.context.database
      .prepare(
        `INSERT INTO execution_jobs (
           job_id, plan_id, plan_content_hash, start_command_id, status, created_at,
           requested_parallelism, effective_parallelism, started_at, completed_at, cancellation_requested_at
         ) VALUES (?, ?, ?, ?, 'queued', ?, ?, ?, NULL, NULL, NULL)`
      )
      .run(
        jobId,
        plan.id,
        plan.contentHash,
        input.commandId,
        now,
        plan.requestedParallelism ?? 1,
        plan.effectiveParallelism ?? plan.requestedParallelism ?? 1
      );
    const queued: Array<{ workItemId: string; attemptId: string }> = [];
    const durableWorkItemIds = new Map<string, string>();
    for (const planned of plan.workItems) {
      const workItemId = this.context.createId("work");
      const attemptId = this.context.createId("attempt");
      this.context.database
        .prepare(
          `INSERT INTO work_items (
             work_item_id, job_id, step_id, planned_work_item_id, item_index, input_json,
             status, accepted_attempt_id, claim_token, claimed_at, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, 'queued', NULL, NULL, NULL, ?, ?)`
        )
        .run(
          workItemId,
          jobId,
          planned.stepId,
          planned.id,
          planned.ordinal,
          JSON.stringify(planned),
          now,
          now
        );
      this.context.database
        .prepare(
          `INSERT INTO attempts (
             attempt_id, work_item_id, attempt_number, provider_attempt_id, provider_run_id,
             status, output_version_ids_json, error_json, created_at, started_at, completed_at
           ) VALUES (?, ?, 1, ?, NULL, 'queued', '[]', NULL, ?, NULL, NULL)`
      )
        .run(attemptId, workItemId, `${jobId}:${workItemId}:1`, now);
      durableWorkItemIds.set(planned.id, workItemId);
      queued.push({ workItemId, attemptId });
    }
    const dependency = this.context.database.prepare(
      `INSERT INTO work_item_dependencies (work_item_id, dependency_work_item_id)
       VALUES (?, ?)`
    );
    for (const planned of plan.workItems) {
      const workItemId = durableWorkItemIds.get(planned.id)!;
      for (const dependencyPlannedId of planned.dependencyWorkItemIds ?? []) {
        const dependencyWorkItemId = durableWorkItemIds.get(dependencyPlannedId);
        if (dependencyWorkItemId === undefined) {
          throw new ExecutionRepositoryError(
            "PLAN_CORRUPT",
            `Work item ${planned.id} depends on unknown work item ${dependencyPlannedId}.`
          );
        }
        dependency.run(workItemId, dependencyWorkItemId);
      }
    }
    const planStarted = this.context.database
      .prepare(
        "UPDATE execution_plans SET status = 'started', updated_at = ? WHERE plan_id = ? AND status = 'previewed'"
      )
      .run(now, plan.id);
    if (planStarted.changes !== 1) {
      throw new ExecutionRepositoryError("TRANSITION_CONFLICT", "Plan is no longer previewed.");
    }
    const job = this.requireJob(jobId);
    this.completeCommand(input.commandId, "run.start", { job }, [
      { name: "plan.stateChanged", payload: { planId: plan.id, state: "started" } },
      { name: "job.stateChanged", payload: { jobId, state: "queued" } },
      ...queued.flatMap(({ workItemId, attemptId }): PendingApplicationEvent[] => [
        {
          name: "workItem.stateChanged",
          payload: { jobId, workItemId, state: "queued" }
        },
        {
          name: "attempt.stateChanged",
          payload: { jobId, workItemId, attemptId, state: "queued" }
        }
      ])
    ]);
    return job;
  }

  claimNext(jobId: string, claimToken: string): ClaimedExecution | undefined {
    const row = this.context.database
      .prepare(
        `SELECT w.work_item_id, a.attempt_id, a.provider_attempt_id
         FROM work_items w
         JOIN attempts a ON a.work_item_id = w.work_item_id
         JOIN execution_jobs j ON j.job_id = w.job_id
         WHERE w.job_id = ? AND w.status = 'queued' AND a.status = 'queued'
           AND j.status IN ('queued', 'running') AND j.cancellation_requested_at IS NULL
           AND NOT EXISTS (
             SELECT 1 FROM work_item_dependencies d
             JOIN work_items dependency ON dependency.work_item_id = d.dependency_work_item_id
             WHERE d.work_item_id = w.work_item_id AND dependency.status <> 'accepted'
           )
         ORDER BY w.item_index, a.attempt_number DESC LIMIT 1`
      )
      .get(jobId) as
      | { work_item_id: string; attempt_id: string; provider_attempt_id: string }
      | undefined;
    if (row === undefined) return undefined;
    const now = this.context.now();
    const claimed = this.context.database
      .prepare(
        `UPDATE work_items SET status = 'running', claim_token = ?, claimed_at = ?, updated_at = ?
         WHERE work_item_id = ? AND status = 'queued'`
      )
      .run(claimToken, now, now, row.work_item_id);
    if (claimed.changes !== 1) return undefined;
    const attemptClaimed = this.context.database
      .prepare(
        `UPDATE attempts SET status = 'running', started_at = ?
         WHERE attempt_id = ? AND status = 'queued'`
      )
      .run(now, row.attempt_id);
    if (attemptClaimed.changes !== 1) {
      throw new ExecutionRepositoryError("CLAIM_CONFLICT", "Attempt claim changed during dispatch.");
    }
    this.context.database
      .prepare(
        `UPDATE execution_jobs SET status = 'running', started_at = coalesce(started_at, ?)
         WHERE job_id = ? AND status IN ('queued', 'running')`
      )
      .run(now, jobId);
    const job = this.requireJob(jobId);
    this.recordOutbox("job.stateChanged", row.attempt_id, { jobId, state: "running" }, now);
    this.recordOutbox("workItem.stateChanged", row.attempt_id, {
      jobId,
      workItemId: row.work_item_id,
      state: "running"
    }, now);
    this.recordOutbox("attempt.stateChanged", row.attempt_id, {
      jobId,
      workItemId: row.work_item_id,
      attemptId: row.attempt_id,
      state: "running"
    }, now);
    return {
      plan: this.requirePlanForJob(jobId),
      job,
      workItem: this.requireWorkItem(row.work_item_id),
      attempt: this.requireAttempt(row.attempt_id),
      providerAttemptId: row.provider_attempt_id
    };
  }

  prepareProviderCompletion(
    completion: ProviderCompletionRecovery,
    stagingPath: string
  ): ProviderCompletionIntentSnapshot {
    const current = this.getProviderCompletion(completion.attemptId);
    if (current !== undefined) {
      if (current.completion.providerAttemptId !== completion.providerAttemptId) {
        throw new ExecutionRepositoryError(
          "PROVIDER_ATTEMPT_CONFLICT",
          "The attempt already has a different durable provider completion identity."
        );
      }
      return current;
    }
    const attempt = this.requireAttempt(completion.attemptId);
    if (attempt.status !== "running") {
      throw new ExecutionRepositoryError("TRANSITION_CONFLICT", "Only a running attempt can prepare completion.");
    }
    const now = this.context.now();
    this.context.database
      .prepare(
        `INSERT INTO provider_completion_intents (
           attempt_id, provider_attempt_id, state, expected_output_count, identifiers_json,
           completion_json, staging_path, created_at, updated_at, accepted_at
         ) VALUES (?, ?, 'prepared', ?, ?, NULL, ?, ?, ?, NULL)`
      )
      .run(
        completion.attemptId,
        completion.providerAttemptId,
        completion.expectedOutputCount,
        JSON.stringify(completion),
        stagingPath,
        now,
        now
      );
    return { state: "prepared", completion, stagingPath };
  }

  stageProviderCompletion(completion: ProviderCompletionRecovery): ProviderCompletionIntentSnapshot {
    const staged = this.context.database
      .prepare(
        `UPDATE provider_completion_intents
         SET state = 'staged', completion_json = ?, updated_at = ?
         WHERE attempt_id = ? AND provider_attempt_id = ? AND state IN ('prepared', 'staged')`
      )
      .run(
        JSON.stringify(completion),
        this.context.now(),
        completion.attemptId,
        completion.providerAttemptId
      );
    if (staged.changes !== 1) {
      const current = this.getProviderCompletion(completion.attemptId);
      if (current?.state === "accepted") return current;
      throw new ExecutionRepositoryError("TRANSITION_CONFLICT", "Provider completion intent is not stageable.");
    }
    return {
      state: "staged",
      completion,
      stagingPath: this.requireCompletionStagingPath(completion.attemptId)
    };
  }

  getProviderCompletion(attemptId: string): ProviderCompletionIntentSnapshot | undefined {
    const row = this.context.database
      .prepare(
        `SELECT state, identifiers_json, completion_json, staging_path
         FROM provider_completion_intents WHERE attempt_id = ?`
      )
      .get(attemptId) as
      | {
          state: "prepared" | "staged" | "accepted";
          identifiers_json: string;
          completion_json: string | null;
          staging_path: string;
        }
      | undefined;
    if (row === undefined) return undefined;
    return {
      state: row.state,
      completion: JSON.parse(row.completion_json ?? row.identifiers_json) as ProviderCompletionRecovery,
      stagingPath: row.staging_path
    };
  }

  discardProviderCompletion(attemptId: string): boolean {
    return this.context.database
      .prepare(
        "DELETE FROM provider_completion_intents WHERE attempt_id = ? AND state IN ('prepared', 'staged')"
      )
      .run(attemptId).changes === 1;
  }

  quarantineForeignDocumentPlans(): string[] {
    const documentId = this.documentId();
    const jobs = this.context.database
      .prepare(
        `SELECT j.job_id, j.plan_id
         FROM execution_jobs j
         JOIN execution_plans p ON p.plan_id = j.plan_id
         WHERE json_extract(p.capsule_json, '$.documentId') <> ?
           AND j.status IN ('planned', 'queued', 'running')
         ORDER BY j.created_at, j.job_id`
      )
      .all(documentId) as unknown as Array<{ job_id: string; plan_id: string }>;
    const now = this.context.now();
    for (const { job_id: jobId, plan_id: planId } of jobs) {
      const plan = this.requirePlanForJob(jobId);
      const active = this.context.database
        .prepare(
          `SELECT w.work_item_id, a.attempt_id
           FROM work_items w
           JOIN attempts a ON a.work_item_id = w.work_item_id
           WHERE w.job_id = ? AND w.status IN ('queued', 'running')
             AND a.status IN ('queued', 'running')
           ORDER BY w.item_index, a.attempt_number`
        )
        .all(jobId) as unknown as Array<{ work_item_id: string; attempt_id: string }>;
      const jobChanged = this.context.database
        .prepare(
          `UPDATE execution_jobs
           SET status = 'needs-attention', started_at = coalesce(started_at, ?), completed_at = ?
           WHERE job_id = ? AND status IN ('planned', 'queued', 'running')`
        )
        .run(now, now, jobId);
      if (jobChanged.changes !== 1) continue;
      const failure = JSON.stringify({
        code: "STALE_PLAN",
        message: `Plan belongs to document ${plan.documentId}, not ${documentId}.`,
        retryable: false,
        details: { documentId }
      });
      const attemptsChanged = this.context.database
        .prepare(
          `UPDATE attempts
           SET status = 'failed', error_json = ?, started_at = coalesce(started_at, ?), completed_at = ?
           WHERE work_item_id IN (SELECT work_item_id FROM work_items WHERE job_id = ?)
             AND status IN ('queued', 'running')`
        )
        .run(failure, now, now, jobId);
      const workChanged = this.context.database
        .prepare(
          `UPDATE work_items SET status = 'failed', updated_at = ?
           WHERE job_id = ? AND status IN ('queued', 'running')`
        )
        .run(now, jobId);
      if (
        attemptsChanged.changes !== active.length ||
        workChanged.changes !== new Set(active.map((row) => row.work_item_id)).size
      ) {
        throw new ExecutionRepositoryError(
          "TRANSITION_CONFLICT",
          "Foreign-document quarantine did not own every active execution transition."
        );
      }
      this.context.database
        .prepare(
          `DELETE FROM provider_completion_intents
           WHERE attempt_id IN (
             SELECT a.attempt_id FROM attempts a
             JOIN work_items w ON w.work_item_id = a.work_item_id
             WHERE w.job_id = ? AND a.status = 'failed'
           )`
        )
        .run(jobId);
      const planChanged = this.context.database
        .prepare(
          "UPDATE execution_plans SET status = 'invalidated', updated_at = ? WHERE plan_id = ? AND status IN ('previewed', 'started')"
        )
        .run(now, planId);
      for (const { work_item_id: workItemId, attempt_id: attemptId } of active) {
        this.recordOutbox("attempt.stateChanged", `copy-quarantine:${attemptId}`, {
          jobId,
          workItemId,
          attemptId,
          state: "failed"
        }, now);
        this.recordOutbox("workItem.stateChanged", `copy-quarantine:${attemptId}`, {
          jobId,
          workItemId,
          state: "failed"
        }, now);
      }
      this.recordOutbox("job.stateChanged", `copy-quarantine:${jobId}`, {
        jobId,
        state: "needs-attention"
      }, now);
      if (planChanged.changes === 1) {
        this.recordOutbox("plan.stateChanged", `copy-quarantine:${jobId}`, {
          planId,
          state: "invalidated"
        }, now);
      }
    }
    return jobs.map((job) => job.job_id);
  }

  getClaimForAttempt(attemptId: string): ClaimedExecution | undefined {
    const row = this.context.database
      .prepare(
        `SELECT w.job_id, w.work_item_id, a.provider_attempt_id
         FROM attempts a JOIN work_items w ON w.work_item_id = a.work_item_id
         WHERE a.attempt_id = ?`
      )
      .get(attemptId) as
      | { job_id: string; work_item_id: string; provider_attempt_id: string }
      | undefined;
    if (row === undefined) return undefined;
    return {
      plan: this.requirePlanForJob(row.job_id),
      job: this.requireJob(row.job_id),
      workItem: this.requireWorkItem(row.work_item_id),
      attempt: this.requireAttempt(attemptId),
      providerAttemptId: row.provider_attempt_id
    };
  }

  acceptCompletion(input: {
    adapterIntermediates?: AdapterIntermediateCompletion[];
    artifacts?: Artifact[];
    claim: ClaimedExecution;
    effects?: Array<Record<string, unknown>>;
    outputs: CompletionOutput[];
  }): CompletionAcceptance {
    const existing = this.acceptedCompletion(input.claim);
    if (existing !== undefined) {
      this.assertAcceptedOutputIds(existing.outputVersions, input.outputs.map((output) => output.version.id));
      return existing;
    }
    this.assertClaimRunning(input.claim);
    if (input.outputs.length === 0) {
      throw new ExecutionRepositoryError("EMPTY_COMPLETION", "Accepted work must create at least one immutable output.");
    }
    const outputs = new OutputRepository(this.context);
    const artifacts = new ArtifactRepository(this.context);
    const acceptedOutputVersions: NodeOutputVersion[] = [];
    const acceptedArtifacts: Artifact[] = [];
    const seenArtifacts = new Set<string>();
    for (const output of input.outputs) {
      const version = NodeOutputVersionSchema.parse(output.version);
      if (
        version.runId !== input.claim.job.id ||
        version.workItemId !== input.claim.workItem.id ||
        version.attemptId !== input.claim.attempt.id
      ) {
        throw new ExecutionRepositoryError(
          "OUTPUT_PROVENANCE_MISMATCH",
          "Completion output provenance must identify the claimed job, work item, and attempt."
        );
      }
      outputs.insert(version, output.payloads);
      acceptedOutputVersions.push(version);
      for (const artifact of output.artifacts ?? []) {
        if (!seenArtifacts.has(artifact.id)) {
          artifacts.attach(artifact);
          seenArtifacts.add(artifact.id);
          acceptedArtifacts.push(artifact);
        }
      }
    }
    for (const artifact of input.artifacts ?? []) {
      if (!seenArtifacts.has(artifact.id)) {
        artifacts.attach(artifact);
        seenArtifacts.add(artifact.id);
        acceptedArtifacts.push(artifact);
      }
    }
    this.persistAdapterIntermediates(input.claim, input.adapterIntermediates ?? []);
    return this.finishAcceptedCompletion({
      claim: input.claim,
      artifacts: acceptedArtifacts,
      effects: input.effects ?? [],
      outputVersions: acceptedOutputVersions,
      providerRunId: null,
      acceptedAt: this.context.now()
    });
  }

  acceptProviderOutput(input: {
    claim: ClaimedExecution;
    identifiers: {
      providerRunId: string;
      capabilitySnapshotId: string;
      acceptedAt: string;
    };
    outputs: Array<{
      artifactId: string;
      outputVersionId: string;
      payloadId: string;
      importId: string;
      artifactMetadata: Record<string, unknown>;
      bytes: Uint8Array;
      fileName: string;
      mediaType: string;
    }>;
    providerId: string;
    modelId: string;
    capabilitySnapshot: ProviderCapability;
    request: Record<string, unknown>;
    response: Record<string, unknown>;
    metadata: Record<string, unknown>;
  }): { artifacts: Artifact[]; outputVersions: NodeOutputVersion[]; providerRun: ProviderRunSnapshot } {
    const accepted = this.acceptedCompletion(input.claim);
    if (accepted !== undefined) {
      this.assertAcceptedOutputIds(accepted.outputVersions, input.outputs.map((output) => output.outputVersionId));
      if (accepted.providerRun === null || accepted.providerRun.id !== input.identifiers.providerRunId) {
        throw new ExecutionRepositoryError(
          "PROVIDER_ATTEMPT_CONFLICT",
          "The attempt was already accepted with a different provider run."
        );
      }
      return { ...accepted, providerRun: accepted.providerRun };
    }
    const current = this.context.database
      .prepare(
        `SELECT w.status AS work_status, a.status AS attempt_status,
                j.cancellation_requested_at
         FROM work_items w JOIN attempts a ON a.work_item_id = w.work_item_id
         JOIN execution_jobs j ON j.job_id = w.job_id
         WHERE w.work_item_id = ? AND a.attempt_id = ?`
      )
      .get(input.claim.workItem.id, input.claim.attempt.id) as
      | { work_status: string; attempt_status: string; cancellation_requested_at: string | null }
      | undefined;
    if (
      current?.work_status !== "running" ||
      current.attempt_status !== "running" ||
      current.cancellation_requested_at !== null
    ) {
      throw new ExecutionRepositoryError("CANCELLED", "Provider completion lost the cancellation race.");
    }
    const step = input.claim.plan.steps.find((candidate) => candidate.id === input.claim.workItem.plannedWorkItemId.split(":")[0])
      ?? input.claim.plan.steps.find((candidate) => candidate.workItemIds.includes(input.claim.workItem.plannedWorkItemId));
    if (step === undefined) throw new ExecutionRepositoryError("PLAN_CORRUPT", "Claimed plan step is missing.");
    if (input.providerId !== step.provider.providerId) {
      throw new ExecutionRepositoryError(
        "PROVIDER_MISMATCH",
        `Completion provider ${input.providerId} does not match persisted provider ${step.provider.providerId}.`
      );
    }
    const expectedOutputCount = Number(step.provider.settings.outputCount ?? 1);
    if (input.outputs.length !== expectedOutputCount) {
      throw new ExecutionRepositoryError(
        "PROVIDER_OUTPUT_COUNT_MISMATCH",
        `Provider returned ${input.outputs.length} artifacts; the persisted plan requires ${expectedOutputCount}.`
      );
    }
    const now = input.identifiers.acceptedAt;
    const capability = ProviderCapabilitySchema.parse(input.capabilitySnapshot);
    const capabilitySnapshotId = input.identifiers.capabilitySnapshotId;
    const providerRunId = input.identifiers.providerRunId;
    this.context.database
      .prepare(
        `INSERT INTO provider_capability_snapshots (
           capability_snapshot_id, provider_id, profile_id, model_id, capability_json, captured_at
         ) VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        capabilitySnapshotId,
        input.providerId,
        capability.profileId,
        input.modelId,
        JSON.stringify(capability),
        now
      );
    this.context.database
      .prepare(
        `INSERT INTO provider_runs (
           provider_run_id, capability_snapshot_id, plan_id, step_id, work_item_id, attempt_id,
           provider_attempt_id, provider_id, model_id, status, request_json, response_json,
           metadata_json, started_at, completed_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?)`
      )
      .run(
        providerRunId,
        capabilitySnapshotId,
        input.claim.plan.id,
        step.id,
        input.claim.workItem.id,
        input.claim.attempt.id,
        input.claim.providerAttemptId,
        input.providerId,
        input.modelId,
        JSON.stringify(input.request),
        JSON.stringify(input.response),
        JSON.stringify(input.metadata),
        input.claim.attempt.startedAt,
        now
      );
    const blobs = new BlobRepository(this.context);
    const outputs = new OutputRepository(this.context);
    const artifactsRepository = new ArtifactRepository(this.context);
    const acceptedArtifacts: Artifact[] = [];
    const acceptedOutputVersions: NodeOutputVersion[] = [];
    for (const output of input.outputs) {
      const contentKey = createHash("sha256").update(output.bytes).digest("hex");
      const ownership = blobs.beginImport({
        importId: output.importId,
        contentKey,
        byteLength: output.bytes.byteLength,
        mediaType: output.mediaType,
        sourceName: output.fileName
      });
      if (ownership === "owner") {
        blobs.writeInline(output.importId, contentKey, output.bytes);
        blobs.finalize(output.importId, contentKey);
      } else if (ownership !== "ready") {
        throw new ExecutionRepositoryError("BLOB_IMPORT_BUSY", "An incomplete duplicate blob import exists.");
      }
      const outputVersion = NodeOutputVersionSchema.parse({
        id: output.outputVersionId,
        nodeId: step.nodeId,
        graphId: input.claim.plan.graphId,
        graphRevisionId: input.claim.plan.graphRevisionId,
        inputPayloadIds: [],
        selectedOutputVersionIds: [],
        compiledContextHash: input.claim.plan.contentHash,
        producer: {
          kind: "provider",
          providerId: input.providerId,
          modelId: input.modelId,
          profileId: capability.profileId,
          capabilitySnapshot: capability
        },
        outputPayloadIds: [output.payloadId],
        parentOutputVersionId: null,
        approval: { state: "unreviewed" },
        runId: input.claim.job.id,
        stepId: step.id,
        workItemId: input.claim.workItem.id,
        attemptId: input.claim.attempt.id,
        timing: { startedAt: input.claim.attempt.startedAt, completedAt: now },
        failure: null,
        createdAt: now
      });
      const payload = PayloadEnvelopeSchema.parse({
        id: output.payloadId,
        channel: "image",
        role: "subject",
        content: { kind: "artifact", artifactId: output.artifactId },
        source: {
          nodeId: step.nodeId,
          outputVersionId: output.outputVersionId,
          lineageKey: `${input.claim.plan.graphId}:${step.nodeId}:${input.claim.workItem.id}:${acceptedArtifacts.length}`
        },
        metadata: { mediaType: output.mediaType, providerRunId }
      });
      outputs.insert(outputVersion, [payload]);
      const artifact = ArtifactSchema.parse({
        id: output.artifactId,
        contentKey,
        channel: "image",
        mediaType: output.mediaType,
        byteLength: output.bytes.byteLength,
        source: { outputVersionId: output.outputVersionId, payloadId: output.payloadId },
        createdAt: now,
        metadata: output.artifactMetadata
      });
      artifactsRepository.attach(artifact);
      acceptedArtifacts.push(artifact);
      acceptedOutputVersions.push(outputVersion);
    }
    this.context.database
      .prepare(
        `UPDATE provider_completion_intents SET state = 'accepted', accepted_at = ?, updated_at = ?
         WHERE attempt_id = ? AND state IN ('prepared', 'staged')`
      )
      .run(now, now, input.claim.attempt.id);
    const completion = this.finishAcceptedCompletion({
      claim: input.claim,
      artifacts: acceptedArtifacts,
      outputVersions: acceptedOutputVersions,
      providerRunId,
      effects: [],
      acceptedAt: now
    });
    return { ...completion, providerRun: completion.providerRun! };
  }

  createReviewCheckpoint(input: {
    checkpointId?: string;
    claim?: ClaimedExecution;
    minimumSelections?: number;
    planId?: string;
    selectedOutputVersionIds?: string[];
    selectionMode?: "one" | "many";
    stepId?: string;
    workItemId?: string;
  }): ReviewCheckpoint {
    const workItemId = input.workItemId ?? input.claim?.workItem.id;
    if (workItemId === undefined) {
      throw new ExecutionRepositoryError("WORK_NOT_FOUND", "Review checkpoints require a claimed work item.");
    }
    const existing = this.context.database
      .prepare(
        `SELECT checkpoint_id FROM review_checkpoints
         WHERE work_item_id = ? AND state = 'waiting-review' ORDER BY created_at DESC LIMIT 1`
      )
      .get(workItemId) as { checkpoint_id: string } | undefined;
    if (existing !== undefined) return this.requireReviewCheckpoint(existing.checkpoint_id);
    const work = this.requireWorkItem(workItemId);
    const plan = this.requirePlanForJob(work.jobId);
    const planId = input.planId ?? input.claim?.plan.id;
    if (planId !== plan.id) {
      throw new ExecutionRepositoryError("CHECKPOINT_PLAN_MISMATCH", "Review checkpoint belongs to a different plan.");
    }
    const workRow = this.context.database
      .prepare("SELECT step_id FROM work_items WHERE work_item_id = ?")
      .get(workItemId) as { step_id: string } | undefined;
    const stepId = input.stepId ?? workRow?.step_id;
    if (workRow === undefined || stepId !== workRow.step_id || work.status !== "running") {
      throw new ExecutionRepositoryError("TRANSITION_CONFLICT", "Only running work can wait for review.");
    }
    const selectedOutputVersionIds = input.selectedOutputVersionIds ?? [];
    for (const outputVersionId of selectedOutputVersionIds) this.requireOutputVersion(outputVersionId);
    const now = this.context.now();
    const checkpointId = input.checkpointId ?? this.context.createId("review-checkpoint");
    this.context.database
      .prepare(
        `INSERT INTO review_checkpoints (
           checkpoint_id, plan_id, step_id, work_item_id, state, selected_output_version_ids_json,
           completion_json, created_at, completed_at
         ) VALUES (?, ?, ?, ?, 'waiting-review', ?, NULL, ?, NULL)`
      )
      .run(checkpointId, plan.id, stepId, workItemId, JSON.stringify(selectedOutputVersionIds), now);
    const waiting = this.context.database
      .prepare(
        `UPDATE work_items SET status = 'waiting-review', updated_at = ?
         WHERE work_item_id = ? AND status = 'running'`
      )
      .run(now, workItemId);
    if (waiting.changes !== 1) {
      throw new ExecutionRepositoryError("TRANSITION_CONFLICT", "Review checkpoint lost the work transition race.");
    }
    this.recomputeJob(work.jobId, now);
    this.recordTimeline({
      jobId: work.jobId,
      workItemId: work.id,
      attemptId: this.runningAttemptId(work.id),
      eventName: "review.waiting",
      state: "waiting-review",
      payload: { checkpointId, selectedOutputVersionIds },
      occurredAt: now
    });
    this.recordOutbox("workItem.stateChanged", checkpointId, {
      jobId: work.jobId,
      workItemId: work.id,
      state: "waiting-review"
    }, now);
    this.recordOutbox("job.stateChanged", checkpointId, {
      jobId: work.jobId,
      state: this.requireJob(work.jobId).status
    }, now);
    return this.requireReviewCheckpoint(checkpointId);
  }

  createCompareCheckpoint(input: {
    checkpointId?: string;
    claim?: ClaimedExecution;
    minimumSelections?: number;
    planId?: string;
    selectedOutputVersionIds?: string[];
    selectionMode?: "one" | "many";
    stepId?: string;
    workItemId?: string;
  }): ReviewCheckpoint {
    return this.createReviewCheckpoint(input);
  }

  completeReviewCheckpoint(input: {
    checkpointId: string;
    completion?: Record<string, unknown>;
    selectedOutputVersionIds: string[];
  }): ReviewCheckpoint {
    const checkpoint = this.requireReviewCheckpoint(input.checkpointId);
    if (checkpoint.state === "completed") {
      if (JSON.stringify(checkpoint.selectedOutputVersionIds) !== JSON.stringify(input.selectedOutputVersionIds)) {
        throw new ExecutionRepositoryError("CHECKPOINT_CONFLICT", "Checkpoint already completed with different selections.");
      }
      return checkpoint;
    }
    if (checkpoint.state !== "waiting-review" || checkpoint.workItemId === null) {
      throw new ExecutionRepositoryError("TRANSITION_CONFLICT", "Review checkpoint is not waiting for completion.");
    }
    if (input.selectedOutputVersionIds.length === 0) {
      throw new ExecutionRepositoryError("EMPTY_REVIEW", "A Compare checkpoint requires at least one selected output.");
    }
    for (const outputVersionId of input.selectedOutputVersionIds) this.requireOutputVersion(outputVersionId);
    const work = this.requireWorkItem(checkpoint.workItemId);
    const attemptId = this.runningAttemptId(work.id);
    const now = this.context.now();
    const attemptAccepted = this.context.database
      .prepare(
        `UPDATE attempts SET status = 'accepted', output_version_ids_json = ?, completed_at = ?
         WHERE attempt_id = ? AND status = 'running'`
      )
      .run(JSON.stringify(input.selectedOutputVersionIds), now, attemptId);
    const workAccepted = this.context.database
      .prepare(
        `UPDATE work_items SET status = 'accepted', accepted_attempt_id = ?, updated_at = ?
         WHERE work_item_id = ? AND status = 'waiting-review'`
      )
      .run(attemptId, now, work.id);
    if (attemptAccepted.changes !== 1 || workAccepted.changes !== 1) {
      throw new ExecutionRepositoryError("TRANSITION_CONFLICT", "Review checkpoint completion lost its work transition.");
    }
    this.context.database
      .prepare(
        `UPDATE review_checkpoints SET state = 'completed', selected_output_version_ids_json = ?,
                completion_json = ?, completed_at = ?
         WHERE checkpoint_id = ? AND state = 'waiting-review'`
      )
      .run(JSON.stringify(input.selectedOutputVersionIds), JSON.stringify(input.completion ?? {}), now, checkpoint.id);
    this.recomputeJob(work.jobId, now);
    this.recordTimeline({
      jobId: work.jobId,
      workItemId: work.id,
      attemptId,
      eventName: "review.completed",
      state: "accepted",
      payload: { checkpointId: checkpoint.id, selectedOutputVersionIds: input.selectedOutputVersionIds },
      occurredAt: now
    });
    this.recordOutbox("attempt.stateChanged", checkpoint.id, {
      jobId: work.jobId,
      workItemId: work.id,
      attemptId,
      state: "accepted"
    }, now);
    this.recordOutbox("workItem.stateChanged", checkpoint.id, {
      jobId: work.jobId,
      workItemId: work.id,
      state: "accepted"
    }, now);
    this.recordOutbox("job.stateChanged", checkpoint.id, {
      jobId: work.jobId,
      state: this.requireJob(work.jobId).status
    }, now);
    return this.requireReviewCheckpoint(checkpoint.id);
  }

  completeCompareCheckpoint(input: {
    checkpointId: string;
    completion?: Record<string, unknown>;
    selectedOutputVersionIds: string[];
  }): ReviewCheckpoint {
    return this.completeReviewCheckpoint(input);
  }

  rejectReviewCheckpoint(checkpointId: string, reason: string): ReviewCheckpoint {
    const checkpoint = this.requireReviewCheckpoint(checkpointId);
    if (checkpoint.state === "rejected") return checkpoint;
    if (checkpoint.state !== "waiting-review" || checkpoint.workItemId === null) {
      throw new ExecutionRepositoryError("TRANSITION_CONFLICT", "Review checkpoint is not waiting for a decision.");
    }
    const work = this.requireWorkItem(checkpoint.workItemId);
    const attemptId = this.runningAttemptId(work.id);
    const now = this.context.now();
    this.context.database
      .prepare(
        `UPDATE attempts SET status = 'failed', error_json = ?, completed_at = ?
         WHERE attempt_id = ? AND status = 'running'`
      )
      .run(JSON.stringify({ code: "REVIEW_REJECTED", message: reason, retryable: true, details: {} }), now, attemptId);
    this.context.database
      .prepare(
        `UPDATE work_items SET status = 'failed', updated_at = ?
         WHERE work_item_id = ? AND status = 'waiting-review'`
      )
      .run(now, work.id);
    this.context.database
      .prepare(
        `UPDATE review_checkpoints SET state = 'rejected', completion_json = ?, completed_at = ?
         WHERE checkpoint_id = ? AND state = 'waiting-review'`
      )
      .run(JSON.stringify({ reason }), now, checkpoint.id);
    this.recomputeJob(work.jobId, now);
    return this.requireReviewCheckpoint(checkpoint.id);
  }

  listReviewCheckpoints(jobId: string): ReviewCheckpoint[] {
    const rows = this.context.database
      .prepare(
        `SELECT c.checkpoint_id FROM review_checkpoints c
         JOIN execution_jobs j ON j.plan_id = c.plan_id WHERE j.job_id = ?
         ORDER BY c.created_at, c.checkpoint_id`
      )
      .all(jobId) as unknown as Array<{ checkpoint_id: string }>;
    return rows.map((row) => this.requireReviewCheckpoint(row.checkpoint_id));
  }

  failAttempt(attemptId: string, code: string, message: string, retryable: boolean): boolean {
    const now = this.context.now();
    const attempt = this.requireAttempt(attemptId);
    const failed = this.context.database
      .prepare(
        `UPDATE attempts SET status = 'failed', error_json = ?, completed_at = ?
         WHERE attempt_id = ? AND status = 'running'`
      )
      .run(JSON.stringify({ code, message, retryable, details: {} }), now, attemptId);
    if (failed.changes !== 1) return false;
    const workFailed = this.context.database
      .prepare(
        "UPDATE work_items SET status = 'failed', updated_at = ? WHERE work_item_id = ? AND status = 'running'"
      )
      .run(now, attempt.workItemId);
    if (workFailed.changes !== 1) {
      throw new ExecutionRepositoryError("TRANSITION_CONFLICT", "Attempt failure lost ownership of its work item.");
    }
    const work = this.requireWorkItem(attempt.workItemId);
    this.recomputeJob(work.jobId, now);
    this.recordOutbox("attempt.stateChanged", attemptId, {
      jobId: work.jobId,
      workItemId: work.id,
      attemptId,
      state: "failed"
    }, now);
    this.recordOutbox("workItem.stateChanged", attemptId, {
      jobId: work.jobId,
      workItemId: work.id,
      state: "failed"
    }, now);
    this.recordOutbox("job.stateChanged", attemptId, {
      jobId: work.jobId,
      state: this.requireJob(work.jobId).status
    }, now);
    this.recordOutbox("plan.stateChanged", attemptId, {
      planId: this.requirePlanForJob(work.jobId).id,
      state: "failed"
    }, now);
    return true;
  }

  cancelJob(jobId: string, commandId: string): ExecutionJob {
    const existing = this.getCommandResult(commandId, "run.cancel");
    if (existing !== undefined) return ExecutionJobSchema.parse(existing.job);
    const now = this.context.now();
    const affected = this.context.database
      .prepare(
        `SELECT w.work_item_id, a.attempt_id
         FROM work_items w JOIN attempts a ON a.work_item_id = w.work_item_id
         WHERE w.job_id = ? AND w.status IN ('queued', 'running', 'waiting-review')
           AND a.status IN ('queued', 'running')`
      )
      .all(jobId) as unknown as Array<{ work_item_id: string; attempt_id: string }>;
    const cancelled = this.context.database
      .prepare(
        `UPDATE execution_jobs SET cancellation_requested_at = ?, status = 'cancelled', completed_at = ?
         WHERE job_id = ? AND status IN ('planned', 'queued', 'running')`
      )
      .run(now, now, jobId);
    if (cancelled.changes === 1) {
      const cancelledWork = this.context.database
        .prepare("UPDATE work_items SET status = 'cancelled', updated_at = ? WHERE job_id = ? AND status IN ('queued', 'running', 'waiting-review')")
        .run(now, jobId);
      const cancelledAttempts = this.context.database
        .prepare(
          `UPDATE attempts SET status = 'cancelled', completed_at = ?
           WHERE work_item_id IN (SELECT work_item_id FROM work_items WHERE job_id = ?)
             AND status IN ('queued', 'running')`
        )
        .run(now, jobId);
      this.context.database
        .prepare(
          `UPDATE review_checkpoints SET state = 'cancelled', completed_at = ?
           WHERE plan_id = (SELECT plan_id FROM execution_jobs WHERE job_id = ?)
             AND state = 'waiting-review'`
        )
        .run(now, jobId);
      const expectedWork = new Set(affected.map((row) => row.work_item_id)).size;
      if (cancelledWork.changes !== expectedWork || cancelledAttempts.changes !== affected.length) {
        throw new ExecutionRepositoryError(
          "TRANSITION_CONFLICT",
          "Cancellation did not own every selected work and attempt transition."
        );
      }
      this.context.database
        .prepare(
          `UPDATE execution_plans SET status = 'cancelled', updated_at = ?
           WHERE plan_id = (SELECT plan_id FROM execution_jobs WHERE job_id = ?)`
        )
        .run(now, jobId);
    }
    const job = this.requireJob(jobId);
    this.completeCommand(commandId, "run.cancel", { job }, cancelled.changes === 1 ? [
      ...affected.flatMap(({ work_item_id: workItemId, attempt_id: attemptId }): PendingApplicationEvent[] => [
        { name: "attempt.stateChanged", payload: { jobId, workItemId, attemptId, state: "cancelled" } },
        { name: "workItem.stateChanged", payload: { jobId, workItemId, state: "cancelled" } }
      ]),
      { name: "job.stateChanged", payload: { jobId, state: "cancelled" } },
      {
        name: "plan.stateChanged",
        payload: { planId: this.requirePlanForJob(jobId).id, state: "cancelled" }
      }
    ] : []);
    return job;
  }

  retryFailed(jobId: string, workItemIds: readonly string[] | undefined, commandId: string): ExecutionJob {
    const existing = this.getCommandResult(commandId, "run.retry");
    if (existing !== undefined) return ExecutionJobSchema.parse(existing.job);
    const selected = this.listWorkItems(jobId).filter((item) => {
      if (item.status !== "failed" || (workItemIds !== undefined && !workItemIds.includes(item.id))) {
        return false;
      }
      const latest = this.context.database
        .prepare(
          `SELECT error_json FROM attempts WHERE work_item_id = ?
           ORDER BY attempt_number DESC LIMIT 1`
        )
        .get(item.id) as { error_json: string | null } | undefined;
      const failure = latest?.error_json === null || latest === undefined
        ? undefined
        : JSON.parse(latest.error_json) as { retryable?: unknown };
      return failure?.retryable === true;
    });
    if (selected.length === 0) {
      throw new ExecutionRepositoryError("NOT_RETRYABLE", "No selected failed work items can be retried.");
    }
    const now = this.context.now();
    const retried: Array<{ workItemId: string; attemptId: string }> = [];
    for (const work of selected) {
      const maximum = this.context.database
        .prepare("SELECT max(attempt_number) AS ordinal FROM attempts WHERE work_item_id = ?")
        .get(work.id) as { ordinal: number };
      const ordinal = maximum.ordinal + 1;
      const attemptId = this.context.createId("attempt");
      this.context.database
        .prepare(
          `INSERT INTO attempts (
             attempt_id, work_item_id, attempt_number, provider_attempt_id, provider_run_id,
             status, output_version_ids_json, error_json, created_at, started_at, completed_at
           ) VALUES (?, ?, ?, ?, NULL, 'queued', '[]', NULL, ?, NULL, NULL)`
        )
        .run(attemptId, work.id, ordinal, `${jobId}:${work.id}:${ordinal}`, now);
      const workQueued = this.context.database
        .prepare(
          `UPDATE work_items SET status = 'queued', accepted_attempt_id = NULL,
                  claim_token = NULL, claimed_at = NULL, updated_at = ?
            WHERE work_item_id = ? AND status = 'failed'`
        )
        .run(now, work.id);
      if (workQueued.changes !== 1) {
        throw new ExecutionRepositoryError("TRANSITION_CONFLICT", "Failed work item is no longer retryable.");
      }
      retried.push({ workItemId: work.id, attemptId });
    }
    const jobQueued = this.context.database
      .prepare(
        `UPDATE execution_jobs SET status = 'queued', started_at = NULL, completed_at = NULL,
                cancellation_requested_at = NULL WHERE job_id = ? AND status IN ('failed', 'needs-attention', 'waiting-review')`
      )
      .run(jobId);
    if (jobQueued.changes !== 1) {
      throw new ExecutionRepositoryError("TRANSITION_CONFLICT", "Failed job is no longer retryable.");
    }
    this.context.database
      .prepare(
        `UPDATE execution_plans SET status = 'started', updated_at = ?
         WHERE plan_id = (SELECT plan_id FROM execution_jobs WHERE job_id = ?)`
      )
      .run(now, jobId);
    const job = this.requireJob(jobId);
    this.completeCommand(commandId, "run.retry", { job }, [
      ...retried.flatMap(({ workItemId, attemptId }): PendingApplicationEvent[] => [
        { name: "workItem.stateChanged", payload: { jobId, workItemId, state: "queued" } },
        { name: "attempt.stateChanged", payload: { jobId, workItemId, attemptId, state: "queued" } }
      ]),
      { name: "job.stateChanged", payload: { jobId, state: "queued" } },
      {
        name: "plan.stateChanged",
        payload: { planId: this.requirePlanForJob(jobId).id, state: "started" }
      }
    ]);
    return job;
  }

  recoverProcessLost(): string[] {
    const rows = this.context.database
      .prepare("SELECT job_id, status FROM execution_jobs WHERE status IN ('queued', 'running')")
      .all() as unknown as Array<{ job_id: string; status: string }>;
    const now = this.context.now();
    for (const { job_id, status } of rows) {
      const reset = this.context.database
        .prepare(
          `SELECT w.work_item_id, a.attempt_id
           FROM work_items w JOIN attempts a ON a.work_item_id = w.work_item_id
           WHERE w.job_id = ? AND w.status = 'running' AND a.status = 'running'`
        )
        .all(job_id) as unknown as Array<{ work_item_id: string; attempt_id: string }>;
      const attemptsReset = this.context.database
        .prepare(
          `UPDATE attempts SET status = 'queued', started_at = NULL
           WHERE work_item_id IN (SELECT work_item_id FROM work_items WHERE job_id = ?)
             AND status = 'running'`
        )
        .run(job_id);
      const workReset = this.context.database
        .prepare(
          `UPDATE work_items SET status = 'queued', claim_token = NULL, claimed_at = NULL,
                  updated_at = ? WHERE job_id = ? AND status = 'running'`
        )
        .run(now, job_id);
      const jobReset = this.context.database
        .prepare("UPDATE execution_jobs SET status = 'queued', started_at = NULL WHERE job_id = ? AND status = 'running'")
        .run(job_id);
      if (status === "running" && jobReset.changes === 1) {
        if (attemptsReset.changes !== reset.length || workReset.changes !== reset.length) {
          throw new ExecutionRepositoryError(
            "TRANSITION_CONFLICT",
            "Process-loss recovery did not own every running transition."
          );
        }
        for (const { work_item_id: workItemId, attempt_id: attemptId } of reset) {
          this.recordOutbox("attempt.stateChanged", `recovery:${attemptId}`, {
            jobId: job_id,
            workItemId,
            attemptId,
            state: "queued"
          }, now);
          this.recordOutbox("workItem.stateChanged", `recovery:${attemptId}`, {
            jobId: job_id,
            workItemId,
            state: "queued"
          }, now);
        }
        this.recordOutbox("job.stateChanged", `recovery:${job_id}`, {
          jobId: job_id,
          state: "queued"
        }, now);
      }
    }
    return rows.map((row) => row.job_id);
  }

  getJob(jobId: string): ExecutionJob | undefined {
    const row = this.context.database
      .prepare("SELECT * FROM execution_jobs WHERE job_id = ?")
      .get(jobId) as JobRow | undefined;
    return row === undefined ? undefined : jobFromRow(row);
  }

  listJobs(): ExecutionJob[] {
    const rows = this.context.database
      .prepare("SELECT * FROM execution_jobs ORDER BY created_at DESC, job_id")
      .all() as unknown as JobRow[];
    return rows.map(jobFromRow);
  }

  getJobSummary(jobId: string): ExecutionJobSummary {
    const job = this.requireJob(jobId);
    const rows = this.context.database
      .prepare(
        `SELECT status, count(*) AS count FROM work_items
         WHERE job_id = ? GROUP BY status`
      )
      .all(jobId) as unknown as Array<{ count: number; status: string }>;
    const attempts = this.context.database
      .prepare(
        `SELECT count(*) AS count FROM attempts a
         JOIN work_items w ON w.work_item_id = a.work_item_id WHERE w.job_id = ?`
      )
      .get(jobId) as { count: number };
    return {
      job,
      attempts: attempts.count,
      workItems: Object.fromEntries(rows.map((row) => [row.status, row.count]))
    };
  }

  listWorkItems(jobId: string): ExecutionWorkItem[] {
    const rows = this.context.database
      .prepare("SELECT * FROM work_items WHERE job_id = ? ORDER BY item_index")
      .all(jobId) as unknown as WorkRow[];
    return rows.map(workFromRow);
  }

  listAttempts(jobId: string): ExecutionAttempt[] {
    const rows = this.context.database
      .prepare(
        `SELECT a.* FROM attempts a JOIN work_items w ON w.work_item_id = a.work_item_id
         WHERE w.job_id = ? ORDER BY w.item_index, a.attempt_number`
      )
      .all(jobId) as unknown as AttemptRow[];
    return rows.map(attemptFromRow);
  }

  listTimeline(jobId: string): ExecutionTimelineEvent[] {
    const rows = this.context.database
      .prepare(
        `SELECT event_id, work_item_id, attempt_id, event_name, state, payload_json, occurred_at
         FROM execution_timeline WHERE job_id = ? ORDER BY occurred_at, rowid`
      )
      .all(jobId) as unknown as Array<{
        attempt_id: string | null;
        event_id: string;
        event_name: string;
        occurred_at: string;
        payload_json: string;
        state: string;
        work_item_id: string | null;
      }>;
    return rows.map((row) => ({
      id: row.event_id,
      workItemId: row.work_item_id,
      attemptId: row.attempt_id,
      eventName: row.event_name,
      state: row.state,
      payload: JSON.parse(row.payload_json) as Record<string, unknown>,
      occurredAt: row.occurred_at
    }));
  }

  snapshot(jobId: string): ExecutionRepositorySnapshot {
    return {
      job: this.requireJob(jobId),
      summary: this.getJobSummary(jobId),
      workItems: this.listWorkItems(jobId),
      attempts: this.listAttempts(jobId),
      timeline: this.listTimeline(jobId)
    };
  }

  getLineage(artifactId: string): ArtifactLineageSnapshot | undefined {
    const artifact = new ArtifactRepository(this.context).get(artifactId);
    if (artifact === undefined) return undefined;
    const outputVersion = new OutputRepository(this.context).getVersion(artifact.source.outputVersionId);
    if (outputVersion === undefined || outputVersion.attemptId === null) return undefined;
    const row = this.context.database
      .prepare("SELECT provider_run_id FROM attempts WHERE attempt_id = ?")
      .get(outputVersion.attemptId) as { provider_run_id: string | null } | undefined;
    if (row?.provider_run_id === null || row === undefined) return undefined;
    const relations = this.context.database
      .prepare("SELECT * FROM artifact_lineage WHERE artifact_id = ? ORDER BY parent_artifact_id")
      .all(artifactId) as unknown as Array<Record<string, unknown>>;
    return { artifact, outputVersion, providerRun: this.requireProviderRun(row.provider_run_id), relations };
  }

  private assertClaimRunning(claim: ClaimedExecution): void {
    const current = this.context.database
      .prepare(
        `SELECT w.status AS work_status, a.status AS attempt_status, j.cancellation_requested_at
         FROM work_items w JOIN attempts a ON a.work_item_id = w.work_item_id
         JOIN execution_jobs j ON j.job_id = w.job_id
         WHERE w.work_item_id = ? AND a.attempt_id = ? AND w.job_id = ?`
      )
      .get(claim.workItem.id, claim.attempt.id, claim.job.id) as
      | { attempt_status: string; cancellation_requested_at: string | null; work_status: string }
      | undefined;
    if (
      current?.work_status !== "running" ||
      current.attempt_status !== "running" ||
      current.cancellation_requested_at !== null
    ) {
      throw new ExecutionRepositoryError("CANCELLED", "Completion lost the execution transition race.");
    }
  }

  private acceptedCompletion(claim: ClaimedExecution): CompletionAcceptance | undefined {
    const attempt = this.requireAttempt(claim.attempt.id);
    if (attempt.status !== "accepted") return undefined;
    const work = this.requireWorkItem(claim.workItem.id);
    if (work.status !== "accepted" || work.acceptedAttemptId !== attempt.id) {
      throw new ExecutionRepositoryError("TRANSITION_CONFLICT", "Accepted attempt and work item disagree.");
    }
    const outputs = new OutputRepository(this.context);
    const outputVersions = attempt.outputVersionIds.map((id) => {
      const version = outputs.getVersion(id);
      if (version === undefined) {
        throw new ExecutionRepositoryError("ACCEPTANCE_CORRUPT", `Accepted output ${id} is missing.`);
      }
      return version;
    });
    const artifacts = outputVersions.flatMap((version) =>
      new ArtifactRepository(this.context).listByOutputVersion(version.id)
    );
    return {
      artifacts,
      outputVersions,
      providerRun: attempt.providerRunId === null ? null : this.requireProviderRun(attempt.providerRunId)
    };
  }

  private assertAcceptedOutputIds(actual: readonly NodeOutputVersion[], expected: readonly string[]): void {
    const actualIds = actual.map((output) => output.id);
    if (JSON.stringify(actualIds) !== JSON.stringify(expected)) {
      throw new ExecutionRepositoryError(
        "COMPLETION_CONFLICT",
        "The attempt was already accepted with different immutable output identities."
      );
    }
  }

  private finishAcceptedCompletion(input: {
    acceptedAt: string;
    artifacts: Artifact[];
    claim: ClaimedExecution;
    effects: Array<Record<string, unknown>>;
    outputVersions: NodeOutputVersion[];
    providerRunId: string | null;
  }): CompletionAcceptance {
    const attemptAccepted = this.context.database
      .prepare(
        `UPDATE attempts SET status = 'accepted', provider_run_id = ?,
                output_version_ids_json = ?, completed_at = ?
         WHERE attempt_id = ? AND status = 'running'`
      )
      .run(
        input.providerRunId,
        JSON.stringify(input.outputVersions.map((output) => output.id)),
        input.acceptedAt,
        input.claim.attempt.id
      );
    if (attemptAccepted.changes !== 1) {
      throw new ExecutionRepositoryError("CANCELLED", "Completion lost the attempt transition race.");
    }
    const workAccepted = this.context.database
      .prepare(
        `UPDATE work_items SET status = 'accepted', accepted_attempt_id = ?, updated_at = ?
         WHERE work_item_id = ? AND status = 'running'`
      )
      .run(input.claim.attempt.id, input.acceptedAt, input.claim.workItem.id);
    if (workAccepted.changes !== 1) {
      throw new ExecutionRepositoryError("CANCELLED", "Completion lost the work transition race.");
    }
    this.recomputeJob(input.claim.job.id, input.acceptedAt);
    this.recordTimeline({
      jobId: input.claim.job.id,
      workItemId: input.claim.workItem.id,
      attemptId: input.claim.attempt.id,
      eventName: "completion.accepted",
      state: "accepted",
      payload: {
        artifactIds: input.artifacts.map((artifact) => artifact.id),
        outputVersionIds: input.outputVersions.map((output) => output.id),
        effects: input.effects
      },
      occurredAt: input.acceptedAt
    });
    this.recordOutbox("attempt.stateChanged", input.claim.attempt.id, {
      jobId: input.claim.job.id,
      workItemId: input.claim.workItem.id,
      attemptId: input.claim.attempt.id,
      state: "accepted"
    }, input.acceptedAt);
    this.recordOutbox("workItem.stateChanged", input.claim.attempt.id, {
      jobId: input.claim.job.id,
      workItemId: input.claim.workItem.id,
      state: "accepted"
    }, input.acceptedAt);
    for (const artifact of input.artifacts) {
      const source = input.outputVersions.find((version) => version.id === artifact.source.outputVersionId);
      this.recordOutbox("artifact.accepted", input.claim.attempt.id, {
        artifactId: artifact.id,
        outputVersionId: source?.id ?? artifact.source.outputVersionId
      }, input.acceptedAt);
    }
    const job = this.requireJob(input.claim.job.id);
    this.recordOutbox("job.stateChanged", input.claim.attempt.id, {
      jobId: input.claim.job.id,
      state: job.status
    }, input.acceptedAt);
    if (job.status === "completed") {
      this.recordOutbox("plan.stateChanged", input.claim.attempt.id, {
        planId: input.claim.plan.id,
        state: "completed"
      }, input.acceptedAt);
    }
    return {
      artifacts: input.artifacts,
      outputVersions: input.outputVersions,
      providerRun: input.providerRunId === null ? null : this.requireProviderRun(input.providerRunId)
    };
  }

  private persistAdapterIntermediates(
    claim: ClaimedExecution,
    intermediates: readonly AdapterIntermediateCompletion[]
  ): void {
    const work = this.context.database
      .prepare("SELECT step_id FROM work_items WHERE work_item_id = ?")
      .get(claim.workItem.id) as { step_id: string } | undefined;
    if (work === undefined) {
      throw new ExecutionRepositoryError("WORK_NOT_FOUND", `Unknown work item ${claim.workItem.id}.`);
    }
    const statement = this.context.database.prepare(
      `INSERT INTO adapter_intermediates (
         intermediate_id, plan_id, step_id, work_item_id, adapter_id, input_payload_ids_json,
         output_payload_ids_json, status, metadata_json, created_at, completed_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?)
       ON CONFLICT(intermediate_id) DO UPDATE SET
         input_payload_ids_json = excluded.input_payload_ids_json,
         output_payload_ids_json = excluded.output_payload_ids_json,
         status = 'completed', metadata_json = excluded.metadata_json, completed_at = excluded.completed_at`
    );
    for (const intermediate of intermediates) {
      for (const payloadId of [...intermediate.inputPayloadIds, ...intermediate.outputPayloadIds]) {
        if (this.context.database
          .prepare("SELECT 1 AS found FROM node_output_payloads WHERE payload_id = ?")
          .get(payloadId) === undefined) {
          throw new ExecutionRepositoryError(
            "ADAPTER_PAYLOAD_NOT_FOUND",
            `Adapter intermediate payload ${payloadId} does not exist.`
          );
        }
      }
      const id = intermediate.id ?? this.context.createId("adapter-intermediate");
      const now = this.context.now();
      statement.run(
        id,
        claim.plan.id,
        work.step_id,
        claim.workItem.id,
        intermediate.adapterId,
        JSON.stringify(intermediate.inputPayloadIds),
        JSON.stringify(intermediate.outputPayloadIds),
        JSON.stringify(intermediate.metadata ?? {}),
        now,
        now
      );
    }
  }

  private commandReceipt(commandId: string):
    | { commandName: string; result: Record<string, unknown> }
    | undefined {
    const row = this.context.database
      .prepare("SELECT command_name, result_json FROM command_receipts WHERE command_id = ?")
      .get(commandId) as { command_name: string; result_json: string } | undefined;
    return row === undefined
      ? undefined
      : {
          commandName: row.command_name,
          result: JSON.parse(row.result_json) as Record<string, unknown>
        };
  }

  private recordTimeline(input: {
    jobId: string;
    workItemId: string;
    attemptId: string;
    eventName: string;
    state: string;
    payload: Record<string, unknown>;
    occurredAt: string;
  }): void {
    this.context.database
      .prepare(
        `INSERT INTO execution_timeline (
           event_id, job_id, work_item_id, attempt_id, event_name, state, payload_json, occurred_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        this.context.createId("timeline"),
        input.jobId,
        input.workItemId,
        input.attemptId,
        input.eventName,
        input.state,
        JSON.stringify(input.payload),
        input.occurredAt
      );
  }

  private recordOutbox(
    eventName: ApplicationEventName,
    correlationId: string,
    payload: Record<string, unknown>,
    occurredAt: string
  ): void {
    const event = ApplicationEventSchema.parse({
      kind: "event",
      id: this.context.createId("event"),
      correlationId,
      name: eventName,
      documentId: this.documentId(),
      occurredAt,
      payload
    });
    this.context.database
      .prepare(
        `INSERT INTO event_outbox (
           event_id, event_name, correlation_id, payload_json, occurred_at, delivered_at
         ) VALUES (?, ?, ?, ?, ?, NULL)`
      )
      .run(
        event.id,
        event.name,
        event.correlationId,
        JSON.stringify(event.payload),
        event.occurredAt
      );
  }

  private documentId(): string {
    const row = this.context.database
      .prepare("SELECT document_id FROM document WHERE singleton = 1")
      .get() as { document_id: string } | undefined;
    if (row === undefined) {
      throw new ExecutionRepositoryError("DOCUMENT_INVALID", "The document identity row is missing.");
    }
    return row.document_id;
  }

  private saveCommandReceipt(commandId: string, commandName: string, result: Record<string, unknown>): void {
    this.context.database
      .prepare(
        `INSERT INTO command_receipts (command_id, command_name, result_json, created_at)
         VALUES (?, ?, ?, ?)`
      )
      .run(commandId, commandName, JSON.stringify(result), this.context.now());
  }

  private recomputeJob(jobId: string, now: string): void {
    const counts = this.context.database
      .prepare(
        `SELECT count(*) AS total,
                sum(CASE WHEN status = 'accepted' THEN 1 ELSE 0 END) AS accepted,
                sum(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
                sum(CASE WHEN status = 'waiting-review' THEN 1 ELSE 0 END) AS waiting_review,
                sum(CASE WHEN status = 'needs-attention' THEN 1 ELSE 0 END) AS needs_attention,
                sum(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled
         FROM work_items WHERE job_id = ?`
      )
      .get(jobId) as {
        accepted: number;
        cancelled: number;
        failed: number;
        needs_attention: number;
        total: number;
        waiting_review: number;
      };
    const current = this.requireJob(jobId);
    const status = counts.accepted === counts.total
      ? "completed"
      : counts.needs_attention > 0
        ? "needs-attention"
        : counts.waiting_review > 0
          ? "waiting-review"
          : counts.failed > 0
            ? "failed"
            : counts.cancelled === counts.total || current.cancellationRequestedAt !== null
              ? "cancelled"
              : "running";
    this.context.database
      .prepare("UPDATE execution_jobs SET status = ?, completed_at = ? WHERE job_id = ?")
      .run(status, ["running", "waiting-review"].includes(status) ? null : now, jobId);
    if (status !== "running") {
      this.context.database
        .prepare(
          `UPDATE execution_plans SET status = ?, updated_at = ?
           WHERE plan_id = (SELECT plan_id FROM execution_jobs WHERE job_id = ?)`
        )
        .run(status, now, jobId);
    }
  }

  private requireJob(jobId: string): ExecutionJob {
    const job = this.getJob(jobId);
    if (job === undefined) throw new ExecutionRepositoryError("JOB_NOT_FOUND", `Unknown job ${jobId}.`);
    return job;
  }

  private requirePlanForJob(jobId: string): ExecutionPlan {
    const row = this.context.database
      .prepare("SELECT plan_id FROM execution_jobs WHERE job_id = ?")
      .get(jobId) as { plan_id: string } | undefined;
    const plan = row === undefined ? undefined : this.getPlan(row.plan_id);
    if (plan === undefined) throw new ExecutionRepositoryError("PLAN_NOT_FOUND", `Job ${jobId} has no plan.`);
    return plan;
  }

  private requireWorkItem(workItemId: string): ExecutionWorkItem {
    const row = this.context.database
      .prepare("SELECT * FROM work_items WHERE work_item_id = ?")
      .get(workItemId) as WorkRow | undefined;
    if (row === undefined) throw new ExecutionRepositoryError("WORK_NOT_FOUND", `Unknown work item ${workItemId}.`);
    return workFromRow(row);
  }

  private requireReviewCheckpoint(checkpointId: string): ReviewCheckpoint {
    const row = this.context.database
      .prepare(
        `SELECT checkpoint_id, plan_id, step_id, work_item_id, state,
                selected_output_version_ids_json, completion_json, completed_at
         FROM review_checkpoints WHERE checkpoint_id = ?`
      )
      .get(checkpointId) as
      | {
          checkpoint_id: string;
          completed_at: string | null;
          completion_json: string | null;
          plan_id: string;
          selected_output_version_ids_json: string;
          state: ReviewCheckpoint["state"];
          step_id: string;
          work_item_id: string | null;
        }
      | undefined;
    if (row === undefined) {
      throw new ExecutionRepositoryError("CHECKPOINT_NOT_FOUND", `Unknown review checkpoint ${checkpointId}.`);
    }
    return {
      id: row.checkpoint_id,
      planId: row.plan_id,
      stepId: row.step_id,
      workItemId: row.work_item_id,
      state: row.state,
      selectedOutputVersionIds: JSON.parse(row.selected_output_version_ids_json) as string[],
      completion: row.completion_json === null ? null : JSON.parse(row.completion_json) as Record<string, unknown>,
      completedAt: row.completed_at
    };
  }

  private requireOutputVersion(outputVersionId: string): NodeOutputVersion {
    const output = new OutputRepository(this.context).getVersion(outputVersionId);
    if (output === undefined) {
      throw new ExecutionRepositoryError("OUTPUT_NOT_FOUND", `Unknown output version ${outputVersionId}.`);
    }
    return output;
  }

  private runningAttemptId(workItemId: string): string {
    const row = this.context.database
      .prepare(
        `SELECT attempt_id FROM attempts WHERE work_item_id = ? AND status = 'running'
         ORDER BY attempt_number DESC LIMIT 1`
      )
      .get(workItemId) as { attempt_id: string } | undefined;
    if (row === undefined) {
      throw new ExecutionRepositoryError("ATTEMPT_NOT_FOUND", `Work item ${workItemId} has no running attempt.`);
    }
    return row.attempt_id;
  }

  private requireCompletionStagingPath(attemptId: string): string {
    const row = this.context.database
      .prepare("SELECT staging_path FROM provider_completion_intents WHERE attempt_id = ?")
      .get(attemptId) as { staging_path: string } | undefined;
    if (row === undefined) {
      throw new ExecutionRepositoryError("COMPLETION_NOT_FOUND", "Provider completion intent is missing.");
    }
    return row.staging_path;
  }

  private requireAttempt(attemptId: string): ExecutionAttempt {
    const row = this.context.database
      .prepare("SELECT * FROM attempts WHERE attempt_id = ?")
      .get(attemptId) as AttemptRow | undefined;
    if (row === undefined) throw new ExecutionRepositoryError("ATTEMPT_NOT_FOUND", `Unknown attempt ${attemptId}.`);
    return attemptFromRow(row);
  }

  private requireProviderRun(providerRunId: string): ProviderRunSnapshot {
    const row = this.context.database
      .prepare("SELECT * FROM provider_runs WHERE provider_run_id = ?")
      .get(providerRunId) as Record<string, unknown> | undefined;
    if (row === undefined) throw new ExecutionRepositoryError("PROVIDER_RUN_NOT_FOUND", "Provider run is missing.");
    return {
      id: String(row.provider_run_id),
      providerId: String(row.provider_id),
      modelId: String(row.model_id),
      status: String(row.status),
      request: JSON.parse(String(row.request_json)) as Record<string, unknown>,
      response: row.response_json === null ? null : JSON.parse(String(row.response_json)) as Record<string, unknown>,
      metadata: JSON.parse(String(row.metadata_json)) as Record<string, unknown>,
      startedAt: String(row.started_at),
      completedAt: row.completed_at === null ? null : String(row.completed_at)
    };
  }
}

function verifyPlanContentHash(plan: ExecutionPlan): boolean {
  const digest = createHash("sha256").update(canonicalPlanJson(plan)).digest("hex");
  return plan.contentHash === `sha256:v1:${digest}`;
}

function jobFromRow(row: JobRow): ExecutionJob {
  return ExecutionJobSchema.parse({
    id: row.job_id,
    planId: row.plan_id,
    planContentHash: row.plan_content_hash,
    status: row.status,
    requestedParallelism: row.requested_parallelism,
    effectiveParallelism: row.effective_parallelism,
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    cancellationRequestedAt: row.cancellation_requested_at
  });
}

function workFromRow(row: WorkRow): ExecutionWorkItem {
  return ExecutionWorkItemSchema.parse({
    id: row.work_item_id,
    jobId: row.job_id,
    plannedWorkItemId: row.planned_work_item_id,
    status: row.status,
    acceptedAttemptId: row.accepted_attempt_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });
}

function attemptFromRow(row: AttemptRow): ExecutionAttempt {
  return ExecutionAttemptSchema.parse({
    id: row.attempt_id,
    workItemId: row.work_item_id,
    ordinal: row.attempt_number,
    status: row.status,
    providerRunId: row.provider_run_id,
    outputVersionIds: JSON.parse(row.output_version_ids_json) as unknown,
    failure: row.error_json === null ? null : JSON.parse(row.error_json) as unknown,
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at
  });
}
