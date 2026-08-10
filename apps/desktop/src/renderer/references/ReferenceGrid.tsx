import { useEffect, useMemo, useState } from "react";
import { connectionRoles, type ConnectionRole } from "@ether/schema";
import type { ReferenceAction } from "../../shared/ipc/contracts";
import { embeddedArtifactSource } from "../artifacts/embeddedArtifactSource";
import type { ReferenceDeskItem } from "./useReferences";

export type ReferenceSelection = {
  enabled: boolean;
  roleOverride?: ConnectionRole;
};

export type ReferenceView = "grid" | "filmstrip" | "waveform" | "list";

const roles: readonly ConnectionRole[] = connectionRoles;
const viewportHeight = 360;
const contentKeyPattern = /^[a-f0-9]{64}$/iu;
const supportedReferenceMediaTypes = new Map<string, ReferenceMediaKind>([
  ["image/avif", "image"],
  ["image/bmp", "image"],
  ["image/gif", "image"],
  ["image/jpeg", "image"],
  ["image/png", "image"],
  ["image/tiff", "image"],
  ["image/webp", "image"],
  ["audio/mpeg", "audio"],
  ["audio/ogg", "audio"],
  ["audio/wav", "audio"],
  ["audio/wave", "audio"],
  ["video/mp4", "video"],
  ["video/ogg", "video"],
  ["video/webm", "video"]
]);

type ReferenceMediaKind = "image" | "video" | "audio";

export type ReferencePreviewResolution =
  | { kind: ReferenceMediaKind; source: string }
  | { kind: "unavailable"; reason: "missing-content" | "unsupported-media" };

export function resolveReferencePreview(documentId: string, reference: ReferenceDeskItem): ReferencePreviewResolution {
  const kind = supportedReferenceMediaTypes.get(reference.mediaType.trim().toLowerCase());
  if (kind === undefined) return { kind: "unavailable", reason: "unsupported-media" };

  const candidates = reference.state === "embedded"
    ? [reference.contentKey, reference.previewContentKey]
    : [reference.previewContentKey];
  const hasContent = candidates.some((candidate) => candidate !== null && contentKeyPattern.test(candidate));
  if (!hasContent) return { kind: "unavailable", reason: "missing-content" };

  // The main process resolves and authorizes the reference's ready blob. The
  // renderer only carries the document-scoped reference id and never reaches
  // the redacted originalPath or a content-addressed blob directly.
  return { kind, source: embeddedArtifactSource(documentId, reference.id, "reference") };
}

const viewLayout: Record<ReferenceView, { columns: number; rowHeight: number; overscan: number }> = {
  grid: { columns: 4, rowHeight: 132, overscan: 1 },
  filmstrip: { columns: 3, rowHeight: 112, overscan: 1 },
  waveform: { columns: 1, rowHeight: 72, overscan: 3 },
  list: { columns: 1, rowHeight: 58, overscan: 4 }
};

export function ReferenceGrid({
  documentId,
  references,
  selection,
  view,
  onSelectionChange,
  onRecover
}: {
  documentId: string;
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
              <div className="reference-select">
                <input
                  type="checkbox"
                  checked={selected !== undefined}
                  aria-label={`Select ${reference.displayName}`}
                  onChange={(event) => update(reference.id, event.target.checked ? { enabled: true } : null)}
                />
                <ReferencePreview documentId={documentId} reference={reference} view={view} />
              </div>
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

export function ReferencePreview({ documentId, reference, view }: { documentId: string; reference: ReferenceDeskItem; view: ReferenceView }) {
  const resolution = resolveReferencePreview(documentId, reference);
  const source = resolution.kind === "unavailable" ? null : resolution.source;
  const [failedSource, setFailedSource] = useState<string | null>(null);

  useEffect(() => {
    setFailedSource(null);
  }, [source, reference.contentKey, reference.previewContentKey, reference.state]);

  if (resolution.kind === "unavailable" || failedSource === source) {
    return (
      <span
        className={`reference-preview reference-preview-unavailable${view === "waveform" ? " reference-wave-unavailable" : ""}`}
        data-preview-state="unavailable"
        aria-label="Media preview unavailable"
        title={resolution.kind === "unavailable" && resolution.reason === "missing-content" ? "No embedded preview is available." : "Media preview unavailable."}
      >
        Preview unavailable
      </span>
    );
  }

  const onAssetError = () => setFailedSource(source);
  const mediaClassName = `reference-preview reference-preview-${resolution.kind}${resolution.kind === "audio" && view === "waveform" ? " reference-wave" : ""}`;
  if (resolution.kind === "image") {
    return <img className={mediaClassName} data-preview-kind="image" src={resolution.source} alt={`${reference.displayName} preview`} loading="lazy" decoding="async" draggable={false} onError={onAssetError} />;
  }
  if (resolution.kind === "video") {
    return <video className={mediaClassName} data-preview-kind="video" src={resolution.source} aria-label={`${reference.displayName} video preview`} muted playsInline preload="metadata" onError={onAssetError} />;
  }
  return <audio className={mediaClassName} data-preview-kind="audio" src={resolution.source} aria-label={`${reference.displayName} audio preview`} controls preload="metadata" onError={onAssetError} />;
}
