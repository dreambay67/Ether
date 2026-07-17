import * as documentPackage from "@ether/document";
import type { EtherGraph } from "@ether/schema";
import { randomUUID } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

type AccessMode = "prefer-write" | "read-only" | "require-write";
type SaveStage =
  | "reservation"
  | "backup"
  | "identity-rewrite"
  | "validation"
  | "fsync"
  | "publication";

interface StoreEnvironment {
  appInstanceId: string;
  heartbeatMs?: number;
  leaseRoot: string;
  machineId: string;
  now?: () => number;
  onHeartbeat?: () => void;
  onSaveStage?: (stage: SaveStage) => void;
  pid?: number;
  processIsAlive?: (pid: number, machineId: string) => boolean;
  staleMs?: number;
  writableLocation?: (filePath: string) => boolean;
}

interface StoreInstance {
  readonly documentId: string;
  readonly mode:
    | { kind: "writable" }
    | {
        kind: "read-only";
        reason: "requested" | "writer-active" | "location-unsupported" | "sqlite-busy" | "heartbeat-failed";
      };
  readonly path: string;
  close(): Promise<void>;
  saveAs(destinationPath: string): Promise<void>;
  saveCopy(destinationPath: string): Promise<{ documentId: string; path: string }>;
}

interface StoreStatic {
  create(
    filePath: string,
    options: {
      appVersion: string;
      documentId: string;
      environment: StoreEnvironment;
      initialGraph: EtherGraph;
      title: string;
    }
  ): Promise<StoreInstance>;
  open(
    filePath: string,
    options: { access: AccessMode; environment: StoreEnvironment }
  ): Promise<StoreInstance>;
}

interface LeaseRecord {
  appInstanceId: string;
  documentId: string;
  heartbeatAt: number;
  machineId: string;
  ownerToken: string;
  pathHash: string;
  pid: number;
}

function storeClass(): StoreStatic {
  const candidate = Reflect.get(documentPackage, "DocumentStore");
  expect(candidate, "@ether/document must export DocumentStore").toBeTypeOf("function");
  return candidate as StoreStatic;
}

const timestamp = "2026-07-17T08:00:00.000Z";

function initialGraph(): EtherGraph {
  return {
    id: "graph-root",
    title: "Root",
    kind: "root",
    createdAt: timestamp,
    updatedAt: timestamp,
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

function environment(
  leaseRoot: string,
  appInstanceId: string,
  overrides: Partial<StoreEnvironment> = {}
): StoreEnvironment {
  return {
    appInstanceId,
    leaseRoot,
    machineId: "test-machine",
    heartbeatMs: 2_000,
    staleMs: 15_000,
    ...overrides
  };
}

function onlyLeasePath(leaseRoot: string): string {
  const files = readdirSync(leaseRoot);
  expect(files).toHaveLength(1);
  return path.join(leaseRoot, files[0]);
}

function readLease(leaseRoot: string): LeaseRecord {
  return JSON.parse(readFileSync(onlyLeasePath(leaseRoot), "utf8")) as LeaseRecord;
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 1_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error("Timed out waiting for document mode transition.");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("Ether document writer leases and backup lifecycle", () => {
  let root: string;
  let leaseRoot: string;
  let sourcePath: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "ether-document-locking-"));
    leaseRoot = path.join(root, "leases");
    sourcePath = path.join(root, "Source.ether");
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("allows one writer, downgrades prefer-write competitors, and rejects require-write with a typed error", async () => {
    const writer = await storeClass().create(sourcePath, {
      appVersion: "4.0.0",
      documentId: "document-lock",
      environment: environment(leaseRoot, "writer"),
      initialGraph: initialGraph(),
      title: "Locking"
    });
    const lease = readLease(leaseRoot);
    expect(lease).toMatchObject({
      appInstanceId: "writer",
      documentId: "document-lock",
      machineId: "test-machine",
      pid: process.pid
    });
    expect(lease.ownerToken).toBeTruthy();
    expect(lease.pathHash).toMatch(/^[a-f0-9]{64}$/);

    const competitor = await storeClass().open(sourcePath, {
      access: "prefer-write",
      environment: environment(leaseRoot, "competitor")
    });
    expect(competitor.mode).toEqual({ kind: "read-only", reason: "writer-active" });
    await expect(
      storeClass().open(sourcePath, {
        access: "require-write",
        environment: environment(leaseRoot, "required")
      })
    ).rejects.toMatchObject({ code: "WRITER_LEASE_UNAVAILABLE", reason: "writer-active" });

    await competitor.close();
    await writer.close();
    expect(readdirSync(leaseRoot)).toEqual([]);
  });

  it("keeps a stale-heartbeat lease when its PID is live and reclaims a dead owner only after a SQLite probe", async () => {
    let now = 100_000;
    const writerEnvironment = environment(leaseRoot, "writer", {
      heartbeatMs: 60_000,
      now: () => now
    });
    const writer = await storeClass().create(sourcePath, {
      appVersion: "4.0.0",
      documentId: "document-reclaim",
      environment: writerEnvironment,
      initialGraph: initialGraph(),
      title: "Reclaim"
    });
    const leasePath = onlyLeasePath(leaseRoot);
    const staleLive = { ...readLease(leaseRoot), heartbeatAt: 1 };
    writeFileSync(leasePath, JSON.stringify(staleLive));
    now = 200_000;

    const liveCompetitor = await storeClass().open(sourcePath, {
      access: "prefer-write",
      environment: environment(leaseRoot, "live-competitor", {
        now: () => now,
        processIsAlive: (pid) => pid === process.pid
      })
    });
    expect(liveCompetitor.mode).toEqual({ kind: "read-only", reason: "writer-active" });
    await liveCompetitor.close();
    await writer.close();

    writeFileSync(
      leasePath,
      JSON.stringify({ ...staleLive, heartbeatAt: 1, ownerToken: randomUUID(), pid: 999_999 })
    );
    const reclaimed = await storeClass().open(sourcePath, {
      access: "require-write",
      environment: environment(leaseRoot, "reclaimer", {
        now: () => now,
        processIsAlive: () => false
      })
    });
    expect(reclaimed.mode).toEqual({ kind: "writable" });
    expect(readLease(leaseRoot).appInstanceId).toBe("reclaimer");
    await reclaimed.close();
  });

  it("does not reclaim a dead stale lease while SQLite is busy", async () => {
    const creator = await storeClass().create(sourcePath, {
      appVersion: "4.0.0",
      documentId: "document-busy",
      environment: environment(leaseRoot, "creator"),
      initialGraph: initialGraph(),
      title: "Busy"
    });
    const stale = { ...readLease(leaseRoot), heartbeatAt: 1, ownerToken: randomUUID(), pid: 999_999 };
    const leasePath = onlyLeasePath(leaseRoot);
    await creator.close();
    writeFileSync(leasePath, JSON.stringify(stale));

    const blocker = new DatabaseSync(sourcePath);
    blocker.exec("BEGIN IMMEDIATE");
    try {
      const readOnly = await storeClass().open(sourcePath, {
        access: "prefer-write",
        environment: environment(leaseRoot, "blocked", {
          now: () => 100_000,
          processIsAlive: () => false
        })
      });
      expect(readOnly.mode).toEqual({ kind: "read-only", reason: "sqlite-busy" });
      await readOnly.close();
      await expect(
        storeClass().open(sourcePath, {
          access: "require-write",
          environment: environment(leaseRoot, "blocked-required", {
            now: () => 100_000,
            processIsAlive: () => false
          })
        })
      ).rejects.toMatchObject({ code: "WRITER_LEASE_UNAVAILABLE", reason: "sqlite-busy" });
    } finally {
      blocker.exec("ROLLBACK");
      blocker.close();
    }
    expect(readFileSync(leasePath, "utf8")).toBe(JSON.stringify(stale));
  });

  it("defaults unsupported network/cloud capability to read-only and allows an approved adapter", async () => {
    const creator = await storeClass().create(sourcePath, {
      appVersion: "4.0.0",
      documentId: "document-location",
      environment: environment(leaseRoot, "creator"),
      initialGraph: initialGraph(),
      title: "Location"
    });
    await creator.close();

    const blocked = await storeClass().open(sourcePath, {
      access: "prefer-write",
      environment: environment(leaseRoot, "blocked", { writableLocation: () => false })
    });
    expect(blocked.mode).toEqual({ kind: "read-only", reason: "location-unsupported" });
    await blocked.close();

    const approved = await storeClass().open(sourcePath, {
      access: "require-write",
      environment: environment(leaseRoot, "approved", { writableLocation: () => true })
    });
    expect(approved.mode).toEqual({ kind: "writable" });
    await approved.close();
  });

  it("transitions orderly to read-only when a heartbeat write fails", async () => {
    let heartbeatCount = 0;
    const writer = await storeClass().create(sourcePath, {
      appVersion: "4.0.0",
      documentId: "document-heartbeat",
      environment: environment(leaseRoot, "writer", {
        heartbeatMs: 10,
        onHeartbeat: () => {
          heartbeatCount += 1;
          throw new Error("injected heartbeat failure");
        }
      }),
      initialGraph: initialGraph(),
      title: "Heartbeat"
    });

    await waitFor(() => writer.mode.kind === "read-only");
    expect(heartbeatCount).toBeGreaterThan(0);
    expect(writer.mode).toEqual({ kind: "read-only", reason: "heartbeat-failed" });
    expect(readdirSync(leaseRoot)).toEqual([]);
    await writer.close();
  });

  it("uses validated no-clobber backups for Save a Copy and Save As with independent identities and leases", async () => {
    const store = await storeClass().create(sourcePath, {
      appVersion: "4.0.0",
      documentId: "document-source",
      environment: environment(leaseRoot, "writer"),
      initialGraph: initialGraph(),
      title: "Backups"
    });
    const copyPath = path.join(root, "Copy.ether");
    const copy = await store.saveCopy(copyPath);
    expect(copy.path).toBe(path.resolve(copyPath));
    expect(copy.documentId).not.toBe("document-source");
    expect(store.path).toBe(path.resolve(sourcePath));
    expect(store.documentId).toBe("document-source");
    expect(store.mode).toEqual({ kind: "writable" });
    const openedCopy = await storeClass().open(copyPath, {
      access: "read-only",
      environment: environment(leaseRoot, "copy-reader")
    });
    expect(openedCopy.documentId).toBe(copy.documentId);
    await openedCopy.close();

    await expect(store.saveCopy(copyPath)).rejects.toMatchObject({ code: "DESTINATION_EXISTS" });
    const saveAsPath = path.join(root, "Renamed.ether");
    await store.saveAs(saveAsPath);
    expect(store.path).toBe(path.resolve(saveAsPath));
    expect(store.documentId).not.toBe("document-source");
    expect(store.documentId).not.toBe(copy.documentId);
    expect(store.mode).toEqual({ kind: "writable" });
    expect(statSync(sourcePath).isFile()).toBe(true);
    expect(readLease(leaseRoot).documentId).toBe(store.documentId);

    const sourceWriter = await storeClass().open(sourcePath, {
      access: "require-write",
      environment: environment(leaseRoot, "source-writer")
    });
    expect(sourceWriter.mode).toEqual({ kind: "writable" });
    await sourceWriter.close();
    await store.close();
  });

  it("Save As from read-only acquires the destination lease and switches only after validation", async () => {
    const creator = await storeClass().create(sourcePath, {
      appVersion: "4.0.0",
      documentId: "document-read-only-source",
      environment: environment(leaseRoot, "creator"),
      initialGraph: initialGraph(),
      title: "Read-only Save As"
    });
    await creator.close();
    const readOnly = await storeClass().open(sourcePath, {
      access: "read-only",
      environment: environment(leaseRoot, "read-only")
    });
    const destination = path.join(root, "WritableDestination.ether");
    await readOnly.saveAs(destination);
    expect(readOnly.path).toBe(path.resolve(destination));
    expect(readOnly.documentId).not.toBe("document-read-only-source");
    expect(readOnly.mode).toEqual({ kind: "writable" });
    expect(readLease(leaseRoot).documentId).toBe(readOnly.documentId);
    await readOnly.close();
  });

  it("cleans every staged Save As and Save a Copy failure without partial destinations, temporary files, or leaked leases", async () => {
    const stages: SaveStage[] = [
      "reservation",
      "backup",
      "identity-rewrite",
      "validation",
      "fsync",
      "publication"
    ];
    for (const operation of ["copy", "save-as"] as const) {
      for (const stage of stages) {
        const caseRoot = path.join(root, `${operation}-${stage}`);
        mkdirSync(caseRoot);
        const caseLeaseRoot = path.join(caseRoot, "leases");
        const caseSource = path.join(caseRoot, "Source.ether");
        const fail = new Error(`injected ${stage} failure`);
        const store = await storeClass().create(caseSource, {
          appVersion: "4.0.0",
          documentId: `document-${operation}-${stage}`,
          environment: environment(caseLeaseRoot, `${operation}-${stage}`, {
            onSaveStage: (current) => {
              if (current === stage) {
                throw fail;
              }
            }
          }),
          initialGraph: initialGraph(),
          title: "Failure injection"
        });
        const destination = path.join(caseRoot, "Destination.ether");

        await expect(
          operation === "copy" ? store.saveCopy(destination) : store.saveAs(destination)
        ).rejects.toThrow(fail.message);
        expect(statSync(destination, { throwIfNoEntry: false })).toBeUndefined();
        expect(readdirSync(caseRoot).sort()).toEqual(["Source.ether", "leases"]);
        expect(readdirSync(caseLeaseRoot)).toHaveLength(1);
        expect(store.path).toBe(path.resolve(caseSource));
        expect(store.documentId).toBe(`document-${operation}-${stage}`);
        expect(store.mode).toEqual({ kind: "writable" });
        await store.close();
        expect(readdirSync(caseLeaseRoot)).toEqual([]);
      }
    }
  });
});
