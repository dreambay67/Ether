import { randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  ftruncateSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
  writeSync
} from "node:fs";
import path from "node:path";

import {
  isSensitiveStructuredKey,
  redactSensitiveText
} from "../../shared/redaction.js";

export type DiagnosticLevel = "error" | "info" | "warning";

export interface DiagnosticRecord {
  causeId?: string;
  correlationId: string;
  details?: Record<string, unknown>;
  event: string;
  level: DiagnosticLevel;
  message: string;
}

export interface DesktopDiagnosticSink {
  flush?(): Promise<void>;
  flushSync?(): void;
  log(record: DiagnosticRecord): void;
}

interface DiagnosticManifestEntry {
  createdAt: string;
  path: string;
}

interface DiagnosticManifest {
  files: DiagnosticManifestEntry[];
  version: 1;
}

export interface LocalDiagnosticOptions {
  appDataRoot: string;
  appVersion: string;
  maxAgeMs?: number;
  maxBytes?: number;
  maxFiles?: number;
  now?: () => number;
  checkpoint?: (
    stage: "append-written" | "rotation-renamed" | "manifest-written"
  ) => void;
  fileOperations?: {
    fsync?: (descriptor: number) => void;
    write?: (
      descriptor: number,
      buffer: Buffer,
      offset: number,
      length: number
    ) => number;
  };
}

const CURRENT_LOG_PATH = "logs/ether-current.jsonl";
const DEFAULT_MAX_BYTES = 1024 * 1024;
const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_MAX_FILES = 5;
const OWNED_LOG_PATTERN = /^logs\/ether-(?:current|\d+-[0-9a-f-]+)\.jsonl$/i;

function diagnosticRoot(appDataRoot: string): string {
  return path.resolve(appDataRoot, "diagnostics");
}

function manifestPath(appDataRoot: string): string {
  return path.join(diagnosticRoot(appDataRoot), "manifest.json");
}

function nativeRelative(relativePath: string): string {
  return relativePath.split("/").join(path.sep);
}

function assertOwnedRelativePath(relativePath: string): string {
  if (
    !OWNED_LOG_PATTERN.test(relativePath) ||
    path.isAbsolute(relativePath) ||
    relativePath.includes("\0") ||
    relativePath.split("/").includes("..")
  ) {
    throw Object.assign(new Error("The diagnostics manifest contains an unowned path."), {
      code: "DIAGNOSTIC_MANIFEST_UNSAFE"
    });
  }
  return relativePath;
}

function assertNoSymlink(root: string, absolutePath: string): void {
  const relative = path.relative(root, absolutePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw Object.assign(new Error("Diagnostics cleanup cannot leave its owned root."), {
      code: "DIAGNOSTIC_MANIFEST_UNSAFE"
    });
  }
  let current = root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (!existsSync(current)) break;
    if (lstatSync(current).isSymbolicLink()) {
      throw Object.assign(new Error("Diagnostics paths cannot be symbolic links or reparse points."), {
        code: "DIAGNOSTIC_SYMLINK_REFUSED"
      });
    }
  }
}

function ensureOwnedDirectories(appDataRoot: string): void {
  const root = diagnosticRoot(appDataRoot);
  mkdirSync(root, { recursive: true });
  assertNoSymlink(path.resolve(appDataRoot), root);
  const logs = path.join(root, "logs");
  mkdirSync(logs, { recursive: true });
  assertNoSymlink(root, logs);
}

function parseManifest(appDataRoot: string): DiagnosticManifest {
  const filePath = manifestPath(appDataRoot);
  if (!existsSync(filePath)) return { files: [], version: 1 };
  assertNoSymlink(diagnosticRoot(appDataRoot), filePath);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    throw Object.assign(new Error("The diagnostics manifest is malformed.", { cause: error }), {
      code: "DIAGNOSTIC_MANIFEST_INVALID"
    });
  }
  if (
    parsed === null ||
    typeof parsed !== "object" ||
    (parsed as Record<string, unknown>).version !== 1 ||
    !Array.isArray((parsed as Record<string, unknown>).files)
  ) {
    throw Object.assign(new Error("The diagnostics manifest schema is invalid."), {
      code: "DIAGNOSTIC_MANIFEST_INVALID"
    });
  }
  const files = (parsed as { files: unknown[] }).files.map((candidate) => {
    if (
      candidate === null ||
      typeof candidate !== "object" ||
      typeof (candidate as Record<string, unknown>).createdAt !== "string" ||
      typeof (candidate as Record<string, unknown>).path !== "string"
    ) {
      throw Object.assign(new Error("The diagnostics manifest entry is invalid."), {
        code: "DIAGNOSTIC_MANIFEST_INVALID"
      });
    }
    const entry = candidate as DiagnosticManifestEntry;
    assertOwnedRelativePath(entry.path);
    if (!Number.isFinite(Date.parse(entry.createdAt))) {
      throw Object.assign(new Error("The diagnostics manifest timestamp is invalid."), {
        code: "DIAGNOSTIC_MANIFEST_INVALID"
      });
    }
    return { ...entry };
  });
  if (new Set(files.map((entry) => entry.path)).size !== files.length) {
    throw Object.assign(new Error("The diagnostics manifest contains duplicate ownership."), {
      code: "DIAGNOSTIC_MANIFEST_INVALID"
    });
  }
  return { files, version: 1 };
}

function writeManifest(appDataRoot: string, manifest: DiagnosticManifest): void {
  ensureOwnedDirectories(appDataRoot);
  const destination = manifestPath(appDataRoot);
  const temporary = path.join(diagnosticRoot(appDataRoot), `.manifest-${randomUUID()}.tmp`);
  const descriptor = openSync(temporary, "wx", 0o600);
  try {
    writeFileSync(descriptor, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  renameSync(temporary, destination);
}

function redactString(value: string): string {
  return redactSensitiveText(value);
}

function redactValue(value: unknown, key = ""): unknown {
  if (isSensitiveStructuredKey(key)) return "[REDACTED]";
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) return value.slice(0, 64).map((item) => redactValue(item));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 64)
        .map(([entryKey, entryValue]) => [entryKey, redactValue(entryValue, entryKey)])
    );
  }
  return value;
}

function repairDiagnosticTail(
  filePath: string,
  queuedRecordIds: ReadonlySet<string>,
  durableSync: (descriptor: number) => void
): Set<string> {
  const durableQueuedIds = new Set<string>();
  if (!existsSync(filePath)) return durableQueuedIds;
  const descriptor = openSync(filePath, "r+");
  try {
    const bytes = readFileSync(descriptor);
    let validEnd = 0;
    let frameStart = 0;
    while (frameStart < bytes.byteLength) {
      const newline = bytes.indexOf(0x0a, frameStart);
      if (newline < 0) break;
      const frame = bytes.subarray(frameStart, newline).toString("utf8");
      try {
        const parsed = JSON.parse(frame) as { frameVersion?: unknown; recordId?: unknown };
        const isLegacyFrame = parsed.frameVersion === undefined && parsed.recordId === undefined;
        if (!isLegacyFrame && (
          parsed.frameVersion !== 1 ||
          typeof parsed.recordId !== "string" ||
          parsed.recordId.length === 0
        )) {
          break;
        }
        if (
          typeof parsed.recordId === "string" &&
          queuedRecordIds.has(parsed.recordId)
        ) {
          durableQueuedIds.add(parsed.recordId);
        }
        validEnd = newline + 1;
        frameStart = newline + 1;
      } catch {
        break;
      }
    }
    if (validEnd !== bytes.byteLength) ftruncateSync(descriptor, validEnd);
    durableSync(descriptor);
    return durableQueuedIds;
  } finally {
    closeSync(descriptor);
  }
}

function validateIdentity(value: string, label: string): void {
  if (value.length === 0 || value.length > 160 || value.includes("\0")) {
    throw Object.assign(new Error(`Diagnostic ${label} is invalid.`), {
      code: "DIAGNOSTIC_RECORD_INVALID"
    });
  }
}

function serializeRecord(
  record: DiagnosticRecord,
  recordId: string,
  timestamp: string,
  maxBytes: number,
  appVersion: string
): string {
  validateIdentity(record.correlationId, "correlationId");
  validateIdentity(record.event, "event");
  if (record.causeId !== undefined) validateIdentity(record.causeId, "causeId");
  const base = {
    frameVersion: 1,
    recordId,
    timestamp,
    appVersion,
    level: record.level,
    event: record.event,
    correlationId: record.correlationId,
    ...(record.causeId === undefined ? {} : { causeId: record.causeId })
  };
  const candidates = [
    { ...base, message: redactString(record.message), details: redactValue(record.details ?? {}) },
    { ...base, message: redactString(record.message) },
    { ...base, message: `${redactString(record.message).slice(0, 128)}...` },
    { ...base, message: "[TRUNCATED]" }
  ];
  for (const candidate of candidates) {
    const line = `${JSON.stringify(candidate)}\n`;
    if (Buffer.byteLength(line) <= maxBytes) return line;
  }
  throw Object.assign(new Error("The diagnostic identity fields exceed the configured log size."), {
    code: "DIAGNOSTIC_RECORD_OVERSIZED"
  });
}

function absoluteOwnedLog(appDataRoot: string, relativePath: string): string {
  const root = diagnosticRoot(appDataRoot);
  const absolute = path.resolve(root, nativeRelative(assertOwnedRelativePath(relativePath)));
  assertNoSymlink(root, absolute);
  return absolute;
}

function reconcileOwnedDiagnosticInventory(appDataRoot: string): DiagnosticManifest {
  ensureOwnedDirectories(appDataRoot);
  const manifest = parseManifest(appDataRoot);
  const diagnostics = diagnosticRoot(appDataRoot);
  const logs = path.join(diagnostics, "logs");
  const retained = manifest.files.filter((entry) => {
    const absolute = absoluteOwnedLog(appDataRoot, entry.path);
    if (!existsSync(absolute)) return false;
    const info = lstatSync(absolute);
    if (!info.isFile() || info.isSymbolicLink()) {
      throw Object.assign(new Error("Diagnostics inventory accepts only owned regular files."), {
        code: "DIAGNOSTIC_FILE_REFUSED"
      });
    }
    return true;
  });
  const tracked = new Set(retained.map((entry) => entry.path));
  for (const candidate of readdirSync(logs, { withFileTypes: true })) {
    const relativePath = `logs/${candidate.name}`;
    if (!OWNED_LOG_PATTERN.test(relativePath) || tracked.has(relativePath)) continue;
    const absolute = absoluteOwnedLog(appDataRoot, relativePath);
    const info = lstatSync(absolute);
    if (!candidate.isFile() || candidate.isSymbolicLink() || !info.isFile() || info.isSymbolicLink()) {
      throw Object.assign(new Error("Diagnostics inventory refuses non-regular owned log names."), {
        code: "DIAGNOSTIC_FILE_REFUSED"
      });
    }
    const encodedTimestamp = /^ether-(\d+)-/i.exec(candidate.name)?.[1];
    const createdAtMs = encodedTimestamp === undefined ? info.mtimeMs : Number(encodedTimestamp);
    retained.push({
      createdAt: new Date(Number.isFinite(createdAtMs) ? createdAtMs : info.mtimeMs).toISOString(),
      path: relativePath
    });
    tracked.add(relativePath);
  }
  const reconciled = { files: retained, version: 1 as const };
  if (JSON.stringify(reconciled) !== JSON.stringify(manifest)) writeManifest(appDataRoot, reconciled);
  return reconciled;
}

export function cleanupOwnedDiagnosticFiles(options: {
  appDataRoot: string;
  maxAgeMs?: number;
  maxFiles?: number;
  now?: number;
}): { removed: string[]; retained: string[] } {
  ensureOwnedDirectories(options.appDataRoot);
  const manifest = parseManifest(options.appDataRoot);
  const now = options.now ?? Date.now();
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
  if (maxAgeMs < 0 || maxFiles < 1) throw new Error("Diagnostic retention limits are invalid.");

  const validated = manifest.files
    .filter((entry) => existsSync(absoluteOwnedLog(options.appDataRoot, entry.path)))
    .map((entry) => ({
    entry,
    absolute: absoluteOwnedLog(options.appDataRoot, entry.path)
    }));
  const rotated = validated
    .filter(({ entry }) => entry.path !== CURRENT_LOG_PATH)
    .sort((left, right) => Date.parse(right.entry.createdAt) - Date.parse(left.entry.createdAt));
  const keepRotated = Math.max(0, maxFiles - (validated.some(({ entry }) => entry.path === CURRENT_LOG_PATH) ? 1 : 0));
  const removable = new Set(rotated
    .filter(({ entry }, index) => now - Date.parse(entry.createdAt) > maxAgeMs || index >= keepRotated)
    .map(({ entry }) => entry.path));

  for (const { entry, absolute } of validated) {
    if (!removable.has(entry.path) || !existsSync(absolute)) continue;
    if (!lstatSync(absolute).isFile()) {
      throw Object.assign(new Error("Diagnostics cleanup only removes tracked regular files."), {
        code: "DIAGNOSTIC_FILE_REFUSED"
      });
    }
    unlinkSync(absolute);
  }
  const retainedEntries = validated
    .map(({ entry }) => entry)
    .filter((entry) => !removable.has(entry.path));
  writeManifest(options.appDataRoot, { files: retainedEntries, version: 1 });
  return {
    removed: [...removable],
    retained: retainedEntries.map((entry) => entry.path)
  };
}

export class LocalDiagnosticLogger implements DesktopDiagnosticSink {
  private readonly appDataRoot: string;
  private readonly appVersion: string;
  private readonly maxAgeMs: number;
  private readonly maxBytes: number;
  private readonly maxFiles: number;
  private readonly now: () => number;
  private readonly checkpoint: LocalDiagnosticOptions["checkpoint"];
  private readonly durableSync: (descriptor: number) => void;
  private readonly durableWrite: (
    descriptor: number,
    buffer: Buffer,
    offset: number,
    length: number
  ) => number;
  private manifest: DiagnosticManifest;
  private readonly queue: Array<{
    line: string;
    now: number;
    recordId: string;
    timestamp: string;
  }> = [];
  private scheduledFlush: ReturnType<typeof setImmediate> | undefined;
  private inFlight: Promise<void> | undefined;
  private backgroundError: unknown;
  private tailNeedsReconciliation = false;

  constructor(options: LocalDiagnosticOptions) {
    if ((options.maxBytes ?? DEFAULT_MAX_BYTES) < 512) {
      throw new Error("Diagnostic maxBytes must be at least 512 bytes.");
    }
    validateIdentity(options.appVersion, "appVersion");
    this.appDataRoot = path.resolve(options.appDataRoot);
    this.appVersion = options.appVersion;
    this.maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    this.maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
    this.now = options.now ?? Date.now;
    this.checkpoint = options.checkpoint;
    this.durableSync = options.fileOperations?.fsync ?? fsyncSync;
    this.durableWrite = options.fileOperations?.write ?? writeSync;
    ensureOwnedDirectories(this.appDataRoot);
    reconcileOwnedDiagnosticInventory(this.appDataRoot);
    const existingCurrent = path.join(diagnosticRoot(this.appDataRoot), nativeRelative(CURRENT_LOG_PATH));
    if (existsSync(existingCurrent)) {
      repairDiagnosticTail(existingCurrent, new Set(), fsyncSync);
    }
    cleanupOwnedDiagnosticFiles({
      appDataRoot: this.appDataRoot,
      maxAgeMs: this.maxAgeMs,
      maxFiles: this.maxFiles,
      now: this.now()
    });
    this.manifest = parseManifest(this.appDataRoot);
  }

  log(record: DiagnosticRecord): void {
    const now = this.now();
    const recordId = randomUUID();
    const timestamp = new Date(now).toISOString();
    const line = serializeRecord(record, recordId, timestamp, this.maxBytes, this.appVersion);
    this.queue.push({ line, now, recordId, timestamp });
    if (this.scheduledFlush === undefined && this.inFlight === undefined) {
      this.scheduledFlush = setImmediate(() => {
        this.scheduledFlush = undefined;
        void this.runDrain().catch((error: unknown) => {
          if (this.backgroundError === undefined) this.backgroundError = error;
        });
      });
    }
  }

  async flush(): Promise<void> {
    if (this.scheduledFlush !== undefined) {
      clearImmediate(this.scheduledFlush);
      this.scheduledFlush = undefined;
    }
    const priorError = this.backgroundError;
    this.backgroundError = undefined;
    await this.runDrain();
    if (priorError !== undefined) throw priorError;
  }

  flushSync(): void {
    if (this.scheduledFlush !== undefined) {
      clearImmediate(this.scheduledFlush);
      this.scheduledFlush = undefined;
    }
    const priorError = this.backgroundError;
    this.backgroundError = undefined;
    this.drainQueueSync();
    if (priorError !== undefined) throw priorError;
  }

  private async runDrain(): Promise<void> {
    if (this.inFlight !== undefined) await this.inFlight;
    if (this.queue.length === 0) return;
    const operation = Promise.resolve().then(() => this.drainQueueSync());
    this.inFlight = operation;
    try {
      await operation;
    } finally {
      this.inFlight = undefined;
    }
    if (this.queue.length > 0) await this.runDrain();
  }

  private drainQueueSync(): void {
    if (this.queue.length === 0) return;
    this.manifest = reconcileOwnedDiagnosticInventory(this.appDataRoot);
    let current = this.manifest.files.find((entry) => entry.path === CURRENT_LOG_PATH);
    let rotated = false;
    let lastWrittenAt = this.now();
    const currentPath = absoluteOwnedLog(this.appDataRoot, CURRENT_LOG_PATH);
    if (this.tailNeedsReconciliation) {
      const queuedIds = new Set(this.queue.map(({ recordId }) => recordId));
      const durableIds = repairDiagnosticTail(currentPath, queuedIds, this.durableSync);
      while (this.queue[0] !== undefined && durableIds.has(this.queue[0].recordId)) {
        this.queue.shift();
      }
      this.tailNeedsReconciliation = false;
      if (this.queue.length === 0) return;
    }
    let currentBytes = existsSync(currentPath) ? statSync(currentPath).size : 0;
    while (this.queue.length > 0) {
      const item = this.queue[0]!;
      const lineBytes = Buffer.byteLength(item.line);
      if (
        current !== undefined &&
        (currentBytes + lineBytes > this.maxBytes ||
          item.now - Date.parse(current.createdAt) > this.maxAgeMs)
      ) {
        const rotatedPath = `logs/ether-${item.now}-${randomUUID()}.jsonl`;
        renameSync(currentPath, absoluteOwnedLog(this.appDataRoot, rotatedPath));
        this.checkpoint?.("rotation-renamed");
        this.manifest = {
          files: this.manifest.files.map((entry) =>
            entry.path === CURRENT_LOG_PATH ? { ...entry, path: rotatedPath } : entry
          ),
          version: 1
        };
        current = undefined;
        currentBytes = 0;
        rotated = true;
        continue;
      }
      if (current === undefined) {
        current = { createdAt: item.timestamp, path: CURRENT_LOG_PATH };
        this.manifest.files.push(current);
        writeManifest(this.appDataRoot, this.manifest);
        this.checkpoint?.("manifest-written");
      }
      let batch = "";
      let batchBytes = 0;
      let batchCount = 0;
      for (const candidate of this.queue) {
        const candidateBytes = Buffer.byteLength(candidate.line);
        if (
          currentBytes + batchBytes + candidateBytes > this.maxBytes ||
          candidate.now - Date.parse(current.createdAt) > this.maxAgeMs
        ) {
          break;
        }
        batch += candidate.line;
        batchBytes += candidateBytes;
        batchCount += 1;
        lastWrittenAt = candidate.now;
      }
      if (batchCount === 0) {
        throw new Error("A serialized diagnostic record exceeds its strict log size budget.");
      }
      assertNoSymlink(diagnosticRoot(this.appDataRoot), currentPath);
      const descriptor = openSync(currentPath, "a", 0o600);
      try {
        const encoded = Buffer.from(batch, "utf8");
        let offset = 0;
        while (offset < encoded.byteLength) {
          const written = this.durableWrite(
            descriptor,
            encoded,
            offset,
            encoded.byteLength - offset
          );
          if (!Number.isSafeInteger(written) || written <= 0) {
            throw new Error("Diagnostic append made no forward progress.");
          }
          offset += written;
        }
        this.durableSync(descriptor);
      } catch (error) {
        this.tailNeedsReconciliation = true;
        throw error;
      } finally {
        closeSync(descriptor);
      }
      currentBytes += batchBytes;
      this.queue.splice(0, batchCount);
      this.checkpoint?.("append-written");
    }
    if (currentBytes > this.maxBytes) {
      throw new Error("Diagnostic log exceeded its strict size budget.");
    }
    if (rotated) {
      this.manifest = cleanupManifestAfterRotation({
        appDataRoot: this.appDataRoot,
        manifest: this.manifest,
        maxAgeMs: this.maxAgeMs,
        maxFiles: this.maxFiles,
        now: lastWrittenAt
      });
    }
  }
}

function cleanupManifestAfterRotation(options: {
  appDataRoot: string;
  manifest: DiagnosticManifest;
  maxAgeMs: number;
  maxFiles: number;
  now: number;
}): DiagnosticManifest {
  if (options.manifest.files.filter((entry) => entry.path !== CURRENT_LOG_PATH).length === 0) {
    return options.manifest;
  }
  cleanupOwnedDiagnosticFiles(options);
  return parseManifest(options.appDataRoot);
}
