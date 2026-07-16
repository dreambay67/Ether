import { randomUUID } from "node:crypto";
import { constants, type Dirent } from "node:fs";
import { access, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { getLatestGraphRevision } from "../revisions/revisionStore.js";
import { PROJECT_ASSET_FILE_DIRECTORIES } from "./assets.js";
import { REQUIRED_DATABASE_TABLES, replaceHealthIssues } from "./database.js";
import { LATEST_DATABASE_MIGRATION_VERSION } from "./migrations.js";
import { projectPaths } from "./paths.js";
import { readJson } from "./projectStore.js";
import {
  LinkedIndexSchema,
  EtherGraphSchema,
  type HealthCheckResult,
  type HealthIssue,
  type LinkedReferenceIndex
} from "./schema.js";
import { openDatabase, runInTransaction, type SqliteDatabase } from "./sqlite.js";

type AssetPathRow = {
  id: string;
  kind: string;
  path: string;
};

type ArtifactPathRow = {
  id: string;
  type: string;
  path: string | null;
};

type AssetMoveRow = {
  id: string;
  asset_id: string;
  to_path: string;
  moved_at: string;
  asset_path: string | null;
};

export type ProviderLogCleanupResult = {
  deletedProviderRuns: number;
  deletedProviderLogFiles: number;
};

export type RunArtifactCleanupResult = {
  deletedRunRecords: number;
  deletedRunArtifacts: number;
  deletedArtifactVersions: number;
  deletedAssetOperations: number;
  deletedJobRecords: number;
  deletedJobItems: number;
  deletedJobEvents: number;
  deletedJobDependencies: number;
  deletedCollectionMemberships: number;
  deletedLineageEdges: number;
};

export async function runHealthCheck(projectPath: string): Promise<HealthCheckResult> {
  const paths = projectPaths(projectPath);
  const detectedAt = new Date().toISOString();
  const issues: HealthIssue[] = [];

  await collectLinkedReferenceIssues(paths.linkedIndex, issues, detectedAt);

  if (await collectDatabaseStatusIssues(paths.database, issues, detectedAt)) {
    const db = openDatabase(paths.database, { readonly: true });

    try {
      await collectAssetRowIssues(db, issues, detectedAt);
      await collectArtifactRowIssues(db, issues, detectedAt);
      await collectUntrackedAssetFileIssues(projectPath, db, issues, detectedAt);
      await collectAssetMoveIssues(db, issues, detectedAt);
      await collectProviderLogIssues(projectPath, paths.database, db, issues, detectedAt);
    } finally {
      db.close();
    }
  }

  await collectGraphMirrorIssues(projectPath, issues, detectedAt);

  if (await canPersistHealthIssues(paths.database)) {
    replaceHealthIssues(paths.database, issues);
  }

  return { issues };
}

export async function clearProviderLogs(projectPath: string): Promise<ProviderLogCleanupResult> {
  const databasePath = projectPaths(projectPath).database;
  const providerRunsPath = providerRunFilesPath(projectPath);
  const deletedProviderLogFiles = (await listFilesRecursively(providerRunsPath)).length;
  const db = openDatabase(databasePath);

  try {
    const deletedProviderRuns = tableExists(db, "provider_runs")
      ? runInTransaction(db, () => changesFrom(db.prepare("DELETE FROM provider_runs").run()))
      : 0;

    await rm(providerRunsPath, { recursive: true, force: true });

    return { deletedProviderRuns, deletedProviderLogFiles };
  } finally {
    db.close();
  }
}

export async function clearRunArtifacts(projectPath: string): Promise<RunArtifactCleanupResult> {
  const databasePath = projectPaths(projectPath).database;
  const db = openDatabase(databasePath);

  try {
    return runInTransaction(db, () => {
      const artifactIds = tableExists(db, "artifacts")
        ? (
            db
              .prepare(
                `SELECT id
                 FROM artifacts
                 WHERE run_id IS NOT NULL OR job_id IS NOT NULL`
              )
              .all() as Array<{ id: string }>
          ).map((row) => row.id)
        : [];
      const graphRunJobIds = tableExists(db, "jobs")
        ? (
            db
              .prepare("SELECT id FROM jobs WHERE kind = 'graph-run'")
              .all() as Array<{ id: string }>
          ).map((row) => row.id)
        : [];

      const deletedLineageEdges =
        artifactIds.length > 0 && tableExists(db, "lineage_edges")
          ? deleteWhereAnyId(db, "lineage_edges", ["parent_artifact_id", "child_artifact_id"], artifactIds)
          : 0;
      const deletedCollectionMemberships =
        artifactIds.length > 0 && tableExists(db, "collection_memberships")
          ? deleteWhereIds(db, "collection_memberships", "artifact_id", artifactIds)
          : 0;
      const deletedArtifactVersions = tableExists(db, "artifact_versions")
        ? deleteRunArtifactVersions(db, artifactIds)
        : 0;
      const deletedRunArtifacts =
        artifactIds.length > 0 && tableExists(db, "artifacts")
          ? deleteWhereIds(db, "artifacts", "id", artifactIds)
          : 0;
      const deletedAssetOperations = tableExists(db, "asset_operations")
        ? changesFrom(db.prepare("DELETE FROM asset_operations WHERE run_id IS NOT NULL").run())
        : 0;
      const deletedRunRecords = tableExists(db, "runs")
        ? changesFrom(db.prepare("DELETE FROM runs").run())
        : 0;
      const deletedJobDependencies =
        graphRunJobIds.length > 0 && tableExists(db, "job_dependencies")
          ? deleteWhereIds(db, "job_dependencies", "job_id", graphRunJobIds)
          : 0;
      const deletedJobEvents =
        graphRunJobIds.length > 0 && tableExists(db, "job_events")
          ? deleteWhereIds(db, "job_events", "job_id", graphRunJobIds)
          : 0;
      const deletedJobItems =
        graphRunJobIds.length > 0 && tableExists(db, "job_items")
          ? deleteWhereIds(db, "job_items", "job_id", graphRunJobIds)
          : 0;
      const deletedJobRecords =
        graphRunJobIds.length > 0 && tableExists(db, "jobs")
          ? deleteWhereIds(db, "jobs", "id", graphRunJobIds)
          : 0;

      return {
        deletedRunRecords,
        deletedRunArtifacts,
        deletedArtifactVersions,
        deletedAssetOperations,
        deletedJobRecords,
        deletedJobItems,
        deletedJobEvents,
        deletedJobDependencies,
        deletedCollectionMemberships,
        deletedLineageEdges
      };
    });
  } finally {
    db.close();
  }
}

async function collectLinkedReferenceIssues(
  linkedIndexPath: string,
  issues: HealthIssue[],
  detectedAt: string
) {
  let linkedIndex: LinkedReferenceIndex;

  try {
    linkedIndex = LinkedIndexSchema.parse(await readJson(linkedIndexPath));
  } catch (error) {
    issues.push(
      createIssue({
        code: "LINKED_INDEX_UNREADABLE",
        severity: "error",
        message: error instanceof Error
          ? `Linked reference index could not be read: ${error.message}`
          : "Linked reference index could not be read.",
        path: linkedIndexPath,
        detectedAt
      })
    );
    return;
  }

  for (const reference of linkedIndex.references) {
    if (!(await canAccess(reference.path))) {
      issues.push(
        createIssue({
          code: "LINKED_REFERENCE_MISSING",
          severity: "error",
          message: `Linked reference is missing: ${reference.path}`,
          path: reference.path,
          detectedAt
        })
      );
    }
  }
}

async function collectDatabaseStatusIssues(
  databasePath: string,
  issues: HealthIssue[],
  detectedAt: string
) {
  if (!(await canAccess(databasePath))) {
    issues.push(
      createIssue({
        code: "DATABASE_MISSING",
        severity: "error",
        message: `Project database is missing: ${databasePath}`,
        path: databasePath,
        detectedAt
      })
    );
    return false;
  }

  let db: SqliteDatabase;

  try {
    db = openDatabase(databasePath, { readonly: true });
  } catch (error) {
    issues.push(
      createIssue({
        code: "DATABASE_UNREADABLE",
        severity: "error",
        message: error instanceof Error ? error.message : "Project database could not be opened.",
        path: databasePath,
        detectedAt
      })
    );
    return false;
  }

  try {
    const userVersion = readUserVersion(db);

    if (userVersion < LATEST_DATABASE_MIGRATION_VERSION) {
      issues.push(
        createIssue({
          code: "DATABASE_MIGRATION_PENDING",
          severity: "warning",
          message: `Database migration version is ${userVersion}; Ether expects ${LATEST_DATABASE_MIGRATION_VERSION}.`,
          path: databasePath,
          detectedAt
        })
      );
    } else if (userVersion > LATEST_DATABASE_MIGRATION_VERSION) {
      issues.push(
        createIssue({
          code: "DATABASE_MIGRATION_UNSUPPORTED",
          severity: "error",
          message: `Database migration version is ${userVersion}; this Ether build supports ${LATEST_DATABASE_MIGRATION_VERSION}.`,
          path: databasePath,
          detectedAt
        })
      );
    }

    const existingTables = new Set(listTables(db));
    for (const table of REQUIRED_DATABASE_TABLES) {
      if (!existingTables.has(table)) {
        issues.push(
          createIssue({
            code: "DATABASE_TABLE_MISSING",
            severity: "error",
            message: `Required database table is missing: ${table}`,
            path: databasePath,
            detectedAt
          })
        );
      }
    }

    return true;
  } finally {
    db.close();
  }
}

async function collectAssetRowIssues(db: SqliteDatabase, issues: HealthIssue[], detectedAt: string) {
  if (!tableExists(db, "assets")) {
    return;
  }

  const rows = db
    .prepare("SELECT id, kind, path FROM assets ORDER BY created_at ASC, id ASC")
    .all() as AssetPathRow[];

  for (const row of rows) {
    if (await canAccess(row.path)) {
      continue;
    }

    issues.push(
      createIssue({
        code: "ASSET_FILE_MISSING",
        severity: "error",
        message: `Asset database row points to a missing path (${row.kind}): ${row.path}`,
        path: row.path,
        detectedAt
      })
    );
  }
}

async function collectArtifactRowIssues(db: SqliteDatabase, issues: HealthIssue[], detectedAt: string) {
  if (!tableExists(db, "artifacts")) {
    return;
  }

  const rows = db
    .prepare("SELECT id, type, path FROM artifacts WHERE path IS NOT NULL ORDER BY created_at ASC, id ASC")
    .all() as ArtifactPathRow[];

  for (const row of rows) {
    if (!row.path || (await canAccess(row.path))) {
      continue;
    }

    issues.push(
      createIssue({
        code: "ARTIFACT_FILE_MISSING",
        severity: "error",
        message: `Artifact record points to a missing file (${row.type}): ${row.path}`,
        path: row.path,
        detectedAt
      })
    );
  }
}

async function collectUntrackedAssetFileIssues(
  projectPath: string,
  db: SqliteDatabase,
  issues: HealthIssue[],
  detectedAt: string
) {
  const trackedPaths = collectTrackedFilePaths(projectPath, db);
  const ignoredPaths = new Set([normalizeFilePath(projectPaths(projectPath).linkedIndex)]);

  for (const relativeDirectory of PROJECT_ASSET_FILE_DIRECTORIES) {
    const directoryPath = path.join(projectPath, relativeDirectory);
    const files = await listFilesRecursively(directoryPath);

    for (const filePath of files) {
      const normalizedPath = normalizeFilePath(filePath);

      if (ignoredPaths.has(normalizedPath) || trackedPaths.has(normalizedPath)) {
        continue;
      }

      issues.push(
        createIssue({
          code: "UNTRACKED_ASSET_FILE",
          severity: "warning",
          message: `File under project assets is not represented by an asset or artifact row: ${filePath}`,
          path: filePath,
          detectedAt
        })
      );
    }
  }
}

async function collectAssetMoveIssues(db: SqliteDatabase, issues: HealthIssue[], detectedAt: string) {
  if (!tableExists(db, "asset_moves") || !tableExists(db, "assets")) {
    return;
  }

  const rows = db
    .prepare(
      `SELECT
        asset_moves.id,
        asset_moves.asset_id,
        asset_moves.to_path,
        asset_moves.moved_at,
        assets.path AS asset_path
       FROM asset_moves
       LEFT JOIN assets ON assets.id = asset_moves.asset_id
       ORDER BY asset_moves.moved_at ASC, asset_moves.rowid ASC`
    )
    .all() as AssetMoveRow[];
  const latestMoveByAssetId = new Map<string, AssetMoveRow>();

  for (const row of rows) {
    latestMoveByAssetId.set(row.asset_id, row);

    if (!(await canAccess(row.to_path))) {
      issues.push(
        createIssue({
          code: "ASSET_MOVE_DESTINATION_MISSING",
          severity: "error",
          message: `Asset move destination is missing: ${row.to_path}`,
          path: row.to_path,
          detectedAt
        })
      );
    }
  }

  for (const row of latestMoveByAssetId.values()) {
    if (!row.asset_path) {
      issues.push(
        createIssue({
          code: "ASSET_MOVE_ASSET_MISSING",
          severity: "error",
          message: `Asset move references a missing asset row: ${row.asset_id}`,
          path: row.to_path,
          detectedAt
        })
      );
      continue;
    }

    if (!sameFilePath(row.asset_path, row.to_path)) {
      issues.push(
        createIssue({
          code: "ASSET_MOVE_STALE_CURRENT_PATH",
          severity: "warning",
          message: `Latest asset move points to ${row.to_path}, but the asset row currently points to ${row.asset_path}.`,
          path: row.to_path,
          detectedAt
        })
      );
    }
  }
}

async function collectProviderLogIssues(
  projectPath: string,
  databasePath: string,
  db: SqliteDatabase,
  issues: HealthIssue[],
  detectedAt: string
) {
  const providerRunsPath = providerRunFilesPath(projectPath);
  const fileCount = (await listFilesRecursively(providerRunsPath)).length;

  if (!tableExists(db, "provider_runs")) {
    if (fileCount > 0) {
      issues.push(
        createIssue({
          code: "PROVIDER_LOGS_RETAINED",
          severity: "warning",
          message: `Provider run files retain ${fileCount} local file${fileCount === 1 ? "" : "s"}.`,
          path: providerRunsPath,
          detectedAt
        })
      );
    }
    return;
  }

  const row = db
    .prepare(
      `SELECT
        COUNT(*) AS count,
        COALESCE(SUM(
          LENGTH(COALESCE(request_json, '')) +
          LENGTH(COALESCE(response_json, '')) +
          LENGTH(COALESCE(error_json, ''))
        ), 0) AS byteCount
       FROM provider_runs`
    )
    .get() as { count: number; byteCount: number };

  if (row.count === 0 && fileCount === 0) {
    return;
  }

  issues.push(
    createIssue({
      code: "PROVIDER_LOGS_RETAINED",
      severity: "warning",
      message: [
        row.count > 0
          ? `Provider run logs retain ${row.count} record${row.count === 1 ? "" : "s"} (${row.byteCount} bytes of JSON payloads)`
          : "",
        fileCount > 0
          ? `${fileCount} local provider file${fileCount === 1 ? "" : "s"}`
          : ""
      ]
        .filter(Boolean)
        .join(" and ") + ".",
      path: row.count > 0 ? databasePath : providerRunsPath,
      detectedAt
    })
  );
}

async function collectGraphMirrorIssues(
  projectPath: string,
  issues: HealthIssue[],
  detectedAt: string
) {
  const paths = projectPaths(projectPath);

  try {
    const latestRevision = await getLatestGraphRevision(projectPath);

    if (!latestRevision) {
      return;
    }

    const mirrorGraph = EtherGraphSchema.parse(await readJson(paths.graphJson));

    if (JSON.stringify(mirrorGraph) !== JSON.stringify(latestRevision.graph)) {
      issues.push(
        createIssue({
          code: "GRAPH_MIRROR_STALE",
          severity: "warning",
          message: "graph.json does not match the latest graph revision stored in the database.",
          path: paths.graphJson,
          detectedAt
        })
      );
    }
  } catch (error) {
    issues.push(
      createIssue({
        code: "GRAPH_MIRROR_UNREADABLE",
        severity: "error",
        message: error instanceof Error ? error.message : "Graph mirror could not be checked.",
        path: paths.graphJson,
        detectedAt
      })
    );
  }
}

function collectTrackedFilePaths(projectPath: string, db: SqliteDatabase) {
  const trackedPaths = new Set<string>();

  if (tableExists(db, "assets")) {
    const rows = db.prepare("SELECT path FROM assets").all() as Array<{ path: string }>;

    for (const row of rows) {
      trackedPaths.add(normalizeProjectStoredPath(projectPath, row.path));
    }
  }

  if (tableExists(db, "artifacts")) {
    const rows = db
      .prepare("SELECT path FROM artifacts WHERE path IS NOT NULL")
      .all() as Array<{ path: string | null }>;

    for (const row of rows) {
      if (row.path) {
        trackedPaths.add(normalizeProjectStoredPath(projectPath, row.path));
      }
    }
  }

  return trackedPaths;
}

async function listFilesRecursively(directoryPath: string): Promise<string[]> {
  let entries: Dirent[];

  try {
    entries = await readdir(directoryPath, { withFileTypes: true });
  } catch {
    return [];
  }

  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(directoryPath, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursively(entryPath)));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }

  return files;
}

async function canPersistHealthIssues(databasePath: string) {
  try {
    const db = openDatabase(databasePath, { readonly: true });

    try {
      return tableExists(db, "health_issues");
    } finally {
      db.close();
    }
  } catch {
    return false;
  }
}

async function canAccess(filePath: string) {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function createIssue(issue: Omit<HealthIssue, "id">): HealthIssue {
  return {
    id: randomUUID(),
    ...issue
  };
}

function readUserVersion(db: SqliteDatabase) {
  return (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
}

function listTables(db: SqliteDatabase) {
  return (
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as Array<{ name: string }>
  ).map((row) => row.name);
}

function tableExists(db: SqliteDatabase, table: string) {
  return Boolean(
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(table)
  );
}

function deleteRunArtifactVersions(db: SqliteDatabase, artifactIds: string[]) {
  const clauses = ["run_id IS NOT NULL"];
  const values: string[] = [];

  if (artifactIds.length > 0) {
    clauses.push(`artifact_id IN (${placeholders(artifactIds)})`);
    values.push(...artifactIds);
  }

  return changesFrom(
    db.prepare(`DELETE FROM artifact_versions WHERE ${clauses.join(" OR ")}`).run(...values)
  );
}

function deleteWhereIds(db: SqliteDatabase, table: string, column: string, ids: string[]) {
  if (ids.length === 0) {
    return 0;
  }

  return changesFrom(
    db.prepare(`DELETE FROM ${table} WHERE ${column} IN (${placeholders(ids)})`).run(...ids)
  );
}

function deleteWhereAnyId(
  db: SqliteDatabase,
  table: string,
  columns: string[],
  ids: string[]
) {
  if (ids.length === 0) {
    return 0;
  }

  const clause = columns.map((column) => `${column} IN (${placeholders(ids)})`).join(" OR ");
  const values = columns.flatMap(() => ids);

  return changesFrom(db.prepare(`DELETE FROM ${table} WHERE ${clause}`).run(...values));
}

function placeholders(values: string[]) {
  return values.map(() => "?").join(", ");
}

function changesFrom(result: { changes: number | bigint }) {
  return Number(result.changes);
}

function normalizeProjectStoredPath(projectPath: string, storedPath: string) {
  return normalizeFilePath(path.isAbsolute(storedPath) ? storedPath : path.resolve(projectPath, storedPath));
}

function normalizeFilePath(filePath: string) {
  const resolvedPath = path.resolve(filePath);
  return process.platform === "win32" ? resolvedPath.toLowerCase() : resolvedPath;
}

function sameFilePath(leftPath: string, rightPath: string) {
  return normalizeFilePath(leftPath) === normalizeFilePath(rightPath);
}

function providerRunFilesPath(projectPath: string) {
  return path.join(projectPath, "runs", "providers");
}
