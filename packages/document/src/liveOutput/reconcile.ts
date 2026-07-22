import { createHash } from "node:crypto";
import path from "node:path";

import type { LiveOutputEntry, LiveOutputOperation } from "@ether/schema";
import {
  LiveOutputError,
  LiveOutputRepository,
  liveOutputOperationId,
  type LiveOutputDirectoryGrant,
} from "../repositories/liveOutput.js";
import {
  assertLiveOutputGrantUsable,
  nodeLiveOutputFileSystem,
  resolveLiveOutputPath,
  type LiveOutputFileSystem,
  type LiveOutputGrantValidator
} from "./materialize.js";

export interface ReconcileLiveOutputOptions {
  fileSystem?: LiveOutputFileSystem;
  grant: LiveOutputDirectoryGrant;
  grantValidator?: LiveOutputGrantValidator;
}

export interface ReconcileLiveOutputResult {
  changedPaths: string[];
  disabled: boolean;
  extraOwnedPaths: string[];
  extraPaths: string[];
  missingPaths: string[];
  operationId: string | null;
  pendingOperationIds: string[];
}

export interface RemoveMirrorFilesOptions {
  fileSystem?: LiveOutputFileSystem;
  grant: LiveOutputDirectoryGrant;
  grantValidator?: LiveOutputGrantValidator;
}

export interface RemoveMirrorFilesResult {
  disabled: boolean;
  operationIds: string[];
  removedPaths: string[];
}

interface RelativeFileRecord {
  kind: "directory" | "file" | "symlink";
  relativePath: string;
}

interface PathInspection {
  hash?: string;
  kind: "changed" | "file" | "missing";
  length?: number;
}

function hash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function isMissingPathError(error: unknown): boolean {
  return typeof error === "object" && error !== null &&
    "code" in error && ["ENOENT", "ENOTDIR"].includes(String((error as { code?: unknown }).code));
}

async function inspectPath(
  root: string,
  relativePath: string,
  fileSystem: LiveOutputFileSystem
): Promise<PathInspection> {
  const filePath = resolveLiveOutputPath(root, relativePath);
  const info = await fileSystem.lstat(filePath);
  if (info === undefined) return { kind: "missing" };
  if (!info.isFile || info.isSymbolicLink) return { kind: "changed" };
  const bytes = await fileSystem.readFile(filePath);
  return { hash: hash(bytes), kind: "file", length: bytes.byteLength };
}

async function scanFiles(
  root: string,
  relativeDirectory: string,
  fileSystem: LiveOutputFileSystem
): Promise<RelativeFileRecord[]> {
  const directoryPath = relativeDirectory.length === 0
    ? root
    : resolveLiveOutputPath(root, relativeDirectory);
  let children;
  try {
    children = await fileSystem.readdir(directoryPath);
  } catch (error) {
    if (isMissingPathError(error)) return [];
    throw error;
  }
  const records: RelativeFileRecord[] = [];
  for (const child of children) {
    const childRelativePath = relativeDirectory.length === 0
      ? child.name
      : `${relativeDirectory}/${child.name}`;
    if (child.isSymbolicLink()) {
      records.push({ kind: "symlink", relativePath: childRelativePath });
    } else if (child.isDirectory()) {
      records.push({ kind: "directory", relativePath: childRelativePath });
      records.push(...await scanFiles(root, childRelativePath, fileSystem));
    } else if (child.isFile()) {
      records.push({ kind: "file", relativePath: childRelativePath });
    }
  }
  return records;
}

function attentionError(code: string, message: string): Record<string, string> {
  return { code, message };
}

function temporarySibling(destination: string, operationId: string): string {
  return path.join(path.dirname(destination), `.${path.basename(destination)}.ether-live-${operationId}.tmp`);
}

async function createReconcileOperation(
  repository: LiveOutputRepository,
  grantId: string,
  relativePath: string,
  expectedHash: string,
  error: Record<string, string> | null
): Promise<LiveOutputOperation> {
  const id = liveOutputOperationId({
    entryId: null,
    expectedHash,
    grantId,
    key: relativePath,
    operation: "reconcile"
  });
  const operation = repository.planOperation({
    entryId: null,
    error,
    expectedHash,
    id,
    operation: "reconcile",
    relativePath: `__reconcile__/${relativePath.replaceAll("/", "_")}`.slice(0, 240),
    state: "reconciled"
  });
  return repository.updateOperationState(operation.id, "reconciled", error);
}

function driftHash(entry: LiveOutputEntry, reason: string): string {
  return hash(Buffer.from(`${entry.id}\0${entry.relativePath}\0${entry.expectedHash}\0${reason}`));
}

export async function reconcileLiveOutput(
  repository: LiveOutputRepository,
  options: ReconcileLiveOutputOptions
): Promise<ReconcileLiveOutputResult> {
  const settings = repository.getSettings();
  if (!settings.enabled) {
    return {
      changedPaths: [],
      disabled: true,
      extraOwnedPaths: [],
      extraPaths: [],
      missingPaths: [],
      operationId: null,
      pendingOperationIds: []
    };
  }
  const fileSystem = options.fileSystem ?? nodeLiveOutputFileSystem;
  const current = await assertLiveOutputGrantUsable(
    repository,
    options.grant,
    fileSystem,
    options.grantValidator
  );
  const entries = repository.listEntries();
  const manifestPaths = new Set(entries.map((entry) => entry.relativePath));
  const missingPaths: string[] = [];
  const changedPaths: string[] = [];
  const attentionOperations: string[] = [];

  for (const entry of entries) {
    const inspection = await inspectPath(current.root, entry.relativePath, fileSystem);
    if (inspection.kind === "missing") {
      missingPaths.push(entry.relativePath);
      repository.updateEntryState(entry.id, "reconciled");
      const operation = await createReconcileOperation(
        repository,
        options.grant.grantId,
        entry.relativePath,
        driftHash(entry, "missing"),
        attentionError("MISSING_MIRROR", `Manifest path is missing: ${entry.relativePath}`)
      );
      attentionOperations.push(operation.id);
    } else if (
      inspection.kind !== "file" ||
      inspection.hash !== entry.expectedHash ||
      inspection.length !== undefined && inspection.length < 0
    ) {
      changedPaths.push(entry.relativePath);
      repository.updateEntryState(entry.id, "reconciled");
      const operation = await createReconcileOperation(
        repository,
        options.grant.grantId,
        entry.relativePath,
        driftHash(entry, "changed"),
        attentionError("CHANGED_MIRROR", `Manifest path differs from its embedded hash: ${entry.relativePath}`)
      );
      attentionOperations.push(operation.id);
    } else if (entry.state !== "committed") {
      repository.updateEntryState(entry.id, "committed");
    }
  }

  const operations = repository.listOperations();
  const pendingOperationIds: string[] = [];
  const extraOwnedPaths = new Set<string>();
  for (const operation of operations) {
    const destination = resolveLiveOutputPath(current.root, operation.relativePath);
    const temporary = temporarySibling(destination, operation.id);
    const temporaryInfo = await fileSystem.lstat(temporary);
    if (temporaryInfo !== undefined) extraOwnedPaths.add(operation.relativePath);
    const entry = operation.entryId === null ? undefined : repository.getEntry(operation.entryId);
    const inspection = await inspectPath(current.root, operation.relativePath, fileSystem);
    if (["planned", "staged", "verified"].includes(operation.state)) {
      pendingOperationIds.push(operation.id);
      if (
        inspection.kind === "file" &&
        inspection.hash === operation.expectedHash
      ) {
        repository.updateOperationState(operation.id, "committed");
        if (entry !== undefined) repository.updateEntryState(entry.id, "committed");
      } else if (temporaryInfo === undefined && inspection.kind === "missing") {
        repository.updateOperationState(
          operation.id,
          "reconciled",
          attentionError("PENDING_OPERATION_MISSING", `Journaled Live Output operation has no staged or committed file: ${operation.id}`)
        );
      }
    } else if (
      operation.state === "committed" &&
      entry !== undefined &&
      !manifestPaths.has(operation.relativePath) &&
      inspection.kind !== "missing"
    ) {
      extraOwnedPaths.add(operation.relativePath);
    }
  }

  const scanned = await scanFiles(current.root, "", fileSystem);
  const extraPaths = scanned
    .filter((record) => record.kind === "file" || record.kind === "symlink")
    .map((record) => record.relativePath)
    .filter((relativePath) => !manifestPaths.has(relativePath))
    .sort();
  for (const relativePath of extraPaths) {
    if (relativePath.includes(".ether-live-")) extraOwnedPaths.add(relativePath);
  }

  const summary = JSON.stringify({
    changedPaths,
    missingPaths,
    pendingOperationIds,
    extraOwnedPaths: [...extraOwnedPaths].sort()
  });
  const rootOperation = await createReconcileOperation(
    repository,
    options.grant.grantId,
    "summary",
    hash(Buffer.from(summary)),
    missingPaths.length === 0 && changedPaths.length === 0 && extraPaths.length === 0
      ? null
      : attentionError(
          "LIVE_OUTPUT_ATTENTION",
          `Live Output reconciliation found ${missingPaths.length} missing, ${changedPaths.length} changed, and ${extraPaths.length} extra paths.`
        )
  );
  if (missingPaths.length === 0 && changedPaths.length === 0 && extraPaths.length === 0) {
    repository.updateOperationState(rootOperation.id, "committed");
  }
  repository.setLastReconciledAt(new Date().toISOString());
  return {
    changedPaths: changedPaths.sort(),
    disabled: false,
    extraOwnedPaths: [...extraOwnedPaths].sort(),
    extraPaths,
    missingPaths: missingPaths.sort(),
    operationId: rootOperation.id,
    pendingOperationIds
  };
}

export async function removeMirrorFiles(
  repository: LiveOutputRepository,
  options: RemoveMirrorFilesOptions
): Promise<RemoveMirrorFilesResult> {
  const settings = repository.getSettings();
  const fileSystem = options.fileSystem ?? nodeLiveOutputFileSystem;
  const current = await assertLiveOutputGrantUsable(
    repository,
    options.grant,
    fileSystem,
    options.grantValidator
  );
  const removedPaths: string[] = [];
  const operationIds: string[] = [];
  for (const entry of repository.listEntries()) {
    const operationId = liveOutputOperationId({
      entryId: entry.id,
      expectedHash: entry.expectedHash,
      grantId: options.grant.grantId,
      operation: "remove"
    });
    let operation = repository.planOperation({
      entryId: entry.id,
      expectedHash: entry.expectedHash,
      id: operationId,
      operation: "remove",
      relativePath: entry.relativePath
    });
    operationIds.push(operation.id);
    try {
      operation = repository.updateOperationState(operation.id, "staged");
      const filePath = resolveLiveOutputPath(current.root, entry.relativePath);
      const info = await fileSystem.lstat(filePath);
      operation = repository.updateOperationState(operation.id, "verified");
      if (info !== undefined && (info.isFile || info.isSymbolicLink)) {
        await fileSystem.unlink(filePath);
        const after = await fileSystem.lstat(filePath);
        if (after !== undefined) {
          throw new LiveOutputError("REMOVE_VERIFY_FAILED", `Live Output mirror was not removed: ${entry.relativePath}`);
        }
        removedPaths.push(entry.relativePath);
      }
      operation = repository.updateOperationState(operation.id, "committed");
      repository.updateEntryState(entry.id, "reconciled");
    } catch (error) {
      repository.failOperation(operation.id, error);
      repository.updateEntryState(entry.id, "failed");
      throw error instanceof LiveOutputError
        ? error
        : new LiveOutputError("REMOVE_FAILED", error instanceof Error ? error.message : String(error), { cause: error });
    }
  }
  return { disabled: !settings.enabled, operationIds, removedPaths };
}

export const reconcile = reconcileLiveOutput;
export const removeLiveOutputMirrorFiles = removeMirrorFiles;
