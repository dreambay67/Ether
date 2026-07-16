import { Activity, ListChecks } from "lucide-react";
import { RunTimeline } from "./run/RunTimeline";

type RunTracePanelProps = {
  entries: string[];
  queueCount: number;
  projectId: string | null;
  onFocusNode(nodeId: string): void;
};

export function RunTracePanel({ entries, queueCount, projectId, onFocusNode }: RunTracePanelProps) {
  return (
    <div className="run-panel-grid">
      <section>
        <h3>
          <ListChecks size={15} aria-hidden="true" />
          Queue
        </h3>
        <p>{queueCount} canvas action{queueCount === 1 ? "" : "s"} staged</p>
      </section>
      <section>
        <h3>
          <Activity size={15} aria-hidden="true" />
          Log
        </h3>
        <ol>
          {entries.slice(0, 4).map((entry, index) => (
            <li key={`${entry}-${index}`}>{entry}</li>
          ))}
          {entries.length === 0 ? <li>No canvas actions yet</li> : null}
        </ol>
      </section>
      <RunTimeline projectId={projectId} onFocusNode={onFocusNode} />
    </div>
  );
}
