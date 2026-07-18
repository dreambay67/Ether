import { ArtifactSchema, EtherGraphSchema, GraphTransactionSchema, LinkedReferenceSchema } from "@ether/schema";
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
      .enum(["requested", "writer-active", "location-unsupported", "sqlite-busy", "heartbeat-failed"])
      .nullable(),
    saveState: z.enum(["saving", "saved", "needs-attention"]),
    documentRevisionId: id,
    graphId: id,
    graphRevisionId: id,
    revision: z.number().int().nonnegative()
  })
  .strict();
export type DocumentDescriptor = z.infer<typeof DocumentDescriptorSchema>;

const compactResult = z
  .object({ beforeBytes: z.number().int().nonnegative(), afterBytes: z.number().int().nonnegative() })
  .strict();
const portableResult = z
  .object({ embeddedCount: z.number().int().nonnegative(), missingReferenceIds: z.array(id) })
  .strict();
const graphResult = z.object({ graph: EtherGraphSchema, revision: z.number().int().nonnegative() }).strict();
const referenceAction = z.enum([
  "locate",
  "search-folder",
  "relink-all",
  "use-embedded-preview",
  "embed-available-copy",
  "remove"
]);

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
    error: DesktopErrorSchema.optional()
  })
  .strict();
export type DesktopDocumentEvent = z.infer<typeof DesktopDocumentEventSchema>;

export const desktopIpcContracts = {
  [desktopIpcChannels.document.bootstrap]: { request: empty, response: resultSchema(DocumentDescriptorSchema) },
  [desktopIpcChannels.document.new]: { request: empty, response: resultSchema(DocumentDescriptorSchema) },
  [desktopIpcChannels.document.open]: { request: empty, response: resultSchema(DocumentDescriptorSchema) },
  [desktopIpcChannels.document.openDropped]: {
    request: z.object({ path: z.string().min(1) }).strict(),
    response: resultSchema(DocumentDescriptorSchema)
  },
  [desktopIpcChannels.document.save]: { request: documentScope, response: resultSchema(DocumentDescriptorSchema) },
  [desktopIpcChannels.document.saveAs]: { request: documentScope, response: resultSchema(DocumentDescriptorSchema) },
  [desktopIpcChannels.document.saveCopy]: { request: documentScope, response: resultSchema(DocumentDescriptorSchema) },
  [desktopIpcChannels.document.compact]: { request: documentScope, response: resultSchema(compactResult) },
  [desktopIpcChannels.document.makePortable]: { request: documentScope, response: resultSchema(portableResult) },
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
    response: resultSchema(z.array(LinkedReferenceSchema))
  },
  [desktopIpcChannels.references.act]: {
    request: z.object({ documentId: id, referenceId: id, action: referenceAction }).strict(),
    response: resultSchema(z.array(LinkedReferenceSchema))
  },
  [desktopIpcChannels.runtime.versions]: {
    request: empty,
    response: resultSchema(z.object({ electron: z.string(), node: z.string() }).strict())
  }
} as const;

export type DesktopIpcChannel = keyof typeof desktopIpcContracts;
export type NormalizedResult<T> = { ok: true; value: T } | { ok: false; error: DesktopError };

export interface IpcSenderIdentity {
  rendererUrl: string;
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
    sender.origin !== expectedOrigin ||
    sender.rendererUrl !== expected.rendererUrl
  ) {
    throw new IpcSecurityError("IPC_SENDER_REJECTED", "IPC sender is not the active Ether renderer.");
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
  const candidate = error as { code?: unknown; message?: unknown } | null;
  const code = typeof candidate?.code === "string" ? candidate.code : "UNEXPECTED_ERROR";
  const category = code.includes("REFERENCE") ? "reference"
    : code.includes("GRAPH") || code.includes("REVISION") ? "graph"
      : code.includes("IPC") || code.includes("SCOPE") ? "security"
        : code.includes("INVALID") || code.includes("DESTINATION") ? "validation"
          : "document";
  return DesktopErrorSchema.parse({
    code,
    category,
    message: error instanceof Error ? error.message : "Ether could not complete the request.",
    retryable: ["ENOSPC", "EBUSY", "SQLITE_BUSY"].includes(code)
  });
}
