import { randomUUID } from "node:crypto";
import { initializeDatabase } from "./database.js";
import { projectPaths } from "./paths.js";
import { openDatabase } from "./sqlite.js";

const MAX_PROVIDER_JSON_STRING_LENGTH = 4096;

export type ProviderRunStatus = "running" | "complete" | "failed";

export type ProviderRunRecord = {
  id: string;
  runId: string | null;
  providerId: string;
  model: string | null;
  status: ProviderRunStatus;
  request: unknown;
  response: unknown | null;
  error: unknown | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

export type CreateProviderRunInput = {
  runId?: string | null;
  providerId: string;
  model?: string | null;
  request: unknown;
  now?: Date;
};

export type ListProviderRunsQuery = {
  runId?: string;
  providerId?: string;
  status?: ProviderRunStatus;
};

type ProviderRunRow = {
  id: string;
  run_id: string | null;
  provider_id: string;
  model: string | null;
  status: ProviderRunStatus;
  request_json: string;
  response_json: string | null;
  error_json: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  finished_at: string | null;
};

export function createProviderRun(
  projectPath: string,
  input: CreateProviderRunInput
): ProviderRunRecord {
  const databasePath = projectPaths(projectPath).database;
  initializeDatabase(databasePath);
  const db = openDatabase(databasePath);
  const now = toTimestamp(input.now);
  const id = randomUUID();

  try {
    db.prepare(
      `INSERT INTO provider_runs (
        id, run_id, provider_id, model, status, request_json, response_json, error_json,
        created_at, updated_at, started_at, finished_at
      ) VALUES (
        @id, @runId, @providerId, @model, @status, @requestJson, NULL, NULL,
        @createdAt, @updatedAt, @startedAt, NULL
      )`
    ).run({
      id,
      runId: input.runId ?? null,
      providerId: input.providerId,
      model: input.model ?? null,
      status: "running",
      requestJson: stringifyProviderJson(input.request),
      createdAt: now,
      updatedAt: now,
      startedAt: now
    });

    return getProviderRunByIdInDatabase(db, id);
  } finally {
    db.close();
  }
}

export function completeProviderRun(
  projectPath: string,
  id: string,
  response: unknown,
  now = new Date()
): ProviderRunRecord {
  const databasePath = projectPaths(projectPath).database;
  initializeDatabase(databasePath);
  const db = openDatabase(databasePath);
  const finishedAt = toTimestamp(now);

  try {
    const result = db.prepare(
      `UPDATE provider_runs
       SET status = 'complete',
           response_json = @responseJson,
           error_json = NULL,
           updated_at = @updatedAt,
           finished_at = @finishedAt
       WHERE id = @id AND status = 'running'`
    ).run({
      id,
      responseJson: stringifyProviderJson(response),
      updatedAt: finishedAt,
      finishedAt
    }) as { changes?: number | bigint };

    if (Number(result.changes ?? 0) !== 1) {
      throwProviderRunTransitionError(db, id, "complete");
    }

    return getProviderRunByIdInDatabase(db, id);
  } finally {
    db.close();
  }
}

export function failProviderRun(
  projectPath: string,
  id: string,
  error: unknown,
  now = new Date()
): ProviderRunRecord {
  const databasePath = projectPaths(projectPath).database;
  initializeDatabase(databasePath);
  const db = openDatabase(databasePath);
  const finishedAt = toTimestamp(now);

  try {
    const result = db.prepare(
      `UPDATE provider_runs
       SET status = 'failed',
           response_json = NULL,
           error_json = @errorJson,
           updated_at = @updatedAt,
           finished_at = @finishedAt
       WHERE id = @id AND status = 'running'`
    ).run({
      id,
      errorJson: stringifyProviderJson(error),
      updatedAt: finishedAt,
      finishedAt
    }) as { changes?: number | bigint };

    if (Number(result.changes ?? 0) !== 1) {
      throwProviderRunTransitionError(db, id, "failed");
    }

    return getProviderRunByIdInDatabase(db, id);
  } finally {
    db.close();
  }
}

export function listProviderRuns(
  projectPath: string,
  query: ListProviderRunsQuery = {}
): ProviderRunRecord[] {
  const databasePath = projectPaths(projectPath).database;
  initializeDatabase(databasePath);
  const db = openDatabase(databasePath, { readonly: true });
  const clauses: string[] = [];
  const params: Record<string, string> = {};

  if (query.runId) {
    clauses.push("run_id = @runId");
    params.runId = query.runId;
  }

  if (query.providerId) {
    clauses.push("provider_id = @providerId");
    params.providerId = query.providerId;
  }

  if (query.status) {
    clauses.push("status = @status");
    params.status = query.status;
  }

  try {
    const rows = db
      .prepare(
        `SELECT id, run_id, provider_id, model, status, request_json, response_json, error_json,
                created_at, updated_at, started_at, finished_at
         FROM provider_runs
         ${clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : ""}
         ORDER BY created_at ASC, id ASC`
      )
      .all(params) as ProviderRunRow[];

    return rows.map(providerRunFromRow);
  } finally {
    db.close();
  }
}

function getProviderRunByIdInDatabase(db: ReturnType<typeof openDatabase>, id: string) {
  const row = db
    .prepare(
      `SELECT id, run_id, provider_id, model, status, request_json, response_json, error_json,
              created_at, updated_at, started_at, finished_at
       FROM provider_runs
       WHERE id = ?`
    )
    .get(id) as ProviderRunRow | undefined;

  if (!row) {
    throw new Error(`Provider run "${id}" was not found.`);
  }

  return providerRunFromRow(row);
}

function throwProviderRunTransitionError(
  db: ReturnType<typeof openDatabase>,
  id: string,
  nextStatus: ProviderRunStatus
): never {
  const row = db.prepare("SELECT status FROM provider_runs WHERE id = ?").get(id) as
    | { status: ProviderRunStatus }
    | undefined;

  if (!row) {
    throw new Error(`Provider run "${id}" was not found.`);
  }

  throw new Error(
    `Provider run "${id}" is already ${row.status}; only running provider runs can transition to ${nextStatus}.`
  );
}

function providerRunFromRow(row: ProviderRunRow): ProviderRunRecord {
  return {
    id: row.id,
    runId: row.run_id,
    providerId: row.provider_id,
    model: row.model,
    status: row.status,
    request: parseProviderJson(row.request_json),
    response: row.response_json ? parseProviderJson(row.response_json) : null,
    error: row.error_json ? parseProviderJson(row.error_json) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at
  };
}

function stringifyProviderJson(value: unknown) {
  return JSON.stringify(sanitizeProviderJson(value));
}

function parseProviderJson(value: string) {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return {};
  }
}

function sanitizeProviderJson(value: unknown, seen = new WeakSet<object>(), depth = 0): unknown {
  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    return truncateProviderString(value);
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (typeof value === "undefined" || typeof value === "symbol" || typeof value === "function") {
    return undefined;
  }

  if (typeof value !== "object") {
    return String(value);
  }

  if (seen.has(value)) {
    return "[omitted:cyclic]";
  }

  if (depth >= 8) {
    return "[omitted:depth-limit]";
  }

  seen.add(value);

  if (value instanceof Error) {
    const errorRecord: Record<string, unknown> = {
      name: value.name,
      message: value.message,
      stack: value.stack
    };

    for (const [key, entry] of Object.entries(value)) {
      errorRecord[key] = sanitizeProviderJson(entry, seen, depth + 1);
    }

    return errorRecord;
  }

  if (value instanceof Uint8Array || value instanceof ArrayBuffer) {
    return "[omitted:binary]";
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.slice(0, 100).map((entry) => sanitizeProviderJson(entry, seen, depth + 1));
  }

  const record: Record<string, unknown> = {};

  for (const [key, entry] of Object.entries(value).slice(0, 200)) {
    record[key] = sanitizeProviderJson(entry, seen, depth + 1);
  }

  return record;
}

function truncateProviderString(value: string) {
  if (value.length <= MAX_PROVIDER_JSON_STRING_LENGTH) {
    return value;
  }

  return `${value.slice(0, MAX_PROVIDER_JSON_STRING_LENGTH)}[truncated:${value.length - MAX_PROVIDER_JSON_STRING_LENGTH} chars]`;
}

function toTimestamp(now = new Date()) {
  return now.toISOString();
}
