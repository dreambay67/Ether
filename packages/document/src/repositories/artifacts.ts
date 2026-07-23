import {
  ArtifactDetailSchema,
  ArtifactSchema,
  type Artifact,
  type ArtifactDetail,
  type ArtifactLineage,
  type PayloadChannel
} from "@ether/schema";

import type { RepositoryTransactionContext } from "./graphs.js";
import { BlobRepositoryError } from "./blobs.js";
import { OutputRepository } from "./outputs.js";

interface ArtifactRow {
  artifact_id: string;
  byte_length: number;
  channel: Artifact["channel"];
  content_key: string;
  created_at: string;
  media_type: string;
  metadata_json: string;
  source_output_version_id: string;
  source_payload_id: string;
}

export interface ArtifactRepairMetadata {
  collections: Array<{
    createdAt: string;
    description: string;
    id: string;
    isPrimary: number;
    metadata: unknown;
    name: string;
    updatedAt: string;
  }>;
  exportRecords: Array<{ artifactId: string | null; collectionId: string | null; id: string }>;
  lineage: Array<{
    artifactId: string;
    metadata: unknown;
    parentArtifactId: string;
    relation: string;
    sourceOutputVersionId: string | null;
  }>;
  memberships: Array<{
    addedAt: string;
    artifactId: string;
    collectionId: string;
    position: number;
  }>;
  ratings: Array<{
    actor: string;
    artifactId: string;
    createdAt: string;
    id: string;
    notes: string;
    rubricId: string | null;
    score: number;
  }>;
  tags: Array<{ artifactId: string; createdAt: string; tag: string }>;
}

export interface ArtifactLineageRecord {
  artifactId: string;
  metadata: Record<string, unknown>;
  parentArtifactId: string;
  relation: string;
  sourceOutputVersionId: string | null;
}

export interface ArtifactSearchInput {
  text: string;
  channels: PayloadChannel[];
  collectionIds: string[];
  tags: string[];
  minimumRating: number | null;
  providerId: string | null;
  modelId: string | null;
  runId: string | null;
  graphId: string | null;
  createdAfter: string | null;
  createdBefore: string | null;
  cursor?: string | null;
  limit?: number;
}

export interface ArtifactSearchPage {
  artifacts: Artifact[];
  total: number;
  nextCursor: string | null;
}

export class ArtifactRepository {
  constructor(private readonly context: RepositoryTransactionContext) {}

  get(id: string): Artifact | undefined {
    const row = this.context.database
      .prepare(
        `SELECT artifact_id, content_key, channel, media_type, byte_length,
                source_output_version_id, source_payload_id, created_at, metadata_json
         FROM artifacts WHERE artifact_id = ?`
      )
      .get(id) as ArtifactRow | undefined;
    if (row === undefined) return undefined;
    return ArtifactSchema.parse({
      id: row.artifact_id,
      contentKey: row.content_key,
      channel: row.channel,
      mediaType: row.media_type,
      byteLength: row.byte_length,
      source: {
        outputVersionId: row.source_output_version_id,
        payloadId: row.source_payload_id
      },
      createdAt: row.created_at,
      metadata: JSON.parse(row.metadata_json) as unknown
    });
  }

  list(): Artifact[] {
    const rows = this.context.database
      .prepare(
        `SELECT artifact_id FROM artifacts
         ORDER BY coalesce(json_extract(metadata_json, '$.jobId'), ''),
                  coalesce(cast(json_extract(metadata_json, '$.ordinal') AS INTEGER), 0),
                  artifact_id`
      )
      .all() as unknown as Array<{ artifact_id: string }>;
    return rows.map(({ artifact_id }) => this.get(artifact_id)).filter((value): value is Artifact => value !== undefined);
  }

  search(input: { channel?: Artifact["channel"]; mediaType?: string; text?: string } = {}): Artifact[] {
    const clauses: string[] = [];
    const values: string[] = [];
    if (input.channel !== undefined) {
      clauses.push("channel = ?");
      values.push(input.channel);
    }
    if (input.mediaType !== undefined) {
      clauses.push("media_type = ?");
      values.push(input.mediaType);
    }
    if (input.text !== undefined && input.text.trim().length > 0) {
      clauses.push("lower(title || ' ' || description || ' ' || metadata_json) LIKE ?");
      values.push(`%${input.text.trim().toLocaleLowerCase()}%`);
    }
    const where = clauses.length === 0 ? "" : `WHERE ${clauses.join(" AND ")}`;
    const rows = this.context.database
      .prepare(
        `SELECT artifact_id FROM artifacts ${where}
         ORDER BY created_at DESC, artifact_id`
      )
      .all(...values) as unknown as Array<{ artifact_id: string }>;
    return rows
      .map(({ artifact_id }) => this.get(artifact_id))
      .filter((value): value is Artifact => value !== undefined);
  }

  searchPage(input: ArtifactSearchInput): ArtifactSearchPage {
    const clauses: string[] = [];
    const values: Array<string | number | null> = [];
    const phrase = ftsPhrase(input.text);
    if (phrase !== null) {
      clauses.push(`(a.artifact_id IN (SELECT artifact_id FROM artifact_fts WHERE artifact_fts MATCH ?)
        OR a.artifact_id IN (SELECT artifact_id FROM tag_fts WHERE tag_fts MATCH ?))`);
      values.push(phrase, phrase);
    }
    if (input.channels.length > 0) {
      clauses.push(`a.channel IN (${input.channels.map(() => "?").join(", ")})`);
      values.push(...input.channels);
    }
    for (const collectionId of input.collectionIds) {
      clauses.push("EXISTS (SELECT 1 FROM collection_memberships cm WHERE cm.artifact_id = a.artifact_id AND cm.collection_id = ?)");
      values.push(collectionId);
    }
    for (const tag of input.tags) {
      clauses.push("EXISTS (SELECT 1 FROM artifact_tags t WHERE t.artifact_id = a.artifact_id AND t.tag = ?)");
      values.push(tag);
    }
    if (input.minimumRating !== null) {
      clauses.push("EXISTS (SELECT 1 FROM artifact_ratings r WHERE r.artifact_id = a.artifact_id AND r.score >= ?)");
      values.push(input.minimumRating);
    }
    if (input.providerId !== null) {
      clauses.push("json_extract(v.producer_json, '$.providerId') = ?");
      values.push(input.providerId);
    }
    if (input.modelId !== null) {
      clauses.push("json_extract(v.producer_json, '$.modelId') = ?");
      values.push(input.modelId);
    }
    if (input.runId !== null) { clauses.push("v.run_id = ?"); values.push(input.runId); }
    if (input.graphId !== null) { clauses.push("v.graph_id = ?"); values.push(input.graphId); }
    if (input.createdAfter !== null) { clauses.push("a.created_at >= ?"); values.push(input.createdAfter); }
    if (input.createdBefore !== null) { clauses.push("a.created_at <= ?"); values.push(input.createdBefore); }
    const baseWhere = clauses.length === 0 ? "" : `WHERE ${clauses.join(" AND ")}`;
    const total = (this.context.database.prepare(
      `SELECT count(*) AS count FROM artifacts a
       JOIN node_output_versions v ON v.output_version_id = a.source_output_version_id ${baseWhere}`
    ).get(...values) as { count: number }).count;
    const pageClauses = [...clauses];
    const pageValues = [...values];
    if (input.cursor) {
      const cursor = decodeArtifactCursor(input.cursor);
      pageClauses.push("(a.created_at < ? OR (a.created_at = ? AND a.artifact_id > ?))");
      pageValues.push(cursor.createdAt, cursor.createdAt, cursor.artifactId);
    }
    const limit = Math.max(1, Math.min(500, input.limit ?? 100));
    const pageWhere = pageClauses.length === 0 ? "" : `WHERE ${pageClauses.join(" AND ")}`;
    const rows = this.context.database.prepare(
      `SELECT a.artifact_id, a.created_at FROM artifacts a
       JOIN node_output_versions v ON v.output_version_id = a.source_output_version_id
       ${pageWhere} ORDER BY a.created_at DESC, a.artifact_id ASC LIMIT ?`
    ).all(...pageValues, limit + 1) as unknown as Array<{ artifact_id: string; created_at: string }>;
    const hasMore = rows.length > limit;
    const pageRows = rows.slice(0, limit);
    const artifacts = pageRows.map((row) => this.get(row.artifact_id)).filter((value): value is Artifact => value !== undefined);
    const last = pageRows.at(-1);
    return {
      artifacts,
      total,
      nextCursor: hasMore && last ? encodeArtifactCursor(last.created_at, last.artifact_id) : null
    };
  }

  listByOutputVersion(outputVersionId: string): Artifact[] {
    const rows = this.context.database
      .prepare(
        `SELECT artifact_id FROM artifacts
         WHERE source_output_version_id = ? ORDER BY artifact_id`
      )
      .all(outputVersionId) as unknown as Array<{ artifact_id: string }>;
    return rows
      .map(({ artifact_id }) => this.get(artifact_id))
      .filter((value): value is Artifact => value !== undefined);
  }

  lineage(artifactId: string): ArtifactLineageRecord[] {
    this.require(artifactId);
    const rows = this.context.database
      .prepare(
        `SELECT artifact_id, parent_artifact_id, relation, source_output_version_id, metadata_json
         FROM artifact_lineage WHERE artifact_id = ? OR parent_artifact_id = ?
         ORDER BY parent_artifact_id, artifact_id, relation`
      )
      .all(artifactId, artifactId) as unknown as Array<{
        artifact_id: string;
        metadata_json: string;
        parent_artifact_id: string;
        relation: string;
        source_output_version_id: string | null;
      }>;
    return rows.map((row) => ({
      artifactId: row.artifact_id,
      parentArtifactId: row.parent_artifact_id,
      relation: row.relation,
      sourceOutputVersionId: row.source_output_version_id,
      metadata: JSON.parse(row.metadata_json) as Record<string, unknown>
    }));
  }

  detail(artifactId: string): ArtifactDetail | undefined {
    const artifact = this.get(artifactId);
    if (artifact === undefined) return undefined;
    const collections = this.context.database
      .prepare(
        `SELECT c.collection_id, c.title FROM collections c
         JOIN collection_memberships m ON m.collection_id = c.collection_id
         WHERE m.artifact_id = ? ORDER BY c.is_primary DESC, c.title, c.collection_id`
      )
      .all(artifactId) as unknown as Array<{ collection_id: string; title: string }>;
    const tags = this.context.database
      .prepare("SELECT tag FROM artifact_tags WHERE artifact_id = ? ORDER BY tag")
      .all(artifactId) as unknown as Array<{ tag: string }>;
    const ratings = this.context.database
      .prepare(
        `SELECT rating_id, score, actor, rubric_id, notes, created_at
         FROM artifact_ratings WHERE artifact_id = ? ORDER BY created_at, rating_id`
      )
      .all(artifactId) as unknown as Array<{
        actor: string;
        created_at: string;
        notes: string;
        rating_id: string;
        rubric_id: string | null;
        score: number;
      }>;
    const outputVersion = new OutputRepository(this.context).getVersion(artifact.source.outputVersionId);
    const sourcePayload = new OutputRepository(this.context).getPayload(artifact.source.payloadId);
    if (outputVersion === undefined || sourcePayload === undefined) {
      throw new BlobRepositoryError("ARTIFACT_PROVENANCE_MISMATCH", "Artifact output provenance is incomplete.");
    }
    const lineage: ArtifactLineage[] = this.lineage(artifactId).map((entry) => ({
      id: typeof entry.metadata.id === "string" ? entry.metadata.id : `${entry.parentArtifactId}:${entry.artifactId}:${entry.relation}`,
      parentArtifactId: entry.parentArtifactId,
      childArtifactId: entry.artifactId,
      relation: lineageRelation(entry.relation),
      role: lineageRole(entry.metadata.role, sourcePayload.role),
      createdAt: typeof entry.metadata.createdAt === "string" ? entry.metadata.createdAt : artifact.createdAt
    }));
    const evaluation = evaluationProvenance(sourcePayload);
    return ArtifactDetailSchema.parse({
      artifact,
      outputVersion,
      sourcePayload,
      collections: collections.map((row) => ({ id: row.collection_id, title: row.title })),
      lineage,
      tags: tags.map((row) => row.tag),
      ratings: ratings.map((row) => ({
        id: row.rating_id,
        score: row.score,
        actor: row.actor,
        rubricId: row.rubric_id,
        notes: row.notes,
        createdAt: row.created_at
      })),
      evaluation
    });
  }

  rate(artifactId: string, score: number, actor = "user"): void {
    this.require(artifactId);
    if (!Number.isInteger(score) || score < 0 || score > 5) {
      throw new BlobRepositoryError("ARTIFACT_RATING_INVALID", "Artifact ratings must be whole numbers from 0 to 5.");
    }
    this.context.database
      .prepare(
        `INSERT INTO artifact_ratings (
           rating_id, artifact_id, score, actor, rubric_id, notes, created_at
         ) VALUES (?, ?, ?, ?, NULL, '', ?)`
      )
      .run(this.context.createId("rating"), artifactId, score, actor, this.context.now());
  }

  setTags(artifactId: string, tags: readonly string[]): void {
    this.require(artifactId);
    const normalized = [...new Set(tags.map((tag) => tag.trim()).filter((tag) => tag.length > 0))].sort();
    this.context.database.prepare("DELETE FROM artifact_tags WHERE artifact_id = ?").run(artifactId);
    const insert = this.context.database.prepare(
      "INSERT INTO artifact_tags (artifact_id, tag, created_at) VALUES (?, ?, ?)"
    );
    const createdAt = this.context.now();
    for (const tag of normalized) insert.run(artifactId, tag, createdAt);
  }

  deleteDerivative(artifactId: string): boolean {
    this.require(artifactId);
    const lineage = this.context.database
      .prepare("SELECT 1 AS found FROM artifact_lineage WHERE artifact_id = ? LIMIT 1")
      .get(artifactId);
    if (lineage === undefined) {
      throw new BlobRepositoryError("ARTIFACT_NOT_DERIVATIVE", "Only derivative artifacts with recorded lineage can be deleted.");
    }
    const child = this.context.database
      .prepare("SELECT 1 AS found FROM artifact_lineage WHERE parent_artifact_id = ? LIMIT 1")
      .get(artifactId);
    if (child !== undefined) {
      throw new BlobRepositoryError("ARTIFACT_HAS_DESCENDANTS", "A derivative with descendants cannot be deleted.");
    }
    const durableUse = this.context.database
      .prepare(
        `SELECT 1 AS found FROM collection_memberships WHERE artifact_id = ?
         UNION ALL SELECT 1 FROM export_records WHERE artifact_id = ? AND status NOT IN ('cancelled', 'failed', 'skipped')
         UNION ALL SELECT 1 FROM live_output_entries WHERE artifact_id = ?
         LIMIT 1`
      )
      .get(artifactId, artifactId, artifactId);
    if (durableUse !== undefined) {
      throw new BlobRepositoryError("ARTIFACT_IN_USE", "Remove the derivative from collections, exports, and Live Output before deleting it.");
    }
    this.context.database.prepare("DELETE FROM artifact_lineage WHERE artifact_id = ?").run(artifactId);
    return this.context.database.prepare("DELETE FROM artifacts WHERE artifact_id = ?").run(artifactId).changes === 1;
  }

  addLineage(input: ArtifactLineageRecord): void {
    this.require(input.artifactId);
    this.require(input.parentArtifactId);
    this.context.database
      .prepare(
        `INSERT INTO artifact_lineage (
           artifact_id, parent_artifact_id, relation, source_output_version_id, metadata_json
         ) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(artifact_id, parent_artifact_id, relation) DO NOTHING`
      )
      .run(
        input.artifactId,
        input.parentArtifactId,
        input.relation,
        input.sourceOutputVersionId,
        JSON.stringify({
          ...input.metadata,
          id: typeof input.metadata.id === "string" ? input.metadata.id : this.context.createId("lineage"),
          createdAt: typeof input.metadata.createdAt === "string" ? input.metadata.createdAt : this.context.now()
        })
      );
  }

  attach(input: Artifact): Artifact {
    const artifact = ArtifactSchema.parse(input);
    const existing = this.get(artifact.id);
    if (existing !== undefined) {
      if (JSON.stringify(existing) === JSON.stringify(artifact)) return existing;
      throw new BlobRepositoryError(
        "ARTIFACT_ID_CONFLICT",
        `Artifact ${artifact.id} already identifies different persisted content.`
      );
    }
    const blob = this.context.database
      .prepare("SELECT byte_length, media_type FROM blobs WHERE content_key = ? AND status = 'ready'")
      .get(artifact.contentKey) as { byte_length: number; media_type: string } | undefined;
    if (
      blob === undefined ||
      blob.byte_length !== artifact.byteLength ||
      blob.media_type !== artifact.mediaType
    ) {
      throw new BlobRepositoryError(
        "ARTIFACT_BLOB_MISMATCH",
        "Artifact content identity, length, and media type must match a ready blob."
      );
    }
    this.validateProvenance(artifact);
    const title = typeof artifact.metadata.title === "string" ? artifact.metadata.title : artifact.id;
    const description =
      typeof artifact.metadata.description === "string" ? artifact.metadata.description : "";
    this.context.database
      .prepare(
        `INSERT INTO artifacts (
           artifact_id, content_key, kind, channel, media_type, byte_length,
           source_output_version_id, source_payload_id, title, description, metadata_json, created_at
         ) VALUES (?, ?, 'generated', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        artifact.id,
        artifact.contentKey,
        artifact.channel,
        artifact.mediaType,
        artifact.byteLength,
        artifact.source.outputVersionId,
        artifact.source.payloadId,
        title,
        description,
        JSON.stringify(artifact.metadata),
        artifact.createdAt
      );
    return artifact;
  }

  validateProvenance(input: Pick<Artifact, "channel" | "source">): void {
    const provenance = this.context.database
      .prepare(
        `SELECT p.channel, p.source_json, v.node_id
         FROM node_output_payloads p
         JOIN node_output_versions v ON v.output_version_id = p.output_version_id
         WHERE p.output_version_id = ? AND p.payload_id = ?`
      )
      .get(
        input.source.outputVersionId,
        input.source.payloadId
      ) as { channel: string; node_id: string; source_json: string } | undefined;
    const payloadSource = provenance === undefined
      ? undefined
      : JSON.parse(provenance.source_json) as { nodeId?: unknown; outputVersionId?: unknown };
    if (
      provenance === undefined ||
      provenance.channel !== input.channel ||
      payloadSource?.nodeId !== provenance.node_id ||
      payloadSource.outputVersionId !== input.source.outputVersionId
    ) {
      throw new BlobRepositoryError(
        "ARTIFACT_PROVENANCE_MISMATCH",
        "Artifact source output and payload must exist, belong together, and match the channel."
      );
    }
  }

  private require(artifactId: string): Artifact {
    const artifact = this.get(artifactId);
    if (artifact === undefined) {
      throw new BlobRepositoryError("ARTIFACT_NOT_FOUND", `Unknown artifact ${artifactId}.`);
    }
    return artifact;
  }

  repairMetadata(): ArtifactRepairMetadata {
    const database = this.context.database;
    return {
      exportRecords: (database.prepare(
        "SELECT export_id, collection_id, artifact_id FROM export_records ORDER BY export_id"
      ).all() as Array<{
        artifact_id: string | null;
        collection_id: string | null;
        export_id: string;
      }>).map((row) => ({
        id: row.export_id,
        collectionId: row.collection_id,
        artifactId: row.artifact_id
      })),
      lineage: (database.prepare(
        `SELECT artifact_id, parent_artifact_id, relation, source_output_version_id, metadata_json
         FROM artifact_lineage ORDER BY artifact_id, parent_artifact_id, relation`
      ).all() as Array<{
        artifact_id: string;
        metadata_json: string;
        parent_artifact_id: string;
        relation: string;
        source_output_version_id: string | null;
      }>).map((row) => ({
        artifactId: row.artifact_id,
        parentArtifactId: row.parent_artifact_id,
        relation: row.relation,
        sourceOutputVersionId: row.source_output_version_id,
        metadata: JSON.parse(row.metadata_json) as unknown
      })),
      tags: (database.prepare(
        "SELECT artifact_id, tag, created_at FROM artifact_tags ORDER BY artifact_id, tag"
      ).all() as Array<{ artifact_id: string; created_at: string; tag: string }>).map((row) => ({
        artifactId: row.artifact_id,
        tag: row.tag,
        createdAt: row.created_at
      })),
      ratings: (database.prepare(
        `SELECT rating_id, artifact_id, score, actor, rubric_id, notes, created_at
         FROM artifact_ratings ORDER BY rating_id`
      ).all() as Array<{
        actor: string;
        artifact_id: string;
        created_at: string;
        notes: string;
        rating_id: string;
        rubric_id: string | null;
        score: number;
      }>).map((row) => ({
        id: row.rating_id,
        artifactId: row.artifact_id,
        score: row.score,
        actor: row.actor,
        rubricId: row.rubric_id,
        notes: row.notes,
        createdAt: row.created_at
      })),
      collections: (database.prepare(
        `SELECT collection_id, name, description, is_primary, metadata_json, created_at, updated_at
         FROM collections ORDER BY collection_id`
      ).all() as Array<{
        collection_id: string;
        created_at: string;
        description: string;
        is_primary: number;
        metadata_json: string;
        name: string;
        updated_at: string;
      }>).map((row) => ({
        id: row.collection_id,
        name: row.name,
        description: row.description,
        isPrimary: row.is_primary,
        metadata: JSON.parse(row.metadata_json) as unknown,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      })),
      memberships: (database.prepare(
        `SELECT collection_id, artifact_id, position, added_at
         FROM collection_memberships ORDER BY collection_id, position`
      ).all() as Array<{
        added_at: string;
        artifact_id: string;
        collection_id: string;
        position: number;
      }>).map((row) => ({
        collectionId: row.collection_id,
        artifactId: row.artifact_id,
        position: row.position,
        addedAt: row.added_at
      }))
    };
  }

  restoreRepairMetadata(metadata: ArtifactRepairMetadata): void {
    const database = this.context.database;
    const collection = database.prepare(
      `INSERT INTO collections (
         collection_id, name, description, is_primary, metadata_json, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    for (const row of metadata.collections) {
      collection.run(
        row.id,
        row.name,
        row.description,
        row.isPrimary,
        JSON.stringify(row.metadata),
        row.createdAt,
        row.updatedAt
      );
    }
    const lineage = database.prepare(
      `INSERT INTO artifact_lineage (
         artifact_id, parent_artifact_id, relation, source_output_version_id, metadata_json
       ) VALUES (?, ?, ?, ?, ?)`
    );
    for (const row of metadata.lineage) {
      lineage.run(
        row.artifactId,
        row.parentArtifactId,
        row.relation,
        row.sourceOutputVersionId,
        JSON.stringify(row.metadata)
      );
    }
    const tag = database.prepare(
      "INSERT INTO artifact_tags (artifact_id, tag, created_at) VALUES (?, ?, ?)"
    );
    for (const row of metadata.tags) tag.run(row.artifactId, row.tag, row.createdAt);
    const rating = database.prepare(
      `INSERT INTO artifact_ratings (
         rating_id, artifact_id, score, actor, rubric_id, notes, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    for (const row of metadata.ratings) {
      rating.run(
        row.id,
        row.artifactId,
        row.score,
        row.actor,
        row.rubricId,
        row.notes,
        row.createdAt
      );
    }
    const membership = database.prepare(
      `INSERT INTO collection_memberships (collection_id, artifact_id, position, added_at)
       VALUES (?, ?, ?, ?)`
    );
    for (const row of metadata.memberships) {
      membership.run(row.collectionId, row.artifactId, row.position, row.addedAt);
    }
  }
}

function ftsPhrase(text: string): string | null {
  const tokens = text.trim().split(/\s+/).filter(Boolean).map((token) => `"${token.replaceAll('"', '""')}"`);
  return tokens.length === 0 ? null : tokens.join(" AND ");
}

function encodeArtifactCursor(createdAt: string, artifactId: string): string {
  return Buffer.from(JSON.stringify([createdAt, artifactId]), "utf8").toString("base64url");
}

function decodeArtifactCursor(cursor: string): { createdAt: string; artifactId: string } {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as unknown;
    if (!Array.isArray(parsed) || parsed.length !== 2 || typeof parsed[0] !== "string" || typeof parsed[1] !== "string") throw new Error();
    return { createdAt: parsed[0], artifactId: parsed[1] };
  } catch {
    throw new BlobRepositoryError("ARTIFACT_CURSOR_INVALID", "Artifact search cursor is invalid or expired.");
  }
}

function lineageRelation(value: string): ArtifactLineage["relation"] {
  return value === "generated-from" || value === "edited-from" || value === "selected-from" ? value : "derived-from";
}

function lineageRole(value: unknown, fallback: ArtifactLineage["role"]): ArtifactLineage["role"] {
  return typeof value === "string" && [
    "general", "negative", "subject", "product", "face", "clothing", "pose", "setting",
    "composition", "style", "lighting", "colourPalette", "typography", "motion", "timing"
  ].includes(value) ? value as ArtifactLineage["role"] : fallback;
}

function evaluationProvenance(payload: import("@ether/schema").PayloadEnvelope) {
  if (payload.content.kind !== "object" || payload.content.schemaId !== "ether.evaluation.v1" || payload.content.value === null || typeof payload.content.value !== "object" || Array.isArray(payload.content.value)) return null;
  const value = payload.content.value as Record<string, unknown>;
  const metadata = payload.metadata;
  if (typeof metadata.evaluationProviderId !== "string" || typeof metadata.evaluationModelId !== "string") return null;
  return {
    schemaId: payload.content.schemaId,
    instruction: typeof metadata.evaluationInstruction === "string" ? metadata.evaluationInstruction : "",
    rubric: Array.isArray(metadata.evaluationRubric) ? metadata.evaluationRubric : [],
    providerId: metadata.evaluationProviderId,
    modelId: metadata.evaluationModelId,
    reasoningEffort: typeof metadata.evaluationReasoningEffort === "string" ? metadata.evaluationReasoningEffort : null,
    summary: typeof value.summary === "string" ? value.summary : "",
    items: Array.isArray(value.items) ? value.items : []
  };
}
