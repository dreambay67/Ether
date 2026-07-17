import { createHash } from "node:crypto";

import {
  DOCUMENT_STORE_INTERNAL,
  type DocumentStore
} from "../documentStore.js";
import { BLOB_CHUNK_SIZE, type BlobRecord, type StoredBlobPart } from "../repositories/blobs.js";

export const MAX_BUFFERED_BLOB_RANGE = 8 * 1024 * 1024;

export class BlobReadError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "BlobReadError";
    this.code = code;
  }
}

function assertRange(start: number, endExclusive: number): void {
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(endExclusive) ||
    start < 0 ||
    endExclusive < start
  ) {
    throw new BlobReadError("INVALID_RANGE", "Blob range must use [start, endExclusive) integers.");
  }
}

function verifyPart(blob: BlobRecord, part: StoredBlobPart | undefined, index: number): Buffer {
  const expectedLength = blob.storage === "inline"
    ? blob.byteLength
    : Math.min(BLOB_CHUNK_SIZE, blob.byteLength - index * BLOB_CHUNK_SIZE);
  if (
    part === undefined ||
    part.index !== index ||
    part.byteLength !== expectedLength ||
    part.data.byteLength !== expectedLength ||
    (blob.storage === "inline"
      ? createHash("sha256").update(part.data).digest("hex") !== blob.contentKey
      : createHash("sha256").update(part.data).digest("hex") !== part.sha256)
  ) {
    throw new BlobReadError("CORRUPT_BLOB_CHUNK", `Blob chunk ${index} is corrupt.`);
  }
  return Buffer.from(part.data);
}

export async function* streamBlobRange(
  store: DocumentStore,
  contentKey: string,
  start: number,
  endExclusive: number
): AsyncGenerator<Buffer, void, void> {
  assertRange(start, endExclusive);
  const blob = await store[DOCUMENT_STORE_INTERNAL]("read", ({ blobs }) => blobs.get(contentKey));
  if (blob === undefined) {
    throw new BlobReadError("BLOB_NOT_FOUND", "Blob is missing or not ready.");
  }
  if (endExclusive > blob.byteLength) {
    throw new BlobReadError("INVALID_RANGE", "Blob range exceeds the content length.");
  }
  if (start === endExclusive) return;

  const firstIndex = blob.storage === "inline" ? 0 : Math.floor(start / BLOB_CHUNK_SIZE);
  const lastIndex = blob.storage === "inline"
    ? 0
    : Math.floor((endExclusive - 1) / BLOB_CHUNK_SIZE);
  for (let index = firstIndex; index <= lastIndex; index += 1) {
    const part = await store[DOCUMENT_STORE_INTERNAL]("read", ({ blobs }) =>
      blobs.readPart(contentKey, index)
    );
    const bytes = verifyPart(blob, part, index);
    const partStart = blob.storage === "inline" ? 0 : index * BLOB_CHUNK_SIZE;
    const sliceStart = Math.max(start, partStart) - partStart;
    const sliceEnd = Math.min(endExclusive, partStart + bytes.byteLength) - partStart;
    yield bytes.subarray(sliceStart, sliceEnd);
  }
}

export async function readBlobRange(
  store: DocumentStore,
  contentKey: string,
  start: number,
  endExclusive: number
): Promise<Buffer> {
  assertRange(start, endExclusive);
  if (endExclusive - start > MAX_BUFFERED_BLOB_RANGE) {
    throw new BlobReadError(
      "RANGE_TOO_LARGE",
      `Buffered blob ranges are capped at ${MAX_BUFFERED_BLOB_RANGE} bytes.`
    );
  }
  const parts: Buffer[] = [];
  for await (const part of streamBlobRange(store, contentKey, start, endExclusive)) {
    parts.push(part);
  }
  return Buffer.concat(parts, endExclusive - start);
}
