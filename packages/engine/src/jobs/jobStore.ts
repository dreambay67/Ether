import { randomUUID } from "node:crypto";
import { initializeDatabase } from "../project/database.js";
import { projectPaths } from "../project/paths.js";
import { openDatabase, runInTransaction, type SqliteDatabase } from "../project/sqlite.js";
import type {
  AddJobDependenciesInput,
  AddJobItemsInput,
  AppendJobEventInput,
  CancelJobItemInput,
  EnqueueJobInput,
  EtherJob,
  EtherJobDependency,
  EtherJobEvent,
  EtherJobItem,
  JobItemStatus,
  JobStatus,
  JsonRecord,
  ListJobsQuery,
  RecordJobItemFailureInput,
  RetryJobItemInput,
  TransitionJobItemStatusInput,
  TransitionJobStatusInput
} from "./types.js";

type JobRow = {
  id: string;
  status: JobStatus;
  kind: string;
  graph_revision_id: string | null;
  root_node_id: string | null;
  metadata_json: string;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  finished_at: string | null;
};

type JobItemRow = {
  id: string;
  job_id: string;
  node_id: string;
  status: JobItemStatus;
  input_json: string;
  output_json: string;
  error_json: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  finished_at: string | null;
};

type JobDependencyRow = {
  id: string;
  job_id: string;
  parent_job_item_id: string;
  child_job_item_id: string;
  created_at: string;
};

type JobEventRow = {
  id: string;
  job_id: string;
  job_item_id: string | null;
  event_type: string;
  payload_json: string;
  created_at: string;
};

const TERMINAL_JOB_STATUSES: JobStatus[] = ["completed", "failed", "canceled"];
const TERMINAL_ITEM_STATUSES: JobItemStatus[] = ["completed", "failed", "canceled", "skipped"];
const ITEM_METADATA_OUTPUT_KEY = "__etherJobItemMetadata";

export async function enqueueJob(projectPath: string, input: EnqueueJobInput): Promise<EtherJob> {
  const db = openProjectDatabase(projectPath);
  const now = toTimestamp(input.now);
  const jobId = randomUUID();

  try {
    runInTransaction(db, () => {
      db.prepare(
        `INSERT INTO jobs (
          id, status, kind, graph_revision_id, root_node_id, metadata_json,
          created_at, updated_at, started_at, finished_at
        ) VALUES (
          @id, 'queued', @kind, @graphRevisionId, @rootNodeId, @metadataJson,
          @createdAt, @updatedAt, NULL, NULL
        )`
      ).run({
        id: jobId,
        kind: input.kind,
        graphRevisionId: input.graphRevisionId ?? null,
        rootNodeId: input.rootNodeId ?? null,
        metadataJson: stringifyJson(input.metadata ?? {}),
        createdAt: now,
        updatedAt: now
      });
    });

    return requireJob(db, jobId);
  } finally {
    db.close();
  }
}

export async function getJobById(projectPath: string, jobId: string): Promise<EtherJob | null> {
  const db = openProjectDatabase(projectPath, { readonly: true });

  try {
    return getJobByIdInDatabase(db, jobId);
  } finally {
    db.close();
  }
}

export async function listJobs(projectPath: string, query: ListJobsQuery = {}): Promise<EtherJob[]> {
  const db = openProjectDatabase(projectPath, { readonly: true });

  try {
    if (query.statuses && query.statuses.length > 0) {
      const placeholders = query.statuses.map(() => "?").join(", ");
      const rows = db
        .prepare(
          `SELECT id, status, kind, graph_revision_id, root_node_id, metadata_json,
                  created_at, updated_at, started_at, finished_at
           FROM jobs
           WHERE status IN (${placeholders})
           ORDER BY created_at ASC, rowid ASC`
        )
        .all(...query.statuses) as JobRow[];

      return rows.map(jobFromRow);
    }

    const rows = db
      .prepare(
        `SELECT id, status, kind, graph_revision_id, root_node_id, metadata_json,
                created_at, updated_at, started_at, finished_at
         FROM jobs
         ORDER BY created_at ASC, rowid ASC`
      )
      .all() as JobRow[];

    return rows.map(jobFromRow);
  } finally {
    db.close();
  }
}

export async function addJobItems(
  projectPath: string,
  input: AddJobItemsInput
): Promise<EtherJobItem[]> {
  for (const item of input.items) {
    assertNoReservedMetadataKey(item.input, "Job item input");
  }

  const db = openProjectDatabase(projectPath);
  const now = toTimestamp(input.now);
  const itemIds = input.items.map(() => randomUUID());

  try {
    runInTransaction(db, () => {
      ensureJobExists(db, input.jobId);
      const insert = db.prepare(
        `INSERT INTO job_items (
          id, job_id, node_id, status, input_json, output_json, error_json,
          created_at, updated_at, started_at, finished_at
        ) VALUES (
          @id, @jobId, @nodeId, 'queued', @inputJson, @outputJson, NULL,
          @createdAt, @updatedAt, NULL, NULL
        )`
      );

      input.items.forEach((item, index) => {
        insert.run({
          id: itemIds[index],
          jobId: input.jobId,
          nodeId: item.nodeId,
          inputJson: stringifyJson(item.input ?? {}),
          outputJson: stringifyJson({}),
          createdAt: now,
          updatedAt: now
        });

        if (item.metadata) {
          setJobItemMetadata(db, itemIds[index], item.metadata, now);
        }
      });
    });

    return itemIds.map((itemId) => requireJobItem(db, itemId));
  } finally {
    db.close();
  }
}

export async function getJobItemById(
  projectPath: string,
  jobItemId: string
): Promise<EtherJobItem | null> {
  const db = openProjectDatabase(projectPath, { readonly: true });

  try {
    return getJobItemByIdInDatabase(db, jobItemId);
  } finally {
    db.close();
  }
}

export async function listJobItems(projectPath: string, jobId: string): Promise<EtherJobItem[]> {
  const db = openProjectDatabase(projectPath, { readonly: true });

  try {
    const rows = db
      .prepare(
        `SELECT id, job_id, node_id, status, input_json, output_json, error_json,
                created_at, updated_at, started_at, finished_at
         FROM job_items
         WHERE job_id = ?
         ORDER BY created_at ASC, rowid ASC`
      )
      .all(jobId) as JobItemRow[];

    return rows.map(jobItemFromRow);
  } finally {
    db.close();
  }
}

export async function addJobDependencies(
  projectPath: string,
  input: AddJobDependenciesInput
): Promise<EtherJobDependency[]> {
  const db = openProjectDatabase(projectPath);
  const now = toTimestamp(input.now);
  const dependencyIds = input.dependencies.map(() => randomUUID());

  try {
    runInTransaction(db, () => {
      ensureJobExists(db, input.jobId);
      const insert = db.prepare(
        `INSERT INTO job_dependencies (
          id, job_id, parent_job_item_id, child_job_item_id, created_at
        ) VALUES (
          @id, @jobId, @parentJobItemId, @childJobItemId, @createdAt
        )`
      );

      input.dependencies.forEach((dependency, index) => {
        assertJobItemBelongsToJob(db, dependency.parentJobItemId, input.jobId);
        assertJobItemBelongsToJob(db, dependency.childJobItemId, input.jobId);
        insert.run({
          id: dependencyIds[index],
          jobId: input.jobId,
          parentJobItemId: dependency.parentJobItemId,
          childJobItemId: dependency.childJobItemId,
          createdAt: now
        });
      });
    });

    return dependencyIds.map((dependencyId) => requireJobDependency(db, dependencyId));
  } finally {
    db.close();
  }
}

export async function listJobDependencies(
  projectPath: string,
  jobId: string
): Promise<EtherJobDependency[]> {
  const db = openProjectDatabase(projectPath, { readonly: true });

  try {
    const rows = db
      .prepare(
        `SELECT id, job_id, parent_job_item_id, child_job_item_id, created_at
         FROM job_dependencies
         WHERE job_id = ?
         ORDER BY created_at ASC, rowid ASC`
      )
      .all(jobId) as JobDependencyRow[];

    return rows.map(jobDependencyFromRow);
  } finally {
    db.close();
  }
}

export async function listReadyJobItems(projectPath: string, jobId: string): Promise<EtherJobItem[]> {
  const db = openProjectDatabase(projectPath, { readonly: true });

  try {
    const rows = db
      .prepare(
        `SELECT child.id, child.job_id, child.node_id, child.status, child.input_json,
                child.output_json, child.error_json, child.created_at, child.updated_at,
                child.started_at, child.finished_at
         FROM job_items child
         WHERE child.job_id = ?
           AND child.status = 'queued'
           AND NOT EXISTS (
             SELECT 1
             FROM job_dependencies dependency
             JOIN job_items parent ON parent.id = dependency.parent_job_item_id
             WHERE dependency.child_job_item_id = child.id
               AND dependency.job_id = child.job_id
               AND parent.status NOT IN ('completed', 'skipped')
           )
         ORDER BY child.created_at ASC, child.rowid ASC`
      )
      .all(jobId) as JobItemRow[];

    return rows.map(jobItemFromRow);
  } finally {
    db.close();
  }
}

export async function transitionJobStatus(
  projectPath: string,
  input: TransitionJobStatusInput
): Promise<EtherJob> {
  assertJobTransition(input.from, input.to);
  const db = openProjectDatabase(projectPath);
  const now = toTimestamp(input.now);

  try {
    runInTransaction(db, () => {
      const result = db
        .prepare(
          `UPDATE jobs
           SET status = @to,
               updated_at = @updatedAt,
               started_at = CASE
                 WHEN @to = 'running' AND started_at IS NULL THEN @updatedAt
                 WHEN @to = 'queued' THEN NULL
                 ELSE started_at
               END,
               finished_at = CASE
                 WHEN @isTerminal = 1 THEN @updatedAt
                 WHEN @to = 'queued' THEN NULL
                 ELSE finished_at
               END
           WHERE id = @jobId AND status = @from`
        )
        .run({
          jobId: input.jobId,
          from: input.from,
          to: input.to,
          updatedAt: now,
          isTerminal: TERMINAL_JOB_STATUSES.includes(input.to) ? 1 : 0
        });

      if (result.changes !== 1) {
        throw new Error(`Job "${input.jobId}" is not in status "${input.from}".`);
      }
    });

    return requireJob(db, input.jobId);
  } finally {
    db.close();
  }
}

export async function transitionJobItemStatus(
  projectPath: string,
  input: TransitionJobItemStatusInput
): Promise<EtherJobItem> {
  assertJobItemTransition(input.from, input.to);
  assertNoReservedMetadataKey(input.output, "Job item output");
  const db = openProjectDatabase(projectPath);
  const now = toTimestamp(input.now);

  try {
    runInTransaction(db, () => {
      const existing = requireJobItem(db, input.jobItemId);
      if (existing.status !== input.from) {
        throw new Error(`Job item "${input.jobItemId}" is not in status "${input.from}".`);
      }

      const output = input.output ? { ...existing.output, ...input.output } : existing.output;
      db.prepare(
        `UPDATE job_items
         SET status = @to,
             output_json = @outputJson,
             error_json = @errorJson,
             updated_at = @updatedAt,
             started_at = CASE
               WHEN @to = 'running' AND started_at IS NULL THEN @updatedAt
               WHEN @to = 'queued' THEN NULL
               ELSE started_at
             END,
             finished_at = CASE
               WHEN @isTerminal = 1 THEN @updatedAt
               WHEN @to = 'queued' THEN NULL
               ELSE finished_at
             END
         WHERE id = @jobItemId`
      ).run({
        jobItemId: input.jobItemId,
        to: input.to,
        outputJson: stringifyJson(outputForStorage(output, existing.metadata)),
        errorJson: input.error === undefined ? stringifyNullableJson(existing.error) : stringifyNullableJson(input.error),
        updatedAt: now,
        isTerminal: TERMINAL_ITEM_STATUSES.includes(input.to) ? 1 : 0
      });
    });

    return requireJobItem(db, input.jobItemId);
  } finally {
    db.close();
  }
}

export async function recordJobItemFailure(
  projectPath: string,
  input: RecordJobItemFailureInput
): Promise<EtherJobItem> {
  assertNoReservedMetadataKey(input.metadata, "Job item failure metadata");
  const db = openProjectDatabase(projectPath);
  const now = toTimestamp(input.now);

  try {
    runInTransaction(db, () => {
      const existing = requireJobItem(db, input.jobItemId);
      if (existing.status !== "queued" && existing.status !== "running") {
        throw new Error(`Job item "${input.jobItemId}" is not queued or running.`);
      }

      setJobItemMetadata(db, input.jobItemId, {
        ...existing.metadata,
        ...(input.metadata ?? {}),
        lastFailureAt: now
      }, now);
      db.prepare(
        `UPDATE job_items
         SET status = 'failed',
             error_json = @errorJson,
             updated_at = @updatedAt,
             finished_at = @finishedAt
         WHERE id = @jobItemId`
      ).run({
        jobItemId: input.jobItemId,
        errorJson: stringifyJson(input.error),
        updatedAt: now,
        finishedAt: now
      });
    });

    return requireJobItem(db, input.jobItemId);
  } finally {
    db.close();
  }
}

export async function retryJobItem(
  projectPath: string,
  input: RetryJobItemInput
): Promise<EtherJobItem> {
  assertNoReservedMetadataKey(input.metadata, "Job item retry metadata");
  const db = openProjectDatabase(projectPath);
  const now = toTimestamp(input.now);

  try {
    runInTransaction(db, () => {
      const existing = requireJobItem(db, input.jobItemId);
      if (existing.status !== "failed") {
        throw new Error(`Job item "${input.jobItemId}" is not failed and cannot be retried.`);
      }

      const retryCount = existing.retryCount + 1;
      setJobItemMetadata(db, input.jobItemId, {
        ...existing.metadata,
        ...(input.metadata ?? {}),
        retryCount,
        retryMetadata: {
          ...existing.retryMetadata,
          ...(input.metadata ?? {}),
          lastRetryAt: now
        }
      }, now);
      db.prepare(
        `UPDATE job_items
         SET status = 'queued',
             error_json = @errorJson,
             updated_at = @updatedAt,
             started_at = NULL,
             finished_at = NULL
         WHERE id = @jobItemId`
      ).run({
        jobItemId: input.jobItemId,
        errorJson: stringifyNullableJson(input.error ?? null),
        updatedAt: now
      });
    });

    return requireJobItem(db, input.jobItemId);
  } finally {
    db.close();
  }
}

export async function cancelJobItem(
  projectPath: string,
  input: CancelJobItemInput
): Promise<EtherJobItem> {
  const db = openProjectDatabase(projectPath);
  const now = toTimestamp(input.now);

  try {
    runInTransaction(db, () => {
      const existing = requireJobItem(db, input.jobItemId);
      if (existing.status !== "queued" && existing.status !== "running") {
        throw new Error(`Job item "${input.jobItemId}" is not queued or running.`);
      }

      db.prepare(
        `UPDATE job_items
         SET status = 'canceled',
             updated_at = @updatedAt,
             finished_at = @finishedAt
         WHERE id = @jobItemId`
      ).run({
        jobItemId: input.jobItemId,
        updatedAt: now,
        finishedAt: now
      });
    });

    return requireJobItem(db, input.jobItemId);
  } finally {
    db.close();
  }
}

export async function appendJobEvent(
  projectPath: string,
  input: AppendJobEventInput
): Promise<EtherJobEvent> {
  const db = openProjectDatabase(projectPath);
  const now = toTimestamp(input.now);
  const eventId = randomUUID();

  try {
    runInTransaction(db, () => {
      ensureJobExists(db, input.jobId);
      if (input.jobItemId) {
        assertJobItemBelongsToJob(db, input.jobItemId, input.jobId);
      }

      db.prepare(
        `INSERT INTO job_events (
          id, job_id, job_item_id, event_type, payload_json, created_at
        ) VALUES (
          @id, @jobId, @jobItemId, @eventType, @payloadJson, @createdAt
        )`
      ).run({
        id: eventId,
        jobId: input.jobId,
        jobItemId: input.jobItemId ?? null,
        eventType: input.eventType,
        payloadJson: stringifyJson(input.payload ?? {}),
        createdAt: now
      });
    });

    return requireJobEvent(db, eventId);
  } finally {
    db.close();
  }
}

export async function listJobEvents(projectPath: string, jobId: string): Promise<EtherJobEvent[]> {
  const db = openProjectDatabase(projectPath, { readonly: true });

  try {
    const rows = db
      .prepare(
        `SELECT id, job_id, job_item_id, event_type, payload_json, created_at
         FROM job_events
         WHERE job_id = ?
         ORDER BY created_at ASC, rowid ASC`
      )
      .all(jobId) as JobEventRow[];

    return rows.map(jobEventFromRow);
  } finally {
    db.close();
  }
}

function openProjectDatabase(projectPath: string, options: { readonly?: boolean } = {}) {
  const paths = projectPaths(projectPath);
  initializeDatabase(paths.database);
  return openDatabase(paths.database, options);
}

function getJobByIdInDatabase(db: SqliteDatabase, jobId: string): EtherJob | null {
  const row = db
    .prepare(
      `SELECT id, status, kind, graph_revision_id, root_node_id, metadata_json,
              created_at, updated_at, started_at, finished_at
       FROM jobs
       WHERE id = ?`
    )
    .get(jobId) as JobRow | undefined;

  return row ? jobFromRow(row) : null;
}

function getJobItemByIdInDatabase(db: SqliteDatabase, jobItemId: string): EtherJobItem | null {
  const row = db
    .prepare(
      `SELECT id, job_id, node_id, status, input_json, output_json, error_json,
              created_at, updated_at, started_at, finished_at
       FROM job_items
       WHERE id = ?`
    )
    .get(jobItemId) as JobItemRow | undefined;

  return row ? jobItemFromRow(row) : null;
}

function getJobDependencyByIdInDatabase(
  db: SqliteDatabase,
  dependencyId: string
): EtherJobDependency | null {
  const row = db
    .prepare(
      `SELECT id, job_id, parent_job_item_id, child_job_item_id, created_at
       FROM job_dependencies
       WHERE id = ?`
    )
    .get(dependencyId) as JobDependencyRow | undefined;

  return row ? jobDependencyFromRow(row) : null;
}

function getJobEventByIdInDatabase(db: SqliteDatabase, eventId: string): EtherJobEvent | null {
  const row = db
    .prepare(
      `SELECT id, job_id, job_item_id, event_type, payload_json, created_at
       FROM job_events
       WHERE id = ?`
    )
    .get(eventId) as JobEventRow | undefined;

  return row ? jobEventFromRow(row) : null;
}

function requireJob(db: SqliteDatabase, jobId: string): EtherJob {
  const job = getJobByIdInDatabase(db, jobId);
  if (!job) {
    throw new Error(`Job "${jobId}" was not found.`);
  }

  return job;
}

function requireJobItem(db: SqliteDatabase, jobItemId: string): EtherJobItem {
  const jobItem = getJobItemByIdInDatabase(db, jobItemId);
  if (!jobItem) {
    throw new Error(`Job item "${jobItemId}" was not found.`);
  }

  return jobItem;
}

function requireJobDependency(db: SqliteDatabase, dependencyId: string): EtherJobDependency {
  const dependency = getJobDependencyByIdInDatabase(db, dependencyId);
  if (!dependency) {
    throw new Error(`Job dependency "${dependencyId}" was not found.`);
  }

  return dependency;
}

function requireJobEvent(db: SqliteDatabase, eventId: string): EtherJobEvent {
  const event = getJobEventByIdInDatabase(db, eventId);
  if (!event) {
    throw new Error(`Job event "${eventId}" was not found.`);
  }

  return event;
}

function ensureJobExists(db: SqliteDatabase, jobId: string) {
  requireJob(db, jobId);
}

function assertJobItemBelongsToJob(db: SqliteDatabase, jobItemId: string, jobId: string) {
  const jobItem = requireJobItem(db, jobItemId);
  if (jobItem.jobId !== jobId) {
    throw new Error(`Job item "${jobItemId}" belongs to a different job.`);
  }
}

function setJobItemMetadata(
  db: SqliteDatabase,
  jobItemId: string,
  metadata: JsonRecord,
  updatedAt: string
) {
  const existing = requireJobItem(db, jobItemId);
  db.prepare(
    `UPDATE job_items
     SET output_json = @outputJson,
         updated_at = @updatedAt
     WHERE id = @jobItemId`
  ).run({
    jobItemId,
    outputJson: stringifyJson({
      ...existing.output,
      [ITEM_METADATA_OUTPUT_KEY]: metadata
    }),
    updatedAt
  });
}

function jobFromRow(row: JobRow): EtherJob {
  return {
    id: row.id,
    status: row.status,
    kind: row.kind,
    graphRevisionId: row.graph_revision_id,
    rootNodeId: row.root_node_id,
    metadata: parseJson(row.metadata_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at
  };
}

function jobItemFromRow(row: JobItemRow): EtherJobItem {
  const output = parseJson(row.output_json);
  const metadata = readJsonRecord(output[ITEM_METADATA_OUTPUT_KEY]);
  const retryMetadata = readJsonRecord(metadata.retryMetadata);

  return {
    id: row.id,
    jobId: row.job_id,
    nodeId: row.node_id,
    status: row.status,
    input: parseJson(row.input_json),
    output: withoutKey(output, ITEM_METADATA_OUTPUT_KEY),
    error: row.error_json ? parseJson(row.error_json) : null,
    metadata,
    retryCount: readNonNegativeInteger(metadata.retryCount),
    retryMetadata,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at
  };
}

function jobDependencyFromRow(row: JobDependencyRow): EtherJobDependency {
  return {
    id: row.id,
    jobId: row.job_id,
    parentJobItemId: row.parent_job_item_id,
    childJobItemId: row.child_job_item_id,
    createdAt: row.created_at
  };
}

function jobEventFromRow(row: JobEventRow): EtherJobEvent {
  return {
    id: row.id,
    jobId: row.job_id,
    jobItemId: row.job_item_id,
    eventType: row.event_type,
    payload: parseJson(row.payload_json),
    createdAt: row.created_at
  };
}

function assertJobTransition(from: JobStatus, to: JobStatus) {
  const valid =
    (from === "queued" && (to === "running" || to === "canceled" || to === "failed")) ||
    (from === "failed" && to === "queued") ||
    (from === "running" && TERMINAL_JOB_STATUSES.includes(to));

  if (!valid) {
    throw new Error(`Invalid job status transition from "${from}" to "${to}".`);
  }
}

function assertJobItemTransition(from: JobItemStatus, to: JobItemStatus) {
  const valid =
    (from === "queued" && (to === "running" || to === "canceled" || to === "skipped" || to === "failed")) ||
    (from === "running" && to === "queued") ||
    (from === "running" && TERMINAL_ITEM_STATUSES.includes(to));

  if (!valid) {
    throw new Error(`Invalid job item status transition from "${from}" to "${to}".`);
  }
}

function assertNoReservedMetadataKey(value: JsonRecord | undefined, label: string) {
  if (value && Object.prototype.hasOwnProperty.call(value, ITEM_METADATA_OUTPUT_KEY)) {
    throw new Error(`${label} cannot contain reserved key "${ITEM_METADATA_OUTPUT_KEY}".`);
  }
}

function parseJson(value: string): JsonRecord {
  try {
    return readJsonRecord(JSON.parse(value) as unknown);
  } catch {
    return {};
  }
}

function readJsonRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function stringifyJson(value: JsonRecord) {
  return JSON.stringify(value);
}

function stringifyNullableJson(value: JsonRecord | null) {
  return value === null ? null : stringifyJson(value);
}

function readNonNegativeInteger(value: unknown) {
  return Number.isInteger(value) && (value as number) >= 0 ? (value as number) : 0;
}

function withoutKey(record: JsonRecord, key: string): JsonRecord {
  const { [key]: _unused, ...rest } = record;
  return rest;
}

function outputForStorage(output: JsonRecord, metadata: JsonRecord): JsonRecord {
  return Object.keys(metadata).length > 0 ? { ...output, [ITEM_METADATA_OUTPUT_KEY]: metadata } : output;
}

function toTimestamp(now = new Date()) {
  return now.toISOString();
}
