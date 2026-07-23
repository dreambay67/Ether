import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { EtherErrorSchema, type EtherError } from "@ether/schema";

export const NonEmptyIdSchema = z.string().min(1);
export const EmptyInputSchema = z.object({}).strict();
export const EtherMcpErrorOutputSchema = z.object({ error: EtherErrorSchema }).strict();

export const ArtifactSearchInputSchema = z.object({
  text: z.string().default(""),
  channels: z.array(z.enum(["text", "image", "mask", "data", "video", "audio"])).default([]),
  collectionIds: z.array(NonEmptyIdSchema).default([]),
  tags: z.array(NonEmptyIdSchema).default([]),
  minimumRating: z.number().int().min(0).max(5).nullable().default(null),
  providerId: NonEmptyIdSchema.nullable().default(null),
  modelId: NonEmptyIdSchema.nullable().default(null),
  runId: NonEmptyIdSchema.nullable().default(null),
  graphId: NonEmptyIdSchema.nullable().default(null),
  createdAfter: z.string().datetime({ offset: true }).nullable().default(null),
  createdBefore: z.string().datetime({ offset: true }).nullable().default(null),
  cursor: NonEmptyIdSchema.nullable().optional(),
  limit: z.number().int().positive().max(500).default(100)
}).strict();

export class EtherMcpError extends Error {
  constructor(
    readonly code: string,
    readonly category: EtherError["category"],
    message: string,
    readonly options: {
      retryable?: boolean;
      userAction?: string;
      details?: Record<string, unknown>;
      causeId?: string;
    } = {}
  ) {
    super(message);
    this.name = "EtherMcpError";
  }

  static fromApplication(error: EtherError): EtherMcpError {
    return new EtherMcpError(error.code, error.category, error.message, {
      retryable: error.retryable,
      ...(error.userAction === undefined ? {} : { userAction: error.userAction }),
      ...(error.details === undefined ? {} : { details: error.details }),
      ...(error.causeId === undefined ? {} : { causeId: error.causeId })
    });
  }

  structured(): { error: EtherError } {
    return {
      error: {
        code: this.code,
        category: this.category,
        message: this.message,
        retryable: this.options.retryable ?? false,
        ...(this.options.userAction === undefined ? {} : { userAction: this.options.userAction }),
        ...(this.options.details === undefined ? {} : { details: this.options.details as EtherError["details"] }),
        ...(this.options.causeId === undefined ? {} : { causeId: this.options.causeId })
      }
    };
  }
}

export function successResult(value: Record<string, unknown>): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    structuredContent: value
  };
}

export function errorResult(error: unknown): CallToolResult {
  const etherError = normalizeError(error);
  const value = etherError.structured();
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    structuredContent: value
  };
}

export function normalizeError(error: unknown): EtherMcpError {
  if (error instanceof EtherMcpError) return error;
  if (error instanceof z.ZodError) {
    return new EtherMcpError("INVALID_MCP_INPUT", "validation", "The MCP tool input is invalid.", {
      details: { issues: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })) }
    });
  }
  const code = typeof error === "object" && error !== null && "code" in error
    ? String((error as { code: unknown }).code)
    : "MCP_TOOL_FAILED";
  return new EtherMcpError(code, categoryForCode(code), error instanceof Error ? error.message : String(error));
}

function categoryForCode(code: string): EtherError["category"] {
  if (code.includes("PERMIT") || code.includes("PERMISSION")) return "security";
  if (code.includes("GRAPH") || code.includes("NODE") || code.includes("REVISION") || code.includes("TRANSACTION")) return "graph";
  if (code.includes("PROVIDER") || code.includes("CAPABILITY")) return "provider";
  if (code.includes("RUN") || code.includes("PLAN") || code.includes("JOB")) return "execution";
  if (code.includes("REFERENCE")) return "reference";
  if (code.includes("INVALID") || code.includes("VALIDATION")) return "validation";
  return "document";
}
