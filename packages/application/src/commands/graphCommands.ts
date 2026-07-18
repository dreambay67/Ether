import { previewGraphTransaction } from "@ether/graph-kernel";
import type { DocumentStore } from "@ether/document";
import type { GraphTransaction } from "@ether/schema";

export async function applyGraphTransaction(
  store: DocumentStore,
  transaction: GraphTransaction
): Promise<{ documentRevisionId: string; graphRevisions: Record<string, string> }> {
  const state = await store.read(({ graphs, revisions }) => ({
    graphs: graphs.list(),
    head: revisions.head()
  }));
  const preview = previewGraphTransaction({ graphs: state.graphs, transaction });
  const committed = await store.transaction(({ revisions }) =>
    revisions.commit({
      id: transaction.id,
      baseDocumentRevisionId: transaction.baseDocumentRevisionId,
      baseGraphRevisions: transaction.baseGraphRevisions,
      title: transaction.title,
      actor: transaction.actor,
      graphSnapshots: preview.graphs,
      forwardOperations: preview.forwardOperations,
      inverseOperations: preview.inverseOperations
    })
  );
  return {
    documentRevisionId: committed.documentRevisionId,
    graphRevisions: committed.graphRevisions
  };
}
