import { z } from "zod";

import { JsonObjectSchema, JsonValueSchema, TimestampSchema } from "./document.js";
import {
  ConnectionRoleSchema,
  NodeExecutorKindSchema,
  PayloadChannelSchema
} from "./nodes.js";

export const PayloadContentSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), value: z.string() }).strict(),
  z
    .object({ kind: z.literal("object"), value: JsonValueSchema, schemaId: z.string().min(1).optional() })
    .strict(),
  z.object({ kind: z.literal("artifact"), artifactId: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("pool"), workItemIds: z.array(z.string().min(1)) }).strict()
]);
export type PayloadContent = z.infer<typeof PayloadContentSchema>;

export const PayloadSourceSchema = z
  .object({
    nodeId: z.string().min(1),
    outputVersionId: z.string().min(1),
    edgeId: z.string().min(1).optional(),
    lineageKey: z.string().min(1)
  })
  .strict();
export type PayloadSource = z.infer<typeof PayloadSourceSchema>;

export const PayloadEnvelopeSchema = z
  .object({
    id: z.string().min(1),
    channel: PayloadChannelSchema,
    role: ConnectionRoleSchema,
    content: PayloadContentSchema,
    source: PayloadSourceSchema,
    metadata: JsonObjectSchema
  })
  .strict();
export type PayloadEnvelope = z.infer<typeof PayloadEnvelopeSchema>;

export const ResolutionOptionSchema = z
  .object({
    id: z.string().min(1),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    label: z.string().min(1),
    aspectRatio: z.string().min(1).optional(),
    tier: z.string().min(1).optional()
  })
  .strict();
export type ResolutionOption = z.infer<typeof ResolutionOptionSchema>;

export const ProviderOperationSchema = z.enum([
  "generate-image",
  "edit-image",
  "upscale-image",
  "llm",
  "interpret",
  "transcribe"
]);
export type ProviderOperation = z.infer<typeof ProviderOperationSchema>;

export const ProviderCapabilitySchema = z
  .object({
    providerId: z.string().min(1),
    profileId: z.string().min(1),
    modelId: z.string().min(1).optional(),
    operation: ProviderOperationSchema,
    inputChannels: z.array(PayloadChannelSchema),
    outputChannels: z.array(PayloadChannelSchema),
    aspectRatios: z.array(z.string().min(1)),
    resolutions: z.array(ResolutionOptionSchema),
    maxReferences: z.number().int().nonnegative(),
    maxOutputsPerCall: z.number().int().positive(),
    maxParallelism: z.number().int().positive().optional(),
    supportsCancellation: z.boolean(),
    supportsSeed: z.boolean(),
    provenance: z.enum(["runtime-discovered", "conformance-verified", "static-constraint"]),
    limitations: z.array(z.string())
  })
  .strict();
export type ProviderCapability = z.infer<typeof ProviderCapabilitySchema>;

export const OutputApprovalSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("unreviewed") }).strict(),
  z
    .object({
      state: z.literal("approved"),
      actor: z.enum(["user", "codex", "system"]),
      at: TimestampSchema
    })
    .strict(),
  z
    .object({
      state: z.literal("rejected"),
      actor: z.enum(["user", "codex", "system"]),
      at: TimestampSchema,
      reason: z.string().optional()
    })
    .strict()
]);
export type OutputApproval = z.infer<typeof OutputApprovalSchema>;

export const OutputLineageSchema = z
  .object({
    parentOutputVersionId: z.string().min(1).nullable(),
    rootOutputVersionId: z.string().min(1).nullable(),
    relation: z.enum(["generated", "manual-edit", "restored"])
  })
  .strict();
export type OutputLineage = z.infer<typeof OutputLineageSchema>;

export const OutputTimingSchema = z
  .object({ startedAt: TimestampSchema, completedAt: TimestampSchema.nullable() })
  .strict();
export type OutputTiming = z.infer<typeof OutputTimingSchema>;

export const OutputFailureSchema = z
  .object({ code: z.string().min(1), message: z.string(), retryable: z.boolean() })
  .strict();
export type OutputFailure = z.infer<typeof OutputFailureSchema>;

export const OutputProducerSchema = z
  .discriminatedUnion("kind", [
    z
      .object({
        kind: z.literal("provider"),
        providerId: z.string().min(1),
        modelId: z.string().min(1),
        profileId: z.string().min(1),
        capabilitySnapshot: ProviderCapabilitySchema
      })
      .strict(),
    z
      .object({ kind: z.literal("local"), executor: NodeExecutorKindSchema })
      .strict(),
    z
      .object({ kind: z.literal("manual"), actor: z.enum(["user", "codex", "system"]) })
      .strict()
  ])
  .superRefine((producer, context) => {
    if (producer.kind !== "provider") {
      return;
    }
    if (producer.providerId !== producer.capabilitySnapshot.providerId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["providerId"],
        message: "Provider ID must match the capability snapshot"
      });
    }
    if (producer.profileId !== producer.capabilitySnapshot.profileId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["profileId"],
        message: "Profile ID must match the capability snapshot"
      });
    }
  });
export type OutputProducer = z.infer<typeof OutputProducerSchema>;

export const NodeOutputVersionSchema = z
  .object({
    id: z.string().min(1),
    nodeId: z.string().min(1),
    graphId: z.string().min(1),
    graphRevisionId: z.string().min(1),
    inputPayloadIds: z.array(z.string().min(1)),
    selectedOutputVersionIds: z.array(z.string().min(1)),
    compiledContextHash: z.string().min(1),
    producer: OutputProducerSchema,
    outputPayloadIds: z.array(z.string().min(1)),
    parentOutputVersionId: z.string().min(1).nullable(),
    lineage: OutputLineageSchema.optional(),
    selectedBy: z
      .object({ edgeId: z.string().min(1), selector: z.enum(["latest-approved", "latest", "all", "pinned"]) })
      .strict()
      .optional(),
    approval: OutputApprovalSchema,
    runId: z.string().min(1).nullable(),
    stepId: z.string().min(1).nullable(),
    workItemId: z.string().min(1).nullable(),
    attemptId: z.string().min(1).nullable(),
    timing: OutputTimingSchema,
    failure: OutputFailureSchema.nullable(),
    createdAt: TimestampSchema
  })
  .strict()
  .superRefine((output, context) => {
    const provenanceIds = [output.runId, output.stepId, output.workItemId, output.attemptId];
    const presentProvenanceIds = provenanceIds.filter((value) => value !== null).length;
    if (presentProvenanceIds !== 0 && presentProvenanceIds !== provenanceIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["runId"],
        message: "Run, step, work item, and attempt provenance must be present together"
      });
    }
    if (output.producer.kind === "provider" && presentProvenanceIds !== provenanceIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["producer"],
        message: "Provider-generated outputs require complete execution provenance"
      });
    }
    if (output.producer.kind === "manual" && output.parentOutputVersionId === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["parentOutputVersionId"],
        message: "Manual output edits must descend from an existing output version"
      });
    }
    if (output.timing.completedAt === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["timing", "completedAt"],
        message: "Immutable output versions require a completion timestamp"
      });
    } else {
      if (Date.parse(output.timing.completedAt) < Date.parse(output.timing.startedAt)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["timing", "completedAt"],
          message: "Output generation cannot complete before it starts"
        });
      }
      if (Date.parse(output.createdAt) < Date.parse(output.timing.completedAt)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["createdAt"],
          message: "An output version cannot be created before generation completes"
        });
      }
    }
    if (output.failure !== null && output.outputPayloadIds.length > 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["outputPayloadIds"],
        message: "Failed output versions cannot carry successful output payloads"
      });
    }
  });
export type NodeOutputVersion = z.infer<typeof NodeOutputVersionSchema>;
