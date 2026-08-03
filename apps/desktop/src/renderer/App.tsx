import "@xyflow/react/dist/style.css";
import { lazy, Suspense, useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { RefreshCcw, Sparkles, Unlink, Workflow, X } from "lucide-react";
import type { ApplicationCommand, ApplicationQuery, EtherGraph, GraphTransaction, NodeLibraryItem, RecipeManifest } from "@ether/schema";

import type {
  DesktopReference,
  DocumentCommandResult,
  DocumentDescriptor,
  RepairResult,
  ReferenceAction
} from "../shared/ipc/contracts";
import { ProjectHeader } from "./project/ProjectHeader";
import { DocumentHistoryDialog } from "./project/DocumentHistoryDialog";
import { shouldSaveDocumentFromShortcut } from "./project/documentShortcuts";
import { ProviderStatusPanel } from "./project/ProviderStatusPanel";
import {
  defaultInterfacePreferences,
  normalizeInterfacePreferences,
  SettingsPanel
} from "./project/SettingsPanel";
import { DocumentRepairDialog, StartScreen } from "./project/StartScreen";
import { useDesktopSettings } from "./project/useDesktopSettings";
import { useProjectHealth } from "./project/useProjectHealth";
import { useProjectSession } from "./project/useProjectSession";
import { EtherShell } from "./shell/EtherShell";
import { EtherCanvas, type EtherCanvasHandle } from "./canvas/EtherCanvas";
import { InspectorPanel } from "./canvas/InspectorPanel";
import { NodeLibrary } from "./canvas/library/NodeLibrary";
import type { InspectorContext } from "./canvas/inspector/types";
import { ReferenceDesk } from "./references/ReferenceDesk";
import type { RecipeSetup, RecipeSetupRequest } from "./canvas/library/TemplateGallery";
import { markPerformance, measurePerformance } from "./performance/marks";
import { notifyRendererInteractive } from "./runtime/interactive";

const BatchMatrix = lazy(async () => ({ default: (await import("./batches/BatchMatrix")).BatchMatrix }));
const JobCenter = lazy(async () => ({ default: (await import("./jobs/JobCenter")).JobCenter }));
const TemplateGallery = lazy(async () => ({ default: (await import("./canvas/library/TemplateGallery")).TemplateGallery }));

export function App() {
  const { state, document } = useProjectSession();
  const [graph, setGraph] = useState<EtherGraph | null>(null);
  const [message, setMessage] = useState("Preparing an untitled document...");
  const [repair, setRepair] = useState<RepairResult | null>(null);
  const [references, setReferences] = useState<DesktopReference[]>([]);
  const [artifactRevision, setArtifactRevision] = useState(0);
  const [inspectorContext, setInspectorContext] = useState<InspectorContext | null>(null);
  const [nodeCatalog, setNodeCatalog] = useState<readonly NodeLibraryItem[]>([]);
  const [nodeCatalogError, setNodeCatalogError] = useState<string | null>(null);
  const [recipesOpen, setRecipesOpen] = useState(false);
  const [recipes, setRecipes] = useState<readonly RecipeManifest[]>([]);
  const [recipeCatalogError, setRecipeCatalogError] = useState<string | null>(null);
  const [providerHealthOpen, setProviderHealthOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [interfacePreferences, setInterfacePreferences] = useDesktopSettings(
    "ether.desktop.interface.v1",
    defaultInterfacePreferences,
    normalizeInterfacePreferences
  );
  const canvasRef = useRef<EtherCanvasHandle>(null);
  const recipesButtonRef = useRef<HTMLButtonElement>(null);
  const recipesDialogRef = useRef<HTMLElement>(null);
  const historyButtonRef = useRef<HTMLButtonElement>(null);
  const health = useProjectHealth(references);
  const actionableMissing = health.missing.filter((reference) => reference.actions.length > 0);
  const applicationAvailable = typeof window.ether.application?.onEvent === "function";
  const graphReady = document !== null && graph !== null && graph.id === document.graphId;
  const closeRecipes = useCallback(() => {
    setRecipesOpen(false);
    globalThis.requestAnimationFrame(() => recipesButtonRef.current?.focus());
  }, []);
  const closeHistory = useCallback(() => {
    setHistoryOpen(false);
    globalThis.requestAnimationFrame(() => historyButtonRef.current?.focus());
  }, []);
  const keepRecipeFocus = useCallback((event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== "Tab") return;
    const focusable = [...(recipesDialogRef.current?.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex='-1'])") ?? [])];
    if (focusable.length === 0) return;
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (event.shiftKey && globalThis.document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && globalThis.document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }, []);

  useEffect(() => {
    globalThis.document.documentElement.dataset.density = interfacePreferences.density;
    globalThis.document.documentElement.dataset.motion = interfacePreferences.motion;
  }, [interfacePreferences]);

  const loadGraph = useCallback(async (active: DocumentDescriptor) => {
    markPerformance("document-open:start");
    markPerformance("graph-hydration:start");
    const result = await window.ether.graph.snapshot(active.documentId);
    setGraph(result.graph);
    setReferences(await window.ether.references.list(active.documentId));
    setMessage((current) => current === "Preparing an untitled document..." ? "" : current);
  }, []);

  useEffect(() => {
    if (graph === null) return;
    markPerformance("document-open:interactive");
    measurePerformance("document-open:interactive", "document-open:start", "document-open:interactive");
    markPerformance("cold-start:interactive");
    measurePerformance("cold-start:interactive", "cold-start:start", "cold-start:interactive");
  }, [graph]);

  useEffect(() => {
    if (document === null) {
      notifyRendererInteractive();
      return;
    }
    void loadGraph(document).catch((error) => {
      setMessage(error instanceof Error ? error.message : "The graph needs attention.");
      notifyRendererInteractive();
    });
  }, [document, loadGraph]);

  useEffect(() => {
    if (!recipesOpen || !applicationAvailable) return;
    let current = true;
    setRecipeCatalogError(null);
    const query: ApplicationQuery = {
      kind: "query", id: crypto.randomUUID(), correlationId: crypto.randomUUID(), name: "recipe.catalog", payload: {}
    };
    void window.ether.application.query(query).then((response) => {
      if (current) setRecipes((response.payload as { recipes: RecipeManifest[] }).recipes);
    }).catch((error) => {
      if (current) setRecipeCatalogError(error instanceof Error ? error.message : "Recipe catalog unavailable.");
    });
    return () => { current = false; };
  }, [applicationAvailable, recipesOpen]);

  useEffect(() => {
    if (!applicationAvailable) {
      setNodeCatalogError("The canonical node catalog is unavailable in this compatibility session.");
      return;
    }
    let current = true;
    const query: ApplicationQuery = {
      kind: "query", id: crypto.randomUUID(), correlationId: crypto.randomUUID(), name: "node.catalog", payload: {}
    };
    void window.ether.application.query(query).then((response) => {
      if (!current || response.name !== "node.catalog") return;
      setNodeCatalog(response.payload.nodes);
      setNodeCatalogError(null);
    }).catch((error) => {
      if (current) setNodeCatalogError(error instanceof Error ? error.message : "The canonical node catalog could not be loaded.");
    });
    return () => { current = false; };
  }, [applicationAvailable]);

  useEffect(() => {
    if (!recipesOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeRecipes();
    };
    globalThis.addEventListener("keydown", closeOnEscape);
    return () => globalThis.removeEventListener("keydown", closeOnEscape);
  }, [closeRecipes, recipesOpen]);

  useEffect(() => {
    if (state.commandResult !== null) setMessage(formatDocumentCommandResult(state.commandResult));
  }, [state.commandResult]);

  useEffect(() => {
    if (document === null) return;
    const application = window.ether.application;
    if (typeof application?.onEvent !== "function") return;
    return application.onEvent((event) => {
      if (event.name === "reference.setMembershipChanged" && event.documentId === document.documentId) {
        void loadGraph(document);
      }
    });
  }, [document, loadGraph]);

  const runDocumentCommand = useCallback(async (command: (id: string) => Promise<unknown>) => {
    if (document === null) return;
    try {
      await command(document.documentId);
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The document command failed.");
    }
  }, [document]);

  useEffect(() => {
    const saveWithKeyboard = (event: KeyboardEvent) => {
      if (!shouldSaveDocumentFromShortcut(event, event.target)) return;
      event.preventDefault();
      void runDocumentCommand((id) => window.ether.document.save(id));
    };
    globalThis.addEventListener("keydown", saveWithKeyboard);
    return () => globalThis.removeEventListener("keydown", saveWithKeyboard);
  }, [runDocumentCommand]);


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

  const runRepair = async (allowLossy = false, confirmationId?: string) => {
    try {
      const result = await window.ether.document.repair(allowLossy, confirmationId);
      setRepair(result.kind === "cancelled" ? null : result);
      if (result.kind === "cancelled") setMessage("Repair cancelled.");
    } catch (error) {
      setRepair(null);
      setMessage(error instanceof Error ? error.message : "The document could not be repaired.");
    }
  };
  const closeRepair = () => {
    setRepair(null);
    void window.ether.document.cancelRepair().catch(() => undefined);
  };

  const makePortable = async (documentId: string) => {
    try {
      const result = await window.ether.document.makePortable(documentId);
      setMessage(formatDocumentCommandResult({ kind: "portable", ...result }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The document could not be made portable.");
    }
  };

  const loadRecipeSetup = async (recipeId: string, version: string): Promise<RecipeSetup> => {
    const response = await window.ether.application.query({
      kind: "query", id: crypto.randomUUID(), correlationId: crypto.randomUUID(), name: "recipe.setupSchema", payload: { recipeId, version }
    } as ApplicationQuery);
    return response.payload as RecipeSetup;
  };

  const previewRecipe = async (request: RecipeSetupRequest): Promise<{ transaction: GraphTransaction; warnings: readonly string[] }> => {
    if (document === null) throw new Error("Open a document before previewing a recipe.");
    const response = await window.ether.application.command({
      kind: "command", id: crypto.randomUUID(), correlationId: crypto.randomUUID(), name: "recipe.preview",
      documentId: document.documentId, payload: request
    } as ApplicationCommand);
    return response.payload as { transaction: GraphTransaction; warnings: string[] };
  };

  const instantiateRecipe = async (request: RecipeSetupRequest): Promise<void> => {
    if (document === null || graph === null) throw new Error("The active graph is not ready for recipe insertion.");
    const preview = await previewRecipe(request);
    const manifest = recipes.find((recipe) => recipe.id === request.recipeId && recipe.version === request.version);
    const focusRef = manifest?.layout.focusNodeRef ?? null;
    const focusOperation = focusRef === null ? undefined : preview.transaction.operations.find((operation) =>
      operation.type === "addNode" && operation.node.id.endsWith(`-${focusRef}`));
    const focusNodeId = focusOperation?.type === "addNode" ? focusOperation.node.id : null;
    await window.ether.application.command({
      kind: "command", id: crypto.randomUUID(), correlationId: crypto.randomUUID(), name: "recipe.instantiate",
      documentId: document.documentId,
      payload: { recipeId: request.recipeId, version: request.version, targetGraphId: graph.id, parameters: request.parameters }
    } as ApplicationCommand);
    await loadGraph(document);
    if (focusNodeId !== null) window.setTimeout(() => canvasRef.current?.focusNode(focusNodeId), 0);
  };

  if (document === null) {
    return (
      <StartScreen
        message={state.error ?? message}
        repair={repair}
        onNew={() => void window.ether.document.new()}
        onOpen={() => void window.ether.document.open()}
        onRepair={(allowLossy) => void runRepair(allowLossy, repair?.kind === "needs-confirmation" ? repair.confirmationId : undefined)}
        onCloseRepair={closeRepair}
      />
    );
  }

  return (
    <>
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
          void window.ether.document.openDropped(file, document.documentId).catch((error) => {
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
          onRepair={() => void runRepair()}
          onToggleArtifacts={toggleArtifacts}
          onProviderHealth={() => setProviderHealthOpen(true)}
          onSettings={() => setSettingsOpen(true)}
          historyOpen={historyOpen}
          historyButtonRef={historyButtonRef}
          onHistory={() => setHistoryOpen(true)}
        />
      )}
      tools={(
        <div className="document-tool-rail" aria-label="Graph tools">
          <NodeLibrary
            catalog={nodeCatalog}
            error={!graphReady ? "Loading the document canvas..." : nodeCatalogError}
            readOnly={document.mode === "read-only" || !graphReady || nodeCatalog.length === 0}
            onAdd={(definitionId) => canvasRef.current?.addNode(definitionId)}
          />
          <aside className="node-library-utilities" aria-label="Library utilities">
          {document.simulationEnabled ? (
            <button type="button" title="Create diagnostic simulation output" onClick={() => void simulate()} disabled={document.mode === "read-only"}>
              <Sparkles size={16} aria-hidden="true" />Simulation output
            </button>
          ) : null}
          <button type="button" title="Reload graph" onClick={() => void loadGraph(document)}>
            <RefreshCcw size={16} aria-hidden="true" />Refresh
          </button>
          <button ref={recipesButtonRef} type="button" title="Open Recipe Gallery" aria-expanded={recipesOpen} aria-pressed={recipesOpen} onClick={() => setRecipesOpen((open) => !open)}>
            <Workflow size={16} aria-hidden="true" />Recipes
          </button>
          </aside>
        </div>
      )}
      canvas={!graphReady
        ? <div className="canvas-loading" role="status">Loading document canvas...</div>
        : <EtherCanvas ref={canvasRef} graph={graph} catalog={nodeCatalog} document={document} onGraph={setGraph} onStatus={setMessage} onInspectorChange={setInspectorContext} />}
      inspector={<InspectorPanel context={inspectorContext} />}
      referenceDesk={applicationAvailable && graphReady ? <ReferenceDesk documentId={document.documentId} graph={graph} onGraphUpdated={() => loadGraph(document)} onStatus={setMessage} /> : <p>{graphReady ? "Reference Desk is unavailable in this compatibility session." : "Loading references…"}</p>}
      batchMatrix={applicationAvailable && graphReady ? <Suspense fallback={<p>Loading batch plan…</p>}><BatchMatrix documentId={document.documentId} graph={graph} onUpdated={() => loadGraph(document)} onStatus={setMessage} /></Suspense> : <p>{graphReady ? "Batch Matrix is unavailable in this compatibility session." : "Loading batch plan…"}</p>}
      jobCenter={applicationAvailable ? <Suspense fallback={<p>Loading Job Center…</p>}><JobCenter documentId={document.documentId} onStatus={setMessage} /></Suspense> : <p>Job Center is unavailable in this compatibility session.</p>}
      status={(
        <footer className={`document-status state-${state.saveState}`} aria-live="polite">
          <span>{state.error ?? (message || (state.saveState === "saved" ? "All changes are saved" : "Saving changes"))}</span>
          <small>{document.mode === "read-only" ? "Read-only" : "Local document"}</small>
        </footer>
      )}
    >
      <ProviderStatusPanel
        documentId={document.documentId}
        open={providerHealthOpen}
        onClose={() => setProviderHealthOpen(false)}
      />
      <DocumentHistoryDialog
        documentId={document.documentId}
        open={historyOpen}
        readOnly={document.mode === "read-only"}
        onClose={closeHistory}
      />
      <SettingsPanel
        documentId={document.documentId}
        open={settingsOpen}
        preferences={interfacePreferences}
        onPreferences={setInterfacePreferences}
        onClose={() => setSettingsOpen(false)}
      />
      {recipesOpen ? (
        <div className="recipe-gallery-overlay" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) closeRecipes();
        }}>
          <section ref={recipesDialogRef} className="recipe-gallery-dialog" role="dialog" aria-modal="true" aria-labelledby="recipe-gallery-title" onKeyDown={keepRecipeFocus}>
            <header className="recipe-gallery-dialog-header">
              <div>
                <span>Workflow builder</span>
                <strong id="recipe-gallery-title">Recipe Gallery</strong>
              </div>
              <button type="button" aria-label="Close Recipe Gallery" title="Close Recipe Gallery" autoFocus onClick={closeRecipes}>
                <X size={18} aria-hidden="true" />
              </button>
            </header>
            {applicationAvailable ? recipeCatalogError === null ? (
              <Suspense fallback={<p className="recipe-gallery-error">Loading Recipe Gallery…</p>}><TemplateGallery
                recipes={recipes}
                readOnly={document.mode === "read-only"}
                onLoadSetup={loadRecipeSetup}
                onPreviewRecipe={previewRecipe}
                onInstantiateRecipe={instantiateRecipe}
                onInserted={closeRecipes}
              /></Suspense>
            ) : <p className="recipe-gallery-error" role="alert">Blocked: {recipeCatalogError}</p> : <p className="recipe-gallery-error" role="alert">Recipe Gallery needs the application service.</p>}
          </section>
        </div>
      ) : null}
      {actionableMissing.length > 0 ? (
        <section className="missing-reference-strip" aria-label="Missing references">
          {actionableMissing.map((reference) => (
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
    {repair === null || repair.kind === "cancelled" ? null : (
      <DocumentRepairDialog
        repair={repair}
        onConfirm={() => void runRepair(true, repair.kind === "needs-confirmation" ? repair.confirmationId : undefined)}
        onClose={closeRepair}
      />
    )}
    </>
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
