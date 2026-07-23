import { useCallback, useEffect, useState } from "react";
import type { ExecutionJob } from "@ether/schema";

export function useJobs(documentId: string) {
  const [jobs, setJobs] = useState<ExecutionJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await window.ether.application.query({
        kind: "query", id: crypto.randomUUID(), correlationId: crypto.randomUUID(), documentId,
        name: "job.list", payload: { limit: 500 }
      });
      if (response.name !== "job.list") throw new Error("Ether returned an unexpected job list response.");
      setJobs(response.payload.jobs);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Jobs could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [documentId]);

  useEffect(() => {
    void refresh();
    return window.ether.application.onEvent((event) => {
      if (!("documentId" in event) || event.documentId !== documentId) return;
      if (event.name === "job.stateChanged" || event.name === "workItem.stateChanged" || event.name === "attempt.stateChanged") void refresh();
    });
  }, [documentId, refresh]);

  return { jobs, loading, error, refresh };
}
