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

function samePath(left: string, right: string): boolean {
  const first = path.resolve(left);
  const second = path.resolve(right);
  return process.platform === "win32"
    ? first.toLowerCase() === second.toLowerCase()
    : first === second;
}

function sameIdentity(
  left: { dev: number | bigint; ino: number | bigint },
  right: { dev: number | bigint; ino: number | bigint }
): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function assertStableComponent(candidate: string, canonicalAppDataRoot: string): void {
  const before = lstatSync(candidate);
  if (before.isSymbolicLink()) {
    throw new Error(`Recovery path contains a reparse point: ${candidate}`);
  }
  const realPath = realpathSync.native(candidate);
  if (!inside(realPath, canonicalAppDataRoot)) {
    throw new Error(`Recovery path resolves outside canonical Ether AppData: ${candidate}`);
  }
  const after = lstatSync(candidate);
  if (!sameIdentity(before, after)) {
    throw new Error(`Recovery path identity changed during ownership validation: ${candidate}`);
  }
}

function assertCanonicalAppDataRoot(appDataRoot: string): string {
  const resolved = path.resolve(appDataRoot);
  const before = lstatSync(resolved);
  if (before.isSymbolicLink() || !before.isDirectory()) {
    throw new Error(`Ether AppData root is not a canonical directory: ${resolved}`);
  }
  const canonical = realpathSync.native(resolved);
  if (!samePath(canonical, resolved)) {
    throw new Error(`Ether AppData root is redirected from its canonical path: ${resolved}`);
  }
  const after = lstatSync(resolved);
  if (!sameIdentity(before, after)) {
    throw new Error(`Ether AppData root identity changed during validation: ${resolved}`);
  }
  return canonical;
}

export function ensureOwnedRecoveryDirectory(directory: string, appDataRoot: string): string {
  const resolvedAppDataRoot = path.resolve(appDataRoot);
  mkdirSync(resolvedAppDataRoot, { recursive: true });
  const canonicalAppDataRoot = assertCanonicalAppDataRoot(resolvedAppDataRoot);
  const resolved = assertAppDataOwnedPath(directory, resolvedAppDataRoot);
  const relative = path.relative(resolvedAppDataRoot, resolved);
  let current = resolvedAppDataRoot;
  for (const segment of relative.split(path.sep).filter((value) => value.length > 0)) {
    current = path.join(current, segment);
    if (!existsSync(current)) mkdirSync(current);
    assertStableComponent(current, canonicalAppDataRoot);
    if (!lstatSync(current).isDirectory()) {
      throw new Error(`Owned recovery directory component is not a directory: ${current}`);
    }
  }
  return resolved;
}

export function assertAppDataOwnedPath(candidate: string, appDataRoot: string): string {
  const resolved = path.resolve(candidate);
  if (!inside(resolved, appDataRoot)) {
    throw new Error(`Recovery path is outside Ether AppData: ${resolved}`);
  }
  return resolved;
}

function assertOwnedTree(candidate: string, canonicalAppDataRoot: string): void {
  assertStableComponent(candidate, canonicalAppDataRoot);
  if (!lstatSync(candidate).isDirectory()) return;
  for (const entry of readdirSync(candidate)) {
    assertOwnedTree(path.join(candidate, entry), canonicalAppDataRoot);
  }
  assertStableComponent(candidate, canonicalAppDataRoot);
}

export function assertDestructiveRecoveryPath(
  candidate: string,
  ownedRoot: string,
  appDataRoot: string
): string {
  const resolvedAppDataRoot = path.resolve(appDataRoot);
  const canonicalAppDataRoot = assertCanonicalAppDataRoot(resolvedAppDataRoot);
  const resolvedOwnedRoot = assertAppDataOwnedPath(ownedRoot, resolvedAppDataRoot);
  const resolved = assertAppDataOwnedPath(candidate, resolvedOwnedRoot);
  const relative = path.relative(resolvedAppDataRoot, resolved);
  let current = resolvedAppDataRoot;
  for (const segment of relative.split(path.sep).filter((value) => value.length > 0)) {
    current = path.join(current, segment);
    if (!existsSync(current)) break;
    assertStableComponent(current, canonicalAppDataRoot);
  }
  if (!existsSync(resolved)) return resolved;
  const rootRealPath = realpathSync.native(resolvedOwnedRoot);
  const candidateRealPath = realpathSync.native(resolved);
  if (!inside(candidateRealPath, rootRealPath)) {
    throw new Error(`Recovery path resolves outside its owned root: ${resolved}`);
  }
  assertOwnedTree(resolved, canonicalAppDataRoot);
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
  assertAppDataOwnedPath(entry.stagedPath, roots.stagingRoot);
  ensureOwnedRecoveryDirectory(roots.recoveryRoot, roots.appDataRoot);
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
  ensureOwnedRecoveryDirectory(roots.recoveryRoot, roots.appDataRoot);
  return readdirSync(roots.recoveryRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^media-[a-f0-9-]+\.json$/i.test(entry.name))
    .map((entry) => path.join(roots.recoveryRoot, entry.name))
    .sort();
}

export function removeRecoveryJournal(filePath: string, appDataRoot?: string): void {
  const roots = resolveRecoveryRoots(appDataRoot);
  ensureOwnedRecoveryDirectory(roots.recoveryRoot, roots.appDataRoot);
  rmSync(
    assertDestructiveRecoveryPath(filePath, roots.recoveryRoot, roots.appDataRoot),
    { force: true }
  );
}

export function quarantineRecoveryPath(filePath: string, appDataRoot?: string): string {
  const roots = resolveRecoveryRoots(appDataRoot);
  ensureOwnedRecoveryDirectory(roots.quarantineRoot, roots.appDataRoot);
  const owned = assertDestructiveRecoveryPath(
    filePath,
    roots.appDataRoot,
    roots.appDataRoot
  );
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
  ensureOwnedRecoveryDirectory(roots.stagingRoot, roots.appDataRoot);
  rmSync(assertDestructiveRecoveryPath(filePath, roots.stagingRoot, roots.appDataRoot), {
    recursive: true,
    force: true
  });
}
