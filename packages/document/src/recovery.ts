import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import path from "node:path";

import {
  openEtherDocumentConnection,
  removeOwnedReplacementRollback,
  restoreOwnedReplacementRollback,
  type OwnedReplacementRollback
} from "./database.js";
import { readEtherFileIdentity, type EtherFileIdentity } from "./validation.js";

type RecoveryPhase = "prepared" | "published" | "rollback-created";

interface SerializedIdentity {
  birthtimeNs: string;
  dev: string;
  ino: string;
  size: string;
}

interface SerializedRollback {
  identity: SerializedIdentity;
  path: string;
  sha256: string;
}

interface ReplacementRecoveryRecord {
  destinationPath: string;
  journalId: string;
  newDocumentId: string;
  phase: RecoveryPhase;
  previousDocumentId: string;
  rollback?: SerializedRollback;
  sourceDocumentId: string;
  sourcePath: string;
  version: 1;
}

export interface ReplacementRecoveryJournal {
  filePath: string;
  record: ReplacementRecoveryRecord;
}

function canonicalPath(filePath: string): string {
  const resolved = path.resolve(filePath);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function serializeIdentity(identity: EtherFileIdentity): SerializedIdentity {
  return {
    birthtimeNs: identity.birthtimeNs.toString(),
    dev: identity.dev.toString(),
    ino: identity.ino.toString(),
    size: identity.size.toString()
  };
}

function deserializeIdentity(identity: SerializedIdentity): EtherFileIdentity {
  return {
    birthtimeNs: BigInt(identity.birthtimeNs),
    dev: BigInt(identity.dev),
    ino: BigInt(identity.ino),
    size: BigInt(identity.size)
  };
}

function sameIdentity(left: EtherFileIdentity, right: EtherFileIdentity): boolean {
  return left.birthtimeNs === right.birthtimeNs && left.dev === right.dev && left.ino === right.ino;
}

function fileHash(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function atomicWrite(filePath: string, value: ReplacementRecoveryRecord): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp-${randomUUID()}`;
  let descriptor: number | undefined;
  try {
    descriptor = openSync(temporaryPath, "wx", 0o600);
    const serialized = JSON.stringify(value);
    writeFileSync(descriptor, serialized, "utf8");
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
      // The owned temporary was published or is already absent.
    }
  }
}

function parseRecord(input: unknown): ReplacementRecoveryRecord | undefined {
  if (typeof input !== "object" || input === null) {
    return undefined;
  }
  const value = input as Partial<ReplacementRecoveryRecord>;
  if (
    value.version !== 1 ||
    typeof value.journalId !== "string" ||
    typeof value.destinationPath !== "string" ||
    typeof value.sourcePath !== "string" ||
    typeof value.sourceDocumentId !== "string" ||
    typeof value.newDocumentId !== "string" ||
    typeof value.previousDocumentId !== "string" ||
    !["prepared", "rollback-created", "published"].includes(value.phase ?? "")
  ) {
    return undefined;
  }
  if (value.rollback !== undefined) {
    const identity = value.rollback.identity;
    if (
      typeof value.rollback.path !== "string" ||
      !/^[a-f0-9]{64}$/.test(value.rollback.sha256) ||
      typeof identity !== "object" ||
      identity === null ||
      ![identity.birthtimeNs, identity.dev, identity.ino, identity.size].every(
        (part) => typeof part === "string" && /^\d+$/.test(part)
      )
    ) {
      return undefined;
    }
  }
  return value as ReplacementRecoveryRecord;
}

function removeJournal(journal: ReplacementRecoveryJournal): void {
  const current = parseRecord(JSON.parse(readFileSync(journal.filePath, "utf8")));
  if (current?.journalId === journal.record.journalId) {
    unlinkSync(journal.filePath);
  }
}

function ownedRollback(record: ReplacementRecoveryRecord): OwnedReplacementRollback | undefined {
  if (record.rollback === undefined) {
    return undefined;
  }
  const expectedPrefix = `.${path.basename(record.destinationPath)}.ether-rollback-`;
  if (
    path.dirname(path.resolve(record.rollback.path)) !== path.dirname(path.resolve(record.destinationPath)) ||
    !path.basename(record.rollback.path).startsWith(expectedPrefix)
  ) {
    return undefined;
  }
  const identity = deserializeIdentity(record.rollback.identity);
  try {
    if (
      !sameIdentity(readEtherFileIdentity(record.rollback.path, true), identity) ||
      fileHash(record.rollback.path) !== record.rollback.sha256
    ) {
      return undefined;
    }
  } catch {
    return undefined;
  }
  return { identity, path: record.rollback.path };
}

function documentIdAt(filePath: string): string | undefined {
  try {
    const connection = openEtherDocumentConnection(filePath, true);
    try {
      return connection.inspection.document.documentId;
    } finally {
      connection.database.close();
    }
  } catch {
    return undefined;
  }
}

export function beginReplacementRecovery(
  recoveryRoot: string,
  input: Omit<ReplacementRecoveryRecord, "journalId" | "phase" | "version">
): ReplacementRecoveryJournal {
  const journalId = randomUUID();
  const journal = {
    filePath: path.join(recoveryRoot, `${journalId}.json`),
    record: { ...input, journalId, phase: "prepared" as const, version: 1 as const }
  };
  atomicWrite(journal.filePath, journal.record);
  return journal;
}

export function recordReplacementRollback(
  journal: ReplacementRecoveryJournal,
  rollback: OwnedReplacementRollback
): void {
  journal.record = {
    ...journal.record,
    phase: "rollback-created",
    rollback: {
      identity: serializeIdentity(rollback.identity),
      path: rollback.path,
      sha256: fileHash(rollback.path)
    }
  };
  atomicWrite(journal.filePath, journal.record);
}

export function markReplacementPublished(journal: ReplacementRecoveryJournal): void {
  journal.record = { ...journal.record, phase: "published" };
  atomicWrite(journal.filePath, journal.record);
}

export function completeReplacementRecovery(journal: ReplacementRecoveryJournal): void {
  removeJournal(journal);
}

export function reconcileReplacementRecovery(destinationPath: string, recoveryRoot: string): void {
  let names: string[];
  try {
    names = readdirSync(recoveryRoot).filter((name) => /^[a-f0-9-]+\.json$/i.test(name));
  } catch {
    return;
  }
  for (const name of names) {
    const filePath = path.join(recoveryRoot, name);
    let record: ReplacementRecoveryRecord | undefined;
    try {
      record = parseRecord(JSON.parse(readFileSync(filePath, "utf8")));
    } catch {
      continue;
    }
    if (record === undefined || canonicalPath(record.destinationPath) !== canonicalPath(destinationPath)) {
      continue;
    }
    const journal = { filePath, record };
    const currentDocumentId = documentIdAt(record.destinationPath);
    const rollback = ownedRollback(record);
    if (record.phase === "published" && currentDocumentId === record.newDocumentId) {
      if (record.rollback !== undefined && rollback === undefined) {
        continue;
      }
      if (rollback !== undefined) {
        removeOwnedReplacementRollback(rollback);
      }
      removeJournal(journal);
      continue;
    }
    if (currentDocumentId === record.previousDocumentId) {
      if (record.rollback !== undefined && rollback === undefined) {
        continue;
      }
      if (rollback !== undefined) {
        removeOwnedReplacementRollback(rollback);
      }
      removeJournal(journal);
      continue;
    }
    if (rollback !== undefined) {
      restoreOwnedReplacementRollback(rollback, record.destinationPath);
      if (documentIdAt(record.destinationPath) === record.previousDocumentId) {
        removeJournal(journal);
      }
    }
  }
}
