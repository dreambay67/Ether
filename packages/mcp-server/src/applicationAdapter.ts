import { randomUUID } from "node:crypto";

import {
  ApplicationCommandResponseSchema,
  ApplicationCommandSchema,
  ApplicationErrorMessageSchema,
  ApplicationQueryResponseSchema,
  ApplicationQuerySchema,
  type ApplicationCommand,
  type ApplicationCommandName,
  type ApplicationCommandResponse,
  type ApplicationErrorMessage,
  type ApplicationQuery,
  type ApplicationQueryName,
  type ApplicationQueryResponse,
  type EtherApplicationService,
  type GraphTransaction,
  type NodeDefinition
} from "@ether/schema";

import { EtherMcpError } from "./schemas.js";

export type ActiveDocument = { documentId: string };
export type PermitInspection = {
  id: string;
  permission: "edit" | "path" | "run";
  expiresAt: string | null;
  state: "active" | "start-consumed" | "expired" | "revoked";
  planId?: string;
  contentHash?: string;
};

export type TransactionPreview = {
  documentId: string;
  transaction: GraphTransaction;
  tempIds: Record<string, string>;
  summary: {
    operationCount: number;
    affectedGraphIds: string[];
    addedNodes: number;
    addedEdges: number;
    removedNodes: number;
    removedEdges: number;
  };
  warnings: string[];
};

export interface EtherMcpApplicationAdapter {
  activeDocument(): Promise<ActiveDocument | null>;
  applyGraphTransaction(input: {
    commandId: string;
    documentId: string;
    editPermitId: string;
    transaction: GraphTransaction;
  }): Promise<Record<string, unknown>>;
  cancelRun(input: {
    commandId: string;
    contentHash: string;
    documentId: string;
    jobId: string;
    planId: string;
    runPermitId: string;
  }): Promise<Record<string, unknown>>;
  execute(command: ApplicationCommand): Promise<ApplicationCommandResponse | ApplicationErrorMessage>;
  inspectNodeCatalog(): Promise<readonly NodeDefinition[]>;
  inspectPermits(): Promise<readonly PermitInspection[]>;
  instantiateRecipe(input: {
    command: ApplicationCommand;
    editPermitId: string;
  }): Promise<Record<string, unknown>>;
  previewGraphTransaction(transaction: GraphTransaction): Promise<TransactionPreview>;
  query(query: ApplicationQuery): Promise<ApplicationQueryResponse | ApplicationErrorMessage>;
  retryRun(input: {
    commandId: string;
    contentHash: string;
    documentId: string;
    jobId: string;
    planId: string;
    runPermitId: string;
    workItemIds: readonly string[];
  }): Promise<Record<string, unknown>>;
}

export type ApplicationAdapterOptions = {
  activeDocument: () => ActiveDocument | null | Promise<ActiveDocument | null>;
  applyGraphTransaction: EtherMcpApplicationAdapter["applyGraphTransaction"];
  cancelRun: EtherMcpApplicationAdapter["cancelRun"];
  inspectNodeCatalog: () => readonly NodeDefinition[] | Promise<readonly NodeDefinition[]>;
  inspectPermits: EtherMcpApplicationAdapter["inspectPermits"];
  instantiateRecipe: EtherMcpApplicationAdapter["instantiateRecipe"];
  previewGraphTransaction: (transaction: GraphTransaction) => TransactionPreview | Promise<TransactionPreview>;
  retryRun: EtherMcpApplicationAdapter["retryRun"];
};

/**
 * Wraps the schema-validated application boundary without reconstructing use cases.
 * The host supplies the three application capabilities not yet represented by a 4.0
 * application message: active-document selection, node catalog, and dry-run preview.
 */
export function createApplicationServiceAdapter(
  service: EtherApplicationService,
  options: ApplicationAdapterOptions
): EtherMcpApplicationAdapter {
  return {
    activeDocument: async () => options.activeDocument(),
    applyGraphTransaction: options.applyGraphTransaction,
    cancelRun: options.cancelRun,
    execute: (command) => service.execute(command),
    inspectNodeCatalog: async () => options.inspectNodeCatalog(),
    inspectPermits: options.inspectPermits,
    instantiateRecipe: options.instantiateRecipe,
    previewGraphTransaction: async (transaction) => options.previewGraphTransaction(transaction),
    query: (query) => service.query(query),
    retryRun: options.retryRun
  };
}

export async function activeDocumentId(adapter: EtherMcpApplicationAdapter): Promise<string> {
  const active = await adapter.activeDocument();
  if (active === null) {
    throw new EtherMcpError("NO_ACTIVE_DOCUMENT", "document", "No Ether document is active.", {
      userAction: "Open a document in Ether, then retry the inspection."
    });
  }
  return active.documentId;
}

export async function applicationQuery(
  adapter: EtherMcpApplicationAdapter,
  name: ApplicationQueryName,
  payload: Record<string, unknown>,
  global = false
): Promise<Record<string, unknown>> {
  const identity = identityFields();
  const request = ApplicationQuerySchema.parse({
    kind: "query",
    ...identity,
    name,
    ...(global ? {} : { documentId: await activeDocumentId(adapter) }),
    payload
  });
  const response = await adapter.query(request);
  return applicationPayload(response, request);
}

export async function applicationCommand(
  adapter: EtherMcpApplicationAdapter,
  name: ApplicationCommandName,
  payload: Record<string, unknown>,
  global = false
): Promise<Record<string, unknown>> {
  const identity = identityFields();
  const request = ApplicationCommandSchema.parse({
    kind: "command",
    ...identity,
    name,
    ...(global ? {} : { documentId: await activeDocumentId(adapter) }),
    payload
  });
  const response = await adapter.execute(request);
  return applicationPayload(response, request);
}

function identityFields(): { id: string; correlationId: string } {
  const id = `mcp-${randomUUID()}`;
  return { id, correlationId: id };
}

function applicationPayload(
  response: ApplicationCommandResponse | ApplicationQueryResponse | ApplicationErrorMessage,
  request: ApplicationCommand | ApplicationQuery
): Record<string, unknown> {
  if (response.kind === "error") {
    const parsed = ApplicationErrorMessageSchema.parse(response);
    if (parsed.requestId !== request.id || parsed.correlationId !== request.correlationId) {
      throw new EtherMcpError("APPLICATION_RESPONSE_MISMATCH", "security", "The application error does not match its validated request.");
    }
    throw EtherMcpError.fromApplication(parsed.error);
  }
  const parsed = request.kind === "command"
    ? ApplicationCommandResponseSchema.parse(response)
    : ApplicationQueryResponseSchema.parse(response);
  const responseDocumentId = "documentId" in parsed ? parsed.documentId : undefined;
  const requestDocumentId = "documentId" in request ? request.documentId : undefined;
  if (
    parsed.requestId !== request.id ||
    parsed.correlationId !== request.correlationId ||
    parsed.name !== request.name ||
    responseDocumentId !== requestDocumentId
  ) {
    throw new EtherMcpError("APPLICATION_RESPONSE_MISMATCH", "security", "The application response does not match its validated request.");
  }
  return parsed.payload as Record<string, unknown>;
}

export function createUnavailableApplicationAdapter(): EtherMcpApplicationAdapter {
  const unavailable = (): never => {
    throw new EtherMcpError(
      "APPLICATION_SERVICE_UNAVAILABLE",
      "document",
      "The Ether desktop application service is not attached to this MCP process.",
      { userAction: "Launch the MCP server through the active Ether desktop session." }
    );
  };
  return {
    activeDocument: async () => null,
    applyGraphTransaction: async () => unavailable(),
    cancelRun: async () => unavailable(),
    execute: async () => unavailable(),
    inspectNodeCatalog: async () => unavailable(),
    inspectPermits: async () => unavailable(),
    instantiateRecipe: async () => unavailable(),
    previewGraphTransaction: async () => unavailable(),
    query: async () => unavailable(),
    retryRun: async () => unavailable()
  };
}
