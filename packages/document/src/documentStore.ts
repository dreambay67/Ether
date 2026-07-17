import {
  EtherGraphSchema,
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
  openEtherDocumentConnection,
  publishOwnedTemporaryDatabase,
  replaceWithOwnedTemporaryDatabase
} from "./database.js";
import {
  type DocumentStoreEnvironment,
  type DocumentStoreRuntime,
  type ReadOnlyReason,
  WriterLease,
  locationSupportsWriting,
  resolveDocumentStoreEnvironment
} from "./locking.js";
import { createRepositoryContext, GraphRepository } from "./repositories/graphs.js";
import { OutputRepository } from "./repositories/outputs.js";
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
  environment?: DocumentStoreEnvironment;
}

export interface ReadDocumentRepositories {
  graphs: Pick<GraphRepository, "get" | "list">;
  outputs: Pick<OutputRepository, "getPayload" | "getVersion">;
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
}

export interface DocumentRepositories extends ReadDocumentRepositories {
  outputs: Pick<OutputRepository, "getPayload" | "getVersion" | "insert">;
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
}

interface InternalDocumentRepositories {
  graphs: GraphRepository;
  outputs: OutputRepository;
  revisions: RevisionRepository;
  settings: SettingsRepository;
}

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
  private currentMode: DocumentStoreMode;
  private currentPath: string;

  private constructor(options: {
    database: DatabaseSync;
    documentId: string;
    lease?: WriterLease;
    mode: DocumentStoreMode;
    path: string;
    runtime: DocumentStoreRuntime;
  }) {
    this.database = options.database;
    this.currentDocumentId = options.documentId;
    this.writerLease = options.lease;
    this.currentMode = options.mode;
    this.currentPath = options.path;
    this.runtime = options.runtime;
    this.startHeartbeat();
  }

  static async create(
    filePath: string,
    options: CreateDocumentStoreOptions
  ): Promise<DocumentStore> {
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
    if (!locationSupportsWriting(absolutePath, runtime)) {
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
    return new DocumentStore({
      database: connection.database,
      documentId: connection.inspection.document.documentId,
      lease: acquisition.lease,
      mode: { kind: "writable" },
      path: absolutePath,
      runtime
    });
  }

  get dirty(): boolean {
    return false;
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

  read<T>(callback: (repositories: ReadDocumentRepositories) => T): Promise<T> {
    return this.enqueue(() => {
      this.assertOpen();
      const scope = this.readRepositories();
      try {
        const result = callback(scope.repositories);
        if (isPromiseLike(result)) {
          throw new DocumentStoreError(
            "ASYNC_TRANSACTION_CALLBACK",
            "Document repository callbacks must complete synchronously."
          );
        }
        return result;
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

  saveCopy(destinationPath: string): Promise<{ documentId: string; path: string }> {
    return this.enqueue(() => this.saveBackup(destinationPath, false));
  }

  saveAs(destinationPath: string): Promise<void> {
    return this.enqueue(async () => {
      await this.saveBackup(destinationPath, true);
    });
  }

  close(): Promise<void> {
    if (this.closePromise !== undefined) {
      return this.closePromise;
    }
    this.closePromise = this.enqueue(() => {
      if (this.closed) {
        return;
      }
      this.closed = true;
      this.writerLease?.release();
      this.writerLease = undefined;
      this.database.close();
    });
    return this.closePromise;
  }

  private internalRepositories(): InternalDocumentRepositories {
    const context = createRepositoryContext(this.database);
    const graphs = new GraphRepository(context);
    return {
      graphs,
      outputs: new OutputRepository(context),
      revisions: new RevisionRepository(context, graphs),
      settings: new SettingsRepository(context)
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
        graphs: {
          get: (graphId) => invoke(() => repositories.graphs.get(graphId)),
          list: () => invoke(() => repositories.graphs.list())
        },
        outputs: {
          getPayload: (id) => invoke(() => repositories.outputs.getPayload(id)),
          getVersion: (id) => invoke(() => repositories.outputs.getVersion(id))
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
      graphs: {
        get: (graphId) => invoke(() => repositories.graphs.get(graphId)),
        list: () => invoke(() => repositories.graphs.list())
      },
      outputs: {
        getPayload: (id) => invoke(() => repositories.outputs.getPayload(id)),
        getVersion: (id) => invoke(() => repositories.outputs.getVersion(id)),
        insert: (version, payloads) => invoke(() => repositories.outputs.insert(version, payloads))
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
      this.database.exec("COMMIT");
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

  private transitionToReadOnly(reason: ReadOnlyReason): void {
    if (this.closed || this.currentMode.kind === "read-only") {
      return;
    }
    this.writerLease?.release();
    this.writerLease = undefined;
    this.database.close();
    const connection = openEtherDocumentConnection(this.currentPath, true);
    this.database = connection.database;
    this.currentMode = { kind: "read-only", reason };
  }

  private async saveBackup(
    destinationPath: string,
    switchActive: boolean
  ): Promise<{ documentId: string; path: string }> {
    this.assertOpen();
    const absoluteDestination = path.resolve(destinationPath);
    const destinationExisted = prepareDestination(absoluteDestination, switchActive);
    if (switchActive && !locationSupportsWriting(absoluteDestination, this.runtime)) {
      throw new DocumentStoreError(
        "WRITER_LEASE_UNAVAILABLE",
        "The Save As destination is not approved for writable Ether semantics.",
        "location-unsupported"
      );
    }
    const sourcePath = this.currentPath;
    const sourceDocumentId = this.currentDocumentId;
    const sourceMode = this.currentMode;
    const temporaryPath = path.join(
      path.dirname(absoluteDestination),
      `.${path.basename(absoluteDestination)}.ether-save-${randomUUID()}`
    );
    let temporaryIdentity: EtherFileIdentity | undefined;
    let publishedIdentity: EtherFileIdentity | undefined;
    let destinationLease: WriterLease | undefined;
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
        const acquisition = WriterLease.acquire(
          absoluteDestination,
          nextDocumentId,
          this.runtime,
          () => sqliteProbe(this.database)
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
        replaceWithOwnedTemporaryDatabase(temporaryPath, absoluteDestination, temporaryIdentity);
      } else {
        publishOwnedTemporaryDatabase(temporaryPath, absoluteDestination, temporaryIdentity);
      }
      temporaryIdentity = undefined;

      if (switchActive) {
        const destination = openEtherDocumentConnection(absoluteDestination, false);
        this.database = destination.database;
        this.writerLease?.release();
        this.writerLease = destinationLease;
        destinationLease = undefined;
        this.currentPath = absoluteDestination;
        this.currentDocumentId = nextDocumentId;
        this.currentMode = { kind: "writable" };
        this.startHeartbeat();
      } else {
        const source = openEtherDocumentConnection(sourcePath, sourceMode.kind === "read-only");
        this.database = source.database;
        connectionOnSource = true;
      }
      publishedIdentity = undefined;
      return { documentId: nextDocumentId, path: absoluteDestination };
    } catch (error) {
      destinationLease?.release();
      try {
        if (!connectionOnSource) {
          this.database.close();
        }
      } catch {
        // Reopening the active source below is the recovery authority.
      }
      removeOwnedFile(temporaryPath, temporaryIdentity);
      if (!switchActive || !destinationExisted) {
        removeOwnedFile(absoluteDestination, publishedIdentity);
      }
      if (!connectionOnSource) {
        const source = openEtherDocumentConnection(sourcePath, sourceMode.kind === "read-only");
        this.database = source.database;
      }
      this.currentPath = sourcePath;
      this.currentDocumentId = sourceDocumentId;
      this.currentMode = sourceMode;
      throw error;
    }
  }
}

export { DocumentRepositoryError };
export type {
  CreateStage,
  DocumentStoreEnvironment,
  ReadOnlyReason,
  WritableLocationCapabilityAdapter,
  WritableLocationKind
} from "./locking.js";
