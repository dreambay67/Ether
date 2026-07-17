import {
  DocumentHeaderSchema,
  ETHER_FILE_EXTENSION,
  ETHER_FORMAT_MARKER,
  ETHER_FORMAT_VERSION,
  ETHER_SCHEMA_VERSION,
  ETHER_SQLITE_APPLICATION_ID
} from "@ether/schema";
import {
  closeSync,
  linkSync,
  openSync,
  readFileSync,
  statSync,
  unlinkSync
} from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type { DocumentHeader } from "@ether/schema";

import { ETHER_PROVISIONAL_PAGE_SIZE } from "./format.js";
import {
  EtherDocumentError,
  inspectEtherDocument,
  type EtherDocumentInspection,
  type EtherDocumentPragmas
} from "./validation.js";

const SCHEMA_SQL = readFileSync(new URL("./schema/40000.sql", import.meta.url), "utf8");

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

function configureWritableOpen(database: DatabaseSync): void {
  database.exec(`
    PRAGMA journal_mode = DELETE;
    PRAGMA synchronous = FULL;
    PRAGMA foreign_keys = ON;
  `);
  verifyWritablePragmas(database);
}

function makeDocumentHeader(options: CreateEtherDocumentOptions): DocumentHeader {
  const now = new Date().toISOString();
  return DocumentHeaderSchema.parse({
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
}

function destinationExists(destinationPath: string): boolean {
  return statSync(destinationPath, { throwIfNoEntry: false }) !== undefined;
}

export function createEtherDocument(
  destinationPath: string,
  options: CreateEtherDocumentOptions
): EtherDocumentInspection {
  if (path.extname(destinationPath).toLowerCase() !== ETHER_FILE_EXTENSION) {
    throw new Error(`Ether document destination must end in ${ETHER_FILE_EXTENSION}.`);
  }
  if (destinationExists(destinationPath)) {
    throw new Error(`Ether document destination already exists: ${destinationPath}`);
  }

  const document = makeDocumentHeader(options);
  const directory = path.dirname(destinationPath);
  const temporaryPath = path.join(
    directory,
    `.${path.basename(destinationPath)}.ether-tmp-${randomUUID()}`
  );
  let database: DatabaseSync | undefined;
  let temporaryOwned = false;
  let destinationOwned = false;

  try {
    const temporaryFile = openSync(temporaryPath, "wx", 0o600);
    closeSync(temporaryFile);
    temporaryOwned = true;

    database = new DatabaseSync(temporaryPath, {
      allowExtension: false,
      enableDoubleQuotedStringLiterals: false,
      enableForeignKeyConstraints: true
    });
    configureNewDatabase(database);
    database.exec("BEGIN IMMEDIATE");
    try {
      database.exec(SCHEMA_SQL);
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
      database.exec("COMMIT");
    } catch (error) {
      try {
        database.exec("ROLLBACK");
      } catch {
        // The original schema or insert error is more useful than a redundant rollback error.
      }
      throw error;
    }
    verifyWritablePragmas(database);
    database.close();
    database = undefined;

    const inspection = inspectEtherDocument(temporaryPath);
    linkSync(temporaryPath, destinationPath);
    destinationOwned = true;
    unlinkSync(temporaryPath);
    temporaryOwned = false;

    return { ...inspection, path: destinationPath };
  } catch (error) {
    if (database !== undefined) {
      try {
        database.close();
      } catch {
        // Cleanup continues below for files owned by this creation attempt.
      }
    }
    if (destinationOwned) {
      try {
        unlinkSync(destinationPath);
      } catch {
        // Best-effort cleanup cannot replace the original publication failure.
      }
    }
    if (temporaryOwned) {
      try {
        unlinkSync(temporaryPath);
      } catch {
        // Best-effort cleanup cannot replace the original creation failure.
      }
    }
    throw error;
  }
}

export function openEtherDocument(filePath: string): DatabaseSync {
  inspectEtherDocument(filePath);

  const database = new DatabaseSync(filePath, {
    allowExtension: false,
    enableDoubleQuotedStringLiterals: false,
    enableForeignKeyConstraints: true
  });
  try {
    configureWritableOpen(database);
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}
