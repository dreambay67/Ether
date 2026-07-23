import {
  ApplicationCommandResponseSchema,
  ApplicationCommandSchema,
  ApplicationEventSchema,
  ApplicationQueryResponseSchema,
  ApplicationQuerySchema,
  ArtifactSchema,
  ConnectionRoleSchema,
  EtherGraphSchema,
  GraphTransactionSchema,
  ProviderHealthResultSchema
} from "@ether/schema";
import { z } from "zod";

import { desktopIpcChannels } from "./channels.js";

const id = z.string().min(1);
const empty = z.object({}).strict();
const documentScope = z.object({ documentId: id }).strict();

export const DesktopErrorSchema = z
  .object({
    code: z.string().min(1),
    category: z.enum([
      "document",
      "graph",
      "provider",
      "execution",
      "reference",
      "security",
      "validation"
    ]),
    message: z.string().min(1),
    userAction: z.string().min(1).optional(),
    retryable: z.boolean(),
    details: z.record(z.string(), z.unknown()).optional(),
    causeId: z.string().min(1).optional()
  })
  .strict();
export type DesktopError = z.infer<typeof DesktopErrorSchema>;

export const DocumentDescriptorSchema = z
  .object({
    documentId: id,
    displayName: z.string().min(1),
    named: z.boolean(),
    mode: z.enum(["writable", "read-only"]),
    readOnlyReason: z
      .enum([
        "requested",
        "writer-active",
        "location-unsupported",
        "sqlite-busy",
        "heartbeat-failed",
        "recovery-attention"
      ])
      .nullable(),
    commands: z.object({
      save: z.boolean(),
      saveAs: z.boolean(),
      saveCopy: z.boolean(),
      compact: z.boolean(),
      makePortable: z.boolean()
    }).strict(),
    saveState: z.enum(["saving", "saved", "needs-attention"]),
    documentRevisionId: id,
    graphId: id,
    graphRevisionId: id,
    simulationEnabled: z.boolean(),
    revision: z.number().int().nonnegative()
  })
  .strict();
export type DocumentDescriptor = z.infer<typeof DocumentDescriptorSchema>;

export const CompactResultSchema = z
  .object({ beforeBytes: z.number().int().nonnegative(), afterBytes: z.number().int().nonnegative() })
  .strict();
export type CompactResult = z.infer<typeof CompactResultSchema>;
const missingReferenceSummary = z.object({ id, displayName: z.string().min(1) }).strict();
export const PortableResultSchema = z
  .object({
    cancelled: z.boolean(),
    embeddedCount: z.number().int().nonnegative(),
    embeddedBytes: z.number().int().nonnegative(),
    expectedBytes: z.number().int().nonnegative(),
    expectedCount: z.number().int().nonnegative(),
    missingReferences: z.array(missingReferenceSummary)
  })
  .strict();
export type PortableResult = z.infer<typeof PortableResultSchema>;
export const DocumentCommandResultSchema = z.discriminatedUnion("kind", [
  CompactResultSchema.extend({ kind: z.literal("compact") }).strict(),
  PortableResultSchema.extend({ kind: z.literal("portable") }).strict()
]);
export type DocumentCommandResult = z.infer<typeof DocumentCommandResultSchema>;
const graphResult = z.object({ graph: EtherGraphSchema, revision: z.number().int().nonnegative() }).strict();
export const ReferenceActionSchema = z.enum([
  "locate",
  "search-folder",
  "relink-all",
  "use-embedded-preview",
  "embed-available-copy",
  "remove"
]);
export type ReferenceAction = z.infer<typeof ReferenceActionSchema>;
export const DesktopReferenceSchema = z.object({
  id,
  displayName: z.string().min(1),
  mediaType: z.string().min(1),
  state: z.enum(["linked", "embedded", "missing", "relinking"]),
  actions: z.array(ReferenceActionSchema)
}).strict();
export type DesktopReference = z.infer<typeof DesktopReferenceSchema>;
export const ReferenceFileSelectionResultSchema = z.discriminatedUnion("cancelled", [
  z.object({ cancelled: z.literal(true) }).strict(),
  z.object({ cancelled: z.literal(false), referenceId: id }).strict()
]);
export type ReferenceFileSelectionResult = z.infer<typeof ReferenceFileSelectionResultSchema>;

function resultSchema<T extends z.ZodTypeAny>(value: T) {
  return z.discriminatedUnion("ok", [
    z.object({ ok: z.literal(true), value }).strict(),
    z.object({ ok: z.literal(false), error: DesktopErrorSchema }).strict()
  ]);
}

export const DesktopDocumentEventSchema = z
  .object({
    kind: z.enum(["snapshot", "state", "graph", "references", "artifacts"]),
    documentId: id,
    revision: z.number().int().nonnegative(),
    saveState: z.enum(["saving", "saved", "needs-attention"]).optional(),
    snapshot: DocumentDescriptorSchema.optional(),
    error: DesktopErrorSchema.optional(),
    commandResult: DocumentCommandResultSchema.optional()
  })
  .strict();
export type DesktopDocumentEvent = z.infer<typeof DesktopDocumentEventSchema>;

export const desktopIpcContracts = {
  [desktopIpcChannels.document.bootstrap]: { request: empty, response: resultSchema(DocumentDescriptorSchema) },
  [desktopIpcChannels.document.new]: { request: empty, response: resultSchema(DocumentDescriptorSchema) },
  [desktopIpcChannels.document.open]: { request: empty, response: resultSchema(DocumentDescriptorSchema) },
  [desktopIpcChannels.document.openDropped]: {
    request: z.object({ documentId: id, pathGrantId: id }).strict(),
    response: resultSchema(DocumentDescriptorSchema)
  },
  [desktopIpcChannels.document.save]: { request: documentScope, response: resultSchema(DocumentDescriptorSchema) },
  [desktopIpcChannels.document.saveAs]: { request: documentScope, response: resultSchema(DocumentDescriptorSchema) },
  [desktopIpcChannels.document.saveCopy]: { request: documentScope, response: resultSchema(DocumentDescriptorSchema) },
  [desktopIpcChannels.document.compact]: { request: documentScope, response: resultSchema(CompactResultSchema) },
  [desktopIpcChannels.document.makePortable]: { request: documentScope, response: resultSchema(PortableResultSchema) },
  [desktopIpcChannels.document.close]: { request: documentScope, response: resultSchema(z.null()) },
  [desktopIpcChannels.document.event]: { request: DesktopDocumentEventSchema, response: resultSchema(z.null()) },
  [desktopIpcChannels.graph.snapshot]: {
    request: documentScope,
    response: resultSchema(graphResult)
  },
  [desktopIpcChannels.graph.applyTransaction]: {
    request: z.object({ documentId: id, transaction: GraphTransactionSchema }).strict(),
    response: resultSchema(graphResult)
  },
  [desktopIpcChannels.artifacts.search]: {
    request: z.object({ documentId: id, text: z.string() }).strict(),
    response: resultSchema(z.array(ArtifactSchema))
  },
  [desktopIpcChannels.artifacts.generateFake]: {
    request: documentScope,
    response: resultSchema(z.array(ArtifactSchema))
  },
  [desktopIpcChannels.references.list]: {
    request: documentScope,
    response: resultSchema(z.array(DesktopReferenceSchema))
  },
  [desktopIpcChannels.references.act]: {
    request: z.object({ documentId: id, referenceId: id, action: ReferenceActionSchema }).strict(),
    response: resultSchema(z.array(DesktopReferenceSchema))
  },
  [desktopIpcChannels.artifacts.startDrag]: {
    request: z.object({ documentId: id, artifactIds: z.array(id).min(1) }).strict(),
    response: resultSchema(z.null())
  },
  [desktopIpcChannels.permissions.grantFolder]: {
    request: z.object({ documentId: id, purpose: z.enum(["export", "live-output"]) }).strict(),
    response: resultSchema(z.object({ grantId: id, displayName: z.string().min(1) }).strict().nullable())
  },
  [desktopIpcChannels.permissions.grantDroppedFile]: {
    request: z.object({
      documentId: id,
      purpose: z.enum(["open-document", "reference"]),
      nativePath: z.string().min(1)
    }).strict(),
    response: resultSchema(z.object({ grantId: id, displayName: z.string().min(1) }).strict())
  },
  [desktopIpcChannels.references.chooseAndLink]: {
    request: z.object({
      documentId: id,
      graphId: id,
      nodeId: id,
      role: ConnectionRoleSchema,
      storage: z.enum(["link", "embed"]),
      pathGrantId: id.optional()
    }).strict(),
    response: resultSchema(ReferenceFileSelectionResultSchema)
  },
  [desktopIpcChannels.application.command]: {
    request: ApplicationCommandSchema,
    response: resultSchema(ApplicationCommandResponseSchema)
  },
  [desktopIpcChannels.application.query]: {
    request: ApplicationQuerySchema,
    response: resultSchema(ApplicationQueryResponseSchema)
  },
  [desktopIpcChannels.application.event]: {
    request: ApplicationEventSchema,
    response: resultSchema(z.null())
  },
  [desktopIpcChannels.runtime.versions]: {
    request: empty,
    response: resultSchema(z.object({ electron: z.string(), node: z.string() }).strict())
  },
  [desktopIpcChannels.runtime.providerHealth]: {
    request: empty,
    response: resultSchema(ProviderHealthResultSchema)
  }
} as const;

export type DesktopIpcChannel = keyof typeof desktopIpcContracts;
export type NormalizedResult<T> = { ok: true; value: T } | { ok: false; error: DesktopError };

export interface IpcSenderIdentity {
  webContentsId: number;
  senderFrameUrl: string;
  origin: string;
}

export class IpcSecurityError extends Error {
  readonly code: "DOCUMENT_SCOPE_REJECTED" | "IPC_SENDER_REJECTED";

  constructor(code: IpcSecurityError["code"], message: string) {
    super(message);
    this.name = "IpcSecurityError";
    this.code = code;
  }
}

function normalizedOrigin(url: string): string {
  const parsed = new URL(url);
  return parsed.protocol === "file:" ? "null" : parsed.origin;
}

export function assertTrustedIpcSender(
  sender: IpcSenderIdentity,
  expected: { rendererUrl: string; webContentsId: number }
): void {
  const expectedOrigin = normalizedOrigin(expected.rendererUrl);
  const expectedFrame = new URL(expected.rendererUrl).href;
  let actualFrame: string;
  try {
    actualFrame = new URL(sender.senderFrameUrl).href;
  } catch {
    throw new IpcSecurityError("IPC_SENDER_REJECTED", "IPC sender frame URL is invalid.");
  }
  if (
    sender.webContentsId !== expected.webContentsId ||
    actualFrame !== expectedFrame ||
    sender.origin !== expectedOrigin
  ) {
    throw new IpcSecurityError("IPC_SENDER_REJECTED", "IPC sender is not the active Ether renderer.");
  }
}

export function assertAuthorizedSenderFrame(actualFrame: object | null, authorizedMainFrame: object): void {
  if (actualFrame === null || actualFrame !== authorizedMainFrame) {
    throw new IpcSecurityError("IPC_SENDER_REJECTED", "IPC sender is not the authorized main frame.");
  }
}

export function assertDocumentScope(requestedDocumentId: string, activeDocumentId: string): void {
  if (requestedDocumentId !== activeDocumentId) {
    throw new IpcSecurityError(
      "DOCUMENT_SCOPE_REJECTED",
      "The request is not scoped to the active Ether document."
    );
  }
}

export function normalizeDesktopError(error: unknown): DesktopError {
  const candidate = error as {
    category?: unknown;
    causeId?: unknown;
    code?: unknown;
    message?: unknown;
    retryable?: unknown;
    userAction?: unknown;
  } | null;
  const code = typeof candidate?.code === "string" ? candidate.code : "UNEXPECTED_ERROR";
  const inferredCategory = code.includes("REFERENCE") ? "reference"
    : code.includes("GRAPH") || code.includes("REVISION") ? "graph"
      : code.includes("IPC") || code.includes("SCOPE") ? "security"
        : code.includes("INVALID") || code.includes("DESTINATION") ? "validation"
          : "document";
  const category = isDesktopErrorCategory(candidate?.category)
    ? candidate.category
    : inferredCategory;
  const rawMessage = error instanceof Error ? error.message : "Ether could not complete the request.";
  return DesktopErrorSchema.parse({
    code,
    category,
    message: sanitizeDesktopMessage(rawMessage),
    retryable: typeof candidate?.retryable === "boolean"
      ? candidate.retryable
      : ["ENOSPC", "EBUSY", "SQLITE_BUSY"].includes(code),
    ...(typeof candidate?.userAction === "string"
      ? { userAction: sanitizeDesktopMessage(candidate.userAction) }
      : {}),
    ...(typeof candidate?.causeId === "string" ? { causeId: candidate.causeId } : {})
  });
}

const desktopErrorCategories = new Set<DesktopError["category"]>([
  "document",
  "graph",
  "provider",
  "execution",
  "reference",
  "security",
  "validation"
]);

function isDesktopErrorCategory(value: unknown): value is DesktopError["category"] {
  return typeof value === "string" && desktopErrorCategories.has(value as DesktopError["category"]);
}

function sanitizeDesktopMessage(message: string): string {
  return message
    .replace(/file:\/\/[^\s"']+/giu, "the selected file")
    .replace(/\\\\[^\\\s"']+\\[^\r\n"']+/gu, "the selected file")
    .replace(/\b[A-Za-z]:[\\/][^\r\n"']+/gu, "the selected file")
    .replace(/(^|[\s("'=])\/\/[^/\s"']+\/[^\s"']+/gu, "$1the selected file")
    .replace(/(^|[\s("'=:])\/(?:[^/\s"']+\/)+[^\s"']+/gu, "$1the selected file");
}
