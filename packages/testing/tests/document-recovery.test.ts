import * as documentPackage from "@ether/document";
import type { Artifact, EtherGraph, PreparedGraphCommit } from "@ether/schema";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

interface Task6Store {
  close(): Promise<void>;
  documentId: string;
  read<T>(callback: (repositories: {
    artifacts: { get(id: string): Artifact | undefined };
    blobs: { get(contentKey: string): unknown };
    graphs: { list(): EtherGraph[] };
    revisions: { head(): { documentRevisionId: string; graphRevisions: Record<string, string> } };
  }) => T): Promise<T>;
  transaction<T>(callback: (repositories: {
    revisions: { commit(input: PreparedGraphCommit): unknown };
  }) => T): Promise<T>;
}

interface RecoveryApi {
  importBlob(
    store: Task6Store,
    input: {
      artifact?: Omit<Artifact, "byteLength" | "contentKey">;
      mediaType: string;
      sourcePath: string;
    },
    options?: { appDataRoot?: string; checkpoint?: (name: string) => void }
  ): Promise<{ contentKey: string }>;
  reconcileStaging(store: Task6Store, options: { appDataRoot: string }): Promise<{
    quarantined: string[];
    recovered: string[];
    removed: string[];
  }>;
  repairDocument(sourcePath: string, destinationPath: string, options: {
    appDataRoot: string;
    environment: object;
  }): Promise<{
    destinationPath: string;
    losses: Array<{ entityId: string; reason: string; type: string }>;
    recovered: { artifacts: number; blobs: number };
  }>;
  writeRecoveryJournal(options: {
    appDataRoot: string;
    entry: {
      artifact?: Omit<Artifact, "byteLength" | "contentKey">;
      createdAt: string;
      documentId: string;
      documentPath: string;
      id: string;
      kind: "provider-output";
      mediaType: string;
      sourceName: string;
      stagedPath: string;
      state: "staged";
      updatedAt: string;
    };
  }): string;
}

function api(): RecoveryApi {
  return documentPackage as unknown as RecoveryApi;
}

function graph(): EtherGraph {
  const now = "2026-07-17T08:00:00.000Z";
  return {
    id: "graph-root",
    title: "Recovery",
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

function pngBytes(length: number, seed: number): Buffer {
  const bytes = Buffer.alloc(length, seed);
  PNG_SIGNATURE.copy(bytes);
  return bytes;
}

function hashFile(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function environment(appDataRoot: string) {
  return {
    leaseRoot: path.join(appDataRoot, "leases"),
    recoveryRoot: path.join(appDataRoot, "recovery"),
    locationCapability: { classify: () => "local-fixed" as const }
  };
}

async function createStore(filePath: string, appDataRoot: string): Promise<Task6Store> {
  return documentPackage.DocumentStore.create(filePath, {
    appVersion: "4.0.0",
    documentId: `document-${path.basename(filePath, ".ether")}`,
    environment: environment(appDataRoot),
    initialGraph: graph(),
    title: "Recovery"
  }) as Promise<Task6Store>;
}

describe("Ether AppData recovery and logical repair", () => {
  let root: string;
  let appDataRoot: string;
  let sourcePath: string;
  const stores: Task6Store[] = [];

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "ether-document-recovery-"));
    appDataRoot = path.join(root, "AppData", "DreamBay", "Ether");
    sourcePath = path.join(root, "Damaged.ether");
  });

  afterEach(async () => {
    await Promise.all(stores.splice(0).map((store) => store.close()));
    rmSync(root, { recursive: true, force: true });
  });

  it("reconciles a staged provider output once and is idempotent", async () => {
    const store = await createStore(sourcePath, appDataRoot);
    stores.push(store);
    const providerDirectory = path.join(appDataRoot, "staging", "provider", "attempt-1");
    const stagedPath = path.join(providerDirectory, "output.png");
    mkdirSync(providerDirectory, { recursive: true });
    writeFileSync(stagedPath, pngBytes(8192, 0x41), { flag: "wx" });
    const recoveryEntry = {
        id: "provider-attempt-1",
        kind: "provider-output",
        state: "staged",
        documentId: store.documentId,
        documentPath: sourcePath,
        stagedPath,
        sourceName: "output.png",
        mediaType: "image/png",
        artifact: {
          id: "artifact-provider-recovered",
          channel: "image",
          mediaType: "image/png",
          source: { outputVersionId: "output-provider", payloadId: "payload-provider" },
          createdAt: "2026-07-17T08:00:00.000Z",
          metadata: { provider: "fake" }
        },
        createdAt: "2026-07-17T08:00:00.000Z",
        updatedAt: "2026-07-17T08:00:00.000Z"
    } as const;
    api().writeRecoveryJournal({ appDataRoot, entry: recoveryEntry });

    const first = await api().reconcileStaging(store, { appDataRoot });
    const second = await api().reconcileStaging(store, { appDataRoot });
    expect(first.recovered).toEqual(["provider-attempt-1"]);
    await expect(
      store.read(({ artifacts }) => artifacts.get("artifact-provider-recovered"))
    ).resolves.toMatchObject({ id: "artifact-provider-recovered" });
    expect(second).toEqual({ recovered: [], quarantined: [], removed: [] });
    mkdirSync(providerDirectory, { recursive: true });
    writeFileSync(stagedPath, pngBytes(8192, 0x41), { flag: "wx" });
    api().writeRecoveryJournal({ appDataRoot, entry: recoveryEntry });
    await expect(api().reconcileStaging(store, { appDataRoot })).resolves.toMatchObject({
      recovered: ["provider-attempt-1"],
      quarantined: []
    });
    expect(readdirSync(path.join(appDataRoot, "recovery"), { recursive: true })).toEqual([]);
  });

  it("reconciles provider staging automatically during writable startup", async () => {
    const created = await createStore(sourcePath, appDataRoot);
    const documentId = created.documentId;
    await created.close();
    const providerDirectory = path.join(appDataRoot, "staging", "provider", "attempt-startup");
    const stagedPath = path.join(providerDirectory, "output.png");
    mkdirSync(providerDirectory, { recursive: true });
    writeFileSync(stagedPath, pngBytes(4096, 0x52), { flag: "wx" });
    api().writeRecoveryJournal({
      appDataRoot,
      entry: {
        id: "provider-attempt-startup",
        kind: "provider-output",
        state: "staged",
        documentId,
        documentPath: sourcePath,
        stagedPath,
        sourceName: "output.png",
        mediaType: "image/png",
        createdAt: "2026-07-17T08:00:00.000Z",
        updatedAt: "2026-07-17T08:00:00.000Z"
      }
    });

    const reopened = (await documentPackage.DocumentStore.open(sourcePath, {
      access: "require-write",
      environment: environment(appDataRoot)
    })) as Task6Store;
    stores.push(reopened);

    expect(readdirSync(path.join(appDataRoot, "recovery"), { recursive: true })).toEqual([]);
    await expect(api().reconcileStaging(reopened, { appDataRoot })).resolves.toEqual({
      recovered: [],
      quarantined: [],
      removed: []
    });
  });

  it("quarantines corrupt or incomplete staging without touching the document directory", async () => {
    const store = await createStore(sourcePath, appDataRoot);
    stores.push(store);
    const recoveryRoot = path.join(appDataRoot, "recovery");
    mkdirSync(recoveryRoot, { recursive: true });
    writeFileSync(path.join(recoveryRoot, "media-deadbeef.json"), "{not-json", { flag: "wx" });

    const result = await api().reconcileStaging(store, { appDataRoot });
    expect(result.quarantined).toEqual(["media-deadbeef.json"]);
    expect(existsSync(path.join(appDataRoot, "quarantine", "media-deadbeef.json"))).toBe(true);
    expect(readdirSync(root).filter((name) => name.includes("staging") || name.includes("recovery"))).toEqual([]);
  });

  it("repairs into a fresh schema-40000 file, rehashes blobs, and reports corrupt losses", async () => {
    const store = await createStore(sourcePath, appDataRoot);
    stores.push(store);
    const internalGraph = { ...graph(), id: "graph-module", title: "Module", kind: "module" as const };
    const module = {
      id: "module-repair",
      title: "Repair module",
      graphId: internalGraph.id,
      position: { x: 10, y: 20 },
      size: { width: 320, height: 240 },
      interface: { inputs: [], outputs: [], parameters: [] },
      collapsed: false
    };
    const rootWithModule = { ...graph(), modules: [module] };
    const head = await store.read(({ revisions }) => revisions.head());
    await store.transaction(({ revisions }) => revisions.commit({
      id: "transaction-repair-module",
      baseDocumentRevisionId: head.documentRevisionId,
      baseGraphRevisions: head.graphRevisions,
      title: "Add repair module",
      actor: "user",
      graphSnapshots: [rootWithModule, internalGraph],
      forwardOperations: [
        { type: "createModule", graphId: rootWithModule.id, module, internalGraph }
      ],
      inverseOperations: [
        { type: "removeModule", graphId: rootWithModule.id, moduleId: module.id }
      ]
    }));
    const goodPath = path.join(root, "good.png");
    const badPath = path.join(root, "bad.png");
    writeFileSync(goodPath, pngBytes(2048, 0x21));
    writeFileSync(badPath, pngBytes(4 * 1024 * 1024 + 9, 0x63));
    const baseArtifact = {
      channel: "image",
      mediaType: "image/png",
      source: { outputVersionId: "output-repair", payloadId: "payload-repair" },
      createdAt: "2026-07-17T08:01:00.000Z",
      metadata: {}
    } as const;
    await api().importBlob(store, { sourcePath: goodPath, mediaType: "image/png", artifact: { ...baseArtifact, id: "artifact-good" } }, { appDataRoot });
    const bad = await api().importBlob(store, { sourcePath: badPath, mediaType: "image/png", artifact: { ...baseArtifact, id: "artifact-bad" } }, { appDataRoot });
    await store.close();
    stores.splice(stores.indexOf(store), 1);

    const sourceBefore = hashFile(sourcePath);
    const database = new DatabaseSync(sourcePath);
    database.prepare("UPDATE blob_chunks SET data = ? WHERE content_key = ? AND chunk_index = 1").run(Buffer.from("corrupt"), bad.contentKey);
    database.close();
    const damagedBeforeRepair = hashFile(sourcePath);
    expect(damagedBeforeRepair).not.toBe(sourceBefore);

    const destinationPath = path.join(root, "Repaired.ether");
    const report = await api().repairDocument(sourcePath, destinationPath, {
      appDataRoot,
      environment: environment(appDataRoot)
    });

    expect(report.destinationPath).toBe(destinationPath);
    expect(report.recovered).toMatchObject({ blobs: 1, artifacts: 1 });
    expect(report.losses).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "blob", entityId: bad.contentKey }),
      expect.objectContaining({ type: "artifact", entityId: "artifact-bad" })
    ]));
    expect(hashFile(sourcePath)).toBe(damagedBeforeRepair);

    const headerDatabase = new DatabaseSync(destinationPath, { readOnly: true });
    expect(headerDatabase.prepare("PRAGMA user_version").get()).toEqual({ user_version: 40000 });
    headerDatabase.close();
    const repaired = (await documentPackage.DocumentStore.open(destinationPath, { access: "read-only" })) as Task6Store;
    stores.push(repaired);
    await expect(repaired.read(({ artifacts }) => artifacts.get("artifact-good"))).resolves.toMatchObject({ id: "artifact-good" });
    await expect(repaired.read(({ artifacts }) => artifacts.get("artifact-bad"))).resolves.toBeUndefined();
    await expect(repaired.read(({ graphs }) => graphs.list())).resolves.toEqual([
      internalGraph,
      rootWithModule
    ]);
  });
});
