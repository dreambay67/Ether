import { useEffect, useState, type KeyboardEvent } from "react";
import type { Edge, Node } from "@xyflow/react";
import { FolderInput, FolderPlus, ImagePlus, Play, Trash2 } from "lucide-react";
import {
  coerceCanvasNodeData,
  type CanvasNodeData
} from "@ether/engine/graph/nodeCatalog";
import { getOptionalNodeContract } from "@ether/engine/graph/contracts";
import {
  assembleGenerationInputs,
  assemblePromptForNode
} from "@ether/engine/graph/promptAssembly";
import type { EtherGraph } from "@ether/engine";

type InspectorPanelProps = {
  selectedNode: Node<CanvasNodeData> | null;
  selectedEdge: Edge | null;
  graph: EtherGraph;
  onPreviewNode(id: string, updates: Partial<CanvasNodeData>): void;
  onPreviewEdge(id: string, label: string): void;
  onCommitTextEdit(): void;
  onRunNode(id: string): void;
  onEnsureStoreFolder(id: string): void;
  onSaveFakeGeneratedAsset(id: string): void;
  onMoveLatestGeneratedAssetToCollection(id: string): void;
  onDeleteSelection(): void;
  hasOpenProject: boolean;
};

export function InspectorPanel({
  selectedNode,
  selectedEdge,
  graph,
  onPreviewNode,
  onPreviewEdge,
  onCommitTextEdit,
  onRunNode,
  onEnsureStoreFolder,
  onSaveFakeGeneratedAsset,
  onMoveLatestGeneratedAssetToCollection,
  onDeleteSelection,
  hasOpenProject
}: InspectorPanelProps) {
  const [nodeDraft, setNodeDraft] = useState<Partial<CanvasNodeData>>({});
  const [edgeLabelDraft, setEdgeLabelDraft] = useState("");

  useEffect(() => {
    setNodeDraft(selectedNode?.data ?? {});
  }, [selectedNode]);

  useEffect(() => {
    setEdgeLabelDraft(String(selectedEdge?.label ?? selectedEdge?.data?.label ?? ""));
  }, [selectedEdge]);

  const commitNodeDraft = () => {
    if (!selectedNode) {
      return;
    }

    onCommitTextEdit();
  };

  const commitEdgeDraft = () => {
    if (!selectedEdge) {
      return;
    }

    onCommitTextEdit();
  };

  const commitInputOnEnter = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.currentTarget.blur();
    }
  };

  if (selectedNode) {
    const nodeData = coerceCanvasNodeData(selectedNode.data);
    const contract = getOptionalNodeContract(nodeData.definitionId);
    const promptAssembly =
      nodeData.kind === "Prompt" ? assemblePromptForNode(graph, selectedNode.id) : null;
    const generationAssembly =
      nodeData.kind === "Generation" ? assembleGenerationInputs(graph, selectedNode.id) : null;
    const previewPrompt = promptAssembly?.prompt ?? generationAssembly?.prompt ?? "";
    const previewNegativePrompt =
      promptAssembly?.negativePrompt ?? generationAssembly?.negativePrompt ?? "";
    const canMirrorStoreFolder =
      nodeData.kind === "Store" &&
      (nodeData.subtype === "Collection" || nodeData.subtype === "Directory");

    return (
      <div className="inspector-form">
        <div className="inspector-meta">
          <span>{nodeData.kind ?? "Unknown"}</span>
          <span>{nodeData.subtype ?? "Legacy node"}</span>
        </div>
        <label>
          Title
          <input
            value={nodeDraft.title ?? ""}
            onChange={(event) => {
              const title = event.target.value;
              setNodeDraft((draft) => ({ ...draft, title }));
              onPreviewNode(selectedNode.id, { title });
            }}
            onBlur={commitNodeDraft}
            onKeyDown={commitInputOnEnter}
            data-testid="inspector-node-title"
          />
        </label>
        <label>
          Label
          <input
            value={nodeDraft.label ?? ""}
            onChange={(event) => {
              const label = event.target.value;
              setNodeDraft((draft) => ({ ...draft, label }));
              onPreviewNode(selectedNode.id, { label });
            }}
            onBlur={commitNodeDraft}
            onKeyDown={commitInputOnEnter}
            data-testid="inspector-node-label"
          />
        </label>
        <label>
          Instruction
          <textarea
            value={nodeDraft.instruction ?? ""}
            onChange={(event) => {
              const instruction = event.target.value;
              setNodeDraft((draft) => ({ ...draft, instruction }));
              onPreviewNode(selectedNode.id, { instruction });
            }}
            onBlur={commitNodeDraft}
          />
        </label>
        <label>
          Notes
          <textarea
            value={nodeDraft.notes ?? ""}
            onChange={(event) => {
              const notes = event.target.value;
              setNodeDraft((draft) => ({ ...draft, notes }));
              onPreviewNode(selectedNode.id, { notes });
            }}
            onBlur={commitNodeDraft}
          />
        </label>
        <section className="inspector-contract" data-testid="inspector-contract">
          <div>
            <span>Contract</span>
            <strong>{contract?.runLabel ?? "Unavailable"}</strong>
          </div>
          <p>
            {contract?.description ??
              "This saved node does not match a known Ether node definition. You can edit its text or delete it."}
          </p>
          {contract ? (
            <dl>
              <div>
                <dt>Inputs</dt>
                <dd>{contract.acceptedInputs.length > 0 ? contract.acceptedInputs.join(", ") : "none"}</dd>
              </div>
              <div>
                <dt>Outputs</dt>
                <dd>{contract.producedOutputs.join(", ")}</dd>
              </div>
            </dl>
          ) : null}
        </section>
        {nodeData.assetId || nodeData.assetPath ? (
          <section className="inspector-preview" data-testid="inspector-asset-metadata">
            <div>
              <span>Asset</span>
              <strong>{nodeData.assetKind ?? "reference"}</strong>
            </div>
            {nodeData.assetId ? <p>ID: {nodeData.assetId}</p> : null}
            {nodeData.assetPath ? <pre>{nodeData.assetPath}</pre> : null}
          </section>
        ) : null}
        {nodeData.kind === "Generation" ? (
          <section className="inspector-preview" data-testid="inspector-generated-output">
            <div>
              <span>Generated Output</span>
              <button
                type="button"
                className="run-node-button"
                onClick={() => onSaveFakeGeneratedAsset(selectedNode.id)}
                disabled={!hasOpenProject}
              >
                <ImagePlus size={14} aria-hidden="true" />
                Save fake output
              </button>
            </div>
            {nodeData.assetPath ? <pre>{nodeData.assetPath}</pre> : <p>Open a project to save fake output.</p>}
          </section>
        ) : null}
        {canMirrorStoreFolder ? (
          <section className="inspector-preview" data-testid="inspector-store-folder">
            <div>
              <span>{nodeData.subtype} Folder</span>
              <button
                type="button"
                className="run-node-button"
                onClick={() => onEnsureStoreFolder(selectedNode.id)}
                disabled={!hasOpenProject}
              >
                <FolderPlus size={14} aria-hidden="true" />
                Mirror
              </button>
            </div>
            {nodeData.storePath ? <pre>{nodeData.storePath}</pre> : <p>Open a project to create the folder.</p>}
            {nodeData.subtype === "Collection" ? (
              <>
                <button
                  type="button"
                  className="run-node-button"
                  onClick={() => onMoveLatestGeneratedAssetToCollection(selectedNode.id)}
                  disabled={!hasOpenProject}
                >
                  <FolderInput size={14} aria-hidden="true" />
                  Move pending generated
                </button>
                {nodeData.lastMovedAssetPath ? (
                  <>
                    <span>Last moved</span>
                    <pre>{nodeData.lastMovedAssetPath}</pre>
                  </>
                ) : null}
              </>
            ) : null}
          </section>
        ) : null}
        {promptAssembly || generationAssembly ? (
          <section className="inspector-preview" data-testid="inspector-assembly-preview">
            <div>
              <span>{generationAssembly ? "Prepared Generation Inputs" : "Assembled Prompt"}</span>
              {promptAssembly ? (
                <button
                  type="button"
                  className="run-node-button"
                  onClick={() => onRunNode(selectedNode.id)}
                  data-testid="inspector-run-node"
                >
                  <Play size={14} aria-hidden="true" />
                  Assemble
                </button>
              ) : null}
            </div>
            <pre>{previewPrompt || "No prompt text assembled yet."}</pre>
            {previewNegativePrompt ? (
              <>
                <span>Negative</span>
                <pre>{previewNegativePrompt}</pre>
              </>
            ) : null}
            {generationAssembly && generationAssembly.references.length > 0 ? (
              <ul>
                {generationAssembly.references.map((reference) => (
                  <li key={`${reference.nodeId}-${reference.role}`}>
                    {reference.role}: {reference.title}
                  </li>
                ))}
              </ul>
            ) : null}
            {nodeData.assembledPrompt ? (
              <p>Frozen {nodeData.lastRunAt ?? "recently"}</p>
            ) : null}
          </section>
        ) : null}
        <button type="button" className="danger-button" onClick={onDeleteSelection}>
          <Trash2 size={15} aria-hidden="true" />
          Delete selection
        </button>
      </div>
    );
  }

  if (selectedEdge) {
    return (
      <div className="inspector-form">
        <div className="inspector-meta">
          <span>Edge</span>
          <span>{`${selectedEdge.source} -> ${selectedEdge.target}`}</span>
        </div>
        <label>
          Label
          <input
            value={edgeLabelDraft}
            onChange={(event) => {
              const label = event.target.value;
              setEdgeLabelDraft(label);
              onPreviewEdge(selectedEdge.id, label);
            }}
            onBlur={commitEdgeDraft}
            onKeyDown={commitInputOnEnter}
            data-testid="inspector-edge-label"
          />
        </label>
        <button type="button" className="danger-button" onClick={onDeleteSelection}>
          <Trash2 size={15} aria-hidden="true" />
          Delete selection
        </button>
      </div>
    );
  }

  return (
    <div className="panel-placeholder">
      Select a node or connection to edit titles, labels, notes, and routing text.
    </div>
  );
}
