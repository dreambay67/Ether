import { useMemo } from "react";
import { Gauge, Rows3 } from "lucide-react";
import type { EtherGraph } from "@ether/schema";
import { stableKey, useBatchPreview, type BatchNode } from "./useBatchPreview";

export function BatchMatrix({ documentId, graph, onUpdated, onStatus }: { documentId: string; graph: EtherGraph; onUpdated(): Promise<void>; onStatus(message: string): void }) {
  const batchNodes = useMemo(() => graph.nodes.filter((node): node is BatchNode => node.config.kind === "flow.batch"), [graph.nodes]);
  const node = batchNodes[0];
  const { config, cells, totalCount, plan, message, update } = useBatchPreview({ documentId, graph, node, onUpdated });
  if (!node || !config) return <section className="batch-matrix"><header><div><span className="eyebrow">Planning</span><h2>Batch Matrix</h2></div></header><p className="batch-empty">Add a Batch node to preview dimensions and work.</p></section>;

  const visibleIncluded = cells.filter((cell) => !cell.excluded).length;
  const included = plan?.batchSummary?.workItemCount;
  const cappedWarning = plan?.warnings.find((warning) => warning.code === "BATCH_EXPANSION_CAPPED");
  const toggleCell = async (key: string) => {
    const current = new Map((config.exclusions ?? []).map((entry) => [stableKey(entry.values), entry]));
    if (current.has(key)) current.delete(key);
    else {
      const cell = cells.find((candidate) => candidate.key === key);
      if (cell) current.set(key, { values: cell.values });
    }
    try {
      await update({ ...config, exclusions: [...current.values()] }, "Update batch exclusions");
      onStatus("Batch exclusion saved.");
    } catch (cause) {
      onStatus(cause instanceof Error ? cause.message : "The matrix could not be updated.");
    }
  };

  const updateParallelism = async (parallelism: number) => {
    try {
      await update({ ...config, parallelism }, "Update batch execution policy");
      onStatus(parallelism === 1 ? "Sequential execution saved." : `Parallel execution requested at ${parallelism}.`);
    } catch (cause) {
      onStatus(cause instanceof Error ? cause.message : "Execution policy could not be updated.");
    }
  };

  return (
    <section className="batch-matrix" aria-label="Batch Matrix">
      <header><div><span className="eyebrow">Planning</span><h2>Batch Matrix</h2></div><strong>{node.title}</strong></header>
      <div className="batch-summary">
        <div><Rows3 size={16} aria-hidden="true" /><span>{config.dimensions.length} dimensions</span><strong>{included === undefined ? "Calculating…" : `${included} work items`}</strong></div>
        <div><Gauge size={16} aria-hidden="true" /><span>Provider calls</span><strong>{plan?.estimatedCalls ?? "—"}</strong></div>
        <div><span>Excluded</span><strong>{config.exclusions?.length ?? 0}</strong></div>
      </div>
      <label className="batch-policy">Execution policy
        <select aria-label="Batch execution policy" value={config.parallelism === 1 ? "1" : String(config.parallelism)} onChange={(event) => void updateParallelism(Number(event.target.value))}>
          <option value="1">Sequential (recommended)</option><option value="2">Parallel · 2</option><option value="4">Parallel · 4</option><option value="8">Parallel · 8</option>
        </select>
      </label>
      {plan ? <p className="batch-cap">Requested {plan.requestedParallelism ?? config.parallelism}; effective {plan.effectiveParallelism ?? 1} after provider limits.</p> : message ? <p className="batch-warning">{message}</p> : null}
      {cappedWarning ? <p className="batch-warning" role="alert">{cappedWarning.message}</p> : null}
      <div className="batch-cells" data-testid="batch-cells">
        {cells.slice(0, 500).map((cell, index) => <button key={cell.key} type="button" className={cell.excluded ? "is-excluded" : ""} aria-pressed={cell.excluded} onClick={() => void toggleCell(cell.key)}><span>#{index + 1}</span><strong>{Object.values(cell.values).map(String).join(" · ")}</strong><small>{cell.excluded ? "Excluded" : "Included"}</small></button>)}
      </div>
      {totalCount > cells.length ? <small>Showing the first {cells.length} of {totalCount.toLocaleString()} combinations. The plan count above is the exact executable total.</small> : visibleIncluded !== included && included !== undefined ? <small>The plan count reflects executable work after all planner limits.</small> : null}
    </section>
  );
}
