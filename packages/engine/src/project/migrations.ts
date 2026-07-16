import { runInTransaction, type SqliteDatabase } from "./sqlite.js";

type DatabaseMigration = {
  version: number;
  sql: string;
};

const MIGRATIONS: DatabaseMigration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS graph_revisions (
        id TEXT PRIMARY KEY,
        parent_revision_id TEXT,
        reason TEXT NOT NULL DEFAULT 'manual',
        actor TEXT NOT NULL DEFAULT 'system',
        content_hash TEXT NOT NULL,
        graph_json TEXT NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        FOREIGN KEY (parent_revision_id) REFERENCES graph_revisions(id)
      );

      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        kind TEXT NOT NULL,
        graph_revision_id TEXT,
        root_node_id TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT,
        FOREIGN KEY (graph_revision_id) REFERENCES graph_revisions(id)
      );

      CREATE TABLE IF NOT EXISTS job_items (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL,
        node_id TEXT NOT NULL,
        status TEXT NOT NULL,
        input_json TEXT NOT NULL DEFAULT '{}',
        output_json TEXT NOT NULL DEFAULT '{}',
        error_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT,
        FOREIGN KEY (job_id) REFERENCES jobs(id)
      );

      CREATE TABLE IF NOT EXISTS job_dependencies (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL,
        parent_job_item_id TEXT NOT NULL,
        child_job_item_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (job_id) REFERENCES jobs(id),
        FOREIGN KEY (parent_job_item_id) REFERENCES job_items(id),
        FOREIGN KEY (child_job_item_id) REFERENCES job_items(id)
      );

      CREATE TABLE IF NOT EXISTS job_events (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL,
        job_item_id TEXT,
        event_type TEXT NOT NULL,
        payload_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        FOREIGN KEY (job_id) REFERENCES jobs(id),
        FOREIGN KEY (job_item_id) REFERENCES job_items(id)
      );

      CREATE TABLE IF NOT EXISTS artifacts (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        node_id TEXT,
        run_id TEXT,
        job_id TEXT,
        path TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (job_id) REFERENCES jobs(id)
      );

      CREATE TABLE IF NOT EXISTS artifact_versions (
        id TEXT PRIMARY KEY,
        artifact_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        run_id TEXT,
        node_id TEXT,
        uri TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        FOREIGN KEY (artifact_id) REFERENCES artifacts(id),
        UNIQUE (artifact_id, version)
      );

      CREATE TABLE IF NOT EXISTS lineage_edges (
        id TEXT PRIMARY KEY,
        parent_artifact_id TEXT NOT NULL,
        child_artifact_id TEXT NOT NULL,
        edge_type TEXT NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        FOREIGN KEY (parent_artifact_id) REFERENCES artifacts(id),
        FOREIGN KEY (child_artifact_id) REFERENCES artifacts(id)
      );

      CREATE TABLE IF NOT EXISTS asset_operations (
        id TEXT PRIMARY KEY,
        asset_id TEXT NOT NULL,
        operation_type TEXT NOT NULL,
        node_id TEXT,
        run_id TEXT,
        input_json TEXT NOT NULL DEFAULT '{}',
        output_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tags (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        color TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS collection_memberships (
        id TEXT PRIMARY KEY,
        collection_id TEXT NOT NULL,
        artifact_id TEXT,
        asset_id TEXT,
        position INTEGER,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (artifact_id) REFERENCES artifacts(id)
      );

      CREATE TABLE IF NOT EXISTS provider_runs (
        id TEXT PRIMARY KEY,
        run_id TEXT,
        provider_id TEXT NOT NULL,
        model TEXT,
        status TEXT NOT NULL,
        request_json TEXT NOT NULL DEFAULT '{}',
        response_json TEXT,
        error_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT
      );

      CREATE TABLE IF NOT EXISTS project_events (
        id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        payload_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS graph_revisions_parent_revision_id_idx ON graph_revisions (parent_revision_id);
      CREATE INDEX IF NOT EXISTS graph_revisions_content_hash_idx ON graph_revisions (content_hash);
      CREATE INDEX IF NOT EXISTS graph_revisions_created_at_idx ON graph_revisions (created_at);
      CREATE INDEX IF NOT EXISTS jobs_status_idx ON jobs (status);
      CREATE INDEX IF NOT EXISTS job_items_node_id_idx ON job_items (node_id);
      CREATE INDEX IF NOT EXISTS job_items_status_idx ON job_items (status);
      CREATE INDEX IF NOT EXISTS job_events_job_id_idx ON job_events (job_id);
      CREATE INDEX IF NOT EXISTS artifacts_type_idx ON artifacts (type);
      CREATE INDEX IF NOT EXISTS artifacts_node_id_idx ON artifacts (node_id);
      CREATE INDEX IF NOT EXISTS artifacts_run_id_idx ON artifacts (run_id);
      CREATE INDEX IF NOT EXISTS artifact_versions_run_id_idx ON artifact_versions (run_id);
      CREATE INDEX IF NOT EXISTS lineage_edges_parent_artifact_id_idx ON lineage_edges (parent_artifact_id);
      CREATE INDEX IF NOT EXISTS lineage_edges_child_artifact_id_idx ON lineage_edges (child_artifact_id);
      CREATE INDEX IF NOT EXISTS asset_operations_run_id_idx ON asset_operations (run_id);
      CREATE INDEX IF NOT EXISTS asset_operations_node_id_idx ON asset_operations (node_id);
      CREATE INDEX IF NOT EXISTS collection_memberships_collection_id_idx ON collection_memberships (collection_id);
      CREATE INDEX IF NOT EXISTS provider_runs_run_id_idx ON provider_runs (run_id);
      CREATE INDEX IF NOT EXISTS project_events_event_type_idx ON project_events (event_type);
    `
  }
];

const ORDERED_MIGRATIONS = validateAndSortMigrations(MIGRATIONS);

export const LATEST_DATABASE_MIGRATION_VERSION = ORDERED_MIGRATIONS.reduce(
  (latestVersion, migration) => Math.max(latestVersion, migration.version),
  0
);

export function runDatabaseMigrations(db: SqliteDatabase) {
  const currentVersion = getUserVersion(db);

  if (currentVersion > LATEST_DATABASE_MIGRATION_VERSION) {
    throw new Error(
      `Project database uses newer database migration version ${currentVersion}; this Ether build only supports up to ${LATEST_DATABASE_MIGRATION_VERSION}.`
    );
  }

  const pendingMigrations = ORDERED_MIGRATIONS.filter(
    (migration) => migration.version > currentVersion
  );

  if (pendingMigrations.length === 0) {
    return;
  }

  runInTransaction(db, () => {
    for (const migration of pendingMigrations) {
      db.exec(migration.sql);
      db.exec(`PRAGMA user_version = ${migration.version}`);
    }
  });
}

function getUserVersion(db: SqliteDatabase) {
  const row = db.prepare("PRAGMA user_version").get() as { user_version: number };
  return row.user_version;
}

function validateAndSortMigrations(migrations: DatabaseMigration[]) {
  for (let index = 0; index < migrations.length; index += 1) {
    const migration = migrations[index];
    const previousMigration = migrations[index - 1];

    if (!Number.isInteger(migration.version) || migration.version < 1) {
      throw new Error(`Database migration versions must be positive integers. Found ${migration.version}.`);
    }

    if (previousMigration && migration.version <= previousMigration.version) {
      throw new Error(
        `Database migration versions must be strictly increasing and unique. Found version ${migration.version} after ${previousMigration.version}.`
      );
    }
  }

  const orderedMigrations = [...migrations].sort((left, right) => left.version - right.version);

  for (let index = 0; index < orderedMigrations.length; index += 1) {
    const migration = orderedMigrations[index];
    const previousMigration = orderedMigrations[index - 1];

    if (previousMigration && migration.version <= previousMigration.version) {
      throw new Error(
        `Database migration versions must be strictly increasing and unique. Found duplicate or out-of-order version ${migration.version}.`
      );
    }
  }

  return orderedMigrations;
}
