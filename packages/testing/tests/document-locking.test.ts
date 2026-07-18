import * as documentPackage from "@ether/document";
import type { EtherGraph } from "@ether/schema";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
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
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

type AccessMode = "prefer-write" | "read-only" | "require-write";
type SaveStage =
  | "reservation"
  | "backup"
  | "identity-rewrite"
  | "validation"
  | "fsync"
  | "publication"
  | "post-publication";
type CreateStage = "format-initialized" | "genesis-initialized";
type CompactStage =
  | "vacuum"
  | "validation"
  | "fsync"
  | "rollback-created"
  | "publication"
  | "post-publication";
type WritableLocationKind = "cloud-placeholder" | "local-fixed" | "mapped-network" | "unknown";

interface StoreEnvironment {
  appInstanceId: string;
  heartbeatMs?: number;
  leaseRoot: string;
  locationCapability?: { classify(filePath: string): WritableLocationKind };
  machineId: string;
  now?: () => number;
  onCreateStage?: (stage: CreateStage) => void;
  onCompactStage?: (stage: CompactStage) => void;
  onHeartbeat?: () => void;
  onLeaseMutexAcquired?: () => void;
  onSaveStage?: (stage: SaveStage) => void;
  pid?: number;
  processIsAlive?: (pid: number, machineId: string) => boolean;
  recoveryRoot?: string;
  staleMs?: number;
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
  compact(): Promise<{ beforeBytes: number; afterBytes: number }>;
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
  const files = leaseRecordPaths(leaseRoot);
  expect(files).toHaveLength(1);
  return files[0];
}

function leaseRecordPaths(leaseRoot: string): string[] {
  return readdirSync(leaseRoot)
    .filter((file) => /^[a-f0-9]{64}\.json$/.test(file))
    .map((file) => path.join(leaseRoot, file));
}

function leasePathFor(leaseRoot: string, filePath: string): string {
  const resolved = path.resolve(filePath);
  const canonical = process.platform === "win32" ? resolved.toLowerCase() : resolved;
  const hash = createHash("sha256").update(canonical).digest("hex");
  return path.join(leaseRoot, `${hash}.json`);
}

function mutexDatabasePathFor(leaseRoot: string, filePath: string): string {
  return leasePathFor(leaseRoot, filePath).replace(/\.json$/, ".mutex.sqlite");
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

  it("does not publish a destination when creation fails between format initialization and genesis", async () => {
    const failure = new Error("injected pre-genesis failure");
    let created: StoreInstance | undefined;
    let caught: unknown;
    try {
      created = await storeClass().create(sourcePath, {
        appVersion: "4.0.0",
        documentId: "document-pre-genesis",
        environment: environment(leaseRoot, "creator", {
          onCreateStage: (stage) => {
            if (stage === "format-initialized") {
              throw failure;
            }
          }
        }),
        initialGraph: initialGraph(),
        title: "Pre-genesis"
      });
    } catch (error) {
      caught = error;
    }
    await created?.close();
    expect(caught).toMatchObject({ message: expect.stringContaining(failure.message) });
    expect(statSync(sourcePath, { throwIfNoEntry: false })).toBeUndefined();
    expect(readdirSync(root)).toEqual([]);
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
    expect(leaseRecordPaths(leaseRoot)).toEqual([]);
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

  it("rereads freshness and liveness after the SQLite reclaim probe", async () => {
    let now = 100_000;
    const owner = await storeClass().create(sourcePath, {
      appVersion: "4.0.0",
      documentId: "document-refresh-during-probe",
      environment: environment(leaseRoot, "owner", {
        heartbeatMs: 60_000,
        now: () => now
      }),
      initialGraph: initialGraph(),
      title: "Refresh during probe"
    });
    const leasePath = onlyLeasePath(leaseRoot);
    const stale = { ...readLease(leaseRoot), heartbeatAt: 1 };
    await owner.close();
    writeFileSync(leasePath, JSON.stringify(stale));
    now = 200_000;
    let livenessChecks = 0;

    const competitor = await storeClass().open(sourcePath, {
      access: "prefer-write",
      environment: environment(leaseRoot, "competitor", {
        now: () => now,
        processIsAlive: () => {
          livenessChecks += 1;
          if (livenessChecks === 2) {
            writeFileSync(leasePath, JSON.stringify({ ...stale, heartbeatAt: now }));
          }
          return false;
        }
      })
    });

    expect(livenessChecks).toBeGreaterThanOrEqual(2);
    expect(competitor.mode).toEqual({ kind: "read-only", reason: "writer-active" });
    expect(readLease(leaseRoot)).toMatchObject({ appInstanceId: "owner", heartbeatAt: now });
    await competitor.close();
    rmSync(leasePath);
  });

  it("serializes simultaneous stale reclaimers so exactly one becomes the writer", async () => {
    const creator = await storeClass().create(sourcePath, {
      appVersion: "4.0.0",
      documentId: "document-simultaneous-reclaim",
      environment: environment(leaseRoot, "reclaim-creator"),
      initialGraph: initialGraph(),
      title: "Simultaneous reclaim"
    });
    const stale = { ...readLease(leaseRoot), heartbeatAt: 1, pid: 999_999 };
    const leasePath = onlyLeasePath(leaseRoot);
    await creator.close();
    writeFileSync(leasePath, JSON.stringify(stale));
    let nestedOpen: Promise<StoreInstance> | undefined;
    let launched = false;

    const winner = await storeClass().open(sourcePath, {
      access: "require-write",
      environment: environment(leaseRoot, "reclaimer-one", {
        now: () => 100_000,
        onLeaseMutexAcquired: () => {
          if (!launched) {
            launched = true;
            nestedOpen = storeClass().open(sourcePath, {
              access: "prefer-write",
              environment: environment(leaseRoot, "reclaimer-two", {
                now: () => 100_000,
                processIsAlive: () => false
              })
            });
          }
        },
        processIsAlive: () => false
      })
    });
    expect(nestedOpen).toBeDefined();
    const competitor = await nestedOpen!;
    expect(winner.mode).toEqual({ kind: "writable" });
    expect(competitor.mode).toEqual({ kind: "read-only", reason: "writer-active" });
    expect(readLease(leaseRoot).appInstanceId).toBe("reclaimer-one");
    await competitor.close();
    await winner.close();
  });

  it("waits for a held lease mutex during close and removes its owned lease afterward", async () => {
    const writer = await storeClass().create(sourcePath, {
      appVersion: "4.0.0",
      documentId: "document-close-mutex",
      environment: environment(leaseRoot, "close-mutex-writer"),
      initialGraph: initialGraph(),
      title: "Close mutex"
    });
    const leasePath = onlyLeasePath(leaseRoot);
    const mutexPath = mutexDatabasePathFor(leaseRoot, sourcePath);
    const mutex = new DatabaseSync(mutexPath);
    mutex.exec("CREATE TABLE IF NOT EXISTS lease_mutex (singleton INTEGER PRIMARY KEY)");
    mutex.exec("BEGIN IMMEDIATE");

    const closing = writer.close();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(statSync(leasePath, { throwIfNoEntry: false })).toBeDefined();
    mutex.exec("ROLLBACK");
    mutex.close();
    await closing;
    expect(statSync(leasePath, { throwIfNoEntry: false })).toBeUndefined();

    const nextWriter = await storeClass().open(sourcePath, {
      access: "require-write",
      environment: environment(leaseRoot, "writer-after-close")
    });
    expect(nextWriter.mode).toEqual({ kind: "writable" });
    await nextWriter.close();
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

  it("distinguishes malformed leases and only replaces one after the document probe succeeds", async () => {
    const creator = await storeClass().create(sourcePath, {
      appVersion: "4.0.0",
      documentId: "document-malformed-lease",
      environment: environment(leaseRoot, "malformed-creator"),
      initialGraph: initialGraph(),
      title: "Malformed lease"
    });
    await creator.close();
    const leasePath = leasePathFor(leaseRoot, sourcePath);
    writeFileSync(leasePath, "{ malformed lease", "utf8");
    const blocker = new DatabaseSync(sourcePath);
    blocker.exec("BEGIN IMMEDIATE");
    try {
      const blocked = await storeClass().open(sourcePath, {
        access: "prefer-write",
        environment: environment(leaseRoot, "malformed-blocked", {
          now: () => 100_000,
          processIsAlive: () => false
        })
      });
      expect(blocked.mode).toEqual({ kind: "read-only", reason: "sqlite-busy" });
      expect(readFileSync(leasePath, "utf8")).toBe("{ malformed lease");
      await blocked.close();
    } finally {
      blocker.exec("ROLLBACK");
      blocker.close();
    }

    const writer = await storeClass().open(sourcePath, {
      access: "require-write",
      environment: environment(leaseRoot, "malformed-reclaimer", {
        now: () => 100_000,
        processIsAlive: () => false
      })
    });
    expect(writer.mode).toEqual({ kind: "writable" });
    expect(() => JSON.parse(readFileSync(leasePath, "utf8"))).not.toThrow();
    expect(readdirSync(leaseRoot).filter((name) => name.includes("malformed"))).toEqual([]);
    await writer.close();
  });

  it("blocks mapped drives and cloud placeholders unless capability classification proves local fixed storage", async () => {
    const creator = await storeClass().create(sourcePath, {
      appVersion: "4.0.0",
      documentId: "document-location",
      environment: environment(leaseRoot, "creator"),
      initialGraph: initialGraph(),
      title: "Location"
    });
    await creator.close();

    for (const classification of ["mapped-network", "cloud-placeholder", "unknown"] as const) {
      const blocked = await storeClass().open(sourcePath, {
        access: "prefer-write",
        environment: environment(leaseRoot, `blocked-${classification}`, {
          locationCapability: { classify: () => classification }
        })
      });
      expect(blocked.mode).toEqual({ kind: "read-only", reason: "location-unsupported" });
      await blocked.close();
    }

    const approved = await storeClass().open(sourcePath, {
      access: "require-write",
      environment: environment(leaseRoot, "approved", {
        locationCapability: { classify: () => "local-fixed" }
      })
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
    expect(leaseRecordPaths(leaseRoot)).toEqual([]);
    await writer.close();
  });

  it("restores the active document when staged Compact fails after publication", async () => {
    const failure = new Error("injected compact failure after publication");
    const store = await storeClass().create(sourcePath, {
      appVersion: "4.0.0",
      documentId: "document-compact-rollback",
      environment: environment(leaseRoot, "compact-rollback", {
        recoveryRoot: path.join(root, "recovery"),
        onCompactStage: (stage) => {
          if (stage === "post-publication") throw failure;
        }
      }),
      initialGraph: initialGraph(),
      title: "Compact rollback"
    });
    const original = readFileSync(sourcePath);
    try {
      await expect(store.compact()).rejects.toThrow(failure.message);

      expect(readFileSync(sourcePath)).toEqual(original);
      expect(store.documentId).toBe("document-compact-rollback");
      expect(store.mode).toEqual({ kind: "writable" });
      const reader = await storeClass().open(sourcePath, {
        access: "read-only",
        environment: environment(leaseRoot, "compact-rollback-reader")
      });
      expect(reader.documentId).toBe("document-compact-rollback");
      await reader.close();
      expect(readdirSync(root).filter((name) => name.includes("compact") || name.includes("rollback"))).toEqual([]);
    } finally {
      await store.close();
    }
  }, 15_000);

  it("recovers a Compact replacement interrupted after publication", async () => {
    const recoveryRoot = path.join(root, "recovery");
    const source = await storeClass().create(sourcePath, {
      appVersion: "4.0.0",
      documentId: "document-compact-interrupted",
      environment: environment(leaseRoot, "compact-interrupted-create", { recoveryRoot }),
      initialGraph: initialGraph(),
      title: "Compact interrupted"
    });
    await source.close();
    const documentEntry = pathToFileURL(
      path.resolve(import.meta.dirname, "../../document/dist/index.js")
    ).href;

    const child = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        `import { DocumentStore } from ${JSON.stringify(documentEntry)};
         const store = await DocumentStore.open(${JSON.stringify(sourcePath)}, {
           access: "require-write",
           environment: {
             appInstanceId: "compact-interrupted-child",
             leaseRoot: ${JSON.stringify(leaseRoot)},
             recoveryRoot: ${JSON.stringify(recoveryRoot)},
             machineId: "test-machine",
             processIsAlive: () => false,
             onCompactStage: (stage) => {
               if (stage === "post-publication") process.kill(process.pid, "SIGKILL");
             }
           }
         });
         await store.compact();`
      ],
      { encoding: "utf8", timeout: 10_000 }
    );
    expect(child.status).not.toBe(0);

    const recovered = await storeClass().open(sourcePath, {
      access: "require-write",
      environment: environment(leaseRoot, "compact-interrupted-recovery", {
        now: () => Date.now() + 60_000,
        processIsAlive: () => false,
        recoveryRoot,
        staleMs: 1
      })
    });
    expect(recovered.documentId).toBe("document-compact-interrupted");
    expect(recovered.mode).toEqual({ kind: "writable" });
    await recovered.close();
    expect(readdirSync(root).filter((name) => name.includes("compact") || name.includes("rollback"))).toEqual([]);
    expect(readdirSync(recoveryRoot, { recursive: true })).toEqual([]);
  }, 20_000);

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

  it("atomically replaces a real existing Save As destination on Windows", async () => {
    const destination = path.join(root, "Existing.ether");
    const existing = await storeClass().create(destination, {
      appVersion: "4.0.0",
      documentId: "document-existing-destination",
      environment: environment(leaseRoot, "existing"),
      initialGraph: initialGraph(),
      title: "Existing destination"
    });
    await existing.close();

    const source = await storeClass().create(sourcePath, {
      appVersion: "4.0.0",
      documentId: "document-replacement-source",
      environment: environment(leaseRoot, "source"),
      initialGraph: initialGraph(),
      title: "Replacement source"
    });
    await source.saveAs(destination);

    expect(source.path).toBe(path.resolve(destination));
    expect(source.documentId).not.toBe("document-existing-destination");
    expect(source.documentId).not.toBe("document-replacement-source");
    const reader = await storeClass().open(destination, {
      access: "read-only",
      environment: environment(leaseRoot, "reader")
    });
    expect(reader.documentId).toBe(source.documentId);
    await reader.close();
    expect(statSync(sourcePath).isFile()).toBe(true);
    await source.close();
  });

  it("refuses an unleased busy existing Save As destination after probing that file directly", async () => {
    const destination = path.join(root, "Busy-unleased-existing.ether");
    const existingId = "document-busy-unleased-destination";
    const existing = await storeClass().create(destination, {
      appVersion: "4.0.0",
      documentId: existingId,
      environment: environment(leaseRoot, "busy-unleased-existing"),
      initialGraph: initialGraph(),
      title: "Busy unleased existing"
    });
    await existing.close();
    expect(statSync(leasePathFor(leaseRoot, destination), { throwIfNoEntry: false })).toBeUndefined();
    const oldBytes = readFileSync(destination);
    const source = await storeClass().create(sourcePath, {
      appVersion: "4.0.0",
      documentId: "document-busy-unleased-source",
      environment: environment(leaseRoot, "busy-unleased-source"),
      initialGraph: initialGraph(),
      title: "Busy unleased source"
    });
    const blocker = new DatabaseSync(destination);
    blocker.exec("BEGIN IMMEDIATE");
    try {
      await expect(source.saveAs(destination)).rejects.toMatchObject({
        code: "WRITER_LEASE_UNAVAILABLE",
        reason: "sqlite-busy"
      });
    } finally {
      blocker.exec("ROLLBACK");
      blocker.close();
    }

    expect(Buffer.compare(readFileSync(destination), oldBytes)).toBe(0);
    expect(source.path).toBe(path.resolve(sourcePath));
    expect(source.documentId).toBe("document-busy-unleased-source");
    await source.close();
  });

  it("refuses an arbitrary existing Save As destination without an overwrite confirmation contract", async () => {
    const destination = path.join(root, "Arbitrary-existing.ether");
    const original = Buffer.from("not an Ether SQLite document", "utf8");
    writeFileSync(destination, original);
    const source = await storeClass().create(sourcePath, {
      appVersion: "4.0.0",
      documentId: "document-arbitrary-destination-source",
      environment: environment(leaseRoot, "arbitrary-destination-source"),
      initialGraph: initialGraph(),
      title: "Arbitrary destination source"
    });

    await expect(source.saveAs(destination)).rejects.toMatchObject({
      code: "WRITER_LEASE_UNAVAILABLE",
      reason: "sqlite-busy"
    });
    expect(Buffer.compare(readFileSync(destination), original)).toBe(0);
    expect(source.path).toBe(path.resolve(sourcePath));
    expect(source.documentId).toBe("document-arbitrary-destination-source");
    await source.close();
  });

  it("restores an existing Save As destination when switching fails after publication", async () => {
    const destination = path.join(root, "Existing-after-publication.ether");
    const existingId = "document-existing-after-publication";
    const existing = await storeClass().create(destination, {
      appVersion: "4.0.0",
      documentId: existingId,
      environment: environment(leaseRoot, "existing-after-publication"),
      initialGraph: initialGraph(),
      title: "Existing destination"
    });
    await existing.close();
    const oldBytes = readFileSync(destination);
    const failure = new Error("injected failure after publication");
    const source = await storeClass().create(sourcePath, {
      appVersion: "4.0.0",
      documentId: "document-post-publication-source",
      environment: environment(leaseRoot, "post-publication-source", {
        onSaveStage: (stage) => {
          if (stage === "post-publication") {
            throw failure;
          }
        }
      }),
      initialGraph: initialGraph(),
      title: "Replacement source"
    });

    await expect(source.saveAs(destination)).rejects.toThrow(failure.message);
    expect(Buffer.compare(readFileSync(destination), oldBytes)).toBe(0);
    const restored = await storeClass().open(destination, {
      access: "read-only",
      environment: environment(leaseRoot, "restored-reader")
    });
    expect(restored.documentId).toBe(existingId);
    await restored.close();
    expect(source.path).toBe(path.resolve(sourcePath));
    expect(source.documentId).toBe("document-post-publication-source");
    expect(source.mode).toEqual({ kind: "writable" });
    expect(readdirSync(root).sort()).toEqual([
      "Existing-after-publication.ether",
      "Source.ether",
      "leases"
    ]);
    expect(readLease(leaseRoot).documentId).toBe("document-post-publication-source");
    await source.close();
    expect(leaseRecordPaths(leaseRoot)).toEqual([]);
  });

  it("does not treat the destination lease as source ownership after handoff cleanup fails", async () => {
    const destination = path.join(root, "Handoff-cleanup.ether");
    const recoveryRoot = path.join(root, "recovery");
    const existing = await storeClass().create(destination, {
      appVersion: "4.0.0",
      documentId: "document-handoff-existing",
      environment: environment(leaseRoot, "handoff-existing", { recoveryRoot }),
      initialGraph: initialGraph(),
      title: "Handoff existing"
    });
    await existing.close();
    const source = await storeClass().create(sourcePath, {
      appVersion: "4.0.0",
      documentId: "document-handoff-source",
      environment: environment(leaseRoot, "handoff-source", {
        recoveryRoot,
        onSaveStage: (stage) => {
          if (stage !== "post-publication") {
            return;
          }
          const rollback = readdirSync(root).find((name) => name.includes("ether-rollback"));
          expect(rollback).toBeDefined();
          rmSync(path.join(root, rollback as string));
        }
      }),
      initialGraph: initialGraph(),
      title: "Handoff source"
    });

    await expect(source.saveAs(destination)).rejects.toMatchObject({
      code: "REPLACEMENT_ROLLBACK_FAILED"
    });
    let competitor: StoreInstance | undefined;
    let sourceOwnershipWasSafe: boolean;
    try {
      competitor = await storeClass().open(sourcePath, {
        access: "require-write",
        environment: environment(leaseRoot, "handoff-source-competitor", { recoveryRoot })
      });
      sourceOwnershipWasSafe = source.mode.kind === "read-only";
    } catch (error) {
      expect(error).toMatchObject({ code: "WRITER_LEASE_UNAVAILABLE" });
      sourceOwnershipWasSafe = source.mode.kind === "writable";
    } finally {
      await competitor?.close();
      await source.close();
    }
    expect(sourceOwnershipWasSafe).toBe(true);
  });

  it("removes a published recovery journal when its rollback was already cleaned", async () => {
    const destination = path.join(root, "Published-cleanup.ether");
    const recoveryRoot = path.join(root, "recovery");
    const documentId = "document-published-cleanup";
    const destinationStore = await storeClass().create(destination, {
      appVersion: "4.0.0",
      documentId,
      environment: environment(leaseRoot, "published-cleanup-create", { recoveryRoot }),
      initialGraph: initialGraph(),
      title: "Published cleanup"
    });
    await destinationStore.close();
    mkdirSync(recoveryRoot, { recursive: true });
    const journalPath = path.join(recoveryRoot, `${randomUUID()}.json`);
    writeFileSync(
      journalPath,
      JSON.stringify({
        version: 1,
        journalId: path.basename(journalPath, ".json"),
        destinationPath: destination,
        sourcePath,
        sourceDocumentId: "document-published-source",
        newDocumentId: documentId,
        previousDocumentId: "document-published-previous",
        phase: "published",
        rollback: {
          path: path.join(root, `.Published-cleanup.ether.ether-rollback-${randomUUID()}`),
          sha256: "0".repeat(64),
          identity: { birthtimeNs: "0", dev: "0", ino: "0", size: "0" }
        }
      })
    );

    const reopened = await storeClass().open(destination, {
      access: "read-only",
      environment: environment(leaseRoot, "published-cleanup-open", { recoveryRoot })
    });
    await reopened.close();
    expect(statSync(journalPath, { throwIfNoEntry: false })).toBeUndefined();
  });

  it("removes a recovery journal when the previous destination was already restored", async () => {
    const destination = path.join(root, "Previous-restored.ether");
    const recoveryRoot = path.join(root, "recovery");
    const previousDocumentId = "document-previous-restored";
    const destinationStore = await storeClass().create(destination, {
      appVersion: "4.0.0",
      documentId: previousDocumentId,
      environment: environment(leaseRoot, "previous-restored-create", { recoveryRoot }),
      initialGraph: initialGraph(),
      title: "Previous restored"
    });
    await destinationStore.close();
    mkdirSync(recoveryRoot, { recursive: true });
    const journalPath = path.join(recoveryRoot, `${randomUUID()}.json`);
    writeFileSync(
      journalPath,
      JSON.stringify({
        version: 1,
        journalId: path.basename(journalPath, ".json"),
        destinationPath: destination,
        sourcePath,
        sourceDocumentId: "document-previous-source",
        newDocumentId: "document-previous-replacement",
        previousDocumentId,
        phase: "published",
        rollback: {
          path: path.join(root, `.Previous-restored.ether.ether-rollback-${randomUUID()}`),
          sha256: "0".repeat(64),
          identity: { birthtimeNs: "0", dev: "0", ino: "0", size: "0" }
        }
      })
    );

    const reopened = await storeClass().open(destination, {
      access: "read-only",
      environment: environment(leaseRoot, "previous-restored-open", { recoveryRoot })
    });
    await reopened.close();
    expect(statSync(journalPath, { throwIfNoEntry: false })).toBeUndefined();
  });

  it("preserves a recovery journal without aborting open when rollback status is indeterminate", async () => {
    const destination = path.join(root, "Indeterminate-rollback.ether");
    const recoveryRoot = path.join(root, "recovery");
    const documentId = "document-indeterminate-rollback";
    const destinationStore = await storeClass().create(destination, {
      appVersion: "4.0.0",
      documentId,
      environment: environment(leaseRoot, "indeterminate-create", { recoveryRoot }),
      initialGraph: initialGraph(),
      title: "Indeterminate rollback"
    });
    await destinationStore.close();
    mkdirSync(recoveryRoot, { recursive: true });
    const journalPath = path.join(recoveryRoot, `${randomUUID()}.json`);
    const invalidRollbackPath =
      path.join(root, `.Indeterminate-rollback.ether.ether-rollback-${randomUUID()}`) + "\0";
    writeFileSync(
      journalPath,
      JSON.stringify({
        version: 1,
        journalId: path.basename(journalPath, ".json"),
        destinationPath: destination,
        sourcePath,
        sourceDocumentId: "document-indeterminate-source",
        newDocumentId: documentId,
        previousDocumentId: "document-indeterminate-previous",
        phase: "published",
        rollback: {
          path: invalidRollbackPath,
          sha256: "0".repeat(64),
          identity: { birthtimeNs: "0", dev: "0", ino: "0", size: "0" }
        }
      })
    );

    const reopened = await storeClass().open(destination, {
      access: "read-only",
      environment: environment(leaseRoot, "indeterminate-open", { recoveryRoot })
    });
    await reopened.close();
    expect(statSync(journalPath)).toBeDefined();
  });

  it("never leaves two writable stores when releasing the source lease times out during Save As", async () => {
    const destination = path.join(root, "Held-source-lease.ether");
    let now = 1;
    let sourceMutex: DatabaseSync | undefined;
    const source = await storeClass().create(sourcePath, {
      appVersion: "4.0.0",
      documentId: "document-held-source-lease",
      environment: environment(leaseRoot, "held-source", {
        heartbeatMs: 10,
        now: () => now,
        onSaveStage: (stage) => {
          if (stage !== "post-publication") {
            return;
          }
          sourceMutex = new DatabaseSync(mutexDatabasePathFor(leaseRoot, sourcePath));
          sourceMutex.exec("BEGIN IMMEDIATE");
          setTimeout(() => {
            sourceMutex?.exec("ROLLBACK");
            sourceMutex?.close();
            sourceMutex = undefined;
          }, 2_100);
        }
      }),
      initialGraph: initialGraph(),
      title: "Held source lease"
    });

    await expect(source.saveAs(destination)).rejects.toBeDefined();
    now = 100_000;
    await new Promise((resolve) => setTimeout(resolve, 40));
    const competitor = await storeClass().open(sourcePath, {
      access: "prefer-write",
      environment: environment(leaseRoot, "held-source-competitor", {
        now: () => now,
        processIsAlive: () => false,
        staleMs: 1
      })
    });
    expect([source.mode.kind, competitor.mode.kind].filter((kind) => kind === "writable")).toHaveLength(1);
    await competitor.close();
    await source.close();
  }, 10_000);

  it("reconciles a killed Save As replacement from its AppData recovery journal", async () => {
    const destination = path.join(root, "Killed-replacement.ether");
    const recoveryRoot = path.join(root, "recovery");
    const existing = await storeClass().create(destination, {
      appVersion: "4.0.0",
      documentId: "document-killed-existing",
      environment: environment(leaseRoot, "killed-existing", { recoveryRoot }),
      initialGraph: initialGraph(),
      title: "Killed existing"
    });
    await existing.close();
    const source = await storeClass().create(sourcePath, {
      appVersion: "4.0.0",
      documentId: "document-killed-source",
      environment: environment(leaseRoot, "killed-source-create", { recoveryRoot }),
      initialGraph: initialGraph(),
      title: "Killed source"
    });
    await source.close();

    const documentEntry = pathToFileURL(
      path.resolve(import.meta.dirname, "../../document/dist/index.js")
    ).href;
    const child = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        `import { DocumentStore } from ${JSON.stringify(documentEntry)};
         const store = await DocumentStore.open(${JSON.stringify(sourcePath)}, {
           access: "require-write",
           environment: {
             appInstanceId: "killed-child",
             leaseRoot: ${JSON.stringify(leaseRoot)},
             recoveryRoot: ${JSON.stringify(recoveryRoot)},
             machineId: "test-machine",
             processIsAlive: () => false,
             onSaveStage: (stage) => {
               if (stage === "post-publication") process.kill(process.pid, "SIGKILL");
             }
           }
         });
         await store.saveAs(${JSON.stringify(destination)});`
      ],
      { encoding: "utf8", timeout: 10_000 }
    );
    expect(child.status).not.toBe(0);

    const recovered = await storeClass().open(destination, {
      access: "require-write",
      environment: environment(leaseRoot, "killed-recovery", {
        now: () => Date.now() + 60_000,
        processIsAlive: () => false,
        recoveryRoot,
        staleMs: 1
      })
    });
    expect(recovered.documentId).not.toBe("document-killed-existing");
    expect(recovered.documentId).not.toBe("document-killed-source");
    await recovered.close();
    expect(readdirSync(root).filter((name) => name.includes("ether-rollback"))).toEqual([]);
    expect(readdirSync(recoveryRoot, { recursive: true })).toEqual([]);
    const reclaimedSource = await storeClass().open(sourcePath, {
      access: "require-write",
      environment: environment(leaseRoot, "killed-source-recovery", {
        now: () => Date.now() + 60_000,
        processIsAlive: () => false,
        recoveryRoot,
        staleMs: 1
      })
    });
    await reclaimedSource.close();
    expect(leaseRecordPaths(leaseRoot)).toEqual([]);
  }, 20_000);

  it("probes a stale leased existing Save As destination and refuses replacement while it is busy", async () => {
    const destination = path.join(root, "Busy-existing.ether");
    const existingId = "document-busy-existing-destination";
    const existing = await storeClass().create(destination, {
      appVersion: "4.0.0",
      documentId: existingId,
      environment: environment(leaseRoot, "busy-existing"),
      initialGraph: initialGraph(),
      title: "Busy existing"
    });
    await existing.close();
    const oldBytes = readFileSync(destination);
    const destinationLeasePath = leasePathFor(leaseRoot, destination);
    const pathHash = path.basename(destinationLeasePath, ".json");
    writeFileSync(
      destinationLeasePath,
      JSON.stringify({
        appInstanceId: "crashed-destination-owner",
        documentId: existingId,
        heartbeatAt: 1,
        machineId: "test-machine",
        ownerToken: randomUUID(),
        pathHash,
        pid: 999_999
      } satisfies LeaseRecord)
    );
    const source = await storeClass().create(sourcePath, {
      appVersion: "4.0.0",
      documentId: "document-busy-save-as-source",
      environment: environment(leaseRoot, "busy-save-as-source", {
        now: () => 100_000,
        processIsAlive: () => false
      }),
      initialGraph: initialGraph(),
      title: "Busy Save As source"
    });
    const blocker = new DatabaseSync(destination);
    blocker.exec("BEGIN IMMEDIATE");
    try {
      await expect(source.saveAs(destination)).rejects.toMatchObject({
        code: "WRITER_LEASE_UNAVAILABLE",
        reason: "sqlite-busy"
      });
    } finally {
      blocker.exec("ROLLBACK");
      blocker.close();
    }

    expect(Buffer.compare(readFileSync(destination), oldBytes)).toBe(0);
    expect(readFileSync(destinationLeasePath, "utf8")).toContain(existingId);
    expect(source.path).toBe(path.resolve(sourcePath));
    expect(source.documentId).toBe("document-busy-save-as-source");
    expect(source.mode).toEqual({ kind: "writable" });
    await source.close();
    rmSync(destinationLeasePath);
  });

  it("preserves an existing Save As destination through every injected pre-publication failure", async () => {
    const stages: SaveStage[] = [
      "reservation",
      "backup",
      "identity-rewrite",
      "validation",
      "fsync",
      "publication"
    ];
    for (const stage of stages) {
      const caseRoot = path.join(root, `replace-${stage}`);
      mkdirSync(caseRoot);
      const caseLeaseRoot = path.join(caseRoot, "leases");
      const caseSource = path.join(caseRoot, "Source.ether");
      const destination = path.join(caseRoot, "Destination.ether");
      const existingId = `document-existing-${stage}`;
      const existing = await storeClass().create(destination, {
        appVersion: "4.0.0",
        documentId: existingId,
        environment: environment(caseLeaseRoot, `existing-${stage}`),
        initialGraph: initialGraph(),
        title: "Existing destination"
      });
      await existing.close();

      const failure = new Error(`injected replacement ${stage} failure`);
      const source = await storeClass().create(caseSource, {
        appVersion: "4.0.0",
        documentId: `document-source-${stage}`,
        environment: environment(caseLeaseRoot, `source-${stage}`, {
          onSaveStage: (current) => {
            if (current === stage) {
              throw failure;
            }
          }
        }),
        initialGraph: initialGraph(),
        title: "Replacement source"
      });

      await expect(source.saveAs(destination)).rejects.toThrow(failure.message);
      const preserved = await storeClass().open(destination, {
        access: "read-only",
        environment: environment(caseLeaseRoot, `reader-${stage}`)
      });
      expect(preserved.documentId).toBe(existingId);
      await preserved.close();
      expect(source.path).toBe(path.resolve(caseSource));
      expect(source.documentId).toBe(`document-source-${stage}`);
      expect(readdirSync(caseRoot).sort()).toEqual(["Destination.ether", "Source.ether", "leases"]);
      await source.close();
    }
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
        expect(leaseRecordPaths(caseLeaseRoot)).toHaveLength(1);
        expect(store.path).toBe(path.resolve(caseSource));
        expect(store.documentId).toBe(`document-${operation}-${stage}`);
        expect(store.mode).toEqual({ kind: "writable" });
        await store.close();
        expect(leaseRecordPaths(caseLeaseRoot)).toEqual([]);
      }
    }
  });
});
