import { z } from "zod";

export const ETHER_FILE_EXTENSION = ".ether" as const;
export const ETHER_SQLITE_APPLICATION_ID = 0x45544852 as const;
export const ETHER_FORMAT_MARKER = "ETHERDOC" as const;
export const ETHER_FORMAT_VERSION = "4.0.0" as const;
export const ETHER_SCHEMA_VERSION = 40000 as const;

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number().finite(),
    z.string(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema)
  ])
);

export const JsonObjectSchema = z.record(z.string(), JsonValueSchema);
export type JsonObject = z.infer<typeof JsonObjectSchema>;

export const TimestampSchema = z.string().datetime({ offset: true });
export type Timestamp = z.infer<typeof TimestampSchema>;

export const SemanticVersionSchema = z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
export type SemanticVersion = z.infer<typeof SemanticVersionSchema>;

export const DocumentIdentitySchema = z
  .object({
    extension: z.literal(ETHER_FILE_EXTENSION),
    sqliteApplicationId: z.literal(ETHER_SQLITE_APPLICATION_ID),
    formatMarker: z.literal(ETHER_FORMAT_MARKER),
    formatVersion: z.literal(ETHER_FORMAT_VERSION),
    schemaVersion: z.literal(ETHER_SCHEMA_VERSION)
  })
  .strict();
export type DocumentIdentity = z.infer<typeof DocumentIdentitySchema>;

export const DocumentHeaderSchema = z
  .object({
    documentId: z.string().min(1),
    formatMarker: z.literal(ETHER_FORMAT_MARKER),
    formatVersion: z.literal(ETHER_FORMAT_VERSION),
    schemaVersion: z.literal(ETHER_SCHEMA_VERSION),
    title: z.string(),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
    appVersion: SemanticVersionSchema,
    featureFlags: z.record(z.string(), z.boolean())
  })
  .strict();
export type DocumentHeader = z.infer<typeof DocumentHeaderSchema>;

export const RevisionActorSchema = z.enum(["user", "codex", "recipe", "system"]);
export type RevisionActor = z.infer<typeof RevisionActorSchema>;

export const GraphRevisionSchema = z
  .object({
    id: z.string().min(1),
    graphId: z.string().min(1),
    parentRevisionId: z.string().min(1).nullable(),
    actor: RevisionActorSchema,
    title: z.string(),
    createdAt: TimestampSchema,
    operationCount: z.number().int().nonnegative(),
    metadata: JsonObjectSchema
  })
  .strict();
export type GraphRevision = z.infer<typeof GraphRevisionSchema>;

export const DocumentRevisionSchema = z
  .object({
    id: z.string().min(1),
    parentDocumentRevisionId: z.string().min(1).nullable(),
    actor: RevisionActorSchema,
    title: z.string(),
    createdAt: TimestampSchema,
    graphRevisions: z.record(z.string().min(1), z.string().min(1)),
    metadata: JsonObjectSchema
  })
  .strict();
export type DocumentRevision = z.infer<typeof DocumentRevisionSchema>;

export const LiveOutputSettingsSchema = z
  .object({
    enabled: z.boolean(),
    pathGrantId: z.string().min(1).nullable(),
    namingPolicy: z
      .object({
        template: z.string().min(1)
      })
      .strict(),
    collisionPolicy: z.enum(["no-clobber", "suffix"]),
    transferPolicy: z.enum(["copy", "move"]),
    lastReconciledAt: TimestampSchema.nullable()
  })
  .strict()
  .superRefine((settings, context) => {
    if (settings.enabled && settings.pathGrantId === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["pathGrantId"],
        message: "Enabled Live Output requires a revocable path grant"
      });
    }
  });
export type LiveOutputSettings = z.infer<typeof LiveOutputSettingsSchema>;

export const WriterLeaseRecordSchema = z
  .object({
    pid: z.number().int().positive(),
    machineId: z.string().min(1),
    appInstanceId: z.string().min(1),
    pathHash: z.string().regex(/^[a-f0-9]{64}$/),
    documentId: z.string().min(1),
    ownerToken: z.string().min(1),
    heartbeatAt: z.number().int().nonnegative()
  })
  .strict();
export type WriterLeaseRecord = z.infer<typeof WriterLeaseRecordSchema>;
