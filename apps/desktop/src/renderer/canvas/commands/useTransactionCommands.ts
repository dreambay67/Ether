import { useCallback, useEffect, useRef } from "react";
import type { EtherGraph, GraphOperation, GraphTransaction } from "@ether/schema";
import type { DocumentDescriptor } from "../../../shared/ipc/contracts";

type ApplicationBridge = {
  command(command: unknown): Promise<{ payload?: { documentRevisionId?: string; graphRevisions?: Array<{ graphId: string; revisionId: string }> } }>;
  query?(query: unknown): Promise<{ payload?: { graph?: EtherGraph; documentRevisionId?: string; graphRevisionId?: string } }>;
};
type RevisionState = { documentRevisionId: string; graphRevisionIds: Record<string, string>; pending: boolean; waitingForDescriptor: boolean };
export type GraphRevisionSeed = { graphId: string; documentRevisionId: string; graphRevisionId: string };
function applicationBridge(): ApplicationBridge | undefined { return (window.ether as unknown as { application?: ApplicationBridge }).application; }
function revisionMap(entries: Array<{ graphId: string; revisionId: string }> | undefined): Record<string, string> {
  return Object.fromEntries((entries ?? []).map((entry) => [entry.graphId, entry.revisionId]));
}

export function useTransactionCommands({ document, graph, revisionSeed, onGraph, onStatus }: { document: DocumentDescriptor; graph: EtherGraph; revisionSeed?: GraphRevisionSeed; onGraph(graph: EtherGraph): void; onStatus(message: string): void }) {
  const revisions = useRef<RevisionState>({ documentRevisionId: document.documentRevisionId, graphRevisionIds: { [document.graphId]: document.graphRevisionId }, pending: false, waitingForDescriptor: false });
  useEffect(() => {
    revisions.current = { ...revisions.current, documentRevisionId: document.documentRevisionId, graphRevisionIds: { ...revisions.current.graphRevisionIds, [document.graphId]: document.graphRevisionId }, pending: false, waitingForDescriptor: false };
  }, [document.documentRevisionId, document.graphId, document.graphRevisionId]);
  useEffect(() => {
    if (revisionSeed === undefined) return;
    revisions.current = {
      ...revisions.current,
      documentRevisionId: revisionSeed.documentRevisionId,
      graphRevisionIds: { ...revisions.current.graphRevisionIds, [revisionSeed.graphId]: revisionSeed.graphRevisionId },
      waitingForDescriptor: false
    };
  }, [revisionSeed]);
  const seedRevision = useCallback((seed: GraphRevisionSeed) => {
    revisions.current = {
      ...revisions.current,
      documentRevisionId: seed.documentRevisionId,
      graphRevisionIds: { ...revisions.current.graphRevisionIds, [seed.graphId]: seed.graphRevisionId },
      waitingForDescriptor: false
    };
  }, []);
  const apply = useCallback(async (operations: GraphOperation[], title: string, options: { requiredGraphIds?: readonly string[] } = {}) => {
    if (document.mode !== "writable") { onStatus("This document is read-only."); return false; }
    if (revisions.current.pending || revisions.current.waitingForDescriptor) { onStatus("Waiting for the saved graph revision before the next edit."); return false; }
    const affectedGraphIds = [...new Set([...operations.map((operation) => operation.graphId), ...(options.requiredGraphIds ?? [])])];
    const baseGraphRevisions: Record<string, string> = {};
    for (const graphId of affectedGraphIds) {
      const revision = revisions.current.graphRevisionIds[graphId];
      if (revision === undefined) { onStatus(`Graph revision is unavailable for ${graphId}; reload the module before editing.`); return false; }
      baseGraphRevisions[graphId] = revision;
    }
    const transaction: GraphTransaction = { id: crypto.randomUUID(), baseDocumentRevisionId: revisions.current.documentRevisionId, baseGraphRevisions, title, actor: "user", layoutPolicy: "preserve", operations };
    // Set the gate synchronously: two click handlers cannot construct the same base revision.
    revisions.current.pending = true;
    try {
      const bridge = applicationBridge();
      if (bridge !== undefined) {
        const response = await bridge.command({ kind: "command", id: crypto.randomUUID(), correlationId: crypto.randomUUID(), name: "graph.applyTransaction", documentId: document.documentId, payload: { transaction } });
        const nextDocumentRevisionId = response.payload?.documentRevisionId;
        const nextGraphRevisions = revisionMap(response.payload?.graphRevisions);
        if (!nextDocumentRevisionId || Object.keys(nextGraphRevisions).length === 0) throw new Error("The application did not return committed graph revisions.");
        revisions.current = { documentRevisionId: nextDocumentRevisionId, graphRevisionIds: { ...revisions.current.graphRevisionIds, ...nextGraphRevisions }, pending: true, waitingForDescriptor: false };
        const refreshed = bridge.query === undefined ? await window.ether.graph.snapshot(document.documentId) : await bridge.query({ kind: "query", id: crypto.randomUUID(), correlationId: crypto.randomUUID(), name: "graph.snapshot", documentId: document.documentId, payload: { graphId: graph.id } });
        const nextGraph = "graph" in refreshed ? refreshed.graph : refreshed.payload?.graph;
        if (nextGraph === undefined) throw new Error("The committed graph could not be refreshed.");
        if (nextGraph.id !== graph.id) throw new Error(`The committed graph refresh returned ${nextGraph.id} instead of ${graph.id}.`);
        onGraph(nextGraph); revisions.current.pending = false; onStatus(`${title} saved`); return true;
      }
      const result = await window.ether.graph.applyTransaction(document.documentId, transaction);
      revisions.current = { ...revisions.current, pending: false, waitingForDescriptor: true };
      onGraph(result.graph); onStatus(`${title} saved`); return true;
    } catch (error) {
      revisions.current.pending = false;
      onStatus(error instanceof Error ? error.message : "The graph change could not be saved."); return false;
    }
  }, [document, graph.id, onGraph, onStatus]);
  const history = useCallback(async (name: "graph.undo" | "graph.redo") => {
    const bridge = applicationBridge();
    if (bridge === undefined || revisions.current.pending) { onStatus(`${name === "graph.undo" ? "Undo" : "Redo"} is unavailable until the graph is saved.`); return; }
    revisions.current.pending = true;
    try {
      const response = await bridge.command({ kind: "command", id: crypto.randomUUID(), correlationId: crypto.randomUUID(), name, documentId: document.documentId, payload: { graphId: graph.id } });
      const responseDocumentRevisionId = response.payload?.documentRevisionId;
      const responseGraphRevisions = revisionMap(response.payload?.graphRevisions);
      const result = bridge.query === undefined ? await window.ether.graph.snapshot(document.documentId) : await bridge.query({ kind: "query", id: crypto.randomUUID(), correlationId: crypto.randomUUID(), name: "graph.snapshot", documentId: document.documentId, payload: { graphId: graph.id } });
      const nextGraph = "graph" in result ? result.graph : result.payload?.graph;
      if (nextGraph !== undefined) onGraph(nextGraph);
      const queryPayload = "payload" in result ? result.payload : undefined;
      const nextDocumentRevisionId = queryPayload?.documentRevisionId ?? responseDocumentRevisionId;
      const nextGraphRevisionId = queryPayload?.graphRevisionId;
      revisions.current = {
        documentRevisionId: nextDocumentRevisionId ?? revisions.current.documentRevisionId,
        graphRevisionIds: {
          ...revisions.current.graphRevisionIds,
          ...responseGraphRevisions,
          ...(nextGraphRevisionId === undefined ? {} : { [graph.id]: nextGraphRevisionId })
        },
        pending: false,
        waitingForDescriptor: false
      };
      onStatus(name === "graph.undo" ? "Undid graph transaction" : "Redid graph transaction");
    } catch (error) { revisions.current.pending = false; onStatus(error instanceof Error ? error.message : "History could not be changed."); }
  }, [document.documentId, graph.id, onGraph, onStatus]);
  return { apply, seedRevision, undo: () => history("graph.undo"), redo: () => history("graph.redo") };
}
