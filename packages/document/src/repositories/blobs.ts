import { ContentKeySchema } from "@ether/schema";

import type { RepositoryTransactionContext } from "./graphs.js";

export const INLINE_BLOB_LIMIT = 256 * 1024;
export const BLOB_CHUNK_SIZE = 4 * 1024 * 1024;

export interface BlobRecord {
  byteLength: number;
  chunkCount: number;
  contentKey: string;
  mediaType: string;
  storage: "inline" | "chunked";
}

export interface StagedBlobChunk {
  byteLength: number;
  index: number;
  sha256: string;
}

export interface StoredBlobPart extends StagedBlobChunk {
  data: Uint8Array;
}

interface BlobRow {
  byte_length: number;
  chunk_count: number;
  content_key: string;
  inline_data: Uint8Array | null;
  media_type: string;
  status: "failed" | "importing" | "ready";
}

export class BlobRepositoryError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "BlobRepositoryError";
    this.code = code;
  }
}

export class BlobRepository {
  constructor(private readonly context: RepositoryTransactionContext) {}

  get(contentKeyInput: string): BlobRecord | undefined {
    const contentKey = ContentKeySchema.parse(contentKeyInput).toLowerCase();
    const row = this.context.database
      .prepare(
        `SELECT content_key, status, byte_length, media_type, inline_data, chunk_count
         FROM blobs WHERE content_key = ? AND status = 'ready'`
      )
      .get(contentKey) as BlobRow | undefined;
    return row === undefined ? undefined : this.toRecord(row);
  }

  list(): BlobRecord[] {
    const rows = this.context.database
      .prepare(
        `SELECT content_key, status, byte_length, media_type, inline_data, chunk_count
         FROM blobs WHERE status = 'ready' ORDER BY content_key`
      )
      .all() as unknown as BlobRow[];
    return rows.map((row) => this.toRecord(row));
  }

  readParts(contentKeyInput: string, start: number, endExclusive: number): StoredBlobPart[] {
    const contentKey = ContentKeySchema.parse(contentKeyInput).toLowerCase();
    const row = this.context.database
      .prepare(
        `SELECT content_key, status, byte_length, media_type, inline_data, chunk_count
         FROM blobs WHERE content_key = ? AND status = 'ready'`
      )
      .get(contentKey) as BlobRow | undefined;
    if (row === undefined) return [];
    if (row.inline_data !== null) {
      return [{
        index: 0,
        byteLength: row.inline_data.byteLength,
        sha256: "",
        data: row.inline_data
      }];
    }
    const first = Math.floor(start / BLOB_CHUNK_SIZE);
    const last = Math.floor((endExclusive - 1) / BLOB_CHUNK_SIZE);
    return this.context.database
      .prepare(
        `SELECT chunk_index AS [index], byte_length AS byteLength, sha256, data
         FROM blob_chunks
         WHERE content_key = ? AND chunk_index BETWEEN ? AND ?
         ORDER BY chunk_index`
      )
      .all(contentKey, first, last) as unknown as StoredBlobPart[];
  }

  beginImport(input: {
    byteLength: number;
    contentKey: string;
    importId: string;
    mediaType: string;
    sourceName: string;
  }): "owner" | "pending" | "ready" {
    const contentKey = ContentKeySchema.parse(input.contentKey).toLowerCase();
    const existing = this.context.database
      .prepare("SELECT status FROM blobs WHERE content_key = ?")
      .get(contentKey) as { status: BlobRow["status"] } | undefined;
    if (existing?.status === "ready") return "ready";
    if (existing?.status === "importing") return "pending";
    const now = this.context.now();
    if (existing === undefined) {
      this.context.database
        .prepare(
          `INSERT INTO blobs (
             content_key, status, byte_length, media_type, inline_data, chunk_count,
             compression, created_at, updated_at
           ) VALUES (?, 'importing', ?, ?, NULL, 0, 'none', ?, ?)`
        )
        .run(contentKey, input.byteLength, input.mediaType, now, now);
    } else {
      this.context.database
        .prepare(
          `UPDATE blobs SET status = 'importing', byte_length = ?, media_type = ?,
                  inline_data = NULL, chunk_count = 0, updated_at = ?
           WHERE content_key = ?`
        )
        .run(input.byteLength, input.mediaType, now, contentKey);
    }
    this.context.database
      .prepare(
        `INSERT INTO blob_imports (
           import_id, content_key, state, source_name, media_type, expected_byte_length,
           expected_sha256, bytes_received, chunk_count, error_json, created_at, updated_at
         ) VALUES (?, ?, 'streaming', ?, ?, ?, ?, 0, 0, NULL, ?, ?)`
      )
      .run(
        input.importId,
        contentKey,
        input.sourceName,
        input.mediaType,
        input.byteLength,
        contentKey,
        now,
        now
      );
    return "owner";
  }

  writeInline(importId: string, contentKeyInput: string, data: Uint8Array): void {
    const contentKey = ContentKeySchema.parse(contentKeyInput).toLowerCase();
    if (data.byteLength > INLINE_BLOB_LIMIT) {
      throw new BlobRepositoryError("INLINE_LIMIT_EXCEEDED", "Inline blob exceeds 256 KiB.");
    }
    this.context.database
      .prepare(
        `UPDATE blobs SET inline_data = ?, chunk_count = 0, updated_at = ?
         WHERE content_key = ? AND status = 'importing'`
      )
      .run(data, this.context.now(), contentKey);
    this.updateImportProgress(importId, data.byteLength, 0);
  }

  writeChunk(importId: string, contentKeyInput: string, chunk: StagedBlobChunk, data: Uint8Array): void {
    const contentKey = ContentKeySchema.parse(contentKeyInput).toLowerCase();
    if (data.byteLength !== chunk.byteLength || data.byteLength > BLOB_CHUNK_SIZE) {
      throw new BlobRepositoryError("INVALID_STAGED_CHUNK", "Staged chunk length is invalid.");
    }
    this.context.database
      .prepare(
        `INSERT INTO blob_chunks (content_key, chunk_index, byte_length, sha256, data)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(contentKey, chunk.index, chunk.byteLength, chunk.sha256, data);
    this.context.database
      .prepare("UPDATE blobs SET chunk_count = chunk_count + 1, updated_at = ? WHERE content_key = ?")
      .run(this.context.now(), contentKey);
    this.updateImportProgress(importId, chunk.byteLength, 1);
  }

  finalize(importId: string, contentKeyInput: string, expectedChunkCount: number): BlobRecord {
    const contentKey = ContentKeySchema.parse(contentKeyInput).toLowerCase();
    const row = this.context.database
      .prepare(
        `SELECT content_key, status, byte_length, media_type, inline_data, chunk_count
         FROM blobs WHERE content_key = ?`
      )
      .get(contentKey) as BlobRow | undefined;
    if (row === undefined || row.status !== "importing") {
      throw new BlobRepositoryError("IMPORT_NOT_ACTIVE", "Blob import is not active.");
    }
    const progress = this.context.database
      .prepare("SELECT bytes_received, chunk_count FROM blob_imports WHERE import_id = ?")
      .get(importId) as { bytes_received: number; chunk_count: number } | undefined;
    if (
      progress === undefined ||
      progress.bytes_received !== row.byte_length ||
      progress.chunk_count !== expectedChunkCount ||
      row.chunk_count !== expectedChunkCount ||
      (expectedChunkCount === 0 && row.inline_data === null)
    ) {
      throw new BlobRepositoryError("INCOMPLETE_IMPORT", "Blob import is incomplete.");
    }
    const now = this.context.now();
    this.context.database
      .prepare("UPDATE blobs SET status = 'ready', updated_at = ? WHERE content_key = ?")
      .run(now, contentKey);
    this.context.database
      .prepare("UPDATE blob_imports SET state = 'committed', updated_at = ? WHERE import_id = ?")
      .run(now, importId);
    return { ...this.toRecord({ ...row, status: "ready" }), chunkCount: expectedChunkCount };
  }

  removeIncomplete(contentKeyInput: string): void {
    const contentKey = ContentKeySchema.parse(contentKeyInput).toLowerCase();
    this.context.database.prepare("DELETE FROM blobs WHERE content_key = ? AND status <> 'ready'").run(contentKey);
  }

  private updateImportProgress(importId: string, bytes: number, chunks: number): void {
    const result = this.context.database
      .prepare(
        `UPDATE blob_imports SET bytes_received = bytes_received + ?,
                chunk_count = chunk_count + ?, updated_at = ?
         WHERE import_id = ? AND state = 'streaming'`
      )
      .run(bytes, chunks, this.context.now(), importId);
    if (result.changes !== 1) {
      throw new BlobRepositoryError("IMPORT_NOT_ACTIVE", "Blob import journal is not active.");
    }
  }

  private toRecord(row: BlobRow): BlobRecord {
    return {
      contentKey: row.content_key,
      byteLength: row.byte_length,
      mediaType: row.media_type,
      chunkCount: row.chunk_count,
      storage: row.inline_data === null ? "chunked" : "inline"
    };
  }
}
