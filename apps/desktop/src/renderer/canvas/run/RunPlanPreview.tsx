import type { ReactNode } from "react";
import type { EtherGraph, ExecutionRequest, RunPreview } from "@ether/engine";

type RunPlanPreviewProps = {
  graph: EtherGraph;
  preview: RunPreview;
  request: Omit<ExecutionRequest, "now">;
  isStarting?: boolean;
  onStart(): void;
  onCancel(): void;
};

type PreviewNodeSummary = {
  id: string;
  label: string;
  kind: string;
};

export function RunPlanPreview({
  graph,
  preview,
  request,
  isStarting = false,
  onStart,
  onCancel
}: RunPlanPreviewProps) {
  const nodeSummaries = previewNodes(graph, preview);
  const dirtyNodes = preview.dirtyNodeIds.map((nodeId) => summarizeNode(graph, nodeId));
  const blockedItems = preview.items.filter((item) => item.blockedReason);
  const providerItems = preview.items.filter((item) => item.willCallProvider && !item.blockedReason);
  const destinations = previewDestinations(graph, preview);
  const mode = preview.plan.parallel || request.parallel ? "parallel" : "sequential";

  return (
    <div className="run-preview-backdrop" role="presentation">
      <section
        className="run-plan-preview"
        role="dialog"
        aria-modal="true"
        aria-labelledby="run-plan-preview-title"
        data-testid="run-plan-preview"
      >
        <header className="run-preview-header">
          <div>
            <span>Run Preview</span>
            <h2 id="run-plan-preview-title">Inspect planned execution</h2>
          </div>
          <strong data-testid="run-preview-mode">{mode}</strong>
        </header>

        <div className="run-preview-metrics" aria-label="Run preview summary">
          <Metric label="Nodes" value={String(nodeSummaries.length)} testId="run-preview-node-count" />
          <Metric
            label="Provider calls"
            value={String(providerItems.length)}
            testId="run-preview-provider-calls"
          />
          <Metric
            label="Outputs"
            value={String(preview.expectedOutputCount)}
            testId="run-preview-output-count"
          />
        </div>

        <div className="run-preview-grid">
          <PreviewSection title="Scope">
            <dl className="run-preview-definition-list">
              <div>
                <dt>Policy</dt>
                <dd>{request.policy}</dd>
              </div>
              <div>
                <dt>Run cap</dt>
                <dd>{request.runCountCap ?? 1}</dd>
              </div>
              <div>
                <dt>Targets</dt>
                <dd>{request.targetNodeIds.map((nodeId) => summarizeNode(graph, nodeId).label).join(", ")}</dd>
              </div>
            </dl>
          </PreviewSection>

          <PreviewSection title="Planned Nodes">
            <PreviewList
              emptyLabel="No nodes planned"
              items={nodeSummaries.map(formatNode)}
            />
          </PreviewSection>

          <PreviewSection title="Dirty Nodes">
            <PreviewList
              emptyLabel="No dirty nodes"
              items={dirtyNodes.map(formatNode)}
            />
          </PreviewSection>

          <PreviewSection title="Blocked Nodes">
            <PreviewList
              emptyLabel="No blocked nodes"
              items={blockedItems.map((item) => {
                const node = summarizeNode(graph, item.nodeId);
                return `${formatNode(node)}: ${item.blockedReason}`;
              })}
            />
          </PreviewSection>

          <PreviewSection title="Provider Calls">
            <PreviewList
              emptyLabel="No provider calls"
              items={providerItems.map((item) => {
                const node = summarizeNode(graph, item.nodeId);
                return `${formatNode(node)} #${item.iteration}`;
              })}
            />
          </PreviewSection>

          <PreviewSection title="File Destinations">
            <PreviewList emptyLabel="No file outputs" items={destinations} />
          </PreviewSection>
        </div>

        <footer className="run-preview-actions">
          <button
            type="button"
            className="run-preview-secondary"
            onClick={onCancel}
            data-testid="run-preview-cancel"
            disabled={isStarting}
          >
            Cancel
          </button>
          <button
            type="button"
            className="run-preview-primary"
            onClick={onStart}
            data-testid="run-preview-start"
            disabled={isStarting}
            aria-busy={isStarting}
          >
            {isStarting ? "Starting..." : "Start Run"}
          </button>
        </footer>
      </section>
    </div>
  );
}

function Metric({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <div className="run-preview-metric" data-testid={testId}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function PreviewSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="run-preview-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function PreviewList({ items, emptyLabel }: { items: string[]; emptyLabel: string }) {
  if (items.length === 0) {
    return <p>{emptyLabel}</p>;
  }

  return (
    <ul>
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

function previewNodes(graph: EtherGraph, preview: RunPreview): PreviewNodeSummary[] {
  const nodeIds = uniqueInOrder(preview.plan.items.map((item) => item.nodeId));

  return nodeIds.map((nodeId) => summarizeNode(graph, nodeId));
}

function summarizeNode(graph: EtherGraph, nodeId: string): PreviewNodeSummary {
  const node = graph.nodes.find((candidate) => candidate.id === nodeId);
  const data = node?.data && typeof node.data === "object" ? (node.data as Record<string, unknown>) : {};
  const label = String(data.label || data.title || nodeId);
  const kind = String(data.kind || "Unknown");

  return { id: nodeId, label, kind };
}

function formatNode(node: PreviewNodeSummary) {
  return `${node.label} (${node.id}, ${node.kind})`;
}

function previewDestinations(graph: EtherGraph, preview: RunPreview): string[] {
  const destinations = preview.items
    .filter((item) => item.willCallProvider && !item.blockedReason)
    .map((item) => destinationForNode(graph, item.nodeId));

  return uniqueInOrder(destinations);
}

function destinationForNode(graph: EtherGraph, nodeId: string): string {
  const node = graph.nodes.find((candidate) => candidate.id === nodeId);
  const data = node?.data && typeof node.data === "object" ? (node.data as Record<string, unknown>) : {};
  const kind = String(data.kind || "");

  if (typeof data.storePath === "string" && data.storePath.trim().length > 0) {
    return data.storePath;
  }

  if (typeof data.assetPath === "string" && data.assetPath.trim().length > 0) {
    return data.assetPath;
  }

  if (kind === "Edit") {
    return "Project edit assets";
  }

  if (kind === "Assistant") {
    return "Node text output";
  }

  return "Project generated assets";
}

function uniqueInOrder(values: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    if (!seen.has(value)) {
      seen.add(value);
      result.push(value);
    }
  }

  return result;
}
