import { z } from "zod";

import { JsonObjectSchema, TimestampSchema } from "./document.js";
import { ConnectionRoleSchema, PayloadChannelSchema } from "./nodes.js";

export const ContentKeySchema = z.string().regex(/^[a-fA-F0-9]{64}$/);
export type ContentKey = z.infer<typeof ContentKeySchema>;

export const ArtifactSourceSchema = z
  .object({ outputVersionId: z.string().min(1), payloadId: z.string().min(1) })
  .strict();
export type ArtifactSource = z.infer<typeof ArtifactSourceSchema>;

export const ArtifactSchema = z
  .object({
    id: z.string().min(1),
    contentKey: ContentKeySchema,
    channel: PayloadChannelSchema,
    mediaType: z.string().min(1),
    byteLength: z.number().int().nonnegative(),
    source: ArtifactSourceSchema,
    createdAt: TimestampSchema,
    metadata: JsonObjectSchema
  })
  .strict();
export type Artifact = z.infer<typeof ArtifactSchema>;

export const ReferenceFileIdentitySchema = z
  .object({
    platform: z.string().min(1),
    device: z.string().min(1),
    fileId: z.string().min(1)
  })
  .strict();
export type ReferenceFileIdentity = z.infer<typeof ReferenceFileIdentitySchema>;

export const ReferenceFingerprintSchema = z
  .object({
    byteLength: z.number().int().nonnegative(),
    modifiedAt: z.number().nonnegative(),
    sampleSha256: ContentKeySchema
  })
  .strict();
export type ReferenceFingerprint = z.infer<typeof ReferenceFingerprintSchema>;

export const LinkedReferenceSchema = z
  .object({
    id: z.string().min(1),
    displayName: z.string().min(1),
    mediaType: z.string().min(1),
    state: z.enum(["linked", "embedded", "missing", "relinking"]),
    originalPath: z.string().min(1).nullable(),
    pathGrantId: z.string().min(1).nullable(),
    contentKey: ContentKeySchema.nullable(),
    previewContentKey: ContentKeySchema.nullable(),
    identity: ReferenceFileIdentitySchema.nullable(),
    fingerprint: ReferenceFingerprintSchema,
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema
  })
  .strict();
export type LinkedReference = z.infer<typeof LinkedReferenceSchema>;

export const ProviderCompletionRecoverySchema = z
  .object({
    attemptId: z.string().min(1),
    providerAttemptId: z.string().min(1),
    expectedOutputCount: z.number().int().positive(),
    providerRunId: z.string().min(1),
    capabilitySnapshotId: z.string().min(1),
    acceptedAt: TimestampSchema,
    providerId: z.string().min(1),
    modelId: z.string().min(1),
    capabilitySnapshot: z.record(z.unknown()),
    request: z.record(z.unknown()),
    response: z.record(z.unknown()).nullable(),
    metadata: z.record(z.unknown()).nullable(),
    outputs: z.array(
      z
        .object({
          ordinal: z.number().int().nonnegative(),
          artifactId: z.string().min(1),
          outputVersionId: z.string().min(1),
          payloadId: z.string().min(1),
          importId: z.string().min(1),
          stagedPath: z.string().min(1),
          fileName: z.string().min(1),
          mediaType: z.string().min(1),
          artifactMetadata: z.record(z.unknown())
        })
        .strict()
    )
  })
  .strict();
export type ProviderCompletionRecovery = z.infer<typeof ProviderCompletionRecoverySchema>;

export const RecoveryJournalEntrySchema = z
  .object({
    id: z.string().min(1),
    kind: z.enum(["blob-import", "document-repair", "provider-output"]),
    state: z.enum(["prepared", "staged", "validated", "publishing", "committed", "failed"]),
    documentId: z.string().min(1),
    documentPath: z.string().min(1),
    stagedPath: z.string().min(1),
    destinationPath: z.string().min(1).optional(),
    expectedDocumentId: z.string().min(1).optional(),
    sourceName: z.string().min(1),
    mediaType: z.string().min(1),
    artifact: ArtifactSchema.omit({ contentKey: true, byteLength: true }).optional(),
    execution: ProviderCompletionRecoverySchema.optional(),
    contentKey: ContentKeySchema.optional(),
    byteLength: z.number().int().nonnegative().optional(),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema
  })
  .strict()
  .superRefine((entry, context) => {
    if (entry.kind === "provider-output" && entry.artifact === undefined && entry.execution === undefined) {
      context.addIssue({
        code: "custom",
        message: "Provider recovery requires catalog artifact metadata.",
        path: ["artifact"]
      });
    }
    if (entry.kind === "document-repair" && entry.destinationPath === undefined) {
      context.addIssue({
        code: "custom",
        message: "Document repair recovery requires its publication destination.",
        path: ["destinationPath"]
      });
    }
    if (entry.kind === "document-repair" && entry.expectedDocumentId === undefined) {
      context.addIssue({
        code: "custom",
        message: "Document repair recovery requires its expected document identity.",
        path: ["expectedDocumentId"]
      });
    }
  });
export type RecoveryJournalEntry = z.infer<typeof RecoveryJournalEntrySchema>;

export const ArtifactLineageSchema = z
  .object({
    id: z.string().min(1),
    parentArtifactId: z.string().min(1),
    childArtifactId: z.string().min(1),
    relation: z.enum(["generated-from", "edited-from", "derived-from", "selected-from"]),
    role: ConnectionRoleSchema,
    createdAt: TimestampSchema
  })
  .strict();
export type ArtifactLineage = z.infer<typeof ArtifactLineageSchema>;

export const ArtifactTagSchema = z
  .object({ artifactId: z.string().min(1), tag: z.string().min(1), createdAt: TimestampSchema })
  .strict();
export type ArtifactTag = z.infer<typeof ArtifactTagSchema>;

export const ArtifactRatingSchema = z
  .object({
    artifactId: z.string().min(1),
    rating: z.number().int().min(0).max(5),
    actor: z.string().min(1),
    createdAt: TimestampSchema
  })
  .strict();
export type ArtifactRating = z.infer<typeof ArtifactRatingSchema>;

export const CollectionSchema = z
  .object({
    id: z.string().min(1),
    title: z.string(),
    description: z.string(),
    primary: z.boolean(),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema
  })
  .strict();
export type Collection = z.infer<typeof CollectionSchema>;

export const CollectionMembershipSchema = z
  .object({
    collectionId: z.string().min(1),
    artifactId: z.string().min(1),
    role: ConnectionRoleSchema,
    source: z
      .object({ nodeId: z.string().min(1).optional(), commandId: z.string().min(1).optional() })
      .strict()
      .optional(),
    position: z.number().int().nonnegative().optional(),
    addedAt: TimestampSchema.optional(),
    // Kept for current repository records until they begin emitting addedAt/source.
    sourceNodeId: z.string().min(1).optional(),
    createdAt: TimestampSchema.optional()
  })
  .strict();
export type CollectionMembership = z.infer<typeof CollectionMembershipSchema>;

export const ExportRecordSchema = z
  .object({
    id: z.string().min(1),
    artifactId: z.string().min(1).nullable(),
    collectionId: z.string().min(1).nullable().optional(),
    pathGrantId: z.string().min(1).nullable(),
    relativePath: z.string().min(1),
    contentKey: ContentKeySchema,
    status: z.enum(["planned", "staged", "written", "verified", "committed", "skipped", "failed", "cancelled"]),
    options: JsonObjectSchema.optional(),
    createdAt: TimestampSchema,
    completedAt: TimestampSchema.nullable()
  })
  .strict();
export type ExportRecord = z.infer<typeof ExportRecordSchema>;
