import { AlertTriangle, CheckCircle2, DatabaseZap, RefreshCw, ShieldX, Trash2, X } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import type { HealthIssue } from "@ether/engine";

type ProjectHealthPanelProps = {
  issues: HealthIssue[];
  message: string;
  isChecking: boolean;
  onRefresh(): void;
  onClose(): void;
  onClearProviderLogs(): Promise<void>;
  onClearRunArtifacts(): Promise<void>;
};

type PendingAction = "provider-logs" | "run-artifacts" | null;

export function ProjectHealthPanel({
  issues,
  message,
  isChecking,
  onRefresh,
  onClose,
  onClearProviderLogs,
  onClearRunArtifacts
}: ProjectHealthPanelProps) {
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [busyAction, setBusyAction] = useState<PendingAction>(null);
  const counts = useMemo(
    () => ({
      error: issues.filter((issue) => issue.severity === "error").length,
      warning: issues.filter((issue) => issue.severity === "warning").length
    }),
    [issues]
  );
  const hasProviderLogIssue = issues.some((issue) => issue.code === "PROVIDER_LOGS_RETAINED");
  const hasRunMetadataIssue = issues.some((issue) =>
    [
      "ARTIFACT_FILE_MISSING",
      "ASSET_FILE_MISSING",
      "ASSET_MOVE_DESTINATION_MISSING",
      "ASSET_MOVE_STALE_CURRENT_PATH",
      "UNTRACKED_ASSET_FILE"
    ].includes(issue.code)
  );

  const confirmAction = async (action: Exclude<PendingAction, null>) => {
    setBusyAction(action);

    try {
      if (action === "provider-logs") {
        await onClearProviderLogs();
      } else {
        await onClearRunArtifacts();
      }
      setPendingAction(null);
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <aside className="project-health-panel" aria-label="Project health" data-testid="project-health-panel">
      <div className="project-health-header">
        <div>
          <p>Health</p>
          <h2>Project Recovery</h2>
        </div>
        <div className="project-health-header-actions">
          <button
            type="button"
            onClick={onRefresh}
            disabled={isChecking}
            aria-label="Refresh project health"
            data-testid="project-health-refresh"
          >
            <RefreshCw size={14} aria-hidden="true" />
          </button>
          <button type="button" onClick={onClose} aria-label="Close project health panel">
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="project-health-summary" aria-live="polite">
        <span className={counts.error > 0 ? "is-error" : "is-clear"}>
          {counts.error > 0 ? <AlertTriangle size={14} aria-hidden="true" /> : <CheckCircle2 size={14} aria-hidden="true" />}
          {counts.error} error{counts.error === 1 ? "" : "s"}
        </span>
        <span className={counts.warning > 0 ? "is-warning" : "is-clear"}>
          <ShieldX size={14} aria-hidden="true" />
          {counts.warning} warning{counts.warning === 1 ? "" : "s"}
        </span>
        <em>{isChecking ? "Checking project" : message}</em>
      </div>

      <div className="project-health-actions" aria-label="Recovery and privacy actions">
        <HealthAction
          id="provider-logs"
          icon={<Trash2 size={14} aria-hidden="true" />}
          title="Provider logs"
          detail="Remove stored provider request, response, error payload rows, and local provider run files."
          disabled={!hasProviderLogIssue || busyAction !== null}
          pendingAction={pendingAction}
          busyAction={busyAction}
          onRequest={() => setPendingAction("provider-logs")}
          onCancel={() => setPendingAction(null)}
          onConfirm={() => void confirmAction("provider-logs")}
        />
        <HealthAction
          id="run-artifacts"
          icon={<DatabaseZap size={14} aria-hidden="true" />}
          title="Run metadata"
          detail="Clear run records and run-linked artifact metadata while leaving files in place."
          disabled={!hasRunMetadataIssue || busyAction !== null}
          pendingAction={pendingAction}
          busyAction={busyAction}
          onRequest={() => setPendingAction("run-artifacts")}
          onCancel={() => setPendingAction(null)}
          onConfirm={() => void confirmAction("run-artifacts")}
        />
      </div>

      <div className="project-health-issues" aria-label="Detected health issues">
        {issues.length === 0 ? (
          <div className="project-health-empty" data-testid="project-health-empty">
            <CheckCircle2 size={16} aria-hidden="true" />
            <span>No project health issues detected.</span>
          </div>
        ) : (
          issues.map((issue) => (
            <article
              className={`project-health-issue issue-${issue.severity}`}
              data-testid={`project-health-issue-${issue.code.toLowerCase()}`}
              key={issue.id}
            >
              <div className="project-health-issue-topline">
                <strong>{issue.code}</strong>
                <span>{issue.severity}</span>
              </div>
              <p>{issue.message}</p>
              <small>{issueExplanation(issue.code)}</small>
              {issue.path ? <code title={issue.path}>{issue.path}</code> : null}
            </article>
          ))
        )}
      </div>
    </aside>
  );
}

type HealthActionProps = {
  id: "provider-logs" | "run-artifacts";
  icon: ReactNode;
  title: string;
  detail: string;
  disabled: boolean;
  pendingAction: PendingAction;
  busyAction: PendingAction;
  onRequest(): void;
  onCancel(): void;
  onConfirm(): void;
};

function HealthAction({
  id,
  icon,
  title,
  detail,
  disabled,
  pendingAction,
  busyAction,
  onRequest,
  onCancel,
  onConfirm
}: HealthActionProps) {
  const isPending = pendingAction === id;
  const isBusy = busyAction === id;
  const testSuffix = id === "provider-logs" ? "provider-logs" : "run-artifacts";

  return (
    <div className={`project-health-action${isPending ? " is-confirming" : ""}`}>
      <div>
        <strong>{title}</strong>
        <span>{detail}</span>
      </div>
      {isPending ? (
        <div className="project-health-confirm">
          <button
            type="button"
            onClick={onConfirm}
            disabled={isBusy}
            data-testid={`project-health-confirm-${testSuffix}`}
          >
            Confirm
          </button>
          <button type="button" onClick={onCancel} disabled={isBusy}>
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={onRequest}
          disabled={disabled}
          data-testid={`project-health-action-clear-${testSuffix}`}
          aria-label={`${title} cleanup`}
        >
          {icon}
          {isBusy ? "Clearing" : "Clear"}
        </button>
      )}
    </div>
  );
}

function issueExplanation(code: string) {
  switch (code) {
    case "LINKED_REFERENCE_MISSING":
      return "A linked external source moved or was deleted.";
    case "ASSET_FILE_MISSING":
      return "The asset catalog has a row whose path is no longer on disk.";
    case "ARTIFACT_FILE_MISSING":
      return "An artifact record points to a file that is no longer available.";
    case "UNTRACKED_ASSET_FILE":
      return "A local asset file exists without a matching catalog record.";
    case "ASSET_MOVE_DESTINATION_MISSING":
    case "ASSET_MOVE_STALE_CURRENT_PATH":
      return "The asset move history no longer matches the current file state.";
    case "GRAPH_MIRROR_STALE":
      return "The graph revision database and graph.json mirror disagree.";
    case "DATABASE_MIGRATION_PENDING":
    case "DATABASE_MIGRATION_UNSUPPORTED":
      return "The project database version does not match this Ether build.";
    case "PROVIDER_LOGS_RETAINED":
      return "Provider run payloads or files are retained locally for troubleshooting.";
    default:
      return "Review this issue before continuing recovery work.";
  }
}
