import { createHash } from "node:crypto";

import type { DocumentStore } from "../documentStore.js";
import { BLOB_CHUNK_SIZE } from "../repositories/blobs.js";

export class BlobReadError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "BlobReadError";
    this.code = code;
  }
}

export async function readBlobRange(
  store: DocumentStore,
  contentKey: string,
  start: number,
  endExclusive: number
): Promise<Buffer> {
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(endExclusive) ||
    start < 0 ||
    endExclusive < start
  ) {
    throw new BlobReadError("INVALID_RANGE", "Blob range must use [start, endExclusive) integers.");
  }
  const snapshot = await store.read(({ blobs }) => {
    const blob = blobs.get(contentKey);
    if (blob === undefined) return undefined;
    if (endExclusive > blob.byteLength) {
      throw new BlobReadError("INVALID_RANGE", "Blob range exceeds the content length.");
    }
    return {
      blob,
      parts: start === endExclusive ? [] : blobs.readParts(contentKey, start, endExclusive)
    };
  });
  if (snapshot === undefined) {
    throw new BlobReadError("BLOB_NOT_FOUND", "Blob is missing or not ready.");
  }
  if (start === endExclusive) return Buffer.alloc(0);
  const { blob, parts } = snapshot;
  if (blob.storage === "inline") {
    const part = parts[0];
    if (
      part === undefined ||
      part.data.byteLength !== blob.byteLength ||
      createHash("sha256").update(part.data).digest("hex") !== blob.contentKey
    ) {
      throw new BlobReadError("CORRUPT_BLOB_CHUNK", "Inline blob failed length or hash verification.");
    }
    return Buffer.from(part.data).subarray(start, endExclusive);
  }

  const firstIndex = Math.floor(start / BLOB_CHUNK_SIZE);
  const lastIndex = Math.floor((endExclusive - 1) / BLOB_CHUNK_SIZE);
  if (parts.length !== lastIndex - firstIndex + 1) {
    throw new BlobReadError("CORRUPT_BLOB_CHUNK", "Blob range has missing chunks.");
  }
  const slices: Buffer[] = [];
  for (const [offset, part] of parts.entries()) {
    const expectedIndex = firstIndex + offset;
    const expectedLength = Math.min(
      BLOB_CHUNK_SIZE,
      blob.byteLength - expectedIndex * BLOB_CHUNK_SIZE
    );
    if (
      part.index !== expectedIndex ||
      part.byteLength !== expectedLength ||
      part.data.byteLength !== expectedLength ||
      createHash("sha256").update(part.data).digest("hex") !== part.sha256
    ) {
      throw new BlobReadError("CORRUPT_BLOB_CHUNK", `Blob chunk ${expectedIndex} is corrupt.`);
    }
    const partStart = expectedIndex * BLOB_CHUNK_SIZE;
    const sliceStart = Math.max(start, partStart) - partStart;
    const sliceEnd = Math.min(endExclusive, partStart + expectedLength) - partStart;
    slices.push(Buffer.from(part.data).subarray(sliceStart, sliceEnd));
  }
  return Buffer.concat(slices, endExclusive - start);
}
