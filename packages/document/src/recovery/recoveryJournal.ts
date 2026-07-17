import {
  RecoveryJournalEntrySchema,
  type RecoveryJournalEntry
} from "@ether/schema";
import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
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
    return destination;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    rmSync(temporary, { force: true });
  }
}

export function readRecoveryJournal(filePath: string): RecoveryJournalEntry {
  return RecoveryJournalEntrySchema.parse(JSON.parse(readFileSync(filePath, "utf8")) as unknown);
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
  const owned = assertAppDataOwnedPath(filePath, roots.appDataRoot);
  mkdirSync(roots.quarantineRoot, { recursive: true });
  const destination = path.join(roots.quarantineRoot, path.basename(owned));
  rmSync(destination, { recursive: true, force: true });
  renameSync(owned, destination);
  return destination;
}

export function removeOwnedStagingPath(filePath: string, appDataRoot?: string): void {
  const roots = resolveRecoveryRoots(appDataRoot);
  rmSync(assertAppDataOwnedPath(filePath, roots.stagingRoot), { recursive: true, force: true });
}
