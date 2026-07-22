import { createHash } from "node:crypto";
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  realpath,
  readdir,
  rename,
  unlink,
  writeFile
} from "node:fs/promises";
import path from "node:path";

import type { LiveOutputEntry, LiveOutputOperation } from "@ether/schema";
import {
  LiveOutputError,
  LiveOutputRepository,
  liveOutputErrorObject,
  liveOutputOperationId,
  normalizeLiveOutputRelativePath,
  validateLiveOutputGrant,
  type LiveOutputDirectoryGrant,
  type LiveOutputOperationKind
} from "../repositories/liveOutput.js";

export interface LiveOutputFileInfo {
  byteLength?: number;
  isDirectory: boolean;
  isFile: boolean;
  isSymbolicLink: boolean;
}

export interface LiveOutputDirectoryEntry {
  isDirectory(): boolean;
  isFile(): boolean;
  isSymbolicLink(): boolean;
  name: string;
}

export interface LiveOutputFileSystem {
  copyFile(source: string, destination: string): Promise<void>;
  lstat(filePath: string): Promise<LiveOutputFileInfo | undefined>;
  mkdir(directoryPath: string, options?: { recursive?: boolean }): Promise<void>;
  readdir(directoryPath: string): Promise<readonly LiveOutputDirectoryEntry[]>;
  readFile(filePath: string): Promise<Uint8Array>;
  realpath(filePath: string): Promise<string>;
  rename(source: string, destination: string): Promise<void>;
  unlink(filePath: string): Promise<void>;
  writeFile(filePath: string, data: Uint8Array, options?: { flag?: "w" | "wx" }): Promise<void>;
}

export const nodeLiveOutputFileSystem: LiveOutputFileSystem = {
  async copyFile(source, destination) {
    await copyFile(source, destination);
  },
  async lstat(filePath) {
    try {
      const stats = await lstat(filePath);
      return {
        byteLength: Number(stats.size),
        isDirectory: stats.isDirectory(),
        isFile: stats.isFile(),
        isSymbolicLink: stats.isSymbolicLink()
      };
    } catch (error) {
      if (isMissingPathError(error)) return undefined;
      throw error;
    }
  },
  async mkdir(directoryPath, options) {
    await mkdir(directoryPath, options);
  },
  async readdir(directoryPath) {
    return readdir(directoryPath, { withFileTypes: true });
  },
  async readFile(filePath) {
    return readFile(filePath);
  },
  async realpath(filePath) {
    return realpath(filePath);
  },
  async rename(source, destination) {
    await rename(source, destination);
  },
  async unlink(filePath) {
    await unlink(filePath);
  },
  async writeFile(filePath, data, options) {
    await writeFile(filePath, data, options);
  }
};

export type LiveOutputBlobReader =
  | ((contentKey: string) => Promise<Uint8Array> | Uint8Array)
  | { read(contentKey: string): Promise<Uint8Array> | Uint8Array };

export type LiveOutputCheckpoint = (
  stage: "planned" | "staged" | "verified" | "committed",
  operation: LiveOutputOperation
) => void | Promise<void>;

export type LiveOutputGrantValidator = (
  grant: LiveOutputDirectoryGrant
) => boolean | Promise<boolean>;

export interface LiveOutputMaterializationItem {
  artifactId: string;
  byteLength: number;
  collectionId: string | null;
  contentKey?: string;
  expectedHash: string;
  relativePath: string;
  bytes?: Uint8Array;
}

export interface MaterializeLiveOutputOptions {
  blobReader?: LiveOutputBlobReader;
  checkpoint?: LiveOutputCheckpoint;
  fileSystem?: LiveOutputFileSystem;
  grant: LiveOutputDirectoryGrant;
  grantValidator?: LiveOutputGrantValidator;
  items: readonly LiveOutputMaterializationItem[];
  operationKind?: Extract<LiveOutputOperationKind, "materialize" | "rebuild">;
  previousGrant?: LiveOutputDirectoryGrant;
}

export interface MaterializedLiveOutputItem {
  artifactId: string;
  entryId: string;
  operationId: string;
  relativePath: string;
  state: "committed" | "failed" | "reconciled";
}

export interface MaterializeLiveOutputResult {
  disabled: boolean;
  items: MaterializedLiveOutputItem[];
}

interface FileInspection {
  bytes: Uint8Array;
  hash: string;
  kind: "file";
  length: number;
}

interface PriorMirrorResult {
  removed: boolean;
  reason?: string;
}

function isMissingPathError(error: unknown): boolean {
  return typeof error === "object" && error !== null &&
    "code" in error && ["ENOENT", "ENOTDIR"].includes(String((error as { code?: unknown }).code));
}

function errorCode(error: unknown): string | undefined {
  return error instanceof LiveOutputError
    ? error.code
    : typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: unknown }).code)
      : undefined;
}

function contentHash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function pathIsContained(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative.length > 0 && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
}

export function resolveLiveOutputPath(root: string, relativePath: string): string {
  const normalized = normalizeLiveOutputRelativePath(relativePath);
  const candidate = path.resolve(root, ...normalized.split("/"));
  if (!pathIsContained(path.resolve(root), candidate)) {
    throw new LiveOutputError("PATH_ESCAPE", "Live Output path escaped its granted directory.");
  }
  return candidate;
}

export async function assertLiveOutputGrantUsable(
  repository: LiveOutputRepository,
  grant: LiveOutputDirectoryGrant,
  fileSystem: LiveOutputFileSystem,
  grantValidator?: LiveOutputGrantValidator
): Promise<{ grant: LiveOutputDirectoryGrant; root: string }> {
  const validated = validateLiveOutputGrant(
    grant,
    repository.getDocumentId(),
    repository.getSettings().pathGrantId
  );
  if (grantValidator !== undefined && !(await grantValidator(validated))) {
    throw new LiveOutputError("INVALID_GRANT", "The Live Output directory grant is no longer valid.");
  }
  const info = await fileSystem.lstat(validated.root);
  if (info === undefined || !info.isDirectory) {
    throw new LiveOutputError("ROOT_NOT_FOUND", "The granted Live Output directory is not available.");
  }
  const root = path.resolve(await fileSystem.realpath(validated.root));
  return { grant: validated, root };
}

async function realPriorRoot(
  repository: LiveOutputRepository,
  grant: LiveOutputDirectoryGrant,
  fileSystem: LiveOutputFileSystem
): Promise<string | undefined> {
  const validated = validateLiveOutputGrant(grant, repository.getDocumentId());
  const info = await fileSystem.lstat(validated.root);
  if (info === undefined || !info.isDirectory) return undefined;
  return path.resolve(await fileSystem.realpath(validated.root));
}

async function ensureParent(
  root: string,
  filePath: string,
  fileSystem: LiveOutputFileSystem
): Promise<void> {
  const parent = path.dirname(filePath);
  if (!pathIsContained(root, parent) && path.resolve(parent) !== path.resolve(root)) {
    throw new LiveOutputError("PATH_ESCAPE", "Live Output parent directory escaped its granted root.");
  }
  await fileSystem.mkdir(parent, { recursive: true });
  const parentReal = path.resolve(await fileSystem.realpath(parent));
  if (!pathIsContained(root, parentReal) && path.resolve(parentReal) !== path.resolve(root)) {
    throw new LiveOutputError("PATH_ESCAPE", "Live Output parent directory is a symlink outside its granted root.");
  }
}

async function inspectFile(
  filePath: string,
  fileSystem: LiveOutputFileSystem
): Promise<FileInspection | undefined> {
  const info = await fileSystem.lstat(filePath);
  if (info === undefined) return undefined;
  if (!info.isFile || info.isSymbolicLink) {
    throw new LiveOutputError("NOT_A_REGULAR_FILE", `Live Output path is not a regular file: ${filePath}`);
  }
  const bytes = await fileSystem.readFile(filePath);
  return { bytes, hash: contentHash(bytes), kind: "file", length: bytes.byteLength };
}

function matchesExpected(
  file: FileInspection | undefined,
  expectedHash: string,
  byteLength: number
): boolean {
  return file !== undefined && file.length === byteLength && file.hash === expectedHash;
}

async function readSource(
  item: LiveOutputMaterializationItem,
  blobReader?: LiveOutputBlobReader
): Promise<Uint8Array> {
  if (item.bytes !== undefined) return Buffer.from(item.bytes);
  if (blobReader === undefined) {
    throw new LiveOutputError("BLOB_READER_REQUIRED", "Live Output materialization requires an injected blob reader.");
  }
  const contentKey = item.contentKey ?? item.expectedHash;
  const bytes = typeof blobReader === "function"
    ? await blobReader(contentKey)
    : await blobReader.read(contentKey);
  return Buffer.from(bytes);
}

function temporarySibling(destination: string, operationId: string): string {
  return path.join(path.dirname(destination), `.${path.basename(destination)}.ether-live-${operationId}.tmp`);
}

function renamedPath(relativePath: string, index: number): string {
  const slash = relativePath.lastIndexOf("/");
  const directory = slash < 0 ? "" : `${relativePath.slice(0, slash + 1)}`;
  const name = slash < 0 ? relativePath : relativePath.slice(slash + 1);
  const extension = path.posix.extname(name);
  const stem = extension.length === 0 ? name : name.slice(0, -extension.length);
  return normalizeLiveOutputRelativePath(`${directory}${stem} (${index})${extension}`);
}

async function chooseCollisionPath(
  repository: LiveOutputRepository,
  root: string,
  entry: LiveOutputEntry,
  relativePath: string,
  expectedHash: string,
  byteLength: number,
  fileSystem: LiveOutputFileSystem
): Promise<{ existing?: FileInspection; occupied: boolean; relativePath: string }> {
  const settings = repository.getSettings();
  const inspectCandidate = async (candidate: string): Promise<{ occupied: boolean; file?: FileInspection }> => {
    const candidatePath = resolveLiveOutputPath(root, candidate);
    const info = await fileSystem.lstat(candidatePath);
    if (info === undefined) return { occupied: false };
    if (!info.isFile || info.isSymbolicLink) return { occupied: true };
    const bytes = await fileSystem.readFile(candidatePath);
    return { occupied: true, file: { bytes, hash: contentHash(bytes), kind: "file", length: bytes.byteLength } };
  };
  const isClaimedByAnotherEntry = (candidate: string): boolean => {
    const claimed = repository.getEntryByRelativePath(candidate);
    return claimed !== undefined && claimed.id !== entry.id;
  };
  const existing = await inspectCandidate(relativePath);
  if (matchesExpected(existing.file, expectedHash, byteLength) && !isClaimedByAnotherEntry(relativePath)) {
    return { existing: existing.file, occupied: true, relativePath };
  }
  if (!existing.occupied && !isClaimedByAnotherEntry(relativePath)) {
    return { occupied: false, relativePath };
  }
  if (settings.collisionPolicy === "skip") {
    return { existing: existing.file, occupied: true, relativePath };
  }
  if (settings.collisionPolicy === "error") {
    throw new LiveOutputError("COLLISION", `Live Output destination already exists: ${relativePath}`);
  }
  for (let index = 1; index <= 10000; index += 1) {
    const candidate = renamedPath(relativePath, index);
    const candidateExisting = await inspectCandidate(candidate);
    if (
      !candidateExisting.occupied &&
      !isClaimedByAnotherEntry(candidate)
    ) {
      return { occupied: false, relativePath: candidate };
    }
    if (
      matchesExpected(candidateExisting.file, expectedHash, byteLength) &&
      !isClaimedByAnotherEntry(candidate)
    ) {
      return { existing: candidateExisting.file, occupied: true, relativePath: candidate };
    }
  }
  throw new LiveOutputError("COLLISION_EXHAUSTED", `Live Output could not find a collision-free name for ${relativePath}`);
}

async function removeOwnedPriorMirror(
  priorRoot: string | undefined,
  priorRelativePath: string | null,
  priorExpectedHash: string | undefined,
  destinationRoot: string,
  destinationRelativePath: string,
  fileSystem: LiveOutputFileSystem
): Promise<PriorMirrorResult> {
  if (priorRoot === undefined || priorRelativePath === null) return { removed: false, reason: "prior-root-unavailable" };
  const priorPath = resolveLiveOutputPath(priorRoot, priorRelativePath);
  const destinationPath = resolveLiveOutputPath(destinationRoot, destinationRelativePath);
  if (path.resolve(priorPath) === path.resolve(destinationPath)) return { removed: false };
  const info = await fileSystem.lstat(priorPath);
  if (info === undefined) return { removed: false, reason: "prior-mirror-missing" };
  if (!info.isFile && !info.isSymbolicLink) {
    return { removed: false, reason: "prior-mirror-not-file" };
  }
  if (info.isFile && !info.isSymbolicLink && priorExpectedHash !== undefined) {
    const prior = await inspectFile(priorPath, fileSystem);
    if (prior === undefined || prior.hash !== priorExpectedHash) {
      return { removed: false, reason: "prior-mirror-changed" };
    }
  }
  await fileSystem.unlink(priorPath);
  return { removed: true };
}

async function stageTemp(
  root: string,
  destination: string,
  operation: LiveOutputOperation,
  bytes: Uint8Array,
  expectedHash: string,
  byteLength: number,
  priorRoot: string | undefined,
  priorRelativePath: string | null,
  priorExpectedHash: string | undefined,
  fileSystem: LiveOutputFileSystem
): Promise<{ temporaryPath: string; copiedPrior: boolean }> {
  await ensureParent(root, destination, fileSystem);
  const temporaryPath = temporarySibling(destination, operation.id);
  const existingTempInfo = await fileSystem.lstat(temporaryPath);
  if (existingTempInfo !== undefined) {
    let valid = false;
    if (existingTempInfo.isFile && !existingTempInfo.isSymbolicLink) {
      const existingTemp = await inspectFile(temporaryPath, fileSystem);
      valid = matchesExpected(existingTemp, expectedHash, byteLength);
    }
    if (!valid) await fileSystem.unlink(temporaryPath);
    else return { temporaryPath, copiedPrior: false };
  }

  let copiedPrior = false;
  if (priorRoot !== undefined && priorRelativePath !== null && priorExpectedHash === expectedHash) {
    const priorPath = resolveLiveOutputPath(priorRoot, priorRelativePath);
    const priorInfo = await fileSystem.lstat(priorPath);
    if (priorInfo?.isFile === true && priorInfo.isSymbolicLink === false) {
      const prior = await inspectFile(priorPath, fileSystem);
      if (matchesExpected(prior, expectedHash, byteLength)) {
        await fileSystem.copyFile(priorPath, temporaryPath);
        const copied = await inspectFile(temporaryPath, fileSystem);
        if (!matchesExpected(copied, expectedHash, byteLength)) {
          await fileSystem.unlink(temporaryPath);
          throw new LiveOutputError("TRANSFER_VERIFY_FAILED", "Live Output prior mirror failed copy verification.");
        }
        copiedPrior = true;
        return { temporaryPath, copiedPrior };
      }
    }
  }

  await fileSystem.writeFile(temporaryPath, bytes, { flag: "wx" });
  return { temporaryPath, copiedPrior };
}

async function publishNoClobber(
  temporaryPath: string,
  destination: string,
  expectedHash: string,
  byteLength: number,
  fileSystem: LiveOutputFileSystem
): Promise<void> {
  const existing = await fileSystem.lstat(destination);
  if (existing !== undefined) {
    const inspected = existing.isFile && !existing.isSymbolicLink
      ? await inspectFile(destination, fileSystem)
      : undefined;
    if (matchesExpected(inspected, expectedHash, byteLength)) {
      await fileSystem.unlink(temporaryPath);
      return;
    }
    throw new LiveOutputError("DESTINATION_APPEARED", "Live Output destination appeared during publication.");
  }
  await fileSystem.rename(temporaryPath, destination);
}

async function materializeOne(
  repository: LiveOutputRepository,
  item: LiveOutputMaterializationItem,
  options: MaterializeLiveOutputOptions,
  root: string,
  priorRoot: string | undefined,
  fileSystem: LiveOutputFileSystem
): Promise<MaterializedLiveOutputItem> {
  const relativePath = normalizeLiveOutputRelativePath(item.relativePath);
  const expectedHash = item.expectedHash.toLowerCase();
  const bytes = await readSource(item, options.blobReader);
  if (
    bytes.byteLength !== item.byteLength ||
    contentHash(bytes) !== expectedHash ||
    (item.contentKey !== undefined && item.contentKey.toLowerCase() !== expectedHash)
  ) {
    throw new LiveOutputError(
      "SOURCE_VERIFY_FAILED",
      `Embedded Live Output source for ${item.artifactId} failed length or SHA-256 verification.`
    );
  }

  const entryId = item.artifactId.length === 0
    ? (() => { throw new LiveOutputError("INVALID_ARTIFACT_ID", "Live Output entries require an artifact ID."); })()
    : `live-output-entry-${createHash("sha256").update(item.artifactId).digest("hex").slice(0, 32)}`;
  const previous = repository.getEntry(entryId);
  const previousRelativePath = previous?.relativePath ?? null;
  const previousExpectedHash = previous?.expectedHash;
  const rootsChanged = priorRoot !== undefined && path.resolve(priorRoot) !== path.resolve(root);
  const sourcePath = previousRelativePath !== null &&
    (previousRelativePath !== relativePath || rootsChanged)
    ? previousRelativePath
    : null;
  const operationKind = options.operationKind ?? "materialize";
  const operationId = liveOutputOperationId({
    entryId,
    expectedHash,
    grantId: options.grant.grantId,
    operation: operationKind
  });
  let operation: LiveOutputOperation | undefined;
  let entry: LiveOutputEntry | undefined;

  try {
    entry = repository.planEntry({
      artifactId: item.artifactId,
      collectionId: item.collectionId,
      expectedHash,
      id: entryId,
      relativePath,
      state: "planned"
    });
    operation = repository.planOperation({
      entryId,
      expectedHash,
      id: operationId,
      operation: operationKind,
      relativePath,
      sourcePath
    });
    await options.checkpoint?.("planned", operation);

    let destinationRelativePath = operation.relativePath;
    let destination = resolveLiveOutputPath(root, destinationRelativePath);
    let destinationInspection = await inspectFile(destination, fileSystem);
    const temporaryPath = temporarySibling(destination, operation.id);
    const temporaryInfo = await fileSystem.lstat(temporaryPath);

    if (operation.state === "committed" && matchesExpected(destinationInspection, expectedHash, item.byteLength)) {
      if (entry.state !== "committed") repository.updateEntryState(entry.id, "committed");
      return {
        artifactId: item.artifactId,
        entryId,
        operationId,
        relativePath: destinationRelativePath,
        state: "committed"
      };
    }
    if (operation.state === "committed") {
      operation = repository.updateOperationState(operation.id, "planned");
      entry = repository.updateEntryState(entry.id, "planned");
    }

    if (temporaryInfo === undefined && !matchesExpected(destinationInspection, expectedHash, item.byteLength)) {
      const collision = await chooseCollisionPath(
        repository,
        root,
        entry,
        destinationRelativePath,
        expectedHash,
        item.byteLength,
        fileSystem
      );
      if (collision.existing !== undefined && matchesExpected(collision.existing, expectedHash, item.byteLength)) {
        destinationInspection = collision.existing;
        destinationRelativePath = collision.relativePath;
        if (destinationRelativePath !== operation.relativePath) {
          operation = repository.updateOperationPath(operation.id, destinationRelativePath);
          entry = repository.updateEntryPath(entry.id, destinationRelativePath, "planned");
        }
        operation = repository.updateOperationState(operation.id, "verified");
        operation = repository.updateOperationState(operation.id, "committed");
        repository.updateEntryState(entry.id, "committed");
        return { artifactId: item.artifactId, entryId, operationId, relativePath: destinationRelativePath, state: "committed" };
      }
      if (repository.getSettings().collisionPolicy === "skip" && collision.occupied) {
        operation = repository.updateOperationState(operation.id, "reconciled", {
          code: "COLLISION_SKIPPED",
          message: `Live Output left the existing destination untouched: ${destinationRelativePath}`
        });
        repository.updateEntryState(entry.id, "reconciled");
        return { artifactId: item.artifactId, entryId, operationId, relativePath: destinationRelativePath, state: "reconciled" };
      }
      if (collision.relativePath !== destinationRelativePath) {
        destinationRelativePath = collision.relativePath;
        operation = repository.updateOperationPath(operation.id, destinationRelativePath);
        entry = repository.updateEntryPath(entry.id, destinationRelativePath, "planned");
        destination = resolveLiveOutputPath(root, destinationRelativePath);
      }
    }

    const staged = await stageTemp(
      root,
      destination,
      operation,
      bytes,
      expectedHash,
      item.byteLength,
      priorRoot,
      sourcePath,
      previousExpectedHash,
      fileSystem
    );
    operation = repository.updateOperationState(operation.id, "staged");
    await options.checkpoint?.("staged", operation);

    const stagedInspection = await inspectFile(staged.temporaryPath, fileSystem);
    if (!matchesExpected(stagedInspection, expectedHash, item.byteLength)) {
      throw new LiveOutputError("STAGING_VERIFY_FAILED", "Live Output temporary sibling failed verification.");
    }
    operation = repository.updateOperationState(operation.id, "verified");
    await options.checkpoint?.("verified", operation);
    await publishNoClobber(staged.temporaryPath, destination, expectedHash, item.byteLength, fileSystem);
    const published = await inspectFile(destination, fileSystem);
    if (!matchesExpected(published, expectedHash, item.byteLength)) {
      throw new LiveOutputError("PUBLICATION_VERIFY_FAILED", "Live Output destination failed post-rename verification.");
    }
    operation = repository.updateOperationState(operation.id, "committed");
    repository.updateEntryState(entry.id, "committed");
    await options.checkpoint?.("committed", operation);

    let priorMirror: PriorMirrorResult = { removed: false };
    if (repository.getSettings().transferPolicy === "move" && sourcePath !== null) {
      priorMirror = await removeOwnedPriorMirror(
        priorRoot ?? root,
        sourcePath,
        previousExpectedHash,
        root,
        destinationRelativePath,
        fileSystem
      );
    }
    if (priorMirror.reason !== undefined && priorMirror.reason !== "prior-mirror-missing") {
      operation = repository.updateOperationState(operation.id, "committed", {
        code: "PRIOR_MIRROR_NOT_REMOVED",
        message: priorMirror.reason
      });
    }
    return { artifactId: item.artifactId, entryId, operationId, relativePath: destinationRelativePath, state: "committed" };
  } catch (error) {
    if (operation !== undefined) {
      try {
        repository.failOperation(operation.id, error);
      } catch {
        // The original filesystem failure remains the actionable error.
      }
    }
    if (entry !== undefined) {
      try {
        repository.updateEntryState(entry.id, "failed");
      } catch {
        // The operation journal is the recovery authority when this update fails.
      }
    }
    if (error instanceof LiveOutputError) throw error;
    throw new LiveOutputError(
      errorCode(error) ?? "MATERIALIZE_FAILED",
      error instanceof Error ? error.message : String(error),
      { cause: error }
    );
  }
}

export async function materializeLiveOutput(
  repository: LiveOutputRepository,
  options: MaterializeLiveOutputOptions
): Promise<MaterializeLiveOutputResult> {
  const settings = repository.getSettings();
  if (!settings.enabled) return { disabled: true, items: [] };
  const fileSystem = options.fileSystem ?? nodeLiveOutputFileSystem;
  const current = await assertLiveOutputGrantUsable(repository, options.grant, fileSystem, options.grantValidator);
  const priorRoot = options.previousGrant === undefined
    ? undefined
    : await realPriorRoot(repository, options.previousGrant, fileSystem);
  const results: MaterializedLiveOutputItem[] = [];
  for (const item of options.items) {
    results.push(await materializeOne(repository, item, options, current.root, priorRoot, fileSystem));
  }
  return { disabled: false, items: results };
}

export interface RebuildLiveOutputOptions extends Omit<MaterializeLiveOutputOptions, "items" | "operationKind"> {
  operationKind?: "rebuild";
}

export async function rebuildLiveOutput(
  repository: LiveOutputRepository,
  options: RebuildLiveOutputOptions
): Promise<MaterializeLiveOutputResult> {
  const entries = repository.listEntries();
  const items: LiveOutputMaterializationItem[] = [];
  for (const entry of entries) {
    const source = repository.getArtifactSource(entry.artifactId);
    if (source === undefined) {
      throw new LiveOutputError(
        "EMBEDDED_SOURCE_MISSING",
        `Live Output cannot rebuild artifact ${entry.artifactId} because its embedded original is missing.`
      );
    }
    items.push({
      artifactId: entry.artifactId,
      byteLength: source.byteLength,
      collectionId: entry.collectionId,
      contentKey: source.contentKey,
      expectedHash: source.contentKey,
      relativePath: entry.relativePath
    });
  }
  return materializeLiveOutput(repository, {
    ...options,
    items,
    operationKind: "rebuild"
  });
}

export const materialize = materializeLiveOutput;
export const rebuild = rebuildLiveOutput;

export function liveOutputFailureDetails(error: unknown): Record<string, string> {
  const details = liveOutputErrorObject(error);
  return {
    code: typeof details.code === "string" ? details.code : "LIVE_OUTPUT_FAILED",
    message: typeof details.message === "string" ? details.message : String(error)
  };
}
