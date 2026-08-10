import { useEffect, useState } from "react";
import { Download, FolderOpen, X } from "lucide-react";
import type { ApplicationCommand, ExportRecord } from "@ether/schema";

export function ExportDialog({ documentId, selectedIds, loadedIds, total, open, onClose, onStatus }: {
  documentId: string; selectedIds: readonly string[]; loadedIds: readonly string[]; total: number; open: boolean;
  onClose(): void; onStatus(message: string): void;
}) {
  const [scope, setScope] = useState<"selection" | "loaded">(selectedIds.length ? "selection" : "loaded");
  const [destination, setDestination] = useState<{ grantId: string; displayName: string } | null>(null);
  const [template, setTemplate] = useState("{collection}/{title}-{artifactId}");
  const [format, setFormat] = useState<"original" | "png" | "jpeg" | "webp">("original");
  const [hierarchy, setHierarchy] = useState<"flat" | "collection">("collection");
  const [collisionPolicy, setCollisionPolicy] = useState<"rename" | "skip" | "error">("rename");
  const [metadata, setMetadata] = useState(true);
  const [lineage, setLineage] = useState(true);
  const [busy, setBusy] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [records, setRecords] = useState<ExportRecord[] | null>(null);
  useEffect(() => {
    if (!open) return;
    setScope(selectedIds.length ? "selection" : "loaded");
    setRecords(null);
  }, [open, selectedIds.length]);
  if (!open) return null;
  const ids = scope === "selection" ? selectedIds : loadedIds;

  const chooseDestination = async () => {
    setChoosing(true);
    try {
      const grant = await window.ether.permissions.grantFolder(documentId, "export");
      if (grant) setDestination(grant);
    } catch (cause) {
      onStatus(cause instanceof Error ? cause.message : "The export folder could not be selected.");
    } finally {
      setChoosing(false);
    }
  };
  const runExport = async () => {
    if (!destination || ids.length === 0) return;
    setBusy(true);
    try {
      const command: ApplicationCommand = { kind: "command", id: crypto.randomUUID(), correlationId: crypto.randomUUID(), documentId, name: "artifact.export", payload: { artifactIds: [...ids], pathGrantId: destination.grantId, namingTemplate: template, collisionPolicy, format, hierarchy, includeMetadataSidecar: metadata, includeLineageReport: lineage } };
      const response = await window.ether.application.command(command);
      if (response.name !== "artifact.export") throw new Error("Ether returned an unexpected export response.");
      setRecords(response.payload.records);
      onStatus(`Export prepared for ${response.payload.records.length} artifact${response.payload.records.length === 1 ? "" : "s"}.`);
    } catch (cause) { onStatus(cause instanceof Error ? cause.message : "Export needs attention."); }
    finally { setBusy(false); }
  };
  const verified = records?.filter((record) => record.status === "committed" || record.status === "verified").length ?? 0;

  return <div className="review-dialog-backdrop" role="presentation"><section className="review-dialog export-dialog" role="dialog" aria-modal="true" aria-busy={busy || choosing} aria-labelledby="export-dialog-title">
    <header><div><span className="eyebrow">Portable delivery</span><h2 id="export-dialog-title"><Download size={18} /> Export artifacts</h2></div><button type="button" aria-label="Close export" onClick={onClose}><X size={18} /></button></header>
    <fieldset><legend>Scope</legend><label><input type="radio" checked={scope === "selection"} onChange={() => setScope("selection")} disabled={!selectedIds.length} />Selection ({selectedIds.length})</label><label><input type="radio" checked={scope === "loaded"} onChange={() => setScope("loaded")} />Loaded results ({loadedIds.length} of {total})</label></fieldset>
    {loadedIds.length < total && scope === "loaded" ? <p className="review-callout">This exports the loaded page set. Load all results before exporting the full search.</p> : null}
    <label>Destination<button type="button" className="destination-picker" aria-label="Destination" disabled={busy || choosing} onClick={() => void chooseDestination()}><FolderOpen size={15} />{choosing ? "Choosing folder…" : destination?.displayName ?? "Choose folder…"}</button></label>
    <label>Naming template<input value={template} onChange={(event) => setTemplate(event.target.value)} /><small>Use {'{collection}'}, {'{title}'}, or {'{artifactId}'}; folders stay nested and safe.</small></label>
    <div className="review-form-grid"><label>Format<select value={format} onChange={(event) => setFormat(event.target.value as typeof format)}><option value="original">Original</option><option value="png">PNG</option><option value="jpeg">JPEG</option><option value="webp">WebP</option></select></label><label>Hierarchy<select value={hierarchy} onChange={(event) => setHierarchy(event.target.value as typeof hierarchy)}><option value="collection">Collection folders</option><option value="flat">Flat folder</option></select></label></div>
    <label>Existing files<select value={collisionPolicy} onChange={(event) => setCollisionPolicy(event.target.value as typeof collisionPolicy)}><option value="rename">Rename safely (never overwrite)</option><option value="skip">Skip existing</option><option value="error">Stop with error</option></select></label>
    <div className="review-checks"><label><input type="checkbox" checked={metadata} onChange={(event) => setMetadata(event.target.checked)} />Metadata sidecars</label><label><input type="checkbox" checked={lineage} onChange={(event) => setLineage(event.target.checked)} />Lineage report</label></div>
    {records ? <section className="export-verification" aria-label="Export verification" data-testid="export-verification"><h3>Files written and verified</h3><p role="status">{verified} of {records.length} export bundle{records.length === 1 ? "" : "s"} verified in {destination?.displayName ?? "the selected folder"}.</p><ul>{records.map((record) => <li key={record.id}><code title={record.relativePath}>{record.relativePath}</code><span>{exportStatusLabel(record.status)}</span></li>)}</ul></section> : null}
    <footer><p>{records ? `${verified}/${records.length} verified` : `${ids.length} artifact${ids.length === 1 ? "" : "s"} ready`}</p><div className="export-dialog-actions"><button type="button" disabled={busy || choosing || !destination || ids.length === 0 || !template.trim()} onClick={() => void runExport()}>{busy ? "Preparing…" : records ? "Export again" : "Export"}</button>{records ? <button type="button" onClick={onClose}>Done</button> : null}</div></footer>
  </section></div>;
}

function exportStatusLabel(status: ExportRecord["status"]): string {
  switch (status) {
    case "committed":
    case "verified": return "Written and verified";
    case "skipped": return "Skipped existing file";
    case "failed": return "Failed";
    default: return status;
  }
}
