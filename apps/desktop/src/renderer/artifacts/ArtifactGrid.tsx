import { useMemo, useState, type DragEvent } from "react";
import { File, Grip, Image as ImageIcon } from "lucide-react";
import type { Artifact } from "@ether/schema";
import { embeddedArtifactSource } from "./localImageSource";

const columns = 5;
const rowHeight = 188;
const viewportHeight = 430;

export function ArtifactGrid({ documentId, artifacts, selectedIds, onToggle, onOpen, onDragStart, onNearEnd }: {
  documentId: string;
  artifacts: Artifact[];
  selectedIds: Set<string>;
  onToggle(artifactId: string): void;
  onOpen(artifact: Artifact): void;
  onDragStart(event: DragEvent<HTMLElement>, artifact: Artifact): void;
  onNearEnd(): void;
}) {
  const [scrollTop, setScrollTop] = useState(0);
  const rows = Math.ceil(artifacts.length / columns);
  const startRow = Math.max(0, Math.floor(scrollTop / rowHeight) - 2);
  const visibleRows = Math.ceil(viewportHeight / rowHeight) + 4;
  const start = startRow * columns;
  const visible = useMemo(() => artifacts.slice(start, (startRow + visibleRows) * columns), [artifacts, start, startRow, visibleRows]);
  if (artifacts.length === 0) return <p className="review-empty">No artifacts match this view.</p>;

  return <div className="observatory-grid" data-testid="artifact-grid" style={{ height: viewportHeight }} onScroll={(event) => {
    const element = event.currentTarget;
    setScrollTop(element.scrollTop);
    if (element.scrollTop + element.clientHeight >= element.scrollHeight - rowHeight * 2) onNearEnd();
  }}>
    <div className="observatory-grid-window" style={{ height: rows * rowHeight }}>
      {visible.map((artifact, index) => {
        const absolute = start + index;
        const row = Math.floor(absolute / columns);
        const column = absolute % columns;
        return <article
          key={artifact.id}
          className={`observatory-card ${selectedIds.has(artifact.id) ? "is-selected" : ""}`}
          data-testid="artifact-card"
          style={{ top: row * rowHeight, left: `calc(${column} * 20%)`, width: "20%", height: rowHeight }}
          draggable
          onDragStart={(event) => onDragStart(event, artifact)}
          onDoubleClick={() => onOpen(artifact)}
        >
          <ArtifactPreview documentId={documentId} artifact={artifact} />
          <label className="artifact-select"><input type="checkbox" aria-label={`Select ${artifactTitle(artifact)}`} checked={selectedIds.has(artifact.id)} onChange={() => onToggle(artifact.id)} /><span>Select</span></label>
          <button type="button" className="artifact-open" onClick={() => onOpen(artifact)}><strong>{artifactTitle(artifact)}</strong><span>{artifact.channel} · {formatBytes(artifact.byteLength)}</span></button>
          <Grip className="artifact-drag-mark" size={13} aria-label="Drag to Explorer" />
        </article>;
      })}
    </div>
  </div>;
}

export function ArtifactPreview({ documentId, artifact }: { documentId: string; artifact: Artifact }) {
  if (artifact.mediaType.startsWith("image/")) return <img className="artifact-embedded-preview" src={embeddedArtifactSource(documentId, artifact.id)} alt="" draggable={false} />;
  return <div className="artifact-media-honest">{artifact.channel === "image" ? <ImageIcon size={22} /> : <File size={22} />}<span>{artifact.mediaType}</span><small>Embedded preview unavailable</small></div>;
}

export function artifactTitle(artifact: Artifact) {
  const title = artifact.metadata.title ?? artifact.metadata.label ?? artifact.metadata.originalName;
  return typeof title === "string" && title.trim() ? title : artifact.id;
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}
