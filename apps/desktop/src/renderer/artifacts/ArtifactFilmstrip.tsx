import type { DragEvent } from "react";
import type { ArtifactRecord } from "@ether/engine";
import { artifactTitle, canDragArtifact, isImageArtifact, metadataSummary } from "./ArtifactGrid";
import { localImageSource } from "./localImageSource";

type ArtifactFilmstripProps = {
  artifacts: ArtifactRecord[];
  selectedArtifactId: string | null;
  onSelect(artifact: ArtifactRecord): void;
  onDragStart(event: DragEvent<HTMLElement>, artifact: ArtifactRecord): void;
};

export function ArtifactFilmstrip({
  artifacts,
  selectedArtifactId,
  onSelect,
  onDragStart
}: ArtifactFilmstripProps) {
  if (artifacts.length === 0) {
    return <p className="artifact-empty">No artifacts in the current filter.</p>;
  }

  return (
    <div className="artifact-filmstrip" data-testid="artifact-filmstrip">
      {artifacts.map((artifact) => (
        <button
          key={artifact.id}
          type="button"
          className={`artifact-filmstrip-item${artifact.id === selectedArtifactId ? " is-selected" : ""}`}
          data-testid={`artifact-filmstrip-${artifact.id}`}
          draggable={canDragArtifact(artifact)}
          onClick={() => onSelect(artifact)}
          onDragStart={(event) => onDragStart(event, artifact)}
        >
          {artifact.path && isImageArtifact(artifact) ? (
            <img src={localImageSource(artifact.path)} alt="" draggable={false} />
          ) : (
            <span>{artifact.kind.slice(0, 2)}</span>
          )}
          <strong>{artifactTitle(artifact)}</strong>
          <em>{metadataSummary(artifact)}</em>
        </button>
      ))}
    </div>
  );
}
