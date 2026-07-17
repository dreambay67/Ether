import { WriterLeaseRecordSchema, type WriterLeaseRecord } from "@ether/schema";
import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import os from "node:os";
import path from "node:path";

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
  onSaveStage?: (stage: SaveStage) => void;
  pid?: number;
  processIsAlive?: (pid: number, machineId: string) => boolean;
  staleMs?: number;
}

export type SaveStage =
  | "reservation"
  | "backup"
  | "identity-rewrite"
  | "validation"
  | "fsync"
  | "publication";

interface ResolvedEnvironment {
  appInstanceId: string;
  heartbeatMs: number;
  leaseRoot: string;
  locationCapability: WritableLocationCapabilityAdapter;
  machineId: string;
  now: () => number;
  onCreateStage?: (stage: CreateStage) => void;
  onHeartbeat?: () => void;
  onSaveStage?: (stage: SaveStage) => void;
  pid: number;
  processIsAlive: (pid: number, machineId: string) => boolean;
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
    onSaveStage: environment.onSaveStage,
    pid: environment.pid ?? process.pid,
    processIsAlive:
      environment.processIsAlive ??
      ((pid, ownerMachineId) => ownerMachineId === machineId && localProcessIsAlive(pid)),
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

function readLease(filePath: string): WriterLeaseRecord | undefined {
  try {
    return WriterLeaseRecordSchema.parse(JSON.parse(readFileSync(filePath, "utf8")));
  } catch (error) {
    const missing =
      typeof error === "object" && error !== null && "code" in error
        ? (error as { code?: unknown }).code === "ENOENT"
        : false;
    if (missing) {
      return undefined;
    }
    return undefined;
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
    sqliteProbe: () => void
  ): LeaseAcquisition {
    mkdirSync(runtime.leaseRoot, { recursive: true });
    const targetPath = leasePath(runtime, filePath);
    const existing = readLease(targetPath);
    if (existing !== undefined) {
      const heartbeatFresh = runtime.now() - existing.heartbeatAt <= runtime.staleMs;
      const ownerAlive = runtime.processIsAlive(existing.pid, existing.machineId);
      if (heartbeatFresh || ownerAlive) {
        return { reason: "writer-active" };
      }
      if (!probeAvailable(sqliteProbe)) {
        return { reason: "sqlite-busy" };
      }
      const current = readLease(targetPath);
      if (current === undefined || current.ownerToken !== existing.ownerToken) {
        return { reason: "writer-active" };
      }
      const refreshedHeartbeatFresh = runtime.now() - current.heartbeatAt <= runtime.staleMs;
      const refreshedOwnerAlive = runtime.processIsAlive(current.pid, current.machineId);
      if (refreshedHeartbeatFresh || refreshedOwnerAlive) {
        return { reason: "writer-active" };
      }
      unlinkSync(targetPath);
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
  }

  start(onFailure: () => void): void {
    if (this.heartbeatTimer !== undefined || this.released) {
      return;
    }
    this.heartbeatTimer = setInterval(() => {
      try {
        this.runtime.onHeartbeat?.();
        const current = readLease(this.filePath);
        if (current?.ownerToken !== this.record.ownerToken) {
          throw new Error("Writer lease ownership changed.");
        }
        this.record.heartbeatAt = this.runtime.now();
        writeFileSync(
          this.filePath,
          JSON.stringify(WriterLeaseRecordSchema.parse(this.record)),
          "utf8"
        );
      } catch {
        this.release();
        onFailure();
      }
    }, this.runtime.heartbeatMs);
    this.heartbeatTimer.unref();
  }

  release(): void {
    if (this.released) {
      return;
    }
    this.released = true;
    if (this.heartbeatTimer !== undefined) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
    try {
      if (readLease(this.filePath)?.ownerToken === this.record.ownerToken) {
        unlinkSync(this.filePath);
      }
    } catch {
      // Releasing a lease never removes a file whose owner token cannot be proven.
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
