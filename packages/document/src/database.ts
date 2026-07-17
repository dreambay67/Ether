import {
  DocumentHeaderSchema,
  ETHER_FILE_EXTENSION,
  ETHER_FORMAT_MARKER,
  ETHER_FORMAT_VERSION,
  ETHER_SCHEMA_VERSION,
  ETHER_SQLITE_APPLICATION_ID
} from "@ether/schema";
import { randomUUID } from "node:crypto";
import {
  closeSync,
  linkSync,
  lstatSync,
  openSync,
  renameSync,
  statSync,
  unlinkSync
} from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import type { DocumentHeader } from "@ether/schema";

import { ETHER_PROVISIONAL_PAGE_SIZE } from "./format.js";
import {
  ETHER_SCHEMA_SQL,
  EtherDocumentError,
  assertEtherFileIdentity,
  inspectEtherDocument,
  inspectEtherFileHeader,
  mapEtherDocumentError,
  readEtherFileIdentity,
  validateEtherDocumentConnection,
  type EtherDocumentInspection,
  type EtherDocumentPragmas,
  type EtherFileIdentity
} from "./validation.js";

const TEST_HOOKS_SYMBOL = Symbol.for("@ether/document/boundary-test-hooks");

export interface DocumentBoundaryTestHooks {
  afterWritableOpen?: (location: string) => void;
  beforeHardLinkPublication?: (temporaryPath: string, destinationPath: string) => void;
  beforeTemporaryDatabaseOpen?: (temporaryPath: string) => void;
  beforeWritableDatabaseOpen?: (filePath: string) => void;
  beforeWritableOpen?: (filePath: string) => void;
  forceReadOnlyWritableConnection?: boolean;
}

interface BoundaryGlobal {
  [TEST_HOOKS_SYMBOL]?: DocumentBoundaryTestHooks;
}

function boundaryGlobal(): BoundaryGlobal {
  return globalThis as BoundaryGlobal;
}

function testHooks(): DocumentBoundaryTestHooks {
  return boundaryGlobal()[TEST_HOOKS_SYMBOL] ?? {};
}

export function __setDocumentBoundaryTestHooks(hooks: DocumentBoundaryTestHooks): () => void {
  const previous = boundaryGlobal()[TEST_HOOKS_SYMBOL];
  boundaryGlobal()[TEST_HOOKS_SYMBOL] = hooks;
  return () => {
    if (previous === undefined) {
      delete boundaryGlobal()[TEST_HOOKS_SYMBOL];
    } else {
      boundaryGlobal()[TEST_HOOKS_SYMBOL] = previous;
    }
  };
}

export interface CreateEtherDocumentOptions {
  appVersion: string;
  documentId: string;
  featureFlags?: Record<string, boolean>;
  title: string;
}

function firstValue(database: DatabaseSync, sql: string): unknown {
  const row = database.prepare(sql).get() as Record<string, unknown> | undefined;
  return row === undefined ? undefined : Object.values(row)[0];
}

function currentPragmas(database: DatabaseSync): EtherDocumentPragmas {
  return {
    applicationId: Number(firstValue(database, "PRAGMA application_id")),
    autoVacuum: Number(firstValue(database, "PRAGMA auto_vacuum")),
    foreignKeys: Number(firstValue(database, "PRAGMA foreign_keys")),
    journalMode: String(firstValue(database, "PRAGMA journal_mode")).toLowerCase(),
    pageSize: Number(firstValue(database, "PRAGMA page_size")),
    synchronous: Number(firstValue(database, "PRAGMA synchronous")),
    userVersion: Number(firstValue(database, "PRAGMA user_version"))
  };
}

function expectedPragmas(): EtherDocumentPragmas {
  return {
    applicationId: ETHER_SQLITE_APPLICATION_ID,
    autoVacuum: 2,
    foreignKeys: 1,
    journalMode: "delete",
    pageSize: ETHER_PROVISIONAL_PAGE_SIZE,
    synchronous: 2,
    userVersion: ETHER_SCHEMA_VERSION
  };
}

function verifyWritablePragmas(database: DatabaseSync): void {
  const actual = currentPragmas(database);
  const expected = expectedPragmas();
  for (const key of Object.keys(expected) as (keyof EtherDocumentPragmas)[]) {
    if (actual[key] !== expected[key]) {
      throw new EtherDocumentError(
        "INVALID_PRAGMA",
        `SQLite refused Ether PRAGMA ${key}: received ${String(actual[key])}, expected ${String(expected[key])}.`
      );
    }
  }
}

function configureNewDatabase(database: DatabaseSync): void {
  database.exec(`
    PRAGMA page_size = ${ETHER_PROVISIONAL_PAGE_SIZE};
    PRAGMA auto_vacuum = INCREMENTAL;
    PRAGMA application_id = ${ETHER_SQLITE_APPLICATION_ID};
    PRAGMA user_version = ${ETHER_SCHEMA_VERSION};
    PRAGMA journal_mode = DELETE;
    PRAGMA synchronous = FULL;
    PRAGMA foreign_keys = ON;
  `);
  verifyWritablePragmas(database);
}

function makeDocumentHeader(options: CreateEtherDocumentOptions): DocumentHeader {
  const now = new Date().toISOString();
  const parsed = DocumentHeaderSchema.safeParse({
    appVersion: options.appVersion,
    createdAt: now,
    documentId: options.documentId,
    featureFlags: options.featureFlags ?? {},
    formatMarker: ETHER_FORMAT_MARKER,
    formatVersion: ETHER_FORMAT_VERSION,
    schemaVersion: ETHER_SCHEMA_VERSION,
    title: options.title,
    updatedAt: now
  });
  if (!parsed.success) {
    throw new EtherDocumentError(
      "INVALID_DOCUMENT_METADATA",
      `Ether document metadata is malformed: ${parsed.error.message}`
    );
  }
  return parsed.data;
}

function destinationExists(destinationPath: string): boolean {
  try {
    return lstatSync(destinationPath, { throwIfNoEntry: false }) !== undefined;
  } catch (error) {
    throw mapEtherDocumentError(
      error,
      "INVALID_DESTINATION",
      `Ether document destination cannot be inspected: ${destinationPath}`
    );
  }
}

function nodeErrorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

function publicationError(error: unknown): EtherDocumentError {
  const code = nodeErrorCode(error);
  if (code === "EEXIST") {
    return new EtherDocumentError(
      "DESTINATION_EXISTS",
      "Ether document destination appeared during publication.",
      { cause: error }
    );
  }
  if (["EPERM", "ENOTSUP", "EOPNOTSUPP", "EXDEV"].includes(code ?? "")) {
    return new EtherDocumentError(
      "ATOMIC_NO_CLOBBER_UNSUPPORTED",
      "This filesystem cannot provide atomic no-clobber Ether document publication.",
      { cause: error }
    );
  }
  return mapEtherDocumentError(error, "PUBLICATION_FAILED", "Ether document publication failed.");
}

function replacementError(error: unknown): EtherDocumentError {
  const code = nodeErrorCode(error);
  if (["EPERM", "ENOTSUP", "EOPNOTSUPP", "EXDEV"].includes(code ?? "")) {
    return new EtherDocumentError(
      "ATOMIC_REPLACE_UNSUPPORTED",
      "This filesystem cannot atomically replace an Ether document.",
      { cause: error }
    );
  }
  return mapEtherDocumentError(
    error,
    "PUBLICATION_FAILED",
    "Ether document replacement failed."
  );
}

function creationError(error: unknown, destinationPath: string): EtherDocumentError {
  if (error instanceof EtherDocumentError) {
    return error;
  }
  const code = nodeErrorCode(error);
  if (code === "ENOENT" || code === "ENOTDIR") {
    return new EtherDocumentError(
      "INVALID_DESTINATION",
      `Ether document destination directory does not exist: ${path.dirname(destinationPath)}`,
      { cause: error }
    );
  }
  return mapEtherDocumentError(error, "PUBLICATION_FAILED", "Ether document creation failed.");
}

function sameIdentity(left: EtherFileIdentity, right: EtherFileIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.birthtimeNs === right.birthtimeNs;
}

function assertSameOwnedFile(filePath: string, expectedIdentity: EtherFileIdentity): void {
  const actualIdentity = readEtherFileIdentity(filePath, true);
  if (!sameIdentity(actualIdentity, expectedIdentity)) {
    throw new EtherDocumentError(
      "PATH_CHANGED",
      `Ether document temporary path changed after opening: ${filePath}`
    );
  }
}

function removePublishedLinkIfOwned(
  destinationPath: string,
  temporaryIdentity: EtherFileIdentity
): void {
  try {
    unlinkFileIfOwned(destinationPath, temporaryIdentity);
  } catch {
    // Cleanup is limited to a destination proven to be the link created by this attempt.
  }
}

function unlinkFileIfOwned(filePath: string, expectedIdentity: EtherFileIdentity): boolean {
  const stats = lstatSync(filePath, { bigint: true });
  const actualIdentity: EtherFileIdentity = {
    birthtimeNs: stats.birthtimeNs,
    dev: stats.dev,
    ino: stats.ino,
    size: stats.size
  };
  if (!sameIdentity(actualIdentity, expectedIdentity)) {
    return false;
  }
  unlinkSync(filePath);
  return true;
}

function canonicalPath(filePath: string): string {
  const resolved = path.resolve(filePath);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function writableDatabaseUrl(filePath: string, readOnly: boolean): URL {
  const url = pathToFileURL(filePath);
  url.searchParams.set("mode", readOnly ? "ro" : "rw");
  url.searchParams.set("cache", "private");
  return url;
}

export interface InternalEtherDocumentConnection {
  database: DatabaseSync;
  inspection: EtherDocumentInspection;
}

export function openEtherDocumentConnection(
  filePath: string,
  readOnly: boolean
): InternalEtherDocumentConnection {
  const absolutePath = path.resolve(filePath);
  const identity = inspectEtherFileHeader(absolutePath);
  const database = new DatabaseSync(writableDatabaseUrl(absolutePath, readOnly), {
    allowExtension: false,
    enableDoubleQuotedStringLiterals: false,
    enableForeignKeyConstraints: true,
    open: false,
    timeout: 0
  });
  let opened = false;
  try {
    database.open();
    opened = true;
    const location = database.location();
    if (location === null || canonicalPath(location) !== canonicalPath(absolutePath)) {
      throw new EtherDocumentError(
        "PATH_CHANGED",
        `SQLite opened a different location than the requested Ether document: ${absolutePath}`
      );
    }
    assertEtherFileIdentity(absolutePath, identity);
    const inspection = validateEtherDocumentConnection(database, absolutePath);
    assertEtherFileIdentity(absolutePath, identity);
    return { database, inspection };
  } catch (error) {
    if (opened) {
      database.close();
    }
    throw mapEtherDocumentError(
      error,
      "INVALID_SQLITE",
      `Ether document could not be opened safely: ${absolutePath}`
    );
  }
}

export function publishOwnedTemporaryDatabase(
  temporaryPath: string,
  destinationPath: string,
  temporaryIdentity: EtherFileIdentity
): void {
  const absoluteDestination = path.resolve(destinationPath);
  if (destinationExists(absoluteDestination)) {
    throw new EtherDocumentError(
      "DESTINATION_EXISTS",
      `Ether document destination already exists: ${absoluteDestination}`
    );
  }
  assertSameOwnedFile(temporaryPath, temporaryIdentity);
  let destinationOwned = false;
  try {
    linkSync(temporaryPath, absoluteDestination);
    destinationOwned = true;
    if (!unlinkFileIfOwned(temporaryPath, temporaryIdentity)) {
      throw new EtherDocumentError(
        "PATH_CHANGED",
        `Ether document temporary path changed during publication: ${temporaryPath}`
      );
    }
    destinationOwned = false;
  } catch (error) {
    if (destinationOwned) {
      removePublishedLinkIfOwned(absoluteDestination, temporaryIdentity);
    }
    throw publicationError(error);
  }
}

export function replaceWithOwnedTemporaryDatabase(
  temporaryPath: string,
  destinationPath: string,
  temporaryIdentity: EtherFileIdentity
): void {
  const absoluteDestination = path.resolve(destinationPath);
  assertSameOwnedFile(temporaryPath, temporaryIdentity);
  try {
    renameSync(temporaryPath, absoluteDestination);
    assertSameOwnedFile(absoluteDestination, temporaryIdentity);
  } catch (error) {
    throw replacementError(error);
  }
}

function runWritableProbe(database: DatabaseSync): void {
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = database
      .prepare("UPDATE document SET updated_at = updated_at WHERE singleton = 1")
      .run();
    if (result.changes !== 1) {
      throw new EtherDocumentError(
        "READ_ONLY",
        "Ether document writable probe did not update its singleton metadata row."
      );
    }
    database.exec("ROLLBACK");
  } catch (error) {
    try {
      database.exec("ROLLBACK");
    } catch {
      // Preserve the write failure that established the caller-facing capability error.
    }
    throw error;
  }
}

function withValidatedWritableDatabase<T>(
  filePath: string,
  operation: (database: DatabaseSync, inspection: EtherDocumentInspection) => T
): T {
  const absolutePath = path.resolve(filePath);
  const identity = inspectEtherFileHeader(absolutePath);
  testHooks().beforeWritableOpen?.(absolutePath);
  assertEtherFileIdentity(absolutePath, identity);

  const database = new DatabaseSync(
    writableDatabaseUrl(absolutePath, testHooks().forceReadOnlyWritableConnection === true),
    {
      allowExtension: false,
      enableDoubleQuotedStringLiterals: false,
      enableForeignKeyConstraints: true,
      open: false,
      timeout: 0
    }
  );
  let opened = false;
  try {
    testHooks().beforeWritableDatabaseOpen?.(absolutePath);
    try {
      database.open();
      opened = true;
    } catch (error) {
      if (statSync(absolutePath, { throwIfNoEntry: false }) === undefined) {
        throw new EtherDocumentError(
          "PATH_CHANGED",
          `Ether document path disappeared before SQLite opened it: ${absolutePath}`,
          { cause: error }
        );
      }
      throw error;
    }
    const location = database.location();
    if (location === null || canonicalPath(location) !== canonicalPath(absolutePath)) {
      throw new EtherDocumentError(
        "PATH_CHANGED",
        `SQLite opened a different location than the requested Ether document: ${absolutePath}`
      );
    }
    testHooks().afterWritableOpen?.(location);
    assertEtherFileIdentity(absolutePath, identity);

    const inspection = validateEtherDocumentConnection(database, absolutePath);
    runWritableProbe(database);
    assertEtherFileIdentity(absolutePath, identity);
    return operation(database, inspection);
  } catch (error) {
    throw mapEtherDocumentError(
      error,
      "INVALID_SQLITE",
      `Ether document could not be opened safely for writing: ${absolutePath}`
    );
  } finally {
    if (opened) {
      database.close();
    }
  }
}

export function createEtherDocument(
  destinationPath: string,
  options: CreateEtherDocumentOptions
): EtherDocumentInspection {
  return createInitializedEtherDocument(destinationPath, options, () => undefined);
}

export function createInitializedEtherDocument(
  destinationPath: string,
  options: CreateEtherDocumentOptions,
  initialize: (database: DatabaseSync) => void
): EtherDocumentInspection {
  const absoluteDestination = path.resolve(destinationPath);
  if (path.extname(absoluteDestination).toLowerCase() !== ETHER_FILE_EXTENSION) {
    throw new EtherDocumentError(
      "INVALID_DESTINATION",
      `Ether document destination must end in ${ETHER_FILE_EXTENSION}.`
    );
  }
  if (destinationExists(absoluteDestination)) {
    throw new EtherDocumentError(
      "DESTINATION_EXISTS",
      `Ether document destination already exists: ${absoluteDestination}`
    );
  }

  const document = makeDocumentHeader(options);
  const directory = path.dirname(absoluteDestination);
  const temporaryPath = path.join(
    directory,
    `.${path.basename(absoluteDestination)}.ether-tmp-${randomUUID()}`
  );
  let database: DatabaseSync | undefined;
  let temporaryOwned = false;
  let temporaryIdentity: EtherFileIdentity | undefined;
  let destinationOwned = false;

  try {
    const temporaryFile = openSync(temporaryPath, "wx", 0o600);
    closeSync(temporaryFile);
    temporaryOwned = true;
    temporaryIdentity = readEtherFileIdentity(temporaryPath);

    database = new DatabaseSync(writableDatabaseUrl(temporaryPath, false), {
      allowExtension: false,
      enableDoubleQuotedStringLiterals: false,
      enableForeignKeyConstraints: true,
      open: false
    });
    testHooks().beforeTemporaryDatabaseOpen?.(temporaryPath);
    database.open();
    const temporaryLocation = database.location();
    if (
      temporaryLocation === null ||
      canonicalPath(temporaryLocation) !== canonicalPath(temporaryPath)
    ) {
      throw new EtherDocumentError(
        "PATH_CHANGED",
        `SQLite opened a different location than the owned temporary document: ${temporaryPath}`
      );
    }
    assertEtherFileIdentity(temporaryPath, temporaryIdentity);
    configureNewDatabase(database);
    database.exec("BEGIN IMMEDIATE");
    try {
      database.exec(ETHER_SCHEMA_SQL);
      database
        .prepare(
          `INSERT INTO document (
             singleton, document_id, format_marker, format_version, schema_version, title,
             created_at, updated_at, app_version, feature_flags_json
           ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          document.documentId,
          document.formatMarker,
          document.formatVersion,
          document.schemaVersion,
          document.title,
          document.createdAt,
          document.updatedAt,
          document.appVersion,
          JSON.stringify(document.featureFlags)
        );
      try {
        initialize(database);
      } catch (error) {
        const detail = error instanceof Error ? `: ${error.message}` : "";
        throw new EtherDocumentError(
          "PUBLICATION_FAILED",
          `Ether document initialization failed${detail}`,
          { cause: error }
        );
      }
      database.exec("COMMIT");
    } catch (error) {
      try {
        database.exec("ROLLBACK");
      } catch {
        // Preserve the schema or metadata failure.
      }
      throw error;
    }
    verifyWritablePragmas(database);
    database.close();
    database = undefined;

    const inspection = inspectEtherDocument(temporaryPath);
    assertSameOwnedFile(temporaryPath, temporaryIdentity);
    try {
      testHooks().beforeHardLinkPublication?.(temporaryPath, absoluteDestination);
      linkSync(temporaryPath, absoluteDestination);
      destinationOwned = true;
    } catch (error) {
      throw publicationError(error);
    }

    try {
      if (!unlinkFileIfOwned(temporaryPath, temporaryIdentity)) {
        throw new EtherDocumentError(
          "PATH_CHANGED",
          `Ether document temporary path changed during publication: ${temporaryPath}`
        );
      }
      temporaryOwned = false;
    } catch (error) {
      removePublishedLinkIfOwned(absoluteDestination, temporaryIdentity);
      destinationOwned = false;
      throw mapEtherDocumentError(
        error,
        "PUBLICATION_FAILED",
        "Ether document temporary publication link could not be removed."
      );
    }
    destinationOwned = false;

    return { ...inspection, path: absoluteDestination };
  } catch (error) {
    if (database !== undefined) {
      try {
        database.close();
      } catch {
        // Continue cleanup of files owned by this creation attempt.
      }
    }
    if (destinationOwned && temporaryIdentity !== undefined) {
      removePublishedLinkIfOwned(absoluteDestination, temporaryIdentity);
    }
    if (temporaryOwned && temporaryIdentity !== undefined) {
      removePublishedLinkIfOwned(temporaryPath, temporaryIdentity);
    }
    throw creationError(error, absoluteDestination);
  }
}

export function assertEtherDocumentWritable(filePath: string): EtherDocumentInspection {
  try {
    return withValidatedWritableDatabase(filePath, (_database, inspection) => inspection);
  } catch (error) {
    throw mapEtherDocumentError(
      error,
      "INVALID_SQLITE",
      `Ether document writable capability could not be established: ${filePath}`
    );
  }
}
