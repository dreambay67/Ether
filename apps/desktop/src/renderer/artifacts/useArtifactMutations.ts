import { useCallback } from "react";
import type { ApplicationCommand } from "@ether/schema";

export function useArtifactMutations(documentId: string, onChanged: () => Promise<void>, onStatus: (message: string) => void) {
  const command = useCallback(async <Name extends ApplicationCommand["name"]>(
    name: Name,
    payload: Extract<ApplicationCommand, { name: Name }>["payload"],
    success: string
  ) => {
    try {
      const response = await window.ether.application.command({
        kind: "command",
        id: crypto.randomUUID(),
        correlationId: crypto.randomUUID(),
        documentId,
        name,
        payload
      } as Extract<ApplicationCommand, { name: Name }>);
      onStatus(success);
      await onChanged();
      return response;
    } catch (cause) {
      onStatus(cause instanceof Error ? cause.message : `${name} needs attention.`);
      return null;
    }
  }, [documentId, onChanged, onStatus]);

  return { command };
}
