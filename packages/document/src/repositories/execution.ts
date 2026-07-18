import {
  ArtifactSchema,
  ExecutionAttemptSchema,
  ExecutionJobSchema,
  ExecutionPlanSchema,
  ExecutionWorkItemSchema,
  NodeOutputVersionSchema,
  PayloadEnvelopeSchema,
  ProviderCapabilitySchema,
  type Artifact,
  type ExecutionAttempt,
  type ExecutionJob,
  type ExecutionPlan,
  type ExecutionWorkItem,
  type NodeOutputVersion,
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

  grantRunPermit(planId: string, contentHash: string): { id: string; planId: string; contentHash: string } {
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
    return { id, planId, contentHash };
  }

  startJob(input: {
    commandId: string;
    planId: string;
    contentHash: string;
    runPermitId: string;
  }): ExecutionJob {
    const receipt = this.commandReceipt(input.commandId);
    if (receipt !== undefined) return this.requireJob(String(receipt.jobId));
    const plan = this.getPlan(input.planId);
    if (plan === undefined || plan.contentHash !== input.contentHash) {
      throw new ExecutionRepositoryError("STALE_PLAN", "The persisted plan or content hash is no longer valid.");
    }
    const current = this.context.database
      .prepare(
        `SELECT ds.current_document_revision_id AS document_revision_id,
                gh.graph_revision_id AS graph_revision_id
         FROM document_state ds
         JOIN graph_heads gh ON gh.graph_id = ?
         WHERE ds.singleton = 1`
      )
      .get(plan.graphId) as { document_revision_id: string; graph_revision_id: string } | undefined;
    if (
      current === undefined ||
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
      this.saveCommandReceipt(input.commandId, "run.start", { jobId: job.id });
      return job;
    }
    const now = this.context.now();
    const jobId = this.context.createId("job");
    this.context.database
      .prepare(
        `INSERT INTO execution_jobs (
           job_id, plan_id, plan_content_hash, start_command_id, status, created_at,
           started_at, completed_at, cancellation_requested_at
         ) VALUES (?, ?, ?, ?, 'queued', ?, NULL, NULL, NULL)`
      )
      .run(jobId, plan.id, plan.contentHash, input.commandId, now);
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
    }
    this.context.database
      .prepare("UPDATE execution_plans SET status = 'started', updated_at = ? WHERE plan_id = ?")
      .run(now, plan.id);
    this.saveCommandReceipt(input.commandId, "run.start", { jobId });
    return this.requireJob(jobId);
  }

  claimNext(jobId: string, claimToken: string): ClaimedExecution | undefined {
    const row = this.context.database
      .prepare(
        `SELECT w.work_item_id, a.attempt_id, a.provider_attempt_id
         FROM work_items w
         JOIN attempts a ON a.work_item_id = w.work_item_id
         WHERE w.job_id = ? AND w.status = 'queued' AND a.status = 'queued'
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
    return {
      plan: this.requirePlanForJob(jobId),
      job,
      workItem: this.requireWorkItem(row.work_item_id),
      attempt: this.requireAttempt(row.attempt_id),
      providerAttemptId: row.provider_attempt_id
    };
  }

  acceptProviderOutput(input: {
    claim: ClaimedExecution;
    identifiers: {
      artifactId: string;
      outputVersionId: string;
      payloadId: string;
      providerRunId: string;
      capabilitySnapshotId: string;
      importId: string;
      acceptedAt: string;
    };
    artifactMetadata: Record<string, unknown>;
    bytes: Uint8Array;
    fileName: string;
    mediaType: string;
    providerId: string;
    modelId: string;
    capabilitySnapshot: ProviderCapability;
    request: Record<string, unknown>;
    response: Record<string, unknown>;
    metadata: Record<string, unknown>;
  }): { artifact: Artifact; outputVersion: NodeOutputVersion; providerRun: ProviderRunSnapshot } {
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
    const contentKey = createHash("sha256").update(input.bytes).digest("hex");
    const blobs = new BlobRepository(this.context);
    const importId = input.identifiers.importId;
    const ownership = blobs.beginImport({
      importId,
      contentKey,
      byteLength: input.bytes.byteLength,
      mediaType: input.mediaType,
      sourceName: input.fileName
    });
    if (ownership === "owner") {
      blobs.writeInline(importId, contentKey, input.bytes);
      blobs.finalize(importId, contentKey);
    } else if (ownership !== "ready") {
      throw new ExecutionRepositoryError("BLOB_IMPORT_BUSY", "An incomplete duplicate blob import exists.");
    }
    const outputVersionId = input.identifiers.outputVersionId;
    const payloadId = input.identifiers.payloadId;
    const artifactId = input.identifiers.artifactId;
    const outputVersion = NodeOutputVersionSchema.parse({
      id: outputVersionId,
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
      outputPayloadIds: [payloadId],
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
      id: payloadId,
      channel: "image",
      role: "subject",
      content: { kind: "artifact", artifactId },
      source: {
        nodeId: step.nodeId,
        outputVersionId,
        lineageKey: `${input.claim.plan.graphId}:${step.nodeId}:${input.claim.workItem.id}`
      },
      metadata: { mediaType: input.mediaType, providerRunId }
    });
    new OutputRepository(this.context).insert(outputVersion, [payload]);
    const artifact = ArtifactSchema.parse({
      id: artifactId,
      contentKey,
      channel: "image",
      mediaType: input.mediaType,
      byteLength: input.bytes.byteLength,
      source: { outputVersionId, payloadId },
      createdAt: now,
      metadata: input.artifactMetadata
    });
    new ArtifactRepository(this.context).attach(artifact);
    this.context.database
      .prepare(
        `UPDATE attempts SET status = 'accepted', provider_run_id = ?,
                output_version_ids_json = ?, completed_at = ?
         WHERE attempt_id = ? AND status = 'running'`
      )
      .run(providerRunId, JSON.stringify([outputVersionId]), now, input.claim.attempt.id);
    this.context.database
      .prepare(
        `UPDATE work_items SET status = 'accepted', accepted_attempt_id = ?, updated_at = ?
         WHERE work_item_id = ? AND status = 'running'`
      )
      .run(input.claim.attempt.id, now, input.claim.workItem.id);
    this.recomputeJob(input.claim.job.id, now);
    this.recordTimeline({
      jobId: input.claim.job.id,
      workItemId: input.claim.workItem.id,
      attemptId: input.claim.attempt.id,
      eventName: "artifact.accepted",
      state: "accepted",
      payload: { artifactId, outputVersionId },
      occurredAt: now
    });
    this.recordOutbox("artifact.accepted", input.claim.attempt.id, { artifactId, outputVersionId }, now);
    return { artifact, outputVersion, providerRun: this.requireProviderRun(providerRunId) };
  }

  failAttempt(attemptId: string, code: string, message: string, retryable: boolean): void {
    const now = this.context.now();
    const attempt = this.requireAttempt(attemptId);
    this.context.database
      .prepare(
        `UPDATE attempts SET status = 'failed', error_json = ?, completed_at = ?
         WHERE attempt_id = ? AND status = 'running'`
      )
      .run(JSON.stringify({ code, message, retryable, details: {} }), now, attemptId);
    this.context.database
      .prepare("UPDATE work_items SET status = 'failed', updated_at = ? WHERE work_item_id = ?")
      .run(now, attempt.workItemId);
    const work = this.requireWorkItem(attempt.workItemId);
    this.recomputeJob(work.jobId, now);
  }

  cancelJob(jobId: string): ExecutionJob {
    const now = this.context.now();
    this.context.database
      .prepare(
        `UPDATE execution_jobs SET cancellation_requested_at = ?, status = 'cancelled', completed_at = ?
         WHERE job_id = ? AND status IN ('planned', 'queued', 'running')`
      )
      .run(now, now, jobId);
    this.context.database
      .prepare("UPDATE work_items SET status = 'cancelled', updated_at = ? WHERE job_id = ? AND status IN ('queued', 'running')")
      .run(now, jobId);
    this.context.database
      .prepare(
        `UPDATE attempts SET status = 'cancelled', completed_at = ?
         WHERE work_item_id IN (SELECT work_item_id FROM work_items WHERE job_id = ?)
           AND status IN ('queued', 'running')`
      )
      .run(now, jobId);
    return this.requireJob(jobId);
  }

  retryFailed(jobId: string, workItemIds?: readonly string[]): ExecutionJob {
    const selected = this.listWorkItems(jobId).filter(
      (item) => item.status === "failed" && (workItemIds === undefined || workItemIds.includes(item.id))
    );
    if (selected.length === 0) {
      throw new ExecutionRepositoryError("NOT_RETRYABLE", "No selected failed work items can be retried.");
    }
    const now = this.context.now();
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
      this.context.database
        .prepare(
          `UPDATE work_items SET status = 'queued', accepted_attempt_id = NULL,
                  claim_token = NULL, claimed_at = NULL, updated_at = ? WHERE work_item_id = ?`
        )
        .run(now, work.id);
    }
    this.context.database
      .prepare(
        `UPDATE execution_jobs SET status = 'queued', started_at = NULL, completed_at = NULL,
                cancellation_requested_at = NULL WHERE job_id = ?`
      )
      .run(jobId);
    return this.requireJob(jobId);
  }

  recoverProcessLost(): string[] {
    const rows = this.context.database
      .prepare("SELECT job_id FROM execution_jobs WHERE status IN ('queued', 'running')")
      .all() as unknown as Array<{ job_id: string }>;
    const now = this.context.now();
    for (const { job_id } of rows) {
      this.context.database
        .prepare(
          `UPDATE attempts SET status = 'queued', started_at = NULL
           WHERE work_item_id IN (SELECT work_item_id FROM work_items WHERE job_id = ?)
             AND status = 'running'`
        )
        .run(job_id);
      this.context.database
        .prepare(
          `UPDATE work_items SET status = 'queued', claim_token = NULL, claimed_at = NULL,
                  updated_at = ? WHERE job_id = ? AND status = 'running'`
        )
        .run(now, job_id);
      this.context.database
        .prepare("UPDATE execution_jobs SET status = 'queued', started_at = NULL WHERE job_id = ? AND status = 'running'")
        .run(job_id);
    }
    return rows.map((row) => row.job_id);
  }

  getJob(jobId: string): ExecutionJob | undefined {
    const row = this.context.database
      .prepare("SELECT * FROM execution_jobs WHERE job_id = ?")
      .get(jobId) as JobRow | undefined;
    return row === undefined ? undefined : jobFromRow(row);
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

  private commandReceipt(commandId: string): Record<string, unknown> | undefined {
    const row = this.context.database
      .prepare("SELECT result_json FROM command_receipts WHERE command_id = ?")
      .get(commandId) as { result_json: string } | undefined;
    return row === undefined ? undefined : (JSON.parse(row.result_json) as Record<string, unknown>);
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
    eventName: string,
    correlationId: string,
    payload: Record<string, unknown>,
    occurredAt: string
  ): void {
    this.context.database
      .prepare(
        `INSERT INTO event_outbox (
           event_id, event_name, correlation_id, payload_json, occurred_at, delivered_at
         ) VALUES (?, ?, ?, ?, ?, NULL)`
      )
      .run(
        this.context.createId("event"),
        eventName,
        correlationId,
        JSON.stringify(payload),
        occurredAt
      );
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
                sum(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
         FROM work_items WHERE job_id = ?`
      )
      .get(jobId) as { total: number; accepted: number; failed: number };
    const status = counts.accepted === counts.total ? "completed" : counts.failed > 0 ? "failed" : "running";
    this.context.database
      .prepare("UPDATE execution_jobs SET status = ?, completed_at = ? WHERE job_id = ?")
      .run(status, status === "running" ? null : now, jobId);
    if (status !== "running") {
      this.context.database
        .prepare(
          `UPDATE execution_plans SET status = ?, updated_at = ?
           WHERE plan_id = (SELECT plan_id FROM execution_jobs WHERE job_id = ?)`
        )
        .run(status === "completed" ? "completed" : "failed", now, jobId);
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

function canonicalPlanJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalPlanJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([key]) => key !== "contentHash")
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalPlanJson(item)}`)
      .join(",")}}`;
  }
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new ExecutionRepositoryError("PLAN_HASH_INVALID", "Plan content is not JSON serializable.");
  return serialized;
}

function jobFromRow(row: JobRow): ExecutionJob {
  return ExecutionJobSchema.parse({
    id: row.job_id,
    planId: row.plan_id,
    planContentHash: row.plan_content_hash,
    status: row.status,
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
