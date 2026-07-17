import {
  DocumentHeaderSchema,
  ETHER_FORMAT_MARKER,
  ETHER_FORMAT_VERSION,
  ETHER_SCHEMA_VERSION,
  ETHER_SQLITE_APPLICATION_ID
} from "@ether/schema";
import { closeSync, lstatSync, openSync, readSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { DocumentHeader } from "@ether/schema";

import {
  ETHER_PROVISIONAL_PAGE_SIZE,
  ETHER_REQUIRED_FEATURE_PREFIX,
  ETHER_SUPPORTED_REQUIRED_FEATURES
} from "./format.js";

const SQLITE_HEADER = Buffer.from("SQLite format 3\0", "binary");
const SUPPORTED_FORMAT_MAJOR = 4;

export type EtherDocumentErrorCode =
  | "NOT_A_REGULAR_FILE"
  | "INVALID_SQLITE_HEADER"
  | "INVALID_SQLITE"
  | "WRONG_APPLICATION_ID"
  | "INVALID_DOCUMENT_METADATA"
  | "UNSUPPORTED_FORMAT"
  | "UNSUPPORTED_SCHEMA"
  | "UNSUPPORTED_REQUIRED_FEATURE"
  | "INVALID_PRAGMA"
  | "INTEGRITY_CHECK_FAILED"
  | "FOREIGN_KEY_CHECK_FAILED";

export class EtherDocumentError extends Error {
  readonly code: EtherDocumentErrorCode;

  constructor(code: EtherDocumentErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "EtherDocumentError";
    this.code = code;
  }
}

export interface EtherDocumentPragmas {
  applicationId: number;
  autoVacuum: number;
  foreignKeys: number;
  journalMode: string;
  pageSize: number;
  synchronous: number;
  userVersion: number;
}

export interface EtherDocumentInspection {
  document: DocumentHeader;
  path: string;
  pragmas: EtherDocumentPragmas;
  quickCheck: "ok";
}

interface DocumentRow {
  app_version: string;
  created_at: string;
  document_id: string;
  feature_flags_json: string;
  format_marker: string;
  format_version: string;
  schema_version: number;
  title: string;
  updated_at: string;
}

function firstValue(database: DatabaseSync, sql: string): unknown {
  const row = database.prepare(sql).get() as Record<string, unknown> | undefined;
  return row === undefined ? undefined : Object.values(row)[0];
}

function numberPragma(database: DatabaseSync, name: string): number {
  const value = firstValue(database, `PRAGMA ${name}`);
  if (typeof value !== "number") {
    throw new EtherDocumentError("INVALID_PRAGMA", `Ether document PRAGMA ${name} is invalid.`);
  }
  return value;
}

function readPragmas(database: DatabaseSync): EtherDocumentPragmas {
  const journalMode = firstValue(database, "PRAGMA journal_mode");
  if (typeof journalMode !== "string") {
    throw new EtherDocumentError("INVALID_PRAGMA", "Ether document journal mode is invalid.");
  }

  return {
    applicationId: numberPragma(database, "application_id"),
    autoVacuum: numberPragma(database, "auto_vacuum"),
    foreignKeys: numberPragma(database, "foreign_keys"),
    journalMode: journalMode.toLowerCase(),
    pageSize: numberPragma(database, "page_size"),
    synchronous: numberPragma(database, "synchronous"),
    userVersion: numberPragma(database, "user_version")
  };
}

function assertPragmas(pragmas: EtherDocumentPragmas): void {
  const expected: EtherDocumentPragmas = {
    applicationId: ETHER_SQLITE_APPLICATION_ID,
    autoVacuum: 2,
    foreignKeys: 1,
    journalMode: "delete",
    pageSize: ETHER_PROVISIONAL_PAGE_SIZE,
    synchronous: 2,
    userVersion: ETHER_SCHEMA_VERSION
  };

  for (const key of Object.keys(expected) as (keyof EtherDocumentPragmas)[]) {
    if (pragmas[key] !== expected[key]) {
      throw new EtherDocumentError(
        "INVALID_PRAGMA",
        `Ether document PRAGMA ${key} is ${String(pragmas[key])}; expected ${String(expected[key])}.`
      );
    }
  }
}

function assertRegularSqliteFile(filePath: string): void {
  let stats;
  try {
    stats = lstatSync(filePath);
  } catch (error) {
    throw new EtherDocumentError(
      "NOT_A_REGULAR_FILE",
      `Ether document does not exist or is not accessible: ${filePath}`,
      { cause: error }
    );
  }
  if (!stats.isFile()) {
    throw new EtherDocumentError(
      "NOT_A_REGULAR_FILE",
      `Ether document must be a regular file: ${filePath}`
    );
  }

  const header = Buffer.alloc(SQLITE_HEADER.length);
  const file = openSync(filePath, "r");
  const bytesRead = (() => {
    try {
      return readSync(file, header, 0, header.length, 0);
    } finally {
      closeSync(file);
    }
  })();
  if (bytesRead !== SQLITE_HEADER.length || !header.equals(SQLITE_HEADER)) {
    throw new EtherDocumentError(
      "INVALID_SQLITE_HEADER",
      `Ether document has an invalid SQLite header: ${filePath}`
    );
  }
}

function parseFeatureFlags(serialized: string): Record<string, boolean> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch (error) {
    throw new EtherDocumentError(
      "INVALID_DOCUMENT_METADATA",
      "Ether document feature flags are not valid JSON.",
      { cause: error }
    );
  }
  if (
    parsed === null ||
    Array.isArray(parsed) ||
    typeof parsed !== "object" ||
    Object.values(parsed).some((value) => typeof value !== "boolean")
  ) {
    throw new EtherDocumentError(
      "INVALID_DOCUMENT_METADATA",
      "Ether document feature flags must be an object of boolean values."
    );
  }

  const featureFlags = parsed as Record<string, boolean>;
  const unsupportedRequired = Object.entries(featureFlags)
    .filter(
      ([feature, enabled]) =>
        enabled &&
        feature.startsWith(ETHER_REQUIRED_FEATURE_PREFIX) &&
        !ETHER_SUPPORTED_REQUIRED_FEATURES.some((supported) => supported === feature)
    )
    .map(([feature]) => feature);
  if (unsupportedRequired.length > 0) {
    throw new EtherDocumentError(
      "UNSUPPORTED_REQUIRED_FEATURE",
      `Ether document requires unsupported required feature: ${unsupportedRequired.join(", ")}.`
    );
  }
  return featureFlags;
}

function parseDocumentRow(row: DocumentRow): DocumentHeader {
  const versionMatch = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/.exec(row.format_version);
  if (versionMatch === null) {
    throw new EtherDocumentError(
      "INVALID_DOCUMENT_METADATA",
      `Ether document format version is malformed: ${row.format_version}`
    );
  }
  const major = Number(versionMatch[1]);
  if (major > SUPPORTED_FORMAT_MAJOR) {
    throw new EtherDocumentError(
      "UNSUPPORTED_FORMAT",
      `Ether document uses future major format ${row.format_version}.`
    );
  }
  if (row.format_version !== ETHER_FORMAT_VERSION) {
    throw new EtherDocumentError(
      "UNSUPPORTED_FORMAT",
      `Ether document format ${row.format_version} is unsupported; expected ${ETHER_FORMAT_VERSION}.`
    );
  }
  if (row.format_marker !== ETHER_FORMAT_MARKER) {
    throw new EtherDocumentError(
      "INVALID_DOCUMENT_METADATA",
      `Ether document format marker is invalid: ${row.format_marker}`
    );
  }
  if (row.schema_version !== ETHER_SCHEMA_VERSION) {
    throw new EtherDocumentError(
      "UNSUPPORTED_SCHEMA",
      `Ether document schema version ${row.schema_version} is unsupported; expected ${ETHER_SCHEMA_VERSION}.`
    );
  }

  const candidate = {
    appVersion: row.app_version,
    createdAt: row.created_at,
    documentId: row.document_id,
    featureFlags: parseFeatureFlags(row.feature_flags_json),
    formatMarker: row.format_marker,
    formatVersion: row.format_version,
    schemaVersion: row.schema_version,
    title: row.title,
    updatedAt: row.updated_at
  };
  const parsed = DocumentHeaderSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new EtherDocumentError(
      "INVALID_DOCUMENT_METADATA",
      `Ether document metadata is malformed: ${parsed.error.message}`
    );
  }
  return parsed.data;
}

export function inspectEtherDocument(filePath: string): EtherDocumentInspection {
  assertRegularSqliteFile(filePath);

  let database: DatabaseSync;
  try {
    database = new DatabaseSync(filePath, {
      allowExtension: false,
      enableDoubleQuotedStringLiterals: false,
      enableForeignKeyConstraints: true,
      readOnly: true
    });
  } catch (error) {
    throw new EtherDocumentError("INVALID_SQLITE", "Ether document is not a valid SQLite file.", {
      cause: error
    });
  }

  try {
    const applicationId = numberPragma(database, "application_id");
    if (applicationId !== ETHER_SQLITE_APPLICATION_ID) {
      throw new EtherDocumentError(
        "WRONG_APPLICATION_ID",
        `SQLite application ID ${applicationId} is not an Ether application ID.`
      );
    }

    const tableCount = database
      .prepare("SELECT count(*) AS count FROM sqlite_schema WHERE type = 'table' AND name = 'document'")
      .get() as { count: number };
    if (tableCount.count !== 1) {
      throw new EtherDocumentError(
        "INVALID_DOCUMENT_METADATA",
        "Ether document metadata table is missing."
      );
    }
    const rows = database
      .prepare(
        `SELECT document_id, format_marker, format_version, schema_version, title,
                created_at, updated_at, app_version, feature_flags_json
         FROM document`
      )
      .all() as unknown as DocumentRow[];
    if (rows.length !== 1) {
      throw new EtherDocumentError(
        "INVALID_DOCUMENT_METADATA",
        `Ether document must contain exactly one document row; found ${rows.length}.`
      );
    }
    const document = parseDocumentRow(rows[0]);

    const pragmas = readPragmas(database);
    assertPragmas(pragmas);

    const quickCheckRows = database.prepare("PRAGMA quick_check").all() as Record<string, unknown>[];
    const quickCheckValues = quickCheckRows.flatMap((row) => Object.values(row));
    if (quickCheckValues.length !== 1 || quickCheckValues[0] !== "ok") {
      throw new EtherDocumentError(
        "INTEGRITY_CHECK_FAILED",
        `Ether document quick_check failed: ${quickCheckValues.join(", ")}`
      );
    }

    const foreignKeyFailures = database.prepare("PRAGMA foreign_key_check").all();
    if (foreignKeyFailures.length > 0) {
      throw new EtherDocumentError(
        "FOREIGN_KEY_CHECK_FAILED",
        `Ether document foreign key check found ${foreignKeyFailures.length} violation(s).`
      );
    }

    return { document, path: filePath, pragmas, quickCheck: "ok" };
  } catch (error) {
    if (error instanceof EtherDocumentError) {
      throw error;
    }
    throw new EtherDocumentError("INVALID_SQLITE", "Ether document validation failed.", {
      cause: error
    });
  } finally {
    database.close();
  }
}
