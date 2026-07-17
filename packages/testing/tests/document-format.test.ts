import {
  ETHER_DOCUMENT_FORMAT,
  ETHER_FTS_TABLES,
  ETHER_SCHEMA_TABLES,
  createEtherDocument,
  inspectEtherDocument,
  openEtherDocument
} from "@ether/document";
import {
  ETHER_FORMAT_MARKER,
  ETHER_FORMAT_VERSION,
  ETHER_SCHEMA_VERSION,
  ETHER_SQLITE_APPLICATION_ID
} from "@ether/schema";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
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

    const database = openEtherDocument(documentPath);
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
    writeFileSync(documentPath, "keep this destination");
    const before = snapshotFile(documentPath);

    expect(() =>
      createEtherDocument(documentPath, {
        appVersion: "4.0.0",
        documentId: "document-collision",
        title: "Collision"
      })
    ).toThrow(/already exists/i);
    expectFileUnchanged(documentPath, before);

    const directoryPath = path.join(root, "Directory.ether");
    mkdirSync(directoryPath);
    expect(() =>
      createEtherDocument(directoryPath, {
        appVersion: "4.0.0",
        documentId: "document-directory",
        title: "Directory"
      })
    ).toThrow(/already exists|regular file|directory/i);
    expect(statSync(directoryPath).isDirectory()).toBe(true);

    const failedPublicationPath = path.join(root, "UnsupportedFeature.ether");
    expect(() =>
      createEtherDocument(failedPublicationPath, {
        appVersion: "4.0.0",
        documentId: "document-unsupported-feature",
        featureFlags: { "required.future-renderer": true },
        title: "Unsupported feature"
      })
    ).toThrow(/required feature/i);
    expect(statSync(failedPublicationPath, { throwIfNoEntry: false })).toBeUndefined();
    expect(readdirSync(root).filter((entry) => entry.includes(".ether-tmp-"))).toEqual([]);
  });

  it("declares and indexes every normalized foreign-key boundary", () => {
    createEtherDocument(documentPath, {
      appVersion: "4.0.0",
      documentId: "document-foreign-keys",
      title: "Foreign keys"
    });
    const database = openEtherDocument(documentPath);

    try {
      const foreignKeys = new Map<string, ForeignKeyRow[]>();
      for (const table of ETHER_SCHEMA_TABLES.filter((name) => !name.endsWith("_fts"))) {
        const rows = database.prepare(`PRAGMA foreign_key_list("${table}")`).all() as unknown as
          ForeignKeyRow[];
        foreignKeys.set(table, rows);

        const indexes = database.prepare(`PRAGMA index_list("${table}")`).all() as unknown as
          IndexListRow[];
        const indexedFirstColumns = indexes.flatMap((index) =>
          (database.prepare(`PRAGMA index_info("${index.name}")`).all() as unknown as IndexColumnRow[])
            .sort((left, right) => left.seqno - right.seqno)
            .slice(0, 1)
            .map((column) => column.name)
        );
        for (const foreignKey of rows) {
          expect(indexedFirstColumns, `${table}.${foreignKey.from} needs an FK index`).toContain(
            foreignKey.from
          );
        }
      }

      expect(foreignKeys.get("node_output_payloads")).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ from: "artifact_id", table: "artifacts", to: "artifact_id" })
        ])
      );
      expect(foreignKeys.get("node_output_versions")).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ from: "run_id", table: "provider_runs", to: "provider_run_id" }),
          expect.objectContaining({ from: "step_id", table: "plan_steps", to: "step_id" }),
          expect.objectContaining({ from: "work_item_id", table: "work_items", to: "work_item_id" }),
          expect.objectContaining({ from: "attempt_id", table: "attempts", to: "attempt_id" })
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
    } finally {
      database.close();
    }
  });

  it("keeps prompt, output, artifact, tag, run, and metadata FTS indexes synchronized", () => {
    createEtherDocument(documentPath, {
      appVersion: "4.0.0",
      documentId: "document-search",
      title: "Cobalt campaign metadata"
    });
    const database = openEtherDocument(documentPath);

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
          artifact_id, content_key, kind, media_type, title, description, metadata_json, created_at
        ) VALUES (
          'artifact-1', NULL, 'image', 'image/png', 'Aurora frame', 'magenta skyline',
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

    for (const [filePath, expectedError] of [
      [invalidPath, /SQLite header/i],
      [nonEtherPath, /application id/i],
      [wrongApplicationPath, /application id/i]
    ] as const) {
      const before = snapshotFile(filePath);
      expect(() => openEtherDocument(filePath)).toThrow(expectedError);
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

    for (const operation of [inspectEtherDocument, openEtherDocument]) {
      expect(() => operation(documentPath)).toThrow(/WAL|journal mode/i);
      expect(readdirSync(root).sort()).toEqual(directoryBefore);
      expectFileUnchanged(documentPath, fileBefore);
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
        error: /exactly one document row/i
      },
      {
        fileName: "MalformedMetadata.ether",
        mutation:
          "PRAGMA ignore_check_constraints = ON; UPDATE document SET feature_flags_json = '[]'",
        error: /feature flags/i
      },
      {
        fileName: "FutureMajor.ether",
        mutation: "UPDATE document SET format_version = '5.0.0'",
        error: /future major|unsupported format/i
      },
      {
        fileName: "UnsupportedSchema.ether",
        mutation: "UPDATE document SET schema_version = 40001",
        error: /schema version/i
      },
      {
        fileName: "RequiredFeature.ether",
        mutation:
          "UPDATE document SET feature_flags_json = '{\"required.future-renderer\":true}'",
        error: /required feature/i
      }
    ] as const;

    for (const fixture of fixtures) {
      const filePath = path.join(root, fixture.fileName);
      copyFileSync(documentPath, filePath);
      mutateDatabase(filePath, fixture.mutation);
      const before = snapshotFile(filePath);

      expect(() => inspectEtherDocument(filePath)).toThrow(fixture.error);
      expect(() => openEtherDocument(filePath)).toThrow(fixture.error);
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

    expect(() => openEtherDocument(documentPath)).toThrow(/foreign key/i);
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
