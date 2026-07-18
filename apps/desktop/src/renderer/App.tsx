import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  type Node,
  type OnNodeDrag
} from "@xyflow/react";
import { ImagePlus, Plus, RefreshCcw, Sparkles, Unlink } from "lucide-react";
import type { EtherGraph, EtherNode, GraphTransaction, LinkedReference } from "@ether/schema";

import type { DocumentDescriptor } from "../shared/ipc/contracts";
import { ArtifactBrowser } from "./artifacts/ArtifactBrowser";
import { ProjectHeader } from "./project/ProjectHeader";
import { StartScreen } from "./project/StartScreen";
import { useDocumentSession } from "./project/useDocumentSession";

export function App() {
  const { state } = useDocumentSession();
  const document = isDocumentDescriptor(state.snapshot) ? state.snapshot : null;
  const [graph, setGraph] = useState<EtherGraph | null>(null);
  const [message, setMessage] = useState("Preparing an untitled document...");
  const [artifactsOpen, setArtifactsOpen] = useState(false);
  const [references, setReferences] = useState<LinkedReference[]>([]);
  const [artifactRevision, setArtifactRevision] = useState(0);

  const loadGraph = useCallback(async (active: DocumentDescriptor) => {
    const result = await window.ether.graph.snapshot(active.documentId);
    setGraph(result.graph);
    setReferences(await window.ether.references.list(active.documentId));
    setMessage("");
  }, []);

  useEffect(() => {
    if (document === null) return;
    void loadGraph(document).catch((error) => {
      setMessage(error instanceof Error ? error.message : "The graph needs attention.");
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

  const apply = async (operations: GraphTransaction["operations"], title: string) => {
    if (document === null || graph === null) return;
    const transaction: GraphTransaction = {
      id: crypto.randomUUID(),
      baseDocumentRevisionId: document.documentRevisionId,
      baseGraphRevisions: { [graph.id]: document.graphRevisionId },
      title,
      actor: "user",
      layoutPolicy: "preserve",
      operations
    };
    try {
      const result = await window.ether.graph.applyTransaction(document.documentId, transaction);
      setGraph(result.graph);
      setMessage("Saving changes...");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The graph change could not be saved.");
    }
  };

  const addNode = (kind: "prompt" | "generator") => {
    if (graph === null) return;
    const ordinal = graph.nodes.length + 1;
    const node = kind === "prompt" ? promptNode(ordinal) : generatorNode(ordinal);
    const operation = { type: "addNode", graphId: graph.id, node } as Extract<
      GraphTransaction["operations"][number],
      { type: "addNode" }
    >;
    void apply([operation], `Add ${node.title}`);
  };

  const nodes = useMemo<Node[]>(() => (graph?.nodes ?? []).map((node) => ({
    id: node.id,
    position: node.position,
    data: { label: node.title, family: node.config.kind },
    style: {
      width: node.size.width,
      minHeight: node.size.height,
      borderRadius: 6,
      border: "1px solid rgba(55, 230, 234, 0.45)",
      background: "#101722",
      color: "#f4f7fb"
    }
  })), [graph]);

  const edges = useMemo(() => (graph?.edges ?? []).map((edge) => ({
    id: edge.id,
    source: edge.from.kind === "node" ? edge.from.nodeId : edge.from.moduleId,
    target: edge.to.kind === "node" ? edge.to.nodeId : edge.to.moduleId,
    label: edge.role,
    style: { stroke: "#37e6ea" }
  })), [graph]);

  const onNodeDragStop: OnNodeDrag<Node> = (_event, node) => {
    if (graph === null) return;
    void apply([{
      type: "moveNodes",
      graphId: graph.id,
      positions: [{ nodeId: node.id, position: node.position }]
    }], "Move node");
  };

  const actOnReference = async (referenceId: string, action: string) => {
    if (document === null) return;
    try {
      setReferences(await window.ether.references.act(document.documentId, referenceId, action));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Reference recovery failed.");
    }
  };

  const generate = async () => {
    if (document === null) return;
    try {
      setMessage("Generating with the local fake provider...");
      await window.ether.artifacts.generateFake(document.documentId);
      setArtifactsOpen(true);
      setArtifactRevision((value) => value + 1);
      setMessage("Generated artifact embedded in this document");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Generation failed.");
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
    <main
      className="ether-shell task-nine-shell"
      aria-label="Ether desktop workspace"
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
    >
      <ProjectHeader
        document={{ ...document, saveState: state.saveState }}
        artifactsOpen={artifactsOpen}
        onNew={() => void window.ether.document.new()}
        onOpen={() => void window.ether.document.open()}
        onSave={() => void runDocumentCommand((id) => window.ether.document.save(id))}
        onSaveAs={() => void runDocumentCommand((id) => window.ether.document.saveAs(id))}
        onSaveCopy={() => void runDocumentCommand((id) => window.ether.document.saveCopy(id))}
        onCompact={() => void runDocumentCommand((id) => window.ether.document.compact(id))}
        onMakePortable={() => void runDocumentCommand((id) => window.ether.document.makePortable(id))}
        onToggleArtifacts={() => setArtifactsOpen((value) => !value)}
      />
      <section className="task-nine-workspace">
        <aside className="document-tool-rail" aria-label="Graph tools">
          <button type="button" onClick={() => addNode("prompt")}>
            <Plus size={16} aria-hidden="true" />Prompt
          </button>
          <button type="button" onClick={() => addNode("generator")}>
            <ImagePlus size={16} aria-hidden="true" />Image
          </button>
          <button type="button" onClick={() => void generate()}>
            <Sparkles size={16} aria-hidden="true" />Generate
          </button>
          <button type="button" title="Reload graph" onClick={() => void loadGraph(document)}>
            <RefreshCcw size={16} aria-hidden="true" />Refresh
          </button>
        </aside>
        <section className="document-canvas" data-testid="document-canvas" aria-label="Document canvas">
          <ReactFlow nodes={nodes} edges={edges} onNodeDragStop={onNodeDragStop} fitView>
            <Background color="#263241" gap={24} size={1} />
            <Controls />
            <MiniMap pannable zoomable />
          </ReactFlow>
        </section>
        {artifactsOpen ? (
          <ArtifactBrowser key={`${document.documentId}:${artifactRevision}`} documentId={document.documentId} />
        ) : null}
      </section>
      {references.some((reference) => reference.state === "missing") ? (
        <section className="missing-reference-strip" aria-label="Missing references">
          {references.filter((reference) => reference.state === "missing").map((reference) => (
            <div key={reference.id}>
              <Unlink size={15} aria-hidden="true" />
              <strong>{reference.displayName}</strong>
              {referenceActions.map(([action, label]) => (
                <button key={action} type="button" onClick={() => void actOnReference(reference.id, action)}>{label}</button>
              ))}
            </div>
          ))}
        </section>
      ) : null}
      <footer className={`document-status state-${state.saveState}`} aria-live="polite">
        <span>{state.error ?? (message || (state.saveState === "saved" ? "All changes are saved" : "Saving changes"))}</span>
        <small>{document.mode === "read-only" ? "Read-only" : "Local document"}</small>
      </footer>
    </main>
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

function isDocumentDescriptor(value: unknown): value is DocumentDescriptor {
  return value !== null && typeof value === "object" && "graphId" in value;
}

function promptNode(ordinal: number): EtherNode {
  return {
    id: crypto.randomUUID(),
    definitionId: "prompt.text",
    title: `Prompt ${ordinal}`,
    position: { x: 120 + ordinal * 24, y: 120 + ordinal * 18 },
    size: { width: 240, height: 132 },
    config: { kind: "prompt.text", body: "Describe the creative direction", assembly: "append" },
    presentation: { collapsed: false, accent: "default", previewMode: "content" }
  };
}

function generatorNode(ordinal: number): EtherNode {
  return {
    id: crypto.randomUUID(),
    definitionId: "generation.image",
    title: `Image Generator ${ordinal}`,
    position: { x: 420 + ordinal * 24, y: 180 + ordinal * 18 },
    size: { width: 250, height: 142 },
    config: {
      kind: "generation.image",
      providerId: "ether-fake-local",
      profileId: "fake-image-default",
      aspectRatio: "1:1",
      resolution: { width: 512, height: 512 },
      outputCount: 1
    },
    presentation: { collapsed: false, accent: "default", previewMode: "summary" }
  };
}
