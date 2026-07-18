import {
  EtherGraphSchema,
  firstTemporaryIdentityReference,
  graphIdentityReferences,
  type EtherGraph,
  type PreparedGraphCommit
} from "@ether/schema";
import { randomUUID } from "node:crypto";
import {
  closeSync,
  fsyncSync,
  lstatSync,
  openSync,
  statSync,
  unlinkSync
} from "node:fs";
import path from "node:path";
import { backup, type DatabaseSync } from "node:sqlite";

import {
  createInitializedEtherDocument,
  createOwnedReplacementRollback,
  openEtherDocumentConnection,
  publishOwnedTemporaryDatabase,
  removeOwnedReplacementRollback,
  restoreOwnedReplacementRollback,
  replaceWithOwnedTemporaryDatabase
} from "./database.js";
import type { OwnedReplacementRollback } from "./database.js";
import {
  type DocumentStoreEnvironment,
  type DocumentStoreRuntime,
  type ReferenceGrantFingerprintRequest,
  type ReferenceGrantPathRequest,
  type ReadOnlyReason,
  WriterLease,
  locationSupportsWriting,
  resolveDocumentStoreEnvironment
} from "./locking.js";
import {
  beginReplacementRecovery,
  completeReplacementRecovery,
  markReplacementPublished,
  plannedReplacementRollback,
  reconcileReplacementRecovery,
  recordReplacementRollback,
  type ReplacementRecoveryJournal
} from "./recovery.js";
import { reconcileStaging } from "./recovery/reconcileStaging.js";
import { createRepositoryContext, GraphRepository } from "./repositories/graphs.js";
import { ArtifactRepository } from "./repositories/artifacts.js";
import { BlobRepository } from "./repositories/blobs.js";
import { OutputRepository } from "./repositories/outputs.js";
import { ExecutionRepository } from "./repositories/execution.js";
import { ReferenceRepository } from "./repositories/references.js";
import {
  type CommitResult,
  DocumentRepositoryError,
  RevisionRepository
} from "./repositories/revisions.js";
import { SettingsRepository } from "./repositories/settings.js";
import {
  EtherDocumentError,
  readEtherFileIdentity,
  validateEtherDocumentConnection,
  type EtherFileIdentity
} from "./validation.js";

export type DocumentAccessMode = "prefer-write" | "read-only" | "require-write";
export type DocumentStoreMode =
  | { kind: "writable" }
  | { kind: "read-only"; reason: ReadOnlyReason };

export interface CreateDocumentStoreOptions {
  appVersion: string;
  documentId?: string;
  environment?: DocumentStoreEnvironment;
  featureFlags?: Record<string, boolean>;
  initialGraph: EtherGraph;
  title: string;
}

export interface OpenDocumentStoreOptions {
  access: DocumentAccessMode;
  deferRecovery?: boolean;
  environment?: DocumentStoreEnvironment;
}

export interface ReadDocumentRepositories {
  artifacts: Pick<ArtifactRepository, "get" | "list">;
  blobs: Pick<BlobRepository, "get" | "list">;
  graphs: Pick<GraphRepository, "get" | "list">;
  outputs: Pick<OutputRepository, "getPayload" | "getVersion" | "listByNode">;
  execution: Pick<
    ExecutionRepository,
    | "getCommandResult"
    | "getJob"
    | "getLineage"
    | "getPlan"
    | "listAttempts"
    | "listPendingEvents"
    | "listWorkItems"
  >;
  revisions: Pick<
    RevisionRepository,
    | "canRedo"
    | "canUndo"
    | "getDocumentRevision"
    | "getOperations"
    | "head"
    | "listMilestones"
  >;
  settings: Pick<SettingsRepository, "getHeader" | "getLiveOutput">;
  references: Pick<ReferenceRepository, "get" | "list">;
}

type WriteExecutionRepository = Pick<
  ExecutionRepository,
  | "acceptProviderOutput"
  | "cancelJob"
  | "claimNext"
  | "completeCommand"
  | "discardProviderCompletion"
  | "failAttempt"
  | "getCommandResult"
  | "getJob"
  | "getLineage"
  | "getPlan"
  | "grantRunPermit"
  | "getProviderCompletion"
  | "listAttempts"
  | "listPendingEvents"
  | "listWorkItems"
  | "markEventDelivered"
  | "recoverProcessLost"
  | "retryFailed"
  | "prepareProviderCompletion"
  | "quarantineForeignDocumentPlans"
  | "savePlan"
  | "stageProviderCompletion"
  | "startJob"
>;

export interface DocumentRepositories extends ReadDocumentRepositories {
  artifacts: Pick<ArtifactRepository, "attach" | "get" | "list">;
  blobs: Pick<BlobRepository, "get" | "list">;
  outputs: Pick<OutputRepository, "getPayload" | "getVersion" | "insert" | "listByNode">;
  execution: WriteExecutionRepository;
  revisions: Pick<
    RevisionRepository,
    | "canRedo"
    | "canUndo"
    | "commit"
    | "createMilestone"
    | "getDocumentRevision"
    | "getOperations"
    | "head"
    | "listMilestones"
    | "redo"
    | "undo"
  >;
  settings: Pick<
    SettingsRepository,
    "getHeader" | "getLiveOutput" | "setFeatureFlag" | "setLiveOutput" | "setTitle"
  >;
  references: Pick<ReferenceRepository, "get" | "list" | "remove">;
}

interface InternalDocumentRepositories {
  artifacts: ArtifactRepository;
  blobs: BlobRepository;
  graphs: GraphRepository;
  outputs: OutputRepository;
  execution: ExecutionRepository;
  revisions: RevisionRepository;
  settings: SettingsRepository;
  references: ReferenceRepository;
}

export const DOCUMENT_STORE_INTERNAL = Symbol("ether.document-store.internal");
export const DOCUMENT_STORE_RECOVERY_OPEN = Symbol("ether.document-store.recovery-open");

export type InternalDocumentStoreMode = "read" | "write";
export type InternalDocumentStoreCallback<T> = (
  repositories: InternalDocumentRepositories
) => T;

interface RepositoryScope<T> {
  close(): void;
  repositories: T;
}

export class DocumentStoreError extends Error {
  readonly code: string;
  readonly reason?: ReadOnlyReason;

  constructor(code: string, message: string, reason?: ReadOnlyReason, options?: ErrorOptions) {
    super(message, options);
    this.name = "DocumentStoreError";
    this.code = code;
    this.reason = reason;
  }
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    "then" in value &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

function readPersistedDirtyState(database: DatabaseSync): boolean {
  const ownsTransaction = !database.isTransaction;
  if (ownsTransaction) database.exec("BEGIN DEFERRED");
  try {
    const row = database
      .prepare("SELECT dirty FROM document_state WHERE singleton = 1")
      .get() as { dirty: number } | undefined;
    if (row === undefined || (row.dirty !== 0 && row.dirty !== 1)) {
      throw new DocumentStoreError(
        "MISSING_DOCUMENT_STATE",
        "Document dirty state is missing or invalid."
      );
    }
    if (ownsTransaction) database.exec("COMMIT");
    return row.dirty === 1;
  } catch (error) {
    if (ownsTransaction) {
      try {
        database.exec("ROLLBACK");
      } catch {
        // Preserve the state read error.
      }
    }
    throw error;
  }
}

function sqliteProbe(database: DatabaseSync): void {
  database.exec("BEGIN IMMEDIATE");
  database.exec("ROLLBACK");
}

function sameIdentity(left: EtherFileIdentity, right: EtherFileIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.birthtimeNs === right.birthtimeNs;
}

function removeOwnedFile(filePath: string, identity: EtherFileIdentity | undefined): void {
  if (identity === undefined) {
    return;
  }
  try {
    if (sameIdentity(readEtherFileIdentity(filePath), identity)) {
      unlinkSync(filePath);
    }
  } catch {
    // Cleanup is restricted to a staging path whose identity is still owned.
  }
}

function prepareDestination(destinationPath: string, allowExisting: boolean): boolean {
  if (path.extname(destinationPath).toLowerCase() !== ".ether") {
    throw new EtherDocumentError("INVALID_DESTINATION", "Ether destinations must end in .ether.");
  }
  const exists = lstatSync(destinationPath, { throwIfNoEntry: false }) !== undefined;
  if (exists && !allowExisting) {
    throw new EtherDocumentError(
      "DESTINATION_EXISTS",
      `Ether document destination already exists: ${destinationPath}`
    );
  }
  if (!statSync(path.dirname(destinationPath)).isDirectory()) {
    throw new EtherDocumentError("INVALID_DESTINATION", "Ether destination directory is invalid.");
  }
  return exists;
}

export class DocumentStore {
  private database: DatabaseSync;
  private runtime: DocumentStoreRuntime;
  private writerLease: WriterLease | undefined;
  private operationQueue: Promise<void> = Promise.resolve();
  private closePromise: Promise<void> | undefined;
  private closed = false;
  private currentDocumentId: string;
  private currentDirty: boolean;
  private currentMode: DocumentStoreMode;
  private currentPath: string;
  private stagingRecovered: boolean;

  private constructor(options: {
    database: DatabaseSync;
    documentId: string;
    lease?: WriterLease;
    mode: DocumentStoreMode;
    path: string;
    runtime: DocumentStoreRuntime;
    stagingRecovered?: boolean;
  }) {
    this.database = options.database;
    this.currentDirty = readPersistedDirtyState(options.database);
    this.currentDocumentId = options.documentId;
    this.writerLease = options.lease;
    this.currentMode = options.mode;
    this.currentPath = options.path;
    this.runtime = options.runtime;
    this.stagingRecovered = options.stagingRecovered ?? true;
    this.startHeartbeat();
  }

  static async create(
    filePath: string,
    options: CreateDocumentStoreOptions
  ): Promise<DocumentStore> {
    const temporaryReference = firstTemporaryIdentityReference(
      graphIdentityReferences(options.initialGraph)
    );
    if (temporaryReference !== null) {
      throw new DocumentStoreError(
        "UNRESOLVED_TEMP_ID",
        `Initial graph contains an unresolved temporary ID at ${temporaryReference.path.join(".")}: ${temporaryReference.value}.`
      );
    }
    const initialGraph = EtherGraphSchema.parse(options.initialGraph);
    if (initialGraph.kind !== "root") {
      throw new DocumentStoreError("INVALID_INITIAL_GRAPH", "New Ether documents require a root graph.");
    }
    const absolutePath = path.resolve(filePath);
    const documentId = options.documentId ?? randomUUID();
    const runtime = resolveDocumentStoreEnvironment(options.environment);
    createInitializedEtherDocument(
      absolutePath,
      {
        appVersion: options.appVersion,
        documentId,
        featureFlags: options.featureFlags,
        title: options.title
      },
      (database) => {
        runtime.onCreateStage?.("format-initialized");
        const context = createRepositoryContext(database);
        const graphs = new GraphRepository(context);
        const revisions = new RevisionRepository(context, graphs);
        revisions.initializeGenesis(initialGraph);
        const head = revisions.head();
        const genesis = revisions.getDocumentRevision(head.documentRevisionId);
        if (
          head.graphRevisions[initialGraph.id] === undefined ||
          genesis.kind !== "genesis" ||
          JSON.stringify(genesis.graphRevisions) !== JSON.stringify(head.graphRevisions) ||
          JSON.stringify(graphs.get(initialGraph.id)) !== JSON.stringify(initialGraph)
        ) {
          throw new DocumentStoreError(
            "INVALID_GENESIS",
            "New Ether document genesis state did not validate before publication."
          );
        }
        runtime.onCreateStage?.("genesis-initialized");
      }
    );
    const createdIdentity = readEtherFileIdentity(absolutePath);
    let store: DocumentStore | undefined;
    try {
      store = await DocumentStore.open(absolutePath, {
        access: "require-write",
        environment: options.environment
      });
      return store;
    } catch (error) {
      await store?.close();
      removeOwnedFile(absolutePath, createdIdentity);
      throw error;
    }
  }

  static async open(filePath: string, options: OpenDocumentStoreOptions): Promise<DocumentStore> {
    const absolutePath = path.resolve(filePath);
    const runtime = resolveDocumentStoreEnvironment(options.environment);
    await reconcileReplacementRecovery(absolutePath, runtime.recoveryRoot);
    if (options.access === "read-only") {
      const connection = openEtherDocumentConnection(absolutePath, true);
      return new DocumentStore({
        database: connection.database,
        documentId: connection.inspection.document.documentId,
        mode: { kind: "read-only", reason: "requested" },
        path: absolutePath,
        runtime
      });
    }
    if (!await locationSupportsWriting(absolutePath, runtime)) {
      if (options.access === "require-write") {
        throw new DocumentStoreError(
          "WRITER_LEASE_UNAVAILABLE",
          "This document location is not approved for writable Ether semantics.",
          "location-unsupported"
        );
      }
      const connection = openEtherDocumentConnection(absolutePath, true);
      return new DocumentStore({
        database: connection.database,
        documentId: connection.inspection.document.documentId,
        mode: { kind: "read-only", reason: "location-unsupported" },
        path: absolutePath,
        runtime
      });
    }

    const connection = openEtherDocumentConnection(absolutePath, false);
    const acquisition = WriterLease.acquire(
      absolutePath,
      connection.inspection.document.documentId,
      runtime,
      () => sqliteProbe(connection.database)
    );
    if (acquisition.lease === undefined) {
      connection.database.close();
      const reason = acquisition.reason ?? "writer-active";
      if (options.access === "require-write") {
        throw new DocumentStoreError(
          "WRITER_LEASE_UNAVAILABLE",
          "Another writer owns this Ether document.",
          reason
        );
      }
      const readOnly = openEtherDocumentConnection(absolutePath, true);
      return new DocumentStore({
        database: readOnly.database,
        documentId: readOnly.inspection.document.documentId,
        mode: { kind: "read-only", reason },
        path: absolutePath,
        runtime
      });
    }
    const store = new DocumentStore({
      database: connection.database,
      documentId: connection.inspection.document.documentId,
      lease: acquisition.lease,
      mode: { kind: "writable" },
      path: absolutePath,
      runtime,
      stagingRecovered: options.deferRecovery !== true
    });
    try {
      if (options.deferRecovery !== true) {
        await reconcileStaging(store, { appDataRoot: path.dirname(runtime.recoveryRoot) });
      }
      return store;
    } catch (error) {
      await store.close();
      throw error;
    }
  }

  static async [DOCUMENT_STORE_RECOVERY_OPEN](
    filePath: string,
    environment?: DocumentStoreEnvironment
  ): Promise<DocumentStore> {
    const absolutePath = path.resolve(filePath);
    const runtime = resolveDocumentStoreEnvironment(environment);
    const connection = openEtherDocumentConnection(absolutePath, true, {
      allowDerivedIndexMismatch: true
    });
    return new DocumentStore({
      database: connection.database,
      documentId: connection.inspection.document.documentId,
      mode: { kind: "read-only", reason: "requested" },
      path: absolutePath,
      runtime
    });
  }

  get dirty(): boolean {
    return this.currentDirty;
  }

  get documentId(): string {
    return this.currentDocumentId;
  }

  get mode(): DocumentStoreMode {
    return this.currentMode;
  }

  get path(): string {
    return this.currentPath;
  }

  async activateRecovery(): Promise<void> {
    this.assertOpen();
    if (this.stagingRecovered || this.currentMode.kind !== "writable") return;
    await reconcileStaging(this, { appDataRoot: path.dirname(this.runtime.recoveryRoot) });
    this.stagingRecovered = true;
  }

  authorizeReferencePath(request: Omit<ReferenceGrantPathRequest, "documentId">): void {
    let authorized: boolean;
    try {
      authorized = this.runtime.referenceGrantAuthority.authorizePath({
        ...request,
        documentId: this.documentId
      });
    } catch {
      authorized = false;
    }
    if (!authorized) this.throwReferenceGrantDenied();
  }

  validateReferenceFingerprint(
    request: Omit<ReferenceGrantFingerprintRequest, "documentId">
  ): void {
    let authorized: boolean;
    try {
      authorized = this.runtime.referenceGrantAuthority.validateFingerprint({
        ...request,
        documentId: this.documentId
      });
    } catch {
      authorized = false;
    }
    if (!authorized) this.throwReferenceGrantDenied();
  }

  revokeReferenceGrantAuthority(grantId: string): void {
    this.runtime.referenceGrantAuthority.revoke?.(grantId, this.documentId);
  }

  private throwReferenceGrantDenied(): never {
    throw new DocumentStoreError(
      "REFERENCE_GRANT_DENIED",
      "The reference path grant is missing, revoked, or bound to different content."
    );
  }

  [DOCUMENT_STORE_INTERNAL]<T>(
    mode: InternalDocumentStoreMode,
    callback: InternalDocumentStoreCallback<T>
  ): Promise<T> {
    return this.enqueue(() =>
      mode === "write" ? this.runInternalTransaction(callback) : this.runInternalRead(callback)
    );
  }

  read<T>(callback: (repositories: ReadDocumentRepositories) => T): Promise<T> {
    return this.enqueue(() => {
      this.assertOpen();
      const ownsTransaction = !this.database.isTransaction;
      if (ownsTransaction) {
        this.database.exec("BEGIN DEFERRED");
      }
      const scope = this.readRepositories();
      try {
        const result = callback(scope.repositories);
        if (isPromiseLike(result)) {
          throw new DocumentStoreError(
            "ASYNC_TRANSACTION_CALLBACK",
            "Document repository callbacks must complete synchronously."
          );
        }
        if (ownsTransaction) {
          this.database.exec("COMMIT");
        }
        return result;
      } catch (error) {
        if (ownsTransaction) {
          try {
            this.database.exec("ROLLBACK");
          } catch {
            // Preserve the read or commit error that ended this snapshot.
          }
        }
        throw error;
      } finally {
        scope.close();
      }
    });
  }

  transaction<T>(callback: (repositories: DocumentRepositories) => T): Promise<T> {
    return this.enqueue(() => this.runTransaction(callback));
  }

  manualSave(name: string): Promise<{ id: string; members: Record<string, string> }> {
    return this.transaction(({ revisions }) => revisions.createMilestone(name, "manual"));
  }

  autosave(commit: PreparedGraphCommit): Promise<{
    commit: CommitResult;
    milestone: { id: string; members: Record<string, string> };
  }> {
    return this.transaction(({ revisions }) => {
      const result = revisions.commit(commit);
      const milestone = revisions.createMilestone("Autosave", "autosave");
      return { commit: result, milestone };
    });
  }

  rebuildDerivedIndexes(): Promise<void> {
    return this.transaction(() => {
      this.database.exec("REINDEX");
      this.database.exec(`
        DELETE FROM prompt_output_fts;
        DELETE FROM artifact_fts;
        DELETE FROM tag_fts;
        DELETE FROM run_fts;
        DELETE FROM metadata_fts;
        INSERT INTO prompt_output_fts (source_type, source_id, title, body, metadata)
          SELECT 'prompt', node_id, title, config_json, presentation_json FROM nodes;
        INSERT INTO prompt_output_fts (source_type, source_id, title, body, metadata)
          SELECT 'output', payload_id, channel || ':' || role,
                 coalesce(content_text, content_json), metadata_json
          FROM node_output_payloads;
        INSERT INTO artifact_fts (artifact_id, title, description, metadata)
          SELECT artifact_id, title, description, metadata_json FROM artifacts;
        INSERT INTO tag_fts (artifact_id, tag)
          SELECT artifact_id, tag FROM artifact_tags;
        INSERT INTO run_fts (provider_run_id, provider_id, model_id, request, response, metadata)
          SELECT provider_run_id, provider_id, model_id, request_json,
                 coalesce(response_json, ''), metadata_json FROM provider_runs;
        INSERT INTO metadata_fts (entity_type, entity_id, metadata)
          SELECT 'document', document_id, title || ' ' || feature_flags_json FROM document;
        INSERT INTO metadata_fts (entity_type, entity_id, metadata)
          SELECT 'artifact', artifact_id, metadata_json FROM artifacts;
      `);
    });
  }

  reclaimUnusedPages(): Promise<void> {
    return this.enqueue(() => {
      this.assertOpen();
      if (this.currentMode.kind !== "writable") return;
      this.database.exec("PRAGMA incremental_vacuum(1000000)");
    });
  }

  reclaimUnreferencedReadyBlobs(contentKeys: readonly string[]): Promise<number> {
    return this.enqueue(() => this.runInternalTransaction(({ blobs }) => {
      let removed = 0;
      for (const contentKey of new Set(contentKeys)) {
        if (blobs.removeReadyIfUnreferenced(contentKey)) removed += 1;
      }
      return removed;
    }));
  }

  saveCopy(destinationPath: string): Promise<{ documentId: string; path: string }> {
    return this.enqueue(() => this.saveBackup(destinationPath, false));
  }

  saveAs(destinationPath: string): Promise<void> {
    return this.enqueue(async () => {
      await this.saveBackup(destinationPath, true);
    });
  }

  compact(): Promise<{ beforeBytes: number; afterBytes: number }> {
    return this.enqueue(() => this.compactActiveDocument());
  }

  private async compactActiveDocument(): Promise<{ beforeBytes: number; afterBytes: number }> {
    this.assertOpen();
    if (this.currentMode.kind !== "writable") {
      throw new DocumentStoreError("READ_ONLY", "This Ether document is open read-only.");
    }
    const beforeBytes = statSync(this.currentPath).size;
    const temporaryPath = path.join(
      path.dirname(this.currentPath),
      `.${path.basename(this.currentPath)}.ether-compact-${randomUUID()}`
    );
    let temporaryIdentity: EtherFileIdentity | undefined;
    let rollback: OwnedReplacementRollback | undefined;
    let recovery: ReplacementRecoveryJournal | undefined;
    let connectionOpen = true;
    try {
      this.database.prepare("VACUUM INTO ?").run(temporaryPath);
      temporaryIdentity = readEtherFileIdentity(temporaryPath);
      this.runtime.onCompactStage?.("vacuum");

      const staged = openEtherDocumentConnection(temporaryPath, false);
      try {
        if (staged.inspection.document.documentId !== this.currentDocumentId) {
          throw new DocumentStoreError(
            "INVALID_COMPACT",
            "Compacted document identity differs from the active document."
          );
        }
        validateEtherDocumentConnection(staged.database, temporaryPath);
      } finally {
        staged.database.close();
      }
      this.runtime.onCompactStage?.("validation");

      const descriptor = openSync(temporaryPath, "r+");
      try {
        fsyncSync(descriptor);
      } finally {
        closeSync(descriptor);
      }
      this.runtime.onCompactStage?.("fsync");

      this.database.close();
      connectionOpen = false;
      recovery = beginReplacementRecovery(this.runtime.recoveryRoot, {
        destinationPath: this.currentPath,
        newDocumentId: this.currentDocumentId,
        previousDocumentId: this.currentDocumentId,
        staging: { identity: temporaryIdentity, path: temporaryPath },
        sourceDocumentId: this.currentDocumentId,
        sourcePath: this.currentPath
      });
      this.runtime.onCompactStage?.("rollback-planned");
      rollback = createOwnedReplacementRollback(this.currentPath, plannedReplacementRollback(recovery));
      this.runtime.onCompactStage?.("rollback-linked");
      await recordReplacementRollback(recovery, rollback, {
        afterHashChunk: () => this.runtime.onCompactStage?.("rollback-hash-chunk"),
        beforeJournalRename: () => this.runtime.onCompactStage?.("rollback-journal-before-rename"),
        afterJournalRename: () => this.runtime.onCompactStage?.("rollback-journal-after-rename")
      });
      this.runtime.onCompactStage?.("rollback-created");

      replaceWithOwnedTemporaryDatabase(temporaryPath, this.currentPath, temporaryIdentity);
      temporaryIdentity = undefined;
      markReplacementPublished(recovery);
      this.runtime.onCompactStage?.("publication");
      this.runtime.onCompactStage?.("post-publication");

      const replacement = openEtherDocumentConnection(this.currentPath, false);
      this.database = replacement.database;
      connectionOpen = true;
      this.currentDirty = readPersistedDirtyState(this.database);
      removeOwnedReplacementRollback(rollback);
      rollback = undefined;
      completeReplacementRecovery(recovery);
      recovery = undefined;
      return { beforeBytes, afterBytes: statSync(this.currentPath).size };
    } catch (error) {
      if (connectionOpen) {
        try {
          this.database.close();
        } catch {
          // The original failure remains authoritative.
        }
      }
      removeOwnedFile(temporaryPath, temporaryIdentity);
      let restorationError: unknown;
      if (rollback !== undefined) {
        try {
          restoreOwnedReplacementRollback(rollback, this.currentPath);
          rollback = undefined;
          if (recovery !== undefined) {
            completeReplacementRecovery(recovery);
            recovery = undefined;
          }
        } catch (candidate) {
          restorationError = candidate;
        }
      } else if (recovery !== undefined) {
        try {
          completeReplacementRecovery(recovery);
          recovery = undefined;
        } catch {
          // Reconciliation can safely remove a prepared journal on the next open.
        }
      }
      try {
        const original = openEtherDocumentConnection(this.currentPath, false);
        this.database = original.database;
        connectionOpen = true;
        this.currentDirty = readPersistedDirtyState(this.database);
      } catch (reopenError) {
        if (restorationError === undefined) restorationError = reopenError;
      }
      if (restorationError !== undefined) {
        throw new DocumentStoreError(
          "COMPACT_ROLLBACK_FAILED",
          "Compact failed and the original Ether document could not be restored.",
          undefined,
          { cause: restorationError }
        );
      }
      throw error;
    }
  }

  close(): Promise<void> {
    if (this.closePromise !== undefined) {
      return this.closePromise;
    }
    this.closePromise = this.enqueue(async () => {
      if (this.closed) {
        return;
      }
      this.closed = true;
      const lease = this.writerLease;
      this.writerLease = undefined;
      try {
        await lease?.release();
      } finally {
        this.database.close();
      }
    });
    return this.closePromise;
  }

  private internalRepositories(): InternalDocumentRepositories {
    const context = createRepositoryContext(this.database);
    const graphs = new GraphRepository(context);
    return {
      artifacts: new ArtifactRepository(context),
      blobs: new BlobRepository(context),
      graphs,
      outputs: new OutputRepository(context),
      execution: new ExecutionRepository(context),
      revisions: new RevisionRepository(context, graphs),
      settings: new SettingsRepository(context),
      references: new ReferenceRepository(context)
    };
  }

  private readRepositories(): RepositoryScope<ReadDocumentRepositories> {
    const repositories = this.internalRepositories();
    let active = true;
    const invoke = <T>(operation: () => T): T => {
      if (!active) {
        throw new DocumentStoreError(
          "TRANSACTION_CONTEXT_CLOSED",
          "This document repository context is no longer active."
        );
      }
      return operation();
    };
    return {
      close: () => {
        active = false;
      },
      repositories: {
        artifacts: {
          get: (id) => invoke(() => repositories.artifacts.get(id)),
          list: () => invoke(() => repositories.artifacts.list())
        },
        blobs: {
          get: (contentKey) => invoke(() => repositories.blobs.get(contentKey)),
          list: () => invoke(() => repositories.blobs.list())
        },
        graphs: {
          get: (graphId) => invoke(() => repositories.graphs.get(graphId)),
          list: () => invoke(() => repositories.graphs.list())
        },
        outputs: {
          getPayload: (id) => invoke(() => repositories.outputs.getPayload(id)),
          getVersion: (id) => invoke(() => repositories.outputs.getVersion(id)),
          listByNode: (id) => invoke(() => repositories.outputs.listByNode(id))
        },
        execution: {
          getCommandResult: (id, name) => invoke(() => repositories.execution.getCommandResult(id, name)),
          getJob: (id) => invoke(() => repositories.execution.getJob(id)),
          getLineage: (id) => invoke(() => repositories.execution.getLineage(id)),
          getPlan: (id) => invoke(() => repositories.execution.getPlan(id)),
          listAttempts: (id) => invoke(() => repositories.execution.listAttempts(id)),
          listPendingEvents: () => invoke(() => repositories.execution.listPendingEvents()),
          listWorkItems: (id) => invoke(() => repositories.execution.listWorkItems(id))
        },
        revisions: {
          canRedo: () => invoke(() => repositories.revisions.canRedo()),
          canUndo: () => invoke(() => repositories.revisions.canUndo()),
          getDocumentRevision: (id) =>
            invoke(() => repositories.revisions.getDocumentRevision(id)),
          getOperations: (id) => invoke(() => repositories.revisions.getOperations(id)),
          head: () => invoke(() => repositories.revisions.head()),
          listMilestones: () => invoke(() => repositories.revisions.listMilestones())
        },
        settings: {
          getHeader: () => invoke(() => repositories.settings.getHeader()),
          getLiveOutput: () => invoke(() => repositories.settings.getLiveOutput())
        },
        references: {
          get: (id) => invoke(() => repositories.references.get(id)),
          list: () => invoke(() => repositories.references.list())
        }
      }
    };
  }

  private writeRepositories(): RepositoryScope<DocumentRepositories> {
    const repositories = this.internalRepositories();
    let active = true;
    const invoke = <T>(operation: () => T): T => {
      if (!active) {
        throw new DocumentStoreError(
          "TRANSACTION_CONTEXT_CLOSED",
          "This document repository context is no longer active."
        );
      }
      return operation();
    };
    const facade: DocumentRepositories = {
      artifacts: {
        get: (id) => invoke(() => repositories.artifacts.get(id)),
        list: () => invoke(() => repositories.artifacts.list()),
        attach: (artifact) => invoke(() => repositories.artifacts.attach(artifact))
      },
      blobs: {
        get: (contentKey) => invoke(() => repositories.blobs.get(contentKey)),
        list: () => invoke(() => repositories.blobs.list())
      },
      graphs: {
        get: (graphId) => invoke(() => repositories.graphs.get(graphId)),
        list: () => invoke(() => repositories.graphs.list())
      },
      outputs: {
        getPayload: (id) => invoke(() => repositories.outputs.getPayload(id)),
        getVersion: (id) => invoke(() => repositories.outputs.getVersion(id)),
        insert: (version, payloads) => invoke(() => repositories.outputs.insert(version, payloads)),
        listByNode: (id) => invoke(() => repositories.outputs.listByNode(id))
      },
      execution: {
        acceptProviderOutput: (input) => invoke(() => repositories.execution.acceptProviderOutput(input)),
        cancelJob: (id, commandId) => invoke(() => repositories.execution.cancelJob(id, commandId)),
        claimNext: (id, token) => invoke(() => repositories.execution.claimNext(id, token)),
        completeCommand: (id, name, result, events) =>
          invoke(() => repositories.execution.completeCommand(id, name, result, events)),
        discardProviderCompletion: (id) =>
          invoke(() => repositories.execution.discardProviderCompletion(id)),
        failAttempt: (id, code, message, retryable) =>
          invoke(() => repositories.execution.failAttempt(id, code, message, retryable)),
        getCommandResult: (id, name) => invoke(() => repositories.execution.getCommandResult(id, name)),
        getJob: (id) => invoke(() => repositories.execution.getJob(id)),
        getLineage: (id) => invoke(() => repositories.execution.getLineage(id)),
        getPlan: (id) => invoke(() => repositories.execution.getPlan(id)),
        getProviderCompletion: (id) => invoke(() => repositories.execution.getProviderCompletion(id)),
        grantRunPermit: (id, hash, commandId) =>
          invoke(() => repositories.execution.grantRunPermit(id, hash, commandId)),
        listAttempts: (id) => invoke(() => repositories.execution.listAttempts(id)),
        listPendingEvents: () => invoke(() => repositories.execution.listPendingEvents()),
        listWorkItems: (id) => invoke(() => repositories.execution.listWorkItems(id)),
        markEventDelivered: (id) => invoke(() => repositories.execution.markEventDelivered(id)),
        recoverProcessLost: () => invoke(() => repositories.execution.recoverProcessLost()),
        retryFailed: (id, workItemIds, commandId) =>
          invoke(() => repositories.execution.retryFailed(id, workItemIds, commandId)),
        prepareProviderCompletion: (completion, stagingPath) =>
          invoke(() => repositories.execution.prepareProviderCompletion(completion, stagingPath)),
        quarantineForeignDocumentPlans: () =>
          invoke(() => repositories.execution.quarantineForeignDocumentPlans()),
        savePlan: (plan) => invoke(() => repositories.execution.savePlan(plan)),
        stageProviderCompletion: (completion) =>
          invoke(() => repositories.execution.stageProviderCompletion(completion)),
        startJob: (input) => invoke(() => repositories.execution.startJob(input))
      },
      revisions: {
        canRedo: () => invoke(() => repositories.revisions.canRedo()),
        canUndo: () => invoke(() => repositories.revisions.canUndo()),
        commit: (commit) => invoke(() => repositories.revisions.commit(commit)),
        createMilestone: (name, kind) =>
          invoke(() => repositories.revisions.createMilestone(name, kind)),
        getDocumentRevision: (id) =>
          invoke(() => repositories.revisions.getDocumentRevision(id)),
        getOperations: (id) => invoke(() => repositories.revisions.getOperations(id)),
        head: () => invoke(() => repositories.revisions.head()),
        listMilestones: () => invoke(() => repositories.revisions.listMilestones()),
        redo: () => invoke(() => repositories.revisions.redo()),
        undo: () => invoke(() => repositories.revisions.undo())
      },
      settings: {
        getHeader: () => invoke(() => repositories.settings.getHeader()),
        getLiveOutput: () => invoke(() => repositories.settings.getLiveOutput()),
        setFeatureFlag: (name, enabled) =>
          invoke(() => repositories.settings.setFeatureFlag(name, enabled)),
        setLiveOutput: (settings) => invoke(() => repositories.settings.setLiveOutput(settings)),
        setTitle: (title) => invoke(() => repositories.settings.setTitle(title))
      },
      references: {
        get: (id) => invoke(() => repositories.references.get(id)),
        list: () => invoke(() => repositories.references.list()),
        remove: (id) => invoke(() => repositories.references.remove(id))
      }
    };
    return {
      close: () => {
        active = false;
      },
      repositories: facade
    };
  }

  private runTransaction<T>(callback: (repositories: DocumentRepositories) => T): T {
    this.assertOpen();
    if (this.currentMode.kind !== "writable") {
      throw new DocumentStoreError("READ_ONLY", "This Ether document is open read-only.");
    }
    this.database.exec("BEGIN IMMEDIATE");
    const scope = this.writeRepositories();
    try {
      const result = callback(scope.repositories);
      if (isPromiseLike(result)) {
        throw new DocumentStoreError(
          "ASYNC_TRANSACTION_CALLBACK",
          "Document repository callbacks must complete synchronously."
        );
      }
      const dirty = readPersistedDirtyState(this.database);
      this.database.exec("COMMIT");
      this.currentDirty = dirty;
      return result;
    } catch (error) {
      try {
        this.database.exec("ROLLBACK");
      } catch {
        // Preserve the operation error that caused the rollback.
      }
      throw error;
    } finally {
      scope.close();
    }
  }

  private runInternalRead<T>(callback: InternalDocumentStoreCallback<T>): T {
    this.assertOpen();
    const ownsTransaction = !this.database.isTransaction;
    if (ownsTransaction) this.database.exec("BEGIN DEFERRED");
    try {
      const result = callback(this.internalRepositories());
      if (isPromiseLike(result)) {
        throw new DocumentStoreError(
          "ASYNC_TRANSACTION_CALLBACK",
          "Internal repository callbacks must complete synchronously."
        );
      }
      if (ownsTransaction) this.database.exec("COMMIT");
      return result;
    } catch (error) {
      if (ownsTransaction) this.database.exec("ROLLBACK");
      throw error;
    }
  }

  private runInternalTransaction<T>(callback: InternalDocumentStoreCallback<T>): T {
    this.assertOpen();
    if (this.currentMode.kind !== "writable") {
      throw new DocumentStoreError("READ_ONLY", "This Ether document is open read-only.");
    }
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const result = callback(this.internalRepositories());
      if (isPromiseLike(result)) {
        throw new DocumentStoreError(
          "ASYNC_TRANSACTION_CALLBACK",
          "Internal repository callbacks must complete synchronously."
        );
      }
      const dirty = readPersistedDirtyState(this.database);
      this.database.exec("COMMIT");
      this.currentDirty = dirty;
      return result;
    } catch (error) {
      try {
        this.database.exec("ROLLBACK");
      } catch {
        // Preserve the internal operation error.
      }
      throw error;
    }
  }

  private enqueue<T>(operation: () => T | Promise<T>): Promise<T> {
    const result = this.operationQueue.then(operation, operation);
    this.operationQueue = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new DocumentStoreError("STORE_CLOSED", "This Ether document store is closed.");
    }
  }

  private startHeartbeat(): void {
    this.writerLease?.start(() => {
      void this.enqueue(() => this.transitionToReadOnly("heartbeat-failed"));
    });
  }

  private async transitionToReadOnly(reason: ReadOnlyReason): Promise<void> {
    if (this.closed || this.currentMode.kind === "read-only") {
      return;
    }
    const lease = this.writerLease;
    this.writerLease = undefined;
    try {
      await lease?.release();
    } catch {
      // The store still transitions read-only if lease cleanup cannot be confirmed.
    }
    this.database.close();
    const connection = openEtherDocumentConnection(this.currentPath, true);
    this.database = connection.database;
    this.currentDirty = readPersistedDirtyState(this.database);
    this.currentMode = { kind: "read-only", reason };
    this.runtime.onReadOnly?.(reason);
  }

  private async saveBackup(
    destinationPath: string,
    switchActive: boolean
  ): Promise<{ documentId: string; path: string }> {
    this.assertOpen();
    const absoluteDestination = path.resolve(destinationPath);
    const destinationExisted = prepareDestination(absoluteDestination, switchActive);
    if (switchActive && !await locationSupportsWriting(absoluteDestination, this.runtime)) {
      throw new DocumentStoreError(
        "WRITER_LEASE_UNAVAILABLE",
        "The Save As destination is not approved for writable Ether semantics.",
        "location-unsupported"
      );
    }
    const sourcePath = this.currentPath;
    const sourceDocumentId = this.currentDocumentId;
    const sourceMode = this.currentMode;
    const sourceWriterLease = this.writerLease;
    const temporaryPath = path.join(
      path.dirname(absoluteDestination),
      `.${path.basename(absoluteDestination)}.ether-save-${randomUUID()}`
    );
    let temporaryIdentity: EtherFileIdentity | undefined;
    let publishedIdentity: EtherFileIdentity | undefined;
    let replacementRollback: OwnedReplacementRollback | undefined;
    let replacementRecovery: ReplacementRecoveryJournal | undefined;
    let destinationLease: WriterLease | undefined;
    let existingDestinationDocumentId: string | undefined;
    let connectionOnSource = true;
    const nextDocumentId = randomUUID();

    try {
      this.runtime.onSaveStage?.("reservation");
      const descriptor = openSync(temporaryPath, "wx", 0o600);
      closeSync(descriptor);
      temporaryIdentity = readEtherFileIdentity(temporaryPath);

      this.runtime.onSaveStage?.("backup");
      await backup(this.database, temporaryPath);
      temporaryIdentity = readEtherFileIdentity(temporaryPath);

      this.database.close();
      connectionOnSource = false;
      let staging = openEtherDocumentConnection(temporaryPath, false);
      this.database = staging.database;
      this.runtime.onSaveStage?.("identity-rewrite");
      this.database
        .prepare("UPDATE document SET document_id = ?, updated_at = ? WHERE singleton = 1")
        .run(nextDocumentId, new Date().toISOString());

      this.runtime.onSaveStage?.("validation");
      const validated = validateEtherDocumentConnection(this.database, temporaryPath);
      if (validated.document.documentId !== nextDocumentId) {
        throw new DocumentStoreError("INVALID_BACKUP", "Backup identity rewrite did not persist.");
      }
      this.database.close();

      this.runtime.onSaveStage?.("fsync");
      const syncDescriptor = openSync(temporaryPath, "r+");
      try {
        fsyncSync(syncDescriptor);
      } finally {
        closeSync(syncDescriptor);
      }

      if (switchActive) {
        staging = openEtherDocumentConnection(temporaryPath, false);
        this.database = staging.database;
        const probeExistingDestination = (): void => {
          const existing = openEtherDocumentConnection(absoluteDestination, false);
          try {
            existingDestinationDocumentId = existing.inspection.document.documentId;
            sqliteProbe(existing.database);
          } finally {
            existing.database.close();
          }
        };
        const acquisition = WriterLease.acquire(
          absoluteDestination,
          nextDocumentId,
          this.runtime,
          destinationExisted ? probeExistingDestination : () => sqliteProbe(this.database),
          destinationExisted ? probeExistingDestination : () => sqliteProbe(this.database)
        );
        if (acquisition.lease === undefined) {
          throw new DocumentStoreError(
            "WRITER_LEASE_UNAVAILABLE",
            "The Save As destination writer lease is unavailable.",
            acquisition.reason
          );
        }
        destinationLease = acquisition.lease;
        this.database.close();
      }

      this.runtime.onSaveStage?.("publication");
      publishedIdentity = temporaryIdentity;
      if (switchActive) {
        if (destinationExisted) {
          if (existingDestinationDocumentId === undefined) {
            throw new DocumentStoreError(
              "INVALID_DESTINATION",
              "The existing Save As destination identity was not validated."
            );
          }
          replacementRecovery = beginReplacementRecovery(this.runtime.recoveryRoot, {
            destinationPath: absoluteDestination,
            newDocumentId: nextDocumentId,
            previousDocumentId: existingDestinationDocumentId,
            staging: { identity: temporaryIdentity, path: temporaryPath },
            sourceDocumentId,
            sourcePath
          });
          replacementRollback = createOwnedReplacementRollback(
            absoluteDestination,
            plannedReplacementRollback(replacementRecovery)
          );
          await recordReplacementRollback(replacementRecovery, replacementRollback);
        }
        replaceWithOwnedTemporaryDatabase(temporaryPath, absoluteDestination, temporaryIdentity);
        if (replacementRecovery !== undefined) {
          markReplacementPublished(replacementRecovery);
        }
      } else {
        publishOwnedTemporaryDatabase(temporaryPath, absoluteDestination, temporaryIdentity);
      }
      temporaryIdentity = undefined;

      if (switchActive) {
        this.runtime.onSaveStage?.("post-publication");
        const destination = openEtherDocumentConnection(absoluteDestination, false);
        this.database = destination.database;
        await sourceWriterLease?.release();
        this.writerLease = destinationLease;
        this.currentPath = absoluteDestination;
        this.currentDocumentId = nextDocumentId;
        this.currentMode = { kind: "writable" };
        this.startHeartbeat();
        if (replacementRollback !== undefined) {
          removeOwnedReplacementRollback(replacementRollback);
          replacementRollback = undefined;
        }
        if (replacementRecovery !== undefined) {
          completeReplacementRecovery(replacementRecovery);
          replacementRecovery = undefined;
        }
        destinationLease = undefined;
      } else {
        const source = openEtherDocumentConnection(sourcePath, sourceMode.kind === "read-only");
        this.database = source.database;
        connectionOnSource = true;
      }
      publishedIdentity = undefined;
      return { documentId: nextDocumentId, path: absoluteDestination };
    } catch (error) {
      const failedDestinationLease = destinationLease;
      if (failedDestinationLease !== undefined && this.writerLease === failedDestinationLease) {
        this.writerLease = undefined;
      }
      let destinationLeaseReleaseError: unknown;
      try {
        await failedDestinationLease?.release();
      } catch (releaseError) {
        destinationLeaseReleaseError = releaseError;
      }
      try {
        if (!connectionOnSource) {
          this.database.close();
        }
      } catch {
        // Reopening the active source below is the recovery authority.
      }
      removeOwnedFile(temporaryPath, temporaryIdentity);
      let restorationError: unknown;
      if (replacementRollback !== undefined) {
        try {
          restoreOwnedReplacementRollback(replacementRollback, absoluteDestination);
          replacementRollback = undefined;
          if (replacementRecovery !== undefined) {
            completeReplacementRecovery(replacementRecovery);
            replacementRecovery = undefined;
          }
        } catch (restoreError) {
          restorationError = restoreError;
        }
      } else if (!switchActive || !destinationExisted) {
        removeOwnedFile(absoluteDestination, publishedIdentity);
      }
      if (!connectionOnSource) {
        const source = openEtherDocumentConnection(sourcePath, sourceMode.kind === "read-only");
        this.database = source.database;
      }
      this.currentPath = sourcePath;
      this.currentDocumentId = sourceDocumentId;
      this.currentMode = sourceMode;
      if (sourceMode.kind === "writable") {
        this.writerLease = sourceWriterLease;
        const sourceLeaseOwned = (await sourceWriterLease?.owns()) ?? false;
        if (!sourceLeaseOwned) {
          try {
            await sourceWriterLease?.release();
          } catch {
            // A still-contended lease remains attached so close can retry its release.
          }
          const reacquired = WriterLease.acquire(
            sourcePath,
            sourceDocumentId,
            this.runtime,
            () => sqliteProbe(this.database)
          );
          if (reacquired.lease !== undefined) {
            this.writerLease = reacquired.lease;
            this.currentMode = { kind: "writable" };
            this.startHeartbeat();
          } else {
            this.database.close();
            const readOnly = openEtherDocumentConnection(sourcePath, true);
            this.database = readOnly.database;
            this.writerLease = sourceWriterLease;
            this.currentMode = {
              kind: "read-only",
              reason: reacquired.reason ?? "writer-active"
            };
          }
        }
      }
      if (restorationError !== undefined) {
        throw new DocumentStoreError(
          "REPLACEMENT_ROLLBACK_FAILED",
          "Save As failed and the owned destination rollback could not be restored.",
          undefined,
          { cause: restorationError }
        );
      }
      if (destinationLeaseReleaseError !== undefined) {
        throw new DocumentStoreError(
          "WRITER_LEASE_RELEASE_FAILED",
          "Save As failed and the destination writer lease could not be released.",
          undefined,
          { cause: destinationLeaseReleaseError }
        );
      }
      throw error;
    }
  }
}

export { DocumentRepositoryError };
export type {
  CompactStage,
  CreateStage,
  DocumentStoreEnvironment,
  ReferenceGrantAuthority,
  ReferenceGrantFingerprintRequest,
  ReferenceGrantPathRequest,
  ReferenceGrantRequest,
  ReadOnlyReason,
  WritableLocationCapabilityAdapter,
  WritableLocationKind
} from "./locking.js";
