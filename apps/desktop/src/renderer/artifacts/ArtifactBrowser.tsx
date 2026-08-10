import { useCallback, useEffect, useMemo, useState, type DragEvent } from "react";
import { Columns3, Download, Film, GitFork, Grid3X3, ListFilter, RefreshCcw, Search, Sparkles } from "lucide-react";
import type { Artifact, ArtifactDetail, Collection, EtherNode, PayloadChannel, ReviewEvaluateConfig, ReviewFilterConfig } from "@ether/schema";

import { CompareStage } from "../review/CompareStage";
import { EvaluationPanel } from "../review/EvaluationPanel";
import { FilterRules } from "../review/FilterRules";
import { ExportDialog } from "../export/ExportDialog";
import { LiveOutputPanel } from "../export/LiveOutputPanel";
import { ArtifactDetailPanel } from "./ArtifactDetailPanel";
import { ArtifactFilmstrip } from "./ArtifactFilmstrip";
import { ArtifactGrid } from "./ArtifactGrid";
import { CollectionView } from "./CollectionView";
import { LineageView } from "./LineageView";
import { startArtifactDrag } from "./artifactDragPayload";
import { emptyArtifactFilters, useArtifacts, type ArtifactFilters } from "./useArtifacts";
import "../styles/review-workspace.css";

type View = "grid" | "filmstrip" | "lineage" | "collections" | "compare" | "evaluate" | "filter" | "live";
const channels: PayloadChannel[] = ["text", "image", "mask", "data", "video", "audio"];
type CompareCheckpoint = {
  candidateOutputVersionIds: string[];
  id: string;
  minimumSelections: number;
  selectedOutputVersionIds: string[];
  selectionMode: "one" | "many";
};

export function reconcileArtifactSelection(selectedIds: Iterable<string>, visibleIds: Iterable<string>): string[] {
  const visible = new Set(visibleIds);
  return [...new Set(selectedIds)].filter((id) => visible.has(id));
}

export function ArtifactBrowser({ documentId }: { documentId: string }) {
  const [draft, setDraft] = useState<ArtifactFilters>(emptyArtifactFilters);
  const [filters, setFilters] = useState<ArtifactFilters>(emptyArtifactFilters);
  const { artifacts, total, nextCursor, loading, loadingMore, error, refresh, loadMore } = useArtifacts(documentId, filters);
  const [view, setView] = useState<View>("grid");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detailId, setDetailId] = useState<string | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [message, setMessage] = useState("Review is local and document-backed.");
  const [checkpoint, setCheckpoint] = useState<CompareCheckpoint | null>(null);
  const [checkpointArtifacts, setCheckpointArtifacts] = useState<Artifact[]>([]);
  const [reviewNodes, setReviewNodes] = useState<Array<{ graphId: string; node: EtherNode }>>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [evaluationDetails, setEvaluationDetails] = useState<ArtifactDetail[]>([]);
  const visibleArtifactIds = useMemo(() => new Set(artifacts.map((artifact) => artifact.id)), [artifacts]);
  const selectedIds = useMemo(() => reconcileArtifactSelection(selected, visibleArtifactIds), [selected, visibleArtifactIds]);
  const selectedArtifactIds = useMemo(() => new Set(selectedIds), [selectedIds]);
  const exportableSelectedIds = loading || error !== null ? [] : selectedIds;
  const selectedArtifact = artifacts.find((artifact) => artifact.id === (detailId ?? selectedIds[0])) ?? null;
  const evaluationEntry = reviewNodes.find((entry) => entry.node.definitionId === "review.evaluate");
  const evaluationNode = evaluationEntry?.node as EtherNode<ReviewEvaluateConfig> | undefined;
  const filterEntry = reviewNodes.find((entry) => entry.node.definitionId === "review.filter");
  const filterNode = filterEntry?.node as EtherNode<ReviewFilterConfig> | undefined;
  const fallbackFilter: ReviewFilterConfig = { kind: "review.filter", match: "all", rules: [], routes: [] };

  const loadReviewContext = useCallback(async () => {
    try {
      const [checkpoints, catalog, collectionList] = await Promise.all([
        window.ether.application.query({ kind: "query", id: crypto.randomUUID(), correlationId: crypto.randomUUID(), documentId, name: "review.checkpoints", payload: { state: "waiting-review", limit: 20 } }),
        window.ether.application.query({ kind: "query", id: crypto.randomUUID(), correlationId: crypto.randomUUID(), documentId, name: "graph.catalog", payload: {} }),
        window.ether.application.query({ kind: "query", id: crypto.randomUUID(), correlationId: crypto.randomUUID(), documentId, name: "collection.list", payload: {} })
      ]);
      if (checkpoints.name === "review.checkpoints") setCheckpoint(checkpoints.payload.checkpoints[0] ?? null);
      if (collectionList.name === "collection.list") setCollections(collectionList.payload.collections);
      if (catalog.name === "graph.catalog") {
        const snapshots = await Promise.all(catalog.payload.graphs.map((graph) => window.ether.application.query({ kind: "query", id: crypto.randomUUID(), correlationId: crypto.randomUUID(), documentId, name: "graph.snapshot", payload: { graphId: graph.id } })));
        setReviewNodes(snapshots.flatMap((response) => response.name === "graph.snapshot" ? response.payload.graph.nodes.filter((node) => node.definitionId.startsWith("review.")).map((node) => ({ graphId: response.payload.graph.id, node })) : []));
      }
    } catch { setReviewNodes([]); }
  }, [documentId]);
  useEffect(() => { void loadReviewContext(); }, [loadReviewContext]);
  useEffect(() => {
    setSelected((current) => {
      const next = new Set(reconcileArtifactSelection(current, visibleArtifactIds));
      if (next.size === current.size && [...current].every((id) => next.has(id))) return current;
      return next;
    });
  }, [visibleArtifactIds]);
  useEffect(() => {
    if (checkpoint === null) {
      setCheckpointArtifacts([]);
      return;
    }
    let cancelled = false;
    void window.ether.application.query({
      kind: "query",
      id: crypto.randomUUID(),
      correlationId: crypto.randomUUID(),
      documentId,
      name: "artifact.search",
      payload: { ...emptyArtifactFilters, outputVersionIds: checkpoint.candidateOutputVersionIds, limit: 500 }
    }).then((response) => {
      if (!cancelled && response.name === "artifact.search") setCheckpointArtifacts(response.payload.artifacts);
    }).catch(() => { if (!cancelled) setCheckpointArtifacts([]); });
    return () => { cancelled = true; };
  }, [checkpoint, documentId]);
  useEffect(() => {
    if (view !== "evaluate") return;
    let cancelled = false;
    const ids = selectedIds.length ? selectedIds : artifacts.slice(0, 4).map((artifact) => artifact.id);
    void Promise.all(ids.map((artifactId) => window.ether.application.query({ kind: "query", id: crypto.randomUUID(), correlationId: crypto.randomUUID(), documentId, name: "artifact.detail", payload: { artifactId } })))
      .then((responses) => { if (!cancelled) setEvaluationDetails(responses.flatMap((response) => response.name === "artifact.detail" ? [response.payload] : [])); })
      .catch(() => { if (!cancelled) setEvaluationDetails([]); });
    return () => { cancelled = true; };
  }, [artifacts, documentId, selectedIds, view]);

  const toggle = (id: string) => setSelected((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const drag = (event: DragEvent<HTMLElement>, artifact: (typeof artifacts)[number]) => {
    event.dataTransfer.effectAllowed = "copy";
    const ids = selected.has(artifact.id) ? selectedIds : [artifact.id];
    void startArtifactDrag(documentId, ids).catch((cause) => setMessage(cause instanceof Error ? cause.message : "Native drag needs attention."));
  };
  const applyFilters = (next: ArtifactFilters) => {
    setSelected(new Set());
    setFilters(next);
  };
  const apply = () => applyFilters({ ...draft, tags: draft.tags.filter(Boolean) });
  const patchDraft = <K extends keyof ArtifactFilters>(key: K, value: ArtifactFilters[K]) => setDraft((current) => ({ ...current, [key]: value }));

  return <section className="artifact-observatory" aria-label="Artifact Observatory" data-testid="artifact-observatory">
    <header className="observatory-title"><div><span className="eyebrow">Decision workspace</span><h1><Sparkles size={19} />Artifact Observatory</h1></div><div><strong>{total.toLocaleString()}</strong><span>document artifacts</span></div></header>
    <form className="observatory-search" onSubmit={(event) => { event.preventDefault(); apply(); }}><label><Search size={15} /><input aria-label="Search artifacts" value={draft.text} onChange={(event) => patchDraft("text", event.target.value)} placeholder="Search title, metadata, provenance — empty shows all" /></label><button type="submit">Search</button><button type="button" aria-pressed={advanced} onClick={() => setAdvanced((value) => !value)}><ListFilter size={15} />Filters</button><button type="button" aria-label="Refresh artifacts" onClick={() => void refresh()}><RefreshCcw size={15} /></button></form>
    {advanced ? <section className="observatory-filters" aria-label="Artifact filters"><fieldset><legend>Channels</legend>{channels.map((channel) => <label key={channel}><input type="checkbox" checked={draft.channels.includes(channel)} onChange={() => patchDraft("channels", draft.channels.includes(channel) ? draft.channels.filter((item) => item !== channel) : [...draft.channels, channel])} />{channel}</label>)}</fieldset><fieldset><legend>Collections</legend>{collections.length ? collections.map((collection) => <label key={collection.id}><input type="checkbox" checked={draft.collectionIds.includes(collection.id)} onChange={() => patchDraft("collectionIds", draft.collectionIds.includes(collection.id) ? draft.collectionIds.filter((id) => id !== collection.id) : [...draft.collectionIds, collection.id])} />{collection.title}</label>) : <span>No collections yet</span>}</fieldset><div className="review-form-grid"><label>Tags<input value={draft.tags.join(", ")} onChange={(event) => patchDraft("tags", event.target.value.split(",").map((tag) => tag.trim()).filter(Boolean))} /></label><label>Minimum rating<select value={draft.minimumRating ?? ""} onChange={(event) => patchDraft("minimumRating", event.target.value ? Number(event.target.value) : null)}><option value="">Any</option>{[1,2,3,4,5].map((rating) => <option key={rating}>{rating}</option>)}</select></label><label>Provider<input value={draft.providerId ?? ""} onChange={(event) => patchDraft("providerId", event.target.value || null)} /></label><label>Model<input value={draft.modelId ?? ""} onChange={(event) => patchDraft("modelId", event.target.value || null)} /></label><label>Run ID<input value={draft.runId ?? ""} onChange={(event) => patchDraft("runId", event.target.value || null)} /></label><label>Graph ID<input value={draft.graphId ?? ""} onChange={(event) => patchDraft("graphId", event.target.value || null)} /></label><label>Created after<input type="datetime-local" value={draft.createdAfter?.slice(0,16) ?? ""} onChange={(event) => patchDraft("createdAfter", event.target.value ? new Date(event.target.value).toISOString() : null)} /></label><label>Created before<input type="datetime-local" value={draft.createdBefore?.slice(0,16) ?? ""} onChange={(event) => patchDraft("createdBefore", event.target.value ? new Date(event.target.value).toISOString() : null)} /></label></div><footer><button type="button" onClick={() => { setDraft(emptyArtifactFilters); applyFilters(emptyArtifactFilters); }}>Clear all</button><button type="button" onClick={apply}>Apply filters</button></footer></section> : null}
    <nav className="observatory-modes" aria-label="Observatory views">{([
      ["grid", Grid3X3, "Grid"], ["filmstrip", Film, "Filmstrip"], ["lineage", GitFork, "Lineage"], ["collections", Columns3, "Collections"], ["compare", Columns3, "Compare"], ["evaluate", Sparkles, "Evaluate"], ["filter", ListFilter, "Filter"], ["live", RefreshCcw, "Live Output"]
    ] as const).map(([id, Icon, label]) => <button type="button" key={id} aria-current={view === id ? "page" : undefined} onClick={() => setView(id)}><Icon size={14} />{label}</button>)}</nav>
    <div className="observatory-actionbar"><p role="status">{error ?? (loading ? "Loading embedded artifacts…" : `${artifacts.length.toLocaleString()} loaded · ${selectedIds.length} selected · ${message}`)}</p><div><button type="button" disabled={!selectedIds.length} onClick={() => setSelected(new Set())}>Clear selection</button><button type="button" disabled={!artifacts.length || loading || error !== null} onClick={() => setSelected(new Set(artifacts.map((artifact) => artifact.id)))}>Select loaded</button><button type="button" disabled={loading || error !== null || (!selectedIds.length && !artifacts.length)} onClick={() => setExportOpen(true)}><Download size={14} />Export</button></div></div>
    <main className="observatory-stage">
      {view === "grid" ? <ArtifactGrid documentId={documentId} artifacts={artifacts} selectedIds={selectedArtifactIds} onToggle={toggle} onOpen={(artifact) => setDetailId(artifact.id)} onDragStart={drag} onNearEnd={() => void loadMore()} /> : null}
      {view === "filmstrip" ? <ArtifactFilmstrip documentId={documentId} artifacts={artifacts} selectedIds={selectedArtifactIds} onToggle={toggle} onOpen={(artifact) => setDetailId(artifact.id)} onDragStart={drag} onNearEnd={() => void loadMore()} /> : null}
      {view === "lineage" ? <LineageView documentId={documentId} artifact={selectedArtifact} onStatus={setMessage} /> : null}
      {view === "collections" ? <CollectionView documentId={documentId} selectedArtifactIds={selectedIds} onStatus={setMessage} /> : null}
      {view === "compare" ? checkpoint ? <CompareStage documentId={documentId} checkpointId={checkpoint.id} artifacts={checkpointArtifacts} candidateOutputVersionIds={checkpoint.candidateOutputVersionIds} selectionMode={checkpoint.selectionMode} minimumSelections={checkpoint.minimumSelections} initialSelectedOutputVersionIds={checkpoint.selectedOutputVersionIds} onStatus={setMessage} onCompleted={loadReviewContext} /> : <div className="review-empty"><h2>No waiting Compare checkpoint</h2><p>Run a graph with a Compare node to create a durable human checkpoint.</p></div> : null}
      {view === "evaluate" ? evaluationNode && evaluationEntry ? <EvaluationPanel documentId={documentId} graphId={evaluationEntry.graphId} node={evaluationNode} artifactDetails={evaluationDetails} onStatus={setMessage} /> : <div className="review-empty"><h2>No Evaluate node in this document</h2><p>Add an Evaluate node to reveal its Codex instruction, rubric, and run provenance here.</p></div> : null}
      {view === "filter" ? <FilterRules config={filterNode?.config ?? fallbackFilter} artifacts={artifacts.slice(0, 50)} /> : null}
      {view === "live" ? <LiveOutputPanel documentId={documentId} onStatus={setMessage} /> : null}
      {loadingMore ? <p className="loading-more">Loading the next page…</p> : nextCursor && (view === "grid" || view === "filmstrip") ? <button type="button" className="load-more" onClick={() => void loadMore()}>Load more</button> : null}
      {detailId ? <ArtifactDetailPanel documentId={documentId} artifactId={detailId} onClose={() => setDetailId(null)} onChanged={refresh} onStatus={setMessage} /> : null}
    </main>
    <ExportDialog documentId={documentId} selectedIds={exportableSelectedIds} loadedIds={loading || error !== null ? [] : artifacts.map((artifact) => artifact.id)} total={total} open={exportOpen} onClose={() => setExportOpen(false)} onStatus={setMessage} />
  </section>;
}
