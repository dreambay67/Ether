import {
  DocumentHeaderSchema,
  ETHER_FORMAT_MARKER,
  ETHER_FORMAT_VERSION,
  ETHER_SCHEMA_VERSION,
  ETHER_SQLITE_APPLICATION_ID
} from "@ether/schema";
import {
  closeSync,
  lstatSync,
  openSync,
  readFileSync,
  readSync,
  type BigIntStats
} from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { DocumentHeader } from "@ether/schema";

import {
  ETHER_PROVISIONAL_PAGE_SIZE,
  ETHER_REQUIRED_FEATURE_PREFIX,
  ETHER_SUPPORTED_REQUIRED_FEATURES
} from "./format.js";

const SQLITE_HEADER_MAGIC = Buffer.from("SQLite format 3\0", "binary");
const SQLITE_HEADER_SIZE = 100;
const SQLITE_WRITE_VERSION_OFFSET = 18;
const SQLITE_READ_VERSION_OFFSET = 19;
const SQLITE_ROLLBACK_JOURNAL_VERSION = 1;
const SQLITE_WAL_VERSION = 2;
const SUPPORTED_FORMAT_MAJOR = 4;

export const ETHER_SCHEMA_SQL = readFileSync(new URL("./schema/40000.sql", import.meta.url), "utf8");

export type EtherDocumentErrorCode =
  | "NOT_A_REGULAR_FILE"
  | "INVALID_DESTINATION"
  | "DESTINATION_EXISTS"
  | "PERMISSION_DENIED"
  | "READ_ONLY"
  | "BUSY_OR_LOCKED"
  | "PUBLICATION_FAILED"
  | "ATOMIC_NO_CLOBBER_UNSUPPORTED"
  | "ATOMIC_REPLACE_UNSUPPORTED"
  | "PATH_CHANGED"
  | "HARD_LINK_ALIAS"
  | "INVALID_SQLITE_HEADER"
  | "UNSUPPORTED_JOURNAL_MODE"
  | "INVALID_SQLITE"
  | "WRONG_APPLICATION_ID"
  | "INVALID_DOCUMENT_METADATA"
  | "UNSUPPORTED_FORMAT"
  | "UNSUPPORTED_SCHEMA"
  | "UNSUPPORTED_REQUIRED_FEATURE"
  | "SCHEMA_MISMATCH"
  | "FTS_INDEX_MISMATCH"
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

export interface EtherFileIdentity {
  birthtimeNs: bigint;
  dev: bigint;
  ino: bigint;
  size: bigint;
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

interface SchemaObject {
  name: string;
  sql: string | null;
  type: string;
}

let expectedSchemaObjects: SchemaObject[] | undefined;

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function mapEtherDocumentError(
  error: unknown,
  fallback: EtherDocumentErrorCode,
  message: string
): EtherDocumentError {
  if (error instanceof EtherDocumentError) {
    return error;
  }

  const code = errorCode(error);
  const detail = errorMessage(error).toLowerCase();
  if (code === "EACCES" || code === "EPERM" || detail.includes("permission denied")) {
    return new EtherDocumentError("PERMISSION_DENIED", message, { cause: error });
  }
  if (code === "EROFS" || detail.includes("readonly") || detail.includes("read-only")) {
    return new EtherDocumentError("READ_ONLY", message, { cause: error });
  }
  if (
    code === "SQLITE_BUSY" ||
    code === "SQLITE_LOCKED" ||
    detail.includes("database is locked") ||
    detail.includes("database table is locked") ||
    detail.includes("database is busy")
  ) {
    return new EtherDocumentError("BUSY_OR_LOCKED", message, { cause: error });
  }
  return new EtherDocumentError(fallback, message, { cause: error });
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

function identityFromStats(stats: BigIntStats): EtherFileIdentity {
  return {
    birthtimeNs: stats.birthtimeNs,
    dev: stats.dev,
    ino: stats.ino,
    size: stats.size
  };
}

function assertRegularStats(filePath: string, stats: BigIntStats): void {
  if (!stats.isFile()) {
    throw new EtherDocumentError(
      "NOT_A_REGULAR_FILE",
      `Ether document must be a regular file: ${filePath}`
    );
  }
  if (stats.nlink > 1n) {
    throw new EtherDocumentError(
      "HARD_LINK_ALIAS",
      `Ether document has ${String(stats.nlink)} hard-link aliases and cannot be opened safely.`
    );
  }
}

function readStats(filePath: string, changed: boolean): BigIntStats {
  try {
    return lstatSync(filePath, { bigint: true });
  } catch (error) {
    const code = errorCode(error);
    if (code === "EACCES" || code === "EPERM") {
      throw new EtherDocumentError(
        "PERMISSION_DENIED",
        `Ether document is not accessible: ${filePath}`,
        { cause: error }
      );
    }
    throw new EtherDocumentError(
      changed ? "PATH_CHANGED" : "NOT_A_REGULAR_FILE",
      changed
        ? `Ether document path changed while it was being opened: ${filePath}`
        : `Ether document does not exist or is not accessible: ${filePath}`,
      { cause: error }
    );
  }
}

export function readEtherFileIdentity(filePath: string, changed = false): EtherFileIdentity {
  const stats = readStats(filePath, changed);
  assertRegularStats(filePath, stats);
  return identityFromStats(stats);
}

export function assertEtherFileIdentity(
  filePath: string,
  expected: EtherFileIdentity
): EtherFileIdentity {
  const actual = readEtherFileIdentity(filePath, true);
  if (
    actual.dev !== expected.dev ||
    actual.ino !== expected.ino ||
    actual.birthtimeNs !== expected.birthtimeNs ||
    actual.size !== expected.size
  ) {
    throw new EtherDocumentError(
      "PATH_CHANGED",
      `Ether document path changed while it was being opened: ${filePath}`
    );
  }
  return actual;
}

function readSqliteHeader(filePath: string): Buffer {
  const header = Buffer.alloc(SQLITE_HEADER_SIZE);
  let file: number;
  try {
    file = openSync(filePath, "r");
  } catch (error) {
    throw mapEtherDocumentError(
      error,
      "NOT_A_REGULAR_FILE",
      `Ether document header cannot be read: ${filePath}`
    );
  }
  const bytesRead = (() => {
    try {
      return readSync(file, header, 0, header.length, 0);
    } finally {
      closeSync(file);
    }
  })();
  if (
    bytesRead !== SQLITE_HEADER_SIZE ||
    !header.subarray(0, SQLITE_HEADER_MAGIC.length).equals(SQLITE_HEADER_MAGIC)
  ) {
    throw new EtherDocumentError(
      "INVALID_SQLITE_HEADER",
      `Ether document has an invalid SQLite header: ${filePath}`
    );
  }
  return header;
}

export function inspectEtherFileHeader(filePath: string): EtherFileIdentity {
  const identity = readEtherFileIdentity(filePath);
  const header = readSqliteHeader(filePath);
  assertEtherFileIdentity(filePath, identity);

  const writeVersion = header[SQLITE_WRITE_VERSION_OFFSET];
  const readVersion = header[SQLITE_READ_VERSION_OFFSET];
  if (writeVersion === SQLITE_WAL_VERSION || readVersion === SQLITE_WAL_VERSION) {
    throw new EtherDocumentError(
      "UNSUPPORTED_JOURNAL_MODE",
      "Ether document uses WAL journal mode, which is not supported."
    );
  }
  if (
    writeVersion !== SQLITE_ROLLBACK_JOURNAL_VERSION ||
    readVersion !== SQLITE_ROLLBACK_JOURNAL_VERSION
  ) {
    throw new EtherDocumentError(
      "INVALID_SQLITE_HEADER",
      `Ether document has unsupported SQLite read/write versions ${readVersion}/${writeVersion}.`
    );
  }
  return identity;
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

function normalizeSchemaSql(sql: string | null): string | null {
  return sql === null ? null : sql.replace(/\s+/g, " ").trim();
}

function readSchemaObjects(database: DatabaseSync): SchemaObject[] {
  const rows = database
    .prepare(
      `SELECT type, name, sql
       FROM sqlite_schema
       WHERE name NOT LIKE 'sqlite_%'
       ORDER BY type, name`
    )
    .all() as unknown as SchemaObject[];
  return rows.map((row) => ({ ...row, sql: normalizeSchemaSql(row.sql) }));
}

function getExpectedSchemaObjects(): SchemaObject[] {
  if (expectedSchemaObjects !== undefined) {
    return expectedSchemaObjects;
  }
  const database = new DatabaseSync(":memory:", {
    allowExtension: false,
    enableDoubleQuotedStringLiterals: false,
    enableForeignKeyConstraints: true
  });
  try {
    database.exec(ETHER_SCHEMA_SQL);
    expectedSchemaObjects = readSchemaObjects(database);
    return expectedSchemaObjects;
  } finally {
    database.close();
  }
}

function assertSchema(database: DatabaseSync): void {
  const expected = getExpectedSchemaObjects();
  const actual = readSchemaObjects(database);
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    return;
  }

  const actualByKey = new Map(actual.map((object) => [`${object.type}:${object.name}`, object]));
  const expectedByKey = new Map(expected.map((object) => [`${object.type}:${object.name}`, object]));
  const missing = [...expectedByKey.keys()].filter((key) => !actualByKey.has(key));
  const unexpected = [...actualByKey.keys()].filter((key) => !expectedByKey.has(key));
  const changed = [...expectedByKey.entries()]
    .filter(([key, object]) => {
      const actualObject = actualByKey.get(key);
      return actualObject !== undefined && actualObject.sql !== object.sql;
    })
    .map(([key]) => key);
  const details = [
    missing.length > 0 ? `missing ${missing.join(", ")}` : undefined,
    unexpected.length > 0 ? `unexpected ${unexpected.join(", ")}` : undefined,
    changed.length > 0 ? `changed ${changed.join(", ")}` : undefined
  ].filter((value): value is string => value !== undefined);
  throw new EtherDocumentError(
    "SCHEMA_MISMATCH",
    `Ether document schema does not match schema ${ETHER_SCHEMA_VERSION}: ${details.join("; ")}.`
  );
}

const FTS_PARITY_QUERIES = [
  {
    actual: "SELECT source_type, source_id, title, body, metadata FROM prompt_output_fts",
    expected: `
      SELECT 'prompt' AS source_type, node_id AS source_id, title,
             config_json AS body, presentation_json AS metadata
      FROM nodes
      UNION ALL
      SELECT 'output' AS source_type, payload_id AS source_id,
             channel || ':' || role AS title,
             coalesce(content_text, content_json) AS body,
             metadata_json AS metadata
      FROM node_output_payloads
    `,
    name: "prompt_output_fts"
  },
  {
    actual: "SELECT artifact_id, title, description, metadata FROM artifact_fts",
    expected: `
      SELECT artifact_id, title, description, metadata_json AS metadata
      FROM artifacts
    `,
    name: "artifact_fts"
  },
  {
    actual: "SELECT artifact_id, tag FROM tag_fts",
    expected: "SELECT artifact_id, tag FROM artifact_tags",
    name: "tag_fts"
  },
  {
    actual: `
      SELECT provider_run_id, provider_id, model_id, request, response, metadata
      FROM run_fts
    `,
    expected: `
      SELECT provider_run_id, provider_id, model_id,
             request_json AS request, coalesce(response_json, '') AS response,
             metadata_json AS metadata
      FROM provider_runs
    `,
    name: "run_fts"
  },
  {
    actual: "SELECT entity_type, entity_id, metadata FROM metadata_fts",
    expected: `
      SELECT 'document' AS entity_type, document_id AS entity_id,
             title || ' ' || feature_flags_json AS metadata
      FROM document
      UNION ALL
      SELECT 'artifact' AS entity_type, artifact_id AS entity_id,
             metadata_json AS metadata
      FROM artifacts
    `,
    name: "metadata_fts"
  }
] as const;

function comparableRows(database: DatabaseSync, sql: string): string[] {
  return (database.prepare(sql).all() as Record<string, unknown>[])
    .map((row) => JSON.stringify(row))
    .sort();
}

function assertFtsParity(database: DatabaseSync): void {
  for (const query of FTS_PARITY_QUERIES) {
    const expected = comparableRows(database, query.expected);
    const actual = comparableRows(database, query.actual);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new EtherDocumentError(
        "FTS_INDEX_MISMATCH",
        `Ether document FTS index ${query.name} does not match its source rows.`
      );
    }
  }
}

export function validateEtherDocumentConnection(
  database: DatabaseSync,
  filePath: string
): EtherDocumentInspection {
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
  assertSchema(database);
  assertFtsParity(database);

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
}

export function inspectEtherDocument(filePath: string): EtherDocumentInspection {
  const absolutePath = path.resolve(filePath);
  let database: DatabaseSync | undefined;
  try {
    const identity = inspectEtherFileHeader(absolutePath);
    database = new DatabaseSync(absolutePath, {
      allowExtension: false,
      enableDoubleQuotedStringLiterals: false,
      enableForeignKeyConstraints: true,
      readOnly: true
    });
    assertEtherFileIdentity(absolutePath, identity);
    const inspection = validateEtherDocumentConnection(database, absolutePath);
    assertEtherFileIdentity(absolutePath, identity);
    return inspection;
  } catch (error) {
    throw mapEtherDocumentError(error, "INVALID_SQLITE", "Ether document validation failed.");
  } finally {
    database?.close();
  }
}
