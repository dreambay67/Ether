import { useCallback, useEffect, useState } from "react";
import { Info, Star, Tag, X } from "lucide-react";
import type { ArtifactDetail } from "@ether/schema";

export function ArtifactDetailPanel({ documentId, artifactId, onClose, onChanged, onStatus }: { documentId: string; artifactId: string; onClose(): void; onChanged(): Promise<void>; onStatus(message: string): void }) {
  const [detail, setDetail] = useState<ArtifactDetail | null>(null);
  const [tags, setTags] = useState("");
  const refreshDetail = useCallback(async () => { const response = await window.ether.application.query({ kind: "query", id: crypto.randomUUID(), correlationId: crypto.randomUUID(), documentId, name: "artifact.detail", payload: { artifactId } }); if (response.name === "artifact.detail") { setDetail(response.payload); setTags(response.payload.tags.join(", ")); } }, [artifactId, documentId]);
  useEffect(() => { void refreshDetail(); }, [refreshDetail]);
  const mutate = async (name: "review.rate" | "review.tag", payload: { artifactId: string; rating: number } | { artifactId: string; tags: string[] }) => {
    try { await window.ether.application.command({ kind: "command", id: crypto.randomUUID(), correlationId: crypto.randomUUID(), documentId, name, payload } as Parameters<typeof window.ether.application.command>[0]); onStatus("Artifact review saved."); await Promise.all([onChanged(), refreshDetail()]); }
    catch (cause) { onStatus(cause instanceof Error ? cause.message : "Artifact review needs attention."); }
  };
  return <aside className="artifact-detail-panel" aria-label="Artifact details"><header><div><Info size={16} /><strong>Provenance</strong></div><button type="button" aria-label="Close artifact details" onClick={onClose}><X size={16} /></button></header>{!detail ? <p>Loading detail…</p> : <>
    <h3>{String(detail.artifact.metadata.title ?? detail.artifact.id)}</h3><dl><div><dt>Channel</dt><dd>{detail.artifact.channel}</dd></div><div><dt>Media</dt><dd>{detail.artifact.mediaType}</dd></div><div><dt>Bytes</dt><dd>{detail.artifact.byteLength.toLocaleString()}</dd></div><div><dt>Output</dt><dd><code>{detail.outputVersion.id}</code></dd></div><div><dt>Payload</dt><dd><code>{detail.sourcePayload.id}</code></dd></div><div><dt>Created</dt><dd>{new Date(detail.artifact.createdAt).toLocaleString()}</dd></div></dl>
    <section><h4><Star size={14} />Human rating</h4><div className="rating-row">{[0, 1, 2, 3, 4, 5].map((rating) => <button key={rating} type="button" aria-label={`Rate ${rating} out of 5`} aria-pressed={detail.ratings.at(-1)?.score === rating} onClick={() => void mutate("review.rate", { artifactId, rating })}>{rating}</button>)}</div></section>
    <section><h4><Tag size={14} />Tags</h4><form onSubmit={(event) => { event.preventDefault(); void mutate("review.tag", { artifactId, tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean) }); }}><input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="portrait, approved" /><button type="submit">Save tags</button></form></section>
    <section><h4>Collections</h4><p>{detail.collections.length ? detail.collections.map((item) => item.title).join(", ") : "Uncollected"}</p></section><section><h4>Lineage</h4><p>{detail.lineage.length} recorded relationship{detail.lineage.length === 1 ? "" : "s"}</p></section>
    {detail.evaluation ? <section><h4>Evaluation provenance</h4><p>{detail.evaluation.summary}</p><small>{detail.evaluation.providerId} · {detail.evaluation.modelId}</small></section> : null}
  </>}</aside>;
}
