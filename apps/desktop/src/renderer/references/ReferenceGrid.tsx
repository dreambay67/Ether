import { useMemo, useState } from "react";
import { connectionRoles, type ConnectionRole } from "@ether/schema";
import type { ReferenceAction } from "../../shared/ipc/contracts";
import type { ReferenceDeskItem } from "./useReferences";

export type ReferenceSelection = {
  enabled: boolean;
  roleOverride?: ConnectionRole;
};

export type ReferenceView = "grid" | "filmstrip" | "waveform" | "list";

const roles: readonly ConnectionRole[] = connectionRoles;
const viewportHeight = 360;

const viewLayout: Record<ReferenceView, { columns: number; rowHeight: number; overscan: number }> = {
  grid: { columns: 4, rowHeight: 132, overscan: 1 },
  filmstrip: { columns: 3, rowHeight: 112, overscan: 1 },
  waveform: { columns: 1, rowHeight: 72, overscan: 3 },
  list: { columns: 1, rowHeight: 58, overscan: 4 }
};

export function ReferenceGrid({
  references,
  selection,
  view,
  onSelectionChange,
  onRecover
}: {
  references: ReferenceDeskItem[];
  selection: Map<string, ReferenceSelection>;
  view: ReferenceView;
  onSelectionChange(next: Map<string, ReferenceSelection>): void;
  onRecover(referenceId: string, action: ReferenceAction): void;
}) {
  const [scrollTop, setScrollTop] = useState(0);
  const layout = viewLayout[view];
  const rowCount = Math.ceil(references.length / layout.columns);
  const startRow = Math.max(0, Math.floor(scrollTop / layout.rowHeight) - layout.overscan);
  const visibleRows = Math.ceil(viewportHeight / layout.rowHeight) + layout.overscan * 2;
  const start = startRow * layout.columns;
  const visible = useMemo(
    () => references.slice(start, Math.min(references.length, (startRow + visibleRows) * layout.columns)),
    [layout.columns, references, start, startRow, visibleRows]
  );

  const update = (id: string, value: ReferenceSelection | null) => {
    const next = new Map(selection);
    if (value === null) next.delete(id);
    else next.set(id, value);
    onSelectionChange(next);
  };

  return (
    <div
      className={`reference-grid view-${view}`}
      data-testid="reference-grid"
      data-view={view}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      style={{ height: viewportHeight }}
    >
      <div className="reference-grid-window" style={{ height: rowCount * layout.rowHeight }}>
        {visible.map((reference, index) => {
          const absoluteIndex = start + index;
          const row = Math.floor(absoluteIndex / layout.columns);
          const column = absoluteIndex % layout.columns;
          const selected = selection.get(reference.id);
          const recoverAction = reference.actions.includes("locate")
            ? "locate"
            : reference.actions.includes("use-embedded-preview")
              ? "use-embedded-preview"
              : null;
          return (
            <article
              className={`reference-row state-${reference.state}`}
              data-reference-id={reference.id}
              key={reference.id}
              style={{
                top: row * layout.rowHeight,
                height: layout.rowHeight,
                left: `calc(${column} * (100% / ${layout.columns}))`,
                right: "auto",
                width: `calc(100% / ${layout.columns})`
              }}
            >
              <label className="reference-select">
                <input
                  type="checkbox"
                  checked={selected !== undefined}
                  aria-label={`Select ${reference.displayName}`}
                  onChange={(event) => update(reference.id, event.target.checked ? { enabled: true } : null)}
                />
                <ReferencePreview reference={reference} view={view} />
              </label>
              <div className="reference-identity">
                <strong title={reference.displayName}>{reference.displayName}</strong>
                <span>{reference.state} · {reference.mediaType}</span>
              </div>
              <label className="reference-include">
                Include
                <input
                  type="checkbox"
                  disabled={selected === undefined}
                  checked={selected?.enabled ?? false}
                  onChange={(event) => update(reference.id, { ...selected, enabled: event.target.checked })}
                />
              </label>
              <label className="reference-role">
                Role
                <select
                  aria-label={`${reference.displayName} role override`}
                  disabled={selected === undefined}
                  value={selected?.roleOverride ?? "general"}
                  onChange={(event) => update(reference.id, { enabled: selected?.enabled ?? true, roleOverride: event.target.value as ConnectionRole })}
                >
                  {roles.map((role) => <option key={role} value={role}>{role}</option>)}
                </select>
              </label>
              {reference.state === "missing" ? (
                <button
                  className="reference-recover"
                  type="button"
                  disabled={recoverAction === null}
                  onClick={() => recoverAction && onRecover(reference.id, recoverAction)}
                >
                  {recoverAction === "use-embedded-preview" ? "Use preview" : recoverAction === "locate" ? "Locate" : "Missing"}
                </button>
              ) : null}
            </article>
          );
        })}
      </div>
    </div>
  );
}

function ReferencePreview({ reference, view }: { reference: ReferenceDeskItem; view: ReferenceView }) {
  if (view === "waveform") {
    if (reference.mediaType.startsWith("audio/")) {
      return <span className="reference-preview reference-wave" aria-label="Audio waveform preview">{Array.from({ length: 12 }, (_, index) => <i key={index} style={{ height: `${25 + ((index * 29) % 65)}%` }} />)}</span>;
    }
    return <span className="reference-preview reference-wave-unavailable">No waveform</span>;
  }
  if (reference.mediaType.startsWith("video/")) return <span className="reference-preview reference-poster">Poster unavailable</span>;
  if (reference.mediaType.startsWith("audio/")) return <span className="reference-preview">AUDIO</span>;
  if (reference.mediaType.startsWith("image/")) return <span className="reference-preview">IMAGE</span>;
  return <span className="reference-preview">FILE</span>;
}
