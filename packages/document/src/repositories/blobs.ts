import { ContentKeySchema } from "@ether/schema";
import { createHash } from "node:crypto";

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

interface ImportRow {
  chunk_count: number;
  content_key: string | null;
  expected_byte_length: number | null;
  expected_sha256: string | null;
  media_type: string;
  bytes_received: number;
  state: "staged" | "streaming" | "validated" | "committed" | "failed";
}

export class BlobRepositoryError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "BlobRepositoryError";
    this.code = code;
  }
}

function bytesEqual(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  return signature.every((value, index) => bytes[index + offset] === value);
}

export function mediaSignatureMatches(bytes: Uint8Array, mediaType: string): boolean {
  switch (mediaType.toLowerCase()) {
    case "image/png":
      return bytesEqual(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "image/jpeg":
      return bytesEqual(bytes, [0xff, 0xd8, 0xff]);
    case "image/gif":
      return bytesEqual(bytes, [0x47, 0x49, 0x46, 0x38]) &&
        (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61;
    case "image/webp":
      return bytesEqual(bytes, [0x52, 0x49, 0x46, 0x46]) &&
        bytesEqual(bytes, [0x57, 0x45, 0x42, 0x50], 8);
    case "audio/wav":
    case "audio/wave":
      return bytesEqual(bytes, [0x52, 0x49, 0x46, 0x46]) &&
        bytesEqual(bytes, [0x57, 0x41, 0x56, 0x45], 8);
    case "audio/mpeg":
      return bytesEqual(bytes, [0x49, 0x44, 0x33]) ||
        (bytes[0] === 0xff && bytes[1] !== undefined && (bytes[1] & 0xe0) === 0xe0);
    case "video/mp4":
      return bytesEqual(bytes, [0x66, 0x74, 0x79, 0x70], 4);
    case "application/pdf":
      return bytesEqual(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]);
    case "application/octet-stream":
      return true;
    default:
      return mediaType.startsWith("text/");
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

  removeReadyIfUnreferenced(contentKeyInput: string): boolean {
    const contentKey = ContentKeySchema.parse(contentKeyInput).toLowerCase();
    const result = this.context.database.prepare(
      `DELETE FROM blobs
       WHERE content_key = ? AND status = 'ready'
         AND NOT EXISTS (
           SELECT 1 FROM linked_references
           WHERE content_key = ? OR preview_content_key = ?
         )
         AND NOT EXISTS (
           SELECT 1 FROM artifacts WHERE content_key = ?
         )`
    ).run(contentKey, contentKey, contentKey, contentKey);
    return result.changes === 1;
  }

  readPart(contentKeyInput: string, index: number): StoredBlobPart | undefined {
    const contentKey = ContentKeySchema.parse(contentKeyInput).toLowerCase();
    const row = this.context.database
      .prepare(
        `SELECT content_key, status, byte_length, media_type, inline_data, chunk_count
         FROM blobs WHERE content_key = ? AND status = 'ready'`
      )
      .get(contentKey) as BlobRow | undefined;
    if (row === undefined) return undefined;
    if (row.inline_data !== null) {
      return index === 0 ? {
        index: 0,
        byteLength: row.inline_data.byteLength,
        sha256: "",
        data: row.inline_data
      } : undefined;
    }
    return this.context.database
      .prepare(
        `SELECT chunk_index AS [index], byte_length AS byteLength, sha256, data
         FROM blob_chunks
         WHERE content_key = ? AND chunk_index = ?`
      )
      .get(contentKey, index) as StoredBlobPart | undefined;
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
      .prepare("SELECT status, byte_length, media_type FROM blobs WHERE content_key = ?")
      .get(contentKey) as Pick<BlobRow, "byte_length" | "media_type" | "status"> | undefined;
    if (existing?.status === "ready") {
      this.verifyReady(contentKey, {
        byteLength: input.byteLength,
        mediaType: input.mediaType
      });
      return "ready";
    }
    if (existing?.status === "importing") {
      if (
        existing.byte_length !== input.byteLength ||
        existing.media_type !== input.mediaType
      ) {
        throw new BlobRepositoryError(
          "CORRUPT_DEDUPLICATE",
          "Pending deduplication metadata does not match the staged content."
        );
      }
      return "pending";
    }
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
    const active = this.assertImportBinding(importId, contentKey);
    if (data.byteLength > INLINE_BLOB_LIMIT) {
      throw new BlobRepositoryError("INLINE_LIMIT_EXCEEDED", "Inline blob exceeds 256 KiB.");
    }
    if (
      data.byteLength !== active.expected_byte_length ||
      createHash("sha256").update(data).digest("hex") !== contentKey ||
      !mediaSignatureMatches(data.subarray(0, 16), active.media_type)
    ) {
      throw new BlobRepositoryError("CORRUPT_STAGING", "Inline staged bytes failed verification.");
    }
    const result = this.context.database
      .prepare(
        `UPDATE blobs SET inline_data = ?, chunk_count = 0, updated_at = ?
         WHERE content_key = ? AND status = 'importing'`
      )
      .run(data, this.context.now(), contentKey);
    if (result.changes !== 1) {
      throw new BlobRepositoryError("IMPORT_BINDING_MISMATCH", "Blob import binding changed.");
    }
    this.updateImportProgress(importId, contentKey, data.byteLength, 0);
  }

  writeChunk(importId: string, contentKeyInput: string, chunk: StagedBlobChunk, data: Uint8Array): void {
    const contentKey = ContentKeySchema.parse(contentKeyInput).toLowerCase();
    this.assertImportBinding(importId, contentKey);
    if (data.byteLength !== chunk.byteLength || data.byteLength > BLOB_CHUNK_SIZE) {
      throw new BlobRepositoryError("INVALID_STAGED_CHUNK", "Staged chunk length is invalid.");
    }
    if (createHash("sha256").update(data).digest("hex") !== chunk.sha256) {
      throw new BlobRepositoryError("CORRUPT_STAGING", "Staged chunk hash is invalid.");
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
    this.updateImportProgress(importId, contentKey, chunk.byteLength, 1);
  }

  finalize(importId: string, contentKeyInput: string): BlobRecord {
    const contentKey = ContentKeySchema.parse(contentKeyInput).toLowerCase();
    const active = this.assertImportBinding(importId, contentKey);
    const row = this.context.database
      .prepare(
        `SELECT content_key, status, byte_length, media_type, inline_data, chunk_count
         FROM blobs WHERE content_key = ?`
      )
      .get(contentKey) as BlobRow | undefined;
    if (row === undefined || row.status !== "importing") {
      throw new BlobRepositoryError("IMPORT_NOT_ACTIVE", "Blob import is not active.");
    }
    const expectedChunkCount = row.byte_length <= INLINE_BLOB_LIMIT
      ? 0
      : Math.ceil(row.byte_length / BLOB_CHUNK_SIZE);
    if (
      active.bytes_received !== row.byte_length ||
      active.chunk_count !== expectedChunkCount ||
      row.chunk_count !== expectedChunkCount ||
      (expectedChunkCount === 0 && row.inline_data === null)
    ) {
      throw new BlobRepositoryError("INCOMPLETE_IMPORT", "Blob import is incomplete.");
    }
    this.verifyStoredBytes(row, contentKey);
    const now = this.context.now();
    this.context.database
      .prepare("UPDATE blobs SET status = 'ready', updated_at = ? WHERE content_key = ?")
      .run(now, contentKey);
    this.context.database
      .prepare("UPDATE blob_imports SET state = 'committed', updated_at = ? WHERE import_id = ?")
      .run(now, importId);
    return { ...this.toRecord({ ...row, status: "ready" }), chunkCount: expectedChunkCount };
  }

  removeIncomplete(importId: string, contentKeyInput?: string): void {
    const contentKey = contentKeyInput === undefined
      ? undefined
      : ContentKeySchema.parse(contentKeyInput).toLowerCase();
    const row = this.context.database
      .prepare("SELECT content_key FROM blob_imports WHERE import_id = ?")
      .get(importId) as { content_key: string | null } | undefined;
    if (row === undefined) return;
    if (contentKey === undefined || row.content_key !== contentKey) {
      throw new BlobRepositoryError("IMPORT_BINDING_MISMATCH", "Blob cleanup binding changed.");
    }
    this.context.database
      .prepare("DELETE FROM blobs WHERE content_key = ? AND status <> 'ready'")
      .run(contentKey);
  }

  verifyReady(
    contentKeyInput: string,
    expected?: { byteLength: number; mediaType: string }
  ): BlobRecord {
    const contentKey = ContentKeySchema.parse(contentKeyInput).toLowerCase();
    const row = this.context.database
      .prepare(
        `SELECT content_key, status, byte_length, media_type, inline_data, chunk_count
         FROM blobs WHERE content_key = ? AND status = 'ready'`
      )
      .get(contentKey) as BlobRow | undefined;
    if (
      row === undefined ||
      (expected !== undefined &&
        (row.byte_length !== expected.byteLength || row.media_type !== expected.mediaType))
    ) {
      throw new BlobRepositoryError(
        "CORRUPT_DEDUPLICATE",
        "Ready deduplication metadata does not match the staged content."
      );
    }
    try {
      this.verifyStoredBytes(row, contentKey);
    } catch (error) {
      throw new BlobRepositoryError(
        "CORRUPT_DEDUPLICATE",
        "Ready deduplication content failed integrity verification.",
        { cause: error }
      );
    }
    return this.toRecord(row);
  }

  private assertImportBinding(importId: string, contentKey: string): ImportRow {
    const row = this.context.database
      .prepare(
        `SELECT content_key, state, media_type, expected_byte_length, expected_sha256,
                bytes_received, chunk_count
         FROM blob_imports WHERE import_id = ?`
      )
      .get(importId) as ImportRow | undefined;
    if (
      row === undefined ||
      row.state !== "streaming" ||
      row.content_key !== contentKey ||
      row.expected_sha256 !== contentKey ||
      row.expected_byte_length === null
    ) {
      throw new BlobRepositoryError(
        "IMPORT_BINDING_MISMATCH",
        "Blob mutation does not match its active import ID and content key."
      );
    }
    return row;
  }

  private updateImportProgress(
    importId: string,
    contentKey: string,
    bytes: number,
    chunks: number
  ): void {
    const result = this.context.database
      .prepare(
        `UPDATE blob_imports SET bytes_received = bytes_received + ?,
                chunk_count = chunk_count + ?, updated_at = ?
         WHERE import_id = ? AND content_key = ? AND state = 'streaming'`
      )
      .run(bytes, chunks, this.context.now(), importId, contentKey);
    if (result.changes !== 1) {
      throw new BlobRepositoryError("IMPORT_BINDING_MISMATCH", "Blob import binding changed.");
    }
  }

  private verifyStoredBytes(row: BlobRow, contentKey: string): void {
    const wholeHash = createHash("sha256");
    let firstBytes: Uint8Array | undefined;
    let total = 0;
    if (row.inline_data !== null) {
      if (row.chunk_count !== 0 || row.inline_data.byteLength !== row.byte_length) {
        throw new BlobRepositoryError("INCOMPLETE_IMPORT", "Inline blob length is invalid.");
      }
      wholeHash.update(row.inline_data);
      firstBytes = row.inline_data.subarray(0, 16);
      total = row.inline_data.byteLength;
    } else {
      const expectedCount = Math.ceil(row.byte_length / BLOB_CHUNK_SIZE);
      if (row.chunk_count !== expectedCount) {
        throw new BlobRepositoryError("INCOMPLETE_IMPORT", "Blob chunk count is invalid.");
      }
      const statement = this.context.database.prepare(
        `SELECT chunk_index AS [index], byte_length AS byteLength, sha256, data
         FROM blob_chunks WHERE content_key = ? AND chunk_index = ?`
      );
      for (let index = 0; index < expectedCount; index += 1) {
        const chunk = statement.get(contentKey, index) as StoredBlobPart | undefined;
        const expectedLength = Math.min(BLOB_CHUNK_SIZE, row.byte_length - total);
        if (
          chunk === undefined ||
          chunk.index !== index ||
          chunk.byteLength !== expectedLength ||
          chunk.data.byteLength !== expectedLength ||
          createHash("sha256").update(chunk.data).digest("hex") !== chunk.sha256
        ) {
          throw new BlobRepositoryError("INCOMPLETE_IMPORT", `Blob chunk ${index} is invalid.`);
        }
        firstBytes ??= chunk.data.subarray(0, 16);
        wholeHash.update(chunk.data);
        total += chunk.data.byteLength;
      }
    }
    if (
      total !== row.byte_length ||
      wholeHash.digest("hex") !== contentKey ||
      firstBytes === undefined ||
      !mediaSignatureMatches(firstBytes, row.media_type)
    ) {
      throw new BlobRepositoryError("CORRUPT_STAGING", "Blob bytes failed final verification.");
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
