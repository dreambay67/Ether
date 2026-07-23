import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { z } from "zod";

import {
  createUnavailableApplicationAdapter,
  type EtherMcpApplicationAdapter
} from "./applicationAdapter.js";
import { errorResult, EtherMcpError, successResult } from "./schemas.js";
import type { EtherToolDefinition, ToolContext } from "./toolTypes.js";
import { EditTransactionStore } from "./transactions/editTransaction.js";
import { artifactTools } from "./tools/artifacts.js";
import { documentTools } from "./tools/documents.js";
import { graphTools } from "./tools/graph.js";
import { providerTools } from "./tools/providers.js";
import { recipeTools } from "./tools/recipes.js";
import { runTools } from "./tools/runs.js";

export const ETHER_MCP_TOOLS: readonly EtherToolDefinition[] = [
  ...documentTools,
  ...graphTools,
  ...providerTools,
  ...recipeTools,
  ...artifactTools,
  ...runTools
];

export type EtherMcpServerOptions = {
  application?: EtherMcpApplicationAdapter;
  transactions?: EditTransactionStore;
};

export type EtherMcpServer = {
  mcp: McpServer;
  transactions: EditTransactionStore;
  connect(transport: Transport): Promise<void>;
  close(): Promise<void>;
};

export function createEtherMcpServer(options: EtherMcpServerOptions = {}): EtherMcpServer {
  const mcp = new McpServer(
    { name: "ether-mcp-server", version: "4.0.0" },
    { capabilities: { tools: {} }, instructions: "Inspect first. Editing requires an Edit Permit; execution requires a Run Permit bound to an exact immutable plan." }
  );
  installStructuredSdkErrors(mcp);
  const transactions = options.transactions ?? new EditTransactionStore();
  const context: ToolContext = {
    application: options.application ?? createUnavailableApplicationAdapter(),
    transactions
  };

  for (const definition of ETHER_MCP_TOOLS) registerTool(mcp, context, definition);

  return {
    mcp,
    transactions,
    connect: (transport) => mcp.connect(transport),
    close: () => mcp.close()
  };
}

function installStructuredSdkErrors(mcp: McpServer): void {
  // McpServer performs schema validation before invoking a registered handler.
  // Normalize that official-SDK validation lane to the same structured Ether error contract.
  const sdk = mcp as unknown as { createToolError(message: string): ReturnType<typeof errorResult> };
  sdk.createToolError = (message) => errorResult(new EtherMcpError(
    message.includes("Input validation error") ? "INVALID_MCP_INPUT" : "MCP_PROTOCOL_ERROR",
    "validation",
    message.includes("Input validation error") ? "The MCP tool input is invalid." : "The MCP tool request could not be completed.",
    { details: { sdkMessage: message } }
  ));
}

export async function runEtherMcpStdioServer(options: EtherMcpServerOptions = {}): Promise<EtherMcpServer> {
  const server = createEtherMcpServer(options);
  await server.connect(new StdioServerTransport());
  return server;
}

function registerTool(mcp: McpServer, context: ToolContext, definition: EtherToolDefinition): void {
  mcp.registerTool(
    definition.name,
    {
      description: definition.description,
      inputSchema: definition.inputSchema,
      outputSchema: definition.outputSchema ?? z.object({}).passthrough(),
      annotations: definition.annotations
    },
    async (input) => {
      try {
        const parsed = definition.inputSchema.parse(input) as Record<string, unknown>;
        return successResult(await definition.run(context, parsed));
      } catch (error) {
        return errorResult(error);
      }
    }
  );
}
