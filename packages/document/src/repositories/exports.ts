import { ExportRecordSchema, type ExportRecord } from "@ether/schema";

import type { RepositoryTransactionContext } from "./graphs.js";

type ExportRow = {
  artifact_id: string | null;
  collection_id: string | null;
  completed_at: string | null;
  content_hash: string;
  created_at: string;
  export_id: string;
  options_json: string;
  path_grant_id: string | null;
  relative_path: string;
  status: ExportRecord["status"];
};

export class ExportRepositoryError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ExportRepositoryError";
    this.code = code;
  }
}

export class ExportRepository {
  constructor(private readonly context: RepositoryTransactionContext) {}

  get(exportId: string): ExportRecord | undefined {
    const row = this.context.database
      .prepare(
        `SELECT export_id, collection_id, artifact_id, path_grant_id, relative_path, content_hash,
                status, options_json, created_at, completed_at
         FROM export_records WHERE export_id = ?`
      )
      .get(exportId) as ExportRow | undefined;
    return row === undefined ? undefined : exportFromRow(row);
  }

  list(input: { artifactId?: string; collectionId?: string; status?: ExportRecord["status"] } = {}): ExportRecord[] {
    const clauses: string[] = [];
    const values: string[] = [];
    if (input.artifactId !== undefined) {
      clauses.push("artifact_id = ?");
      values.push(input.artifactId);
    }
    if (input.collectionId !== undefined) {
      clauses.push("collection_id = ?");
      values.push(input.collectionId);
    }
    if (input.status !== undefined) {
      clauses.push("status = ?");
      values.push(input.status);
    }
    const where = clauses.length === 0 ? "" : `WHERE ${clauses.join(" AND ")}`;
    const rows = this.context.database
      .prepare(
        `SELECT export_id, collection_id, artifact_id, path_grant_id, relative_path, content_hash,
                status, options_json, created_at, completed_at
         FROM export_records ${where} ORDER BY created_at, export_id`
      )
      .all(...values) as unknown as ExportRow[];
    return rows.map(exportFromRow);
  }

  create(input: ExportRecord): ExportRecord {
    const record = ExportRecordSchema.parse(input);
    const existing = this.get(record.id);
    if (existing !== undefined) {
      if (JSON.stringify(existing) === JSON.stringify(record)) return existing;
      throw new ExportRepositoryError("EXPORT_ID_CONFLICT", `Export ${record.id} already exists.`);
    }
    if (record.artifactId !== null) this.requireArtifact(record.artifactId);
    if (record.collectionId !== undefined && record.collectionId !== null) this.requireCollection(record.collectionId);
    this.context.database
      .prepare(
        `INSERT INTO export_records (
           export_id, collection_id, artifact_id, path_grant_id, relative_path, content_hash,
           status, options_json, created_at, completed_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.id,
        record.collectionId ?? null,
        record.artifactId,
        record.pathGrantId,
        record.relativePath,
        record.contentKey,
        record.status,
        JSON.stringify(record.options ?? {}),
        record.createdAt,
        record.completedAt
      );
    return record;
  }

  setStatus(
    exportId: string,
    status: ExportRecord["status"],
    completedAt: string | null = terminal(status) ? this.context.now() : null
  ): ExportRecord {
    const changed = this.context.database
      .prepare("UPDATE export_records SET status = ?, completed_at = ? WHERE export_id = ?")
      .run(status, completedAt, exportId);
    if (changed.changes !== 1) {
      throw new ExportRepositoryError("EXPORT_NOT_FOUND", `Unknown export ${exportId}.`);
    }
    return this.get(exportId)!;
  }

  private requireArtifact(artifactId: string): void {
    if (this.context.database.prepare("SELECT 1 AS found FROM artifacts WHERE artifact_id = ?").get(artifactId) === undefined) {
      throw new ExportRepositoryError("ARTIFACT_NOT_FOUND", `Unknown artifact ${artifactId}.`);
    }
  }

  private requireCollection(collectionId: string): void {
    if (this.context.database.prepare("SELECT 1 AS found FROM collections WHERE collection_id = ?").get(collectionId) === undefined) {
      throw new ExportRepositoryError("COLLECTION_NOT_FOUND", `Unknown collection ${collectionId}.`);
    }
  }
}

function terminal(status: ExportRecord["status"]): boolean {
  return ["committed", "skipped", "failed", "cancelled"].includes(status);
}

function exportFromRow(row: ExportRow): ExportRecord {
  return ExportRecordSchema.parse({
    id: row.export_id,
    artifactId: row.artifact_id,
    ...(row.collection_id === null ? {} : { collectionId: row.collection_id }),
    pathGrantId: row.path_grant_id,
    relativePath: row.relative_path,
    contentKey: row.content_hash,
    status: row.status,
    options: JSON.parse(row.options_json),
    createdAt: row.created_at,
    completedAt: row.completed_at
  });
}
