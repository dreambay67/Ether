import { useCallback, useEffect, useState } from "react";
import type { LinkedReference } from "@ether/schema";
import type { ReferenceAction } from "../../shared/ipc/contracts";

export type ReferenceDeskItem = LinkedReference & { actions: ReferenceAction[] };

function queryRequest(documentId: string) {
  return {
    kind: "query" as const,
    id: crypto.randomUUID(),
    correlationId: crypto.randomUUID(),
    documentId,
    name: "reference.list" as const,
    payload: {}
  };
}

export function useReferences(documentId: string) {
  const [references, setReferences] = useState<ReferenceDeskItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [response, desktopReferences] = await Promise.all([
        window.ether.application.query(queryRequest(documentId)),
        window.ether.references.list(documentId)
      ]);
      if (response.name !== "reference.list") throw new Error("Ether returned an unexpected reference response.");
      const actionsById = new Map(desktopReferences.map((reference) => [reference.id, reference.actions]));
      setReferences(response.payload.references.map((reference) => ({
        ...reference,
        actions: [...(actionsById.get(reference.id) ?? [])]
      })));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "References could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [documentId]);

  useEffect(() => {
    void refresh();
    return window.ether.application.onEvent((event) => {
      if (!("documentId" in event) || event.documentId !== documentId) return;
      if (event.name === "reference.changed" || event.name === "reference.missing" || event.name === "reference.relinked") {
        void refresh();
      }
    });
  }, [documentId, refresh]);

  return { references, loading, error, refresh };
}
