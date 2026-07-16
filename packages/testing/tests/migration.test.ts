import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync as Database } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { createArtifact } from "../../engine/src/artifacts/artifactStore";
import { LATEST_DATABASE_MIGRATION_VERSION } from "../../engine/src/project/migrations";
import * as healthModule from "../../engine/src/project/health";
import { saveGeneratedAsset } from "../../engine/src/project/assets";
import { createProject, openProject, saveGraph } from "../../engine/src/project/projectStore";
import { initializeDatabase } from "../../engine/src/project/database";
import { openDatabase } from "../../engine/src/project/sqlite";

const tempRoots: string[] = [];

const REQUIRED_MIGRATION_TABLES = [
  "graph_revisions",
  "jobs",
  "job_items",
  "job_dependencies",
  "job_events",
  "artifacts",
  "artifact_versions",
  "lineage_edges",
  "asset_operations",
  "tags",
  "collection_memberships",
  "provider_runs",
  "project_events"
] as const;

const IMPORTANT_MIGRATION_INDEXES = [
  "graph_revisions_parent_revision_id_idx",
  "graph_revisions_content_hash_idx",
  "graph_revisions_created_at_idx",
  "jobs_status_idx",
  "artifacts_type_idx",
  "artifacts_node_id_idx",
  "artifact_versions_run_id_idx",
  "lineage_edges_parent_artifact_id_idx",
  "lineage_edges_child_artifact_id_idx",
  "provider_runs_run_id_idx"
] as const;

const REQUIRED_GRAPH_REVISION_COLUMNS = {
  id: { notnull: 0 },
  parent_revision_id: { notnull: 0 },
  reason: { notnull: 1, dflt_value: "'manual'" },
  actor: { notnull: 1, dflt_value: "'system'" },
  content_hash: { notnull: 1 },
  graph_json: { notnull: 1 },
  metadata_json: { notnull: 1, dflt_value: "'{}'" },
  created_at: { notnull: 1 }
} as const;

async function createTempRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), "ether-migration-"));
  tempRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("database migrations", () => {
  it("creates Ether 2.0 tables, indexes, revision columns, and FKs through normal project initialization", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Migration Tables" });

    await openProject(project.path);

    const db = new Database(path.join(project.path, "ether.db"), { readOnly: true });

    try {
      const tables = db
        .prepare(
          `SELECT name
           FROM sqlite_master
           WHERE type = 'table' AND name IN (${REQUIRED_MIGRATION_TABLES.map(() => "?").join(", ")})
           ORDER BY name`
        )
        .all(...REQUIRED_MIGRATION_TABLES)
        .map((row) => (row as { name: string }).name);
      const indexes = db
        .prepare(
          `SELECT name
           FROM sqlite_master
           WHERE type = 'index' AND name IN (${IMPORTANT_MIGRATION_INDEXES.map(() => "?").join(", ")})
           ORDER BY name`
        )
        .all(...IMPORTANT_MIGRATION_INDEXES)
        .map((row) => (row as { name: string }).name);
      const graphRevisionColumns = db
        .prepare("PRAGMA table_info(graph_revisions)")
        .all()
        .reduce<Record<string, { notnull: number; dflt_value: string | null }>>((columns, row) => {
          const column = row as { name: string; notnull: number; dflt_value: string | null };
          columns[column.name] = {
            notnull: column.notnull,
            dflt_value: column.dflt_value
          };
          return columns;
        }, {});
      const graphRevisionFks = db.prepare("PRAGMA foreign_key_list(graph_revisions)").all();
      const jobFks = db.prepare("PRAGMA foreign_key_list(jobs)").all();
      const lineageFks = db.prepare("PRAGMA foreign_key_list(lineage_edges)").all();
      const version = db.prepare("PRAGMA user_version").get() as { user_version: number };

      expect(tables).toEqual([...REQUIRED_MIGRATION_TABLES].sort());
      expect(indexes).toEqual([...IMPORTANT_MIGRATION_INDEXES].sort());
      expect(graphRevisionColumns).toMatchObject(REQUIRED_GRAPH_REVISION_COLUMNS);
      expect(graphRevisionFks).toEqual([
        expect.objectContaining({
          table: "graph_revisions",
          from: "parent_revision_id",
          to: "id"
        })
      ]);
      expect(jobFks).toEqual([
        expect.objectContaining({
          table: "graph_revisions",
          from: "graph_revision_id",
          to: "id"
        })
      ]);
      expect(lineageFks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            table: "artifacts",
            from: "parent_artifact_id",
            to: "id"
          }),
          expect.objectContaining({
            table: "artifacts",
            from: "child_artifact_id",
            to: "id"
          })
        ])
      );
      expect(version.user_version).toBe(LATEST_DATABASE_MIGRATION_VERSION);
    } finally {
      db.close();
    }
  });

  it("rejects invalid foreign keys on every project database connection", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Foreign Keys" });
    const db = openDatabase(path.join(project.path, "ether.db"));

    try {
      expect(() =>
        db
          .prepare(
            `INSERT INTO jobs (
              id, status, kind, graph_revision_id, metadata_json, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            "job-invalid-fk",
            "queued",
            "graph-run",
            "missing-revision",
            "{}",
            "2026-06-26T10:00:00.000Z",
            "2026-06-26T10:00:00.000Z"
          )
      ).toThrow(/foreign key/i);
    } finally {
      db.close();
    }
  });

  it("is idempotent when reopening an already migrated project", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Migration Idempotent" });

    await openProject(project.path);
    await openProject(project.path);

    const db = new Database(path.join(project.path, "ether.db"), { readOnly: true });

    try {
      const tableCount = (
        db
          .prepare(
            `SELECT COUNT(*) as count
             FROM sqlite_master
             WHERE type = 'table' AND name IN (${REQUIRED_MIGRATION_TABLES.map(() => "?").join(", ")})`
          )
          .get(...REQUIRED_MIGRATION_TABLES) as { count: number }
      ).count;
      const version = db.prepare("PRAGMA user_version").get() as { user_version: number };

      expect(tableCount).toBe(REQUIRED_MIGRATION_TABLES.length);
      expect(version.user_version).toBe(LATEST_DATABASE_MIGRATION_VERSION);
    } finally {
      db.close();
    }
  });

  it("rejects databases from a newer unknown migration version", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Future Migration" });
    const databasePath = path.join(project.path, "ether.db");
    const db = new Database(databasePath);

    try {
      db.exec(`PRAGMA user_version = ${LATEST_DATABASE_MIGRATION_VERSION + 1}`);
    } finally {
      db.close();
    }

    expect(() => initializeDatabase(databasePath)).toThrow(/newer database migration version/i);
  });
});

describe("project health and privacy cleanup", () => {
  it("does not throw when asset_moves exists but assets table is missing", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Partial Move DB" });
    const databasePath = path.join(project.path, "ether.db");
    const createdAt = "2026-06-26T09:00:00.000Z";

    const db = openDatabase(databasePath);
    try {
      db.prepare(
        `INSERT INTO asset_moves (id, asset_id, from_path, to_path, reason, moved_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(
        "partial-move",
        "missing-asset-row",
        path.join(project.path, "assets", "generated", "from.png"),
        path.join(project.path, "assets", "generated", "to.png"),
        "partial migration test",
        createdAt
      );
      db.exec("DROP TABLE assets");
    } finally {
      db.close();
    }

    await expect(healthModule.runHealthCheck(project.path)).resolves.toEqual(
      expect.objectContaining({
        issues: expect.arrayContaining([
          expect.objectContaining({
            code: "DATABASE_TABLE_MISSING",
            message: expect.stringContaining("assets")
          })
        ])
      })
    );
  });

  it.each([
    ["missing", null],
    ["malformed", "{ definitely-not-json"]
  ])("reports %s linked index and continues database checks", async (_label, linkedIndexContent) => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: `Linked Index ${_label}` });
    const databasePath = path.join(project.path, "ether.db");
    const linkedIndexPath = path.join(project.path, "assets", "references", "linked-index.json");
    const createdAt = "2026-06-26T09:30:00.000Z";

    if (linkedIndexContent === null) {
      await rm(linkedIndexPath, { force: true });
    } else {
      await writeFile(linkedIndexPath, linkedIndexContent);
    }

    const db = openDatabase(databasePath);
    try {
      db.prepare(
        `INSERT INTO provider_runs (
          id, run_id, provider_id, model, status, request_json, response_json, error_json,
          created_at, updated_at, started_at, finished_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        `provider-run-${_label}`,
        `run-${_label}`,
        "codex",
        "image-2",
        "completed",
        JSON.stringify({ prompt: "private prompt" }),
        "{}",
        null,
        createdAt,
        createdAt,
        createdAt,
        createdAt
      );
    } finally {
      db.close();
    }

    await expect(healthModule.runHealthCheck(project.path)).resolves.toEqual(
      expect.objectContaining({
        issues: expect.arrayContaining([
          expect.objectContaining({
            code: "LINKED_INDEX_UNREADABLE",
            path: linkedIndexPath
          }),
          expect.objectContaining({
            code: "PROVIDER_LOGS_RETAINED"
          })
        ])
      })
    );
  });

  it("reports missing files, untracked assets, stale moves, graph mirror drift, migration state, and provider log retention", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Health Signals" });
    const databasePath = path.join(project.path, "ether.db");
    const detectedAt = "2026-06-26T10:00:00.000Z";
    const missingReferencePath = path.join(parentDirectory, "missing-reference.png");
    const missingAssetPath = path.join(project.path, "assets", "generated", "missing-asset.png");
    const missingArtifactPath = path.join(project.path, "assets", "generated", "missing-artifact.png");
    const untrackedAssetPath = path.join(project.path, "assets", "generated", "untracked.png");
    const staleMovePath = path.join(project.path, "assets", "generated", "moved-away.png");

    await saveGraph(project.path, {
      nodes: [{ id: "revision-node", position: { x: 1, y: 2 } }],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      selectedSnapshotId: null,
      updatedAt: detectedAt
    });
    await writeFile(
      path.join(project.path, "graph.json"),
      JSON.stringify(
        {
          nodes: [{ id: "mirror-only", position: { x: 5, y: 6 } }],
          edges: [],
          viewport: { x: 0, y: 0, zoom: 1 },
          selectedSnapshotId: null,
          updatedAt: "2026-06-26T10:05:00.000Z"
        },
        null,
        2
      )
    );
    await writeFile(
      path.join(project.path, "assets", "references", "linked-index.json"),
      JSON.stringify(
        {
          references: [{ id: "ref-missing", path: missingReferencePath, linkedAt: detectedAt }]
        },
        null,
        2
      )
    );
    await writeFile(untrackedAssetPath, "not represented in the database");

    const trackedAsset = await saveGeneratedAsset(project.path, {
      generationNodeId: "generation",
      fileName: "tracked.png",
      content: "tracked",
      now: new Date(detectedAt)
    });
    await createArtifact(project.path, {
      kind: "image",
      nodeId: "missing-artifact-node",
      path: missingArtifactPath,
      now: new Date(detectedAt)
    });

    const db = openDatabase(databasePath);
    try {
      db.prepare(
        `INSERT INTO assets (id, kind, path, metadata_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run("asset-missing-row", "generated", missingAssetPath, "{}", detectedAt, detectedAt);
      db.prepare(
        `INSERT INTO asset_moves (id, asset_id, from_path, to_path, reason, moved_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(
        "move-stale-row",
        trackedAsset.id,
        trackedAsset.path,
        staleMovePath,
        "test stale move",
        "2026-06-26T10:10:00.000Z"
      );
      db.prepare(
        `INSERT INTO provider_runs (
          id, run_id, provider_id, model, status, request_json, response_json, error_json,
          created_at, updated_at, started_at, finished_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        "provider-run-1",
        "run-1",
        "codex",
        "image-2",
        "failed",
        JSON.stringify({ prompt: "private prompt" }),
        JSON.stringify({ output: "private response" }),
        JSON.stringify({ message: "private error" }),
        detectedAt,
        detectedAt,
        detectedAt,
        detectedAt
      );
      db.exec("PRAGMA user_version = 0");
    } finally {
      db.close();
    }

    const health = await healthModule.runHealthCheck(project.path);
    const codes = health.issues.map((issue) => issue.code);

    expect(codes).toEqual(
      expect.arrayContaining([
        "LINKED_REFERENCE_MISSING",
        "ASSET_FILE_MISSING",
        "ARTIFACT_FILE_MISSING",
        "UNTRACKED_ASSET_FILE",
        "ASSET_MOVE_DESTINATION_MISSING",
        "ASSET_MOVE_STALE_CURRENT_PATH",
        "GRAPH_MIRROR_STALE",
        "DATABASE_MIGRATION_PENDING",
        "PROVIDER_LOGS_RETAINED"
      ])
    );
    expect(health.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "LINKED_REFERENCE_MISSING",
          path: missingReferencePath,
          severity: "error"
        }),
        expect.objectContaining({
          code: "UNTRACKED_ASSET_FILE",
          path: untrackedAssetPath,
          severity: "warning"
        }),
        expect.objectContaining({
          code: "PROVIDER_LOGS_RETAINED",
          path: databasePath,
          severity: "warning"
        })
      ])
    );

    const persistedDb = openDatabase(databasePath, { readonly: true });
    try {
      const persistedCodes = (
        persistedDb.prepare("SELECT code FROM health_issues ORDER BY code ASC").all() as Array<{
          code: string;
        }>
      ).map((row) => row.code);

      expect(persistedCodes).toEqual(expect.arrayContaining(codes));
    } finally {
      persistedDb.close();
    }
  });

  it("clears provider logs and run metadata without deleting artifact files", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Health Cleanup" });
    const databasePath = path.join(project.path, "ether.db");
    const createdAt = "2026-06-26T11:00:00.000Z";
    const artifactPath = path.join(project.path, "assets", "generated", "run-output.png");
    const providerLogPath = path.join(project.path, "runs", "providers", "run-cleanup", "job-1", "request.json");
    const actions = healthModule as unknown as {
      clearProviderLogs?: (projectPath: string) => Promise<{
        deletedProviderRuns: number;
        deletedProviderLogFiles: number;
      }>;
      clearRunArtifacts?: (
        projectPath: string
      ) => Promise<{
        deletedRunRecords: number;
        deletedRunArtifacts: number;
        deletedArtifactVersions: number;
        deletedAssetOperations: number;
        deletedJobRecords: number;
      }>;
    };

    await mkdir(path.dirname(artifactPath), { recursive: true });
    await writeFile(artifactPath, "keep this image");
    await mkdir(path.dirname(providerLogPath), { recursive: true });
    await writeFile(providerLogPath, JSON.stringify({ prompt: "private provider prompt" }));

    const db = openDatabase(databasePath);
    try {
      db.prepare(
        `INSERT INTO provider_runs (
          id, run_id, provider_id, model, status, request_json, response_json, error_json,
          created_at, updated_at, started_at, finished_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        "provider-run-cleanup",
        "run-cleanup",
        "codex",
        "image-2",
        "completed",
        JSON.stringify({ prompt: "private prompt" }),
        JSON.stringify({ output: "private response" }),
        null,
        createdAt,
        createdAt,
        createdAt,
        createdAt
      );
      db.prepare(
        `INSERT INTO runs (id, status, graph_node_id, metadata_json, started_at, finished_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run("run-cleanup", "complete", "node-1", JSON.stringify({ prompt: "private" }), createdAt, createdAt);
      db.prepare(
        `INSERT INTO jobs (
          id, status, kind, graph_revision_id, root_node_id, metadata_json,
          created_at, updated_at, started_at, finished_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        "job-cleanup",
        "completed",
        "graph-run",
        null,
        "node-1",
        JSON.stringify({ request: "private" }),
        createdAt,
        createdAt,
        createdAt,
        createdAt
      );
      db.prepare(
        `INSERT INTO job_items (
          id, job_id, node_id, status, input_json, output_json, error_json,
          created_at, updated_at, started_at, finished_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        "job-item-cleanup",
        "job-cleanup",
        "node-1",
        "completed",
        JSON.stringify({ prompt: "private" }),
        JSON.stringify({ artifactId: "artifact-run-cleanup" }),
        null,
        createdAt,
        createdAt,
        createdAt,
        createdAt
      );
      db.prepare(
        `INSERT INTO job_events (id, job_id, job_item_id, event_type, payload_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(
        "job-event-cleanup",
        "job-cleanup",
        "job-item-cleanup",
        "run.completed",
        JSON.stringify({ prompt: "private" }),
        createdAt
      );
      db.prepare(
        `INSERT INTO artifacts (id, type, node_id, run_id, job_id, path, metadata_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        "artifact-run-cleanup",
        "image",
        "node-1",
        "run-cleanup",
        "job-cleanup",
        artifactPath,
        JSON.stringify({ prompt: "private" }),
        createdAt,
        createdAt
      );
      db.prepare(
        `INSERT INTO artifact_versions (id, artifact_id, version, run_id, node_id, uri, metadata_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        "artifact-version-cleanup",
        "artifact-run-cleanup",
        1,
        "run-cleanup",
        "node-1",
        artifactPath,
        JSON.stringify({ prompt: "private" }),
        createdAt
      );
      db.prepare(
        `INSERT INTO asset_operations (id, asset_id, operation_type, node_id, run_id, input_json, output_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        "asset-operation-cleanup",
        "asset-1",
        "generate",
        "node-1",
        "run-cleanup",
        JSON.stringify({ prompt: "private" }),
        JSON.stringify({ artifactId: "artifact-run-cleanup" }),
        createdAt
      );
    } finally {
      db.close();
    }

    expect(actions.clearProviderLogs).toBeTypeOf("function");
    expect(actions.clearRunArtifacts).toBeTypeOf("function");

    const providerCleanup = await actions.clearProviderLogs!(project.path);
    const runCleanup = await actions.clearRunArtifacts!(project.path);

    expect(providerCleanup.deletedProviderRuns).toBe(1);
    expect(providerCleanup.deletedProviderLogFiles).toBe(1);
    expect(runCleanup).toMatchObject({
      deletedRunRecords: 1,
      deletedRunArtifacts: 1,
      deletedArtifactVersions: 1,
      deletedAssetOperations: 1,
      deletedJobRecords: 1
    });
    await expect(readFile(artifactPath, "utf8")).resolves.toBe("keep this image");
    await expect(readFile(providerLogPath, "utf8")).rejects.toThrow();

    const verifiedDb = openDatabase(databasePath, { readonly: true });
    try {
      expect((verifiedDb.prepare("SELECT COUNT(*) AS count FROM provider_runs").get() as { count: number }).count).toBe(0);
      expect((verifiedDb.prepare("SELECT COUNT(*) AS count FROM runs").get() as { count: number }).count).toBe(0);
      expect((verifiedDb.prepare("SELECT COUNT(*) AS count FROM artifacts").get() as { count: number }).count).toBe(0);
      expect((verifiedDb.prepare("SELECT COUNT(*) AS count FROM artifact_versions").get() as { count: number }).count).toBe(0);
      expect((verifiedDb.prepare("SELECT COUNT(*) AS count FROM asset_operations").get() as { count: number }).count).toBe(0);
      expect((verifiedDb.prepare("SELECT COUNT(*) AS count FROM jobs").get() as { count: number }).count).toBe(0);
      expect((verifiedDb.prepare("SELECT COUNT(*) AS count FROM job_items").get() as { count: number }).count).toBe(0);
      expect((verifiedDb.prepare("SELECT COUNT(*) AS count FROM job_events").get() as { count: number }).count).toBe(0);
    } finally {
      verifiedDb.close();
    }

    await expect(healthModule.runHealthCheck(project.path)).resolves.toEqual(
      expect.objectContaining({
        issues: expect.not.arrayContaining([
          expect.objectContaining({
            code: "PROVIDER_LOGS_RETAINED"
          })
        ])
      })
    );
  });

  it("reports provider log files even when provider run database rows are already clear", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Provider File Logs" });
    const providerLogPath = path.join(project.path, "runs", "providers", "run-file-only", "job-1", "codex-stdout.txt");

    await mkdir(path.dirname(providerLogPath), { recursive: true });
    await writeFile(providerLogPath, "private stdout");

    await expect(healthModule.runHealthCheck(project.path)).resolves.toEqual(
      expect.objectContaining({
        issues: expect.arrayContaining([
          expect.objectContaining({
            code: "PROVIDER_LOGS_RETAINED",
            path: path.join(project.path, "runs", "providers"),
            message: expect.stringContaining("1 local provider file")
          })
        ])
      })
    );
  });
});
