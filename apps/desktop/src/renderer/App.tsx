import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useRef, useState } from "react";
import { ImagePlus, Plus, RefreshCcw, Sparkles, Unlink } from "lucide-react";
import type { EtherGraph } from "@ether/schema";

import type {
  DesktopReference,
  DocumentCommandResult,
  DocumentDescriptor,
  ReferenceAction
} from "../shared/ipc/contracts";
import { ProjectHeader } from "./project/ProjectHeader";
import { StartScreen } from "./project/StartScreen";
import { useProjectHealth } from "./project/useProjectHealth";
import { useProjectSession } from "./project/useProjectSession";
import { EtherShell } from "./shell/EtherShell";
import { EtherCanvas, type EtherCanvasHandle } from "./canvas/EtherCanvas";
import { InspectorPanel } from "./canvas/InspectorPanel";
import type { InspectorContext } from "./canvas/inspector/types";

export function App() {
  const { state, document } = useProjectSession();
  const [graph, setGraph] = useState<EtherGraph | null>(null);
  const [message, setMessage] = useState("Preparing an untitled document...");
  const [references, setReferences] = useState<DesktopReference[]>([]);
  const [artifactRevision, setArtifactRevision] = useState(0);
  const [inspectorContext, setInspectorContext] = useState<InspectorContext | null>(null);
  const canvasRef = useRef<EtherCanvasHandle>(null);
  const health = useProjectHealth(references);

  const loadGraph = useCallback(async (active: DocumentDescriptor) => {
    const result = await window.ether.graph.snapshot(active.documentId);
    setGraph(result.graph);
    setReferences(await window.ether.references.list(active.documentId));
    setMessage((current) => current === "Preparing an untitled document..." ? "" : current);
  }, []);

  useEffect(() => {
    if (document === null) return;
    void loadGraph(document).catch((error) => {
      setMessage(error instanceof Error ? error.message : "The graph needs attention.");
    });
  }, [document, loadGraph]);

  useEffect(() => {
    if (state.commandResult !== null) setMessage(formatDocumentCommandResult(state.commandResult));
  }, [state.commandResult]);

  const runDocumentCommand = async (command: (id: string) => Promise<unknown>) => {
    if (document === null) return;
    try {
      await command(document.documentId);
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The document command failed.");
    }
  };


  const actOnReference = async (referenceId: string, action: ReferenceAction) => {
    if (document === null) return;
    try {
      setReferences(await window.ether.references.act(document.documentId, referenceId, action));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Reference recovery failed.");
    }
  };

  const simulate = async () => {
    if (document === null || document.mode === "read-only" || !document.simulationEnabled) return;
    try {
      setMessage("Running simulation output...");
      await window.ether.artifacts.generateFake(document.documentId);
      setArtifactRevision((value) => value + 1);
      setMessage("Simulation artifact embedded in this document");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Simulation failed.");
    }
  };

  const compact = async (documentId: string) => {
    try {
      const result = await window.ether.document.compact(documentId);
      setMessage(formatDocumentCommandResult({ kind: "compact", ...result }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The document could not be compacted.");
    }
  };

  const makePortable = async (documentId: string) => {
    try {
      const result = await window.ether.document.makePortable(documentId);
      setMessage(formatDocumentCommandResult({ kind: "portable", ...result }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The document could not be made portable.");
    }
  };

  if (document === null) {
    return (
      <StartScreen
        message={state.error ?? message}
        onNew={() => void window.ether.document.new()}
        onOpen={() => void window.ether.document.open()}
      />
    );
  }

  return (
    <EtherShell
      documentId={document.documentId}
      references={references}
      artifactRevision={artifactRevision}
      onDragOver={(event) => {
        if ([...event.dataTransfer.files].some((file) => file.name.toLocaleLowerCase().endsWith(".ether"))) {
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        }
      }}
      onDrop={(event) => {
        const file = [...event.dataTransfer.files].find(
          (candidate) => candidate.name.toLocaleLowerCase().endsWith(".ether")
        );
        if (file !== undefined) {
          event.preventDefault();
          void window.ether.document.openDropped(file).catch((error) => {
            setMessage(error instanceof Error ? error.message : "The dropped document could not be opened.");
          });
        }
      }}
      header={(artifactsVisible, toggleArtifacts) => (
        <ProjectHeader
          document={{ ...document, saveState: state.saveState }}
          artifactsOpen={artifactsVisible}
          onNew={() => void window.ether.document.new()}
          onOpen={() => void window.ether.document.open()}
          onSave={() => void runDocumentCommand((id) => window.ether.document.save(id))}
          onSaveAs={() => void runDocumentCommand((id) => window.ether.document.saveAs(id))}
          onSaveCopy={() => void runDocumentCommand((id) => window.ether.document.saveCopy(id))}
          onCompact={() => void compact(document.documentId)}
          onMakePortable={() => void makePortable(document.documentId)}
          onToggleArtifacts={toggleArtifacts}
        />
      )}
      tools={(
        <aside className="document-tool-rail" aria-label="Graph tools">
          <button type="button" title="Add Prompt node" onClick={() => canvasRef.current?.addPrompt()} disabled={document.mode === "read-only"}>
            <Plus size={16} aria-hidden="true" />Prompt
          </button>
          <button type="button" title="Add Image Generator node" onClick={() => canvasRef.current?.addImage()} disabled={document.mode === "read-only"}>
            <ImagePlus size={16} aria-hidden="true" />Image
          </button>
          {document.simulationEnabled ? (
            <button type="button" title="Create diagnostic simulation output" onClick={() => void simulate()} disabled={document.mode === "read-only"}>
              <Sparkles size={16} aria-hidden="true" />Simulation output
            </button>
          ) : null}
          <button type="button" title="Reload graph" onClick={() => void loadGraph(document)}>
            <RefreshCcw size={16} aria-hidden="true" />Refresh
          </button>
        </aside>
      )}
      canvas={<EtherCanvas ref={canvasRef} graph={graph} document={document} onGraph={setGraph} onStatus={setMessage} onInspectorChange={setInspectorContext} />}
      inspector={<InspectorPanel context={inspectorContext} />}
      status={(
        <footer className={`document-status state-${state.saveState}`} aria-live="polite">
          <span>{state.error ?? (message || (state.saveState === "saved" ? "All changes are saved" : "Saving changes"))}</span>
          <small>{document.mode === "read-only" ? "Read-only" : "Local document"}</small>
        </footer>
      )}
    >
      {health.missing.length > 0 ? (
        <section className="missing-reference-strip" aria-label="Missing references">
          {health.missing.map((reference) => (
            <div key={reference.id}>
              <Unlink size={15} aria-hidden="true" />
              <strong>{reference.displayName}</strong>
              {referenceActions.filter(([action]) => reference.actions.includes(action)).map(([action, label]) => (
                <button key={action} type="button" onClick={() => void actOnReference(reference.id, action)}>{label}</button>
              ))}
            </div>
          ))}
        </section>
      ) : null}
    </EtherShell>
  );
}
const referenceActions = [
  ["locate", "Locate"],
  ["search-folder", "Search Folder"],
  ["relink-all", "Relink All"],
  ["use-embedded-preview", "Use Embedded Preview"],
  ["embed-available-copy", "Embed Available Copy"],
  ["remove", "Remove"]
] as const;

function formatBytes(byteLength: number): string {
  if (byteLength < 1024) return `${byteLength} B`;
  if (byteLength < 1024 * 1024) return `${(byteLength / 1024).toFixed(1)} KB`;
  return `${(byteLength / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDocumentCommandResult(result: DocumentCommandResult): string {
  if (result.kind === "compact") {
    const reclaimed = Math.max(0, result.beforeBytes - result.afterBytes);
    return `Compacted document: ${formatBytes(result.beforeBytes)} before, ${formatBytes(result.afterBytes)} after; ` +
      `reclaimed ${formatBytes(reclaimed)}`;
  }
  if (result.cancelled) return "Make Portable cancelled; the document was not changed";
  const missing = result.missingReferences.length === 0
    ? "no missing references"
    : `missing ${result.missingReferences.map((reference) => reference.displayName).join(", ")}`;
  return `Made portable: embedded ${result.embeddedCount} reference${result.embeddedCount === 1 ? "" : "s"} ` +
    `(${formatBytes(result.embeddedBytes)}); ${missing}`;
}
