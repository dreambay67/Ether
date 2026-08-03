import { z } from "zod";

import {
  GraphTransactionSchema,
  NodeDefinitionSchema,
  applicationResponsePayloadSchemas
} from "@ether/schema";

import { NonEmptyIdSchema } from "./schemas.js";

const responses = applicationResponsePayloadSchemas;
const idRecordSchema = z.record(NonEmptyIdSchema, NonEmptyIdSchema);
const transactionSummarySchema = z.object({
  operationCount: z.number().int().nonnegative(),
  affectedGraphIds: z.array(NonEmptyIdSchema),
  addedNodes: z.number().int().nonnegative(),
  addedEdges: z.number().int().nonnegative(),
  removedNodes: z.number().int().nonnegative(),
  removedEdges: z.number().int().nonnegative()
}).strict();

const transactionProposalSchema = z.object({
  documentId: NonEmptyIdSchema,
  transaction: GraphTransactionSchema,
  tempIds: idRecordSchema,
  summary: transactionSummarySchema,
  warnings: z.array(z.string()),
  proposalId: NonEmptyIdSchema,
  state: z.literal("previewed")
}).strict();

const rawGraphRevisionSchema = z.object({
  documentRevisionId: NonEmptyIdSchema,
  graphRevisions: idRecordSchema
}).strict();

const permitInspectionSchema = z.object({
  id: NonEmptyIdSchema,
  permission: z.enum(["edit", "path", "run"]),
  expiresAt: z.string().datetime({ offset: true }).nullable(),
  state: z.enum(["active", "start-consumed", "expired", "revoked"]),
  pathGrantId: NonEmptyIdSchema.optional(),
  planId: NonEmptyIdSchema.optional(),
  contentHash: NonEmptyIdSchema.optional(),
  purpose: z.enum(["live-output", "export", "reference"]).optional()
}).strict();

const documentHealthSchema = z.object({
  documentId: NonEmptyIdSchema,
  summary: responses["document.summary"],
  dirtyState: responses["document.dirtyState"],
  validation: responses["graph.validation"],
  recovery: responses["recovery.status"],
  storage: responses["storage.status"],
  providers: responses["provider.health"]
}).strict();

export const mcpToolOutputSchemas: Record<string, z.ZodTypeAny> = {
  "ether.document.inspect": z.object({
    documentId: NonEmptyIdSchema,
    summary: responses["document.summary"],
    dirtyState: responses["document.dirtyState"]
  }).strict(),
  "ether.document.health": documentHealthSchema,
  "ether.project.doctor": documentHealthSchema.extend({
    doctor: z.object({
      state: z.literal("inspected"),
      mutationPerformed: z.literal(false)
    }).strict()
  }).strict(),
  "ether.recovery.inspect": z.object({
    recovery: responses["recovery.status"]
  }).strict(),
  "ether.permission.inspect": z.object({
    permits: z.array(permitInspectionSchema)
  }).strict(),

  "ether.node.catalog": z.object({
    nodes: z.array(NodeDefinitionSchema)
  }).strict(),
  "ether.graph.catalog": responses["graph.catalog"],
  "ether.graph.inspect": responses["graph.snapshot"],
  "ether.graph.validate": responses["graph.validation"],
  "ether.graph.transaction.preview": z.object({
    proposal: transactionProposalSchema
  }).strict(),
  "ether.graph.transaction.apply": z.object({
    proposalId: NonEmptyIdSchema,
    state: z.literal("applied"),
    tempIds: idRecordSchema,
    result: rawGraphRevisionSchema
  }).strict(),
  "ether.graph.transaction.reject": z.object({
    proposalId: NonEmptyIdSchema,
    state: z.literal("rejected"),
    mutationPerformed: z.literal(false)
  }).strict(),

  "ether.provider.inspect": z.object({
    health: responses["provider.health"],
    capabilities: responses["provider.capabilities"]
  }).strict(),

  "ether.recipe.list": responses["recipe.catalog"],
  "ether.recipe.setup": responses["recipe.setupSchema"],
  "ether.recipe.preview": responses["recipe.preview"],
  "ether.recipe.instantiate": responses["recipe.instantiate"],

  "ether.reference.list": responses["reference.list"],
  "ether.reference.inspect": responses["reference.detail"],
  "ether.artifact.search": responses["artifact.search"],
  "ether.artifact.inspect": responses["artifact.detail"],
  "ether.artifact.lineage": responses["artifact.lineage"],
  "ether.collection.list": responses["collection.list"],

  "ether.run.list": responses["job.list"],
  "ether.run.inspect": z.object({
    job: responses["job.summary"],
    plan: responses["plan.summary"],
    timeline: responses["job.timeline"],
    workItems: responses["job.workItems"],
    attempts: responses["job.attempts"]
  }).strict(),
  "ether.run.plan.inspect": responses["plan.summary"],
  "ether.run.plan.preview": responses["run.preview"],
  "ether.run.start": responses["run.start"],
  "ether.run.cancel": responses["run.start"],
  "ether.run.retry": responses["run.start"]
};
