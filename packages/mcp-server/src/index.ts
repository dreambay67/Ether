#!/usr/bin/env node
import { pathToFileURL } from "node:url";

export * from "./applicationAdapter.js";
export * from "./bridgeProtocol.js";
export * from "./localBridge.js";
export * from "./schemas.js";
export * from "./server.js";
export * from "./transactions/editTransaction.js";

import { runEtherMcpStdioServer } from "./server.js";
import { createLocalBridgeApplicationAdapter } from "./localBridge.js";

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  runEtherMcpStdioServer({ application: createLocalBridgeApplicationAdapter({
    ...(process.env.ETHER_MCP_SESSION_DESCRIPTOR === undefined
      ? {}
      : { descriptorPath: process.env.ETHER_MCP_SESSION_DESCRIPTOR })
  }) }).catch((error: unknown) => {
    process.stderr.write(`Ether MCP server failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
