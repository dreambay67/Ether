import { z } from "zod";

import { JsonObjectSchema, JsonValueSchema, TimestampSchema } from "./document.js";
import {
  ContextPolicySchema,
  MemoryPolicySchema,
  NodeExecutorKindSchema,
  PayloadChannelSchema,
  WorkerBehaviorSchema,
  WorkerOutputContractSchema,
  WorkerProfileSchema
} from "./nodes.js";
import { PayloadEnvelopeSchema, ProviderCapabilitySchema } from "./outputs.js";

export const ExecutionScopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("node"), nodeId: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("selected"), nodeIds: z.array(z.string().min(1)).min(1) }).strict(),
  z.object({ kind: z.literal("branch"), rootNodeId: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("downstream"), rootNodeId: z.string().min(1), includeRoot: z.boolean().optional() }).strict(),
  z.object({ kind: z.literal("graph") }).strict(),
  z.object({ kind: z.literal("recipe"), recipeInstanceId: z.string().min(1) }).strict()
]);
export type ExecutionScope = z.infer<typeof ExecutionScopeSchema>;

export const PlanStepSubjectSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("node"), nodeId: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("adapter"), adapterId: z.string().min(1) }).strict()
]);
export type PlanStepSubject = z.infer<typeof PlanStepSubjectSchema>;

export const ResolvedInputBindingSchema = z
  .object({
    name: z.string().min(1),
    payloadId: z.string().min(1),
    sourceStepId: z.string().min(1).nullable(),
    selector: z.enum(["latest-approved", "latest", "all", "pinned"]).optional()
  })
  .strict();
export type ResolvedInputBinding = z.infer<typeof ResolvedInputBindingSchema>;

export const ExecutionPlanStatusSchema = z.enum([
  "previewed",
  "started",
  "completed",
  "failed",
  "cancelled",
  "invalidated",
  "waiting-review",
  "needs-attention"
]);
export type ExecutionPlanStatus = z.infer<typeof ExecutionPlanStatusSchema>;

export const ProviderBindingSchema = z
  .object({
    providerId: z.string().min(1),
    profileId: z.string().min(1),
    modelId: z.string().min(1),
    settings: JsonObjectSchema,
    capabilitySnapshot: ProviderCapabilitySchema
  })
  .strict();
export type ProviderBinding = z.infer<typeof ProviderBindingSchema>;

export const PlanStepSchema = z
  .object({
    id: z.string().min(1),
    // nodeId remains the owning graph node for existing persisted plans; subject can
    // name the node itself or a durable adapter step attached to that node.
    nodeId: z.string().min(1),
    subject: PlanStepSubjectSchema.optional(),
    executor: NodeExecutorKindSchema,
    dependencyStepIds: z.array(z.string().min(1)),
    inputPayloadIds: z.array(z.string().min(1)),
    resolvedInputBindings: z.array(ResolvedInputBindingSchema).optional(),
    workItemIds: z.array(z.string().min(1)),
    compiledPrompt: z.string(),
    compiledContext: JsonObjectSchema,
    parameters: JsonObjectSchema,
    selectors: z.array(JsonObjectSchema),
    executorConfig: JsonObjectSchema.optional(),
    provider: ProviderBindingSchema,
    // New plans use this nullable binding for local and human work; provider remains
    // required for the already-compiled provider plan callers.
    providerBinding: ProviderBindingSchema
      .nullable()
      .optional()
  })
  .strict()
  .superRefine((step, context) => {
    if (step.subject?.kind === "node" && step.subject.nodeId !== step.nodeId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["subject", "nodeId"],
        message: "Node plan step subject must match legacy nodeId"
      });
    }
  });
export type PlanStep = z.infer<typeof PlanStepSchema>;

export const PlannedInputSchema = z
  .object({ name: z.string().min(1), payloadId: z.string().min(1) })
  .strict();
export type PlannedInput = z.infer<typeof PlannedInputSchema>;

export const PlannedParameterSchema = z
  .object({ name: z.string().min(1), value: JsonValueSchema })
  .strict();
export type PlannedParameter = z.infer<typeof PlannedParameterSchema>;

export const PlannedWorkItemSchema = z
  .object({
    id: z.string().min(1),
    stepId: z.string().min(1),
    ordinal: z.number().int().nonnegative(),
    inputs: z.array(PlannedInputSchema),
    parameters: z.array(PlannedParameterSchema),
    dependencyWorkItemIds: z.array(z.string().min(1)).optional(),
    providerBindingOverride: ProviderBindingSchema.optional()
  })
  .strict();
export type PlannedWorkItem = z.infer<typeof PlannedWorkItemSchema>;

export const PlanWarningSchema = z
  .object({
    code: z.string().min(1),
    message: z.string(),
    nodeId: z.string().min(1).optional(),
    blocking: z.boolean()
  })
  .strict();
export type PlanWarning = z.infer<typeof PlanWarningSchema>;

export const ExecutionPlanSchema = z
  .object({
    id: z.string().min(1),
    capsuleVersion: z.literal(1),
    hashVersion: z.literal("sha256-v1"),
    documentId: z.string().min(1),
    documentRevisionId: z.string().min(1),
    graphId: z.string().min(1),
    graphRevisionId: z.string().min(1),
    scope: ExecutionScopeSchema,
    status: ExecutionPlanStatusSchema.optional(),
    steps: z.array(PlanStepSchema),
    workItems: z.array(PlannedWorkItemSchema),
    providerCapabilitySnapshots: z.array(ProviderCapabilitySchema),
    estimatedCalls: z.number().int().nonnegative(),
    batchSummary: z
      .object({
        dimensions: z.number().int().nonnegative(),
        exclusions: z.number().int().nonnegative(),
        workItemCount: z.number().int().nonnegative()
      })
      .strict()
      .optional(),
    requestedParallelism: z.number().int().positive().optional(),
    effectiveParallelism: z.number().int().positive().optional(),
    warnings: z.array(PlanWarningSchema),
    contentHash: z.string().regex(/^sha256:v1:[a-f0-9]{64}$/),
    createdAt: TimestampSchema
  })
  .strict();
export type ExecutionPlan = z.infer<typeof ExecutionPlanSchema>;

export const DownstreamCapabilitySummarySchema = z
  .object({
    requiredChannels: z.array(PayloadChannelSchema),
    providerProfileIds: z.array(z.string().min(1)),
    limitations: z.array(z.string())
  })
  .strict();
export type DownstreamCapabilitySummary = z.infer<typeof DownstreamCapabilitySummarySchema>;

export const WorkerRequestSchema = z
  .object({
    behavior: WorkerBehaviorSchema,
    instruction: z.string(),
    profile: WorkerProfileSchema,
    model: z.string().min(1),
    reasoningEffort: z.string().min(1),
    variation: z.number().min(0).max(1),
    contextPolicy: ContextPolicySchema,
    memoryPolicy: MemoryPolicySchema,
    outputContract: WorkerOutputContractSchema,
    inputs: z.array(PayloadEnvelopeSchema),
    downstream: DownstreamCapabilitySummarySchema.nullable()
  })
  .strict();
export type WorkerRequest = z.infer<typeof WorkerRequestSchema>;

export const JobStatusSchema = z.enum([
  "planned",
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
  "waiting-review",
  "needs-attention"
]);
export type JobStatus = z.infer<typeof JobStatusSchema>;

export const ExecutionJobSchema = z
  .object({
    id: z.string().min(1),
    planId: z.string().min(1),
    planContentHash: z.string().min(1),
    status: JobStatusSchema,
    requestedParallelism: z.number().int().positive().optional(),
    effectiveParallelism: z.number().int().positive().optional(),
    createdAt: TimestampSchema,
    startedAt: TimestampSchema.nullable(),
    completedAt: TimestampSchema.nullable(),
    cancellationRequestedAt: TimestampSchema.nullable()
  })
  .strict()
  .superRefine((job, context) => {
    const requiresStarted = ["running", "completed", "failed", "waiting-review", "needs-attention"].includes(
      job.status
    );
    const requiresCompleted = ["completed", "failed", "cancelled", "needs-attention"].includes(
      job.status
    );
    if (job.status !== "cancelled" && requiresStarted !== (job.startedAt !== null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["startedAt"],
        message: `${job.status} jobs ${requiresStarted ? "require" : "cannot have"} startedAt`
      });
    }
    if (requiresCompleted !== (job.completedAt !== null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["completedAt"],
        message: `${job.status} jobs ${requiresCompleted ? "require" : "cannot have"} completedAt`
      });
    }
    if (job.status === "cancelled" && job.cancellationRequestedAt === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["cancellationRequestedAt"],
        message: "Cancelled jobs require a cancellation request timestamp"
      });
    }
    if (
      job.cancellationRequestedAt !== null &&
      !["running", "cancelled"].includes(job.status)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["cancellationRequestedAt"],
        message: "Only running or cancelled jobs may carry cancellation request state"
      });
    }
    if (job.startedAt !== null && Date.parse(job.startedAt) < Date.parse(job.createdAt)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["startedAt"],
        message: "Job cannot start before it is created"
      });
    }
    if (
      job.startedAt !== null &&
      job.completedAt !== null &&
      Date.parse(job.completedAt) < Date.parse(job.startedAt)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["completedAt"],
        message: "Job cannot complete before it starts"
      });
    }
    if (job.completedAt !== null && Date.parse(job.completedAt) < Date.parse(job.createdAt)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["completedAt"],
        message: "Job cannot complete before it is created"
      });
    }
    if (
      job.cancellationRequestedAt !== null &&
      Date.parse(job.cancellationRequestedAt) < Date.parse(job.createdAt)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["cancellationRequestedAt"],
        message: "Cancellation cannot be requested before the job is created"
      });
    }
    if (
      job.cancellationRequestedAt !== null &&
      job.completedAt !== null &&
      Date.parse(job.completedAt) < Date.parse(job.cancellationRequestedAt)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["completedAt"],
        message: "A cancelled job cannot complete before cancellation is requested"
      });
    }
  });
export type ExecutionJob = z.infer<typeof ExecutionJobSchema>;

export const WorkItemStatusSchema = z.enum([
  "queued",
  "running",
  "accepted",
  "failed",
  "cancelled"
  ,"waiting-review"
  ,"needs-attention"
]);
export type WorkItemStatus = z.infer<typeof WorkItemStatusSchema>;

export const ExecutionWorkItemSchema = z
  .object({
    id: z.string().min(1),
    jobId: z.string().min(1),
    plannedWorkItemId: z.string().min(1),
    status: WorkItemStatusSchema,
    acceptedAttemptId: z.string().min(1).nullable(),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema
  })
  .strict()
  .superRefine((workItem, context) => {
    if ((workItem.status === "accepted") !== (workItem.acceptedAttemptId !== null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["acceptedAttemptId"],
        message: "Only accepted work items must identify their accepted attempt"
      });
    }
    if (Date.parse(workItem.updatedAt) < Date.parse(workItem.createdAt)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["updatedAt"],
        message: "Work item cannot be updated before it is created"
      });
    }
  });
export type ExecutionWorkItem = z.infer<typeof ExecutionWorkItemSchema>;

export const AttemptStatusSchema = z.enum([
  "queued",
  "running",
  "accepted",
  "failed",
  "cancelled"
  ,"needs-attention"
]);
export type AttemptStatus = z.infer<typeof AttemptStatusSchema>;

export const ExecutionAttemptSchema = z
  .object({
    id: z.string().min(1),
    workItemId: z.string().min(1),
    ordinal: z.number().int().positive(),
    status: AttemptStatusSchema,
    providerRunId: z.string().min(1).nullable(),
    outputVersionIds: z.array(z.string().min(1)),
    failure: z
      .object({ code: z.string().min(1), message: z.string(), retryable: z.boolean(), details: JsonObjectSchema })
      .strict()
      .nullable(),
    createdAt: TimestampSchema,
    startedAt: TimestampSchema.nullable(),
    completedAt: TimestampSchema.nullable()
  })
  .strict()
  .superRefine((attempt, context) => {
    const requiresStarted = ["running", "accepted", "failed"].includes(attempt.status);
    const requiresCompleted = ["accepted", "failed", "cancelled"].includes(attempt.status);
    if (attempt.status !== "cancelled" && requiresStarted !== (attempt.startedAt !== null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["startedAt"],
        message: `${attempt.status} attempts ${requiresStarted ? "require" : "cannot have"} startedAt`
      });
    }
    if (requiresCompleted !== (attempt.completedAt !== null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["completedAt"],
        message: `${attempt.status} attempts ${requiresCompleted ? "require" : "cannot have"} completedAt`
      });
    }
    if ((attempt.status === "failed") !== (attempt.failure !== null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["failure"],
        message: "Failed attempts require failure details and other attempts cannot carry them"
      });
    }
    if (attempt.status === "accepted" && attempt.outputVersionIds.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["outputVersionIds"],
        message: "Accepted attempts require at least one immutable output version"
      });
    }
    if (["queued", "running"].includes(attempt.status) && attempt.outputVersionIds.length > 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["outputVersionIds"],
        message: "Non-terminal attempts cannot carry output versions"
      });
    }
    if (attempt.startedAt !== null && Date.parse(attempt.startedAt) < Date.parse(attempt.createdAt)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["startedAt"],
        message: "Attempt cannot start before it is created"
      });
    }
    if (
      attempt.startedAt !== null &&
      attempt.completedAt !== null &&
      Date.parse(attempt.completedAt) < Date.parse(attempt.startedAt)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["completedAt"],
        message: "Attempt cannot complete before it starts"
      });
    }
    if (
      attempt.completedAt !== null &&
      Date.parse(attempt.completedAt) < Date.parse(attempt.createdAt)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["completedAt"],
        message: "Attempt cannot complete before it is created"
      });
    }
  });
export type ExecutionAttempt = z.infer<typeof ExecutionAttemptSchema>;

export function parseExecutionPlan(input: unknown): ExecutionPlan {
  return ExecutionPlanSchema.parse(input);
}
