import { useCallback, useEffect, useRef, useState } from "react";
import type { Artifact, PayloadChannel } from "@ether/schema";
import { markPerformance, measurePerformance } from "../performance/marks";

export type ArtifactFilters = {
  text: string;
  channels: PayloadChannel[];
  collectionIds: string[];
  tags: string[];
  minimumRating: number | null;
  providerId: string | null;
  modelId: string | null;
  runId: string | null;
  graphId: string | null;
  createdAfter: string | null;
  createdBefore: string | null;
};

export const emptyArtifactFilters: ArtifactFilters = {
  text: "",
  channels: [],
  collectionIds: [],
  tags: [],
  minimumRating: null,
  providerId: null,
  modelId: null,
  runId: null,
  graphId: null,
  createdAfter: null,
  createdBefore: null
};

const pageSize = 300;

export function useArtifacts(documentId: string, filters: ArtifactFilters) {
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [total, setTotal] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestGeneration = useRef(0);

  const request = useCallback(async (cursor: string | null, append: boolean) => {
    markPerformance("artifact-search:start");
    const generation = append ? requestGeneration.current : ++requestGeneration.current;
    if (append) setLoadingMore(true);
    else setLoading(true);
    try {
      const response = await window.ether.application.query({
        kind: "query",
        id: crypto.randomUUID(),
        correlationId: crypto.randomUUID(),
        documentId,
        name: "artifact.search",
        payload: { ...filters, cursor, limit: pageSize }
      });
      if (response.name !== "artifact.search") throw new Error("Ether returned an unexpected artifact search response.");
      markPerformance("artifact-search:first-result");
      measurePerformance("artifact-search:first-result", "artifact-search:start", "artifact-search:first-result");
      if (generation !== requestGeneration.current) return;
      setArtifacts((current) => append
        ? [...current, ...response.payload.artifacts.filter((artifact) => !current.some((candidate) => candidate.id === artifact.id))]
        : response.payload.artifacts);
      setTotal(response.payload.total);
      setNextCursor(response.payload.nextCursor);
      setError(null);
    } catch (cause) {
      if (generation === requestGeneration.current) setError(cause instanceof Error ? cause.message : "Artifacts could not be loaded.");
    } finally {
      if (generation === requestGeneration.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [documentId, filters]);

  const refresh = useCallback(() => request(null, false), [request]);
  const loadMore = useCallback(() => {
    if (nextCursor === null || loadingMore) return Promise.resolve();
    return request(nextCursor, true);
  }, [loadingMore, nextCursor, request]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => window.ether.application.onEvent((event) => {
    if (!("documentId" in event) || event.documentId !== documentId) return;
    if (event.name === "artifact.accepted" || event.name === "artifact.changed" || event.name === "collection.changed") void refresh();
  }), [documentId, refresh]);

  return { artifacts, total, nextCursor, loading, loadingMore, error, refresh, loadMore };
}
