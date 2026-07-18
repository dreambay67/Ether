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
  removeOwnedReplacementRollback,
  restoreOwnedReplacementRollback,
  type OwnedReplacementRollback
} from "./database.js";
import type { EtherFileIdentity } from "./validation.js";

type RecoveryPhase = "published" | "rollback-created" | "rollback-planned";
type CompactStagingPhase = "handoff-planned" | "staging-planned";

interface SerializedIdentity {
  birthtimeNs: string;
  dev: string;
  ino: string;
  size: string;
}

interface SerializedFileFact {
  identity: SerializedIdentity;
  sha256: string;
}

interface SerializedRollback extends SerializedFileFact {
  path: string;
}

interface ReplacementRecoveryRecord {
  destinationPath: string;
  destination: SerializedFileFact;
  journalId: string;
  newDocumentId: string;
  phase: RecoveryPhase;
  previousDocumentId: string;
  rollback: SerializedRollback;
  staging: SerializedFileFact & { path: string };
  sourceDocumentId: string;
  sourcePath: string;
  version: 2;
}

interface CompactStagingRecoveryRecord {
  destination: SerializedFileFact;
  destinationPath: string;
  journalId: string;
  kind: "compact-staging";
  phase: CompactStagingPhase;
  replacementJournalId: string;
  sourceDocumentId: string;
  stagingPath: string;
  version: 1;
}

export interface ReplacementRecoveryResult {
  attention: boolean;
}

export interface ReplacementRecoveryInspection extends ReplacementRecoveryResult {
  pending: boolean;
}

export interface ReplacementRecoveryJournal {
  filePath: string;
  record: ReplacementRecoveryRecord;
}

export interface CompactStagingRecoveryJournal {
  filePath: string;
  record: CompactStagingRecoveryRecord;
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

function sameSizedIdentity(left: EtherFileIdentity, right: EtherFileIdentity): boolean {
  return sameIdentity(left, right) && left.size === right.size;
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

async function readFileFact(
  filePath: string,
  onChunk?: () => void
): Promise<{ identity: EtherFileIdentity; sha256: string }> {
  const before = readAliasIdentity(filePath);
  const sha256 = await fileHash(filePath, onChunk);
  const after = readAliasIdentity(filePath);
  if (!sameSizedIdentity(before, after)) {
    throw new Error("Recovery file identity changed while it was being hashed.");
  }
  return { identity: after, sha256 };
}

function serializeFileFact(fact: { identity: EtherFileIdentity; sha256: string }): SerializedFileFact {
  return { identity: serializeIdentity(fact.identity), sha256: fact.sha256 };
}

function matchesFileFact(
  actual: { identity: EtherFileIdentity; sha256: string },
  expected: SerializedFileFact
): boolean {
  return (
    sameSizedIdentity(actual.identity, deserializeIdentity(expected.identity)) &&
    actual.sha256 === expected.sha256
  );
}

function atomicWrite(
  filePath: string,
  value: unknown,
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

function parseCompactStagingRecord(input: unknown): CompactStagingRecoveryRecord | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  const value = input as Partial<CompactStagingRecoveryRecord>;
  if (
    value.version !== 1 ||
    value.kind !== "compact-staging" ||
    typeof value.journalId !== "string" ||
    typeof value.replacementJournalId !== "string" ||
    typeof value.destinationPath !== "string" ||
    typeof value.sourceDocumentId !== "string" ||
    typeof value.stagingPath !== "string" ||
    !["handoff-planned", "staging-planned"].includes(value.phase ?? "") ||
    !isSerializedFileFact(value.destination)
  ) return undefined;
  return value as CompactStagingRecoveryRecord;
}

function isSerializedFileFact(input: unknown): input is SerializedFileFact {
  if (typeof input !== "object" || input === null) return false;
  const value = input as Partial<SerializedFileFact>;
  const identity = value.identity;
  return (
    typeof value.sha256 === "string" &&
    /^[a-f0-9]{64}$/.test(value.sha256) &&
    typeof identity === "object" &&
    identity !== null &&
    [identity.birthtimeNs, identity.dev, identity.ino, identity.size].every(
      (part) => typeof part === "string" && /^\d+$/.test(part)
    )
  );
}

function parseRecord(input: unknown): ReplacementRecoveryRecord | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  const value = input as Partial<ReplacementRecoveryRecord>;
  if (
    value.version !== 2 ||
    typeof value.journalId !== "string" ||
    typeof value.destinationPath !== "string" ||
    typeof value.sourcePath !== "string" ||
    typeof value.sourceDocumentId !== "string" ||
    typeof value.newDocumentId !== "string" ||
    typeof value.previousDocumentId !== "string" ||
    !["rollback-planned", "rollback-created", "published"].includes(value.phase ?? "") ||
    !isSerializedFileFact(value.destination) ||
    !isSerializedFileFact(value.rollback) ||
    typeof value.rollback.path !== "string" ||
    !isSerializedFileFact(value.staging) ||
    typeof value.staging.path !== "string"
  ) return undefined;
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

function recoveryPathsAreOwned(record: ReplacementRecoveryRecord): boolean {
  const expectedName = `.${path.basename(record.destinationPath)}.ether-rollback-${record.journalId}`;
  const expectedStagingPrefixes = [
    `.${path.basename(record.destinationPath)}.ether-compact-`,
    `.${path.basename(record.destinationPath)}.ether-save-`
  ];
  return !(
    path.dirname(path.resolve(record.rollback.path)) !== path.dirname(path.resolve(record.destinationPath)) ||
    path.basename(record.rollback.path) !== expectedName ||
    path.dirname(path.resolve(record.staging.path)) !== path.dirname(path.resolve(record.destinationPath)) ||
    !expectedStagingPrefixes.some((prefix) => path.basename(record.staging.path).startsWith(prefix))
  );
}

function compactStagingPathIsOwned(record: CompactStagingRecoveryRecord): boolean {
  const prefix = `.${path.basename(record.destinationPath)}.ether-compact-`;
  const name = path.basename(record.stagingPath);
  return (
    path.dirname(path.resolve(record.stagingPath)) === path.dirname(path.resolve(record.destinationPath)) &&
    name.startsWith(prefix) &&
    /^[a-f0-9-]{36}$/i.test(name.slice(prefix.length))
  );
}

type InspectedFileState =
  | { kind: "absent" }
  | { kind: "indeterminate" }
  | { fact: { identity: EtherFileIdentity; sha256: string }; kind: "present" };

async function inspectFileState(filePath: string): Promise<InspectedFileState> {
  try {
    if (lstatSync(filePath, { throwIfNoEntry: false }) === undefined) return { kind: "absent" };
    return { fact: await readFileFact(filePath), kind: "present" };
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: unknown }).code)
      : "";
    return code === "ENOENT" ? { kind: "absent" } : { kind: "indeterminate" };
  }
}

export async function beginReplacementRecovery(
  recoveryRoot: string,
  input: Omit<
    ReplacementRecoveryRecord,
    "destination" | "journalId" | "phase" | "rollback" | "staging" | "version"
  > & {
    journalId?: string;
    staging: OwnedReplacementRollback;
  }
): Promise<ReplacementRecoveryJournal> {
  const { journalId: requestedJournalId, staging, ...recordInput } = input;
  const journalId = requestedJournalId ?? randomUUID();
  const destinationPath = path.resolve(input.destinationPath);
  const destinationFact = await readFileFact(destinationPath);
  const stagingFact = await readFileFact(staging.path);
  if (!sameSizedIdentity(stagingFact.identity, staging.identity)) {
    throw new Error("Replacement staging identity changed before recovery publication.");
  }
  const rollback: SerializedRollback = {
    ...serializeFileFact(destinationFact),
    path: path.join(
      path.dirname(destinationPath),
      `.${path.basename(destinationPath)}.ether-rollback-${journalId}`
    )
  };
  const journal = {
    filePath: path.join(recoveryRoot, `${journalId}.json`),
    record: {
      ...recordInput,
      destination: serializeFileFact(destinationFact),
      destinationPath,
      journalId,
      phase: "rollback-planned" as const,
      rollback,
      staging: { ...serializeFileFact(stagingFact), path: staging.path },
      version: 2 as const
    }
  };
  atomicWrite(journal.filePath, journal.record);
  return journal;
}

export async function beginCompactStagingRecovery(
  recoveryRoot: string,
  input: {
    destinationPath: string;
    sourceDocumentId: string;
    stagingPath: string;
  }
): Promise<CompactStagingRecoveryJournal> {
  const destinationPath = path.resolve(input.destinationPath);
  const journalId = randomUUID();
  const record: CompactStagingRecoveryRecord = {
    destination: serializeFileFact(await readFileFact(destinationPath)),
    destinationPath,
    journalId,
    kind: "compact-staging",
    phase: "staging-planned",
    replacementJournalId: randomUUID(),
    sourceDocumentId: input.sourceDocumentId,
    stagingPath: path.resolve(input.stagingPath),
    version: 1
  };
  if (!compactStagingPathIsOwned(record)) {
    throw new Error("Compact staging path is outside its durable ownership boundary.");
  }
  const journal = { filePath: path.join(recoveryRoot, `${journalId}.json`), record };
  atomicWrite(journal.filePath, record);
  return journal;
}

export function markCompactStagingHandoff(journal: CompactStagingRecoveryJournal): void {
  journal.record = { ...journal.record, phase: "handoff-planned" };
  atomicWrite(journal.filePath, journal.record);
}

export function compactReplacementJournalId(journal: CompactStagingRecoveryJournal): string {
  return journal.record.replacementJournalId;
}

export function completeCompactStagingRecovery(journal: CompactStagingRecoveryJournal): void {
  const current = parseCompactStagingRecord(JSON.parse(readFileSync(journal.filePath, "utf8")));
  if (current?.journalId === journal.record.journalId) unlinkSync(journal.filePath);
  try {
    unlinkSync(`${journal.filePath}.tmp`);
  } catch {
    // The deterministic journal temporary is already absent.
  }
}

export function discardCompactStagingRecovery(journal: CompactStagingRecoveryJournal): void {
  const staging = lstatSync(journal.record.stagingPath, { bigint: true, throwIfNoEntry: false });
  if (staging !== undefined) {
    if (!staging.isFile()) throw new Error("Compact staging path is no longer a regular file.");
    unlinkSync(journal.record.stagingPath);
  }
  completeCompactStagingRecovery(journal);
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
    path.resolve(planned.path) !== path.resolve(rollback.path) ||
    !sameSizedIdentity(deserializeIdentity(planned.identity), rollback.identity)
  ) {
    throw new Error("Replacement rollback does not match its durable recovery plan.");
  }
  const rollbackFact = await readFileFact(rollback.path, hooks.afterHashChunk);
  if (!matchesFileFact(rollbackFact, planned)) {
    throw new Error("Replacement rollback content does not match its durable recovery plan.");
  }
  journal.record = {
    ...journal.record,
    phase: "rollback-created",
    rollback: {
      identity: serializeIdentity(rollback.identity),
      path: rollback.path,
      sha256: rollbackFact.sha256
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

async function processReplacementRecovery(
  destinationPath: string,
  recoveryRoot: string,
  apply: boolean
): Promise<ReplacementRecoveryInspection> {
  let attention = false;
  let pending = false;
  let names: string[];
  try {
    names = readdirSync(recoveryRoot).filter((name) => /^[a-f0-9-]+\.json(?:\.tmp)?$/i.test(name));
  } catch {
    return { attention, pending };
  }
  for (const name of names) {
    if (name.endsWith(".tmp")) {
      if (!apply) continue;
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
    let input: unknown;
    let record: ReplacementRecoveryRecord | undefined;
    try {
      input = JSON.parse(readFileSync(filePath, "utf8"));
      const compact = parseCompactStagingRecord(input);
      if (compact !== undefined) {
        if (canonicalPath(compact.destinationPath) !== canonicalPath(destinationPath)) continue;
        pending = true;
        if (!compactStagingPathIsOwned(compact)) {
          attention = true;
          continue;
        }
        const destination = await inspectFileState(compact.destinationPath);
        const stagingStats = lstatSync(compact.stagingPath, { bigint: true, throwIfNoEntry: false });
        if (stagingStats === undefined) {
          if (apply) completeCompactStagingRecovery({ filePath, record: compact });
          continue;
        }
        if (!stagingStats.isFile()) {
          attention = true;
          continue;
        }
        if (compact.phase === "handoff-planned") {
          const replacementPath = path.join(recoveryRoot, `${compact.replacementJournalId}.json`);
          const replacementInput = (() => {
            try {
              return JSON.parse(readFileSync(replacementPath, "utf8"));
            } catch {
              return undefined;
            }
          })();
          const replacement = parseRecord(replacementInput);
          if (replacement !== undefined) {
            if (
              replacement.journalId !== compact.replacementJournalId ||
              canonicalPath(replacement.destinationPath) !== canonicalPath(compact.destinationPath) ||
              canonicalPath(replacement.staging.path) !== canonicalPath(compact.stagingPath)
            ) {
              attention = true;
              continue;
            }
            if (apply) completeCompactStagingRecovery({ filePath, record: compact });
            continue;
          }
        }
        const destinationMatches = destination.kind === "present" &&
          matchesFileFact(destination.fact, compact.destination);
        if (!destinationMatches) {
          attention = true;
          continue;
        }
        if (apply) {
          removeOwnedPath(compact.stagingPath, readAliasIdentity(compact.stagingPath));
          completeCompactStagingRecovery({ filePath, record: compact });
        }
        continue;
      }
      record = parseRecord(input);
    } catch {
      continue;
    }
    const recordedDestination = typeof input === "object" && input !== null && "destinationPath" in input
      ? (input as { destinationPath?: unknown }).destinationPath
      : undefined;
    if (typeof recordedDestination !== "string" || canonicalPath(recordedDestination) !== canonicalPath(destinationPath)) {
      continue;
    }
    pending = true;
    if (record === undefined || !recoveryPathsAreOwned(record)) {
      attention = true;
      continue;
    }
    const journal = { filePath, record };
    const destination = await inspectFileState(record.destinationPath);
    const rollbackState = await inspectFileState(record.rollback.path);
    const stagingState = await inspectFileState(record.staging.path);
    const destinationIsPrevious = destination.kind === "present" && matchesFileFact(destination.fact, record.destination);
    const destinationIsStaging = destination.kind === "present" && matchesFileFact(destination.fact, record.staging);
    const rollbackMatches = rollbackState.kind === "present" && matchesFileFact(rollbackState.fact, record.rollback);
    const stagingMatches = stagingState.kind === "present" && matchesFileFact(stagingState.fact, record.staging);
    const indeterminate = [destination, rollbackState, stagingState]
      .some((state) => state.kind === "indeterminate");
    const tampered =
      (destination.kind === "present" && !destinationIsPrevious && !destinationIsStaging) ||
      (rollbackState.kind === "present" && !rollbackMatches) ||
      (stagingState.kind === "present" && !stagingMatches);
    if (indeterminate || tampered) {
      attention = true;
      continue;
    }

    let resolved = record.phase === "rollback-planned"
      ? destinationIsPrevious && stagingMatches && (rollbackMatches || rollbackState.kind === "absent")
      : record.phase === "rollback-created"
        ? (
            destinationIsPrevious && (
              (stagingMatches && rollbackMatches) ||
              (stagingState.kind === "absent" && rollbackState.kind === "absent")
            )
          ) || (
            destinationIsStaging && stagingState.kind === "absent" && rollbackMatches
          )
        : (
            destinationIsStaging &&
            stagingState.kind === "absent" &&
            (rollbackMatches || rollbackState.kind === "absent")
          ) || (
            destinationIsPrevious &&
            stagingState.kind === "absent" &&
            rollbackState.kind === "absent"
          );

    if (apply && !resolved && destination.kind === "absent" && rollbackMatches) {
      const rollback = {
        identity: deserializeIdentity(record.rollback.identity),
        path: record.rollback.path
      };
      restoreOwnedReplacementRollback(rollback, record.destinationPath);
      const restored = await inspectFileState(record.destinationPath);
      resolved = restored.kind === "present" && matchesFileFact(restored.fact, record.destination);
    }
    if (!resolved) {
      attention = true;
      continue;
    }
    if (!apply) continue;
    if (rollbackMatches) {
      removeOwnedReplacementRollback({
        identity: deserializeIdentity(record.rollback.identity),
        path: record.rollback.path
      });
    }
    if (stagingMatches) {
      removeOwnedPath(record.staging.path, deserializeIdentity(record.staging.identity));
    }
    removeJournal(journal);
  }
  return { attention, pending };
}

export async function inspectReplacementRecovery(
  destinationPath: string,
  recoveryRoot: string
): Promise<ReplacementRecoveryInspection> {
  return processReplacementRecovery(destinationPath, recoveryRoot, false);
}

export async function reconcileReplacementRecovery(
  destinationPath: string,
  recoveryRoot: string
): Promise<ReplacementRecoveryResult> {
  const { attention } = await processReplacementRecovery(destinationPath, recoveryRoot, true);
  return { attention };
}
