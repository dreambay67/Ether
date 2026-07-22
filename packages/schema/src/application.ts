import { z } from "zod";

import {
  ArtifactLineageSchema,
  ArtifactSchema,
  CollectionMembershipSchema,
  CollectionSchema,
  ExportRecordSchema,
  LinkedReferenceSchema
} from "./artifacts.js";
import {
  DocumentHeaderSchema,
  JsonObjectSchema,
  LiveOutputEntrySchema,
  LiveOutputOperationSchema,
  LiveOutputSettingsSchema,
  TimestampSchema
} from "./document.js";
import {
  AttemptStatusSchema,
  ExecutionAttemptSchema,
  ExecutionJobSchema,
  ExecutionPlanSchema,
  ExecutionScopeSchema,
  ExecutionWorkItemSchema,
  JobStatusSchema,
  WorkItemStatusSchema
} from "./execution.js";
import {
  EtherEdgeSchema,
  EtherGraphSchema,
  GraphTransactionSchema,
  type GraphTransaction
} from "./graph.js";
import {
  ConnectionRoleSchema,
  EtherNodeSchema,
  PayloadChannelSchema
} from "./nodes.js";
import {
  NodeOutputVersionSchema,
  OutputApprovalSchema,
  PayloadEnvelopeSchema,
  ProviderCapabilitySchema
} from "./outputs.js";
import {
  RecipeManifestSchema,
  RecipeParameterSchema,
  RecipeParameterValueSchema
} from "./recipes.js";

export const applicationCommandNames = [
  "document.new",
  "document.open",
  "document.save",
  "document.saveAs",
  "document.saveCopy",
  "document.close",
  "document.compact",
  "document.recover",
  "graph.applyTransaction",
  "graph.undo",
  "graph.redo",
  "graph.validate",
  "graph.layout",
  "reference.link",
  "reference.embed",
  "reference.relink",
  "reference.remove",
  "reference.assignToSet",
  "output.edit",
  "output.pin",
  "output.restore",
  "recipe.preview",
  "recipe.instantiate",
  "run.preview",
  "run.start",
  "run.cancel",
  "run.retry",
  "run.resume",
  "review.approve",
  "review.reject",
  "review.rate",
  "review.tag",
  "review.route",
  "review.completeCompare",
  "collection.create",
  "collection.update",
  "collection.delete",
  "collection.addMembers",
  "collection.removeMembers",
  "collection.setPrimary",
  "artifact.export",
  "artifact.dragExport",
  "artifact.deleteDerivative",
  "export.retry",
  "export.cancel",
  "provider.probe",
  "provider.refresh",
  "provider.configure",
  "provider.disable",
  "recipe.install",
  "recipe.remove",
  "job.cancel",
  "job.retry",
  "job.resume",
  "recovery.inspect",
  "recovery.dismiss",
  "permission.grantEdit",
  "permission.grantRun",
  "permission.grantPath",
  "permission.revoke",
  "liveOutput.enable",
  "liveOutput.disable",
  "liveOutput.rebuild",
  "liveOutput.reconcile",
  "liveOutput.removeMirrorFiles"
] as const;
export const ApplicationCommandNameSchema = z.enum(applicationCommandNames);
export type ApplicationCommandName = z.infer<typeof ApplicationCommandNameSchema>;

export const applicationQueryNames = [
  "document.summary",
  "document.dirtyState",
  "graph.snapshot",
  "graph.catalog",
  "graph.selectionDetails",
  "graph.validation",
  "node.outputs",
  "node.compiledInputPreview",
  "reference.list",
  "reference.detail",
  "output.detail",
  "provider.capabilities",
  "provider.health",
  "plan.summary",
  "job.summary",
  "job.list",
  "job.timeline",
  "job.workItems",
  "job.attempts",
  "artifact.search",
  "artifact.detail",
  "collection.list",
  "collection.detail",
  "collection.membership",
  "artifact.lineage",
  "export.records",
  "liveOutput.status",
  "liveOutput.entries",
  "liveOutput.operations",
  "recipe.catalog",
  "recipe.setupSchema",
  "recovery.status",
  "storage.status"
] as const;
export const ApplicationQueryNameSchema = z.enum(applicationQueryNames);
export type ApplicationQueryName = z.infer<typeof ApplicationQueryNameSchema>;

export const applicationEventNames = [
  "document.stateChanged",
  "graph.revisionChanged",
  "output.created",
  "output.pinned",
  "output.reviewed",
  "domain.selectionChanged",
  "provider.healthChanged",
  "plan.stateChanged",
  "job.stateChanged",
  "workItem.stateChanged",
  "attempt.stateChanged",
  "artifact.accepted",
  "artifact.changed",
  "export.stateChanged",
  "collection.changed",
  "reference.missing",
  "reference.relinked",
  "reference.changed",
  "recipe.installed",
  "recipe.changed",
  "permission.changed",
  "recovery.attention",
  "liveOutput.progress",
  "liveOutput.attention"
] as const;
export const ApplicationEventNameSchema = z.enum(applicationEventNames);
export type ApplicationEventName = z.infer<typeof ApplicationEventNameSchema>;

export const globalApplicationCommandNames = [
  "document.new",
  "document.open",
  "document.recover",
  "provider.probe",
  "provider.refresh"
] as const satisfies readonly ApplicationCommandName[];
export const globalApplicationQueryNames = [
  "provider.capabilities",
  "provider.health",
  "recipe.catalog",
  "recipe.setupSchema"
] as const satisfies readonly ApplicationQueryName[];
export const globalApplicationEventNames = [
  "provider.healthChanged",
  "recipe.installed"
] as const satisfies readonly ApplicationEventName[];

export const StrictEmptyPayloadSchema = z.object({}).strict();
export type StrictEmptyPayload = z.infer<typeof StrictEmptyPayloadSchema>;

const idSchema = z.string().min(1);
const graphIdPayloadSchema = z.object({ graphId: idSchema }).strict();
const planIdPayloadSchema = z.object({ planId: idSchema }).strict();
const jobIdPayloadSchema = z.object({ jobId: idSchema }).strict();
const referenceIdPayloadSchema = z.object({ referenceId: idSchema }).strict();

export const applicationCommandPayloadSchemas = {
  "document.new": z.object({ title: z.string() }).strict(),
  "document.open": z.object({ pathGrantId: idSchema }).strict(),
  "document.save": StrictEmptyPayloadSchema,
  "document.saveAs": z.object({ pathGrantId: idSchema }).strict(),
  "document.saveCopy": z.object({ pathGrantId: idSchema }).strict(),
  "document.close": z.object({ force: z.boolean() }).strict(),
  "document.compact": StrictEmptyPayloadSchema,
  "document.recover": z
    .object({ sourceGrantId: idSchema, destinationGrantId: idSchema })
    .strict(),
  "graph.applyTransaction": z.object({ transaction: GraphTransactionSchema }).strict(),
  "graph.undo": graphIdPayloadSchema,
  "graph.redo": graphIdPayloadSchema,
  "graph.validate": graphIdPayloadSchema,
  "graph.layout": z
    .object({ graphId: idSchema, policy: z.enum(["tidy-affected", "layout-branch"]) })
    .strict(),
  "reference.link": z
    .object({
      graphId: idSchema,
      nodeId: idSchema,
      pathGrantId: idSchema,
      role: ConnectionRoleSchema
    })
    .strict(),
  "reference.embed": referenceIdPayloadSchema,
  "reference.relink": z.object({ referenceId: idSchema, pathGrantId: idSchema }).strict(),
  "reference.remove": referenceIdPayloadSchema,
  "reference.assignToSet": z
    .object({ nodeId: idSchema, members: z.array(idSchema).min(1), replace: z.boolean().optional() })
    .strict(),
  "output.edit": z
    .object({ outputVersionId: idSchema, payload: JsonObjectSchema, note: z.string().optional() })
    .strict(),
  "output.pin": z
    .object({ edgeId: idSchema, outputVersionId: idSchema, baseDocumentRevisionId: idSchema })
    .strict(),
  "output.restore": z
    .object({ outputVersionId: idSchema, note: z.string().optional() })
    .strict(),
  "recipe.preview": z
    .object({
      recipeId: idSchema,
      version: z.string().min(1),
      parameters: z.array(RecipeParameterValueSchema)
    })
    .strict(),
  "recipe.instantiate": z
    .object({
      recipeId: idSchema,
      version: z.string().min(1),
      targetGraphId: idSchema,
      parameters: z.array(RecipeParameterValueSchema)
    })
    .strict(),
  "run.preview": z.object({ graphId: idSchema, scope: ExecutionScopeSchema }).strict(),
  "run.start": z
    .object({ planId: idSchema, contentHash: idSchema, runPermitId: idSchema })
    .strict(),
  "run.cancel": jobIdPayloadSchema,
  "run.retry": z.object({ jobId: idSchema, workItemIds: z.array(idSchema).min(1) }).strict(),
  "run.resume": jobIdPayloadSchema,
  "review.approve": z
    .object({ outputVersionId: idSchema, approved: z.boolean() })
    .strict(),
  "review.reject": z.object({ outputVersionId: idSchema, reason: z.string().optional() }).strict(),
  "review.rate": z.object({ artifactId: idSchema, rating: z.number().int().min(0).max(5) }).strict(),
  "review.tag": z.object({ artifactId: idSchema, tags: z.array(z.string().min(1)) }).strict(),
  "review.route": z
    .object({ artifactId: idSchema, collectionId: idSchema, role: ConnectionRoleSchema })
    .strict(),
  "review.completeCompare": z
    .object({ checkpointId: idSchema, selectedOutputVersionIds: z.array(idSchema), note: z.string().optional() })
    .strict(),
  "collection.create": z
    .object({ title: z.string(), description: z.string().optional(), primary: z.boolean().optional() })
    .strict(),
  "collection.update": z
    .object({ collectionId: idSchema, title: z.string().optional(), description: z.string().optional() })
    .strict(),
  "collection.delete": z.object({ collectionId: idSchema }).strict(),
  "collection.addMembers": z
    .object({
      collectionId: idSchema,
      members: z.array(z.object({ artifactId: idSchema, role: ConnectionRoleSchema, position: z.number().int().nonnegative().optional() }).strict()).min(1)
    })
    .strict(),
  "collection.removeMembers": z
    .object({ collectionId: idSchema, artifactIds: z.array(idSchema).min(1) })
    .strict(),
  "collection.setPrimary": z.object({ collectionId: idSchema }).strict(),
  "artifact.export": z
    .object({
      artifactIds: z.array(idSchema).min(1),
      pathGrantId: idSchema,
      namingTemplate: z.string().min(1),
      collisionPolicy: z.enum(["rename", "skip", "error"])
    })
    .strict(),
  "artifact.dragExport": z
    .object({ artifactIds: z.array(idSchema).min(1), lifetimeHours: z.number().positive().max(168) })
    .strict(),
  "artifact.deleteDerivative": z.object({ artifactId: idSchema }).strict(),
  "export.retry": z.object({ exportId: idSchema }).strict(),
  "export.cancel": z.object({ exportId: idSchema }).strict(),
  "provider.probe": z.object({ providerId: idSchema, profileId: idSchema.optional() }).strict(),
  "provider.refresh": StrictEmptyPayloadSchema,
  "provider.configure": z
    .object({ providerId: idSchema, profileId: idSchema, settings: JsonObjectSchema })
    .strict(),
  "provider.disable": z.object({ providerId: idSchema, profileId: idSchema.optional() }).strict(),
  "recipe.install": z.object({ manifest: RecipeManifestSchema }).strict(),
  "recipe.remove": z.object({ recipeId: idSchema, version: z.string().min(1) }).strict(),
  "job.cancel": jobIdPayloadSchema,
  "job.retry": z.object({ jobId: idSchema, workItemIds: z.array(idSchema).min(1) }).strict(),
  "job.resume": jobIdPayloadSchema,
  "recovery.inspect": StrictEmptyPayloadSchema,
  "recovery.dismiss": z.object({ reportId: idSchema }).strict(),
  "permission.grantEdit": z
    .object({ expiresAt: TimestampSchema.optional() })
    .strict(),
  "permission.grantRun": z.object({ planId: idSchema, contentHash: idSchema }).strict(),
  "permission.grantPath": z.object({ pathGrantId: idSchema, purpose: z.enum(["live-output", "export", "reference"]) }).strict(),
  "permission.revoke": z.object({ permitId: idSchema }).strict(),
  "liveOutput.enable": z
    .object({
      pathGrantId: idSchema,
      namingPolicy: z.enum(["artifact", "node", "template"]),
      collisionPolicy: z.enum(["rename", "skip", "error"]),
      transferPolicy: z.enum(["copy", "move"])
    })
    .strict(),
  "liveOutput.disable": StrictEmptyPayloadSchema,
  "liveOutput.rebuild": StrictEmptyPayloadSchema,
  "liveOutput.reconcile": StrictEmptyPayloadSchema,
  "liveOutput.removeMirrorFiles": z.object({ confirm: z.literal(true) }).strict()
} as const;

export const applicationQueryPayloadSchemas = {
  "document.summary": StrictEmptyPayloadSchema,
  "document.dirtyState": StrictEmptyPayloadSchema,
  "graph.snapshot": graphIdPayloadSchema,
  "graph.catalog": StrictEmptyPayloadSchema,
  "graph.selectionDetails": z
    .object({ graphId: idSchema, nodeIds: z.array(idSchema), edgeIds: z.array(idSchema) })
    .strict(),
  "graph.validation": graphIdPayloadSchema,
  "node.outputs": z.object({ nodeId: idSchema }).strict(),
  "node.compiledInputPreview": z.object({ nodeId: idSchema }).strict(),
  "reference.list": z.object({ state: z.enum(["linked", "embedded", "missing", "relinking"]).optional() }).strict(),
  "reference.detail": referenceIdPayloadSchema,
  "output.detail": z.object({ outputVersionId: idSchema }).strict(),
  "provider.capabilities": z.object({ providerId: idSchema.optional() }).strict(),
  "provider.health": z.object({ providerId: idSchema.optional() }).strict(),
  "plan.summary": planIdPayloadSchema,
  "job.summary": jobIdPayloadSchema,
  "job.list": z.object({ status: JobStatusSchema.optional(), limit: z.number().int().positive().max(500).optional() }).strict(),
  "job.timeline": jobIdPayloadSchema,
  "job.workItems": jobIdPayloadSchema,
  "job.attempts": jobIdPayloadSchema,
  "artifact.search": z
    .object({
      text: z.string(),
      channels: z.array(PayloadChannelSchema),
      collectionIds: z.array(idSchema),
      tags: z.array(z.string().min(1)),
      minimumRating: z.number().int().min(0).max(5).nullable(),
      providerId: idSchema.nullable(),
      modelId: idSchema.nullable(),
      runId: idSchema.nullable(),
      graphId: idSchema.nullable(),
      createdAfter: TimestampSchema.nullable(),
      createdBefore: TimestampSchema.nullable()
    })
    .strict(),
  "artifact.detail": z.object({ artifactId: idSchema }).strict(),
  "collection.list": StrictEmptyPayloadSchema,
  "collection.detail": z.object({ collectionId: idSchema }).strict(),
  "collection.membership": z.object({ collectionId: idSchema }).strict(),
  "artifact.lineage": z.object({ artifactId: idSchema }).strict(),
  "export.records": z
    .object({ artifactId: idSchema.optional(), collectionId: idSchema.optional(), status: z.enum(["planned", "staged", "written", "verified", "committed", "skipped", "failed", "cancelled"]).optional() })
    .strict(),
  "liveOutput.status": StrictEmptyPayloadSchema,
  "liveOutput.entries": z.object({ collectionId: idSchema.optional(), artifactId: idSchema.optional() }).strict(),
  "liveOutput.operations": z.object({ entryId: idSchema.optional(), limit: z.number().int().positive().max(500).optional() }).strict(),
  "recipe.catalog": StrictEmptyPayloadSchema,
  "recipe.setupSchema": z.object({ recipeId: idSchema, version: z.string().min(1) }).strict(),
  "recovery.status": StrictEmptyPayloadSchema,
  "storage.status": StrictEmptyPayloadSchema
} as const;

export const applicationEventPayloadSchemas = {
  "document.stateChanged": z
    .object({
      state: z.enum(["open", "read-only", "closing", "closed"]),
      dirty: z.boolean(),
      documentRevisionId: idSchema.nullable(),
      readOnlyReason: z
        .enum([
          "requested",
          "writer-active",
          "location-unsupported",
          "sqlite-busy",
          "heartbeat-failed",
          "recovery-attention"
        ])
        .optional()
    })
    .strict(),
  "graph.revisionChanged": z
    .object({ graphId: idSchema, revisionId: idSchema, transactionId: idSchema.optional() })
    .strict(),
  "output.created": z.object({ outputVersionId: idSchema, parentOutputVersionId: idSchema.nullable() }).strict(),
  "output.pinned": z.object({ edgeId: idSchema, outputVersionId: idSchema, documentRevisionId: idSchema }).strict(),
  "output.reviewed": z.object({ outputVersionId: idSchema, approval: OutputApprovalSchema }).strict(),
  "domain.selectionChanged": z
    .object({ graphId: idSchema, nodeIds: z.array(idSchema), edgeIds: z.array(idSchema) })
    .strict(),
  "provider.healthChanged": z
    .object({
      providerId: idSchema,
      status: z.enum(["available", "degraded", "unavailable", "probing"]),
      message: z.string().nullable()
    })
    .strict(),
  "plan.stateChanged": z
    .object({
      planId: idSchema,
      state: z.enum([
        "previewed",
        "invalidated",
        "started",
        "completed",
        "failed",
        "cancelled",
        "needs-attention"
      ])
    })
    .strict(),
  "job.stateChanged": z
    .object({
      jobId: idSchema,
      state: JobStatusSchema
    })
    .strict(),
  "workItem.stateChanged": z
    .object({
      jobId: idSchema,
      workItemId: idSchema,
      state: WorkItemStatusSchema
    })
    .strict(),
  "attempt.stateChanged": z
    .object({
      jobId: idSchema,
      workItemId: idSchema,
      attemptId: idSchema,
      state: AttemptStatusSchema
    })
    .strict(),
  "artifact.accepted": z.object({ artifactId: idSchema, outputVersionId: idSchema }).strict(),
  "artifact.changed": z.object({ artifactId: idSchema, change: z.enum(["created", "tagged", "rated", "deleted"]) }).strict(),
  "export.stateChanged": z.object({ exportId: idSchema, status: z.enum(["planned", "staged", "written", "verified", "committed", "skipped", "failed", "cancelled"]) }).strict(),
  "collection.changed": z.object({ collectionId: idSchema, change: z.enum(["created", "updated", "deleted", "membership", "primary"]) }).strict(),
  "reference.missing": z.object({ referenceId: idSchema }).strict(),
  "reference.relinked": z.object({ referenceId: idSchema, contentKey: idSchema }).strict(),
  "reference.changed": z.object({ referenceId: idSchema, state: z.enum(["linked", "embedded", "missing", "relinking", "removed"]) }).strict(),
  "recipe.installed": z.object({ recipeId: idSchema, version: z.string().min(1) }).strict(),
  "recipe.changed": z.object({ recipeId: idSchema, version: z.string().min(1), change: z.enum(["installed", "removed", "instantiated"]) }).strict(),
  "permission.changed": z
    .object({
      permitId: idSchema,
      permission: z.enum(["edit", "run"]),
      state: z.enum(["granted", "revoked", "expired"])
    })
    .strict(),
  "recovery.attention": z.object({ code: idSchema, message: z.string() }).strict(),
  "liveOutput.progress": z
    .object({
      operationId: idSchema,
      state: z.enum(["planned", "staged", "verified", "committed", "failed", "reconciled"]),
      relativePath: z.string().min(1).optional()
    })
    .strict(),
  "liveOutput.attention": z.object({ code: idSchema, message: z.string() }).strict()
} as const;

const messageIdentityShape = {
  id: idSchema,
  correlationId: idSchema
};

function globalCommandMessage<
  TName extends ApplicationCommandName,
  TPayload extends z.ZodType<unknown, z.ZodTypeDef, unknown>
>(
  name: TName,
  payload: TPayload
) {
  return z
    .object({
      kind: z.literal("command"),
      ...messageIdentityShape,
      name: z.literal(name),
      payload
    })
    .strict();
}

function commandMessage<
  TName extends ApplicationCommandName,
  TPayload extends z.ZodType<unknown, z.ZodTypeDef, unknown>
>(
  name: TName,
  payload: TPayload
) {
  return z
    .object({
      kind: z.literal("command"),
      ...messageIdentityShape,
      name: z.literal(name),
      documentId: idSchema,
      payload
    })
    .strict();
}

function globalQueryMessage<
  TName extends ApplicationQueryName,
  TPayload extends z.ZodType<unknown, z.ZodTypeDef, unknown>
>(
  name: TName,
  payload: TPayload
) {
  return z
    .object({
      kind: z.literal("query"),
      ...messageIdentityShape,
      name: z.literal(name),
      payload
    })
    .strict();
}

function queryMessage<
  TName extends ApplicationQueryName,
  TPayload extends z.ZodType<unknown, z.ZodTypeDef, unknown>
>(
  name: TName,
  payload: TPayload
) {
  return z
    .object({
      kind: z.literal("query"),
      ...messageIdentityShape,
      name: z.literal(name),
      documentId: idSchema,
      payload
    })
    .strict();
}

function globalEventMessage<
  TName extends ApplicationEventName,
  TPayload extends z.ZodType<unknown, z.ZodTypeDef, unknown>
>(
  name: TName,
  payload: TPayload
) {
  return z
    .object({
      kind: z.literal("event"),
      ...messageIdentityShape,
      name: z.literal(name),
      occurredAt: TimestampSchema,
      payload
    })
    .strict();
}

function eventMessage<
  TName extends ApplicationEventName,
  TPayload extends z.ZodType<unknown, z.ZodTypeDef, unknown>
>(
  name: TName,
  payload: TPayload
) {
  return z
    .object({
      kind: z.literal("event"),
      ...messageIdentityShape,
      name: z.literal(name),
      documentId: idSchema,
      occurredAt: TimestampSchema,
      payload
    })
    .strict();
}

export const ApplicationCommandSchema = z.discriminatedUnion("name", [
  globalCommandMessage("document.new", applicationCommandPayloadSchemas["document.new"]),
  globalCommandMessage("document.open", applicationCommandPayloadSchemas["document.open"]),
  commandMessage("document.save", applicationCommandPayloadSchemas["document.save"]),
  commandMessage("document.saveAs", applicationCommandPayloadSchemas["document.saveAs"]),
  commandMessage("document.saveCopy", applicationCommandPayloadSchemas["document.saveCopy"]),
  commandMessage("document.close", applicationCommandPayloadSchemas["document.close"]),
  commandMessage("document.compact", applicationCommandPayloadSchemas["document.compact"]),
  globalCommandMessage("document.recover", applicationCommandPayloadSchemas["document.recover"]),
  commandMessage("graph.applyTransaction", applicationCommandPayloadSchemas["graph.applyTransaction"]),
  commandMessage("graph.undo", applicationCommandPayloadSchemas["graph.undo"]),
  commandMessage("graph.redo", applicationCommandPayloadSchemas["graph.redo"]),
  commandMessage("graph.validate", applicationCommandPayloadSchemas["graph.validate"]),
  commandMessage("graph.layout", applicationCommandPayloadSchemas["graph.layout"]),
  commandMessage("reference.link", applicationCommandPayloadSchemas["reference.link"]),
  commandMessage("reference.embed", applicationCommandPayloadSchemas["reference.embed"]),
  commandMessage("reference.relink", applicationCommandPayloadSchemas["reference.relink"]),
  commandMessage("reference.remove", applicationCommandPayloadSchemas["reference.remove"]),
  commandMessage("reference.assignToSet", applicationCommandPayloadSchemas["reference.assignToSet"]),
  commandMessage("output.edit", applicationCommandPayloadSchemas["output.edit"]),
  commandMessage("output.pin", applicationCommandPayloadSchemas["output.pin"]),
  commandMessage("output.restore", applicationCommandPayloadSchemas["output.restore"]),
  commandMessage("recipe.preview", applicationCommandPayloadSchemas["recipe.preview"]),
  commandMessage("recipe.instantiate", applicationCommandPayloadSchemas["recipe.instantiate"]),
  commandMessage("run.preview", applicationCommandPayloadSchemas["run.preview"]),
  commandMessage("run.start", applicationCommandPayloadSchemas["run.start"]),
  commandMessage("run.cancel", applicationCommandPayloadSchemas["run.cancel"]),
  commandMessage("run.retry", applicationCommandPayloadSchemas["run.retry"]),
  commandMessage("run.resume", applicationCommandPayloadSchemas["run.resume"]),
  commandMessage("review.approve", applicationCommandPayloadSchemas["review.approve"]),
  commandMessage("review.reject", applicationCommandPayloadSchemas["review.reject"]),
  commandMessage("review.rate", applicationCommandPayloadSchemas["review.rate"]),
  commandMessage("review.tag", applicationCommandPayloadSchemas["review.tag"]),
  commandMessage("review.route", applicationCommandPayloadSchemas["review.route"]),
  commandMessage("review.completeCompare", applicationCommandPayloadSchemas["review.completeCompare"]),
  commandMessage("collection.create", applicationCommandPayloadSchemas["collection.create"]),
  commandMessage("collection.update", applicationCommandPayloadSchemas["collection.update"]),
  commandMessage("collection.delete", applicationCommandPayloadSchemas["collection.delete"]),
  commandMessage("collection.addMembers", applicationCommandPayloadSchemas["collection.addMembers"]),
  commandMessage("collection.removeMembers", applicationCommandPayloadSchemas["collection.removeMembers"]),
  commandMessage("collection.setPrimary", applicationCommandPayloadSchemas["collection.setPrimary"]),
  commandMessage("artifact.export", applicationCommandPayloadSchemas["artifact.export"]),
  commandMessage("artifact.dragExport", applicationCommandPayloadSchemas["artifact.dragExport"]),
  commandMessage("artifact.deleteDerivative", applicationCommandPayloadSchemas["artifact.deleteDerivative"]),
  commandMessage("export.retry", applicationCommandPayloadSchemas["export.retry"]),
  commandMessage("export.cancel", applicationCommandPayloadSchemas["export.cancel"]),
  globalCommandMessage("provider.probe", applicationCommandPayloadSchemas["provider.probe"]),
  globalCommandMessage("provider.refresh", applicationCommandPayloadSchemas["provider.refresh"]),
  commandMessage("provider.configure", applicationCommandPayloadSchemas["provider.configure"]),
  commandMessage("provider.disable", applicationCommandPayloadSchemas["provider.disable"]),
  commandMessage("recipe.install", applicationCommandPayloadSchemas["recipe.install"]),
  commandMessage("recipe.remove", applicationCommandPayloadSchemas["recipe.remove"]),
  commandMessage("job.cancel", applicationCommandPayloadSchemas["job.cancel"]),
  commandMessage("job.retry", applicationCommandPayloadSchemas["job.retry"]),
  commandMessage("job.resume", applicationCommandPayloadSchemas["job.resume"]),
  commandMessage("recovery.inspect", applicationCommandPayloadSchemas["recovery.inspect"]),
  commandMessage("recovery.dismiss", applicationCommandPayloadSchemas["recovery.dismiss"]),
  commandMessage("permission.grantEdit", applicationCommandPayloadSchemas["permission.grantEdit"]),
  commandMessage("permission.grantRun", applicationCommandPayloadSchemas["permission.grantRun"]),
  commandMessage("permission.grantPath", applicationCommandPayloadSchemas["permission.grantPath"]),
  commandMessage("permission.revoke", applicationCommandPayloadSchemas["permission.revoke"]),
  commandMessage("liveOutput.enable", applicationCommandPayloadSchemas["liveOutput.enable"]),
  commandMessage("liveOutput.disable", applicationCommandPayloadSchemas["liveOutput.disable"]),
  commandMessage("liveOutput.rebuild", applicationCommandPayloadSchemas["liveOutput.rebuild"]),
  commandMessage("liveOutput.reconcile", applicationCommandPayloadSchemas["liveOutput.reconcile"]),
  commandMessage(
    "liveOutput.removeMirrorFiles",
    applicationCommandPayloadSchemas["liveOutput.removeMirrorFiles"]
  )
]);
export type ApplicationCommand = z.infer<typeof ApplicationCommandSchema>;

export const ApplicationQuerySchema = z.discriminatedUnion("name", [
  queryMessage("document.summary", applicationQueryPayloadSchemas["document.summary"]),
  queryMessage("document.dirtyState", applicationQueryPayloadSchemas["document.dirtyState"]),
  queryMessage("graph.snapshot", applicationQueryPayloadSchemas["graph.snapshot"]),
  queryMessage("graph.catalog", applicationQueryPayloadSchemas["graph.catalog"]),
  queryMessage("graph.selectionDetails", applicationQueryPayloadSchemas["graph.selectionDetails"]),
  queryMessage("graph.validation", applicationQueryPayloadSchemas["graph.validation"]),
  queryMessage("node.outputs", applicationQueryPayloadSchemas["node.outputs"]),
  queryMessage("node.compiledInputPreview", applicationQueryPayloadSchemas["node.compiledInputPreview"]),
  queryMessage("reference.list", applicationQueryPayloadSchemas["reference.list"]),
  queryMessage("reference.detail", applicationQueryPayloadSchemas["reference.detail"]),
  queryMessage("output.detail", applicationQueryPayloadSchemas["output.detail"]),
  globalQueryMessage("provider.capabilities", applicationQueryPayloadSchemas["provider.capabilities"]),
  globalQueryMessage("provider.health", applicationQueryPayloadSchemas["provider.health"]),
  queryMessage("plan.summary", applicationQueryPayloadSchemas["plan.summary"]),
  queryMessage("job.summary", applicationQueryPayloadSchemas["job.summary"]),
  queryMessage("job.list", applicationQueryPayloadSchemas["job.list"]),
  queryMessage("job.timeline", applicationQueryPayloadSchemas["job.timeline"]),
  queryMessage("job.workItems", applicationQueryPayloadSchemas["job.workItems"]),
  queryMessage("job.attempts", applicationQueryPayloadSchemas["job.attempts"]),
  queryMessage("artifact.search", applicationQueryPayloadSchemas["artifact.search"]),
  queryMessage("artifact.detail", applicationQueryPayloadSchemas["artifact.detail"]),
  queryMessage("collection.list", applicationQueryPayloadSchemas["collection.list"]),
  queryMessage("collection.detail", applicationQueryPayloadSchemas["collection.detail"]),
  queryMessage("collection.membership", applicationQueryPayloadSchemas["collection.membership"]),
  queryMessage("artifact.lineage", applicationQueryPayloadSchemas["artifact.lineage"]),
  queryMessage("export.records", applicationQueryPayloadSchemas["export.records"]),
  queryMessage("liveOutput.status", applicationQueryPayloadSchemas["liveOutput.status"]),
  queryMessage("liveOutput.entries", applicationQueryPayloadSchemas["liveOutput.entries"]),
  queryMessage("liveOutput.operations", applicationQueryPayloadSchemas["liveOutput.operations"]),
  globalQueryMessage("recipe.catalog", applicationQueryPayloadSchemas["recipe.catalog"]),
  globalQueryMessage("recipe.setupSchema", applicationQueryPayloadSchemas["recipe.setupSchema"]),
  queryMessage("recovery.status", applicationQueryPayloadSchemas["recovery.status"]),
  queryMessage("storage.status", applicationQueryPayloadSchemas["storage.status"])
]);
export type ApplicationQuery = z.infer<typeof ApplicationQuerySchema>;

export const ApplicationEventSchema = z.discriminatedUnion("name", [
  eventMessage("document.stateChanged", applicationEventPayloadSchemas["document.stateChanged"]),
  eventMessage("graph.revisionChanged", applicationEventPayloadSchemas["graph.revisionChanged"]),
  eventMessage("output.created", applicationEventPayloadSchemas["output.created"]),
  eventMessage("output.pinned", applicationEventPayloadSchemas["output.pinned"]),
  eventMessage("output.reviewed", applicationEventPayloadSchemas["output.reviewed"]),
  eventMessage("domain.selectionChanged", applicationEventPayloadSchemas["domain.selectionChanged"]),
  globalEventMessage("provider.healthChanged", applicationEventPayloadSchemas["provider.healthChanged"]),
  eventMessage("plan.stateChanged", applicationEventPayloadSchemas["plan.stateChanged"]),
  eventMessage("job.stateChanged", applicationEventPayloadSchemas["job.stateChanged"]),
  eventMessage("workItem.stateChanged", applicationEventPayloadSchemas["workItem.stateChanged"]),
  eventMessage("attempt.stateChanged", applicationEventPayloadSchemas["attempt.stateChanged"]),
  eventMessage("artifact.accepted", applicationEventPayloadSchemas["artifact.accepted"]),
  eventMessage("artifact.changed", applicationEventPayloadSchemas["artifact.changed"]),
  eventMessage("export.stateChanged", applicationEventPayloadSchemas["export.stateChanged"]),
  eventMessage("collection.changed", applicationEventPayloadSchemas["collection.changed"]),
  eventMessage("reference.missing", applicationEventPayloadSchemas["reference.missing"]),
  eventMessage("reference.relinked", applicationEventPayloadSchemas["reference.relinked"]),
  eventMessage("reference.changed", applicationEventPayloadSchemas["reference.changed"]),
  globalEventMessage("recipe.installed", applicationEventPayloadSchemas["recipe.installed"]),
  eventMessage("recipe.changed", applicationEventPayloadSchemas["recipe.changed"]),
  eventMessage("permission.changed", applicationEventPayloadSchemas["permission.changed"]),
  eventMessage("recovery.attention", applicationEventPayloadSchemas["recovery.attention"]),
  eventMessage("liveOutput.progress", applicationEventPayloadSchemas["liveOutput.progress"]),
  eventMessage("liveOutput.attention", applicationEventPayloadSchemas["liveOutput.attention"])
]);
export type ApplicationEvent = z.infer<typeof ApplicationEventSchema>;

export const EtherErrorSchema = z
  .object({
    code: idSchema,
    category: z.enum([
      "document",
      "graph",
      "provider",
      "execution",
      "reference",
      "security",
      "validation"
    ]),
    message: z.string(),
    userAction: z.string().optional(),
    retryable: z.boolean(),
    details: JsonObjectSchema.optional(),
    causeId: idSchema.optional()
  })
  .strict();
export type EtherError = z.infer<typeof EtherErrorSchema>;

export const applicationRequestNames = [
  ...applicationCommandNames,
  ...applicationQueryNames
] as const;
export const ApplicationRequestNameSchema = z.enum(applicationRequestNames);
export type ApplicationRequestName = z.infer<typeof ApplicationRequestNameSchema>;

export const AcknowledgementResponsePayloadSchema = z
  .object({ kind: z.literal("acknowledgement"), accepted: z.literal(true) })
  .strict();
export type AcknowledgementResponsePayload = z.infer<
  typeof AcknowledgementResponsePayloadSchema
>;

export const RevisionResponsePayloadSchema = z
  .object({
    kind: z.literal("revision"),
    documentRevisionId: idSchema,
    graphRevisions: z.array(
      z.object({ graphId: idSchema, revisionId: idSchema }).strict()
    )
  })
  .strict();
export type RevisionResponsePayload = z.infer<typeof RevisionResponsePayloadSchema>;

export const DocumentOpenedResponsePayloadSchema = z
  .object({
    documentId: idSchema,
    mode: z.enum(["writable", "read-only"]),
    header: DocumentHeaderSchema
  })
  .strict();
export type DocumentOpenedResponsePayload = z.infer<
  typeof DocumentOpenedResponsePayloadSchema
>;

export const GraphValidationIssueSchema = z
  .object({
    code: idSchema,
    message: z.string(),
    nodeId: idSchema.nullable(),
    edgeId: idSchema.nullable()
  })
  .strict();
export type GraphValidationIssue = z.infer<typeof GraphValidationIssueSchema>;

export const GraphValidationResultSchema = z
  .object({ valid: z.boolean(), issues: z.array(GraphValidationIssueSchema) })
  .strict();
export type GraphValidationResult = z.infer<typeof GraphValidationResultSchema>;

export const ProviderHealthResultSchema = z
  .object({
    providerId: idSchema,
    status: z.enum(["available", "degraded", "unavailable", "probing"]),
    message: z.string().nullable(),
    checkedAt: TimestampSchema,
    transport: z.enum(["app-server", "exec-fallback", "unavailable"]).optional(),
    version: z.string().min(1).nullable().optional(),
    manifestHash: z.string().regex(/^[a-f0-9]{64}$/).nullable().optional(),
    generation: z.number().int().nonnegative().optional(),
    restartCount: z.number().int().nonnegative().optional(),
    restartReason: z.string().nullable().optional(),
    fallbackReason: z.string().nullable().optional(),
    processPhase: z.enum(["none", "initializing", "idle", "active"]).optional(),
    threadId: idSchema.nullable().optional(),
    turnId: idSchema.nullable().optional(),
    timing: z.object({
      startedAt: z.number().int().nonnegative().nullable(),
      initializedAt: z.number().int().nonnegative().nullable(),
      initializationMs: z.number().int().nonnegative().nullable(),
      lastExitAt: z.number().int().nonnegative().nullable()
    }).strict().optional()
  })
  .strict();
export type ProviderHealthResult = z.infer<typeof ProviderHealthResultSchema>;

export const PermitResponsePayloadSchema = z
  .object({
    permitId: idSchema,
    permission: z.enum(["edit", "run", "path"]),
    expiresAt: TimestampSchema.nullable()
  })
  .strict();
export type PermitResponsePayload = z.infer<typeof PermitResponsePayloadSchema>;

const documentLocationResponseSchema = z
  .object({ documentId: idSchema, pathGrantId: idSchema })
  .strict();
const referenceResponseSchema = z.object({ referenceId: idSchema }).strict();
const outputVersionResponseSchema = z.object({ outputVersion: NodeOutputVersionSchema }).strict();
const collectionResponseSchema = z.object({ collection: CollectionSchema }).strict();
const recipePreviewResponseSchema: z.ZodType<{ transaction: GraphTransaction; warnings: string[] }> = z
  .object({ transaction: GraphTransactionSchema, warnings: z.array(z.string()) })
  .strict();
const executionPlanResponseSchema = z.object({ plan: ExecutionPlanSchema }).strict();
const executionJobResponseSchema = z.object({ job: ExecutionJobSchema }).strict();
const exportResponseSchema = z.object({ records: z.array(ExportRecordSchema) }).strict();
const dragExportResponseSchema = z
  .object({ materializationId: idSchema, expiresAt: TimestampSchema })
  .strict();
const providerProbeResponseSchema = z.object({ health: ProviderHealthResultSchema }).strict();
const providerRefreshResponseSchema = z
  .object({ providers: z.array(ProviderHealthResultSchema) })
  .strict();
const liveOutputEnabledResponseSchema = z
  .object({ operationId: idSchema, enabled: z.literal(true) })
  .strict();
const liveOutputDisabledResponseSchema = z.object({ enabled: z.literal(false) }).strict();
const liveOutputOperationResponseSchema = z.object({ operationId: idSchema }).strict();
const documentSummaryResponseSchema = z
  .object({
    header: DocumentHeaderSchema,
    mode: z.enum(["writable", "read-only"]),
    graphCount: z.number().int().nonnegative(),
    artifactCount: z.number().int().nonnegative()
  })
  .strict();
const documentDirtyStateResponseSchema = z
  .object({ dirty: z.boolean(), documentRevisionId: idSchema.nullable() })
  .strict();
const graphSnapshotResponseSchema = z
  .object({
    graph: EtherGraphSchema,
    documentRevisionId: idSchema,
    graphRevisionId: idSchema
  })
  .strict();
const graphCatalogResponseSchema = z
  .object({
    graphs: z.array(
      z
        .object({ id: idSchema, title: z.string(), kind: z.enum(["root", "module"]) })
        .strict()
    )
  })
  .strict();
const graphSelectionResponseSchema = z
  .object({ nodes: z.array(EtherNodeSchema), edges: z.array(EtherEdgeSchema) })
  .strict();
const nodeOutputsResponseSchema = z
  .object({ nodeId: idSchema, outputs: z.array(NodeOutputVersionSchema) })
  .strict();
const compiledInputPreviewResponseSchema = z
  .object({
    nodeId: idSchema,
    instruction: z.string(),
    contextHash: idSchema,
    inputs: z.array(PayloadEnvelopeSchema)
  })
  .strict();
const providerCapabilitiesResponseSchema = z
  .object({ capabilities: z.array(ProviderCapabilitySchema) })
  .strict();
const providerHealthResponseSchema = z
  .object({ providers: z.array(ProviderHealthResultSchema) })
  .strict();
const planSummaryResponseSchema = z.object({ plan: ExecutionPlanSchema }).strict();
const jobSummaryResponseSchema = z.object({ job: ExecutionJobSchema }).strict();
const jobListResponseSchema = z.object({ jobs: z.array(ExecutionJobSchema) }).strict();
const jobTimelineEntrySchema = z
  .object({
    id: idSchema,
    occurredAt: TimestampSchema,
    state: z.string().min(1),
    workItemId: idSchema.nullable(),
    attemptId: idSchema.nullable()
  })
  .strict();
const jobTimelineResponseSchema = z
  .object({ jobId: idSchema, entries: z.array(jobTimelineEntrySchema) })
  .strict();
const jobWorkItemsResponseSchema = z
  .object({ jobId: idSchema, workItems: z.array(ExecutionWorkItemSchema) })
  .strict();
const jobAttemptsResponseSchema = z
  .object({ jobId: idSchema, attempts: z.array(ExecutionAttemptSchema) })
  .strict();
const artifactSearchResponseSchema = z
  .object({ artifacts: z.array(ArtifactSchema), total: z.number().int().nonnegative() })
  .strict();
const artifactDetailResponseSchema = z.object({ artifact: ArtifactSchema }).strict();
const referenceListResponseSchema = z.object({ references: z.array(LinkedReferenceSchema) }).strict();
const referenceDetailResponseSchema = z.object({ reference: LinkedReferenceSchema }).strict();
const outputDetailResponseSchema = z.object({ output: NodeOutputVersionSchema }).strict();
const collectionListResponseSchema = z.object({ collections: z.array(CollectionSchema) }).strict();
const collectionDetailResponseSchema = z
  .object({ collection: CollectionSchema, memberships: z.array(CollectionMembershipSchema) })
  .strict();
const collectionMembershipResponseSchema = z
  .object({ memberships: z.array(CollectionMembershipSchema) })
  .strict();
const artifactLineageResponseSchema = z
  .object({ lineage: z.array(ArtifactLineageSchema) })
  .strict();
const exportRecordsResponseSchema = z.object({ records: z.array(ExportRecordSchema) }).strict();
const liveOutputStatusResponseSchema = z.object({ settings: LiveOutputSettingsSchema }).strict();
const liveOutputEntriesResponseSchema = z.object({ entries: z.array(LiveOutputEntrySchema) }).strict();
const liveOutputOperationsResponseSchema = z
  .object({ operations: z.array(LiveOutputOperationSchema) })
  .strict();
const recipeCatalogResponseSchema = z
  .object({ recipes: z.array(RecipeManifestSchema) })
  .strict();
const recipeSetupSchemaResponseSchema = z
  .object({
    recipeId: idSchema,
    version: z.string().min(1),
    parameters: z.array(RecipeParameterSchema)
  })
  .strict();
const recoveryStatusResponseSchema = z
  .object({
    state: z.enum(["healthy", "attention", "recovering"]),
    reportId: idSchema.nullable(),
    message: z.string().nullable()
  })
  .strict();
const storageStatusResponseSchema = z
  .object({
    documentBytes: z.number().int().nonnegative(),
    blobBytes: z.number().int().nonnegative(),
    reclaimableBytes: z.number().int().nonnegative()
  })
  .strict();

export const applicationResponsePayloadSchemas = {
  "document.new": DocumentOpenedResponsePayloadSchema,
  "document.open": DocumentOpenedResponsePayloadSchema,
  "document.save": AcknowledgementResponsePayloadSchema,
  "document.saveAs": documentLocationResponseSchema,
  "document.saveCopy": documentLocationResponseSchema,
  "document.close": AcknowledgementResponsePayloadSchema,
  "document.compact": AcknowledgementResponsePayloadSchema,
  "document.recover": DocumentOpenedResponsePayloadSchema,
  "graph.applyTransaction": RevisionResponsePayloadSchema,
  "graph.undo": RevisionResponsePayloadSchema,
  "graph.redo": RevisionResponsePayloadSchema,
  "graph.validate": GraphValidationResultSchema,
  "graph.layout": RevisionResponsePayloadSchema,
  "reference.link": referenceResponseSchema,
  "reference.embed": referenceResponseSchema,
  "reference.relink": referenceResponseSchema,
  "reference.remove": AcknowledgementResponsePayloadSchema,
  "reference.assignToSet": AcknowledgementResponsePayloadSchema,
  "output.edit": outputVersionResponseSchema,
  "output.pin": RevisionResponsePayloadSchema,
  "output.restore": outputVersionResponseSchema,
  "recipe.preview": recipePreviewResponseSchema,
  "recipe.instantiate": RevisionResponsePayloadSchema,
  "run.preview": executionPlanResponseSchema,
  "run.start": executionJobResponseSchema,
  "run.cancel": AcknowledgementResponsePayloadSchema,
  "run.retry": AcknowledgementResponsePayloadSchema,
  "run.resume": AcknowledgementResponsePayloadSchema,
  "review.approve": AcknowledgementResponsePayloadSchema,
  "review.reject": AcknowledgementResponsePayloadSchema,
  "review.rate": AcknowledgementResponsePayloadSchema,
  "review.tag": AcknowledgementResponsePayloadSchema,
  "review.route": AcknowledgementResponsePayloadSchema,
  "review.completeCompare": AcknowledgementResponsePayloadSchema,
  "collection.create": collectionResponseSchema,
  "collection.update": collectionResponseSchema,
  "collection.delete": AcknowledgementResponsePayloadSchema,
  "collection.addMembers": AcknowledgementResponsePayloadSchema,
  "collection.removeMembers": AcknowledgementResponsePayloadSchema,
  "collection.setPrimary": collectionResponseSchema,
  "artifact.export": exportResponseSchema,
  "artifact.dragExport": dragExportResponseSchema,
  "artifact.deleteDerivative": AcknowledgementResponsePayloadSchema,
  "export.retry": exportResponseSchema,
  "export.cancel": AcknowledgementResponsePayloadSchema,
  "provider.probe": providerProbeResponseSchema,
  "provider.refresh": providerRefreshResponseSchema,
  "provider.configure": AcknowledgementResponsePayloadSchema,
  "provider.disable": AcknowledgementResponsePayloadSchema,
  "recipe.install": AcknowledgementResponsePayloadSchema,
  "recipe.remove": AcknowledgementResponsePayloadSchema,
  "job.cancel": AcknowledgementResponsePayloadSchema,
  "job.retry": AcknowledgementResponsePayloadSchema,
  "job.resume": AcknowledgementResponsePayloadSchema,
  "recovery.inspect": recoveryStatusResponseSchema,
  "recovery.dismiss": AcknowledgementResponsePayloadSchema,
  "permission.grantEdit": PermitResponsePayloadSchema,
  "permission.grantRun": PermitResponsePayloadSchema,
  "permission.grantPath": PermitResponsePayloadSchema,
  "permission.revoke": AcknowledgementResponsePayloadSchema,
  "liveOutput.enable": liveOutputEnabledResponseSchema,
  "liveOutput.disable": liveOutputDisabledResponseSchema,
  "liveOutput.rebuild": liveOutputOperationResponseSchema,
  "liveOutput.reconcile": liveOutputOperationResponseSchema,
  "liveOutput.removeMirrorFiles": liveOutputOperationResponseSchema,
  "document.summary": documentSummaryResponseSchema,
  "document.dirtyState": documentDirtyStateResponseSchema,
  "graph.snapshot": graphSnapshotResponseSchema,
  "graph.catalog": graphCatalogResponseSchema,
  "graph.selectionDetails": graphSelectionResponseSchema,
  "graph.validation": GraphValidationResultSchema,
  "node.outputs": nodeOutputsResponseSchema,
  "node.compiledInputPreview": compiledInputPreviewResponseSchema,
  "reference.list": referenceListResponseSchema,
  "reference.detail": referenceDetailResponseSchema,
  "output.detail": outputDetailResponseSchema,
  "provider.capabilities": providerCapabilitiesResponseSchema,
  "provider.health": providerHealthResponseSchema,
  "plan.summary": planSummaryResponseSchema,
  "job.summary": jobSummaryResponseSchema,
  "job.list": jobListResponseSchema,
  "job.timeline": jobTimelineResponseSchema,
  "job.workItems": jobWorkItemsResponseSchema,
  "job.attempts": jobAttemptsResponseSchema,
  "artifact.search": artifactSearchResponseSchema,
  "artifact.detail": artifactDetailResponseSchema,
  "collection.list": collectionListResponseSchema,
  "collection.detail": collectionDetailResponseSchema,
  "collection.membership": collectionMembershipResponseSchema,
  "artifact.lineage": artifactLineageResponseSchema,
  "export.records": exportRecordsResponseSchema,
  "liveOutput.status": liveOutputStatusResponseSchema,
  "liveOutput.entries": liveOutputEntriesResponseSchema,
  "liveOutput.operations": liveOutputOperationsResponseSchema,
  "recipe.catalog": recipeCatalogResponseSchema,
  "recipe.setupSchema": recipeSetupSchemaResponseSchema,
  "recovery.status": recoveryStatusResponseSchema,
  "storage.status": storageStatusResponseSchema
} as const;

const globalCommandNameSet = new Set<ApplicationCommandName>(globalApplicationCommandNames);
const globalQueryNameSet = new Set<ApplicationQueryName>(globalApplicationQueryNames);
const globalEventNameSet = new Set<ApplicationEventName>(globalApplicationEventNames);

type ContractSchema = z.ZodType<unknown, z.ZodTypeDef, unknown>;
export type ApplicationContractRegistryEntry =
  | {
      kind: "command";
      name: ApplicationCommandName;
      scope: "global" | "document";
      request: ContractSchema;
      response: ContractSchema;
    }
  | {
      kind: "query";
      name: ApplicationQueryName;
      scope: "global" | "document";
      request: ContractSchema;
      response: ContractSchema;
    }
  | {
      kind: "event";
      name: ApplicationEventName;
      scope: "global" | "document";
      request: ContractSchema;
      response: null;
    };

export const applicationContractRegistry: readonly ApplicationContractRegistryEntry[] = [
  ...applicationCommandNames.map((name) => ({
    kind: "command" as const,
    name,
    scope: globalCommandNameSet.has(name) ? ("global" as const) : ("document" as const),
    request: applicationCommandPayloadSchemas[name],
    response: applicationResponsePayloadSchemas[name]
  })),
  ...applicationQueryNames.map((name) => ({
    kind: "query" as const,
    name,
    scope: globalQueryNameSet.has(name) ? ("global" as const) : ("document" as const),
    request: applicationQueryPayloadSchemas[name],
    response: applicationResponsePayloadSchemas[name]
  })),
  ...applicationEventNames.map((name) => ({
    kind: "event" as const,
    name,
    scope: globalEventNameSet.has(name) ? ("global" as const) : ("document" as const),
    request: applicationEventPayloadSchemas[name],
    response: null
  }))
];

function globalResponseMessage<
  TName extends ApplicationRequestName,
  TPayload extends z.ZodType<unknown, z.ZodTypeDef, unknown>
>(name: TName, payload: TPayload) {
  return z
    .object({
      kind: z.literal("response"),
      ...messageIdentityShape,
      requestId: idSchema,
      name: z.literal(name),
      payload
    })
    .strict();
}

function responseMessage<
  TName extends ApplicationRequestName,
  TPayload extends z.ZodType<unknown, z.ZodTypeDef, unknown>
>(name: TName, payload: TPayload) {
  return z
    .object({
      kind: z.literal("response"),
      ...messageIdentityShape,
      requestId: idSchema,
      name: z.literal(name),
      documentId: idSchema,
      payload
    })
    .strict();
}

export const ApplicationCommandResponseSchema = z.discriminatedUnion("name", [
  globalResponseMessage("document.new", applicationResponsePayloadSchemas["document.new"]),
  globalResponseMessage("document.open", applicationResponsePayloadSchemas["document.open"]),
  responseMessage("document.save", applicationResponsePayloadSchemas["document.save"]),
  responseMessage("document.saveAs", applicationResponsePayloadSchemas["document.saveAs"]),
  responseMessage("document.saveCopy", applicationResponsePayloadSchemas["document.saveCopy"]),
  responseMessage("document.close", applicationResponsePayloadSchemas["document.close"]),
  responseMessage("document.compact", applicationResponsePayloadSchemas["document.compact"]),
  globalResponseMessage("document.recover", applicationResponsePayloadSchemas["document.recover"]),
  responseMessage("graph.applyTransaction", applicationResponsePayloadSchemas["graph.applyTransaction"]),
  responseMessage("graph.undo", applicationResponsePayloadSchemas["graph.undo"]),
  responseMessage("graph.redo", applicationResponsePayloadSchemas["graph.redo"]),
  responseMessage("graph.validate", applicationResponsePayloadSchemas["graph.validate"]),
  responseMessage("graph.layout", applicationResponsePayloadSchemas["graph.layout"]),
  responseMessage("reference.link", applicationResponsePayloadSchemas["reference.link"]),
  responseMessage("reference.embed", applicationResponsePayloadSchemas["reference.embed"]),
  responseMessage("reference.relink", applicationResponsePayloadSchemas["reference.relink"]),
  responseMessage("reference.remove", applicationResponsePayloadSchemas["reference.remove"]),
  responseMessage("reference.assignToSet", applicationResponsePayloadSchemas["reference.assignToSet"]),
  responseMessage("output.edit", applicationResponsePayloadSchemas["output.edit"]),
  responseMessage("output.pin", applicationResponsePayloadSchemas["output.pin"]),
  responseMessage("output.restore", applicationResponsePayloadSchemas["output.restore"]),
  responseMessage("recipe.preview", applicationResponsePayloadSchemas["recipe.preview"]),
  responseMessage("recipe.instantiate", applicationResponsePayloadSchemas["recipe.instantiate"]),
  responseMessage("run.preview", applicationResponsePayloadSchemas["run.preview"]),
  responseMessage("run.start", applicationResponsePayloadSchemas["run.start"]),
  responseMessage("run.cancel", applicationResponsePayloadSchemas["run.cancel"]),
  responseMessage("run.retry", applicationResponsePayloadSchemas["run.retry"]),
  responseMessage("run.resume", applicationResponsePayloadSchemas["run.resume"]),
  responseMessage("review.approve", applicationResponsePayloadSchemas["review.approve"]),
  responseMessage("review.reject", applicationResponsePayloadSchemas["review.reject"]),
  responseMessage("review.rate", applicationResponsePayloadSchemas["review.rate"]),
  responseMessage("review.tag", applicationResponsePayloadSchemas["review.tag"]),
  responseMessage("review.route", applicationResponsePayloadSchemas["review.route"]),
  responseMessage("review.completeCompare", applicationResponsePayloadSchemas["review.completeCompare"]),
  responseMessage("collection.create", applicationResponsePayloadSchemas["collection.create"]),
  responseMessage("collection.update", applicationResponsePayloadSchemas["collection.update"]),
  responseMessage("collection.delete", applicationResponsePayloadSchemas["collection.delete"]),
  responseMessage("collection.addMembers", applicationResponsePayloadSchemas["collection.addMembers"]),
  responseMessage("collection.removeMembers", applicationResponsePayloadSchemas["collection.removeMembers"]),
  responseMessage("collection.setPrimary", applicationResponsePayloadSchemas["collection.setPrimary"]),
  responseMessage("artifact.export", applicationResponsePayloadSchemas["artifact.export"]),
  responseMessage("artifact.dragExport", applicationResponsePayloadSchemas["artifact.dragExport"]),
  responseMessage(
    "artifact.deleteDerivative",
    applicationResponsePayloadSchemas["artifact.deleteDerivative"]
  ),
  responseMessage("export.retry", applicationResponsePayloadSchemas["export.retry"]),
  responseMessage("export.cancel", applicationResponsePayloadSchemas["export.cancel"]),
  globalResponseMessage("provider.probe", applicationResponsePayloadSchemas["provider.probe"]),
  globalResponseMessage("provider.refresh", applicationResponsePayloadSchemas["provider.refresh"]),
  responseMessage("provider.configure", applicationResponsePayloadSchemas["provider.configure"]),
  responseMessage("provider.disable", applicationResponsePayloadSchemas["provider.disable"]),
  responseMessage("recipe.install", applicationResponsePayloadSchemas["recipe.install"]),
  responseMessage("recipe.remove", applicationResponsePayloadSchemas["recipe.remove"]),
  responseMessage("job.cancel", applicationResponsePayloadSchemas["job.cancel"]),
  responseMessage("job.retry", applicationResponsePayloadSchemas["job.retry"]),
  responseMessage("job.resume", applicationResponsePayloadSchemas["job.resume"]),
  responseMessage("recovery.inspect", applicationResponsePayloadSchemas["recovery.inspect"]),
  responseMessage("recovery.dismiss", applicationResponsePayloadSchemas["recovery.dismiss"]),
  responseMessage("permission.grantEdit", applicationResponsePayloadSchemas["permission.grantEdit"]),
  responseMessage("permission.grantRun", applicationResponsePayloadSchemas["permission.grantRun"]),
  responseMessage("permission.grantPath", applicationResponsePayloadSchemas["permission.grantPath"]),
  responseMessage("permission.revoke", applicationResponsePayloadSchemas["permission.revoke"]),
  responseMessage("liveOutput.enable", applicationResponsePayloadSchemas["liveOutput.enable"]),
  responseMessage("liveOutput.disable", applicationResponsePayloadSchemas["liveOutput.disable"]),
  responseMessage("liveOutput.rebuild", applicationResponsePayloadSchemas["liveOutput.rebuild"]),
  responseMessage("liveOutput.reconcile", applicationResponsePayloadSchemas["liveOutput.reconcile"]),
  responseMessage(
    "liveOutput.removeMirrorFiles",
    applicationResponsePayloadSchemas["liveOutput.removeMirrorFiles"]
  )
]);

export const ApplicationQueryResponseSchema = z.discriminatedUnion("name", [
  responseMessage("document.summary", applicationResponsePayloadSchemas["document.summary"]),
  responseMessage("document.dirtyState", applicationResponsePayloadSchemas["document.dirtyState"]),
  responseMessage("graph.snapshot", applicationResponsePayloadSchemas["graph.snapshot"]),
  responseMessage("graph.catalog", applicationResponsePayloadSchemas["graph.catalog"]),
  responseMessage(
    "graph.selectionDetails",
    applicationResponsePayloadSchemas["graph.selectionDetails"]
  ),
  responseMessage("graph.validation", applicationResponsePayloadSchemas["graph.validation"]),
  responseMessage("node.outputs", applicationResponsePayloadSchemas["node.outputs"]),
  responseMessage(
    "node.compiledInputPreview",
    applicationResponsePayloadSchemas["node.compiledInputPreview"]
  ),
  responseMessage("reference.list", applicationResponsePayloadSchemas["reference.list"]),
  responseMessage("reference.detail", applicationResponsePayloadSchemas["reference.detail"]),
  responseMessage("output.detail", applicationResponsePayloadSchemas["output.detail"]),
  globalResponseMessage(
    "provider.capabilities",
    applicationResponsePayloadSchemas["provider.capabilities"]
  ),
  globalResponseMessage("provider.health", applicationResponsePayloadSchemas["provider.health"]),
  responseMessage("plan.summary", applicationResponsePayloadSchemas["plan.summary"]),
  responseMessage("job.summary", applicationResponsePayloadSchemas["job.summary"]),
  responseMessage("job.list", applicationResponsePayloadSchemas["job.list"]),
  responseMessage("job.timeline", applicationResponsePayloadSchemas["job.timeline"]),
  responseMessage("job.workItems", applicationResponsePayloadSchemas["job.workItems"]),
  responseMessage("job.attempts", applicationResponsePayloadSchemas["job.attempts"]),
  responseMessage("artifact.search", applicationResponsePayloadSchemas["artifact.search"]),
  responseMessage("artifact.detail", applicationResponsePayloadSchemas["artifact.detail"]),
  responseMessage("collection.list", applicationResponsePayloadSchemas["collection.list"]),
  responseMessage("collection.detail", applicationResponsePayloadSchemas["collection.detail"]),
  responseMessage(
    "collection.membership",
    applicationResponsePayloadSchemas["collection.membership"]
  ),
  responseMessage("artifact.lineage", applicationResponsePayloadSchemas["artifact.lineage"]),
  responseMessage("export.records", applicationResponsePayloadSchemas["export.records"]),
  responseMessage("liveOutput.status", applicationResponsePayloadSchemas["liveOutput.status"]),
  responseMessage("liveOutput.entries", applicationResponsePayloadSchemas["liveOutput.entries"]),
  responseMessage("liveOutput.operations", applicationResponsePayloadSchemas["liveOutput.operations"]),
  globalResponseMessage("recipe.catalog", applicationResponsePayloadSchemas["recipe.catalog"]),
  globalResponseMessage("recipe.setupSchema", applicationResponsePayloadSchemas["recipe.setupSchema"]),
  responseMessage("recovery.status", applicationResponsePayloadSchemas["recovery.status"]),
  responseMessage("storage.status", applicationResponsePayloadSchemas["storage.status"])
]);
export type ApplicationCommandResponse = z.infer<typeof ApplicationCommandResponseSchema>;
export type ApplicationQueryResponse = z.infer<typeof ApplicationQueryResponseSchema>;
export type ApplicationResponse = ApplicationCommandResponse | ApplicationQueryResponse;
export const ApplicationResponseSchema: z.ZodType<ApplicationResponse> = z.discriminatedUnion(
  "name",
  [...ApplicationCommandResponseSchema.options, ...ApplicationQueryResponseSchema.options]
);
export type ApplicationResponsePayload = ApplicationResponse["payload"];

export const ApplicationErrorMessageSchema = z
  .object({
    kind: z.literal("error"),
    ...messageIdentityShape,
    requestId: idSchema,
    error: EtherErrorSchema
  })
  .strict();
export type ApplicationErrorMessage = z.infer<typeof ApplicationErrorMessageSchema>;

export type ApplicationMessage =
  | ApplicationCommand
  | ApplicationQuery
  | ApplicationEvent
  | ApplicationResponse
  | ApplicationErrorMessage;

/** The complete public application boundary used by desktop IPC and MCP handlers. */
export interface EtherApplicationService {
  execute(command: ApplicationCommand): Promise<ApplicationCommandResponse | ApplicationErrorMessage>;
  query(query: ApplicationQuery): Promise<ApplicationQueryResponse | ApplicationErrorMessage>;
  subscribe(listener: (event: ApplicationEvent) => void): () => void;
}

export const ApplicationMessageSchema: z.ZodType<ApplicationMessage> = z.union([
  ApplicationCommandSchema,
  ApplicationQuerySchema,
  ApplicationEventSchema,
  ApplicationResponseSchema,
  ApplicationErrorMessageSchema
]);

export function parseApplicationMessage(input: unknown): ApplicationMessage {
  return ApplicationMessageSchema.parse(input);
}
