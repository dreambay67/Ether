import { ArtifactSchema, type Artifact } from "@ether/schema";

import type { RepositoryTransactionContext } from "./graphs.js";
import { BlobRepositoryError } from "./blobs.js";

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

export interface ArtifactDetail {
  artifact: Artifact;
  collections: Array<{ id: string; title: string }>;
  lineage: ArtifactLineageRecord[];
  ratings: Array<{
    actor: string;
    createdAt: string;
    id: string;
    notes: string;
    rubricId: string | null;
    score: number;
  }>;
  tags: string[];
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
         FROM artifact_lineage WHERE artifact_id = ? ORDER BY parent_artifact_id, relation`
      )
      .all(artifactId) as unknown as Array<{
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
    return {
      artifact,
      collections: collections.map((row) => ({ id: row.collection_id, title: row.title })),
      lineage: this.lineage(artifactId),
      tags: tags.map((row) => row.tag),
      ratings: ratings.map((row) => ({
        id: row.rating_id,
        score: row.score,
        actor: row.actor,
        rubricId: row.rubric_id,
        notes: row.notes,
        createdAt: row.created_at
      }))
    };
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
        JSON.stringify(input.metadata)
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
