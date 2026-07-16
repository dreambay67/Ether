import { useEffect, useState } from "react";
import type { ArtifactRecord } from "@ether/engine";
import { artifactTitle, metadataSummary } from "./ArtifactGrid";

type LineageViewProps = {
  projectId: string;
  artifact: ArtifactRecord | null;
  onStatus(message: string): void;
};

export function LineageView({ projectId, artifact, onStatus }: LineageViewProps) {
  const [parents, setParents] = useState<ArtifactRecord[]>([]);
  const [children, setChildren] = useState<ArtifactRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    if (!artifact || !window.ether.artifacts) {
      setParents([]);
      setChildren([]);
      return;
    }

    setIsLoading(true);

    Promise.all([
      window.ether.artifacts.listLineageParents(projectId, artifact.id),
      window.ether.artifacts.listLineageChildren(projectId, artifact.id)
    ])
      .then(([nextParents, nextChildren]) => {
        if (!cancelled) {
          setParents(nextParents);
          setChildren(nextChildren);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          onStatus(error instanceof Error ? error.message : "Lineage unavailable");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [artifact, onStatus, projectId]);

  if (!artifact) {
    return <p className="artifact-empty">Select an artifact to inspect lineage.</p>;
  }

  return (
    <div className="artifact-lineage" data-testid="artifact-lineage">
      <div className="artifact-lineage-focus">
        <span>{artifact.kind}</span>
        <strong>{artifactTitle(artifact)}</strong>
      </div>
      <LineageColumn title="Parents" artifacts={parents} isLoading={isLoading} />
      <LineageColumn title="Children" artifacts={children} isLoading={isLoading} />
    </div>
  );
}

function LineageColumn({
  title,
  artifacts,
  isLoading
}: {
  title: string;
  artifacts: ArtifactRecord[];
  isLoading: boolean;
}) {
  return (
    <section>
      <h3>{title}</h3>
      {isLoading ? <p>Loading...</p> : null}
      {!isLoading && artifacts.length === 0 ? <p>No linked artifacts.</p> : null}
      {artifacts.map((artifact) => (
        <article key={artifact.id} className="artifact-lineage-card">
          <span>{artifact.kind}</span>
          <strong>{artifactTitle(artifact)}</strong>
          <p>{artifact.path ?? metadataSummary(artifact)}</p>
        </article>
      ))}
    </section>
  );
}
