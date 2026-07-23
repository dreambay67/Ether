import type { z } from "zod";

import type { EtherMcpApplicationAdapter } from "./applicationAdapter.js";
import type { EditTransactionStore } from "./transactions/editTransaction.js";

export type ToolContext = {
  application: EtherMcpApplicationAdapter;
  transactions: EditTransactionStore;
};

export type EtherToolDefinition = {
  name: string;
  description: string;
  inputSchema: z.ZodTypeAny;
  outputSchema?: z.ZodTypeAny;
  annotations: {
    readOnlyHint: boolean;
    destructiveHint: boolean;
    idempotentHint: boolean;
    openWorldHint: boolean;
  };
  run(context: ToolContext, input: Record<string, unknown>): Promise<Record<string, unknown>>;
};

export const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false
} as const;

export const editAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false
} as const;

export const executionAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true
} as const;

export const planningAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false
} as const;
