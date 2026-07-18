import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { createReadStream } from "node:fs";
import path from "node:path";

import {
  openEtherDocumentConnection,
  removeOwnedReplacementRollback,
  restoreOwnedReplacementRollback,
  type OwnedReplacementRollback
} from "./database.js";
import { readEtherFileIdentity, type EtherFileIdentity } from "./validation.js";

type RecoveryPhase = "prepared" | "published" | "rollback-created" | "rollback-planned";

interface SerializedIdentity {
  birthtimeNs: string;
  dev: string;
  ino: string;
  size: string;
}

interface SerializedRollback {
  identity: SerializedIdentity;
  path: string;
  sha256?: string;
}

interface ReplacementRecoveryRecord {
  destinationPath: string;
  journalId: string;
  newDocumentId: string;
  phase: RecoveryPhase;
  previousDocumentId: string;
  rollback?: SerializedRollback;
  staging?: { identity: SerializedIdentity; path: string };
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

function readAliasIdentity(filePath: string): EtherFileIdentity {
  const stats = lstatSync(filePath, { bigint: true });
  if (!stats.isFile()) throw new Error("Recovery-owned path is not a regular file.");
  return {
    birthtimeNs: stats.birthtimeNs,
    dev: stats.dev,
    ino: stats.ino,
    size: stats.size
  };
}

function removeOwnedPath(filePath: string, identity: EtherFileIdentity): void {
  try {
    if (sameIdentity(readAliasIdentity(filePath), identity)) unlinkSync(filePath);
  } catch {
    // The recovery-owned path is absent or no longer has the recorded identity.
  }
}

async function fileHash(filePath: string, onChunk?: () => void): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath, { highWaterMark: 256 * 1024 })) {
    hash.update(chunk);
    onChunk?.();
  }
  return hash.digest("hex");
}

function atomicWrite(
  filePath: string,
  value: ReplacementRecoveryRecord,
  hooks: { beforeRename?: () => void; afterRename?: () => void } = {}
): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp`;
  let descriptor: number | undefined;
  try {
    try {
      unlinkSync(temporaryPath);
    } catch {
      // Recovery owns this deterministic temporary name.
    }
    descriptor = openSync(temporaryPath, "wx", 0o600);
    const serialized = JSON.stringify(value);
    writeFileSync(descriptor, serialized, "utf8");
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    hooks.beforeRename?.();
    renameSync(temporaryPath, filePath);
    hooks.afterRename?.();
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
    !["prepared", "rollback-planned", "rollback-created", "published"].includes(value.phase ?? "")
  ) {
    return undefined;
  }
  if (value.rollback !== undefined) {
    const identity = value.rollback.identity;
    if (
      typeof value.rollback.path !== "string" ||
      (value.rollback.sha256 !== undefined && !/^[a-f0-9]{64}$/.test(value.rollback.sha256)) ||
      typeof identity !== "object" ||
      identity === null ||
      ![identity.birthtimeNs, identity.dev, identity.ino, identity.size].every(
        (part) => typeof part === "string" && /^\d+$/.test(part)
      )
    ) {
      return undefined;
    }
  }
  if (value.staging !== undefined) {
    const identity = value.staging.identity;
    if (
      typeof value.staging.path !== "string" ||
      typeof identity !== "object" ||
      identity === null ||
      ![identity.birthtimeNs, identity.dev, identity.ino, identity.size].every(
        (part) => typeof part === "string" && /^\d+$/.test(part)
      )
    ) return undefined;
  }
  return value as ReplacementRecoveryRecord;
}

function removeJournal(journal: ReplacementRecoveryJournal): void {
  const current = parseRecord(JSON.parse(readFileSync(journal.filePath, "utf8")));
  if (current?.journalId === journal.record.journalId) {
    unlinkSync(journal.filePath);
  }
  try {
    unlinkSync(`${journal.filePath}.tmp`);
  } catch {
    // The deterministic journal temporary is already absent.
  }
}

async function ownedRollback(record: ReplacementRecoveryRecord): Promise<OwnedReplacementRollback | undefined> {
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
      !sameIdentity(readAliasIdentity(record.rollback.path), identity) ||
      (record.rollback.sha256 !== undefined && await fileHash(record.rollback.path) !== record.rollback.sha256)
    ) {
      return undefined;
    }
  } catch {
    return undefined;
  }
  return { identity, path: record.rollback.path };
}

function rollbackPathStatus(
  record: ReplacementRecoveryRecord
): "absent" | "indeterminate" | "present" {
  if (record.rollback === undefined) {
    return "absent";
  }
  try {
    return lstatSync(record.rollback.path, { throwIfNoEntry: false }) === undefined
      ? "absent"
      : "present";
  } catch {
    return "indeterminate";
  }
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
  input: Omit<ReplacementRecoveryRecord, "journalId" | "phase" | "rollback" | "staging" | "version"> & {
    staging?: OwnedReplacementRollback;
  }
): ReplacementRecoveryJournal {
  const { staging, ...recordInput } = input;
  const journalId = randomUUID();
  const destinationPath = path.resolve(input.destinationPath);
  const rollback: SerializedRollback = {
    identity: serializeIdentity(readEtherFileIdentity(destinationPath, true)),
    path: path.join(
      path.dirname(destinationPath),
      `.${path.basename(destinationPath)}.ether-rollback-${journalId}`
    )
  };
  const journal = {
    filePath: path.join(recoveryRoot, `${journalId}.json`),
    record: {
      ...recordInput,
      destinationPath,
      journalId,
      phase: "rollback-planned" as const,
      rollback,
      ...(staging === undefined ? {} : {
        staging: {
          identity: serializeIdentity(staging.identity),
          path: staging.path
        }
      }),
      version: 1 as const
    }
  };
  atomicWrite(journal.filePath, journal.record);
  return journal;
}

export function plannedReplacementRollback(
  journal: ReplacementRecoveryJournal
): OwnedReplacementRollback {
  const rollback = journal.record.rollback;
  if (rollback === undefined) {
    throw new Error("Replacement recovery journal has no planned rollback.");
  }
  return { identity: deserializeIdentity(rollback.identity), path: rollback.path };
}

export async function recordReplacementRollback(
  journal: ReplacementRecoveryJournal,
  rollback: OwnedReplacementRollback,
  hooks: { afterHashChunk?: () => void; beforeJournalRename?: () => void; afterJournalRename?: () => void } = {}
): Promise<void> {
  const planned = journal.record.rollback;
  if (
    planned === undefined ||
    path.resolve(planned.path) !== path.resolve(rollback.path) ||
    !sameIdentity(deserializeIdentity(planned.identity), rollback.identity)
  ) {
    throw new Error("Replacement rollback does not match its durable recovery plan.");
  }
  journal.record = {
    ...journal.record,
    phase: "rollback-created",
    rollback: {
      identity: serializeIdentity(rollback.identity),
      path: rollback.path,
      sha256: await fileHash(rollback.path, hooks.afterHashChunk)
    }
  };
  atomicWrite(journal.filePath, journal.record, {
    beforeRename: hooks.beforeJournalRename,
    afterRename: hooks.afterJournalRename
  });
}

export function markReplacementPublished(journal: ReplacementRecoveryJournal): void {
  journal.record = { ...journal.record, phase: "published" };
  atomicWrite(journal.filePath, journal.record);
}

export function completeReplacementRecovery(journal: ReplacementRecoveryJournal): void {
  removeJournal(journal);
}

export async function reconcileReplacementRecovery(destinationPath: string, recoveryRoot: string): Promise<void> {
  let names: string[];
  try {
    names = readdirSync(recoveryRoot).filter((name) => /^[a-f0-9-]+\.json(?:\.tmp)?$/i.test(name));
  } catch {
    return;
  }
  for (const name of names) {
    if (name.endsWith(".tmp")) {
      const finalPath = path.join(recoveryRoot, name.slice(0, -4));
      if (names.includes(path.basename(finalPath))) {
        try {
          unlinkSync(path.join(recoveryRoot, name));
        } catch {
          // A later reconciliation can retry deterministic temporary cleanup.
        }
      } else {
        try {
          unlinkSync(path.join(recoveryRoot, name));
        } catch {
          // An unpublished initial journal cannot own a rollback path.
        }
      }
      continue;
    }
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
    const rollbackStatus = rollbackPathStatus(record);
    const rollback = rollbackStatus === "present" ? await ownedRollback(record) : undefined;
    const previousIdentityIsCurrent = record.rollback === undefined ? false : (() => {
      try {
        return sameIdentity(
          readAliasIdentity(record.destinationPath),
          deserializeIdentity(record.rollback.identity)
        );
      } catch {
        return false;
      }
    })();
    const expectedDocumentIsCurrent =
      (record.phase === "published" && currentDocumentId === record.newDocumentId) ||
      currentDocumentId === record.previousDocumentId ||
      previousIdentityIsCurrent;
    if (expectedDocumentIsCurrent) {
      if (
        rollbackStatus === "indeterminate" ||
        (rollbackStatus === "present" && rollback === undefined)
      ) {
        continue;
      }
      if (rollback !== undefined) {
        removeOwnedReplacementRollback(rollback);
      }
      if (record.staging !== undefined) {
        removeOwnedPath(record.staging.path, deserializeIdentity(record.staging.identity));
      }
      removeJournal(journal);
      continue;
    }
    if (rollback !== undefined && record.rollback?.sha256 !== undefined) {
      restoreOwnedReplacementRollback(rollback, record.destinationPath);
      if (documentIdAt(record.destinationPath) === record.previousDocumentId) {
        if (record.staging !== undefined) {
          removeOwnedPath(record.staging.path, deserializeIdentity(record.staging.identity));
        }
        removeJournal(journal);
      }
    }
  }
}
