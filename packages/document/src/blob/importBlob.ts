import { ArtifactSchema, type Artifact, type RecoveryJournalEntry } from "@ether/schema";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  DOCUMENT_STORE_INTERNAL,
  type DocumentStore
} from "../documentStore.js";
import {
  removeOwnedStagingPath,
  removeRecoveryJournal,
  resolveRecoveryRoots,
  writeRecoveryJournal
} from "../recovery/recoveryJournal.js";
import {
  BLOB_CHUNK_SIZE,
  INLINE_BLOB_LIMIT,
  mediaSignatureMatches,
  type BlobRecord
} from "../repositories/blobs.js";

export { mediaSignatureMatches } from "../repositories/blobs.js";

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
  journalEntry: RecoveryJournalEntry;
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
  const timestamp = now();
  let journalEntry: RecoveryJournalEntry = {
    id: importId,
    kind: "blob-import",
    state: "staged",
    documentId: store.documentId,
    documentPath: store.path,
    stagedPath: directory,
    sourceName: path.basename(sourcePath),
    mediaType: input.mediaType,
    createdAt: timestamp,
    updatedAt: timestamp
  };
  const journalPath = writeRecoveryJournal({ appDataRoot: roots.appDataRoot, entry: journalEntry });
  options.checkpoint?.("journal-created");
  await mkdir(directory, { recursive: true });
  options.checkpoint?.("staging-created");
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
      options.checkpoint?.(`chunk-staged:${index}`);
    }
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
    throw new BlobImportError("SOURCE_CHANGED", "Blob source changed while it was being staged.");
  }
  if (firstBytes === undefined || !mediaSignatureMatches(firstBytes, input.mediaType)) {
    throw new BlobImportError(
      "MIME_MISMATCH",
      `Declared media type ${input.mediaType} does not match the file signature.`
    );
  }
  const contentKey = wholeHash.digest("hex");
  journalEntry = {
    ...journalEntry,
    state: "validated",
    contentKey,
    byteLength: offset,
    updatedAt: now()
  };
  writeRecoveryJournal({ appDataRoot: roots.appDataRoot, entry: journalEntry });
  options.checkpoint?.("validated");
  return {
    byteLength: offset,
    chunks,
    contentKey,
    directory,
    importId,
    journalEntry,
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

async function waitForReadyBlob(
  store: DocumentStore,
  contentKey: string,
  expected: { byteLength: number; mediaType: string }
): Promise<BlobRecord> {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const record = await store.read(({ blobs }) => blobs.get(contentKey));
    if (record !== undefined) {
      return store[DOCUMENT_STORE_INTERNAL]("read", ({ blobs }) =>
        blobs.verifyReady(contentKey, expected)
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new BlobImportError("IMPORT_BUSY", "Another import did not finish in time.");
}

function cleanupStaging(staged: StagedBlob, appDataRoot?: string): void {
  removeOwnedStagingPath(staged.directory, appDataRoot);
  removeRecoveryJournal(staged.journalPath, appDataRoot);
}

function updateJournal(
  staged: StagedBlob,
  state: RecoveryJournalEntry["state"],
  appDataRoot?: string
): void {
  staged.journalEntry = { ...staged.journalEntry, state, updatedAt: now() };
  writeRecoveryJournal({ appDataRoot, entry: staged.journalEntry });
}

export async function importBlob(
  store: DocumentStore,
  input: ImportBlobInput,
  options: ImportBlobOptions = {}
): Promise<ImportBlobResult> {
  const staged = await stageBlob(store, input, options);
  options.checkpoint?.("staged");
  const artifact = artifactFor(input, staged);
  if (artifact !== undefined) {
    await store[DOCUMENT_STORE_INTERNAL]("read", ({ artifacts }) =>
      artifacts.validateProvenance(artifact)
    );
  }
  const ownership = await store[DOCUMENT_STORE_INTERNAL]("write", ({ blobs }) =>
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
      ? await store[DOCUMENT_STORE_INTERNAL]("read", ({ blobs }) =>
          blobs.verifyReady(staged.contentKey, {
            byteLength: staged.byteLength,
            mediaType: staged.mediaType
          })
        )
      : await waitForReadyBlob(store, staged.contentKey, {
          byteLength: staged.byteLength,
          mediaType: staged.mediaType
        });
    if (ready === undefined) {
      throw new BlobImportError("IMPORT_NOT_VISIBLE", "Deduplicated blob is not ready.");
    }
    if (artifact !== undefined) {
      await store[DOCUMENT_STORE_INTERNAL]("write", ({ artifacts }) => artifacts.attach(artifact));
    }
    updateJournal(staged, "committed", options.appDataRoot);
    cleanupStaging(staged, options.appDataRoot);
    return { ...ready, deduplicated: true };
  }

  updateJournal(staged, "publishing", options.appDataRoot);
  options.checkpoint?.("publishing");
  if (staged.byteLength <= INLINE_BLOB_LIMIT) {
    const data = await readFile(staged.chunks[0]?.path ?? "");
    const chunk = staged.chunks[0];
    if (
      chunk === undefined ||
      data.byteLength !== chunk.byteLength ||
      createHash("sha256").update(data).digest("hex") !== chunk.sha256
    ) {
      throw new BlobImportError("CORRUPT_STAGING", "Inline staged bytes failed verification.");
    }
    await store[DOCUMENT_STORE_INTERNAL]("write", ({ blobs }) =>
      blobs.writeInline(staged.importId, staged.contentKey, data)
    );
  } else {
    for (const chunk of staged.chunks) {
      const data = await readFile(chunk.path);
      if (
        data.byteLength !== chunk.byteLength ||
        createHash("sha256").update(data).digest("hex") !== chunk.sha256
      ) {
        throw new BlobImportError("CORRUPT_STAGING", "A staged blob chunk failed verification.");
      }
      await store[DOCUMENT_STORE_INTERNAL]("write", ({ blobs }) =>
        blobs.writeChunk(staged.importId, staged.contentKey, chunk, data)
      );
      options.checkpoint?.(`chunk:${chunk.index}`);
    }
  }

  options.checkpoint?.("before-finalize");
  const ready = await store[DOCUMENT_STORE_INTERNAL]("write", ({ artifacts, blobs }) => {
    const result = blobs.finalize(staged.importId, staged.contentKey);
    if (artifact !== undefined) artifacts.attach(artifact);
    return result;
  });
  try {
    updateJournal(staged, "committed", options.appDataRoot);
    options.checkpoint?.("committed");
  } catch (error) {
    try {
      cleanupStaging(staged, options.appDataRoot);
    } catch {
      // Preserve the publication error; document-level cleanup reclaims the unreferenced ready blob.
    }
    throw error;
  }
  cleanupStaging(staged, options.appDataRoot);
  return { ...ready, deduplicated: false };
}
