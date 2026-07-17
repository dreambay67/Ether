import * as documentPackage from "@ether/document";
import type {
  Artifact,
  EtherGraph,
  NodeOutputVersion,
  PayloadEnvelope,
  PreparedGraphCommit
} from "@ether/schema";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

interface Task6Store {
  close(): Promise<void>;
  readonly dirty: boolean;
  documentId: string;
  manualSave(name: string): Promise<unknown>;
  read<T>(callback: (repositories: {
    artifacts: { get(id: string): Artifact | undefined };
    blobs: { get(contentKey: string): unknown };
    graphs: { list(): EtherGraph[] };
    revisions: { head(): { documentRevisionId: string; graphRevisions: Record<string, string> } };
  }) => T): Promise<T>;
  transaction<T>(callback: (repositories: {
    outputs: { insert(version: NodeOutputVersion, payloads: PayloadEnvelope[]): void };
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
    attention: string[];
    quarantined: string[];
    recovered: string[];
    removed: string[];
  }>;
  repairDocument(sourcePath: string, destinationPath: string, options: {
    appDataRoot: string;
    allowLossy?: boolean;
    checkpoint?: (name: string) => void;
    environment: object;
  }): Promise<{
    destinationPath: string;
    losses: Array<{ entityId: string; reason: string; type: string }>;
    recovered: { artifacts: number; blobs: number };
  }>;
  removeOwnedStagingPath(filePath: string, appDataRoot: string): void;
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
    nodes: [
      {
        id: "prompt-1",
        definitionId: "prompt.text",
        title: "Recovery prompt",
        position: { x: 40, y: 60 },
        size: { width: 220, height: 140 },
        config: { kind: "prompt.text", body: "Recover this", assembly: "append" },
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
    compiledContextHash: "sha256:recovery",
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
    content: { kind: "object", value: { recovered: true } },
    source: { nodeId: "prompt-1", outputVersionId, lineageKey: `lineage-${payloadId}` },
    metadata: {}
  };
  await store.transaction(({ outputs }) => outputs.insert(version, [payload]));
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
    await createProvenance(store, "output-provider", "payload-provider");
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
    expect(store.dirty).toBe(true);
    await expect(
      store.read(({ artifacts }) => artifacts.get("artifact-provider-recovered"))
    ).resolves.toMatchObject({
      id: "artifact-provider-recovered",
      metadata: {
        recovery: {
          journalId: "provider-attempt-1",
          reviewRequired: true,
          status: "recovered"
        }
      }
    });
    expect(second).toEqual({ attention: [], recovered: [], quarantined: [], removed: [] });
    await store.manualSave("Reviewed recovery");
    expect(store.dirty).toBe(false);
    mkdirSync(providerDirectory, { recursive: true });
    writeFileSync(stagedPath, pngBytes(8192, 0x41), { flag: "wx" });
    api().writeRecoveryJournal({ appDataRoot, entry: recoveryEntry });
    await expect(api().reconcileStaging(store, { appDataRoot })).resolves.toMatchObject({
      recovered: ["provider-attempt-1"],
      quarantined: []
    });
    expect(readdirSync(path.join(appDataRoot, "recovery"), { recursive: true })).toEqual([]);
  });

  it("preserves provider staging without valid artifact metadata for attention", async () => {
    const created = await createStore(sourcePath, appDataRoot);
    const documentId = created.documentId;
    await created.close();
    const providerDirectory = path.join(appDataRoot, "staging", "provider", "attempt-startup");
    const stagedPath = path.join(providerDirectory, "output.png");
    mkdirSync(providerDirectory, { recursive: true });
    writeFileSync(stagedPath, pngBytes(4096, 0x52), { flag: "wx" });
    const recoveryRoot = path.join(appDataRoot, "recovery");
    mkdirSync(recoveryRoot, { recursive: true });
    writeFileSync(
      path.join(recoveryRoot, "media-deadfeed.json"),
      JSON.stringify({
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
      })
    );

    const reopened = (await documentPackage.DocumentStore.open(sourcePath, {
      access: "require-write",
      environment: environment(appDataRoot)
    })) as Task6Store;
    stores.push(reopened);

    expect(existsSync(stagedPath)).toBe(true);
    expect(readdirSync(path.join(appDataRoot, "quarantine"), { recursive: true })).not.toEqual([]);
    await expect(reopened.read(({ artifacts }) => artifacts.get("provider-attempt-startup"))).resolves.toBeUndefined();
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

  it("uses unique quarantine destinations without clobbering existing evidence", async () => {
    const store = await createStore(sourcePath, appDataRoot);
    stores.push(store);
    const recoveryRoot = path.join(appDataRoot, "recovery");
    const quarantineRoot = path.join(appDataRoot, "quarantine");
    mkdirSync(recoveryRoot, { recursive: true });
    mkdirSync(quarantineRoot, { recursive: true });
    writeFileSync(path.join(quarantineRoot, "media-deadbeef.json"), "older evidence");
    writeFileSync(path.join(recoveryRoot, "media-deadbeef.json"), "{broken");

    await api().reconcileStaging(store, { appDataRoot });
    const evidence = readdirSync(quarantineRoot).map((name) =>
      readFileSync(path.join(quarantineRoot, name), "utf8")
    );
    expect(evidence).toEqual(expect.arrayContaining(["older evidence", "{broken"]));
  });

  it("leaves another document's journal and staging completely untouched", async () => {
    const firstPath = path.join(root, "First.ether");
    const secondPath = path.join(root, "Second.ether");
    const first = await createStore(firstPath, appDataRoot);
    const second = await createStore(secondPath, appDataRoot);
    stores.push(first, second);
    const stagedPath = path.join(appDataRoot, "staging", "provider", "second", "output.png");
    mkdirSync(path.dirname(stagedPath), { recursive: true });
    writeFileSync(stagedPath, pngBytes(512, 0x33));
    const journalPath = api().writeRecoveryJournal({
      appDataRoot,
      entry: {
        id: "provider-second-document",
        kind: "provider-output",
        state: "staged",
        documentId: second.documentId,
        documentPath: secondPath,
        stagedPath,
        sourceName: "output.png",
        mediaType: "image/png",
        artifact: {
          id: "artifact-second",
          channel: "image",
          mediaType: "image/png",
          source: { outputVersionId: "output-second", payloadId: "payload-second" },
          createdAt: "2026-07-17T08:00:00.000Z",
          metadata: {}
        },
        createdAt: "2026-07-17T08:00:00.000Z",
        updatedAt: "2026-07-17T08:00:00.000Z"
      }
    });

    await expect(api().reconcileStaging(first, { appDataRoot })).resolves.toEqual({
      attention: [],
      quarantined: [],
      recovered: [],
      removed: []
    });
    expect(readFileSync(journalPath, "utf8")).toContain("provider-second-document");
    expect(readFileSync(stagedPath)).toEqual(pngBytes(512, 0x33));
  });

  it.each(["journal-created", "staging-created", "chunk-staged:0", "validated"])(
    "can reclaim an import interrupted at %s",
    async (checkpoint) => {
      const filePath = path.join(root, `${checkpoint.replace(/[:]/g, "-")}.ether`);
      const store = await createStore(filePath, appDataRoot);
      stores.push(store);
      const inputPath = path.join(root, `${checkpoint.replace(/[:]/g, "-")}.png`);
      writeFileSync(inputPath, pngBytes(4 * 1024 * 1024 + 17, checkpoint.length));

      await expect(
        api().importBlob(store, { sourcePath: inputPath, mediaType: "image/png" }, {
          appDataRoot,
          checkpoint: (name) => {
            if (name === checkpoint) throw new Error(`stop at ${checkpoint}`);
          }
        })
      ).rejects.toThrow(`stop at ${checkpoint}`);
      expect(readdirSync(path.join(appDataRoot, "recovery"))).toHaveLength(1);
      await expect(api().reconcileStaging(store, { appDataRoot })).resolves.toMatchObject({
        removed: [expect.stringMatching(/^blob-import-/)]
      });
      expect(readdirSync(path.join(appDataRoot, "recovery"))).toEqual([]);
    }
  );

  it("retains a failed provider journal and staged evidence for retry", async () => {
    const store = await createStore(sourcePath, appDataRoot);
    stores.push(store);
    await createProvenance(store, "output-retry", "payload-retry");
    const stagedPath = path.join(appDataRoot, "staging", "provider", "retry", "output.png");
    mkdirSync(path.dirname(stagedPath), { recursive: true });
    writeFileSync(stagedPath, Buffer.from("not a png"));
    api().writeRecoveryJournal({
      appDataRoot,
      entry: {
        id: "provider-retry",
        kind: "provider-output",
        state: "staged",
        documentId: store.documentId,
        documentPath: sourcePath,
        stagedPath,
        sourceName: "output.png",
        mediaType: "image/png",
        artifact: {
          id: "artifact-retry",
          channel: "image",
          mediaType: "image/png",
          source: { outputVersionId: "output-retry", payloadId: "payload-retry" },
          createdAt: "2026-07-17T08:00:00.000Z",
          metadata: {}
        },
        createdAt: "2026-07-17T08:00:00.000Z",
        updatedAt: "2026-07-17T08:00:00.000Z"
      }
    });

    await expect(api().reconcileStaging(store, { appDataRoot })).resolves.toMatchObject({
      attention: ["provider-retry"]
    });
    expect(existsSync(stagedPath)).toBe(true);
    const journalFiles = readdirSync(path.join(appDataRoot, "recovery"));
    const providerJournal = journalFiles.find((name) =>
      readFileSync(path.join(appDataRoot, "recovery", name), "utf8").includes("provider-retry")
    );
    expect(providerJournal).toBeDefined();
    expect(readFileSync(path.join(appDataRoot, "recovery", providerJournal!), "utf8")).toContain('"state":"failed"');
  });

  it("refuses to reclaim a Windows junction that points outside Ether AppData", async () => {
    if (process.platform !== "win32") return;
    const store = await createStore(sourcePath, appDataRoot);
    stores.push(store);
    const outside = path.join(root, "outside");
    const sentinel = path.join(outside, "keep.txt");
    mkdirSync(outside, { recursive: true });
    writeFileSync(sentinel, "keep");
    const junction = path.join(appDataRoot, "staging", "imports", "junction-import");
    mkdirSync(path.dirname(junction), { recursive: true });
    symlinkSync(outside, junction, "junction");
    api().writeRecoveryJournal({
      appDataRoot,
      entry: {
        id: "junction-import",
        kind: "blob-import" as never,
        state: "staged",
        documentId: store.documentId,
        documentPath: sourcePath,
        stagedPath: junction,
        sourceName: "outside.bin",
        mediaType: "application/octet-stream",
        createdAt: "2026-07-17T08:00:00.000Z",
        updatedAt: "2026-07-17T08:00:00.000Z"
      }
    });

    await expect(api().reconcileStaging(store, { appDataRoot })).resolves.toMatchObject({
      attention: ["junction-import"]
    });
    expect(readFileSync(sentinel, "utf8")).toBe("keep");
    expect(existsSync(junction)).toBe(true);
  });

  it("rejects a staging-root junction before recursive cleanup can reach outside AppData", () => {
    if (process.platform !== "win32") return;
    const outside = path.join(root, "outside-staging-root");
    const victim = path.join(outside, "imports", "owned", "keep.txt");
    mkdirSync(path.dirname(victim), { recursive: true });
    writeFileSync(victim, "keep");
    mkdirSync(appDataRoot, { recursive: true });
    const stagingRoot = path.join(appDataRoot, "staging");
    symlinkSync(outside, stagingRoot, "junction");

    expect(() =>
      api().removeOwnedStagingPath(path.join(stagingRoot, "imports", "owned"), appDataRoot)
    ).toThrow(/reparse|canonical|owned/i);
    expect(readFileSync(victim, "utf8")).toBe("keep");
  });

  it.each(["journal-created", "staging-created", "destination-created"])(
    "reclaims journal-owned repair staging interrupted at %s",
    async (checkpoint) => {
      const created = await createStore(sourcePath, appDataRoot);
      await created.close();
      const destinationPath = path.join(root, `Interrupted-${checkpoint}.ether`);

      await expect(
        api().repairDocument(sourcePath, destinationPath, {
          appDataRoot,
          checkpoint: (name) => {
            if (name === checkpoint) throw new Error(`stop repair at ${checkpoint}`);
          },
          environment: environment(appDataRoot)
        })
      ).rejects.toThrow(`stop repair at ${checkpoint}`);
      expect(existsSync(destinationPath)).toBe(false);
      expect(readdirSync(path.join(appDataRoot, "recovery"))).toHaveLength(1);

      const reopened = (await documentPackage.DocumentStore.open(sourcePath, {
        access: "require-write",
        environment: environment(appDataRoot)
      })) as Task6Store;
      stores.push(reopened);
      expect(readdirSync(path.join(appDataRoot, "recovery"))).toEqual([]);
      const repairRoot = path.join(appDataRoot, "staging", "repair");
      expect(existsSync(repairRoot) ? readdirSync(repairRoot) : []).toEqual([]);
    }
  );

  it("refuses repair when the staging root is redirected outside AppData", async () => {
    if (process.platform !== "win32") return;
    const created = await createStore(sourcePath, appDataRoot);
    await created.close();
    const outside = path.join(root, "outside-repair-root");
    const sentinel = path.join(outside, "keep.txt");
    mkdirSync(outside, { recursive: true });
    writeFileSync(sentinel, "keep");
    const stagingRoot = path.join(appDataRoot, "staging");
    api().removeOwnedStagingPath(stagingRoot, appDataRoot);
    symlinkSync(outside, stagingRoot, "junction");
    const destinationPath = path.join(root, "Redirected-repair.ether");

    await expect(
      api().repairDocument(sourcePath, destinationPath, {
        appDataRoot,
        environment: environment(appDataRoot)
      })
    ).rejects.toThrow(/reparse|canonical|owned/i);
    expect(existsSync(destinationPath)).toBe(false);
    expect(readFileSync(sentinel, "utf8")).toBe("keep");
    expect(readdirSync(outside)).toEqual(["keep.txt"]);
  });

  it("recognizes a published repair after interruption before journal cleanup", async () => {
    const created = await createStore(sourcePath, appDataRoot);
    await created.close();
    const destinationPath = path.join(root, "Published-before-cleanup.ether");

    await expect(
      api().repairDocument(sourcePath, destinationPath, {
        appDataRoot,
        checkpoint: (name) => {
          if (name === "committed") throw new Error("stop after repair publication");
        },
        environment: environment(appDataRoot)
      })
    ).rejects.toThrow("stop after repair publication");
    expect(existsSync(destinationPath)).toBe(true);

    const source = (await documentPackage.DocumentStore.open(sourcePath, {
      access: "read-only"
    })) as Task6Store;
    stores.push(source);
    await expect(api().reconcileStaging(source, { appDataRoot })).resolves.toMatchObject({
      recovered: [expect.stringMatching(/^repair-/)],
      removed: []
    });
    await expect(api().reconcileStaging(source, { appDataRoot })).resolves.toEqual({
      attention: [],
      quarantined: [],
      recovered: [],
      removed: []
    });
    const published = (await documentPackage.DocumentStore.open(destinationPath, {
      access: "read-only"
    })) as Task6Store;
    stores.push(published);
    expect(published.dirty).toBe(true);
  });

  it("retains repair evidence when an unrelated valid document replaces the destination", async () => {
    const created = await createStore(sourcePath, appDataRoot);
    await created.close();
    const destinationPath = path.join(root, "Substituted-repair.ether");

    await expect(
      api().repairDocument(sourcePath, destinationPath, {
        appDataRoot,
        checkpoint: (name) => {
          if (name === "destination-created") throw new Error("stop before repair publication");
        },
        environment: environment(appDataRoot)
      })
    ).rejects.toThrow("stop before repair publication");
    const journalPath = path.join(
      appDataRoot,
      "recovery",
      readdirSync(path.join(appDataRoot, "recovery"))[0]!
    );
    const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
      expectedDocumentId?: string;
      stagedPath: string;
    };
    const stagedDatabase = new DatabaseSync(path.join(journal.stagedPath, "repaired.ether"), {
      readOnly: true
    });
    const stagedIdentity = stagedDatabase
      .prepare("SELECT document_id FROM document WHERE singleton = 1")
      .get() as { document_id: string };
    stagedDatabase.close();
    expect(journal.expectedDocumentId).toBe(stagedIdentity.document_id);

    const unrelated = await createStore(destinationPath, appDataRoot);
    const unrelatedDocumentId = unrelated.documentId;
    await unrelated.close();
    expect(unrelatedDocumentId).not.toBe(journal.expectedDocumentId);
    const source = (await documentPackage.DocumentStore.open(sourcePath, {
      access: "read-only"
    })) as Task6Store;
    stores.push(source);

    await expect(api().reconcileStaging(source, { appDataRoot })).resolves.toMatchObject({
      attention: [expect.stringMatching(/^repair-/)],
      recovered: [],
      removed: []
    });
    expect(existsSync(journalPath)).toBe(true);
    expect(existsSync(journal.stagedPath)).toBe(true);
    const substituted = (await documentPackage.DocumentStore.open(destinationPath, {
      access: "read-only"
    })) as Task6Store;
    stores.push(substituted);
    expect(substituted.documentId).toBe(unrelatedDocumentId);
  });

  it("reclaims a missing repair destination once and makes replay idempotent", async () => {
    const created = await createStore(sourcePath, appDataRoot);
    await created.close();
    const destinationPath = path.join(root, "Missing-repair.ether");

    await expect(
      api().repairDocument(sourcePath, destinationPath, {
        appDataRoot,
        checkpoint: (name) => {
          if (name === "destination-created") throw new Error("stop with missing destination");
        },
        environment: environment(appDataRoot)
      })
    ).rejects.toThrow("stop with missing destination");
    expect(existsSync(destinationPath)).toBe(false);
    const source = (await documentPackage.DocumentStore.open(sourcePath, {
      access: "read-only"
    })) as Task6Store;
    stores.push(source);

    await expect(api().reconcileStaging(source, { appDataRoot })).resolves.toMatchObject({
      recovered: [],
      removed: [expect.stringMatching(/^repair-/)]
    });
    await expect(api().reconcileStaging(source, { appDataRoot })).resolves.toEqual({
      attention: [],
      quarantined: [],
      recovered: [],
      removed: []
    });
  });

  it("repairs into a fresh schema-40000 file, rehashes blobs, and reports corrupt losses", async () => {
    const store = await createStore(sourcePath, appDataRoot);
    stores.push(store);
    const internalGraph = {
      ...graph(),
      id: "graph-module",
      title: "Module",
      kind: "module" as const,
      nodes: []
    };
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
        { type: "createModule", graphId: rootWithModule.id, module, subtree: { rootGraphId: internalGraph.id, graphs: [internalGraph] } }
      ],
      inverseOperations: [
        { type: "removeModule", graphId: rootWithModule.id, moduleId: module.id }
      ]
    }));
    await createProvenance(store, "output-repair", "payload-repair");
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
    database.exec(`
      INSERT INTO artifact_lineage (
        artifact_id, parent_artifact_id, relation, source_output_version_id, metadata_json
      ) VALUES ('artifact-good', 'artifact-good', 'derived-from', 'output-repair', '{"role":"general"}');
      INSERT INTO artifact_tags (artifact_id, tag, created_at)
      VALUES ('artifact-good', 'keeper', '2026-07-17T08:02:00.000Z');
      INSERT INTO artifact_ratings (
        rating_id, artifact_id, score, actor, rubric_id, notes, created_at
      ) VALUES ('rating-good', 'artifact-good', 5, 'user', NULL, 'keep', '2026-07-17T08:02:00.000Z');
      INSERT INTO collections (
        collection_id, name, description, is_primary, metadata_json, created_at, updated_at
      ) VALUES (
        'collection-good', 'Keepers', 'Recovered set', 1, '{}',
        '2026-07-17T08:02:00.000Z', '2026-07-17T08:02:00.000Z'
      );
      INSERT INTO collection_memberships (collection_id, artifact_id, position, added_at)
      VALUES ('collection-good', 'artifact-good', 0, '2026-07-17T08:02:00.000Z');
    `);
    database.prepare("UPDATE blob_chunks SET data = ? WHERE content_key = ? AND chunk_index = 1").run(Buffer.from("corrupt"), bad.contentKey);
    database.close();
    const damagedBeforeRepair = hashFile(sourcePath);
    expect(damagedBeforeRepair).not.toBe(sourceBefore);

    const refusedPath = path.join(root, "Refused-lossy.ether");
    await expect(api().repairDocument(sourcePath, refusedPath, {
      appDataRoot,
      environment: environment(appDataRoot)
    })).rejects.toMatchObject({ code: "LOSSY_REPAIR_REQUIRES_OPT_IN" });
    expect(existsSync(refusedPath)).toBe(false);

    const destinationPath = path.join(root, "Repaired.ether");
    const report = await api().repairDocument(sourcePath, destinationPath, {
      appDataRoot,
      allowLossy: true,
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
    expect(headerDatabase.prepare("SELECT tag FROM artifact_tags WHERE artifact_id = 'artifact-good'").get()).toEqual({ tag: "keeper" });
    expect(headerDatabase.prepare("SELECT score, notes FROM artifact_ratings WHERE artifact_id = 'artifact-good'").get()).toEqual({ score: 5, notes: "keep" });
    expect(headerDatabase.prepare("SELECT name FROM collections WHERE collection_id = 'collection-good'").get()).toEqual({ name: "Keepers" });
    expect(headerDatabase.prepare("SELECT artifact_id FROM collection_memberships WHERE collection_id = 'collection-good'").get()).toEqual({ artifact_id: "artifact-good" });
    expect(headerDatabase.prepare("SELECT parent_artifact_id FROM artifact_lineage WHERE artifact_id = 'artifact-good'").get()).toEqual({ parent_artifact_id: "artifact-good" });
    expect(headerDatabase.prepare("SELECT output_version_id FROM node_output_versions WHERE output_version_id = 'output-repair'").get()).toEqual({ output_version_id: "output-repair" });
    expect(headerDatabase.prepare("SELECT payload_id FROM node_output_payloads WHERE payload_id = 'payload-repair'").get()).toEqual({ payload_id: "payload-repair" });
    headerDatabase.close();
    const repaired = (await documentPackage.DocumentStore.open(destinationPath, { access: "read-only" })) as Task6Store;
    stores.push(repaired);
    expect(repaired.dirty).toBe(true);
    await expect(repaired.read(({ artifacts }) => artifacts.get("artifact-good"))).resolves.toMatchObject({ id: "artifact-good" });
    await expect(repaired.read(({ artifacts }) => artifacts.get("artifact-bad"))).resolves.toBeUndefined();
    await expect(repaired.read(({ graphs }) => graphs.list())).resolves.toEqual([
      internalGraph,
      rootWithModule
    ]);
  });

  it("repairs through corrupt derived FTS state and rebuilds it from authoritative rows", async () => {
    const store = await createStore(sourcePath, appDataRoot);
    await store.close();
    const sourceBefore = hashFile(sourcePath);
    const database = new DatabaseSync(sourcePath);
    database.prepare("DELETE FROM prompt_output_fts WHERE source_id = 'prompt-1'").run();
    database.close();
    const damagedBeforeRepair = hashFile(sourcePath);
    expect(damagedBeforeRepair).not.toBe(sourceBefore);

    await expect(documentPackage.DocumentStore.open(sourcePath, {
      access: "read-only"
    })).rejects.toMatchObject({ code: "FTS_INDEX_MISMATCH" });

    const destinationPath = path.join(root, "Rebuilt-fts.ether");
    await expect(api().repairDocument(sourcePath, destinationPath, {
      appDataRoot,
      environment: environment(appDataRoot)
    })).resolves.toMatchObject({ losses: [] });
    expect(hashFile(sourcePath)).toBe(damagedBeforeRepair);
    const repairedDatabase = new DatabaseSync(destinationPath, { readOnly: true });
    expect(repairedDatabase.prepare(
      "SELECT source_id FROM prompt_output_fts WHERE prompt_output_fts MATCH 'Recover'"
    ).all()).toEqual([{ source_id: "prompt-1" }]);
    repairedDatabase.close();
  });
});
