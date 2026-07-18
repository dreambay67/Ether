import {
  ETHER_DOCUMENT_FORMAT,
  ETHER_FTS_TABLES,
  ETHER_SCHEMA_TABLES,
  EtherDocumentError,
  assertEtherDocumentWritable,
  createEtherDocument,
  inspectEtherDocument
} from "@ether/document";
import * as documentPackage from "@ether/document";
import {
  ETHER_FORMAT_MARKER,
  ETHER_FORMAT_VERSION,
  ETHER_SCHEMA_VERSION,
  ETHER_SQLITE_APPLICATION_ID
} from "@ether/schema";
import {
  __setDocumentBoundaryTestHooks,
  type DocumentBoundaryTestHooks
} from "../../document/src/database.js";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

interface FileSnapshot {
  bytes: Buffer;
  mtimeNs: bigint;
}

interface NamedRow {
  name: string;
}

interface ForeignKeyRow {
  from: string;
  id: number;
  on_delete: string;
  seq: number;
  table: string;
  to: string;
}

interface IndexListRow {
  name: string;
}

interface IndexColumnRow {
  name: string;
  seqno: number;
}

function scalar(database: DatabaseSync, sql: string): unknown {
  const row = database.prepare(sql).get() as Record<string, unknown> | undefined;
  return row === undefined ? undefined : Object.values(row)[0];
}

function snapshotFile(filePath: string): FileSnapshot {
  return {
    bytes: readFileSync(filePath),
    mtimeNs: statSync(filePath, { bigint: true }).mtimeNs
  };
}

function expectFileUnchanged(filePath: string, before: FileSnapshot): void {
  const after = snapshotFile(filePath);
  expect(after.bytes.equals(before.bytes)).toBe(true);
  expect(after.mtimeNs).toBe(before.mtimeNs);
}

function mutateDatabase(filePath: string, sql: string): void {
  const database = new DatabaseSync(filePath, { enableForeignKeyConstraints: false });
  try {
    database.exec(sql);
  } finally {
    database.close();
  }
}

function openTestDatabase(filePath: string): DatabaseSync {
  return new DatabaseSync(filePath, {
    allowExtension: false,
    enableDoubleQuotedStringLiterals: false,
    enableForeignKeyConstraints: true
  });
}

function expectEtherError(action: () => unknown, code: string): EtherDocumentError {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(EtherDocumentError);
    expect((error as EtherDocumentError).code).toBe(code);
    return error as EtherDocumentError;
  }
  throw new Error(`Expected EtherDocumentError with code ${code}.`);
}

function withBoundaryHooks<T>(hooks: DocumentBoundaryTestHooks, operation: () => T): T {
  const restore = __setDocumentBoundaryTestHooks(hooks);
  try {
    return operation();
  } finally {
    restore();
  }
}

function injectedFsError(code: string, message: string): NodeJS.ErrnoException {
  const error = new Error(message) as NodeJS.ErrnoException;
  error.code = code;
  return error;
}

function expectConstraintViolation(database: DatabaseSync, sql: string): void {
  expect(() => database.exec(sql)).toThrow(/constraint|foreign key/i);
}

function ftsIds(
  database: DatabaseSync,
  table: string,
  idColumn: string,
  query: string
): string[] {
  return (
    database.prepare(`SELECT ${idColumn} AS name FROM ${table} WHERE ${table} MATCH ?`).all(
      query
    ) as unknown as NamedRow[] | undefined
  )?.map((row) => row.name) ?? [];
}

function seedFtsParitySources(database: DatabaseSync): void {
  database.exec(`
    INSERT INTO graphs (graph_id, title, kind, created_at, updated_at)
    VALUES ('graph-parity', 'Parity graph', 'root', '2026-07-17T10:00:00.000Z', '2026-07-17T10:00:00.000Z');
    INSERT INTO nodes (
      node_id, graph_id, definition_id, title, position_x, position_y, width, height,
      config_json, presentation_json, created_at, updated_at
    ) VALUES (
      'node-parity', 'graph-parity', 'prompt.text', 'Parity prompt', 0, 0, 220, 140,
      '{"body":"source prompt"}', '{"color":"green"}',
      '2026-07-17T10:00:00.000Z', '2026-07-17T10:00:00.000Z'
    );
    INSERT INTO graph_revisions (
      revision_id, graph_id, parent_revision_id, actor, title, created_at, operation_count, metadata_json
    ) VALUES (
      'revision-parity', 'graph-parity', NULL, 'user', 'Parity revision',
      '2026-07-17T10:00:00.000Z', 0, '{}'
    );
    INSERT INTO node_output_versions (
      output_version_id, node_id, graph_id, graph_revision_id, parent_output_version_id,
      producer_json, input_payload_ids_json, selected_output_version_ids_json,
      compiled_context_hash, timing_json, created_at
    ) VALUES (
      'output-parity', 'node-parity', 'graph-parity', 'revision-parity', NULL,
      '{"kind":"manual"}', '[]', '[]', 'sha256:parity', '{}',
      '2026-07-17T10:00:01.000Z'
    );
    INSERT INTO node_output_payloads (
      payload_id, output_version_id, channel, role, content_text, content_json, metadata_json, created_at
    ) VALUES (
      'payload-parity', 'output-parity', 'text', 'general', 'source output',
      '{"kind":"text"}', '{"language":"en"}', '2026-07-17T10:00:01.000Z'
    );
    INSERT INTO artifacts (
      artifact_id, content_key, kind, media_type, source_output_version_id,
      source_payload_id, title, description, metadata_json, created_at
    ) VALUES (
      'artifact-parity', NULL, 'image', 'image/png', 'output-parity', 'payload-parity',
      'Parity artifact', 'source artifact',
      '{"camera":"source"}', '2026-07-17T10:00:02.000Z'
    );
    INSERT INTO artifact_tags (artifact_id, tag, created_at)
    VALUES ('artifact-parity', 'source-tag', '2026-07-17T10:00:02.000Z');
    INSERT INTO provider_runs (
      provider_run_id, provider_id, model_id, status, request_json, response_json, metadata_json,
      started_at, completed_at
    ) VALUES (
      'run-parity', 'codex', 'model-parity', 'succeeded', '{"prompt":"source run"}',
      '{"result":"source response"}', '{"region":"source"}',
      '2026-07-17T10:00:00.000Z', '2026-07-17T10:00:02.000Z'
    );
  `);
}

describe("Ether 4.0 document format", () => {
  let root: string;
  let documentPath: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "ether-document-format-"));
    documentPath = path.join(root, "Campaign.ether");
  });

  afterEach(() => {
    rmSync(root, { force: true, recursive: true });
  });

  it("exports closed document probes without exposing SQLite handles or package deep imports", () => {
    expect(Object.keys(documentPackage)).toContain("assertEtherDocumentWritable");
    expect(Object.keys(documentPackage)).not.toContain("openEtherDocument");
    expect(Object.keys(documentPackage)).not.toContain("DatabaseSync");

    const deepImport = spawnSync(
      process.execPath,
      ["--input-type=module", "--eval", "import('@ether/document/database')"],
      { cwd: path.join(import.meta.dirname, ".."), encoding: "utf8" }
    );
    expect(deepImport.status).not.toBe(0);
    expect(deepImport.stderr).toMatch(/ERR_PACKAGE_PATH_NOT_EXPORTED|not defined by "exports"/);
  });

  it("creates one validated Campaign.ether file with the provisional 4.0 identity", () => {
    const inspection = createEtherDocument(documentPath, {
      appVersion: "4.0.0",
      documentId: "document-campaign",
      title: "Campaign"
    });

    expect(statSync(documentPath).isFile()).toBe(true);
    expect(readdirSync(root)).toEqual(["Campaign.ether"]);
    expect(inspection.document).toMatchObject({
      appVersion: "4.0.0",
      documentId: "document-campaign",
      featureFlags: {},
      formatMarker: ETHER_FORMAT_MARKER,
      formatVersion: ETHER_FORMAT_VERSION,
      schemaVersion: ETHER_SCHEMA_VERSION,
      title: "Campaign"
    });
    expect(inspection.pragmas).toEqual({
      applicationId: ETHER_SQLITE_APPLICATION_ID,
      autoVacuum: 2,
      foreignKeys: 1,
      journalMode: "delete",
      pageSize: 16_384,
      synchronous: 2,
      userVersion: ETHER_SCHEMA_VERSION
    });
    expect(inspection.quickCheck).toBe("ok");
    expect(assertEtherDocumentWritable(documentPath)).toEqual(inspection);

    const database = openTestDatabase(documentPath);
    try {
      expect(scalar(database, "PRAGMA application_id")).toBe(ETHER_SQLITE_APPLICATION_ID);
      expect(scalar(database, "PRAGMA page_size")).toBe(16_384);
      expect(scalar(database, "PRAGMA auto_vacuum")).toBe(2);
      expect(String(scalar(database, "PRAGMA journal_mode")).toLowerCase()).toBe("delete");
      expect(scalar(database, "PRAGMA synchronous")).toBe(2);
      expect(scalar(database, "PRAGMA foreign_keys")).toBe(1);

      const allTables = (
        database
          .prepare(
            "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
          )
          .all() as unknown as NamedRow[]
      ).map((row) => row.name);
      const ftsShadowTables = new Set(
        ETHER_FTS_TABLES.flatMap((table) =>
          ["config", "content", "data", "docsize", "idx"].map((suffix) => `${table}_${suffix}`)
        )
      );
      expect(allTables.filter((table) => !ftsShadowTables.has(table))).toEqual(
        [...ETHER_SCHEMA_TABLES].sort()
      );
    } finally {
      database.close();
    }

    expect(readdirSync(root)).toEqual(["Campaign.ether"]);
    expect(statSync(path.join(root, "Campaign"), { throwIfNoEntry: false })).toBeUndefined();
    expect(statSync(`${documentPath}-wal`, { throwIfNoEntry: false })).toBeUndefined();
    expect(statSync(`${documentPath}-shm`, { throwIfNoEntry: false })).toBeUndefined();
    expect(statSync(`${documentPath}-journal`, { throwIfNoEntry: false })).toBeUndefined();
  });

  it("publishes safely without replacing existing files or directories", () => {
    expectEtherError(
      () =>
        createEtherDocument(path.join(root, "NotEther.sqlite"), {
          appVersion: "4.0.0",
          documentId: "document-invalid-destination",
          title: "Invalid destination"
        }),
      "INVALID_DESTINATION"
    );

    writeFileSync(documentPath, "keep this destination");
    const before = snapshotFile(documentPath);

    expectEtherError(() =>
      createEtherDocument(documentPath, {
        appVersion: "4.0.0",
        documentId: "document-collision",
        title: "Collision"
      }), "DESTINATION_EXISTS");
    expectFileUnchanged(documentPath, before);

    const directoryPath = path.join(root, "Directory.ether");
    mkdirSync(directoryPath);
    expectEtherError(() =>
      createEtherDocument(directoryPath, {
        appVersion: "4.0.0",
        documentId: "document-directory",
        title: "Directory"
      }), "DESTINATION_EXISTS");
    expect(statSync(directoryPath).isDirectory()).toBe(true);

    const failedPublicationPath = path.join(root, "UnsupportedFeature.ether");
    expectEtherError(() =>
      createEtherDocument(failedPublicationPath, {
        appVersion: "4.0.0",
        documentId: "document-unsupported-feature",
        featureFlags: { "required.future-renderer": true },
        title: "Unsupported feature"
      }), "UNSUPPORTED_REQUIRED_FEATURE");
    expect(statSync(failedPublicationPath, { throwIfNoEntry: false })).toBeUndefined();
    expect(readdirSync(root).filter((entry) => entry.includes(".ether-tmp-"))).toEqual([]);
  });

  it("preserves racing collisions during atomic hard-link publication", () => {
    withBoundaryHooks(
      {
        beforeHardLinkPublication: (_temporaryPath, destinationPath) => {
          writeFileSync(destinationPath, "racing owner");
        }
      },
      () => {
        expectEtherError(
          () =>
            createEtherDocument(documentPath, {
              appVersion: "4.0.0",
              documentId: "document-race",
              title: "Race"
            }),
          "DESTINATION_EXISTS"
        );
      }
    );
    expect(readFileSync(documentPath, "utf8")).toBe("racing owner");
    expect(readdirSync(root).filter((entry) => entry.includes(".ether-tmp-"))).toEqual([]);
  });

  it("reports unsupported atomic publication without weakening no-clobber guarantees", () => {
    for (const code of ["EPERM", "ENOTSUP", "EXDEV"]) {
      withBoundaryHooks(
        {
          beforeHardLinkPublication: () => {
            throw injectedFsError(code, "hard links unsupported");
          }
        },
        () => {
          expectEtherError(
            () =>
              createEtherDocument(documentPath, {
                appVersion: "4.0.0",
                documentId: `document-${code.toLowerCase()}`,
                title: code
              }),
            "ATOMIC_NO_CLOBBER_UNSUPPORTED"
          );
        }
      );
      expect(readdirSync(root)).toEqual([]);
    }
  });

  it("maps publication and permission failures without deleting paths it does not own", () => {
    for (const [code, expectedCode] of [
      ["EIO", "PUBLICATION_FAILED"],
      ["EACCES", "PERMISSION_DENIED"]
    ] as const) {
      withBoundaryHooks(
        {
          beforeHardLinkPublication: () => {
            throw injectedFsError(code, expectedCode);
          }
        },
        () => {
          expectEtherError(
            () =>
              createEtherDocument(documentPath, {
                appVersion: "4.0.0",
                documentId: `document-${code.toLowerCase()}`,
                title: expectedCode
              }),
            expectedCode
          );
        }
      );
      expect(readdirSync(root)).toEqual([]);
    }
  });

  it("reopens its owned temporary file without create capability or path-swap writes", () => {
    const replacementTarget = path.join(root, "ReplacementTarget.ether");
    createEtherDocument(replacementTarget, {
      appVersion: "4.0.0",
      documentId: "document-replacement-target",
      title: "Replacement target"
    });
    const targetBefore = snapshotFile(replacementTarget);
    let replacedTemporaryPath = "";

    withBoundaryHooks(
      {
        beforeTemporaryDatabaseOpen: (temporaryPath) => {
          replacedTemporaryPath = temporaryPath;
          rmSync(temporaryPath);
          linkSync(replacementTarget, temporaryPath);
        }
      },
      () =>
        expectEtherError(
          () =>
            createEtherDocument(documentPath, {
              appVersion: "4.0.0",
              documentId: "document-temp-swap",
              title: "Temporary swap"
            }),
          "HARD_LINK_ALIAS"
        )
    );

    expectFileUnchanged(replacementTarget, targetBefore);
    expect(statSync(documentPath, { throwIfNoEntry: false })).toBeUndefined();
    expect(statSync(replacedTemporaryPath, { bigint: true }).ino).toBe(
      statSync(replacementTarget, { bigint: true }).ino
    );
    expect(readdirSync(root).sort()).toEqual([
      path.basename(replacedTemporaryPath),
      "ReplacementTarget.ether"
    ].sort());
  });

  it("declares and indexes every normalized foreign-key boundary", () => {
    createEtherDocument(documentPath, {
      appVersion: "4.0.0",
      documentId: "document-foreign-keys",
      title: "Foreign keys"
    });
    const database = openTestDatabase(documentPath);

    try {
      const foreignKeys = new Map<string, ForeignKeyRow[]>();
      for (const table of ETHER_SCHEMA_TABLES.filter((name) => !name.endsWith("_fts"))) {
        const rows = database.prepare(`PRAGMA foreign_key_list("${table}")`).all() as unknown as
          ForeignKeyRow[];
        foreignKeys.set(table, rows);

        const indexes = database.prepare(`PRAGMA index_list("${table}")`).all() as unknown as
          IndexListRow[];
        const indexColumns = indexes.map((index) =>
          (database.prepare(`PRAGMA index_info("${index.name}")`).all() as unknown as IndexColumnRow[])
            .sort((left, right) => left.seqno - right.seqno)
            .map((column) => column.name)
        );
        for (const foreignKeyId of new Set(rows.map((row) => row.id))) {
          const foreignKeyColumns = rows
            .filter((row) => row.id === foreignKeyId)
            .sort((left, right) => left.seq - right.seq)
            .map((row) => row.from);
          expect(
            indexColumns.some((columns) =>
              foreignKeyColumns.every((column, index) => columns[index] === column)
            ),
            `${table}.${foreignKeyColumns.join(",")} needs a matching FK index`
          ).toBe(true);
        }
      }

      expect(foreignKeys.get("edges")).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ from: "source_node_id", table: "nodes", to: "node_id" }),
          expect.objectContaining({ from: "target_node_id", table: "nodes", to: "node_id" })
        ])
      );
      expect(foreignKeys.get("graph_revisions")).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            from: "parent_revision_id",
            table: "graph_revisions",
            to: "revision_id"
          }),
          expect.objectContaining({ from: "graph_id", table: "graph_revisions", to: "graph_id" })
        ])
      );
      expect(foreignKeys.get("document_revision_members")).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            from: "graph_revision_id",
            table: "graph_revisions",
            to: "revision_id"
          })
        ])
      );
      expect(foreignKeys.get("modules")).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ from: "parent_graph_id", table: "nodes", to: "graph_id" }),
          expect.objectContaining({ from: "node_id", table: "nodes", to: "node_id" })
        ])
      );
      expect(foreignKeys.get("work_items")).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ from: "job_id", table: "execution_jobs", to: "job_id" }),
          expect.objectContaining({ from: "step_id", table: "plan_steps", to: "step_id" })
        ])
      );
      expect(foreignKeys.get("provider_runs")).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ from: "work_item_id", table: "work_items" }),
          expect.objectContaining({ from: "attempt_id", table: "attempts" })
        ])
      );
      expect(foreignKeys.get("node_output_versions")).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ from: "node_id", table: "nodes", to: "node_id" }),
          expect.objectContaining({
            from: "graph_revision_id",
            table: "graph_revisions",
            to: "revision_id"
          }),
          expect.objectContaining({
            from: "parent_output_version_id",
            table: "node_output_versions",
            to: "output_version_id"
          })
        ])
      );

      expect(foreignKeys.get("node_output_payloads")).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ from: "artifact_id", table: "artifacts", to: "artifact_id" })
        ])
      );
      expect(foreignKeys.get("attempts")).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            from: "provider_run_id",
            table: "provider_runs",
            to: "provider_run_id"
          })
        ])
      );
      expect(
        foreignKeys
          .get("provider_runs")
          ?.filter((row) => ["plan_id", "step_id", "work_item_id", "attempt_id"].includes(row.from))
          .every((row) => row.on_delete === "RESTRICT")
      ).toBe(true);
      expect(
        foreignKeys
          .get("node_output_versions")
          ?.filter((row) => ["run_id", "step_id", "work_item_id", "attempt_id"].includes(row.from))
          .every((row) => row.on_delete === "RESTRICT")
      ).toBe(true);
      expect(
        foreignKeys
          .get("attempts")
          ?.filter((row) => row.from === "provider_run_id")
          .every((row) => row.on_delete === "RESTRICT")
      ).toBe(true);
    } finally {
      database.close();
    }
  });

  it("enforces graph, revision, job, output, and provenance ownership in SQLite", () => {
    createEtherDocument(documentPath, {
      appVersion: "4.0.0",
      documentId: "document-semantic-ownership",
      title: "Semantic ownership"
    });
    const database = openTestDatabase(documentPath);

    try {
      database.exec(`
        INSERT INTO graphs (graph_id, title, kind, created_at, updated_at) VALUES
          ('graph-1', 'Graph 1', 'root', '2026-07-17T10:00:00.000Z', '2026-07-17T10:00:00.000Z'),
          ('graph-2', 'Graph 2', 'module', '2026-07-17T10:00:00.000Z', '2026-07-17T10:00:00.000Z');
        INSERT INTO nodes (
          node_id, graph_id, definition_id, title, position_x, position_y, width, height,
          config_json, presentation_json, created_at, updated_at
        ) VALUES
          ('node-1', 'graph-1', 'prompt.text', 'Node 1', 0, 0, 220, 140, '{}', '{}',
           '2026-07-17T10:00:00.000Z', '2026-07-17T10:00:00.000Z'),
          ('node-2', 'graph-2', 'prompt.text', 'Node 2', 0, 0, 220, 140, '{}', '{}',
           '2026-07-17T10:00:00.000Z', '2026-07-17T10:00:00.000Z');
        INSERT INTO graph_revisions (
          revision_id, graph_id, parent_revision_id, actor, title, created_at, operation_count, metadata_json
        ) VALUES
          ('revision-1', 'graph-1', NULL, 'user', 'Revision 1', '2026-07-17T10:00:00.000Z', 0, '{}'),
          ('revision-2', 'graph-2', NULL, 'user', 'Revision 2', '2026-07-17T10:00:00.000Z', 0, '{}');
        INSERT INTO document_revisions (
          document_revision_id, parent_document_revision_id, actor, title, created_at, metadata_json
        ) VALUES ('document-revision-1', NULL, 'user', 'Document revision', '2026-07-17T10:00:00.000Z', '{}');
      `);

      expectConstraintViolation(
        database,
        `INSERT INTO graph_revisions (
           revision_id, graph_id, parent_revision_id, actor, title, created_at, operation_count, metadata_json
         ) VALUES ('revision-cross-parent', 'graph-1', 'revision-2', 'user', 'Cross parent',
                   '2026-07-17T10:00:00.000Z', 0, '{}')`
      );
      database.exec(`
        INSERT INTO graph_revisions (
          revision_id, graph_id, parent_revision_id, actor, title, created_at, operation_count, metadata_json
        ) VALUES ('revision-1-child', 'graph-1', 'revision-1', 'user', 'Child revision',
                  '2026-07-17T10:00:00.000Z', 0, '{}');
      `);

      expectConstraintViolation(
        database,
        `INSERT INTO edges (
           edge_id, graph_id, source_node_id, source_channel, target_node_id, target_channel,
           role, lane_order, selector_json, adapter_json, enabled
         ) VALUES ('edge-cross-graph', 'graph-1', 'node-1', 'text', 'node-2', 'text',
                   'general', 0, '{}', '{}', 1)`
      );
      expectConstraintViolation(
        database,
        `INSERT INTO document_revision_members (
           document_revision_id, graph_id, graph_revision_id
         ) VALUES ('document-revision-1', 'graph-1', 'revision-2')`
      );
      expectConstraintViolation(
        database,
        `INSERT INTO node_output_versions (
           output_version_id, node_id, graph_id, graph_revision_id, parent_output_version_id,
           producer_json, input_payload_ids_json, selected_output_version_ids_json,
           compiled_context_hash, timing_json, created_at
         ) VALUES ('output-cross-graph', 'node-2', 'graph-1', 'revision-1', NULL,
                   '{"kind":"manual","actor":"user"}', '[]', '[]', 'sha256:context', '{}',
                   '2026-07-17T10:00:00.000Z')`
      );
      database.exec(`
        INSERT INTO node_output_versions (
          output_version_id, node_id, graph_id, graph_revision_id, parent_output_version_id,
          producer_json, input_payload_ids_json, selected_output_version_ids_json,
          compiled_context_hash, timing_json, created_at
        ) VALUES ('output-parent', 'node-1', 'graph-1', 'revision-1', NULL,
                  '{"kind":"manual"}', '[]', '[]', 'sha256:parent', '{}',
                  '2026-07-17T10:00:00.000Z');
      `);
      expectConstraintViolation(
        database,
        `INSERT INTO node_output_versions (
           output_version_id, node_id, graph_id, graph_revision_id, parent_output_version_id,
           producer_json, input_payload_ids_json, selected_output_version_ids_json,
           compiled_context_hash, timing_json, created_at
         ) VALUES ('output-cross-parent', 'node-2', 'graph-2', 'revision-2', 'output-parent',
                   '{"kind":"manual"}', '[]', '[]', 'sha256:cross-parent', '{}',
                   '2026-07-17T10:00:00.000Z')`
      );
      database.exec(`
        INSERT INTO node_output_versions (
          output_version_id, node_id, graph_id, graph_revision_id, parent_output_version_id,
          producer_json, input_payload_ids_json, selected_output_version_ids_json,
          compiled_context_hash, timing_json, created_at
        ) VALUES ('output-child', 'node-1', 'graph-1', 'revision-1-child', 'output-parent',
                  '{"kind":"manual"}', '[]', '[]', 'sha256:child', '{}',
                  '2026-07-17T10:00:00.000Z');
      `);

      database.exec(`
        INSERT INTO execution_plans (
          plan_id, document_revision_id, graph_id, graph_revision_id, capsule_version,
          hash_version, content_hash, scope_json, capsule_json, status, created_at, updated_at
        ) VALUES
          ('plan-1', 'document-revision-1', 'graph-1', 'revision-1', 1, 'sha256-v1',
           'sha256:v1:1111111111111111111111111111111111111111111111111111111111111111',
           '{"kind":"graph"}', '{"id":"plan-1"}', 'previewed',
           '2026-07-17T10:00:00.000Z', '2026-07-17T10:00:00.000Z'),
          ('plan-2', 'document-revision-1', 'graph-1', 'revision-1', 1, 'sha256-v1',
           'sha256:v1:2222222222222222222222222222222222222222222222222222222222222222',
           '{"kind":"graph"}', '{"id":"plan-2"}', 'previewed',
           '2026-07-17T10:00:00.000Z', '2026-07-17T10:00:00.000Z');
        INSERT INTO plan_steps (
          step_id, plan_id, node_id, step_order, dependencies_json, config_json, status
        ) VALUES
          ('step-1', 'plan-1', 'node-1', 0, '[]', '{}', 'ready'),
          ('step-2', 'plan-2', 'node-1', 0, '[]', '{}', 'ready');
        INSERT INTO execution_jobs (
          job_id, plan_id, plan_content_hash, start_command_id, status, created_at
        ) VALUES
          ('job-1', 'plan-1', 'sha256:v1:1111111111111111111111111111111111111111111111111111111111111111',
           'start-1', 'queued', '2026-07-17T10:00:00.000Z'),
          ('job-2', 'plan-2', 'sha256:v1:2222222222222222222222222222222222222222222222222222222222222222',
           'start-2', 'queued', '2026-07-17T10:00:00.000Z');
      `);

      expectConstraintViolation(
        database,
        `INSERT INTO work_items (
           work_item_id, job_id, step_id, planned_work_item_id, item_index, input_json,
           status, created_at, updated_at
         ) VALUES ('work-cross-plan', 'job-1', 'step-2', 'planned-cross', 0, '{}', 'queued',
                   '2026-07-17T10:00:00.000Z', '2026-07-17T10:00:00.000Z')`
      );

      database.exec(`
        INSERT INTO work_items (
          work_item_id, job_id, step_id, planned_work_item_id, item_index, input_json,
          status, created_at, updated_at
        ) VALUES
          ('work-1', 'job-1', 'step-1', 'planned-1', 0, '{}', 'running',
           '2026-07-17T10:00:00.000Z', '2026-07-17T10:00:00.000Z'),
          ('work-2', 'job-1', 'step-1', 'planned-2', 1, '{}', 'queued',
           '2026-07-17T10:00:00.000Z', '2026-07-17T10:00:00.000Z');
        INSERT INTO attempts (
          attempt_id, work_item_id, attempt_number, provider_attempt_id, provider_run_id,
          status, output_version_ids_json, error_json, created_at, started_at, completed_at
        ) VALUES
          ('attempt-1', 'work-1', 1, 'provider-attempt-1', NULL, 'running', '[]', NULL,
           '2026-07-17T10:00:00.000Z', '2026-07-17T10:00:00.000Z', NULL),
          ('attempt-2', 'work-1', 2, 'provider-attempt-2', NULL, 'queued', '[]', NULL,
           '2026-07-17T10:00:00.000Z', NULL, NULL),
          ('attempt-3', 'work-2', 1, 'provider-attempt-3', NULL, 'queued', '[]', NULL,
           '2026-07-17T10:00:00.000Z', NULL, NULL);
      `);

      expectConstraintViolation(
        database,
        `INSERT INTO provider_runs (
           provider_run_id, plan_id, step_id, work_item_id, attempt_id, provider_attempt_id,
           provider_id, model_id,
           status, request_json, response_json, metadata_json, started_at, completed_at
         ) VALUES ('run-cross-job', 'plan-1', 'step-2', 'work-1', 'attempt-1',
                   'provider-attempt-cross', 'codex', 'model',
                   'running', '{}', NULL, '{}', '2026-07-17T10:00:00.000Z', NULL)`
      );

      database.exec(`
        INSERT INTO provider_runs (
          provider_run_id, plan_id, step_id, work_item_id, attempt_id, provider_attempt_id,
          provider_id, model_id,
          status, request_json, response_json, metadata_json, started_at, completed_at
        ) VALUES ('run-1', 'plan-1', 'step-1', 'work-1', 'attempt-1', 'provider-attempt-1',
                  'codex', 'model',
                  'running', '{}', NULL, '{}', '2026-07-17T10:00:00.000Z', NULL);
      `);
      expectConstraintViolation(
        database,
        `INSERT INTO node_output_versions (
           output_version_id, node_id, graph_id, graph_revision_id, parent_output_version_id,
           producer_json, input_payload_ids_json, selected_output_version_ids_json,
           compiled_context_hash, run_id, step_id, work_item_id, attempt_id, timing_json, created_at
         ) VALUES ('output-cross-run', 'node-1', 'graph-1', 'revision-1', NULL,
                   '{"kind":"provider"}', '[]', '[]', 'sha256:context',
                   'job-1', 'step-2', 'work-1', 'attempt-1', '{}',
                   '2026-07-17T10:00:00.000Z')`
      );

      expectConstraintViolation(
        database,
        "UPDATE attempts SET provider_run_id = 'run-1' WHERE attempt_id = 'attempt-2'"
      );
      expectConstraintViolation(
        database,
        "UPDATE attempts SET provider_run_id = 'run-1' WHERE attempt_id = 'attempt-3'"
      );
      database.exec("UPDATE attempts SET provider_run_id = 'run-1' WHERE attempt_id = 'attempt-1'");

      database.exec(`
        INSERT INTO node_output_versions (
          output_version_id, node_id, graph_id, graph_revision_id, parent_output_version_id,
          producer_json, input_payload_ids_json, selected_output_version_ids_json,
          compiled_context_hash, run_id, step_id, work_item_id, attempt_id, timing_json, created_at
        ) VALUES ('output-run-1', 'node-1', 'graph-1', 'revision-1', NULL,
                  '{"kind":"provider"}', '[]', '[]', 'sha256:run-1',
                  'job-1', 'step-1', 'work-1', 'attempt-1', '{}',
                  '2026-07-17T10:00:00.000Z');
      `);
      expectConstraintViolation(database, "DELETE FROM work_items WHERE work_item_id = 'work-1'");
      expect(() =>
        database.exec("DELETE FROM execution_plans WHERE plan_id = 'plan-1'")
      ).toThrow(/immutable plan capsule/i);
      expectConstraintViolation(database, "DELETE FROM provider_runs WHERE provider_run_id = 'run-1'");
      expect(
        database
          .prepare(
            `SELECT plan_id, step_id, work_item_id, attempt_id
             FROM provider_runs WHERE provider_run_id = 'run-1'`
          )
          .get()
      ).toEqual({
        attempt_id: "attempt-1",
        plan_id: "plan-1",
        step_id: "step-1",
        work_item_id: "work-1"
      });
      expect(
        database
          .prepare("SELECT provider_run_id FROM attempts WHERE attempt_id = 'attempt-1'")
          .get()
      ).toEqual({ provider_run_id: "run-1" });

      expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      database.close();
    }
  });

  it("enforces module parent-node ownership and module-kind internal graphs", () => {
    createEtherDocument(documentPath, {
      appVersion: "4.0.0",
      documentId: "document-module-ownership",
      title: "Module ownership"
    });
    const database = openTestDatabase(documentPath);

    try {
      database.exec(`
        INSERT INTO graphs (graph_id, title, kind, created_at, updated_at) VALUES
          ('graph-parent', 'Parent', 'root', '2026-07-17T10:00:00.000Z', '2026-07-17T10:00:00.000Z'),
          ('graph-other', 'Other', 'root', '2026-07-17T10:00:00.000Z', '2026-07-17T10:00:00.000Z'),
          ('graph-internal', 'Internal', 'module', '2026-07-17T10:00:00.000Z', '2026-07-17T10:00:00.000Z'),
          ('graph-shared', 'Shared', 'module', '2026-07-17T10:00:00.000Z', '2026-07-17T10:00:00.000Z'),
          ('graph-root-internal', 'Root internal', 'root', '2026-07-17T10:00:00.000Z', '2026-07-17T10:00:00.000Z');
        INSERT INTO nodes (
          node_id, graph_id, definition_id, title, position_x, position_y, width, height,
          config_json, presentation_json, created_at, updated_at
        ) VALUES
          ('node-host', 'graph-parent', 'module', 'Host', 0, 0, 220, 140, '{}', '{}',
           '2026-07-17T10:00:00.000Z', '2026-07-17T10:00:00.000Z'),
          ('node-other', 'graph-other', 'module', 'Other host', 0, 0, 220, 140, '{}', '{}',
           '2026-07-17T10:00:00.000Z', '2026-07-17T10:00:00.000Z'),
          ('node-shared', 'graph-shared', 'module', 'Shared host', 0, 0, 220, 140, '{}', '{}',
           '2026-07-17T10:00:00.000Z', '2026-07-17T10:00:00.000Z');
      `);

      expectConstraintViolation(
        database,
        `INSERT INTO modules (
           module_id, parent_graph_id, internal_graph_id, node_id, title, metadata_json, created_at, updated_at
         ) VALUES ('module-cross-parent', 'graph-parent', 'graph-internal', 'node-other',
                   'Cross parent', '{}', '2026-07-17T10:00:00.000Z', '2026-07-17T10:00:00.000Z')`
      );
      expectConstraintViolation(
        database,
        `INSERT INTO modules (
           module_id, parent_graph_id, internal_graph_id, node_id, title, metadata_json, created_at, updated_at
         ) VALUES ('module-same-graph', 'graph-shared', 'graph-shared', 'node-shared',
                   'Same graph', '{}', '2026-07-17T10:00:00.000Z', '2026-07-17T10:00:00.000Z')`
      );
      expectConstraintViolation(
        database,
        `INSERT INTO modules (
           module_id, parent_graph_id, internal_graph_id, node_id, title, metadata_json, created_at, updated_at
         ) VALUES ('module-root-internal', 'graph-parent', 'graph-root-internal', 'node-host',
                   'Root internal', '{}', '2026-07-17T10:00:00.000Z', '2026-07-17T10:00:00.000Z')`
      );

      database.exec(`
        INSERT INTO modules (
          module_id, parent_graph_id, internal_graph_id, node_id, title, metadata_json, created_at, updated_at
        ) VALUES ('module-valid', 'graph-parent', 'graph-internal', 'node-host',
                  'Valid module', '{}', '2026-07-17T10:00:00.000Z', '2026-07-17T10:00:00.000Z');
      `);
      expectConstraintViolation(
        database,
        "UPDATE modules SET internal_graph_id = 'graph-root-internal' WHERE module_id = 'module-valid'"
      );
      expectConstraintViolation(
        database,
        "UPDATE graphs SET kind = 'root' WHERE graph_id = 'graph-internal'"
      );

      expect(
        database
          .prepare(
            `SELECT parent_graph_id, internal_graph_id, node_id
             FROM modules WHERE module_id = 'module-valid'`
          )
          .get()
      ).toEqual({
        internal_graph_id: "graph-internal",
        node_id: "node-host",
        parent_graph_id: "graph-parent"
      });
      expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      database.close();
    }

    expect(inspectEtherDocument(documentPath).document.documentId).toBe(
      "document-module-ownership"
    );
  });

  it("keeps prompt, output, artifact, tag, run, and metadata FTS indexes synchronized", () => {
    createEtherDocument(documentPath, {
      appVersion: "4.0.0",
      documentId: "document-search",
      title: "Cobalt campaign metadata"
    });
    const database = openTestDatabase(documentPath);

    try {
      database.exec(`
        INSERT INTO graphs (graph_id, title, kind, created_at, updated_at)
        VALUES ('graph-root', 'Campaign graph', 'root', '2026-07-17T10:00:00.000Z', '2026-07-17T10:00:00.000Z');
        INSERT INTO nodes (
          node_id, graph_id, definition_id, title, position_x, position_y, width, height,
          config_json, presentation_json, created_at, updated_at
        ) VALUES (
          'node-prompt', 'graph-root', 'prompt.text', 'Hero prompt', 0, 0, 220, 140,
          '{"body":"luminous zeppelin"}', '{}',
          '2026-07-17T10:00:00.000Z', '2026-07-17T10:00:00.000Z'
        );
        INSERT INTO graph_revisions (
          revision_id, graph_id, parent_revision_id, actor, title, created_at, operation_count, metadata_json
        ) VALUES (
          'revision-1', 'graph-root', NULL, 'user', 'Initial', '2026-07-17T10:00:00.000Z', 0, '{}'
        );
        INSERT INTO node_output_versions (
          output_version_id, node_id, graph_id, graph_revision_id, parent_output_version_id,
          producer_json, input_payload_ids_json, selected_output_version_ids_json,
          compiled_context_hash, timing_json, created_at
        ) VALUES (
          'output-1', 'node-prompt', 'graph-root', 'revision-1', NULL,
          '{"kind":"manual","actor":"user"}', '[]', '[]', 'sha256:context',
          '{"startedAt":"2026-07-17T10:00:00.000Z","completedAt":"2026-07-17T10:00:01.000Z"}',
          '2026-07-17T10:00:01.000Z'
        );
        INSERT INTO node_output_payloads (
          payload_id, output_version_id, channel, role, content_text, content_json, metadata_json, created_at
        ) VALUES (
          'payload-1', 'output-1', 'text', 'general', 'velvet horizon',
          '{"kind":"text"}', '{}', '2026-07-17T10:00:01.000Z'
        );
        INSERT INTO artifacts (
          artifact_id, content_key, kind, media_type, source_output_version_id,
          source_payload_id, title, description, metadata_json, created_at
        ) VALUES (
          'artifact-1', NULL, 'image', 'image/png', 'output-1', 'payload-1',
          'Aurora frame', 'magenta skyline',
          '{"camera":"orbital"}', '2026-07-17T10:00:02.000Z'
        );
        INSERT INTO artifact_tags (artifact_id, tag, created_at)
        VALUES ('artifact-1', 'editorial', '2026-07-17T10:00:02.000Z');
        INSERT INTO provider_runs (
          provider_run_id, provider_id, model_id, status, request_json, response_json, metadata_json,
          started_at, completed_at
        ) VALUES (
          'run-1', 'codex', 'gpt-image', 'succeeded', '{"prompt":"prismatic"}',
          '{"result":"radiant"}', '{"region":"studio"}',
          '2026-07-17T10:00:00.000Z', '2026-07-17T10:00:02.000Z'
        );
      `);

      expect(ftsIds(database, "prompt_output_fts", "source_id", "zeppelin")).toEqual([
        "node-prompt"
      ]);
      expect(ftsIds(database, "prompt_output_fts", "source_id", "horizon")).toEqual(["payload-1"]);
      expect(ftsIds(database, "artifact_fts", "artifact_id", "skyline")).toEqual(["artifact-1"]);
      expect(ftsIds(database, "tag_fts", "artifact_id", "editorial")).toEqual(["artifact-1"]);
      expect(ftsIds(database, "run_fts", "provider_run_id", "prismatic")).toEqual(["run-1"]);
      expect(ftsIds(database, "metadata_fts", "entity_id", "orbital")).toEqual(["artifact-1"]);
      expect(ftsIds(database, "metadata_fts", "entity_id", "cobalt")).toEqual(["document-search"]);

      database.exec(`
        UPDATE artifacts
        SET title = 'Nocturne frame', description = 'indigo skyline', metadata_json = '{"camera":"terrestrial"}'
        WHERE artifact_id = 'artifact-1';
        DELETE FROM artifact_tags WHERE artifact_id = 'artifact-1' AND tag = 'editorial';
        UPDATE nodes SET config_json = '{"body":"silver airship"}' WHERE node_id = 'node-prompt';
      `);

      expect(ftsIds(database, "artifact_fts", "artifact_id", "magenta")).toEqual([]);
      expect(ftsIds(database, "artifact_fts", "artifact_id", "indigo")).toEqual(["artifact-1"]);
      expect(ftsIds(database, "tag_fts", "artifact_id", "editorial")).toEqual([]);
      expect(ftsIds(database, "prompt_output_fts", "source_id", "zeppelin")).toEqual([]);
      expect(ftsIds(database, "prompt_output_fts", "source_id", "airship")).toEqual([
        "node-prompt"
      ]);
      expect(ftsIds(database, "metadata_fts", "entity_id", "orbital")).toEqual([]);
      expect(ftsIds(database, "metadata_fts", "entity_id", "terrestrial")).toEqual([
        "artifact-1"
      ]);

      database.exec("DELETE FROM artifacts WHERE artifact_id = 'artifact-1'");
      expect(ftsIds(database, "artifact_fts", "artifact_id", "indigo")).toEqual([]);
      expect(ftsIds(database, "metadata_fts", "entity_id", "terrestrial")).toEqual([]);
    } finally {
      database.close();
    }
  });

  it("rejects missing, stale, extra, or mismatched rows in every FTS index", () => {
    createEtherDocument(documentPath, {
      appVersion: "4.0.0",
      documentId: "document-fts-parity",
      title: "FTS parity"
    });
    const database = openTestDatabase(documentPath);
    try {
      seedFtsParitySources(database);
    } finally {
      database.close();
    }

    const fixtures = [
      ["MissingPromptFts.ether", "DELETE FROM prompt_output_fts WHERE source_type = 'prompt'"],
      [
        "StaleArtifactFts.ether",
        "UPDATE artifact_fts SET title = 'stale title' WHERE artifact_id = 'artifact-parity'"
      ],
      ["ExtraTagFts.ether", "INSERT INTO tag_fts (artifact_id, tag) VALUES ('extra', 'extra')"],
      [
        "MismatchedRunFts.ether",
        "UPDATE run_fts SET request = 'mismatched request' WHERE provider_run_id = 'run-parity'"
      ],
      [
        "MissingMetadataFts.ether",
        "DELETE FROM metadata_fts WHERE entity_type = 'document'"
      ]
    ] as const;

    for (const [fileName, mutation] of fixtures) {
      const filePath = path.join(root, fileName);
      copyFileSync(documentPath, filePath);
      mutateDatabase(filePath, mutation);
      const before = snapshotFile(filePath);

      expectEtherError(() => inspectEtherDocument(filePath), "FTS_INDEX_MISMATCH");
      expectEtherError(() => assertEtherDocumentWritable(filePath), "FTS_INDEX_MISMATCH");
      expectFileUnchanged(filePath, before);
    }
  });

  it("refuses invalid and non-Ether SQLite files without changing bytes or mtime", () => {
    const invalidPath = path.join(root, "Invalid.ether");
    writeFileSync(invalidPath, "not a SQLite database");

    const nonEtherPath = path.join(root, "Other.ether");
    const nonEther = new DatabaseSync(nonEtherPath);
    nonEther.exec("CREATE TABLE other_data (value TEXT)");
    nonEther.close();

    const wrongApplicationPath = path.join(root, "WrongApplication.ether");
    const wrongApplication = new DatabaseSync(wrongApplicationPath);
    wrongApplication.exec("PRAGMA application_id = 1234; CREATE TABLE document (value TEXT)");
    wrongApplication.close();

    for (const [filePath, expectedCode] of [
      [invalidPath, "INVALID_SQLITE_HEADER"],
      [nonEtherPath, "WRONG_APPLICATION_ID"],
      [wrongApplicationPath, "WRONG_APPLICATION_ID"]
    ] as const) {
      const before = snapshotFile(filePath);
      expectEtherError(() => inspectEtherDocument(filePath), expectedCode);
      expectEtherError(() => assertEtherDocumentWritable(filePath), expectedCode);
      expectFileUnchanged(filePath, before);
    }
  });

  it("refuses WAL-mode candidates without creating adjacent files or changing the document", () => {
    createEtherDocument(documentPath, {
      appVersion: "4.0.0",
      documentId: "document-wal-candidate",
      title: "WAL candidate"
    });
    const walDatabase = new DatabaseSync(documentPath);
    try {
      expect(String(scalar(walDatabase, "PRAGMA journal_mode = WAL")).toLowerCase()).toBe("wal");
    } finally {
      walDatabase.close();
    }

    const directoryBefore = readdirSync(root).sort();
    const fileBefore = snapshotFile(documentPath);
    expect(directoryBefore).toEqual(["Campaign.ether"]);

    for (const operation of [inspectEtherDocument, assertEtherDocumentWritable]) {
      expectEtherError(() => operation(documentPath), "UNSUPPORTED_JOURNAL_MODE");
      expect(readdirSync(root).sort()).toEqual(directoryBefore);
      expectFileUnchanged(documentPath, fileBefore);
    }
  });

  it("uses no-create private-cache file URLs for missing and Unicode writable paths", () => {
    const unicodePath = path.join(root, "Kampaň žltý mesiac.ether");
    createEtherDocument(unicodePath, {
      appVersion: "4.0.0",
      documentId: "document-unicode",
      title: "Unicode"
    });
    let openedLocation = "";
    withBoundaryHooks(
      {
        afterWritableOpen: (location) => {
          openedLocation = location;
        }
      },
      () => expect(assertEtherDocumentWritable(unicodePath).document.documentId).toBe("document-unicode")
    );
    expect(path.resolve(openedLocation)).toBe(path.resolve(unicodePath));

    const removedPath = path.join(root, "Removed before open.ether");
    createEtherDocument(removedPath, {
      appVersion: "4.0.0",
      documentId: "document-removed",
      title: "Removed"
    });
    withBoundaryHooks(
      {
        beforeWritableDatabaseOpen: () => rmSync(removedPath)
      },
      () => expectEtherError(() => assertEtherDocumentWritable(removedPath), "PATH_CHANGED")
    );
    expect(statSync(removedPath, { throwIfNoEntry: false })).toBeUndefined();
    expect(readdirSync(root).sort()).toEqual(["Kampaň žltý mesiac.ether"]);
  });

  it("detects deterministic path swaps before writable validation", () => {
    const replacementPath = path.join(root, "Replacement.ether");
    const displacedPath = path.join(root, "Displaced.ether");
    createEtherDocument(documentPath, {
      appVersion: "4.0.0",
      documentId: "document-original",
      title: "Original"
    });
    createEtherDocument(replacementPath, {
      appVersion: "4.0.0",
      documentId: "document-replacement",
      title: "Replacement"
    });

    withBoundaryHooks(
      {
        beforeWritableDatabaseOpen: () => {
          renameSync(documentPath, displacedPath);
          renameSync(replacementPath, documentPath);
        }
      },
      () => expectEtherError(() => assertEtherDocumentWritable(documentPath), "PATH_CHANGED")
    );
    expect(inspectEtherDocument(displacedPath).document.documentId).toBe("document-original");
    expect(inspectEtherDocument(documentPath).document.documentId).toBe("document-replacement");
  });

  it("rejects pre-existing hard-link aliases without mutating either path", () => {
    createEtherDocument(documentPath, {
      appVersion: "4.0.0",
      documentId: "document-aliased",
      title: "Aliased"
    });
    const aliasPath = path.join(root, "Alias.ether");
    linkSync(documentPath, aliasPath);
    const directoryBefore = readdirSync(root).sort();
    const fileBefore = snapshotFile(documentPath);

    expectEtherError(() => inspectEtherDocument(documentPath), "HARD_LINK_ALIAS");
    expectEtherError(() => assertEtherDocumentWritable(documentPath), "HARD_LINK_ALIAS");
    expect(readdirSync(root).sort()).toEqual(directoryBefore);
    expectFileUnchanged(documentPath, fileBefore);
    expectFileUnchanged(aliasPath, fileBefore);
  });

  it("proves writable capability and maps read-only and busy failures", () => {
    createEtherDocument(documentPath, {
      appVersion: "4.0.0",
      documentId: "document-writable-probe",
      title: "Writable probe"
    });
    const before = snapshotFile(documentPath);
    const directoryBefore = readdirSync(root).sort();
    expect(assertEtherDocumentWritable(documentPath).document.documentId).toBe(
      "document-writable-probe"
    );
    expectFileUnchanged(documentPath, before);
    expect(readdirSync(root).sort()).toEqual(directoryBefore);

    withBoundaryHooks(
      {
        beforeWritableDatabaseOpen: () => {
          throw injectedFsError("EACCES", "writable access denied");
        }
      },
      () => expectEtherError(() => assertEtherDocumentWritable(documentPath), "PERMISSION_DENIED")
    );

    withBoundaryHooks(
      { forceReadOnlyWritableConnection: true },
      () => expectEtherError(() => assertEtherDocumentWritable(documentPath), "READ_ONLY")
    );

    const lockingDatabase = openTestDatabase(documentPath);
    lockingDatabase.exec("BEGIN EXCLUSIVE");
    try {
      expectEtherError(() => assertEtherDocumentWritable(documentPath), "BUSY_OR_LOCKED");
    } finally {
      lockingDatabase.exec("ROLLBACK");
      lockingDatabase.close();
    }

    if (process.platform !== "win32") {
      chmodSync(documentPath, 0o444);
      try {
        expectEtherError(() => assertEtherDocumentWritable(documentPath), "READ_ONLY");
      } finally {
        chmodSync(documentPath, 0o600);
      }
    }
  });

  it("rejects missing or changed schema 40000 objects without mutating the candidate", () => {
    createEtherDocument(documentPath, {
      appVersion: "4.0.0",
      documentId: "document-schema-manifest",
      title: "Schema manifest"
    });
    const fixtures = [
      ["MissingTable.ether", "DROP TABLE groups"],
      ["MissingIndex.ether", "DROP INDEX nodes_graph_id_idx"],
      ["MissingTrigger.ether", "DROP TRIGGER artifacts_fts_update"],
      ["MissingFts.ether", "DROP TABLE tag_fts"]
    ] as const;

    for (const [fileName, mutation] of fixtures) {
      const filePath = path.join(root, fileName);
      copyFileSync(documentPath, filePath);
      mutateDatabase(filePath, mutation);
      const directoryBefore = readdirSync(root).sort();
      const fileBefore = snapshotFile(filePath);

      expectEtherError(() => inspectEtherDocument(filePath), "SCHEMA_MISMATCH");
      expectEtherError(() => assertEtherDocumentWritable(filePath), "SCHEMA_MISMATCH");
      expect(readdirSync(root).sort()).toEqual(directoryBefore);
      expectFileUnchanged(filePath, fileBefore);
    }
  });

  it("refuses malformed, future, and unsupported Ether metadata without changing the file", () => {
    createEtherDocument(documentPath, {
      appVersion: "4.0.0",
      documentId: "document-valid",
      title: "Valid"
    });

    const fixtures = [
      {
        fileName: "MissingMetadata.ether",
        mutation: "DELETE FROM document",
        code: "INVALID_DOCUMENT_METADATA"
      },
      {
        fileName: "MalformedMetadata.ether",
        mutation:
          "PRAGMA ignore_check_constraints = ON; UPDATE document SET feature_flags_json = '[]'",
        code: "INVALID_DOCUMENT_METADATA"
      },
      {
        fileName: "FutureMajor.ether",
        mutation: "UPDATE document SET format_version = '5.0.0'",
        code: "UNSUPPORTED_FORMAT"
      },
      {
        fileName: "UnsupportedSchema.ether",
        mutation: "UPDATE document SET schema_version = 40001",
        code: "UNSUPPORTED_SCHEMA"
      },
      {
        fileName: "RequiredFeature.ether",
        mutation:
          "UPDATE document SET feature_flags_json = '{\"required.future-renderer\":true}'",
        code: "UNSUPPORTED_REQUIRED_FEATURE"
      }
    ] as const;

    for (const fixture of fixtures) {
      const filePath = path.join(root, fixture.fileName);
      copyFileSync(documentPath, filePath);
      mutateDatabase(filePath, fixture.mutation);
      const before = snapshotFile(filePath);

      expectEtherError(() => inspectEtherDocument(filePath), fixture.code);
      expectEtherError(() => assertEtherDocumentWritable(filePath), fixture.code);
      expectFileUnchanged(filePath, before);
    }
  });

  it("refuses foreign-key corruption before writable open without changing the file", () => {
    createEtherDocument(documentPath, {
      appVersion: "4.0.0",
      documentId: "document-corrupt",
      title: "Corrupt"
    });
    mutateDatabase(
      documentPath,
      `INSERT INTO nodes (
        node_id, graph_id, definition_id, title, position_x, position_y, width, height,
        config_json, presentation_json, created_at, updated_at
      ) VALUES (
        'orphan-node', 'missing-graph', 'prompt.text', 'Orphan', 0, 0, 220, 140,
        '{}', '{}', '2026-07-17T10:00:00.000Z', '2026-07-17T10:00:00.000Z'
      )`
    );
    const before = snapshotFile(documentPath);

    expectEtherError(() => assertEtherDocumentWritable(documentPath), "FOREIGN_KEY_CHECK_FAILED");
    expectFileUnchanged(documentPath, before);
  });

  it("exports explicit provisional format metadata until the Phase 5 freeze", () => {
    expect(ETHER_DOCUMENT_FORMAT).toMatchObject({
      formatFrozen: false,
      freezePhase: 5,
      pageSize: 16_384,
      pageSizeProvisional: true,
      schemaProvisional: true
    });
  });
});
