import { existsSync, realpathSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import type { HealthIssue, ProjectDatabaseStatus, SnapshotRecord, SnapshotSlot } from "./schema.js";
import { openDatabase, runInTransaction, type SqliteDatabase } from "./sqlite.js";

export const REQUIRED_DATABASE_TABLES = [
  "assets",
  "runs",
  "snapshots",
  "asset_moves",
  "health_issues"
] as const;

export function initializeDatabase(databasePath: string): ProjectDatabaseStatus {
  const db = openDatabase(databasePath);

  try {
    db.exec(`
      PRAGMA journal_mode = WAL;

      CREATE TABLE IF NOT EXISTS assets (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        path TEXT NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        graph_node_id TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        started_at TEXT NOT NULL,
        finished_at TEXT
      );

      CREATE TABLE IF NOT EXISTS snapshots (
        id TEXT PRIMARY KEY,
        slot TEXT NOT NULL,
        label TEXT,
        file_path TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS asset_moves (
        id TEXT PRIMARY KEY,
        asset_id TEXT NOT NULL,
        from_path TEXT NOT NULL,
        to_path TEXT NOT NULL,
        reason TEXT,
        moved_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS health_issues (
        id TEXT PRIMARY KEY,
        code TEXT NOT NULL,
        severity TEXT NOT NULL,
        message TEXT NOT NULL,
        path TEXT,
        detected_at TEXT NOT NULL
      );

      DELETE FROM snapshots
      WHERE rowid NOT IN (
        SELECT rowid
        FROM (
          SELECT rowid, slot, created_at, ROW_NUMBER() OVER (
            PARTITION BY slot ORDER BY created_at DESC, rowid DESC
          ) as slot_rank
          FROM snapshots
        )
        WHERE slot_rank = 1
      );

      CREATE UNIQUE INDEX IF NOT EXISTS snapshots_slot_unique_idx ON snapshots (slot);
    `);

    return getDatabaseStatus(databasePath, db);
  } finally {
    db.close();
  }
}

export function getDatabaseStatus(databasePath: string, existingDb?: SqliteDatabase): ProjectDatabaseStatus {
  const db = existingDb ?? openDatabase(databasePath, { readonly: true });

  try {
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (?, ?, ?, ?, ?) ORDER BY name"
      )
      .all(...REQUIRED_DATABASE_TABLES)
      .map((row) => (row as { name: string }).name);
    const healthIssueCount = (db
      .prepare("SELECT COUNT(*) as count FROM health_issues")
      .get() as { count: number }).count;

    return {
      path: databasePath,
      tables,
      healthIssueCount
    };
  } finally {
    if (!existingDb) {
      db.close();
    }
  }
}

export function insertSnapshot(
  databasePath: string,
  snapshot: {
    id: string;
    slot: SnapshotSlot;
    label: string | null;
    path: string;
    createdAt: string;
  },
  snapshotsDirectory = path.join(path.dirname(databasePath), "snapshots")
) {
  const db = openDatabase(databasePath);

  try {
    const oldRows = db
      .prepare("SELECT file_path as path FROM snapshots WHERE slot = ?")
      .all(snapshot.slot) as Array<{ path: string }>;
    runInTransaction(db, () => {
      db.prepare(
        `INSERT INTO snapshots (id, slot, label, file_path, created_at)
         VALUES (@id, @slot, @label, @path, @createdAt)
         ON CONFLICT(slot) DO UPDATE SET
           id = excluded.id,
           label = excluded.label,
           file_path = excluded.file_path,
           created_at = excluded.created_at`
      ).run(snapshot);
    });

    const cleanupBoundary = getSnapshotCleanupBoundary(databasePath, snapshotsDirectory);

    for (const row of oldRows) {
      if (cleanupBoundary && canDeleteStaleSnapshot(row.path, snapshot.path, cleanupBoundary)) {
        try {
          // Post-commit cleanup is best-effort; orphaned files are handled by future health/cleanup logic.
          rmSync(row.path, { force: true });
        } catch {
          // Tolerate stale snapshot files when the database already points at the new snapshot.
        }
      }
    }
  } finally {
    db.close();
  }
}

type SnapshotCleanupBoundary = {
  lexicalSnapshotsDirectory: string;
  realSnapshotsDirectory: string;
};

function getSnapshotCleanupBoundary(
  databasePath: string,
  snapshotsDirectory: string
): SnapshotCleanupBoundary | null {
  try {
    const realProjectRoot = realpathSync.native(path.dirname(databasePath));
    const lexicalSnapshotsDirectory = path.resolve(snapshotsDirectory);
    const realSnapshotsDirectory = realpathSync.native(snapshotsDirectory);

    if (
      !statSync(realSnapshotsDirectory).isDirectory() ||
      !isPathInsideDirectory(realSnapshotsDirectory, realProjectRoot)
    ) {
      return null;
    }

    return { lexicalSnapshotsDirectory, realSnapshotsDirectory };
  } catch {
    return null;
  }
}

function canDeleteStaleSnapshot(
  candidatePath: string,
  newSnapshotPath: string,
  boundary: SnapshotCleanupBoundary
) {
  const resolvedCandidatePath = path.resolve(candidatePath);
  const resolvedNewSnapshotPath = path.resolve(newSnapshotPath);

  if (
    isSameRealPath(resolvedCandidatePath, resolvedNewSnapshotPath) ||
    !existsSync(candidatePath)
  ) {
    return false;
  }

  try {
    const realCandidatePath = realpathSync.native(candidatePath);
    const realNewSnapshotPath = existsSync(newSnapshotPath)
      ? realpathSync.native(newSnapshotPath)
      : path.resolve(newSnapshotPath);

    return (
      !isSameRealPath(realCandidatePath, realNewSnapshotPath) &&
      isPathInsideDirectory(resolvedCandidatePath, boundary.lexicalSnapshotsDirectory) &&
      isPathInsideDirectory(realCandidatePath, boundary.realSnapshotsDirectory)
    );
  } catch {
    return false;
  }
}

function isPathInsideDirectory(filePath: string, directoryPath: string) {
  const normalizedFilePath = normalizePathForComparison(filePath);
  const normalizedDirectoryPath = normalizePathForComparison(directoryPath);
  const relativePath = path.relative(normalizedDirectoryPath, normalizedFilePath);

  return Boolean(relativePath) && !relativePath.startsWith("..") && !path.isAbsolute(relativePath);
}

function isSameRealPath(leftPath: string, rightPath: string) {
  const normalizedLeftPath = normalizePathForComparison(leftPath);
  const normalizedRightPath = normalizePathForComparison(rightPath);

  return normalizedLeftPath === normalizedRightPath;
}

function normalizePathForComparison(filePath: string) {
  if (process.platform === "win32") {
    return filePath.toLowerCase();
  }

  return filePath;
}

export function getSnapshot(databasePath: string, snapshotId: string): SnapshotRecord {
  const db = openDatabase(databasePath, { readonly: true });

  try {
    const row = db
      .prepare(
        `SELECT id, slot, label, file_path as path, created_at as createdAt
         FROM snapshots
         WHERE id = ?`
      )
      .get(snapshotId) as SnapshotRecord | undefined;

    if (!row) {
      throw new Error(`Snapshot "${snapshotId}" was not found.`);
    }

    return row;
  } finally {
    db.close();
  }
}

export function replaceHealthIssues(databasePath: string, issues: HealthIssue[]) {
  const db = openDatabase(databasePath);

  try {
    runInTransaction(db, () => {
      db.prepare("DELETE FROM health_issues").run();
      const insert = db.prepare(
        `INSERT INTO health_issues (id, code, severity, message, path, detected_at)
         VALUES (@id, @code, @severity, @message, @path, @detectedAt)`
      );

      for (const issue of issues) {
        insert.run(issue);
      }
    });
  } finally {
    db.close();
  }
}
