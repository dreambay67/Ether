import * as documentPackage from "@ether/document";
import type {
  Artifact,
  EtherGraph,
  LinkedReference,
  NodeOutputVersion,
  PayloadEnvelope
} from "@ether/schema";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const INLINE_LIMIT = 256 * 1024;
const CHUNK_SIZE = 4 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

interface BlobRecord {
  byteLength: number;
  chunkCount: number;
  contentKey: string;
  mediaType: string;
  storage: "inline" | "chunked";
}

interface BlobImportResult extends BlobRecord {
  deduplicated: boolean;
}

interface Task6Repositories {
  artifacts: { get(id: string): Artifact | undefined };
  blobs: { get(contentKey: string): BlobRecord | undefined };
  references: { get(id: string): LinkedReference | undefined };
  revisions: { head(): { graphRevisions: Record<string, string> } };
}

interface GrantRequest {
  documentId: string;
  fingerprint: { byteLength: number; sampleSha256: string };
  grantId: string;
  operation: "link" | "relink" | "resolve";
  path: string;
}

class TestGrantAuthority {
  private readonly grants = new Map<string, {
    documentId?: string;
    fingerprint?: string;
    path: string;
    revoked: boolean;
  }>();

  issue(grantId: string, filePath: string): void {
    this.grants.set(grantId, { path: path.resolve(filePath), revoked: false });
  }

  revoke(grantId: string): void {
    const grant = this.grants.get(grantId);
    if (grant !== undefined) grant.revoked = true;
  }

  validate(request: GrantRequest): boolean {
    const grant = this.grants.get(request.grantId);
    if (grant === undefined || grant.revoked || grant.path !== path.resolve(request.path)) return false;
    if (grant.documentId !== undefined && grant.documentId !== request.documentId) return false;
    if (grant.fingerprint !== undefined && grant.fingerprint !== request.fingerprint.sampleSha256) return false;
    grant.documentId ??= request.documentId;
    grant.fingerprint ??= request.fingerprint.sampleSha256;
    return true;
  }
}

interface Task6Store {
  close(): Promise<void>;
  documentId: string;
  path: string;
  read<T>(callback: (repositories: Task6Repositories) => T): Promise<T>;
  transaction<T>(callback: (repositories: {
    blobs: Record<string, unknown>;
    outputs: { insert(version: NodeOutputVersion, payloads: PayloadEnvelope[]): void };
    artifacts: { attach(artifact: Artifact): Artifact };
  }) => T): Promise<T>;
}

interface Task6Api {
  importBlob(
    store: Task6Store,
    input: {
      artifact?: Omit<Artifact, "byteLength" | "contentKey">;
      mediaType: string;
      sourcePath: string;
    },
    options?: { appDataRoot?: string; checkpoint?: (name: string) => void }
  ): Promise<BlobImportResult>;
  linkReference(
    store: Task6Store,
    input: {
      displayName: string;
      id: string;
      mediaType: string;
      pathGrantId: string;
      previewContentKey: string;
      sourcePath: string;
    }
  ): Promise<LinkedReference>;
  embedReference(
    store: Task6Store,
    referenceId: string,
    contentKey: string
  ): Promise<LinkedReference>;
  readBlobRange(
    store: Task6Store,
    contentKey: string,
    start: number,
    endExclusive: number
  ): Promise<Buffer>;
  streamBlobRange(
    store: Task6Store,
    contentKey: string,
    start: number,
    endExclusive: number
  ): AsyncIterable<Buffer>;
  reconcileStaging(store: Task6Store, options: { appDataRoot: string }): Promise<{
    quarantined: string[];
    recovered: string[];
    removed: string[];
  }>;
  relinkReference(
    store: Task6Store,
    referenceId: string,
    sourcePath: string,
    pathGrantId: string
  ): Promise<LinkedReference>;
  resolveReference(store: Task6Store, referenceId: string): Promise<LinkedReference>;
  revokeReferenceGrant(store: Task6Store, referenceId: string): Promise<LinkedReference>;
}

function api(): Task6Api {
  return documentPackage as unknown as Task6Api;
}

function graph(): EtherGraph {
  const now = "2026-07-17T08:00:00.000Z";
  return {
    id: "graph-root",
    title: "Campaign",
    kind: "root",
    createdAt: now,
    updatedAt: now,
    nodes: [
      {
        id: "prompt-1",
        definitionId: "prompt.text",
        title: "Campaign prompt",
        position: { x: 40, y: 60 },
        size: { width: 220, height: 140 },
        config: { kind: "prompt.text", body: "Campaign", assembly: "append" },
        presentation: { collapsed: false, accent: "default", previewMode: "summary" }
      }
    ],
    edges: [],
    groups: [],
    modules: [],
    viewState: {
      viewport: { x: 0, y: 0, zoom: 1 },
      selectedNodeIds: [],
      selectedEdgeIds: [],
      inspectorTarget: null
    }
  };
}

function pngBytes(byteLength: number, seed = 0x31): Buffer {
  const bytes = Buffer.alloc(byteLength, seed);
  PNG_SIGNATURE.copy(bytes);
  return bytes;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function createStore(
  filePath: string,
  appDataRoot: string,
  grantAuthority?: TestGrantAuthority
): Promise<Task6Store> {
  const DocumentStore = documentPackage.DocumentStore;
  return DocumentStore.create(filePath, {
    appVersion: "4.0.0",
    documentId: `document-${path.basename(filePath, ".ether")}`,
    environment: {
      leaseRoot: path.join(appDataRoot, "leases"),
      recoveryRoot: path.join(appDataRoot, "recovery"),
      referenceGrantAuthority: grantAuthority,
      locationCapability: { classify: () => "local-fixed" }
    },
    initialGraph: graph(),
    title: "Campaign"
  }) as Promise<Task6Store>;
}

async function createProvenance(
  store: Task6Store,
  outputVersionId: string,
  payloadId: string,
  channel: PayloadEnvelope["channel"] = "image"
): Promise<void> {
  const head = await store.read(({ revisions }) => revisions.head());
  const version: NodeOutputVersion = {
    id: outputVersionId,
    nodeId: "prompt-1",
    graphId: "graph-root",
    graphRevisionId: head.graphRevisions["graph-root"],
    inputPayloadIds: [],
    selectedOutputVersionIds: [],
    compiledContextHash: "sha256:artifact",
    producer: { kind: "local", executor: "deterministic-assembly" },
    outputPayloadIds: [payloadId],
    parentOutputVersionId: null,
    approval: { state: "unreviewed" },
    runId: null,
    stepId: null,
    workItemId: null,
    attemptId: null,
    timing: {
      startedAt: "2026-07-17T08:00:00.000Z",
      completedAt: "2026-07-17T08:00:01.000Z"
    },
    failure: null,
    createdAt: "2026-07-17T08:00:01.000Z"
  };
  const payload: PayloadEnvelope = {
    id: payloadId,
    channel,
    role: "general",
    content: { kind: "object", value: { generated: true } },
    source: { nodeId: "prompt-1", outputVersionId, lineageKey: `lineage-${payloadId}` },
    metadata: {}
  };
  await store.transaction(({ outputs }) => outputs.insert(version, [payload]));
}

describe("Ether embedded blobs and linked references", () => {
  let root: string;
  let appDataRoot: string;
  let filePath: string;
  const stores: Task6Store[] = [];

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "ether-document-blobs-"));
    appDataRoot = path.join(root, "AppData", "DreamBay", "Ether");
    filePath = path.join(root, "Campaign.ether");
  });

  afterEach(async () => {
    await Promise.all(stores.splice(0).map((store) => store.close()));
    rmSync(root, { recursive: true, force: true });
  });

  it("stores 256 KiB inline and moves the next byte to ordered chunks", async () => {
    const store = await createStore(filePath, appDataRoot);
    stores.push(store);
    const inlinePath = path.join(root, "inline.png");
    const chunkedPath = path.join(root, "chunked.png");
    writeFileSync(inlinePath, pngBytes(INLINE_LIMIT));
    writeFileSync(chunkedPath, pngBytes(INLINE_LIMIT + 1));

    const inline = await api().importBlob(store, { sourcePath: inlinePath, mediaType: "image/png" }, { appDataRoot });
    const chunked = await api().importBlob(store, { sourcePath: chunkedPath, mediaType: "image/png" }, { appDataRoot });

    expect(inline).toMatchObject({ byteLength: INLINE_LIMIT, storage: "inline", chunkCount: 0 });
    expect(chunked).toMatchObject({ byteLength: INLINE_LIMIT + 1, storage: "chunked", chunkCount: 1 });
  });

  it("uses exact 4 MiB chunk boundaries and reads only an intersecting byte range", async () => {
    const store = await createStore(filePath, appDataRoot);
    stores.push(store);
    const sourcePath = path.join(root, "large.png");
    const bytes = pngBytes(CHUNK_SIZE + 37);
    writeFileSync(sourcePath, bytes);

    const imported = await api().importBlob(store, { sourcePath, mediaType: "image/png" }, { appDataRoot });
    expect(imported).toMatchObject({ chunkCount: 2, byteLength: bytes.length, storage: "chunked" });
    await expect(api().readBlobRange(store, imported.contentKey, CHUNK_SIZE - 11, CHUNK_SIZE + 19)).resolves.toEqual(
      bytes.subarray(CHUNK_SIZE - 11, CHUNK_SIZE + 19)
    );
    await expect(api().readBlobRange(store, imported.contentKey, -1, 4)).rejects.toMatchObject({ code: "INVALID_RANGE" });
  });

  it("keeps low-level blob mutation and row-loading methods off public transaction facades", async () => {
    const store = await createStore(filePath, appDataRoot);
    stores.push(store);

    const methods = await store.transaction(({ blobs }) => Object.keys(blobs).sort());
    expect(methods).toEqual(["get", "list"]);
    expect(methods).not.toEqual(expect.arrayContaining([
      "beginImport",
      "finalize",
      "readParts",
      "removeIncomplete",
      "writeChunk",
      "writeInline"
    ]));
  });

  it("streams one verified intersecting chunk at a time and caps Buffer convenience reads", async () => {
    const store = await createStore(filePath, appDataRoot);
    stores.push(store);
    const sourcePath = path.join(root, "streamed.png");
    const bytes = pngBytes(CHUNK_SIZE * 2 + 17, 0x5a);
    writeFileSync(sourcePath, bytes);
    const imported = await api().importBlob(store, { sourcePath, mediaType: "image/png" }, { appDataRoot });

    const streamedHash = createHash("sha256");
    let streamedLength = 0;
    let largestPart = 0;
    for await (const part of api().streamBlobRange(store, imported.contentKey, 7, bytes.length - 5)) {
      largestPart = Math.max(largestPart, part.byteLength);
      streamedHash.update(part);
      streamedLength += part.byteLength;
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    expect(largestPart).toBeLessThanOrEqual(CHUNK_SIZE);
    expect(streamedLength).toBe(bytes.length - 12);
    expect(streamedHash.digest("hex")).toBe(sha256(bytes.subarray(7, bytes.length - 5)));
    await expect(
      api().readBlobRange(store, imported.contentKey, 0, bytes.length)
    ).rejects.toMatchObject({ code: "RANGE_TOO_LARGE" });
  }, 30_000);

  it("deduplicates duplicate and concurrent imports by whole-file SHA-256", async () => {
    const store = await createStore(filePath, appDataRoot);
    stores.push(store);
    const firstPath = path.join(root, "first.png");
    const secondPath = path.join(root, "second.png");
    const bytes = pngBytes(CHUNK_SIZE + 1);
    writeFileSync(firstPath, bytes);
    writeFileSync(secondPath, bytes);

    const [first, second] = await Promise.all([
      api().importBlob(store, { sourcePath: firstPath, mediaType: "image/png" }, { appDataRoot }),
      api().importBlob(store, { sourcePath: secondPath, mediaType: "image/png" }, { appDataRoot })
    ]);

    expect(first.contentKey).toBe(sha256(bytes));
    expect(second.contentKey).toBe(first.contentKey);
    expect([first.deduplicated, second.deduplicated].sort()).toEqual([false, true]);
  });

  it("keeps a partially published chunk import invisible and safely reclaimable", async () => {
    const store = await createStore(filePath, appDataRoot);
    stores.push(store);
    const sourcePath = path.join(root, "interrupted.png");
    const bytes = pngBytes(CHUNK_SIZE + 9);
    writeFileSync(sourcePath, bytes);

    await expect(
      api().importBlob(store, { sourcePath, mediaType: "image/png" }, {
        appDataRoot,
        checkpoint: (name) => {
          if (name === "chunk:0") throw new Error("injected interruption");
        }
      })
    ).rejects.toThrow("injected interruption");

    await expect(store.read(({ blobs }) => blobs.get(sha256(bytes)))).resolves.toBeUndefined();
    expect(path.dirname(filePath)).not.toContain(path.join("DreamBay", "Ether", "staging"));
    await expect(api().reconcileStaging(store, { appDataRoot })).resolves.toMatchObject({
      removed: [expect.stringMatching(/^blob-import-/)]
    });
    await expect(
      api().importBlob(store, { sourcePath, mediaType: "image/png" }, { appDataRoot })
    ).resolves.toMatchObject({ contentKey: sha256(bytes), deduplicated: false });
  });

  it("rehashes inline staging immediately before publication", async () => {
    const store = await createStore(filePath, appDataRoot);
    stores.push(store);
    const sourcePath = path.join(root, "inline-tamper.png");
    writeFileSync(sourcePath, pngBytes(4096, 0x48));

    await expect(
      api().importBlob(store, { sourcePath, mediaType: "image/png" }, {
        appDataRoot,
        checkpoint: (name) => {
          if (name !== "validated") return;
          const importRoot = path.join(appDataRoot, "staging", "imports");
          const importDirectory = readdirSync(importRoot)[0];
          const chunkPath = path.join(importRoot, importDirectory, "00000000.chunk");
          writeFileSync(chunkPath, pngBytes(4096, 0x49));
        }
      })
    ).rejects.toMatchObject({ code: "CORRUPT_STAGING" });
  });

  it("binds every mutation and finalization to the exact import ID and content key", async () => {
    const store = await createStore(filePath, appDataRoot);
    stores.push(store);
    const sourcePath = path.join(root, "binding.png");
    writeFileSync(sourcePath, pngBytes(CHUNK_SIZE + 17, 0x68));

    await expect(
      api().importBlob(store, { sourcePath, mediaType: "image/png" }, {
        appDataRoot,
        checkpoint: (name) => {
          if (name !== "chunk:0") return;
          const database = new DatabaseSync(filePath);
          database.prepare("UPDATE blob_imports SET content_key = NULL WHERE state = 'streaming'").run();
          database.close();
        }
      })
    ).rejects.toMatchObject({ code: "IMPORT_BINDING_MISMATCH" });
  });

  it("finalization independently rejects missing or tampered stored chunks", async () => {
    const store = await createStore(filePath, appDataRoot);
    stores.push(store);
    const sourcePath = path.join(root, "finalize-tamper.png");
    writeFileSync(sourcePath, pngBytes(CHUNK_SIZE + 17, 0x71));

    await expect(
      api().importBlob(store, { sourcePath, mediaType: "image/png" }, {
        appDataRoot,
        checkpoint: (name) => {
          if (name !== "before-finalize") return;
          const database = new DatabaseSync(filePath);
          database.prepare("DELETE FROM blob_chunks WHERE chunk_index = 0").run();
          database.close();
        }
      })
    ).rejects.toMatchObject({ code: "INCOMPLETE_IMPORT" });
  });

  it("finalization independently rehashes persisted inline bytes", async () => {
    const store = await createStore(filePath, appDataRoot);
    stores.push(store);
    const sourcePath = path.join(root, "inline-finalize.png");
    writeFileSync(sourcePath, pngBytes(4096, 0x72));

    await expect(
      api().importBlob(store, { sourcePath, mediaType: "image/png" }, {
        appDataRoot,
        checkpoint: (name) => {
          if (name !== "before-finalize") return;
          const database = new DatabaseSync(filePath);
          database.prepare("UPDATE blobs SET inline_data = ? WHERE status = 'importing'").run(
            pngBytes(4096, 0x73)
          );
          database.close();
        }
      })
    ).rejects.toMatchObject({ code: "CORRUPT_STAGING" });
  });

  it("rejects declared MIME that disagrees with the media signature", async () => {
    const store = await createStore(filePath, appDataRoot);
    stores.push(store);
    const sourcePath = path.join(root, "actually-png.jpg");
    writeFileSync(sourcePath, pngBytes(1024));

    await expect(
      api().importBlob(store, { sourcePath, mediaType: "image/jpeg" }, { appDataRoot })
    ).rejects.toMatchObject({ code: "MIME_MISMATCH" });
  });

  it("detects corrupt chunk length or hash before returning bytes", async () => {
    const store = await createStore(filePath, appDataRoot);
    stores.push(store);
    const sourcePath = path.join(root, "corrupt.png");
    writeFileSync(sourcePath, pngBytes(CHUNK_SIZE + 4));
    const imported = await api().importBlob(store, { sourcePath, mediaType: "image/png" }, { appDataRoot });
    await store.close();
    stores.splice(stores.indexOf(store), 1);

    const database = new DatabaseSync(filePath);
    database.prepare("UPDATE blob_chunks SET data = ? WHERE content_key = ? AND chunk_index = 1").run(Buffer.from("bad"), imported.contentKey);
    database.close();

    const reopened = (await documentPackage.DocumentStore.open(filePath, { access: "read-only" })) as Task6Store;
    stores.push(reopened);
    await expect(api().readBlobRange(reopened, imported.contentKey, CHUNK_SIZE, CHUNK_SIZE + 4)).rejects.toMatchObject({ code: "CORRUPT_BLOB_CHUNK" });
  });

  it("rejects a corrupt ready row instead of deduplicating to it", async () => {
    const store = await createStore(filePath, appDataRoot);
    stores.push(store);
    const sourcePath = path.join(root, "dedupe-corrupt.png");
    const bytes = pngBytes(4096, 0x76);
    writeFileSync(sourcePath, bytes);
    await api().importBlob(store, { sourcePath, mediaType: "image/png" }, { appDataRoot });
    await store.close();
    stores.splice(stores.indexOf(store), 1);
    const database = new DatabaseSync(filePath);
    database.prepare("UPDATE blobs SET inline_data = ? WHERE content_key = ?").run(
      pngBytes(4096, 0x77),
      sha256(bytes)
    );
    database.close();
    const reopened = (await documentPackage.DocumentStore.open(filePath, {
      access: "require-write",
      environment: {
        leaseRoot: path.join(appDataRoot, "leases"),
        recoveryRoot: path.join(appDataRoot, "recovery"),
        locationCapability: { classify: () => "local-fixed" }
      }
    })) as Task6Store;
    stores.push(reopened);

    await expect(
      api().importBlob(reopened, { sourcePath, mediaType: "image/png" }, { appDataRoot })
    ).rejects.toMatchObject({ code: "CORRUPT_DEDUPLICATE" });
  });

  it("atomically attaches a generated artifact with schema provenance", async () => {
    const store = await createStore(filePath, appDataRoot);
    stores.push(store);
    await createProvenance(store, "output-1", "payload-1");
    const sourcePath = path.join(root, "generated.png");
    writeFileSync(sourcePath, pngBytes(2048));
    const artifact = {
      id: "artifact-generated",
      channel: "image",
      mediaType: "image/png",
      source: { outputVersionId: "output-1", payloadId: "payload-1" },
      createdAt: "2026-07-17T08:01:00.000Z",
      metadata: { provider: "fake" }
    } as const;

    const imported = await api().importBlob(store, { sourcePath, mediaType: "image/png", artifact }, { appDataRoot });
    await expect(store.read(({ artifacts }) => artifacts.get(artifact.id))).resolves.toEqual({
      ...artifact,
      contentKey: imported.contentKey,
      byteLength: 2048
    });
  });

  it("rejects missing, cross-output, and channel-mismatched artifact provenance", async () => {
    const store = await createStore(filePath, appDataRoot);
    stores.push(store);
    await createProvenance(store, "output-image", "payload-image", "image");
    await createProvenance(store, "output-audio", "payload-audio", "audio");
    const sourcePath = path.join(root, "provenance.png");
    writeFileSync(sourcePath, pngBytes(2048, 0x29));
    const base = {
      id: "artifact-provenance",
      channel: "image",
      mediaType: "image/png",
      createdAt: "2026-07-17T08:01:00.000Z",
      metadata: {}
    } as const;

    await expect(api().importBlob(store, {
      sourcePath,
      mediaType: "image/png",
      artifact: { ...base, source: { outputVersionId: "missing", payloadId: "missing" } }
    }, { appDataRoot })).rejects.toMatchObject({ code: "ARTIFACT_PROVENANCE_MISMATCH" });
    await expect(api().importBlob(store, {
      sourcePath,
      mediaType: "image/png",
      artifact: { ...base, id: "artifact-cross", source: { outputVersionId: "output-image", payloadId: "payload-audio" } }
    }, { appDataRoot })).rejects.toMatchObject({ code: "ARTIFACT_PROVENANCE_MISMATCH" });
    await expect(api().importBlob(store, {
      sourcePath,
      mediaType: "image/png",
      artifact: { ...base, id: "artifact-channel", source: { outputVersionId: "output-audio", payloadId: "payload-audio" } }
    }, { appDataRoot })).rejects.toMatchObject({ code: "ARTIFACT_PROVENANCE_MISMATCH" });
  });

  it("declares artifact provenance as a composite foreign-key relationship", async () => {
    const store = await createStore(filePath, appDataRoot);
    stores.push(store);
    await store.close();
    stores.splice(stores.indexOf(store), 1);
    const database = new DatabaseSync(filePath, { readOnly: true });
    const foreignKeys = database.prepare("PRAGMA foreign_key_list(artifacts)").all() as Array<{
      from: string;
      table: string;
      to: string;
    }>;
    database.close();
    expect(foreignKeys.filter((key) => key.table === "node_output_payloads")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ from: "source_output_version_id", to: "output_version_id" }),
        expect.objectContaining({ from: "source_payload_id", to: "payload_id" })
      ])
    );
  });

  it("tracks missing links, revoked grants, and relinks only matching durable identity", async () => {
    const grantAuthority = new TestGrantAuthority();
    const store = await createStore(filePath, appDataRoot, grantAuthority);
    stores.push(store);
    const previewPath = path.join(root, "preview.png");
    const linkedPath = path.join(root, "linked.png");
    const movedPath = path.join(root, "moved.png");
    writeFileSync(previewPath, pngBytes(512, 0x22));
    writeFileSync(linkedPath, pngBytes(4096, 0x44));
    const preview = await api().importBlob(store, { sourcePath: previewPath, mediaType: "image/png" }, { appDataRoot });
    await expect(api().linkReference(store, {
      id: "reference-1",
      displayName: "Linked image",
      sourcePath: linkedPath,
      mediaType: "image/png",
      pathGrantId: "grant-arbitrary",
      previewContentKey: preview.contentKey
    })).rejects.toMatchObject({ code: "REFERENCE_GRANT_DENIED" });
    grantAuthority.issue("grant-1", linkedPath);

    const linked = await api().linkReference(store, {
      id: "reference-1",
      displayName: "Linked image",
      sourcePath: linkedPath,
      mediaType: "image/png",
      pathGrantId: "grant-1",
      previewContentKey: preview.contentKey
    });
    expect(linked).toMatchObject({ state: "linked", previewContentKey: preview.contentKey, pathGrantId: "grant-1" });

    renameSync(linkedPath, movedPath);
    await expect(api().resolveReference(store, linked.id)).resolves.toMatchObject({ state: "missing" });
    grantAuthority.issue("grant-2", movedPath);
    await expect(api().relinkReference(store, linked.id, movedPath, "grant-2")).resolves.toMatchObject({ state: "linked", pathGrantId: "grant-2" });
    grantAuthority.revoke("grant-2");
    await expect(api().resolveReference(store, linked.id)).resolves.toMatchObject({ state: "missing" });
    await expect(api().revokeReferenceGrant(store, linked.id)).resolves.toMatchObject({ state: "missing", pathGrantId: null });

    const wrongPath = path.join(root, "wrong.png");
    writeFileSync(wrongPath, pngBytes(4096, 0x55));
    grantAuthority.issue("grant-3", wrongPath);
    await expect(api().relinkReference(store, linked.id, wrongPath, "grant-3")).rejects.toMatchObject({ code: "REFERENCE_IDENTITY_MISMATCH" });
  });

  it("requires media-consistent ready content and preview blobs for embedded references", async () => {
    const grantAuthority = new TestGrantAuthority();
    const store = await createStore(filePath, appDataRoot, grantAuthority);
    stores.push(store);
    const linkedPath = path.join(root, "embedded-source.png");
    const previewPath = path.join(root, "embedded-preview.png");
    const contentPath = path.join(root, "embedded-content.png");
    writeFileSync(linkedPath, pngBytes(4096, 0x61));
    writeFileSync(previewPath, pngBytes(512, 0x62));
    writeFileSync(contentPath, pngBytes(8192, 0x63));
    const preview = await api().importBlob(store, { sourcePath: previewPath, mediaType: "image/png" }, { appDataRoot });
    const content = await api().importBlob(store, { sourcePath: contentPath, mediaType: "image/png" }, { appDataRoot });
    grantAuthority.issue("grant-embedded", linkedPath);
    const linked = await api().linkReference(store, {
      id: "reference-embedded",
      displayName: "Embedded image",
      sourcePath: linkedPath,
      mediaType: "image/png",
      pathGrantId: "grant-embedded",
      previewContentKey: preview.contentKey
    });

    await expect(api().embedReference(store, linked.id, content.contentKey)).resolves.toMatchObject({
      state: "embedded",
      contentKey: content.contentKey,
      previewContentKey: preview.contentKey,
      originalPath: null,
      pathGrantId: null
    });
    await expect(api().embedReference(store, linked.id, "0".repeat(64))).rejects.toMatchObject({
      code: "REFERENCE_CONTENT_MISMATCH"
    });
  });
});
