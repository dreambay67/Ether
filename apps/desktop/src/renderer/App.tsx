import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useRef, useState } from "react";
import { ImagePlus, Plus, RefreshCcw, Sparkles, Unlink, Workflow } from "lucide-react";
import type { ApplicationCommand, ApplicationQuery, EtherGraph, GraphTransaction, RecipeManifest } from "@ether/schema";

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
import { ReferenceDesk } from "./references/ReferenceDesk";
import { BatchMatrix } from "./batches/BatchMatrix";
import { JobCenter } from "./jobs/JobCenter";
import { TemplateGallery, type RecipeSetup, type RecipeSetupRequest } from "./canvas/library/TemplateGallery";

export function App() {
  const { state, document } = useProjectSession();
  const [graph, setGraph] = useState<EtherGraph | null>(null);
  const [message, setMessage] = useState("Preparing an untitled document...");
  const [references, setReferences] = useState<DesktopReference[]>([]);
  const [artifactRevision, setArtifactRevision] = useState(0);
  const [inspectorContext, setInspectorContext] = useState<InspectorContext | null>(null);
  const [recipesOpen, setRecipesOpen] = useState(false);
  const [recipes, setRecipes] = useState<readonly RecipeManifest[]>([]);
  const [recipeCatalogError, setRecipeCatalogError] = useState<string | null>(null);
  const canvasRef = useRef<EtherCanvasHandle>(null);
  const health = useProjectHealth(references);
  const actionableMissing = health.missing.filter((reference) => reference.actions.length > 0);
  const applicationAvailable = typeof window.ether.application?.onEvent === "function";

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
          <button type="button" title="Open Recipe Gallery" aria-expanded={recipesOpen} aria-pressed={recipesOpen} onClick={() => setRecipesOpen((open) => !open)}>
            <Workflow size={16} aria-hidden="true" />Recipes
          </button>
          {recipesOpen ? applicationAvailable ? recipeCatalogError === null ? (
            <TemplateGallery
              recipes={recipes}
              readOnly={document.mode === "read-only"}
              onLoadSetup={loadRecipeSetup}
              onPreviewRecipe={previewRecipe}
              onInstantiateRecipe={instantiateRecipe}
            />
          ) : <p className="recipe-gallery-error" role="alert">Blocked: {recipeCatalogError}</p> : <p className="recipe-gallery-error" role="alert">Recipe Gallery needs the application service.</p> : null}
        </aside>
      )}
      canvas={<EtherCanvas ref={canvasRef} graph={graph} document={document} onGraph={setGraph} onStatus={setMessage} onInspectorChange={setInspectorContext} />}
      inspector={<InspectorPanel context={inspectorContext} />}
      referenceDesk={applicationAvailable && graph ? <ReferenceDesk documentId={document.documentId} graph={graph} onGraphUpdated={() => loadGraph(document)} onStatus={setMessage} /> : <p>{graph ? "Reference Desk is unavailable in this compatibility session." : "Loading references…"}</p>}
      batchMatrix={applicationAvailable && graph ? <BatchMatrix documentId={document.documentId} graph={graph} onUpdated={() => loadGraph(document)} onStatus={setMessage} /> : <p>{graph ? "Batch Matrix is unavailable in this compatibility session." : "Loading batch plan…"}</p>}
      jobCenter={applicationAvailable ? <JobCenter documentId={document.documentId} onStatus={setMessage} /> : <p>Job Center is unavailable in this compatibility session.</p>}
      status={(
        <footer className={`document-status state-${state.saveState}`} aria-live="polite">
          <span>{state.error ?? (message || (state.saveState === "saved" ? "All changes are saved" : "Saving changes"))}</span>
          <small>{document.mode === "read-only" ? "Read-only" : "Local document"}</small>
        </footer>
      )}
    >
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
