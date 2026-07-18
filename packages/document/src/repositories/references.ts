import {
  LinkedReferenceSchema,
  type LinkedReference,
  type ReferenceFileIdentity,
  type ReferenceFingerprint
} from "@ether/schema";
import { createHash } from "node:crypto";
import { open, stat } from "node:fs/promises";
import path from "node:path";

import { mediaSignatureMatches } from "./blobs.js";
import { DOCUMENT_STORE_INTERNAL, type DocumentStore } from "../documentStore.js";
import type { RepositoryTransactionContext } from "./graphs.js";

interface ReferenceRow {
  content_key: string | null;
  created_at: string;
  display_name: string;
  fingerprint_json: string;
  identity_json: string | null;
  media_type: string;
  original_path: string | null;
  path_grant_id: string | null;
  preview_content_key: string | null;
  reference_id: string;
  state: LinkedReference["state"];
  updated_at: string;
}

export class ReferenceRepository {
  constructor(private readonly context: RepositoryTransactionContext) {}

  get(id: string): LinkedReference | undefined {
    const row = this.context.database
      .prepare(
        `SELECT reference_id, content_key, preview_content_key, display_name, original_path,
                path_grant_id, media_type, state, identity_json, fingerprint_json,
                created_at, updated_at
         FROM linked_references WHERE reference_id = ?`
      )
      .get(id) as ReferenceRow | undefined;
    return row === undefined ? undefined : this.parse(row);
  }

  list(): LinkedReference[] {
    const rows = this.context.database
      .prepare("SELECT reference_id FROM linked_references ORDER BY reference_id")
      .all() as unknown as Array<{ reference_id: string }>;
    return rows
      .map(({ reference_id }) => this.get(reference_id))
      .filter((value): value is LinkedReference => value !== undefined);
  }

  put(input: LinkedReference): LinkedReference {
    const reference = LinkedReferenceSchema.parse(input);
    const readyMediaType = (contentKey: string | null): string | undefined => {
      if (contentKey === null) return undefined;
      return (this.context.database
        .prepare("SELECT media_type FROM blobs WHERE content_key = ? AND status = 'ready'")
        .get(contentKey) as { media_type: string } | undefined)?.media_type;
    };
    const previewMediaType = readyMediaType(reference.previewContentKey);
    const contentMediaType = readyMediaType(reference.contentKey);
    if (reference.state === "linked") {
      if (
        reference.originalPath === null ||
        reference.pathGrantId === null ||
        reference.identity === null ||
        reference.contentKey !== null ||
        previewMediaType !== reference.mediaType
      ) {
        throw new ReferenceError(
          "REFERENCE_STATE_MISMATCH",
          "Linked references require a grant-bound path, durable identity, and ready preview."
        );
      }
    }
    if (reference.state === "embedded") {
      if (
        reference.originalPath !== null ||
        reference.pathGrantId !== null ||
        reference.contentKey === null ||
        reference.previewContentKey === null ||
        contentMediaType !== reference.mediaType ||
        previewMediaType !== reference.mediaType
      ) {
        throw new ReferenceError(
          "REFERENCE_CONTENT_MISMATCH",
          "Embedded reference content and preview must be ready and media-consistent."
        );
      }
    } else if (reference.previewContentKey !== null && previewMediaType === undefined) {
      throw new ReferenceError("REFERENCE_CONTENT_MISMATCH", "Reference preview blob is not ready.");
    }
    this.context.database
      .prepare(
        `INSERT INTO linked_references (
           reference_id, content_key, preview_content_key, display_name, original_path,
           path_grant_id, expected_hash, media_type, state, identity_json,
           fingerprint_json, metadata_json, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, ?)
         ON CONFLICT(reference_id) DO UPDATE SET
           content_key = excluded.content_key,
           preview_content_key = excluded.preview_content_key,
           display_name = excluded.display_name,
           original_path = excluded.original_path,
           path_grant_id = excluded.path_grant_id,
           expected_hash = excluded.expected_hash,
           media_type = excluded.media_type,
           state = excluded.state,
           identity_json = excluded.identity_json,
           fingerprint_json = excluded.fingerprint_json,
           updated_at = excluded.updated_at`
      )
      .run(
        reference.id,
        reference.contentKey,
        reference.previewContentKey,
        reference.displayName,
        reference.originalPath,
        reference.pathGrantId,
        reference.fingerprint.sampleSha256,
        reference.mediaType,
        reference.state,
        reference.identity === null ? null : JSON.stringify(reference.identity),
        JSON.stringify(reference.fingerprint),
        reference.createdAt,
        reference.updatedAt
      );
    return reference;
  }

  remove(id: string): boolean {
    return this.context.database
      .prepare("DELETE FROM linked_references WHERE reference_id = ?")
      .run(id).changes === 1;
  }

  private parse(row: ReferenceRow): LinkedReference {
    return LinkedReferenceSchema.parse({
      id: row.reference_id,
      displayName: row.display_name,
      mediaType: row.media_type,
      state: row.state,
      originalPath: row.original_path,
      pathGrantId: row.path_grant_id,
      contentKey: row.content_key,
      previewContentKey: row.preview_content_key,
      identity: row.identity_json === null ? null : JSON.parse(row.identity_json),
      fingerprint: JSON.parse(row.fingerprint_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    });
  }
}

export class ReferenceError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ReferenceError";
    this.code = code;
  }
}

function persistReference(
  store: DocumentStore,
  reference: LinkedReference
): Promise<LinkedReference> {
  return store[DOCUMENT_STORE_INTERNAL]("write", ({ references }) => references.put(reference));
}

async function inspectReferenceFile(filePath: string, mediaType: string): Promise<{
  fingerprint: ReferenceFingerprint;
  identity: ReferenceFileIdentity;
}> {
  const resolved = path.resolve(filePath);
  const before = await stat(resolved, { bigint: true });
  if (!before.isFile()) throw new ReferenceError("REFERENCE_MISSING", "Reference is not a file.");
  const descriptor = await open(resolved, "r");
  const sampleSize = 64 * 1024;
  try {
    const first = Buffer.alloc(Math.min(sampleSize, Number(before.size)));
    const firstRead = await descriptor.read(first, 0, first.length, 0);
    const firstBytes = first.subarray(0, firstRead.bytesRead);
    if (!mediaSignatureMatches(firstBytes.subarray(0, 16), mediaType)) {
      throw new ReferenceError("MIME_MISMATCH", "Linked reference signature and media type differ.");
    }
    const lastOffset = before.size > BigInt(sampleSize) ? before.size - BigInt(sampleSize) : 0n;
    const last = Buffer.alloc(Math.min(sampleSize, Number(before.size)));
    const lastRead = await descriptor.read(last, 0, last.length, Number(lastOffset));
    const lastBytes = last.subarray(0, lastRead.bytesRead);
    const after = await descriptor.stat({ bigint: true });
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeNs !== after.mtimeNs
    ) {
      throw new ReferenceError("REFERENCE_CHANGED", "Reference changed while fingerprinting.");
    }
    const sampleSha256 = createHash("sha256")
      .update(before.size.toString())
      .update(firstBytes)
      .update(lastBytes)
      .digest("hex");
    return {
      identity: {
        platform: process.platform,
        device: before.dev.toString(),
        fileId: before.ino.toString()
      },
      fingerprint: {
        byteLength: Number(before.size),
        modifiedAt: Number(before.mtimeMs),
        sampleSha256
      }
    };
  } finally {
    await descriptor.close();
  }
}

function sameIdentity(
  left: ReferenceFileIdentity | null,
  right: ReferenceFileIdentity
): boolean {
  return left !== null &&
    left.platform === right.platform &&
    left.device === right.device &&
    left.fileId === right.fileId;
}

function sameFingerprint(left: ReferenceFingerprint, right: ReferenceFingerprint): boolean {
  return left.byteLength === right.byteLength && left.sampleSha256 === right.sampleSha256;
}

export async function linkReference(
  store: DocumentStore,
  input: {
    displayName: string;
    id: string;
    mediaType: string;
    pathGrantId: string;
    previewContentKey: string;
    sourcePath: string;
  }
): Promise<LinkedReference> {
  const resolved = path.resolve(input.sourcePath);
  store.authorizeReferencePath({
    grantId: input.pathGrantId,
    operation: "link",
    path: resolved
  });
  const inspected = await inspectReferenceFile(resolved, input.mediaType);
  store.validateReferenceFingerprint({
    fingerprint: inspected.fingerprint,
    grantId: input.pathGrantId,
    operation: "link",
    path: resolved
  });
  const timestamp = new Date().toISOString();
  const reference = LinkedReferenceSchema.parse({
    id: input.id,
    displayName: input.displayName,
    mediaType: input.mediaType,
    state: "linked",
    originalPath: resolved,
    pathGrantId: input.pathGrantId,
    contentKey: null,
    previewContentKey: input.previewContentKey,
    identity: inspected.identity,
    fingerprint: inspected.fingerprint,
    createdAt: timestamp,
    updatedAt: timestamp
  });
  return persistReference(store, reference);
}

async function missingReference(store: DocumentStore, reference: LinkedReference): Promise<LinkedReference> {
  const missing = LinkedReferenceSchema.parse({
    ...reference,
    state: "missing",
    updatedAt: new Date().toISOString()
  });
  return persistReference(store, missing);
}

export async function resolveReference(
  store: DocumentStore,
  referenceId: string
): Promise<LinkedReference> {
  const reference = await store.read(({ references }) => references.get(referenceId));
  if (reference === undefined) {
    throw new ReferenceError("REFERENCE_NOT_FOUND", `Reference ${referenceId} does not exist.`);
  }
  if (reference.originalPath === null || reference.pathGrantId === null) {
    return missingReference(store, reference);
  }
  try {
    store.authorizeReferencePath({
      grantId: reference.pathGrantId,
      operation: "resolve",
      path: reference.originalPath
    });
  } catch {
    return missingReference(store, reference);
  }
  try {
    const inspected = await inspectReferenceFile(reference.originalPath, reference.mediaType);
    try {
      store.validateReferenceFingerprint({
        fingerprint: inspected.fingerprint,
        grantId: reference.pathGrantId,
        operation: "resolve",
        path: reference.originalPath
      });
    } catch {
      return missingReference(store, reference);
    }
    if (
      !sameIdentity(reference.identity, inspected.identity) &&
      !sameFingerprint(reference.fingerprint, inspected.fingerprint)
    ) {
      return missingReference(store, reference);
    }
    const linked = LinkedReferenceSchema.parse({
      ...reference,
      state: "linked",
      identity: inspected.identity,
      fingerprint: inspected.fingerprint,
      updatedAt: new Date().toISOString()
    });
    return persistReference(store, linked);
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String((error as { code?: unknown }).code)
        : "";
    if (code === "ENOENT" || code === "REFERENCE_MISSING") {
      return missingReference(store, reference);
    }
    throw error;
  }
}

export async function relinkReference(
  store: DocumentStore,
  referenceId: string,
  sourcePath: string,
  pathGrantId: string
): Promise<LinkedReference> {
  const reference = await store.read(({ references }) => references.get(referenceId));
  if (reference === undefined) {
    throw new ReferenceError("REFERENCE_NOT_FOUND", `Reference ${referenceId} does not exist.`);
  }
  const resolved = path.resolve(sourcePath);
  store.authorizeReferencePath({
    grantId: pathGrantId,
    operation: "relink",
    path: resolved
  });
  const inspected = await inspectReferenceFile(resolved, reference.mediaType);
  store.validateReferenceFingerprint({
    fingerprint: inspected.fingerprint,
    grantId: pathGrantId,
    operation: "relink",
    path: resolved
  });
  if (
    !sameIdentity(reference.identity, inspected.identity) &&
    !sameFingerprint(reference.fingerprint, inspected.fingerprint)
  ) {
    throw new ReferenceError(
      "REFERENCE_IDENTITY_MISMATCH",
      "Relinked file does not match the durable identity or fingerprint."
    );
  }
  const relinked = LinkedReferenceSchema.parse({
    ...reference,
    state: "linked",
    originalPath: resolved,
    pathGrantId,
    identity: inspected.identity,
    fingerprint: inspected.fingerprint,
    updatedAt: new Date().toISOString()
  });
  return persistReference(store, relinked);
}

export async function revokeReferenceGrant(
  store: DocumentStore,
  referenceId: string
): Promise<LinkedReference> {
  const reference = await store.read(({ references }) => references.get(referenceId));
  if (reference === undefined) {
    throw new ReferenceError("REFERENCE_NOT_FOUND", `Reference ${referenceId} does not exist.`);
  }
  const grantId = reference.pathGrantId;
  const revoked = LinkedReferenceSchema.parse({
    ...reference,
    state: "missing",
    pathGrantId: null,
    updatedAt: new Date().toISOString()
  });
  const saved = await persistReference(store, revoked);
  if (grantId !== null) store.revokeReferenceGrantAuthority(grantId);
  return saved;
}

export async function embedReference(
  store: DocumentStore,
  referenceId: string,
  contentKey: string
): Promise<LinkedReference> {
  const reference = await store.read(({ references }) => references.get(referenceId));
  if (reference === undefined) {
    throw new ReferenceError("REFERENCE_NOT_FOUND", `Reference ${referenceId} does not exist.`);
  }
  const grantId = reference.pathGrantId;
  const embedded = LinkedReferenceSchema.parse({
    ...reference,
    state: "embedded",
    contentKey,
    originalPath: null,
    pathGrantId: null,
    updatedAt: new Date().toISOString()
  });
  const saved = await persistReference(store, embedded);
  if (grantId !== null) store.revokeReferenceGrantAuthority(grantId);
  return saved;
}

export async function embedReferences(
  store: DocumentStore,
  inputs: readonly { referenceId: string; contentKey: string }[]
): Promise<LinkedReference[]> {
  const grantsToRevoke: string[] = [];
  const embedded = await store[DOCUMENT_STORE_INTERNAL]("write", ({ references }) =>
    inputs.map(({ referenceId, contentKey }) => {
      const reference = references.get(referenceId);
      if (reference === undefined) {
        throw new ReferenceError("REFERENCE_NOT_FOUND", `Reference ${referenceId} does not exist.`);
      }
      if (reference.pathGrantId !== null) {
        grantsToRevoke.push(reference.pathGrantId);
      }
      return references.put(LinkedReferenceSchema.parse({
        ...reference,
        state: "embedded",
        contentKey,
        originalPath: null,
        pathGrantId: null,
        updatedAt: new Date().toISOString()
      }));
    })
  );
  for (const grantId of grantsToRevoke) store.revokeReferenceGrantAuthority(grantId);
  return embedded;
}
