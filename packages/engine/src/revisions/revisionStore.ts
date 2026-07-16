import { createHash, randomUUID } from "node:crypto";
import { projectPaths } from "../project/paths.js";
import { normalizeEtherGraph } from "../project/schema.js";
import { openDatabase, runInTransaction, type SqliteDatabase } from "../project/sqlite.js";
import {
  GraphRevisionConflict,
  type CreateGraphRevisionInput,
  type GraphRevision,
  type SaveGraphRevisionInput
} from "./types.js";

type GraphRevisionRow = {
  id: string;
  parentRevisionId: string | null;
  reason: string;
  actor: string;
  contentHash: string;
  graphJson: string;
  metadataJson: string;
  createdAt: string;
};

export async function createInitialGraphRevision(
  projectPath: string,
  input: CreateGraphRevisionInput
): Promise<GraphRevision> {
  const db = openDatabase(projectPaths(projectPath).database);

  try {
    return runInTransaction(db, () => {
      const latest = getLatestGraphRevisionInDatabase(db);

      if (latest) {
        return latest;
      }

      return insertGraphRevision(db, {
        ...input,
        baseRevisionId: null
      });
    });
  } finally {
    db.close();
  }
}

export async function saveGraphRevision(
  projectPath: string,
  input: SaveGraphRevisionInput
): Promise<GraphRevision> {
  const db = openDatabase(projectPaths(projectPath).database);

  try {
    return runInTransaction(db, () => {
      const latest = getLatestGraphRevisionInDatabase(db);
      const baseRevisionId =
        input.baseRevisionId === undefined ? (latest?.id ?? null) : input.baseRevisionId;

      if ((latest?.id ?? null) !== baseRevisionId) {
        throw new GraphRevisionConflict(baseRevisionId, latest?.id ?? null);
      }

      return insertGraphRevision(db, {
        ...input,
        baseRevisionId
      });
    });
  } finally {
    db.close();
  }
}

export async function getLatestGraphRevision(projectPath: string): Promise<GraphRevision | null> {
  const db = openDatabase(projectPaths(projectPath).database, { readonly: true });

  try {
    return getLatestGraphRevisionInDatabase(db);
  } finally {
    db.close();
  }
}

export async function getGraphRevision(
  projectPath: string,
  revisionId: string
): Promise<GraphRevision | null> {
  const db = openDatabase(projectPaths(projectPath).database, { readonly: true });

  try {
    const row = db
      .prepare(
        `SELECT
          id,
          parent_revision_id as parentRevisionId,
          reason,
          actor,
          content_hash as contentHash,
          graph_json as graphJson,
          metadata_json as metadataJson,
          created_at as createdAt
         FROM graph_revisions
         WHERE id = ?`
      )
      .get(revisionId) as GraphRevisionRow | undefined;

    return row ? graphRevisionFromRow(row) : null;
  } finally {
    db.close();
  }
}

function getLatestGraphRevisionInDatabase(db: SqliteDatabase): GraphRevision | null {
  const row = db
    .prepare(
      `SELECT
        id,
        parent_revision_id as parentRevisionId,
        reason,
        actor,
        content_hash as contentHash,
        graph_json as graphJson,
        metadata_json as metadataJson,
        created_at as createdAt
       FROM graph_revisions
       ORDER BY created_at DESC, rowid DESC
       LIMIT 1`
    )
    .get() as GraphRevisionRow | undefined;

  return row ? graphRevisionFromRow(row) : null;
}

function insertGraphRevision(
  db: SqliteDatabase,
  input: SaveGraphRevisionInput & { baseRevisionId: string | null }
): GraphRevision {
  const graph = normalizeEtherGraph(input.graph);
  const metadata = input.metadata ?? {};
  const graphJson = JSON.stringify(graph);
  const metadataJson = JSON.stringify(metadata);
  const revision: GraphRevision = {
    id: randomUUID(),
    parentRevisionId: input.baseRevisionId,
    reason: input.reason ?? "manual",
    actor: input.actor ?? "system",
    contentHash: hashContent(graphJson),
    graph,
    metadata,
    createdAt: new Date().toISOString()
  };

  db.prepare(
    `INSERT INTO graph_revisions (
      id,
      parent_revision_id,
      reason,
      actor,
      content_hash,
      graph_json,
      metadata_json,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    revision.id,
    revision.parentRevisionId,
    revision.reason,
    revision.actor,
    revision.contentHash,
    graphJson,
    metadataJson,
    revision.createdAt
  );

  return revision;
}

function graphRevisionFromRow(row: GraphRevisionRow): GraphRevision {
  return {
    id: row.id,
    parentRevisionId: row.parentRevisionId,
    reason: row.reason,
    actor: row.actor,
    contentHash: row.contentHash,
    graph: normalizeEtherGraph(JSON.parse(row.graphJson) as unknown),
    metadata: JSON.parse(row.metadataJson) as Record<string, unknown>,
    createdAt: row.createdAt
  };
}

function hashContent(content: string) {
  return createHash("sha256").update(content).digest("hex");
}
