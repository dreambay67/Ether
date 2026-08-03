import { previewGraphTransaction } from "@ether/graph-kernel";
import type { DocumentStore } from "@ether/document";
import type { GraphTransaction } from "@ether/schema";

export async function applyGraphTransaction(
  store: DocumentStore,
  commandId: string,
  transaction: GraphTransaction
): Promise<{ documentRevisionId: string; graphRevisions: Record<string, string> }> {
  const existing = await store.read(({ execution }) =>
    execution.getCommandResult(commandId, "graph.applyTransaction")
  );
  if (existing !== undefined) return revisionResult(existing);
  const state = await store.read(({ graphs, revisions }) => ({
    graphs: graphs.list(),
    head: revisions.head()
  }));
  const preview = previewGraphTransaction({ graphs: state.graphs, transaction });
  const previewGraphIds = new Set(preview.graphs.map((graph) => graph.id));
  const deletedGraphIds = state.graphs
    .map((graph) => graph.id)
    .filter((graphId) => !previewGraphIds.has(graphId));
  const result = await store.transaction(({ execution, revisions }) => {
    const duplicate = execution.getCommandResult(commandId, "graph.applyTransaction");
    if (duplicate !== undefined) return revisionResult(duplicate);
    const committed = revisions.commit({
      id: transaction.id,
      baseDocumentRevisionId: transaction.baseDocumentRevisionId,
      baseGraphRevisions: transaction.baseGraphRevisions,
      title: transaction.title,
      actor: transaction.actor,
      graphSnapshots: preview.graphs,
      deletedGraphIds,
      forwardOperations: preview.forwardOperations,
      inverseOperations: preview.inverseOperations
    });
    const result = {
      documentRevisionId: committed.documentRevisionId,
      graphRevisions: committed.graphRevisions
    };
    const graphId = transaction.operations[0]?.graphId;
    const revisionId = graphId === undefined ? undefined : committed.graphRevisions[graphId];
    execution.completeCommand(commandId, "graph.applyTransaction", result, revisionId === undefined ? [] : [{
      name: "graph.revisionChanged",
      payload: { graphId, revisionId, transactionId: transaction.id }
    }]);
    return result;
  });
  return result;
}

function revisionResult(value: Record<string, unknown>): {
  documentRevisionId: string;
  graphRevisions: Record<string, string>;
} {
  return {
    documentRevisionId: String(value.documentRevisionId),
    graphRevisions: value.graphRevisions as Record<string, string>
  };
}
