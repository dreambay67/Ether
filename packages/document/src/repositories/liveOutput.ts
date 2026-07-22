import {
  LiveOutputEntrySchema,
  LiveOutputOperationSchema,
  LiveOutputSettingsSchema,
  normalizeLiveOutputCollisionPolicy,
  type JsonObject,
  type LiveOutputEntry,
  type LiveOutputOperation,
  type LiveOutputSettings
} from "@ether/schema";
import { createHash } from "node:crypto";
import path from "node:path";

import type { RepositoryTransactionContext } from "./graphs.js";

export const LIVE_OUTPUT_PURPOSE = "live-output" as const;

export type LiveOutputEntryState = LiveOutputEntry["state"];
export type LiveOutputOperationState = LiveOutputOperation["state"];
export type LiveOutputOperationKind = LiveOutputOperation["operation"];

export interface LiveOutputDirectoryGrant {
  documentId: string;
  grantId: string;
  purpose: typeof LIVE_OUTPUT_PURPOSE;
  root: string;
  revoked?: boolean;
}

export interface LiveOutputSettingsPatch {
  collisionPolicy?: LiveOutputSettings["collisionPolicy"];
  namingPolicy?: LiveOutputSettings["namingPolicy"];
  transferPolicy?: LiveOutputSettings["transferPolicy"];
}

export interface LiveOutputEntryInput {
  artifactId: string;
  collectionId: string | null;
  expectedHash: string;
  id?: string;
  relativePath: string;
  state?: LiveOutputEntryState;
  updatedAt?: string;
}

export interface LiveOutputOperationInput {
  entryId: string | null;
  error?: JsonObject | null;
  expectedHash: string;
  id: string;
  operation: LiveOutputOperationKind;
  relativePath: string;
  sourcePath?: string | null;
  state?: LiveOutputOperationState;
}

export interface LiveOutputArtifactSource {
  artifactId: string;
  byteLength: number;
  contentKey: string;
}

interface LiveOutputSettingsRow {
  collision_policy: LiveOutputSettings["collisionPolicy"];
  enabled: number;
  last_reconciled_at: string | null;
  naming_policy_json: string;
  path_grant_id: string | null;
  transfer_policy: LiveOutputSettings["transferPolicy"];
}

interface LiveOutputEntryRow {
  artifact_id: string;
  collection_id: string | null;
  entry_id: string;
  expected_hash: string;
  relative_path: string;
  state: LiveOutputEntryState;
  updated_at: string;
}

interface LiveOutputOperationRow {
  created_at: string;
  destination_path: string;
  entry_id: string | null;
  error_json: string | null;
  expected_hash: string;
  operation: LiveOutputOperationKind;
  operation_id: string;
  source_path: string | null;
  state: LiveOutputOperationState;
  updated_at: string;
}

interface DocumentRow {
  document_id: string;
}

interface ArtifactSourceRow {
  artifact_id: string;
  byte_length: number;
  content_key: string | null;
}

export class LiveOutputError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "LiveOutputError";
    this.code = code;
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function timestamp(value: string | undefined, fallback: string): string {
  return value ?? fallback;
}

function parseError(errorJson: string | null): JsonObject | null {
  return errorJson === null ? null : (JSON.parse(errorJson) as JsonObject);
}

function normalizeSettings(input: LiveOutputSettings): LiveOutputSettings {
  return LiveOutputSettingsSchema.parse({
    ...input,
    collisionPolicy: normalizeLiveOutputCollisionPolicy(input.collisionPolicy)
  });
}

function normalizeHash(input: string): string {
  if (input.length === 0) {
    throw new LiveOutputError("INVALID_HASH", "Live Output expected hashes must not be empty.");
  }
  return input.toLowerCase();
}

/**
 * Relative paths are the only paths persisted by the Live Output tables. A
 * slash-normalized representation also makes manifests portable between
 * Windows and non-Windows test hosts.
 */
export function normalizeLiveOutputRelativePath(input: string): string {
  if (typeof input !== "string" || input.length === 0 || input.includes("\0")) {
    throw new LiveOutputError("INVALID_RELATIVE_PATH", "Live Output paths must be non-empty relative paths.");
  }
  const normalized = input.replaceAll("\\", "/");
  if (
    normalized.startsWith("/") ||
    normalized.includes(":") ||
    normalized.includes("..") ||
    path.posix.isAbsolute(normalized) ||
    path.win32.isAbsolute(normalized) ||
    /^[a-zA-Z]:/.test(normalized)
  ) {
    throw new LiveOutputError(
      "INVALID_RELATIVE_PATH",
      `Live Output path is outside the granted root: ${input}`
    );
  }
  const segments = normalized.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    throw new LiveOutputError("INVALID_RELATIVE_PATH", `Live Output path is not normalized: ${input}`);
  }
  return normalized;
}

export function liveOutputEntryId(artifactId: string): string {
  if (artifactId.length === 0) {
    throw new LiveOutputError("INVALID_ARTIFACT_ID", "Live Output entries require an artifact ID.");
  }
  return `live-output-entry-${sha256(artifactId).slice(0, 32)}`;
}

export function liveOutputOperationId(input: {
  entryId: string | null;
  expectedHash: string;
  grantId?: string;
  key?: string;
  operation: LiveOutputOperationKind;
}): string {
  const identity = [
    input.grantId ?? "",
    input.key ?? "",
    input.operation,
    input.entryId ?? "",
    normalizeHash(input.expectedHash)
  ].join("\0");
  return `live-output-operation-${sha256(identity).slice(0, 32)}`;
}

export function validateLiveOutputGrant(
  grant: LiveOutputDirectoryGrant,
  documentId: string,
  expectedGrantId?: string | null
): LiveOutputDirectoryGrant {
  if (
    grant.documentId !== documentId ||
    grant.purpose !== LIVE_OUTPUT_PURPOSE ||
    grant.grantId.length === 0 ||
    grant.revoked === true
  ) {
    throw new LiveOutputError(
      "INVALID_GRANT",
      "The Live Output directory grant is missing, revoked, or bound to another document or purpose."
    );
  }
  if (expectedGrantId !== undefined && expectedGrantId !== grant.grantId) {
    throw new LiveOutputError(
      "GRANT_MISMATCH",
      "The Live Output directory grant does not match the document setting."
    );
  }
  if (!path.isAbsolute(grant.root) || grant.root.includes("\0")) {
    throw new LiveOutputError("INVALID_GRANT", "Live Output grants must contain an absolute directory root.");
  }
  return { ...grant, root: path.resolve(grant.root) };
}

function entryFromRow(row: LiveOutputEntryRow): LiveOutputEntry {
  return LiveOutputEntrySchema.parse({
    id: row.entry_id,
    artifactId: row.artifact_id,
    collectionId: row.collection_id,
    relativePath: normalizeLiveOutputRelativePath(row.relative_path),
    expectedHash: row.expected_hash,
    state: row.state,
    updatedAt: row.updated_at
  });
}

function operationFromRow(row: LiveOutputOperationRow): LiveOutputOperation {
  return LiveOutputOperationSchema.parse({
    id: row.operation_id,
    entryId: row.entry_id,
    operation: row.operation,
    state: row.state,
    relativePath: normalizeLiveOutputRelativePath(row.destination_path),
    expectedHash: row.expected_hash,
    error: parseError(row.error_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });
}

function toJsonObject(error: unknown): JsonObject {
  if (error instanceof LiveOutputError) {
    return { code: error.code, message: error.message };
  }
  return { code: "LIVE_OUTPUT_FAILED", message: error instanceof Error ? error.message : String(error) };
}

export class LiveOutputRepository {
  constructor(private readonly context: RepositoryTransactionContext) {}

  getDocumentId(): string {
    const row = this.context.database
      .prepare("SELECT document_id FROM document WHERE singleton = 1")
      .get() as DocumentRow | undefined;
    if (row === undefined) {
      throw new LiveOutputError("DOCUMENT_NOT_FOUND", "The Live Output document header is missing.");
    }
    return row.document_id;
  }

  getSettings(): LiveOutputSettings {
    const row = this.context.database
      .prepare(
        `SELECT enabled, path_grant_id, naming_policy_json, collision_policy,
                transfer_policy, last_reconciled_at
         FROM live_output_settings WHERE singleton = 1`
      )
      .get() as LiveOutputSettingsRow | undefined;
    if (row === undefined) {
      throw new LiveOutputError("SETTINGS_NOT_FOUND", "Live Output settings are missing from the document.");
    }
    return normalizeSettings({
      enabled: row.enabled === 1,
      pathGrantId: row.path_grant_id,
      namingPolicy: JSON.parse(row.naming_policy_json) as LiveOutputSettings["namingPolicy"],
      collisionPolicy: row.collision_policy,
      transferPolicy: row.transfer_policy,
      lastReconciledAt: row.last_reconciled_at
    });
  }

  getLiveOutput(): LiveOutputSettings {
    return this.getSettings();
  }

  setSettings(input: LiveOutputSettings, grant?: LiveOutputDirectoryGrant): LiveOutputSettings {
    const settings = normalizeSettings(input);
    const documentId = this.getDocumentId();
    if (settings.enabled) {
      if (grant === undefined || settings.pathGrantId === null) {
        throw new LiveOutputError(
          "GRANT_REQUIRED",
          "Enabling Live Output requires a document-scoped directory grant."
        );
      }
      validateLiveOutputGrant(grant, documentId, settings.pathGrantId);
    }
    this.context.database
      .prepare(
        `UPDATE live_output_settings SET
           enabled = ?, path_grant_id = ?, naming_policy_json = ?, collision_policy = ?,
           transfer_policy = ?, last_reconciled_at = ?
         WHERE singleton = 1`
      )
      .run(
        settings.enabled ? 1 : 0,
        settings.pathGrantId,
        JSON.stringify(settings.namingPolicy),
        settings.collisionPolicy,
        settings.transferPolicy,
        settings.lastReconciledAt
      );
    return settings;
  }

  setLiveOutput(input: LiveOutputSettings, grant?: LiveOutputDirectoryGrant): LiveOutputSettings {
    return this.setSettings(input, grant);
  }

  enable(
    grant: LiveOutputDirectoryGrant,
    patch: LiveOutputSettingsPatch = {}
  ): LiveOutputSettings {
    const current = this.getSettings();
    return this.setSettings(
      {
        enabled: true,
        pathGrantId: grant.grantId,
        namingPolicy: patch.namingPolicy ?? current.namingPolicy,
        collisionPolicy: patch.collisionPolicy ?? current.collisionPolicy,
        transferPolicy: patch.transferPolicy ?? current.transferPolicy,
        lastReconciledAt: current.lastReconciledAt
      },
      grant
    );
  }

  disable(): LiveOutputSettings {
    const current = this.getSettings();
    return this.setSettings({ ...current, enabled: false });
  }

  setLastReconciledAt(value: string | null): LiveOutputSettings {
    this.context.database
      .prepare("UPDATE live_output_settings SET last_reconciled_at = ? WHERE singleton = 1")
      .run(value);
    return this.getSettings();
  }

  getEntry(id: string): LiveOutputEntry | undefined {
    const row = this.context.database
      .prepare(
        `SELECT entry_id, artifact_id, collection_id, relative_path, expected_hash,
                state, updated_at
         FROM live_output_entries WHERE entry_id = ?`
      )
      .get(id) as LiveOutputEntryRow | undefined;
    return row === undefined ? undefined : entryFromRow(row);
  }

  getEntryForArtifact(artifactId: string): LiveOutputEntry | undefined {
    const row = this.context.database
      .prepare(
        `SELECT entry_id, artifact_id, collection_id, relative_path, expected_hash,
                state, updated_at
         FROM live_output_entries WHERE artifact_id = ?`
      )
      .get(artifactId) as LiveOutputEntryRow | undefined;
    return row === undefined ? undefined : entryFromRow(row);
  }

  getEntryByRelativePath(relativePath: string): LiveOutputEntry | undefined {
    const normalized = normalizeLiveOutputRelativePath(relativePath);
    const row = this.context.database
      .prepare(
        `SELECT entry_id, artifact_id, collection_id, relative_path, expected_hash,
                state, updated_at
         FROM live_output_entries WHERE relative_path = ?`
      )
      .get(normalized) as LiveOutputEntryRow | undefined;
    return row === undefined ? undefined : entryFromRow(row);
  }

  listEntries(filters: { artifactId?: string; collectionId?: string } = {}): LiveOutputEntry[] {
    const where: string[] = [];
    const values: string[] = [];
    if (filters.artifactId !== undefined) {
      where.push("artifact_id = ?");
      values.push(filters.artifactId);
    }
    if (filters.collectionId !== undefined) {
      where.push("collection_id = ?");
      values.push(filters.collectionId);
    }
    const query = `SELECT entry_id, artifact_id, collection_id, relative_path, expected_hash,
                          state, updated_at
                   FROM live_output_entries${where.length === 0 ? "" : ` WHERE ${where.join(" AND ")}`}
                   ORDER BY entry_id`;
    const rows = this.context.database.prepare(query).all(...values) as unknown as LiveOutputEntryRow[];
    return rows.map(entryFromRow);
  }

  planEntry(input: LiveOutputEntryInput): LiveOutputEntry {
    const id = input.id ?? liveOutputEntryId(input.artifactId);
    const relativePath = normalizeLiveOutputRelativePath(input.relativePath);
    const expectedHash = normalizeHash(input.expectedHash);
    const existing = this.getEntry(id);
    const unchanged = existing !== undefined &&
      existing.artifactId === input.artifactId &&
      existing.collectionId === input.collectionId &&
      existing.relativePath === relativePath &&
      existing.expectedHash === expectedHash;
    const entry = LiveOutputEntrySchema.parse({
      id,
      artifactId: input.artifactId,
      collectionId: input.collectionId,
      relativePath,
      expectedHash,
      state: input.state ?? (unchanged ? existing.state : "planned"),
      updatedAt: timestamp(input.updatedAt, this.context.now())
    });
    this.context.database
      .prepare(
        `INSERT INTO live_output_entries (
           entry_id, artifact_id, collection_id, relative_path, expected_hash, state, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(entry_id) DO UPDATE SET
           artifact_id = excluded.artifact_id,
           collection_id = excluded.collection_id,
           relative_path = excluded.relative_path,
           expected_hash = excluded.expected_hash,
           state = excluded.state,
           updated_at = excluded.updated_at`
      )
      .run(
        entry.id,
        entry.artifactId,
        entry.collectionId,
        entry.relativePath,
        entry.expectedHash,
        entry.state,
        entry.updatedAt
      );
    return entry;
  }

  updateEntryPath(id: string, relativePath: string, state: LiveOutputEntryState = "planned"): LiveOutputEntry {
    const entry = this.getEntry(id);
    if (entry === undefined) {
      throw new LiveOutputError("ENTRY_NOT_FOUND", `Live Output entry ${id} does not exist.`);
    }
    return this.planEntry({ ...entry, relativePath, state, updatedAt: this.context.now() });
  }

  updateEntryState(id: string, state: LiveOutputEntryState): LiveOutputEntry {
    const entry = this.getEntry(id);
    if (entry === undefined) {
      throw new LiveOutputError("ENTRY_NOT_FOUND", `Live Output entry ${id} does not exist.`);
    }
    const updatedAt = this.context.now();
    this.context.database
      .prepare("UPDATE live_output_entries SET state = ?, updated_at = ? WHERE entry_id = ?")
      .run(state, updatedAt, id);
    return { ...entry, state, updatedAt };
  }

  getArtifactSource(artifactId: string): LiveOutputArtifactSource | undefined {
    const row = this.context.database
      .prepare("SELECT artifact_id, content_key, byte_length FROM artifacts WHERE artifact_id = ?")
      .get(artifactId) as ArtifactSourceRow | undefined;
    if (row === undefined || row.content_key === null) return undefined;
    return {
      artifactId: row.artifact_id,
      byteLength: row.byte_length,
      contentKey: row.content_key
    };
  }

  getOperation(id: string): LiveOutputOperation | undefined {
    const row = this.context.database
      .prepare(
        `SELECT operation_id, entry_id, operation, state, source_path, destination_path,
                expected_hash, error_json, created_at, updated_at
         FROM live_output_operations WHERE operation_id = ?`
      )
      .get(id) as LiveOutputOperationRow | undefined;
    return row === undefined ? undefined : operationFromRow(row);
  }

  getOperationDetails(id: string): (LiveOutputOperation & { sourcePath: string | null }) | undefined {
    const row = this.context.database
      .prepare(
        `SELECT operation_id, entry_id, operation, state, source_path, destination_path,
                expected_hash, error_json, created_at, updated_at
         FROM live_output_operations WHERE operation_id = ?`
      )
      .get(id) as LiveOutputOperationRow | undefined;
    return row === undefined ? undefined : { ...operationFromRow(row), sourcePath: row.source_path };
  }

  listOperations(options: { entryId?: string; limit?: number } = {}): LiveOutputOperation[] {
    const where = options.entryId === undefined ? "" : " WHERE entry_id = ?";
    const values = options.entryId === undefined ? [] : [options.entryId];
    const limit = options.limit === undefined ? 500 : Math.max(1, Math.min(500, Math.trunc(options.limit)));
    const rows = this.context.database
      .prepare(
        `SELECT operation_id, entry_id, operation, state, source_path, destination_path,
                expected_hash, error_json, created_at, updated_at
         FROM live_output_operations${where}
         ORDER BY created_at, operation_id LIMIT ${limit}`
      )
      .all(...values) as unknown as LiveOutputOperationRow[];
    return rows.map(operationFromRow);
  }

  planOperation(input: LiveOutputOperationInput): LiveOutputOperation {
    const relativePath = normalizeLiveOutputRelativePath(input.relativePath);
    const sourcePath = input.sourcePath === undefined || input.sourcePath === null
      ? null
      : normalizeLiveOutputRelativePath(input.sourcePath);
    const expectedHash = normalizeHash(input.expectedHash);
    const existing = this.getOperationDetails(input.id);
    if (existing !== undefined) {
      if (
        existing.entryId !== input.entryId ||
        existing.operation !== input.operation ||
        existing.expectedHash !== expectedHash
      ) {
        throw new LiveOutputError("OPERATION_ID_CONFLICT", `Live Output operation ${input.id} is not idempotent.`);
      }
      const needsReset = existing.relativePath !== relativePath ||
        existing.sourcePath !== sourcePath ||
        existing.state === "failed" ||
        existing.state === "reconciled";
      if (needsReset) {
        const updatedAt = this.context.now();
        this.context.database
          .prepare(
            `UPDATE live_output_operations SET state = 'planned', source_path = ?,
                    destination_path = ?, error_json = ?, updated_at = ?
             WHERE operation_id = ?`
          )
          .run(sourcePath, relativePath, input.error === undefined ? null : JSON.stringify(input.error), updatedAt, input.id);
        return this.getOperation(input.id)!;
      }
      return existing;
    }
    const now = this.context.now();
    this.context.database
      .prepare(
        `INSERT INTO live_output_operations (
           operation_id, entry_id, operation, state, source_path, destination_path,
           expected_hash, error_json, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.id,
        input.entryId,
        input.operation,
        input.state ?? "planned",
        sourcePath,
        relativePath,
        expectedHash,
        input.error === undefined || input.error === null ? null : JSON.stringify(input.error),
        now,
        now
      );
    return this.getOperation(input.id)!;
  }

  updateOperationPath(id: string, relativePath: string): LiveOutputOperation {
    const normalized = normalizeLiveOutputRelativePath(relativePath);
    const operation = this.getOperation(id);
    if (operation === undefined) {
      throw new LiveOutputError("OPERATION_NOT_FOUND", `Live Output operation ${id} does not exist.`);
    }
    this.context.database
      .prepare(
        `UPDATE live_output_operations SET destination_path = ?, state = 'planned',
                error_json = NULL, updated_at = ? WHERE operation_id = ?`
      )
      .run(normalized, this.context.now(), id);
    return this.getOperation(id)!;
  }

  updateOperationState(
    id: string,
    state: LiveOutputOperationState,
    error: JsonObject | null = null
  ): LiveOutputOperation {
    const operation = this.getOperation(id);
    if (operation === undefined) {
      throw new LiveOutputError("OPERATION_NOT_FOUND", `Live Output operation ${id} does not exist.`);
    }
    const updatedAt = this.context.now();
    this.context.database
      .prepare(
        "UPDATE live_output_operations SET state = ?, error_json = ?, updated_at = ? WHERE operation_id = ?"
      )
      .run(state, error === null ? null : JSON.stringify(error), updatedAt, id);
    return { ...operation, state, error, updatedAt };
  }

  failOperation(id: string, error: unknown): LiveOutputOperation {
    return this.updateOperationState(id, "failed", toJsonObject(error));
  }
}

export function liveOutputErrorObject(error: unknown): JsonObject {
  return toJsonObject(error);
}
