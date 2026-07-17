import { ArtifactSchema, type Artifact, type RecoveryJournalEntry } from "@ether/schema";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import type { DocumentStore } from "../documentStore.js";
import {
  removeOwnedStagingPath,
  removeRecoveryJournal,
  resolveRecoveryRoots,
  writeRecoveryJournal
} from "../recovery/recoveryJournal.js";
import { BLOB_CHUNK_SIZE, INLINE_BLOB_LIMIT, type BlobRecord } from "../repositories/blobs.js";

export interface ImportBlobInput {
  artifact?: Omit<Artifact, "byteLength" | "contentKey">;
  mediaType: string;
  sourcePath: string;
}

export interface ImportBlobOptions {
  appDataRoot?: string;
  checkpoint?: (name: string) => void;
}

export interface ImportBlobResult extends BlobRecord {
  deduplicated: boolean;
}

interface StagedChunk {
  byteLength: number;
  index: number;
  path: string;
  sha256: string;
}

interface StagedBlob {
  byteLength: number;
  chunks: StagedChunk[];
  contentKey: string;
  directory: string;
  importId: string;
  journalPath: string;
  mediaType: string;
  sourceName: string;
}

export class BlobImportError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "BlobImportError";
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

function now(): string {
  return new Date().toISOString();
}

async function stageBlob(
  store: DocumentStore,
  input: ImportBlobInput,
  options: ImportBlobOptions
): Promise<StagedBlob> {
  const sourcePath = path.resolve(input.sourcePath);
  const sourceBefore = await stat(sourcePath, { bigint: true });
  if (!sourceBefore.isFile()) {
    throw new BlobImportError("INVALID_SOURCE", "Blob source must be a regular file.");
  }
  const roots = resolveRecoveryRoots(options.appDataRoot);
  const importId = `blob-import-${randomUUID()}`;
  const directory = path.join(roots.stagingRoot, "imports", importId);
  await mkdir(directory, { recursive: true });
  const file = await open(sourcePath, "r");
  const wholeHash = createHash("sha256");
  const chunks: StagedChunk[] = [];
  const readSize = sourceBefore.size <= BigInt(INLINE_BLOB_LIMIT) ? INLINE_BLOB_LIMIT : BLOB_CHUNK_SIZE;
  let offset = 0;
  let firstBytes: Uint8Array | undefined;
  try {
    for (let index = 0; ; index += 1) {
      const buffer = Buffer.allocUnsafe(readSize);
      const { bytesRead } = await file.read(buffer, 0, readSize, offset);
      if (bytesRead === 0) break;
      const bytes = buffer.subarray(0, bytesRead);
      if (firstBytes === undefined) firstBytes = bytes.subarray(0, Math.min(bytes.length, 16));
      wholeHash.update(bytes);
      const chunkPath = path.join(directory, `${index.toString().padStart(8, "0")}.chunk`);
      await writeFile(chunkPath, bytes, { flag: "wx", mode: 0o600 });
      chunks.push({
        index,
        path: chunkPath,
        byteLength: bytesRead,
        sha256: createHash("sha256").update(bytes).digest("hex")
      });
      offset += bytesRead;
    }
  } catch (error) {
    removeOwnedStagingPath(directory, roots.appDataRoot);
    throw error;
  } finally {
    await file.close();
  }
  const sourceAfter = await stat(sourcePath, { bigint: true });
  if (
    sourceBefore.dev !== sourceAfter.dev ||
    sourceBefore.ino !== sourceAfter.ino ||
    sourceBefore.size !== sourceAfter.size ||
    sourceBefore.mtimeNs !== sourceAfter.mtimeNs ||
    BigInt(offset) !== sourceBefore.size
  ) {
    removeOwnedStagingPath(directory, roots.appDataRoot);
    throw new BlobImportError("SOURCE_CHANGED", "Blob source changed while it was being staged.");
  }
  if (firstBytes === undefined || !mediaSignatureMatches(firstBytes, input.mediaType)) {
    removeOwnedStagingPath(directory, roots.appDataRoot);
    throw new BlobImportError(
      "MIME_MISMATCH",
      `Declared media type ${input.mediaType} does not match the file signature.`
    );
  }
  const contentKey = wholeHash.digest("hex");
  const timestamp = now();
  const entry: RecoveryJournalEntry = {
    id: importId,
    kind: "blob-import",
    state: "validated",
    documentId: store.documentId,
    documentPath: store.path,
    stagedPath: directory,
    sourceName: path.basename(sourcePath),
    mediaType: input.mediaType,
    contentKey,
    byteLength: offset,
    createdAt: timestamp,
    updatedAt: timestamp
  };
  const journalPath = writeRecoveryJournal({ appDataRoot: roots.appDataRoot, entry });
  return {
    byteLength: offset,
    chunks,
    contentKey,
    directory,
    importId,
    journalPath,
    mediaType: input.mediaType,
    sourceName: path.basename(sourcePath)
  };
}

function artifactFor(input: ImportBlobInput, staged: StagedBlob): Artifact | undefined {
  if (input.artifact === undefined) return undefined;
  if (input.artifact.mediaType !== staged.mediaType) {
    throw new BlobImportError("ARTIFACT_MEDIA_MISMATCH", "Artifact and blob media types differ.");
  }
  return ArtifactSchema.parse({
    ...input.artifact,
    contentKey: staged.contentKey,
    byteLength: staged.byteLength
  });
}

async function waitForReadyBlob(store: DocumentStore, contentKey: string): Promise<BlobRecord> {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const record = await store.read(({ blobs }) => blobs.get(contentKey));
    if (record !== undefined) return record;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new BlobImportError("IMPORT_BUSY", "Another import did not finish in time.");
}

function cleanupStaging(staged: StagedBlob, appDataRoot?: string): void {
  removeRecoveryJournal(staged.journalPath, appDataRoot);
  removeOwnedStagingPath(staged.directory, appDataRoot);
}

export async function importBlob(
  store: DocumentStore,
  input: ImportBlobInput,
  options: ImportBlobOptions = {}
): Promise<ImportBlobResult> {
  const staged = await stageBlob(store, input, options);
  options.checkpoint?.("staged");
  const artifact = artifactFor(input, staged);
  const ownership = await store.transaction(({ blobs }) =>
    blobs.beginImport({
      byteLength: staged.byteLength,
      contentKey: staged.contentKey,
      importId: staged.importId,
      mediaType: staged.mediaType,
      sourceName: staged.sourceName
    })
  );

  if (ownership !== "owner") {
    const ready = ownership === "ready"
      ? await store.read(({ blobs }) => blobs.get(staged.contentKey))
      : await waitForReadyBlob(store, staged.contentKey);
    if (ready === undefined) {
      throw new BlobImportError("IMPORT_NOT_VISIBLE", "Deduplicated blob is not ready.");
    }
    if (artifact !== undefined) {
      await store.transaction(({ artifacts }) => artifacts.attach(artifact));
    }
    cleanupStaging(staged, options.appDataRoot);
    return { ...ready, deduplicated: true };
  }

  options.checkpoint?.("publishing");
  if (staged.byteLength <= INLINE_BLOB_LIMIT) {
    const data = await readFile(staged.chunks[0]?.path ?? "");
    await store.transaction(({ blobs }) => blobs.writeInline(staged.importId, staged.contentKey, data));
  } else {
    for (const chunk of staged.chunks) {
      const data = await readFile(chunk.path);
      if (
        data.byteLength !== chunk.byteLength ||
        createHash("sha256").update(data).digest("hex") !== chunk.sha256
      ) {
        throw new BlobImportError("CORRUPT_STAGING", "A staged blob chunk failed verification.");
      }
      await store.transaction(({ blobs }) =>
        blobs.writeChunk(staged.importId, staged.contentKey, chunk, data)
      );
      options.checkpoint?.(`chunk:${chunk.index}`);
    }
  }

  const ready = await store.transaction(({ artifacts, blobs }) => {
    const result = blobs.finalize(
      staged.importId,
      staged.contentKey,
      staged.byteLength <= INLINE_BLOB_LIMIT ? 0 : staged.chunks.length
    );
    if (artifact !== undefined) artifacts.attach(artifact);
    return result;
  });
  options.checkpoint?.("committed");
  cleanupStaging(staged, options.appDataRoot);
  return { ...ready, deduplicated: false };
}
