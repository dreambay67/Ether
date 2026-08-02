import { useEffect, useId, useRef, type KeyboardEvent } from "react";
import { FilePlus2, FolderOpen, Wrench } from "lucide-react";
import type { RepairReport, RepairResult } from "../../shared/ipc/contracts";
import etherLogo from "../../../../../packages/brand/src/assets/Ether_logo.png";

export function StartScreen({ message, repair, onNew, onOpen, onRepair, onCloseRepair }: {
  message: string;
  repair: RepairResult | null;
  onNew(): void;
  onOpen(): void;
  onRepair(allowLossy?: boolean): void;
  onCloseRepair(): void;
}) {
  return (
    <section className="start-screen task-nine-start" data-testid="start-screen">
      <img src={etherLogo} alt="Ether" />
      <h1>ETHER</h1>
      <p>{message}</p>
      <div>
        <button type="button" onClick={onNew}><FilePlus2 size={17} />New document</button>
        <button type="button" onClick={onOpen}><FolderOpen size={17} />Open document</button>
        <button type="button" onClick={() => onRepair()}><Wrench size={17} />Repair damaged document</button>
      </div>
      {repair === null || repair.kind === "cancelled" ? null : (
        <DocumentRepairDialog repair={repair} onConfirm={() => onRepair(true)} onClose={onCloseRepair} />
      )}
    </section>
  );
}

export function DocumentRepairDialog({ repair, onConfirm, onClose }: {
  repair: Exclude<RepairResult, { kind: "cancelled" }>;
  onConfirm(): void;
  onClose(): void;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const priorFocus = useRef<HTMLElement | null>(null);
  const closeRef = useRef(onClose);
  const titleId = useId();
  const summaryId = useId();
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => {
    priorFocus.current = globalThis.document.activeElement instanceof HTMLElement ? globalThis.document.activeElement : null;
    dialogRef.current?.querySelector<HTMLElement>("button:not([disabled])")?.focus();
    const closeOnEscape = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape") closeRef.current(); };
    globalThis.addEventListener("keydown", closeOnEscape);
    return () => { globalThis.removeEventListener("keydown", closeOnEscape); priorFocus.current?.focus(); };
  }, []);
  const keepFocus = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Tab") return;
    const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>("button:not([disabled]), [href], [tabindex]:not([tabindex='-1'])") ?? [])];
    if (focusable.length === 0) return;
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (event.shiftKey && globalThis.document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && globalThis.document.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  const media = repair.report.losses.filter((loss) => loss.type === "artifact" || loss.type === "blob");
  const graph = repair.report.losses.filter((loss) => loss.type === "graph");
  const other = repair.report.losses.filter((loss) => !media.includes(loss) && !graph.includes(loss));
  const completed = repair.kind === "completed";
  return (
    <div className="document-repair-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={dialogRef} className="document-repair-report" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={summaryId} onKeyDown={keepFocus}>
      <h2 id={titleId}>{completed ? "Repair report" : "Review repair losses"}</h2>
      <p id={summaryId}>
        {completed
          ? "Ether created a new repaired document. The damaged source was left unchanged."
          : "No repaired file has been created. Creating a partial copy requires your explicit confirmation."}
      </p>
      <dl>
        <div><dt>Recovered graph records</dt><dd>{repair.report.recovered.graphs}</dd></div>
        <div><dt>Recovered media and blobs</dt><dd>{repair.report.recovered.artifacts} artifacts, {repair.report.recovered.blobs} blobs</dd></div>
      </dl>
      <LossGroup title="Media and artifact losses" losses={media} empty="No affected media or embedded blobs were found." />
      <LossGroup title="Graph losses" losses={graph} empty="No graph records were omitted." />
      {other.length > 0 ? <LossGroup title="Other recovery notes" losses={other} empty="" /> : null}
      <div className="document-repair-actions">
        {!completed ? <button type="button" autoFocus onClick={onConfirm}>Create partial repaired copy</button> : null}
        <button type="button" onClick={onClose}>{completed ? "Close report" : "Cancel repair"}</button>
      </div>
    </section>
    </div>
  );
}

function LossGroup({ title, losses, empty }: { title: string; losses: RepairReport["losses"]; empty: string }) {
  return (
    <section className="document-repair-loss-group" aria-label={title}>
      <h3>{title}</h3>
      {losses.length === 0 ? <p>{empty}</p> : <ul>{losses.map((loss) => <li key={`${loss.type}:${loss.entityId}`}>{loss.reason}</li>)}</ul>}
    </section>
  );
}
