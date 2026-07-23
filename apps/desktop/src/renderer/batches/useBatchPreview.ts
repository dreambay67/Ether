import { useCallback, useEffect, useMemo, useState } from "react";
import type { EtherGraph, EtherNode, ExecutionPlan, FlowBatchConfig, GraphOperation, JsonObject, JsonValue } from "@ether/schema";

export type BatchCell = { key: string; values: JsonObject; excluded: boolean };
export type BatchNode = EtherNode<FlowBatchConfig>;
const MAX_VISIBLE_CELLS = 500;

export function useBatchPreview({ documentId, graph, node, onUpdated }: { documentId: string; graph: EtherGraph; node?: BatchNode; onUpdated(): Promise<void> }) {
  const config = node?.config ?? null;
  const [plan, setPlan] = useState<ExecutionPlan | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const matrix = useMemo(() => config ? expandDimensions(config) : { cells: [], totalCount: 0 }, [config]);
  const preview = useCallback(async () => {
    if (!node || !config) return;
    try {
      const response = await window.ether.application.command({
        kind: "command", id: crypto.randomUUID(), correlationId: crypto.randomUUID(), documentId,
        name: "run.preview", payload: { graphId: graph.id, scope: { kind: "branch", rootNodeId: node.id } }
      });
      if (response.name !== "run.preview") throw new Error("Ether returned an unexpected Run Preview response.");
      setPlan(response.payload.plan);
      setMessage(null);
    } catch (cause) {
      setPlan(null);
      setMessage(cause instanceof Error ? cause.message : "Run Preview is not available for this matrix.");
    }
  }, [config, documentId, graph.id, node]);

  useEffect(() => { void preview(); }, [preview]);

  const update = useCallback(async (nextConfig: FlowBatchConfig, title: string) => {
    if (!node) return;
    const snapshot = await window.ether.application.query({
      kind: "query", id: crypto.randomUUID(), correlationId: crypto.randomUUID(), documentId,
      name: "graph.snapshot", payload: { graphId: graph.id }
    });
    if (snapshot.name !== "graph.snapshot") throw new Error("Ether returned an unexpected graph snapshot.");
    const operation: GraphOperation = { type: "updateNode", graphId: graph.id, nodeId: node.id, node: { ...node, config: nextConfig } };
    const response = await window.ether.application.command({
      kind: "command", id: crypto.randomUUID(), correlationId: crypto.randomUUID(), documentId,
      name: "graph.applyTransaction", payload: { transaction: {
        id: crypto.randomUUID(),
        baseDocumentRevisionId: snapshot.payload.documentRevisionId,
        baseGraphRevisions: { [graph.id]: snapshot.payload.graphRevisionId },
        title,
        actor: "user",
        operations: [operation],
        layoutPolicy: "preserve"
      } }
    });
    if (response.name !== "graph.applyTransaction") throw new Error("Ether returned an unexpected graph update response.");
    await onUpdated();
  }, [documentId, graph.id, node, onUpdated]);

  return { config, cells: matrix.cells, totalCount: matrix.totalCount, plan, message, preview, update };
}

function expandDimensions(config: FlowBatchConfig): { cells: BatchCell[]; totalCount: number } {
  const excluded = new Set((config.exclusions ?? []).map((entry) => stableKey(entry.values)));
  const cells: BatchCell[] = [];
  const values: JsonObject = {};
  const visit = (dimensionIndex: number) => {
    if (cells.length >= MAX_VISIBLE_CELLS) return;
    if (dimensionIndex === config.dimensions.length) {
      const assignment = { ...values };
      const key = stableKey(assignment);
      cells.push({ key, values: assignment, excluded: excluded.has(key) });
      return;
    }
    const dimension = config.dimensions[dimensionIndex]!;
    for (const value of dimension.values) {
      values[dimension.id] = value as JsonValue;
      visit(dimensionIndex + 1);
      if (cells.length >= MAX_VISIBLE_CELLS) break;
    }
    delete values[dimension.id];
  };
  visit(0);
  const totalCount = config.dimensions.reduce((count, dimension) => count * dimension.values.length, 1);
  return { cells, totalCount };
}

export function stableKey(value: JsonObject) {
  return JSON.stringify(Object.keys(value).sort().reduce<JsonObject>((result, key) => ({ ...result, [key]: value[key]! }), {}));
}
