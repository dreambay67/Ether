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
      .prepare("SELECT artifact_id FROM artifacts ORDER BY artifact_id")
      .all() as unknown as Array<{ artifact_id: string }>;
    return rows.map(({ artifact_id }) => this.get(artifact_id)).filter((value): value is Artifact => value !== undefined);
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
}
