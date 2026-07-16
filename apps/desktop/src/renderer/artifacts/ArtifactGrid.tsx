import type { DragEvent } from "react";
import { Eye, FolderOpen, Star, Tag, Wand2 } from "lucide-react";
import type { ArtifactRecord } from "@ether/engine";
import { localImageSource } from "./localImageSource";

type ArtifactGridProps = {
  artifacts: ArtifactRecord[];
  selectedArtifactId: string | null;
  tagDrafts: Record<string, string>;
  onSelect(artifact: ArtifactRecord): void;
  onDragStart(event: DragEvent<HTMLElement>, artifact: ArtifactRecord): void;
  onTagDraftChange(artifactId: string, value: string): void;
  onTag(artifact: ArtifactRecord): void;
  onRate(artifact: ArtifactRecord): void;
  onReveal(artifact: ArtifactRecord): void;
  onUpdateMetadata(artifact: ArtifactRecord): void;
};

export function ArtifactGrid({
  artifacts,
  selectedArtifactId,
  tagDrafts,
  onSelect,
  onDragStart,
  onTagDraftChange,
  onTag,
  onRate,
  onReveal,
  onUpdateMetadata
}: ArtifactGridProps) {
  if (artifacts.length === 0) {
    return <p className="artifact-empty">No artifacts match this view.</p>;
  }

  return (
    <div className="artifact-grid" data-testid="artifact-grid">
      {artifacts.map((artifact) => (
        <article
          key={artifact.id}
          className={`artifact-card${artifact.id === selectedArtifactId ? " is-selected" : ""}`}
          data-testid={`artifact-card-${artifact.id}`}
          draggable={canDragArtifact(artifact)}
          onClick={() => onSelect(artifact)}
          onDragStart={(event) => onDragStart(event, artifact)}
        >
          <ArtifactPreview artifact={artifact} />
          <div className="artifact-card-main">
            <div className="artifact-card-topline">
              <span>{artifact.kind}</span>
              {ratingValue(artifact) ? <strong>{ratingValue(artifact)}</strong> : null}
            </div>
            <h3>{artifactTitle(artifact)}</h3>
            <p>{artifact.path ?? metadataSummary(artifact)}</p>
          </div>
          <div className="artifact-card-actions" onClick={(event) => event.stopPropagation()}>
            <input
              data-testid={`artifact-tag-input-${artifact.id}`}
              aria-label={`Tag ${artifactTitle(artifact)}`}
              value={tagDrafts[artifact.id] ?? ""}
              placeholder="tag"
              onChange={(event) => onTagDraftChange(artifact.id, event.target.value)}
            />
            <button
              type="button"
              data-testid={`artifact-tag-button-${artifact.id}`}
              title="Tag artifact"
              onClick={() => onTag(artifact)}
            >
              <Tag size={13} aria-hidden="true" />
            </button>
            <button
              type="button"
              data-testid={`artifact-rate-button-${artifact.id}`}
              title="Rate artifact"
              onClick={() => onRate(artifact)}
            >
              <Star size={13} aria-hidden="true" />
            </button>
            <button
              type="button"
              data-testid={`artifact-metadata-button-${artifact.id}`}
              title="Mark reviewed"
              onClick={() => onUpdateMetadata(artifact)}
            >
              <Wand2 size={13} aria-hidden="true" />
            </button>
            <button
              type="button"
              data-testid={`artifact-reveal-button-${artifact.id}`}
              title="Reveal file"
              disabled={!artifact.path}
              onClick={() => onReveal(artifact)}
            >
              <FolderOpen size={13} aria-hidden="true" />
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}

function ArtifactPreview({ artifact }: { artifact: ArtifactRecord }) {
  if (artifact.path && isImageArtifact(artifact)) {
    return (
      <div className="artifact-preview">
        <img src={localImageSource(artifact.path)} alt="" draggable={false} />
      </div>
    );
  }

  return (
    <div className="artifact-preview artifact-preview-empty">
      <Eye size={18} aria-hidden="true" />
    </div>
  );
}

export function artifactTitle(artifact: ArtifactRecord) {
  const title = artifact.metadata.title ?? artifact.metadata.label ?? artifact.metadata.originalName;

  if (typeof title === "string" && title.trim()) {
    return title;
  }

  return artifact.path?.split(/[\\/]/).filter(Boolean).at(-1) ?? artifact.id;
}

export function metadataSummary(artifact: ArtifactRecord) {
  const text = artifact.metadata.text ?? artifact.metadata.prompt ?? artifact.metadata.note;

  if (typeof text === "string" && text.trim()) {
    return text;
  }

  return artifact.id;
}

export function canDragArtifact(artifact: ArtifactRecord) {
  return Boolean(artifact.path && ["image", "reference", "edit"].includes(artifact.kind));
}

export function isImageArtifact(artifact: ArtifactRecord) {
  return Boolean(artifact.path && ["image", "reference", "edit", "mask"].includes(artifact.kind));
}

function ratingValue(artifact: ArtifactRecord) {
  const rating = artifact.metadata.rating;

  if (rating && typeof rating === "object" && !Array.isArray(rating) && "value" in rating) {
    return String((rating as { value?: unknown }).value ?? "");
  }

  return "";
}
