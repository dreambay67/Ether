import { WriterLeaseRecordSchema, type WriterLeaseRecord } from "@ether/schema";
import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export type ReadOnlyReason =
  | "requested"
  | "writer-active"
  | "location-unsupported"
  | "sqlite-busy"
  | "heartbeat-failed";

export type CreateStage = "format-initialized" | "genesis-initialized";
export type WritableLocationKind =
  | "cloud-placeholder"
  | "local-fixed"
  | "mapped-network"
  | "unknown";

export interface WritableLocationCapabilityAdapter {
  classify(filePath: string): WritableLocationKind;
}

export interface DocumentStoreEnvironment {
  appInstanceId?: string;
  heartbeatMs?: number;
  leaseRoot?: string;
  locationCapability?: WritableLocationCapabilityAdapter;
  machineId?: string;
  now?: () => number;
  onCreateStage?: (stage: CreateStage) => void;
  onHeartbeat?: () => void;
  onLeaseMutexAcquired?: () => void;
  onSaveStage?: (stage: SaveStage) => void;
  pid?: number;
  processIsAlive?: (pid: number, machineId: string) => boolean;
  recoveryRoot?: string;
  staleMs?: number;
}

export type SaveStage =
  | "reservation"
  | "backup"
  | "identity-rewrite"
  | "validation"
  | "fsync"
  | "publication"
  | "post-publication";

interface ResolvedEnvironment {
  appInstanceId: string;
  heartbeatMs: number;
  leaseRoot: string;
  locationCapability: WritableLocationCapabilityAdapter;
  machineId: string;
  now: () => number;
  onCreateStage?: (stage: CreateStage) => void;
  onHeartbeat?: () => void;
  onLeaseMutexAcquired?: () => void;
  onSaveStage?: (stage: SaveStage) => void;
  pid: number;
  processIsAlive: (pid: number, machineId: string) => boolean;
  recoveryRoot: string;
  staleMs: number;
}

export interface LeaseAcquisition {
  lease?: WriterLease;
  reason?: "writer-active" | "sqlite-busy";
}

function defaultLeaseRoot(): string {
  const localAppData = process.env.LOCALAPPDATA;
  if (localAppData !== undefined && localAppData.length > 0) {
    return path.join(localAppData, "DreamBay", "Ether", "leases");
  }
  return path.join(os.homedir(), "AppData", "Local", "DreamBay", "Ether", "leases");
}

function defaultRecoveryRoot(): string {
  return path.join(path.dirname(defaultLeaseRoot()), "recovery");
}

function canonicalPath(filePath: string): string {
  const resolved = path.resolve(filePath);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function insidePath(candidate: string, root: string): boolean {
  const relative = path.relative(canonicalPath(root), canonicalPath(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function defaultLocationKind(filePath: string): WritableLocationKind {
  const canonical = canonicalPath(filePath);
  if (canonical.startsWith("\\\\") || canonical.startsWith("//")) {
    return "mapped-network";
  }
  const cloudRoots = [
    process.env.OneDrive,
    process.env.OneDriveCommercial,
    process.env.OneDriveConsumer,
    process.env.Dropbox
  ].filter((value): value is string => value !== undefined && value.length > 0);
  if (cloudRoots.some((root) => insidePath(canonical, root))) {
    return "cloud-placeholder";
  }
  if (process.platform !== "win32") {
    return "unknown";
  }
  const systemRoot = path.parse(process.env.SystemRoot ?? process.cwd()).root.toLowerCase();
  const candidateRoot = path.parse(canonical).root.toLowerCase();
  return candidateRoot !== "" && candidateRoot === systemRoot ? "local-fixed" : "unknown";
}

function localProcessIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String((error as { code?: unknown }).code)
        : undefined;
    return code === "EPERM";
  }
}

export function resolveDocumentStoreEnvironment(
  environment: DocumentStoreEnvironment = {}
): ResolvedEnvironment {
  const machineId = environment.machineId ?? os.hostname();
  return {
    appInstanceId: environment.appInstanceId ?? randomUUID(),
    heartbeatMs: environment.heartbeatMs ?? 2_000,
    leaseRoot: path.resolve(environment.leaseRoot ?? defaultLeaseRoot()),
    locationCapability: environment.locationCapability ?? { classify: defaultLocationKind },
    machineId,
    now: environment.now ?? Date.now,
    onCreateStage: environment.onCreateStage,
    onHeartbeat: environment.onHeartbeat,
    onLeaseMutexAcquired: environment.onLeaseMutexAcquired,
    onSaveStage: environment.onSaveStage,
    pid: environment.pid ?? process.pid,
    processIsAlive:
      environment.processIsAlive ??
      ((pid, ownerMachineId) => ownerMachineId === machineId && localProcessIsAlive(pid)),
    recoveryRoot: path.resolve(environment.recoveryRoot ?? defaultRecoveryRoot()),
    staleMs: environment.staleMs ?? 15_000
  };
}

export type DocumentStoreRuntime = ReturnType<typeof resolveDocumentStoreEnvironment>;

export function documentPathHash(filePath: string): string {
  return createHash("sha256").update(canonicalPath(filePath)).digest("hex");
}

function leasePath(runtime: ResolvedEnvironment, filePath: string): string {
  return path.join(runtime.leaseRoot, `${documentPathHash(filePath)}.json`);
}

interface LeaseMutexClaim {
  database: DatabaseSync;
}

function mutexPath(leaseFilePath: string): string {
  return leaseFilePath.replace(/\.json$/, ".mutex.sqlite");
}

function isSqliteBusy(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const code = "code" in error ? String((error as { code?: unknown }).code) : "";
  const message = error instanceof Error ? error.message : "";
  return code === "ERR_SQLITE_ERROR" && /busy|locked/i.test(message);
}

function acquireMutex(
  leaseFilePath: string,
  runtime: ResolvedEnvironment
): LeaseMutexClaim | undefined {
  const filePath = mutexPath(leaseFilePath);
  const database = new DatabaseSync(filePath, { timeout: 25 });
  let transactionOpen = false;
  try {
    database.exec("PRAGMA busy_timeout = 25");
    database.exec(
      "CREATE TABLE IF NOT EXISTS lease_mutex (singleton INTEGER PRIMARY KEY CHECK (singleton = 1))"
    );
    database.exec("BEGIN IMMEDIATE");
    transactionOpen = true;
    runtime.onLeaseMutexAcquired?.();
    return { database };
  } catch (error) {
    if (transactionOpen) {
      try {
        database.exec("ROLLBACK");
      } catch {
        // Closing the connection still releases the process-owned SQLite lock.
      }
    }
    database.close();
    if (isSqliteBusy(error)) {
      return undefined;
    }
    throw error;
  }
}

function releaseMutex(claim: LeaseMutexClaim): void {
  try {
    claim.database.exec("COMMIT");
  } catch {
    try {
      claim.database.exec("ROLLBACK");
    } catch {
      // Closing the connection is the final lock-release authority.
    }
  } finally {
    claim.database.close();
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

type LeaseReadResult =
  | { kind: "malformed" }
  | { kind: "missing" }
  | { kind: "valid"; record: WriterLeaseRecord };

function readLease(filePath: string): LeaseReadResult {
  let serialized: string;
  try {
    serialized = readFileSync(filePath, "utf8");
  } catch (error) {
    const missing =
      typeof error === "object" && error !== null && "code" in error
        ? (error as { code?: unknown }).code === "ENOENT"
        : false;
    if (missing) {
      return { kind: "missing" };
    }
    throw error;
  }
  try {
    return { kind: "valid", record: WriterLeaseRecordSchema.parse(JSON.parse(serialized)) };
  } catch {
    return { kind: "malformed" };
  }
}

function removeMalformedLease(filePath: string): void {
  const quarantinePath = `${filePath}.malformed-${randomUUID()}`;
  renameSync(filePath, quarantinePath);
  unlinkSync(quarantinePath);
}

function replaceLeaseAtomically(filePath: string, record: WriterLeaseRecord): void {
  const temporaryPath = `${filePath}.tmp-${randomUUID()}`;
  let descriptor: number | undefined;
  try {
    descriptor = openSync(temporaryPath, "wx", 0o600);
    writeFileSync(descriptor, JSON.stringify(WriterLeaseRecordSchema.parse(record)), "utf8");
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporaryPath, filePath);
  } finally {
    if (descriptor !== undefined) {
      closeSync(descriptor);
    }
    try {
      unlinkSync(temporaryPath);
    } catch {
      // The owned temporary was either published or already absent.
    }
  }
}

function reserveLease(filePath: string, record: WriterLeaseRecord): boolean {
  let descriptor: number;
  try {
    descriptor = openSync(filePath, "wx", 0o600);
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String((error as { code?: unknown }).code)
        : undefined;
    if (code === "EEXIST") {
      return false;
    }
    throw error;
  }
  try {
    writeFileSync(descriptor, JSON.stringify(WriterLeaseRecordSchema.parse(record)), "utf8");
  } finally {
    closeSync(descriptor);
  }
  return true;
}

function probeAvailable(probe: () => void): boolean {
  try {
    probe();
    return true;
  } catch {
    return false;
  }
}

export class WriterLease {
  readonly filePath: string;
  readonly record: WriterLeaseRecord;
  private readonly runtime: ResolvedEnvironment;
  private heartbeatTimer: NodeJS.Timeout | undefined;
  private releasePromise: Promise<void> | undefined;
  private released = false;

  private constructor(
    filePath: string,
    record: WriterLeaseRecord,
    runtime: ResolvedEnvironment
  ) {
    this.filePath = filePath;
    this.record = record;
    this.runtime = runtime;
  }

  static acquire(
    filePath: string,
    documentId: string,
    runtime: ResolvedEnvironment,
    sqliteProbe: () => void,
    staleReclaimProbe: () => void = sqliteProbe
  ): LeaseAcquisition {
    mkdirSync(runtime.leaseRoot, { recursive: true });
    const targetPath = leasePath(runtime, filePath);
    const mutex = acquireMutex(targetPath, runtime);
    if (mutex === undefined) {
      return { reason: "writer-active" };
    }
    try {
      const existingRead = readLease(targetPath);
      if (existingRead.kind === "valid") {
        const existing = existingRead.record;
        const heartbeatFresh = runtime.now() - existing.heartbeatAt <= runtime.staleMs;
        const ownerAlive = runtime.processIsAlive(existing.pid, existing.machineId);
        if (heartbeatFresh || ownerAlive) {
          return { reason: "writer-active" };
        }
        if (!probeAvailable(staleReclaimProbe)) {
          return { reason: "sqlite-busy" };
        }
        const currentRead = readLease(targetPath);
        if (currentRead.kind !== "valid" || currentRead.record.ownerToken !== existing.ownerToken) {
          return { reason: "writer-active" };
        }
        const current = currentRead.record;
        const refreshedHeartbeatFresh = runtime.now() - current.heartbeatAt <= runtime.staleMs;
        const refreshedOwnerAlive = runtime.processIsAlive(current.pid, current.machineId);
        const finalRead = readLease(targetPath);
        if (
          refreshedHeartbeatFresh ||
          refreshedOwnerAlive ||
          finalRead.kind !== "valid" ||
          finalRead.record.ownerToken !== current.ownerToken ||
          runtime.now() - finalRead.record.heartbeatAt <= runtime.staleMs
        ) {
          return { reason: "writer-active" };
        }
        unlinkSync(targetPath);
      } else if (existingRead.kind === "malformed") {
        if (!probeAvailable(sqliteProbe)) {
          return { reason: "sqlite-busy" };
        }
        removeMalformedLease(targetPath);
      } else if (!probeAvailable(sqliteProbe)) {
        return { reason: "sqlite-busy" };
      }

      const record = WriterLeaseRecordSchema.parse({
        pid: runtime.pid,
        machineId: runtime.machineId,
        appInstanceId: runtime.appInstanceId,
        pathHash: documentPathHash(filePath),
        documentId,
        ownerToken: randomUUID(),
        heartbeatAt: runtime.now()
      });
      if (!reserveLease(targetPath, record)) {
        return { reason: "writer-active" };
      }
      return { lease: new WriterLease(targetPath, record, runtime) };
    } finally {
      releaseMutex(mutex);
    }
  }

  start(onFailure: () => void): void {
    if (this.heartbeatTimer !== undefined || this.releasePromise !== undefined || this.released) {
      return;
    }
    this.heartbeatTimer = setInterval(() => {
      let mutex: LeaseMutexClaim | undefined;
      try {
        mutex = acquireMutex(this.filePath, this.runtime);
      } catch {
        void this.release().then(onFailure, onFailure);
        return;
      }
      if (mutex === undefined) {
        return;
      }
      let failed = false;
      try {
        this.runtime.onHeartbeat?.();
        const current = readLease(this.filePath);
        if (current.kind !== "valid" || current.record.ownerToken !== this.record.ownerToken) {
          throw new Error("Writer lease ownership changed.");
        }
        this.record.heartbeatAt = this.runtime.now();
        replaceLeaseAtomically(this.filePath, this.record);
      } catch {
        failed = true;
      } finally {
        releaseMutex(mutex);
      }
      if (failed) {
        void this.release().then(onFailure, onFailure);
      }
    }, this.runtime.heartbeatMs);
    this.heartbeatTimer.unref();
  }

  release(): Promise<void> {
    if (this.released) {
      return Promise.resolve();
    }
    if (this.releasePromise !== undefined) {
      return this.releasePromise;
    }
    const attempt = (async () => {
      const deadline = Date.now() + 2_000;
      while (true) {
        const mutex = acquireMutex(this.filePath, this.runtime);
        if (mutex !== undefined) {
          try {
            const current = readLease(this.filePath);
            if (current.kind === "valid" && current.record.ownerToken === this.record.ownerToken) {
              unlinkSync(this.filePath);
            }
            if (this.heartbeatTimer !== undefined) {
              clearInterval(this.heartbeatTimer);
              this.heartbeatTimer = undefined;
            }
            this.released = true;
            return;
          } finally {
            releaseMutex(mutex);
          }
        }
        if (Date.now() >= deadline) {
          throw new Error(`Timed out releasing writer lease ${this.filePath}.`);
        }
        await delay(10);
      }
    })();
    this.releasePromise = attempt;
    void attempt.catch(() => {
      if (this.releasePromise === attempt) {
        this.releasePromise = undefined;
      }
    });
    return attempt;
  }

  async owns(): Promise<boolean> {
    const deadline = Date.now() + 2_000;
    while (true) {
      const mutex = acquireMutex(this.filePath, this.runtime);
      if (mutex !== undefined) {
        try {
          const current = readLease(this.filePath);
          return current.kind === "valid" && current.record.ownerToken === this.record.ownerToken;
        } finally {
          releaseMutex(mutex);
        }
      }
      if (Date.now() >= deadline) {
        return false;
      }
      await delay(10);
    }
  }
}

export function locationSupportsWriting(
  filePath: string,
  runtime: ResolvedEnvironment
): boolean {
  return (
    runtime.locationCapability.classify(filePath) === "local-fixed" &&
    statSync(path.dirname(filePath)).isDirectory()
  );
}
