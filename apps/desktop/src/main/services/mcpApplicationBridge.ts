import type { EtherMcpBridgeHost } from "@ether/mcp-server/bridge";

import type { DesktopApplicationService } from "./applicationService.js";

export function createDesktopMcpBridgeHost(service: DesktopApplicationService): EtherMcpBridgeHost {
  return {
    activeDocument: async () => service.mcpActiveDocument(),
    applyGraphTransaction: (input) => service.applyMcpGraphTransaction(input),
    cancelRun: (input) => service.cancelMcpRun(input),
    execute: (command) => service.executeMcpCommand(command),
    inspectPermits: async () => {
      const active = service.mcpActiveDocument();
      return active === null ? [] : service.mcpInspectPermits(active.documentId);
    },
    instantiateRecipe: (input) => service.instantiateMcpRecipe(input),
    previewGraphTransaction: async (transaction) => {
      const active = service.mcpActiveDocument();
      if (active === null) throw Object.assign(new Error("No Ether document is active."), { code: "NO_ACTIVE_DOCUMENT" });
      return service.previewMcpGraphTransaction(active.documentId, transaction);
    },
    query: (query) => service.executeMcpQuery(query),
    retryRun: (input) => service.retryMcpRun(input)
  };
}
