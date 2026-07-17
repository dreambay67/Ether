import {
  RecoveryJournalEntrySchema,
  type RecoveryJournalEntry
} from "@ether/schema";
import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync
} from "node:fs";
import os from "node:os";
import path from "node:path";

export interface RecoveryRoots {
  appDataRoot: string;
  quarantineRoot: string;
  recoveryRoot: string;
  stagingRoot: string;
}

function defaultAppDataRoot(): string {
  const localAppData = process.env.LOCALAPPDATA;
  const base =
    localAppData !== undefined && localAppData.length > 0
      ? localAppData
      : path.join(os.homedir(), "AppData", "Local");
  return path.join(base, "DreamBay", "Ether");
}

export function resolveRecoveryRoots(appDataRoot = defaultAppDataRoot()): RecoveryRoots {
  const root = path.resolve(appDataRoot);
  return {
    appDataRoot: root,
    quarantineRoot: path.join(root, "quarantine"),
    recoveryRoot: path.join(root, "recovery"),
    stagingRoot: path.join(root, "staging")
  };
}

function inside(candidate: string, root: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function assertAppDataOwnedPath(candidate: string, appDataRoot: string): string {
  const resolved = path.resolve(candidate);
  if (!inside(resolved, appDataRoot)) {
    throw new Error(`Recovery path is outside Ether AppData: ${resolved}`);
  }
  return resolved;
}

function assertNoReparsePoints(candidate: string): void {
  const info = lstatSync(candidate, { throwIfNoEntry: false });
  if (info === undefined) return;
  if (info.isSymbolicLink()) {
    throw new Error(`Recovery path contains a reparse point: ${candidate}`);
  }
  if (!info.isDirectory()) return;
  for (const entry of readdirSync(candidate)) {
    assertNoReparsePoints(path.join(candidate, entry));
  }
}

export function assertDestructiveRecoveryPath(candidate: string, ownedRoot: string): string {
  const resolved = assertAppDataOwnedPath(candidate, ownedRoot);
  if (!existsSync(resolved)) return resolved;
  const rootRealPath = realpathSync.native(ownedRoot);
  const candidateRealPath = realpathSync.native(resolved);
  if (!inside(candidateRealPath, rootRealPath)) {
    throw new Error(`Recovery path resolves outside its owned root: ${resolved}`);
  }
  const before = lstatSync(resolved);
  assertNoReparsePoints(resolved);
  const after = lstatSync(resolved);
  if (before.dev !== after.dev || before.ino !== after.ino) {
    throw new Error(`Recovery path identity changed during ownership validation: ${resolved}`);
  }
  return resolved;
}

function journalFileName(id: string): string {
  return `media-${createHash("sha256").update(id).digest("hex")}.json`;
}

export function writeRecoveryJournal(options: {
  appDataRoot?: string;
  entry: RecoveryJournalEntry;
}): string {
  const roots = resolveRecoveryRoots(options.appDataRoot);
  const entry = RecoveryJournalEntrySchema.parse(options.entry);
  assertAppDataOwnedPath(entry.stagedPath, roots.appDataRoot);
  mkdirSync(roots.recoveryRoot, { recursive: true });
  const destination = path.join(roots.recoveryRoot, journalFileName(entry.id));
  const temporary = `${destination}.tmp-${randomUUID()}`;
  let descriptor: number | undefined;
  try {
    descriptor = openSync(temporary, "wx", 0o600);
    writeFileSync(descriptor, JSON.stringify(entry), "utf8");
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporary, destination);
    descriptor = openSync(destination, "r+");
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    return destination;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    rmSync(temporary, { force: true });
  }
}

export function readRecoveryJournal(filePath: string): RecoveryJournalEntry {
  return RecoveryJournalEntrySchema.parse(JSON.parse(readFileSync(filePath, "utf8")) as unknown);
}

export function readRecoveryJournalOwner(filePath: string): {
  documentId: string;
  documentPath: string;
} | undefined {
  const value = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
  if (typeof value !== "object" || value === null) return undefined;
  const documentId = Reflect.get(value, "documentId");
  const documentPath = Reflect.get(value, "documentPath");
  return typeof documentId === "string" && documentId.length > 0 &&
    typeof documentPath === "string" && documentPath.length > 0
    ? { documentId, documentPath }
    : undefined;
}

export function listRecoveryJournalPaths(appDataRoot?: string): string[] {
  const roots = resolveRecoveryRoots(appDataRoot);
  mkdirSync(roots.recoveryRoot, { recursive: true });
  return readdirSync(roots.recoveryRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^media-[a-f0-9-]+\.json$/i.test(entry.name))
    .map((entry) => path.join(roots.recoveryRoot, entry.name))
    .sort();
}

export function removeRecoveryJournal(filePath: string, appDataRoot?: string): void {
  const roots = resolveRecoveryRoots(appDataRoot);
  rmSync(assertAppDataOwnedPath(filePath, roots.recoveryRoot), { force: true });
}

export function quarantineRecoveryPath(filePath: string, appDataRoot?: string): string {
  const roots = resolveRecoveryRoots(appDataRoot);
  const owned = assertDestructiveRecoveryPath(filePath, roots.appDataRoot);
  mkdirSync(roots.quarantineRoot, { recursive: true });
  const baseName = path.basename(owned);
  let destination = path.join(roots.quarantineRoot, baseName);
  if (existsSync(destination)) {
    destination = path.join(roots.quarantineRoot, `${baseName}.${randomUUID()}`);
  }
  renameSync(owned, destination);
  return destination;
}

export function removeOwnedStagingPath(filePath: string, appDataRoot?: string): void {
  const roots = resolveRecoveryRoots(appDataRoot);
  mkdirSync(roots.stagingRoot, { recursive: true });
  rmSync(assertDestructiveRecoveryPath(filePath, roots.stagingRoot), {
    recursive: true,
    force: true
  });
}
