import { useEffect, useState, type KeyboardEvent } from "react";
import type { Edge, Node } from "@xyflow/react";
import {
  FolderInput,
  FolderPlus,
  GitBranch,
  ImagePlus,
  ListChecks,
  Lock,
  Paintbrush,
  Play,
  Route,
  Trash2,
  Unlock
} from "lucide-react";
import {
  coerceCanvasNodeData,
  type CanvasNodeData
} from "@ether/engine/graph/nodeCatalog";
import { getOptionalNodeContract } from "@ether/engine/graph/contracts";
import {
  assembleGenerationInputs,
  assemblePromptForNode
} from "@ether/engine/graph/promptAssembly";
import type { EtherGraph, ExecutionPolicy } from "@ether/engine";

type InspectorPanelProps = {
  selectedNode: Node<CanvasNodeData> | null;
  selectedEdge: Edge | null;
  graph: EtherGraph;
  onPreviewNode(id: string, updates: Partial<CanvasNodeData>): void;
  onPreviewEdge(id: string, label: string): void;
  onCommitTextEdit(): void;
  onRunNode(id: string): void;
  onToggleNodeLock(id: string, locked: boolean): void;
  onExecuteRun(policy: ExecutionPolicy): void;
  onEnsureStoreFolder(id: string): void;
  onSaveFakeGeneratedAsset(id: string): void;
  onCreateMaskAsset(id: string): void;
  onMoveLatestGeneratedAssetToCollection(id: string): void;
  onDeleteSelection(): void;
  executionPolicy: ExecutionPolicy;
  runCountCap: number;
  parallelExecution: boolean;
  selectedNodeCount: number;
  onExecutionPolicyChange(policy: ExecutionPolicy): void;
  onRunCountCapChange(cap: number): void;
  onParallelExecutionChange(parallel: boolean): void;
  hasOpenProject: boolean;
};

const mutationPresets = [
  "Whisper",
  "Lens Shift",
  "Costume Drift",
  "Lighting Weather",
  "Material Swap",
  "Composition Nudge",
  "Radical Concept"
];

function edgeTouchesLockedNode(edge: Edge | null, graph: EtherGraph) {
  if (!edge) {
    return false;
  }

  return graph.nodes.some((candidate) => {
    const node = candidate as Node<CanvasNodeData>;

    return (node.id === edge.source || node.id === edge.target) && node.data.locked;
  });
}

export function InspectorPanel({
  selectedNode,
  selectedEdge,
  graph,
  onPreviewNode,
  onPreviewEdge,
  onCommitTextEdit,
  onRunNode,
  onToggleNodeLock,
  onExecuteRun,
  onEnsureStoreFolder,
  onSaveFakeGeneratedAsset,
  onCreateMaskAsset,
  onMoveLatestGeneratedAssetToCollection,
  onDeleteSelection,
  executionPolicy,
  runCountCap,
  parallelExecution,
  selectedNodeCount,
  onExecutionPolicyChange,
  onRunCountCapChange,
  onParallelExecutionChange,
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
    const isLocked = nodeData.locked === true;
    const canMutateText = nodeData.kind === "Prompt" || nodeData.kind === "Assistant";
    const mutationArtifact =
      nodeData.mutationArtifact && typeof nodeData.mutationArtifact === "object"
        ? (nodeData.mutationArtifact as Record<string, unknown>)
        : null;

    return (
      <div className="inspector-form">
        <div className="inspector-meta">
          <span>{nodeData.kind ?? "Unknown"}</span>
          <span>{nodeData.subtype ?? "Legacy node"}</span>
        </div>
        <button
          type="button"
          className="lock-toggle-button"
          aria-label={isLocked ? "Unlock node" : "Lock node"}
          onClick={() => onToggleNodeLock(selectedNode.id, !isLocked)}
        >
          {isLocked ? <Unlock size={14} aria-hidden="true" /> : <Lock size={14} aria-hidden="true" />}
          {isLocked ? "Unlock" : "Lock"}
        </button>
        <label>
          Title
          <input
            value={nodeDraft.title ?? ""}
            onChange={(event) => {
              if (isLocked) {
                return;
              }

              const title = event.target.value;
              setNodeDraft((draft) => ({ ...draft, title }));
              onPreviewNode(selectedNode.id, { title });
            }}
            onBlur={commitNodeDraft}
            onKeyDown={commitInputOnEnter}
            disabled={isLocked}
            data-testid="inspector-node-title"
          />
        </label>
        <label>
          Label
          <input
            value={nodeDraft.label ?? ""}
            onChange={(event) => {
              if (isLocked) {
                return;
              }

              const label = event.target.value;
              setNodeDraft((draft) => ({ ...draft, label }));
              onPreviewNode(selectedNode.id, { label });
            }}
            onBlur={commitNodeDraft}
            onKeyDown={commitInputOnEnter}
            disabled={isLocked}
            data-testid="inspector-node-label"
          />
        </label>
        <label>
          Instruction
          <textarea
            value={nodeDraft.instruction ?? ""}
            onChange={(event) => {
              if (isLocked) {
                return;
              }

              const instruction = event.target.value;
              setNodeDraft((draft) => ({ ...draft, instruction }));
              onPreviewNode(selectedNode.id, { instruction });
            }}
            onBlur={commitNodeDraft}
            disabled={isLocked}
          />
        </label>
        <label>
          Notes
          <textarea
            value={nodeDraft.notes ?? ""}
            onChange={(event) => {
              if (isLocked) {
                return;
              }

              const notes = event.target.value;
              setNodeDraft((draft) => ({ ...draft, notes }));
              onPreviewNode(selectedNode.id, { notes });
            }}
            onBlur={commitNodeDraft}
            disabled={isLocked}
          />
        </label>
        {canMutateText ? (
          <section className="inspector-preview" data-testid="inspector-mutation-controls">
            <div>
              <span>Mutation</span>
              <strong>{nodeDraft.mutationPreset ?? "Whisper"}</strong>
            </div>
            <label className="execution-toggle">
              <input
                aria-label="Enable prompt mutation"
                type="checkbox"
                checked={nodeDraft.mutationEnabled === true}
                onChange={(event) => {
                  if (isLocked) {
                    return;
                  }

                  const mutationEnabled = event.target.checked;
                  setNodeDraft((draft) => ({ ...draft, mutationEnabled }));
                  onPreviewNode(selectedNode.id, { mutationEnabled });
                }}
                disabled={isLocked}
              />
              Enable
            </label>
            <label>
              Preset
              <select
                aria-label="Mutation preset"
                value={nodeDraft.mutationPreset ?? "Whisper"}
                onChange={(event) => {
                  if (isLocked) {
                    return;
                  }

                  const mutationPreset = event.target.value;
                  setNodeDraft((draft) => ({ ...draft, mutationPreset }));
                  onPreviewNode(selectedNode.id, { mutationPreset });
                }}
                onBlur={commitNodeDraft}
                disabled={isLocked}
              >
                {mutationPresets.map((preset) => (
                  <option key={preset} value={preset}>
                    {preset}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Seed
              <input
                aria-label="Mutation seed"
                value={nodeDraft.mutationSeed ?? ""}
                onChange={(event) => {
                  if (isLocked) {
                    return;
                  }

                  const mutationSeed = event.target.value;
                  setNodeDraft((draft) => ({ ...draft, mutationSeed }));
                  onPreviewNode(selectedNode.id, { mutationSeed });
                }}
                onBlur={commitNodeDraft}
                onKeyDown={commitInputOnEnter}
                disabled={isLocked}
              />
            </label>
            {[
              ["Variation strength", "variationStrength"],
              ["Novelty", "novelty"],
              ["Drift", "drift"],
              ["Preserve subject", "preserveSubject"],
              ["Preserve style", "preserveStyle"]
            ].map(([label, key]) => (
              <label key={key}>
                {label}
                <input
                  aria-label={label}
                  type="range"
                  min={0}
                  max={100}
                  value={Number(nodeDraft[key as keyof CanvasNodeData] ?? 50)}
                  onChange={(event) => {
                    if (isLocked) {
                      return;
                    }

                    const value = Number(event.target.value);
                    const updates = { [key]: value } as Partial<CanvasNodeData>;
                    setNodeDraft((draft) => ({ ...draft, ...updates }));
                    onPreviewNode(selectedNode.id, updates);
                  }}
                  onBlur={commitNodeDraft}
                  disabled={isLocked}
                />
              </label>
            ))}
            <label>
              Locked terms
              <textarea
                aria-label="Locked terms"
                value={nodeDraft.lockedTerms ?? ""}
                onChange={(event) => {
                  if (isLocked) {
                    return;
                  }

                  const lockedTerms = event.target.value;
                  setNodeDraft((draft) => ({ ...draft, lockedTerms }));
                  onPreviewNode(selectedNode.id, { lockedTerms });
                }}
                onBlur={commitNodeDraft}
                disabled={isLocked}
              />
            </label>
            <label>
              Negative constraints
              <textarea
                aria-label="Negative constraints"
                value={nodeDraft.negativeConstraints ?? ""}
                onChange={(event) => {
                  if (isLocked) {
                    return;
                  }

                  const negativeConstraints = event.target.value;
                  setNodeDraft((draft) => ({ ...draft, negativeConstraints }));
                  onPreviewNode(selectedNode.id, { negativeConstraints });
                }}
                onBlur={commitNodeDraft}
                disabled={isLocked}
              />
            </label>
            <label>
              Mutation direction
              <textarea
                aria-label="Mutation direction"
                value={nodeDraft.mutationInstruction ?? ""}
                onChange={(event) => {
                  if (isLocked) {
                    return;
                  }

                  const mutationInstruction = event.target.value;
                  setNodeDraft((draft) => ({ ...draft, mutationInstruction }));
                  onPreviewNode(selectedNode.id, { mutationInstruction });
                }}
                onBlur={commitNodeDraft}
                disabled={isLocked}
              />
            </label>
          </section>
        ) : null}
        <section
          className="inspector-preview inspector-execution"
          data-testid="inspector-execution-controls"
        >
          <div>
            <span>Execution</span>
            <strong>{isLocked ? "locked" : nodeData.rerunState ?? "ready"}</strong>
          </div>
          <label>
            Policy
            <select
              aria-label="Run policy"
              value={executionPolicy}
              onChange={(event) => onExecutionPolicyChange(event.target.value as ExecutionPolicy)}
              disabled={isLocked}
            >
              <option value="cached-inputs">Cached inputs</option>
              <option value="refresh-upstream">Refresh upstream</option>
              <option value="downstream">Downstream</option>
              <option value="branch">Branch</option>
              <option value="selected">Selected</option>
            </select>
          </label>
          <div className="execution-options">
            <label>
              Cap
              <input
                aria-label="Run count cap"
                type="number"
                min={0}
                max={100}
                value={runCountCap}
                onChange={(event) => onRunCountCapChange(Number(event.target.value))}
                disabled={isLocked}
              />
            </label>
            <label className="execution-toggle">
              <input
                aria-label="Parallel execution"
                type="checkbox"
                checked={parallelExecution}
                onChange={(event) => onParallelExecutionChange(event.target.checked)}
                disabled={isLocked}
              />
              Parallel
            </label>
          </div>
          <div className="execution-actions">
            <button
              type="button"
              className="run-node-button"
              onClick={() => onExecuteRun(executionPolicy)}
              disabled={isLocked || !hasOpenProject}
            >
              <Play size={14} aria-hidden="true" />
              Run Node
            </button>
            <button
              type="button"
              className="run-node-button"
              onClick={() => onExecuteRun("downstream")}
              disabled={isLocked || !hasOpenProject}
            >
              <Route size={14} aria-hidden="true" />
              Downstream
            </button>
            <button
              type="button"
              className="run-node-button"
              onClick={() => onExecuteRun("branch")}
              disabled={isLocked || !hasOpenProject}
            >
              <GitBranch size={14} aria-hidden="true" />
              Branch
            </button>
            <button
              type="button"
              className="run-node-button"
              onClick={() => onExecuteRun("selected")}
              disabled={isLocked || !hasOpenProject || selectedNodeCount === 0}
            >
              <ListChecks size={14} aria-hidden="true" />
              Selected
            </button>
          </div>
        </section>
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
        {nodeData.textOutput ? (
          <section className="inspector-preview" data-testid="inspector-text-output">
            <div>
              <span>Text Output</span>
              <strong>{nodeData.kind}</strong>
            </div>
            <pre>{nodeData.textOutput}</pre>
          </section>
        ) : null}
        {mutationArtifact ? (
          <section className="inspector-preview" data-testid="inspector-mutation-lineage">
            <div>
              <span>Mutation Lineage</span>
              <strong>{String(mutationArtifact.engine ?? "local")}</strong>
            </div>
            <p>Seed: {String(mutationArtifact.seed ?? "")}</p>
            <p>Lineage: {String(mutationArtifact.lineageId ?? "")}</p>
            {typeof mutationArtifact.sourceText === "string" ? (
              <>
                <span>Before</span>
                <pre>{mutationArtifact.sourceText}</pre>
              </>
            ) : null}
            {typeof mutationArtifact.resultText === "string" ? (
              <>
                <span>After</span>
                <pre>{mutationArtifact.resultText}</pre>
              </>
            ) : null}
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
                disabled={!hasOpenProject || isLocked}
              >
                <ImagePlus size={14} aria-hidden="true" />
                Save fake output
              </button>
            </div>
            {nodeData.assetPath ? <pre>{nodeData.assetPath}</pre> : <p>Open a project to save fake output.</p>}
          </section>
        ) : null}
        {nodeData.kind === "Edit" ? (
          <section className="inspector-preview" data-testid="inspector-mask-metadata">
            <div>
              <span>Mask Overlay</span>
              <button
                type="button"
                className="run-node-button"
                onClick={() => onCreateMaskAsset(selectedNode.id)}
                disabled={!hasOpenProject || isLocked || !(nodeData.sourceAssetPath || nodeData.assetPath)}
              >
                <Paintbrush size={14} aria-hidden="true" />
                Create mask overlay
              </button>
            </div>
            {nodeData.sourceAssetPath ? (
              <>
                <span>Source</span>
                <pre>{nodeData.sourceAssetPath}</pre>
              </>
            ) : null}
            {nodeData.maskAssetId ? <p>ID: {nodeData.maskAssetId}</p> : null}
            {nodeData.maskAssetPath ? <pre>{nodeData.maskAssetPath}</pre> : <p>No mask saved.</p>}
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
                disabled={!hasOpenProject || isLocked}
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
                  disabled={!hasOpenProject || isLocked}
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
                  disabled={isLocked}
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
        <button type="button" className="danger-button" onClick={onDeleteSelection} disabled={isLocked}>
          <Trash2 size={15} aria-hidden="true" />
          Delete selection
        </button>
      </div>
    );
  }

  if (selectedEdge) {
    const isRelationshipLocked = edgeTouchesLockedNode(selectedEdge, graph);

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
              if (isRelationshipLocked) {
                return;
              }

              const label = event.target.value;
              setEdgeLabelDraft(label);
              onPreviewEdge(selectedEdge.id, label);
            }}
            onBlur={commitEdgeDraft}
            onKeyDown={commitInputOnEnter}
            disabled={isRelationshipLocked}
            data-testid="inspector-edge-label"
          />
        </label>
        <button
          type="button"
          className="danger-button"
          onClick={onDeleteSelection}
          disabled={isRelationshipLocked}
        >
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
