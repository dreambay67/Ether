import { randomUUID } from "node:crypto";
import { initializeDatabase } from "../project/database.js";
import { projectPaths } from "../project/paths.js";
import { openDatabase, runInTransaction, type SqliteDatabase } from "../project/sqlite.js";
import type {
  AddArtifactToCollectionInput,
  ArtifactKind,
  ArtifactRecord,
  CreateArtifactInput,
  CreateLineageEdgeInput,
  LineageEdgeRecord,
  ListArtifactsQuery,
  RateArtifactInput,
  TagArtifactInput,
  UpdateArtifactMetadataInput
} from "./types.js";

type ArtifactRow = {
  id: string;
  type: ArtifactKind;
  node_id: string | null;
  run_id: string | null;
  job_id: string | null;
  path: string | null;
  metadata_json: string;
  created_at: string;
  updated_at: string;
};

type LineageEdgeRow = {
  id: string;
  parent_artifact_id: string;
  child_artifact_id: string;
  edge_type: string;
  metadata_json: string;
  created_at: string;
};

export async function createArtifact(
  projectPath: string,
  input: CreateArtifactInput
): Promise<ArtifactRecord> {
  const paths = projectPaths(projectPath);
  initializeDatabase(paths.database);

  const db = openDatabase(paths.database);
  let artifact: ArtifactRecord;

  try {
    runInTransaction(db, () => {
      artifact = createArtifactInDatabase(db, input);
    });
  } finally {
    db.close();
  }

  return artifact!;
}

export function createArtifactInDatabase(
  db: SqliteDatabase,
  input: CreateArtifactInput
): ArtifactRecord {
  const now = toTimestamp(input.now);
  const artifactId = randomUUID();

  db.prepare(
    `INSERT INTO artifacts (
      id, type, node_id, run_id, job_id, path, metadata_json, created_at, updated_at
    ) VALUES (
      @id, @type, @nodeId, @runId, @jobId, @path, @metadataJson, @createdAt, @updatedAt
    )`
  ).run({
    id: artifactId,
    type: input.kind,
    nodeId: input.nodeId ?? null,
    runId: input.runId ?? null,
    jobId: input.jobId ?? null,
    path: input.path ?? null,
    metadataJson: stringifyMetadata(input.metadata ?? {}),
    createdAt: now,
    updatedAt: now
  });

  if (input.path) {
    db.prepare(
      `INSERT INTO artifact_versions (
        id, artifact_id, version, run_id, node_id, uri, metadata_json, created_at
      ) VALUES (
        @id, @artifactId, @version, @runId, @nodeId, @uri, @metadataJson, @createdAt
      )`
    ).run({
      id: randomUUID(),
      artifactId,
      version: 1,
      runId: input.runId ?? null,
      nodeId: input.nodeId ?? null,
      uri: input.path,
      metadataJson: stringifyMetadata({ initial: true }),
      createdAt: now
    });
  }

  for (const parentArtifactId of uniqueStrings(input.parentArtifactIds ?? [])) {
    insertLineageEdge(db, {
      parentArtifactId,
      childArtifactId: artifactId,
      edgeType: "derived_from",
      metadata: {},
      now: input.now
    });
  }

  const artifact = getArtifactByIdInDatabase(db, artifactId);

  if (!artifact) {
    throw new Error(`Artifact "${artifactId}" was not found after creation.`);
  }

  return artifact;
}

export async function getArtifactById(
  projectPath: string,
  artifactId: string
): Promise<ArtifactRecord | null> {
  const paths = projectPaths(projectPath);
  initializeDatabase(paths.database);
  const db = openDatabase(paths.database, { readonly: true });

  try {
    return getArtifactByIdInDatabase(db, artifactId);
  } finally {
    db.close();
  }
}

export async function listArtifacts(
  projectPath: string,
  query: ListArtifactsQuery = {}
): Promise<ArtifactRecord[]> {
  const paths = projectPaths(projectPath);
  initializeDatabase(paths.database);
  const db = openDatabase(paths.database, { readonly: true });
  const artifactKind = query.kind ?? query.type;

  try {
    if (query.collectionId) {
      const rows = artifactKind
        ? (db
            .prepare(
              `SELECT a.id, a.type, a.node_id, a.run_id, a.job_id, a.path, a.metadata_json, a.created_at, a.updated_at
               FROM collection_memberships cm
               JOIN artifacts a ON a.id = cm.artifact_id
               WHERE cm.collection_id = ? AND a.type = ?
               ORDER BY cm.position ASC NULLS LAST, cm.rowid ASC, a.created_at ASC, a.id ASC`
            )
            .all(query.collectionId, artifactKind) as ArtifactRow[])
        : (db
            .prepare(
              `SELECT a.id, a.type, a.node_id, a.run_id, a.job_id, a.path, a.metadata_json, a.created_at, a.updated_at
               FROM collection_memberships cm
               JOIN artifacts a ON a.id = cm.artifact_id
               WHERE cm.collection_id = ?
               ORDER BY cm.position ASC NULLS LAST, cm.rowid ASC, a.created_at ASC, a.id ASC`
            )
            .all(query.collectionId) as ArtifactRow[]);

      return filterArtifactsForSearch(rows.map(artifactFromRow), query.search);
    }

    const rows = artifactKind
      ? (db
          .prepare(
            `SELECT id, type, node_id, run_id, job_id, path, metadata_json, created_at, updated_at
             FROM artifacts
             WHERE type = ?
             ORDER BY created_at ASC, id ASC`
          )
          .all(artifactKind) as ArtifactRow[])
      : (db
          .prepare(
            `SELECT id, type, node_id, run_id, job_id, path, metadata_json, created_at, updated_at
             FROM artifacts
             ORDER BY created_at ASC, id ASC`
          )
          .all() as ArtifactRow[]);

    return filterArtifactsForSearch(rows.map(artifactFromRow), query.search);
  } finally {
    db.close();
  }
}

export async function updateArtifactMetadata(
  projectPath: string,
  input: UpdateArtifactMetadataInput
): Promise<ArtifactRecord> {
  const paths = projectPaths(projectPath);
  initializeDatabase(paths.database);
  const db = openDatabase(paths.database);
  const now = toTimestamp(input.now);

  try {
    runInTransaction(db, () => {
      const existing = getArtifactByIdInDatabase(db, input.artifactId);
      if (!existing) {
        throw new Error(`Artifact "${input.artifactId}" was not found.`);
      }

      db.prepare(
        `UPDATE artifacts
         SET metadata_json = @metadataJson, updated_at = @updatedAt
         WHERE id = @id`
      ).run({
        id: input.artifactId,
        metadataJson: stringifyMetadata(deepMergeMetadata(existing.metadata, input.metadata)),
        updatedAt: now
      });
    });
  } finally {
    db.close();
  }

  const artifact = await getArtifactById(projectPath, input.artifactId);
  if (!artifact) {
    throw new Error(`Artifact "${input.artifactId}" was not found.`);
  }

  return artifact;
}

export async function tagArtifact(
  projectPath: string,
  input: TagArtifactInput
): Promise<ArtifactRecord> {
  const paths = projectPaths(projectPath);
  initializeDatabase(paths.database);
  const db = openDatabase(paths.database);
  const now = toTimestamp(input.now);
  const tag = input.tag.trim();

  if (!tag) {
    throw new Error("Tag name must not be empty.");
  }

  try {
    runInTransaction(db, () => {
      const existing = getArtifactByIdInDatabase(db, input.artifactId);
      if (!existing) {
        throw new Error(`Artifact "${input.artifactId}" was not found.`);
      }

      db.prepare(
        `INSERT INTO tags (id, name, color, metadata_json, created_at, updated_at)
         VALUES (@id, @name, @color, @metadataJson, @createdAt, @updatedAt)
         ON CONFLICT(name) DO UPDATE SET
           color = COALESCE(excluded.color, tags.color),
           metadata_json = excluded.metadata_json,
           updated_at = excluded.updated_at`
      ).run({
        id: randomUUID(),
        name: tag,
        color: input.color ?? null,
        metadataJson: stringifyMetadata(input.metadata ?? {}),
        createdAt: now,
        updatedAt: now
      });

      const tags = uniqueStrings([...(readStringArray(existing.metadata.tags)), tag]);
      db.prepare(
        `UPDATE artifacts
         SET metadata_json = @metadataJson, updated_at = @updatedAt
         WHERE id = @id`
      ).run({
        id: input.artifactId,
        metadataJson: stringifyMetadata({ ...existing.metadata, tags }),
        updatedAt: now
      });
    });
  } finally {
    db.close();
  }

  const artifact = await getArtifactById(projectPath, input.artifactId);
  if (!artifact) {
    throw new Error(`Artifact "${input.artifactId}" was not found.`);
  }

  return artifact;
}

export async function rateArtifact(
  projectPath: string,
  input: RateArtifactInput
): Promise<ArtifactRecord> {
  if (!Number.isFinite(input.rating)) {
    throw new Error("Artifact rating must be a finite number.");
  }

  return updateArtifactMetadata(projectPath, {
    artifactId: input.artifactId,
    metadata: {
      rating: {
        value: input.rating,
        ...(input.note ? { note: input.note } : {}),
        ...(input.source ? { source: input.source } : {})
      }
    },
    now: input.now
  });
}

export async function createLineageEdge(
  projectPath: string,
  input: CreateLineageEdgeInput
): Promise<LineageEdgeRecord> {
  const paths = projectPaths(projectPath);
  initializeDatabase(paths.database);
  const db = openDatabase(paths.database);
  let edgeId = "";

  try {
    runInTransaction(db, () => {
      edgeId = insertLineageEdge(db, input);
    });

    return getLineageEdgeByIdInDatabase(db, edgeId);
  } finally {
    db.close();
  }
}

export async function listLineageParents(
  projectPath: string,
  childArtifactId: string
): Promise<ArtifactRecord[]> {
  return listLineageArtifacts(projectPath, childArtifactId, "parents");
}

export async function listLineageChildren(
  projectPath: string,
  parentArtifactId: string
): Promise<ArtifactRecord[]> {
  return listLineageArtifacts(projectPath, parentArtifactId, "children");
}

export async function addArtifactToCollection(
  projectPath: string,
  input: AddArtifactToCollectionInput
): Promise<void> {
  const paths = projectPaths(projectPath);
  initializeDatabase(paths.database);
  const db = openDatabase(paths.database);
  const now = toTimestamp(input.now);

  try {
    runInTransaction(db, () => {
      if (!getArtifactByIdInDatabase(db, input.artifactId)) {
        throw new Error(`Artifact "${input.artifactId}" was not found.`);
      }

      const existing = db
        .prepare(
          `SELECT id
           FROM collection_memberships
           WHERE collection_id = ? AND artifact_id = ?
           ORDER BY rowid ASC
           LIMIT 1`
        )
        .get(input.collectionId, input.artifactId) as { id: string } | undefined;

      if (existing) {
        db.prepare(
          `UPDATE collection_memberships
           SET position = @position, metadata_json = @metadataJson, updated_at = @updatedAt
           WHERE id = @id`
        ).run({
          id: existing.id,
          position: input.position ?? null,
          metadataJson: stringifyMetadata(input.metadata ?? {}),
          updatedAt: now
        });
      } else {
        db.prepare(
          `INSERT INTO collection_memberships (
            id, collection_id, artifact_id, asset_id, position, metadata_json, created_at, updated_at
          ) VALUES (
            @id, @collectionId, @artifactId, NULL, @position, @metadataJson, @createdAt, @updatedAt
          )`
        ).run({
          id: randomUUID(),
          collectionId: input.collectionId,
          artifactId: input.artifactId,
          position: input.position ?? null,
          metadataJson: stringifyMetadata(input.metadata ?? {}),
          createdAt: now,
          updatedAt: now
        });
      }
    });
  } finally {
    db.close();
  }
}

export async function listArtifactsByCollection(
  projectPath: string,
  collectionId: string
): Promise<ArtifactRecord[]> {
  return listArtifacts(projectPath, { collectionId });
}

function listLineageArtifacts(
  projectPath: string,
  artifactId: string,
  direction: "parents" | "children"
): Promise<ArtifactRecord[]> {
  const paths = projectPaths(projectPath);
  initializeDatabase(paths.database);
  const db = openDatabase(paths.database, { readonly: true });

  try {
    const rows =
      direction === "parents"
        ? (db
            .prepare(
              `SELECT a.id, a.type, a.node_id, a.run_id, a.job_id, a.path, a.metadata_json, a.created_at, a.updated_at
               FROM lineage_edges le
               JOIN artifacts a ON a.id = le.parent_artifact_id
               WHERE le.child_artifact_id = ?
               ORDER BY le.rowid ASC`
            )
            .all(artifactId) as ArtifactRow[])
        : (db
            .prepare(
              `SELECT a.id, a.type, a.node_id, a.run_id, a.job_id, a.path, a.metadata_json, a.created_at, a.updated_at
               FROM lineage_edges le
               JOIN artifacts a ON a.id = le.child_artifact_id
               WHERE le.parent_artifact_id = ?
               ORDER BY le.rowid ASC`
            )
            .all(artifactId) as ArtifactRow[]);

    return Promise.resolve(rows.map(artifactFromRow));
  } finally {
    db.close();
  }
}

function insertLineageEdge(db: SqliteDatabase, input: CreateLineageEdgeInput) {
  const edgeType = input.edgeType ?? "derived_from";
  const existing = db
    .prepare(
      `SELECT id
       FROM lineage_edges
       WHERE parent_artifact_id = ? AND child_artifact_id = ? AND edge_type = ?
       ORDER BY rowid ASC
       LIMIT 1`
    )
    .get(input.parentArtifactId, input.childArtifactId, edgeType) as { id: string } | undefined;

  if (existing) {
    return existing.id;
  }

  const edgeId = randomUUID();
  db.prepare(
    `INSERT INTO lineage_edges (
      id, parent_artifact_id, child_artifact_id, edge_type, metadata_json, created_at
    ) VALUES (
      @id, @parentArtifactId, @childArtifactId, @edgeType, @metadataJson, @createdAt
    )`
  ).run({
    id: edgeId,
    parentArtifactId: input.parentArtifactId,
    childArtifactId: input.childArtifactId,
    edgeType,
    metadataJson: stringifyMetadata(input.metadata ?? {}),
    createdAt: toTimestamp(input.now)
  });

  return edgeId;
}

function getLineageEdgeByIdInDatabase(
  db: SqliteDatabase,
  edgeId: string
): LineageEdgeRecord {
  const row = db
    .prepare(
      `SELECT id, parent_artifact_id, child_artifact_id, edge_type, metadata_json, created_at
       FROM lineage_edges
       WHERE id = ?`
    )
    .get(edgeId) as LineageEdgeRow | undefined;

  if (!row) {
    throw new Error(`Lineage edge "${edgeId}" was not found.`);
  }

  return lineageEdgeFromRow(row);
}

function getArtifactByIdInDatabase(db: SqliteDatabase, artifactId: string): ArtifactRecord | null {
  const row = db
    .prepare(
      `SELECT id, type, node_id, run_id, job_id, path, metadata_json, created_at, updated_at
       FROM artifacts
       WHERE id = ?`
    )
    .get(artifactId) as ArtifactRow | undefined;

  return row ? artifactFromRow(row) : null;
}

function artifactFromRow(row: ArtifactRow): ArtifactRecord {
  return {
    id: row.id,
    kind: row.type,
    type: row.type,
    nodeId: row.node_id,
    runId: row.run_id,
    jobId: row.job_id,
    path: row.path,
    metadata: parseMetadata(row.metadata_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function lineageEdgeFromRow(row: LineageEdgeRow): LineageEdgeRecord {
  return {
    id: row.id,
    parentArtifactId: row.parent_artifact_id,
    childArtifactId: row.child_artifact_id,
    edgeType: row.edge_type,
    metadata: parseMetadata(row.metadata_json),
    createdAt: row.created_at
  };
}

function parseMetadata(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function stringifyMetadata(metadata: Record<string, unknown>) {
  return JSON.stringify(metadata);
}

function deepMergeMetadata(
  current: Record<string, unknown>,
  updates: Record<string, unknown>
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...current };

  for (const [key, value] of Object.entries(updates)) {
    const existing = merged[key];

    merged[key] =
      isPlainRecord(existing) && isPlainRecord(value)
        ? deepMergeMetadata(existing, value)
        : value;
  }

  return merged;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function filterArtifactsForSearch(artifacts: ArtifactRecord[], search: string | undefined) {
  const needle = search?.trim().toLowerCase();

  if (!needle) {
    return artifacts;
  }

  return artifacts.filter((artifact) => {
    const haystack = [
      artifact.id,
      artifact.kind,
      artifact.nodeId,
      artifact.runId,
      artifact.jobId,
      artifact.path,
      JSON.stringify(artifact.metadata)
    ]
      .filter((value): value is string => typeof value === "string")
      .join(" ")
      .toLowerCase();

    return haystack.includes(needle);
  });
}

function readStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function toTimestamp(now = new Date()) {
  return now.toISOString();
}
