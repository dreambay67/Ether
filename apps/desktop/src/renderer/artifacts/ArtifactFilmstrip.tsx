import { useMemo, useState, type DragEvent } from "react";
import type { Artifact } from "@ether/schema";
import { artifactTitle, ArtifactPreview } from "./ArtifactGrid";

const itemWidth = 206;

export function ArtifactFilmstrip({ documentId, artifacts, selectedIds, onToggle, onOpen, onDragStart, onNearEnd }: {
  documentId: string;
  artifacts: Artifact[];
  selectedIds: Set<string>;
  onToggle(artifactId: string): void;
  onOpen(artifact: Artifact): void;
  onDragStart(event: DragEvent<HTMLElement>, artifact: Artifact): void;
  onNearEnd(): void;
}) {
  const [scrollLeft, setScrollLeft] = useState(0);
  const start = Math.max(0, Math.floor(scrollLeft / itemWidth) - 3);
  const visible = useMemo(() => artifacts.slice(start, start + 12), [artifacts, start]);
  if (artifacts.length === 0) return <p className="review-empty">No artifacts match this filmstrip.</p>;
  return <div className="observatory-filmstrip" data-testid="artifact-filmstrip" onScroll={(event) => {
    const element = event.currentTarget;
    setScrollLeft(element.scrollLeft);
    if (element.scrollLeft + element.clientWidth >= element.scrollWidth - itemWidth * 2) onNearEnd();
  }}>
    <div className="observatory-filmstrip-window" style={{ width: artifacts.length * itemWidth }}>
      {visible.map((artifact, index) => <article key={artifact.id} className={`filmstrip-card ${selectedIds.has(artifact.id) ? "is-selected" : ""}`} style={{ left: (start + index) * itemWidth, width: itemWidth }} draggable onDragStart={(event) => onDragStart(event, artifact)}>
        <ArtifactPreview documentId={documentId} artifact={artifact} />
        <label><input type="checkbox" aria-label={`Select ${artifactTitle(artifact)}`} checked={selectedIds.has(artifact.id)} onChange={() => onToggle(artifact.id)} />Select</label>
        <button type="button" onClick={() => onOpen(artifact)}>{artifactTitle(artifact)}</button>
      </article>)}</div>
  </div>;
}
