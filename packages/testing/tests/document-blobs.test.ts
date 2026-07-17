import * as documentPackage from "@ether/document";
import type { Artifact, EtherGraph, LinkedReference } from "@ether/schema";
import { createHash } from "node:crypto";
import { mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
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
}

interface Task6Store {
  close(): Promise<void>;
  path: string;
  read<T>(callback: (repositories: Task6Repositories) => T): Promise<T>;
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
  readBlobRange(
    store: Task6Store,
    contentKey: string,
    start: number,
    endExclusive: number
  ): Promise<Buffer>;
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
    nodes: [],
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

async function createStore(filePath: string, appDataRoot: string): Promise<Task6Store> {
  const DocumentStore = documentPackage.DocumentStore;
  return DocumentStore.create(filePath, {
    appVersion: "4.0.0",
    documentId: `document-${path.basename(filePath, ".ether")}`,
    environment: {
      leaseRoot: path.join(appDataRoot, "leases"),
      recoveryRoot: path.join(appDataRoot, "recovery"),
      locationCapability: { classify: () => "local-fixed" }
    },
    initialGraph: graph(),
    title: "Campaign"
  }) as Promise<Task6Store>;
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

  it("atomically attaches a generated artifact with schema provenance", async () => {
    const store = await createStore(filePath, appDataRoot);
    stores.push(store);
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

  it("tracks missing links, revoked grants, and relinks only matching durable identity", async () => {
    const store = await createStore(filePath, appDataRoot);
    stores.push(store);
    const previewPath = path.join(root, "preview.png");
    const linkedPath = path.join(root, "linked.png");
    const movedPath = path.join(root, "moved.png");
    writeFileSync(previewPath, pngBytes(512, 0x22));
    writeFileSync(linkedPath, pngBytes(4096, 0x44));
    const preview = await api().importBlob(store, { sourcePath: previewPath, mediaType: "image/png" }, { appDataRoot });

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
    await expect(api().relinkReference(store, linked.id, movedPath, "grant-2")).resolves.toMatchObject({ state: "linked", pathGrantId: "grant-2" });
    await expect(api().revokeReferenceGrant(store, linked.id)).resolves.toMatchObject({ state: "missing", pathGrantId: null });

    const wrongPath = path.join(root, "wrong.png");
    writeFileSync(wrongPath, pngBytes(4096, 0x55));
    await expect(api().relinkReference(store, linked.id, wrongPath, "grant-3")).rejects.toMatchObject({ code: "REFERENCE_IDENTITY_MISMATCH" });
  });
});
