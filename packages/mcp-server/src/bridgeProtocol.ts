import { z } from "zod";

import {
  ApplicationCommandSchema,
  ApplicationErrorMessageSchema,
  ApplicationQueryResponseSchema,
  ApplicationQuerySchema,
  ApplicationCommandResponseSchema,
  EtherErrorSchema,
  GraphTransactionSchema,
  type ApplicationCommand,
  type ApplicationCommandResponse,
  type ApplicationErrorMessage,
  type ApplicationQuery,
  type ApplicationQueryResponse,
  type GraphTransaction
} from "@ether/schema";

import type { EtherMcpApplicationAdapter, PermitInspection, TransactionPreview } from "./applicationAdapter.js";

const id = z.string().min(1);
const authorization = {
  commandId: id,
  contentHash: id,
  documentId: id,
  jobId: id,
  planId: id,
  runPermitId: id
};

export const BridgeSessionDescriptorSchema = z.object({
  version: z.literal(1),
  pipeName: id,
  authToken: z.string().regex(/^[a-f0-9]{64}$/),
  pid: z.number().int().positive(),
  startedAt: z.string().datetime({ offset: true })
}).strict();
export type BridgeSessionDescriptor = z.infer<typeof BridgeSessionDescriptorSchema>;

type BridgeEnvelope = { version: 1; requestId: string; authToken: string };
type RunAuthorization = {
  commandId: string;
  contentHash: string;
  documentId: string;
  jobId: string;
  planId: string;
  runPermitId: string;
};
export type BridgeRequest = BridgeEnvelope & (
  | { operation: "activeDocument" }
  | { operation: "execute"; command: ApplicationCommand }
  | { operation: "query"; query: ApplicationQuery }
  | { operation: "inspectPermits" }
  | { operation: "previewGraphTransaction"; transaction: GraphTransaction }
  | { operation: "applyGraphTransaction"; commandId: string; documentId: string; editPermitId: string; transaction: GraphTransaction }
  | { operation: "instantiateRecipe"; command: ApplicationCommand; editPermitId: string }
  | ({ operation: "cancelRun" } & RunAuthorization)
  | ({ operation: "retryRun"; workItemIds: string[] } & RunAuthorization)
);

export const BridgeRequestSchema: z.ZodType<BridgeRequest> = z.discriminatedUnion("operation", [
  z.object({ version: z.literal(1), requestId: id, authToken: id, operation: z.literal("activeDocument") }).strict(),
  z.object({ version: z.literal(1), requestId: id, authToken: id, operation: z.literal("execute"), command: ApplicationCommandSchema }).strict(),
  z.object({ version: z.literal(1), requestId: id, authToken: id, operation: z.literal("query"), query: ApplicationQuerySchema }).strict(),
  z.object({ version: z.literal(1), requestId: id, authToken: id, operation: z.literal("inspectPermits") }).strict(),
  z.object({ version: z.literal(1), requestId: id, authToken: id, operation: z.literal("previewGraphTransaction"), transaction: GraphTransactionSchema }).strict(),
  z.object({
    version: z.literal(1), requestId: id, authToken: id, operation: z.literal("applyGraphTransaction"),
    commandId: id, documentId: id, editPermitId: id, transaction: GraphTransactionSchema
  }).strict(),
  z.object({
    version: z.literal(1), requestId: id, authToken: id, operation: z.literal("instantiateRecipe"),
    command: ApplicationCommandSchema, editPermitId: id
  }).strict(),
  z.object({ version: z.literal(1), requestId: id, authToken: id, operation: z.literal("cancelRun"), ...authorization }).strict(),
  z.object({
    version: z.literal(1), requestId: id, authToken: id, operation: z.literal("retryRun"), ...authorization,
    workItemIds: z.array(id).min(1)
  }).strict()
]);
type StripBridgeEnvelope<T> = T extends unknown ? Omit<T, "version" | "requestId" | "authToken"> : never;
export type BridgeOperation = StripBridgeEnvelope<BridgeRequest>;

export const BridgeResponseSchema = z.discriminatedUnion("ok", [
  z.object({ version: z.literal(1), requestId: id, ok: z.literal(true), data: z.unknown() }).strict(),
  z.object({ version: z.literal(1), requestId: id, ok: z.literal(false), error: EtherErrorSchema }).strict()
]);
export type BridgeResponse = z.infer<typeof BridgeResponseSchema>;

export const TransactionPreviewSchema: z.ZodType<TransactionPreview> = z.object({
  documentId: id,
  transaction: GraphTransactionSchema,
  tempIds: z.record(z.string(), id),
  summary: z.object({
    operationCount: z.number().int().nonnegative(),
    affectedGraphIds: z.array(id),
    addedNodes: z.number().int().nonnegative(),
    addedEdges: z.number().int().nonnegative(),
    removedNodes: z.number().int().nonnegative(),
    removedEdges: z.number().int().nonnegative()
  }).strict(),
  warnings: z.array(z.string())
}).strict();

export const ActiveDocumentSchema = z.object({ documentId: id }).strict().nullable();
export const PermitInspectionSchema: z.ZodType<PermitInspection[]> = z.array(z.object({
  id,
  permission: z.enum(["edit", "path", "run"]),
  expiresAt: z.string().datetime({ offset: true }).nullable(),
  state: z.enum(["active", "start-consumed", "expired", "revoked"]),
  pathGrantId: id.optional(),
  planId: id.optional(),
  contentHash: id.optional(),
  purpose: z.enum(["live-output", "export", "reference"]).optional()
}).strict());
export const ApplicationBridgeResponseSchema: z.ZodType<
  ApplicationCommandResponse | ApplicationQueryResponse | ApplicationErrorMessage
> = z.union([
  ApplicationCommandResponseSchema,
  ApplicationQueryResponseSchema,
  ApplicationErrorMessageSchema
]);

export type EtherMcpBridgeHost = EtherMcpApplicationAdapter;
