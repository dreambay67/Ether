import { useEffect, useState } from "react";
import { ArrowDownRight, ArrowUpLeft } from "lucide-react";
import type { Artifact, ArtifactLineage } from "@ether/schema";
import { artifactTitle } from "./ArtifactGrid";

export function LineageView({ documentId, artifact, onStatus }: { documentId: string; artifact: Artifact | null; onStatus(message: string): void }) {
  const [lineage, setLineage] = useState<ArtifactLineage[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!artifact) { setLineage([]); return; }
    let cancelled = false;
    setLoading(true);
    void window.ether.application.query({ kind: "query", id: crypto.randomUUID(), correlationId: crypto.randomUUID(), documentId, name: "artifact.lineage", payload: { artifactId: artifact.id } })
      .then((response) => {
        if (response.name !== "artifact.lineage") throw new Error("Ether returned an unexpected lineage response.");
        if (!cancelled) setLineage(response.payload.lineage);
      })
      .catch((cause) => { if (!cancelled) onStatus(cause instanceof Error ? cause.message : "Lineage could not be loaded."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [artifact, documentId, onStatus]);
  if (!artifact) return <p className="review-empty">Select an artifact to inspect lineage.</p>;
  const parents = lineage.filter((edge) => edge.childArtifactId === artifact.id);
  const children = lineage.filter((edge) => edge.parentArtifactId === artifact.id);
  return <section className="lineage-stage" data-testid="artifact-lineage">
    <header><span>Lineage focus</span><h3>{artifactTitle(artifact)}</h3><code>{artifact.contentKey.slice(0, 16)}</code></header>
    <div><LineageColumn title="Parents" icon={<ArrowUpLeft size={15} />} edges={parents} endpoint="parent" loading={loading} /><LineageColumn title="Children" icon={<ArrowDownRight size={15} />} edges={children} endpoint="child" loading={loading} /></div>
  </section>;
}

function LineageColumn({ title, icon, edges, endpoint, loading }: { title: string; icon: React.ReactNode; edges: ArtifactLineage[]; endpoint: "parent" | "child"; loading: boolean }) {
  return <section><h4>{icon}{title}</h4>{loading ? <p>Loading lineage…</p> : edges.length === 0 ? <p>No {title.toLowerCase()} recorded.</p> : edges.map((edge) => <article key={edge.id}><strong>{endpoint === "parent" ? edge.parentArtifactId : edge.childArtifactId}</strong><span>{edge.relation} · {edge.role}</span><time>{new Date(edge.createdAt).toLocaleString()}</time></article>)}</section>;
}
