import {
  ArchiveRestore,
  Copy,
  FilePlus2,
  FolderOpen,
  HeartPulse,
  History,
  Images,
  PackageCheck,
  Save,
  SaveAll,
  Settings2,
  Wrench
} from "lucide-react";
import type { ReactNode, RefObject } from "react";

import type { DocumentDescriptor } from "../../shared/ipc/contracts";
import etherLogo from "../../../../../packages/brand/src/assets/Ether_logo.png";

export function ProjectHeader({
  document,
  artifactsOpen,
  onNew,
  onOpen,
  onSave,
  onSaveAs,
  onSaveCopy,
  onCompact,
  onMakePortable,
  onRepair,
  onToggleArtifacts,
  onProviderHealth,
  onSettings,
  historyOpen,
  historyButtonRef,
  onHistory
}: {
  document: DocumentDescriptor;
  artifactsOpen: boolean;
  onNew(): void;
  onOpen(): void;
  onSave(): void;
  onSaveAs(): void;
  onSaveCopy(): void;
  onCompact(): void;
  onMakePortable(): void;
  onRepair(): void;
  onToggleArtifacts(): void;
  onProviderHealth(): void;
  onSettings(): void;
  historyOpen: boolean;
  historyButtonRef: RefObject<HTMLButtonElement | null>;
  onHistory(): void;
}) {
  return (
    <header className="project-header task-nine-header" data-testid="project-header">
      <div className="project-header-brand">
        <img src={etherLogo} alt="Ether" className="ether-logo compact-logo" />
        <div>
          <p>ETHER <span>by DreamBay</span></p>
          <h1>{document.displayName}</h1>
        </div>
      </div>
      <div className={`document-save-state state-${document.saveState}`} aria-live="polite">
        <i aria-hidden="true" />
        <span>{saveStateLabel(document.saveState)}</span>
        {document.mode === "read-only" ? <em>Read-only: {readOnlyLabel(document.readOnlyReason)}</em> : null}
      </div>
      <nav className="project-header-actions" aria-label="Document commands">
        <IconCommand label="New document" icon={<FilePlus2 size={16} />} onClick={onNew} />
        <IconCommand label="Open document" icon={<FolderOpen size={16} />} onClick={onOpen} />
        <IconCommand label="Save" icon={<Save size={16} />} onClick={onSave} disabled={!document.commands.save} />
        <IconCommand label="Save as" icon={<SaveAll size={16} />} onClick={onSaveAs} disabled={!document.commands.saveAs} />
        <IconCommand label="Save a copy" icon={<Copy size={16} />} onClick={onSaveCopy} disabled={!document.commands.saveCopy} />
        <IconCommand label="Compact document" icon={<ArchiveRestore size={16} />} onClick={onCompact} disabled={!document.commands.compact} />
        <IconCommand label="Make document portable" icon={<PackageCheck size={16} />} onClick={onMakePortable} disabled={!document.commands.makePortable} />
        <IconCommand label="Repair damaged document" icon={<Wrench size={16} />} onClick={onRepair} />
        <button ref={historyButtonRef} type="button" title="Document History" aria-label="Document History" aria-haspopup="dialog" aria-expanded={historyOpen} onClick={onHistory}>
          <History size={16} aria-hidden="true" />
        </button>
        <button type="button" className={artifactsOpen ? "is-active" : ""} onClick={onToggleArtifacts} aria-pressed={artifactsOpen}>
          <Images size={16} aria-hidden="true" />
          Artifacts
        </button>
        <IconCommand label="Provider Health" icon={<HeartPulse size={16} />} onClick={onProviderHealth} />
        <IconCommand label="Settings" icon={<Settings2 size={16} />} onClick={onSettings} />
      </nav>
    </header>
  );
}

function IconCommand({
  label,
  icon,
  onClick,
  disabled = false
}: {
  label: string;
  icon: ReactNode;
  onClick(): void;
  disabled?: boolean;
}) {
  return (
    <button type="button" title={label} aria-label={label} onClick={onClick} disabled={disabled}>
      {icon}
    </button>
  );
}

function saveStateLabel(state: DocumentDescriptor["saveState"]) {
  if (state === "needs-attention") return "Needs attention";
  return state === "saving" ? "Saving" : "Saved";
}

function readOnlyLabel(reason: DocumentDescriptor["readOnlyReason"]) {
  if (reason === "location-unsupported") {
    return "this location cannot guarantee safe writes; save a copy to a local fixed drive";
  }
  if (reason === "writer-active") {
    return "another Ether window is editing this document; close it there, then reopen";
  }
  if (reason === "sqlite-busy") {
    return "the document database is busy; close the app using it, then reopen";
  }
  if (reason === "heartbeat-failed") return "Ether lost safe write access; save a copy, then reopen";
  if (reason === "recovery-attention") {
    return "recovery evidence does not match this file; keep the file and recovery data for repair";
  }
  if (reason === "requested") return "this document was explicitly opened read-only; reopen it with write access";
  return "write access is unavailable; save a copy before closing";
}
