import { AlertTriangle, History, RefreshCw, ShieldCheck, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { ApplicationQuery } from "@ether/schema";

type HistoryEntry = {
  id: string;
  kind: "genesis" | "edit" | "undo" | "redo" | "recovery";
  title: string;
  createdAt: string;
  isHead: boolean;
  milestones: Array<{ id: string; kind: "autosave" | "manual"; name: string; createdAt: string }>;
  recovery: { id: string; reviewRequired: true; state: "recovered" } | null;
};

type HistorySnapshot = {
  revisions: HistoryEntry[];
  recovery: { state: "healthy" | "attention" | "recovering"; reportId: string | null; message: string | null };
};

export function DocumentHistoryDialog({
  documentId,
  open,
  readOnly,
  onClose
}: {
  documentId: string;
  open: boolean;
  readOnly: boolean;
  onClose(): void;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [snapshot, setSnapshot] = useState<HistorySnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await window.ether.application.query({
        kind: "query",
        id: crypto.randomUUID(),
        correlationId: crypto.randomUUID(),
        documentId,
        name: "document.history",
        payload: {}
      } as ApplicationQuery);
      setSnapshot(response.payload as HistorySnapshot);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Document history could not be read.");
    } finally {
      setLoading(false);
    }
  }, [documentId]);

  useEffect(() => {
    if (!open) return;
    void refresh();
    closeRef.current?.focus();
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose, open, refresh]);

  const keepFocus = useCallback((event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== "Tab") return;
    const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>(
      "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])"
    ) ?? [])];
    if (focusable.length === 0) return;
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (event.shiftKey && globalThis.document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && globalThis.document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }, []);

  if (!open) return null;
  const recovery = snapshot?.recovery ?? null;
  return (
    <div className="document-history-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section ref={dialogRef} className="document-history-dialog" role="dialog" aria-modal="true" aria-labelledby="document-history-title" onKeyDown={keepFocus}>
        <header className="document-history-header">
          <div>
            <span className="eyebrow">Reviewable document record</span>
            <h2 id="document-history-title"><History size={19} aria-hidden="true" />Document History</h2>
            <p>Manual saves are named milestones. Recovered work remains visible here until it has been reviewed.</p>
          </div>
          <button ref={closeRef} type="button" className="icon-command" aria-label="Close Document History" onClick={onClose}>
            <X size={17} aria-hidden="true" />
          </button>
        </header>

        <div className={`document-history-recovery state-${recovery?.state ?? "loading"}`} aria-live="polite">
          {recovery?.state === "attention" ? <AlertTriangle size={16} aria-hidden="true" /> : <ShieldCheck size={16} aria-hidden="true" />}
          <div>
            <strong>{recoveryLabel(recovery?.state)}</strong>
            <span>{recovery?.message ?? "No interrupted document operation is currently pending."}</span>
          </div>
          {readOnly ? <small>Read-only: history is available for review.</small> : null}
        </div>

        {error ? <p className="document-history-error" role="alert"><AlertTriangle size={16} />{error}</p> : null}
        {loading && snapshot === null ? <p className="document-history-loading" aria-live="polite">Loading document history...</p> : null}
        {!loading && !error && snapshot?.revisions.length === 0 ? <p className="document-history-empty">No revisions have been recorded for this document yet.</p> : null}
        {snapshot !== null ? (
          <ol className="document-history-list" aria-label="Document revisions">
            {snapshot.revisions.map((revision) => (
              <li key={revision.id} className={revision.isHead ? "is-head" : ""} data-testid={`document-history-${revision.kind}`}>
                <article>
                  <header>
                    <div>
                      <span className="document-history-kind">{kindLabel(revision.kind)}</span>
                      <strong>{revision.title}</strong>
                    </div>
                    {revision.isHead ? <span className="document-history-head">Current head</span> : null}
                  </header>
                  <time dateTime={revision.createdAt}>{formatTime(revision.createdAt)}</time>
                  <div className="document-history-state">
                    {revision.recovery === null ? <span>Review not required</span> : <span className="needs-review">Recovered · review required</span>}
                    {revision.milestones.map((milestone) => (
                      <span key={milestone.id} className={milestone.kind === "manual" ? "manual-milestone" : "autosave-milestone"}>
                        {milestone.kind === "manual" ? "Manual milestone" : "Autosave"}: {milestone.name}
                      </span>
                    ))}
                  </div>
                </article>
              </li>
            ))}
          </ol>
        ) : null}

        <footer className="document-history-actions">
          <span>{loading && snapshot !== null ? "Refreshing history..." : "History is read-only; document changes stay in their normal workflow."}</span>
          <button type="button" onClick={() => void refresh()} disabled={loading}><RefreshCw size={16} aria-hidden="true" />Refresh</button>
        </footer>
      </section>
    </div>
  );
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString();
}

function kindLabel(kind: HistoryEntry["kind"]): string {
  return {
    genesis: "Document created",
    edit: "Revision",
    undo: "Undo revision",
    redo: "Redo revision",
    recovery: "Recovery revision"
  }[kind];
}

function recoveryLabel(state: HistorySnapshot["recovery"]["state"] | undefined): string {
  if (state === "attention") return "Recovery needs attention";
  if (state === "recovering") return "Recovery in progress";
  return "Recovery status: healthy";
}
