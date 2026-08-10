import { useCallback, useEffect, useState } from "react";
import { Eye, FileText, Info, Music2, Star, Tag, X } from "lucide-react";
import type { ArtifactDetail } from "@ether/schema";
import { embeddedArtifactSource } from "./embeddedArtifactSource";

export type ArtifactPreviewKind = "image" | "video" | "audio" | "text" | "data" | "unsupported";

export function artifactPreviewKind(detail: Pick<ArtifactDetail, "artifact">): ArtifactPreviewKind {
  const { channel, mediaType } = detail.artifact;
  if (mediaType.startsWith("image/")) return "image";
  if (mediaType.startsWith("video/")) return "video";
  if (mediaType.startsWith("audio/")) return "audio";
  if (channel === "text" || mediaType.startsWith("text/")) return "text";
  if (channel === "data" || mediaType === "application/json" || mediaType.endsWith("+json")) return "data";
  return "unsupported";
}

export function payloadPreviewText(detail: Pick<ArtifactDetail, "sourcePayload">): string | null {
  const content = detail.sourcePayload.content;
  if (content.kind === "text") return content.value;
  if (content.kind === "object") return JSON.stringify(content.value, null, 2);
  return null;
}

function previewLabel(kind: ArtifactPreviewKind): string {
  switch (kind) {
    case "image": return "Image output";
    case "video": return "Video output";
    case "audio": return "Audio output";
    case "text": return "Text output";
    case "data": return "Data output";
    default: return "Output";
  }
}

function ArtifactOutputPreview({ documentId, detail }: { documentId: string; detail: ArtifactDetail }) {
  const kind = artifactPreviewKind(detail);
  const label = previewLabel(kind);
  const source = embeddedArtifactSource(documentId, detail.artifact.id, "original");
  const title = typeof detail.artifact.metadata.title === "string" && detail.artifact.metadata.title.trim()
    ? detail.artifact.metadata.title
    : detail.artifact.id;

  if (kind === "image") {
    return <div className="artifact-output-preview" data-testid="artifact-output-preview" data-preview-kind={kind}><img src={source} alt={title} decoding="async" /></div>;
  }
  if (kind === "video") {
    return <div className="artifact-output-preview" data-testid="artifact-output-preview" data-preview-kind={kind}><video src={source} controls preload="metadata" aria-label={title}>Your browser cannot play this video output.</video></div>;
  }
  if (kind === "audio") {
    return <div className="artifact-output-preview artifact-output-preview-audio" data-testid="artifact-output-preview" data-preview-kind={kind}><Music2 size={24} aria-hidden="true" /><audio src={source} controls preload="metadata" aria-label={title} /></div>;
  }

  const text = payloadPreviewText(detail);
  if (text !== null) {
    return <pre className="artifact-output-preview artifact-output-preview-code" data-testid="artifact-output-preview" data-preview-kind={kind} aria-label={label}>{text}</pre>;
  }

  return <div className="artifact-output-preview artifact-output-preview-empty" data-testid="artifact-output-preview" data-preview-kind={kind} role="status"><FileText size={24} aria-hidden="true" /><strong>{label} is not available inline</strong><small>The selected payload is stored as an embedded artifact without a textual payload representation.</small></div>;
}

export function ArtifactDetailPanel({ documentId, artifactId, onClose, onChanged, onStatus }: { documentId: string; artifactId: string; onClose(): void; onChanged(): Promise<void>; onStatus(message: string): void }) {
  const [detail, setDetail] = useState<ArtifactDetail | null>(null);
  const [tags, setTags] = useState("");
  const refreshDetail = useCallback(async () => { const response = await window.ether.application.query({ kind: "query", id: crypto.randomUUID(), correlationId: crypto.randomUUID(), documentId, name: "artifact.detail", payload: { artifactId } }); if (response.name === "artifact.detail") { setDetail(response.payload); setTags(response.payload.tags.join(", ")); } }, [artifactId, documentId]);
  useEffect(() => { void refreshDetail(); }, [refreshDetail]);
  const mutate = async (name: "review.rate" | "review.tag", payload: { artifactId: string; rating: number } | { artifactId: string; tags: string[] }) => {
    try { await window.ether.application.command({ kind: "command", id: crypto.randomUUID(), correlationId: crypto.randomUUID(), documentId, name, payload } as Parameters<typeof window.ether.application.command>[0]); onStatus("Artifact review saved."); await Promise.all([onChanged(), refreshDetail()]); }
    catch (cause) { onStatus(cause instanceof Error ? cause.message : "Artifact review needs attention."); }
  };
  return <aside className="artifact-detail-panel" aria-label="Artifact details"><header><div><Info size={16} /><strong>Provenance</strong></div><button type="button" aria-label="Close artifact details" onClick={onClose}><X size={16} /></button></header>{!detail ? <p>Loading detail&hellip;</p> : <>
    <h3>{String(detail.artifact.metadata.title ?? detail.artifact.id)}</h3>
    <section className="artifact-output-preview-section" aria-labelledby="artifact-output-preview-heading"><div className="artifact-output-preview-heading"><h4 id="artifact-output-preview-heading"><Eye size={14} />Selected output</h4><span>{previewLabel(artifactPreviewKind(detail))} &middot; {detail.artifact.mediaType}</span></div><ArtifactOutputPreview documentId={documentId} detail={detail} /><p className="artifact-output-preview-caption">Original embedded output. The review record below stays attached to this exact artifact version.</p></section>
    <dl><div><dt>Channel</dt><dd>{detail.artifact.channel}</dd></div><div><dt>Media</dt><dd>{detail.artifact.mediaType}</dd></div><div><dt>Bytes</dt><dd>{detail.artifact.byteLength.toLocaleString()}</dd></div><div><dt>Output</dt><dd><code>{detail.outputVersion.id}</code></dd></div><div><dt>Payload</dt><dd><code>{detail.sourcePayload.id}</code></dd></div><div><dt>Created</dt><dd>{new Date(detail.artifact.createdAt).toLocaleString()}</dd></div></dl>
    <section><h4><Star size={14} />Human rating</h4><div className="rating-row">{[0, 1, 2, 3, 4, 5].map((rating) => <button key={rating} type="button" aria-label={`Rate ${rating} out of 5`} aria-pressed={detail.ratings.at(-1)?.score === rating} onClick={() => void mutate("review.rate", { artifactId, rating })}>{rating}</button>)}</div></section>
    <section><h4><Tag size={14} />Tags</h4><form onSubmit={(event) => { event.preventDefault(); void mutate("review.tag", { artifactId, tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean) }); }}><input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="portrait, approved" /><button type="submit">Save tags</button></form></section>
    <section><h4>Collections</h4><p>{detail.collections.length ? detail.collections.map((item) => item.title).join(", ") : "Uncollected"}</p></section><section><h4>Lineage</h4><p>{detail.lineage.length} recorded relationship{detail.lineage.length === 1 ? "" : "s"}</p></section>
    {detail.evaluation ? <section><h4>Evaluation provenance</h4><p>{detail.evaluation.summary}</p><small>{detail.evaluation.providerId} &middot; {detail.evaluation.modelId}</small></section> : null}
  </>}</aside>;
}
