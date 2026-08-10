import { useEffect, useMemo, useState, type DragEvent } from "react";
import { Columns3, Files, Grid2X2, Link2, List, PackagePlus, RefreshCcw, ScanSearch, Waves } from "lucide-react";
import { referenceSetMembers, type ConnectionRole, type EtherGraph, type FlowBatchConfig, type GraphOperation, type ReferenceSetMember } from "@ether/schema";
import type { ReferenceAction } from "../../shared/ipc/contracts";
import { ReferenceGrid, type ReferenceSelection, type ReferenceView } from "./ReferenceGrid";
import { useReferences, type ReferenceDeskItem } from "./useReferences";

const views: Array<{ id: ReferenceView; label: string; icon: typeof Grid2X2 }> = [
  { id: "grid", label: "Grid", icon: Grid2X2 },
  { id: "filmstrip", label: "Filmstrip", icon: Columns3 },
  { id: "waveform", label: "Waveform", icon: Waves },
  { id: "list", label: "List", icon: List }
];

type BatchTarget = { key: string; nodeId: string; dimensionId: string; label: string };
type BatchNode = Extract<EtherGraph["nodes"][number], { definitionId: "flow.batch" }>;

export function ReferenceDesk({ documentId, graph, onGraphUpdated, onStatus }: { documentId: string; graph: EtherGraph; onGraphUpdated(): Promise<void>; onStatus(message: string): void }) {
  const { references, loading, error, refresh } = useReferences(documentId);
  const [selection, setSelection] = useState<Map<string, ReferenceSelection>>(new Map());
  const [view, setView] = useState<ReferenceView>("list");
  const [dropStorage, setDropStorage] = useState<"link" | "embed">("link");
  const [compareOpen, setCompareOpen] = useState(false);
  const referenceSets = useMemo(() => graph.nodes.filter((node) => node.config.kind === "reference.set"), [graph.nodes]);
  const batchTargets = useMemo<BatchTarget[]>(() => graph.nodes.flatMap((node) => node.config.kind === "flow.batch"
    ? node.config.dimensions.map((dimension) => ({
      key: `${node.id}\u0000${dimension.id}`,
      nodeId: node.id,
      dimensionId: dimension.id,
      label: `${node.title} · ${dimension.name}`
    }))
    : []), [graph.nodes]);
  const [targetId, setTargetId] = useState(referenceSets[0]?.id ?? "");
  const [batchTargetKey, setBatchTargetKey] = useState(batchTargets[0]?.key ?? "");
  const target = referenceSets.find((node) => node.id === targetId) ?? referenceSets[0];
  const batchTarget = batchTargets.find((candidate) => candidate.key === batchTargetKey) ?? batchTargets[0];
  const savedMembers = target?.config.kind === "reference.set" ? referenceSetMembers(target.config) : [];
  const linkedSavedMembers = savedMembers.filter((member): member is Extract<ReferenceSetMember, { kind: "linked-reference" }> => member.kind === "linked-reference");
  const savedMembershipKey = savedMembers.map((member) => `${member.kind === "linked-reference" ? member.referenceId : member.artifactId}:${member.enabled ? 1 : 0}:${member.roleOverride ?? "general"}`).join("\u001f");
  const selectedReferences = references.filter((reference) => selection.has(reference.id));

  useEffect(() => {
    setSelection(new Map(linkedSavedMembers.map((member) => [member.referenceId, {
      enabled: member.enabled,
      ...(member.roleOverride === undefined ? {} : { roleOverride: member.roleOverride })
    }])));
    setCompareOpen(false);
  }, [target?.id, savedMembershipKey]);

  const choose = async (storage: "link" | "embed") => {
    if (!target) return;
    try {
      const result = await window.ether.references.chooseAndLink({ documentId, graphId: graph.id, nodeId: target.id, role: "general", storage });
      if (!result.cancelled) onStatus(`${storage === "embed" ? "Embedded" : "Linked"} reference ${result.referenceId}.`);
      await Promise.all([refresh(), onGraphUpdated()]);
    } catch (cause) {
      onStatus(cause instanceof Error ? cause.message : "The reference picker needs attention.");
    }
  };

  const importDropped = async (event: DragEvent<HTMLElement>) => {
    if (!target || event.dataTransfer.files.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    try {
      const files = [...event.dataTransfer.files];
      let imported = 0;
      for (const file of files) {
        const result = await window.ether.references.importDropped(file, {
          documentId,
          graphId: graph.id,
          nodeId: target.id,
          role: "general",
          storage: dropStorage
        });
        if (!result.cancelled) imported += 1;
      }
      onStatus(`${imported} dropped reference${imported === 1 ? "" : "s"} ${dropStorage === "embed" ? "embedded" : "linked"}.`);
      await Promise.all([refresh(), onGraphUpdated()]);
    } catch (cause) {
      onStatus(cause instanceof Error ? cause.message : "Dropped references could not be imported.");
    }
  };

  const assign = async (replace: boolean) => {
    if (!target || selection.size === 0) return;
    const members: ReferenceSetMember[] = [...selection].map(([referenceId, choice]) => ({
      kind: "linked-reference",
      referenceId,
      enabled: choice.enabled,
      ...(choice.roleOverride && choice.roleOverride !== "general" ? { roleOverride: choice.roleOverride as ConnectionRole } : {})
    }));
    try {
      await window.ether.application.command({
        kind: "command", id: crypto.randomUUID(), correlationId: crypto.randomUUID(), documentId,
        name: "reference.assignToSet", payload: { nodeId: target.id, members, replace }
      });
      onStatus(`${members.length} reference${members.length === 1 ? "" : "s"} ${replace ? "replaced the" : "added to the"} set.`);
      setCompareOpen(false);
      await Promise.all([refresh(), onGraphUpdated()]);
    } catch (cause) {
      onStatus(cause instanceof Error ? cause.message : "Reference assignment needs attention.");
    }
  };

  const recover = async (referenceId: string, action: ReferenceAction) => {
    try {
      await window.ether.references.act(documentId, referenceId, action);
      onStatus(action === "locate" ? "Reference relinked." : "Embedded preview activated.");
      await refresh();
    } catch (cause) {
      onStatus(cause instanceof Error ? cause.message : "Reference recovery needs attention.");
    }
  };

  const deduplicateSelection = () => {
    const seen = new Set<string>();
    const next = new Map<string, ReferenceSelection>();
    for (const reference of selectedReferences) {
      const fingerprint = `${reference.fingerprint.byteLength}:${reference.fingerprint.sampleSha256}`;
      if (seen.has(fingerprint)) continue;
      seen.add(fingerprint);
      next.set(reference.id, selection.get(reference.id)!);
    }
    const removed = selection.size - next.size;
    setSelection(next);
    setCompareOpen(false);
    onStatus(removed === 0 ? "No duplicate fingerprints in the selection." : `Removed ${removed} duplicate fingerprint${removed === 1 ? "" : "s"} from the selection.`);
  };

  const sendToBatchDimension = async () => {
    if (!batchTarget || selection.size === 0) return;
    const node = graph.nodes.find((candidate): candidate is BatchNode => candidate.id === batchTarget.nodeId && candidate.definitionId === "flow.batch");
    if (!node) return;
    const dimension = node.config.dimensions.find((candidate) => candidate.id === batchTarget.dimensionId);
    if (!dimension) return;
    const values = [...dimension.values];
    for (const reference of selectedReferences) if (!values.includes(reference.id)) values.push(reference.id);
    const nextConfig: FlowBatchConfig = {
      ...node.config,
      dimensions: node.config.dimensions.map((candidate) => candidate.id === dimension.id ? { ...candidate, values } : candidate)
    };
    try {
      const snapshot = await window.ether.application.query({
        kind: "query", id: crypto.randomUUID(), correlationId: crypto.randomUUID(), documentId,
        name: "graph.snapshot", payload: { graphId: graph.id }
      });
      if (snapshot.name !== "graph.snapshot") throw new Error("Ether returned an unexpected graph snapshot.");
      const operation: GraphOperation = { type: "updateNode", graphId: graph.id, nodeId: node.id, node: { ...node, config: nextConfig } };
      const response = await window.ether.application.command({
        kind: "command", id: crypto.randomUUID(), correlationId: crypto.randomUUID(), documentId,
        name: "graph.applyTransaction", payload: { transaction: {
          id: crypto.randomUUID(),
          baseDocumentRevisionId: snapshot.payload.documentRevisionId,
          baseGraphRevisions: { [graph.id]: snapshot.payload.graphRevisionId },
          title: "Send references to batch dimension",
          actor: "user",
          operations: [operation],
          layoutPolicy: "preserve"
        } }
      });
      if (response.name !== "graph.applyTransaction") throw new Error("Ether returned an unexpected graph update response.");
      onStatus(`${selectedReferences.length} reference${selectedReferences.length === 1 ? "" : "s"} sent to ${batchTarget.label}.`);
      await onGraphUpdated();
    } catch (cause) {
      onStatus(cause instanceof Error ? cause.message : "The Batch dimension could not be updated.");
    }
  };

  return (
    <section
      className="reference-desk"
      aria-label="Reference Desk"
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("Files")) {
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        }
      }}
      onDrop={(event) => void importDropped(event)}
    >
      <header>
        <div><span className="eyebrow">Sources</span><h2>Reference Desk</h2></div>
        <button type="button" title="Refresh references" onClick={() => void refresh()}><RefreshCcw size={15} aria-hidden="true" />Refresh</button>
      </header>
      <div className="reference-desk-actions">
        <label>Reference Set<select aria-label="Reference Set" value={target?.id ?? ""} onChange={(event) => setTargetId(event.target.value)}>{referenceSets.map((node) => <option key={node.id} value={node.id}>{node.title}</option>)}</select></label>
        <button type="button" disabled={!target} onClick={() => void choose("link")}><Link2 size={15} aria-hidden="true" />Link file</button>
        <button type="button" disabled={!target} onClick={() => void choose("embed")}><PackagePlus size={15} aria-hidden="true" />Embed copy</button>
        <label>Drop behavior<select aria-label="Dropped file storage" value={dropStorage} onChange={(event) => setDropStorage(event.target.value as "link" | "embed")}><option value="link">Link dropped files</option><option value="embed">Embed dropped files</option></select></label>
        <span className="reference-drop-hint"><Files size={14} aria-hidden="true" />Drop files anywhere in this desk</span>
      </div>
      <div className="reference-view-toolbar" aria-label="Reference views">
        {views.map(({ id, label, icon: Icon }) => <button key={id} type="button" aria-pressed={view === id} onClick={() => setView(id)}><Icon size={14} aria-hidden="true" />{label}</button>)}
        <button type="button" disabled={selection.size < 2} aria-pressed={compareOpen} onClick={() => setCompareOpen((current) => !current)}><ScanSearch size={14} aria-hidden="true" />Compare selected</button>
        <button type="button" disabled={selection.size < 2} onClick={deduplicateSelection}>Deduplicate selection</button>
      </div>
      {!target ? <p className="reference-empty">Add a Reference Set node to organize source material.</p> : null}
      {compareOpen && selectedReferences.length >= 2 ? <ReferenceComparison references={selectedReferences.slice(0, 2)} /> : null}
      {loading ? <p>Loading references…</p> : error ? <p role="alert">{error}</p> : references.length === 0 ? <p className="reference-empty">No references yet. Link a file to keep it external, embed a portable copy, or drop files here.</p> : <ReferenceGrid references={references} selection={selection} view={view} onSelectionChange={setSelection} onRecover={(referenceId, action) => void recover(referenceId, action)} />}
      <footer>
        <span>{selection.size} selected · {savedMembers.length} saved in set · {references.length} total</span>
        <div className="reference-batch-send">
          <select aria-label="Batch dimension" value={batchTarget?.key ?? ""} disabled={batchTargets.length === 0} onChange={(event) => setBatchTargetKey(event.target.value)}>{batchTargets.map((candidate) => <option key={candidate.key} value={candidate.key}>{candidate.label}</option>)}</select>
          <button type="button" disabled={!batchTarget || selection.size === 0} onClick={() => void sendToBatchDimension()}>Send to Batch</button>
        </div>
        <div><button type="button" disabled={!target || selection.size === 0} onClick={() => void assign(false)}>Add to set</button><button type="button" disabled={!target || selection.size === 0} onClick={() => void assign(true)}>Replace set</button></div>
      </footer>
    </section>
  );
}

function ReferenceComparison({ references }: { references: ReferenceDeskItem[] }) {
  return <section className="reference-comparison" aria-label="Reference comparison">{references.map((reference) => <article key={reference.id}><strong>{reference.displayName}</strong><span>{reference.mediaType}</span><span>{reference.state}</span><code>{reference.fingerprint.sampleSha256.slice(0, 12)}</code></article>)}</section>;
}
