import { useEffect, useState, type KeyboardEvent, type ReactNode } from "react";
import type { Edge, Node } from "@xyflow/react";
import { GitBranch, ListChecks, Lock, Play, Route, Trash2, Unlock } from "lucide-react";
import { coerceCanvasNodeData, type CanvasNodeData } from "@ether/engine/graph/nodeCatalog";
import { getOptionalNodeContract } from "@ether/engine/graph/contracts";
import { assembleGenerationInputs, assemblePromptForNode } from "@ether/engine/graph/promptAssembly";
import type { EtherGraph, ExecutionPolicy } from "@ether/engine";
import { ContextHelp } from "../../help/ContextHelp";
import { AssistantInspector } from "./AssistantInspector";
import { EditInspector } from "./EditInspector";
import { GenerationInspector } from "./GenerationInspector";
import { NoteInspector } from "./NoteInspector";
import { PromptInspector } from "./PromptInspector";
import { ReferenceInspector } from "./ReferenceInspector";
import { ReviewInspector } from "./ReviewInspector";
import { StoreInspector } from "./StoreInspector";
import type { InspectorNodeContext, InspectorShellProps, MutationPreset } from "./types";
import {
  CONNECTION_ROLES,
  DEFAULT_CONNECTION_ROLE,
  channelLabel,
  normalizeConnectionRole,
  normalizePayloadChannel,
  roleLabel
} from "../ports/channelRegistry";

type InspectorSectionId = "setup" | "inputs" | "run" | "output" | "review" | "advanced";

const inspectorSectionHelp: Record<InspectorSectionId, string> = {
  setup: "node identity, locking, instruction text, and private notes live here.",
  inputs: "incoming context, references, assistant mutation, and prompt assembly controls live here.",
  run: "preview execution policy and run scope before starting provider or local work.",
  output: "artifacts, generated images, masks, text results, and lineage previews appear here.",
  review: "compare, evaluate, filter, and note review controls appear here when the node supports them.",
  advanced: "contract help, typed ports, practical use cases, and destructive actions live here."
};

const mutationPresets: MutationPreset[] = [
  {
    id: "Whisper",
    description:
      "Small wording drift. Keeps subject and style stable while nudging atmosphere, adjectives, and secondary details."
  },
  {
    id: "Lens Shift",
    description:
      "Changes camera language, crop, distance, focal feel, and viewpoint while preserving the core subject."
  },
  {
    id: "Costume Drift",
    description:
      "Varies clothing, styling, styling era, accessories, and wardrobe materials without changing identity."
  },
  {
    id: "Lighting Weather",
    description:
      "Moves the image through different lighting setups, weather, time of day, contrast, and shadow behavior."
  },
  {
    id: "Material Swap",
    description:
      "Alters surfaces and textures such as chrome, glass, fabric, paper, liquid, plastic, stone, or holographic finishes."
  },
  {
    id: "Composition Nudge",
    description:
      "Rebalances framing, negative space, foreground/background relationships, and subject placement."
  },
  {
    id: "Product Fidelity",
    description:
      "Prioritizes brand, logo, product shape, color, and recognizability while allowing only supporting-scene variation."
  },
  {
    id: "Character Anchor",
    description:
      "Preserves a character or face tightly while varying pose, expression, wardrobe, lens, or scene context."
  },
  {
    id: "Palette Drift",
    description:
      "Explores controlled color palettes, accent colors, contrast temperature, and background hue relationships."
  },
  {
    id: "Era Shift",
    description:
      "Translates the same idea into a chosen visual era or cultural design period while keeping the subject readable."
  },
  {
    id: "Radical Concept",
    description:
      "Introduces a larger conceptual branch while preserving locked terms and any high-preservation slider settings."
  }
];

function edgeTouchesLockedNode(edge: Edge | null, graph: EtherGraph) {
  if (!edge) {
    return false;
  }

  const edgeData = edge.data && typeof edge.data === "object" ? edge.data as { locked?: unknown } : {};

  if ((edge as Edge & { locked?: unknown }).locked === true || edgeData.locked === true) {
    return true;
  }

  return graph.nodes.some((candidate) => {
    const node = candidate as Node<CanvasNodeData>;

    return (node.id === edge.source || node.id === edge.target) && node.data.locked;
  });
}

function InspectorSection({
  id,
  title,
  children
}: {
  id: InspectorSectionId;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="inspector-section" data-testid={`inspector-section-${id}`}>
      <div className="inspector-section-heading">
        <h3>{title}</h3>
        <ContextHelp id={`inspector-${id}`} label={`${title} section`}>
          {inspectorSectionHelp[id]}
        </ContextHelp>
      </div>
      {children}
    </section>
  );
}

function MutationLineage({ mutationArtifact }: { mutationArtifact: Record<string, unknown> | null }) {
  if (!mutationArtifact) {
    return null;
  }

  return (
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
  );
}

function TextOutput({ context }: { context: InspectorNodeContext }) {
  const { nodeData, nodeDraft, isLocked, commitNodeDraft, updateNodeDraft } = context;
  const value = nodeDraft.textOutput ?? nodeData.textOutput ?? "";

  if (!value && !nodeData.textOutput) {
    return null;
  }

  return (
    <section className="inspector-preview" data-testid="inspector-text-output">
      <div>
        <span>Text Output</span>
        <strong>{nodeData.kind}</strong>
      </div>
      <textarea
        aria-label="Text output"
        className="inspector-large-textarea"
        value={value}
        onChange={(event) => updateNodeDraft({ textOutput: event.target.value })}
        onBlur={commitNodeDraft}
        disabled={isLocked}
      />
    </section>
  );
}

function AssetMetadata({ nodeData }: { nodeData: CanvasNodeData }) {
  if (!nodeData.assetId && !nodeData.assetPath) {
    return null;
  }

  return (
    <section className="inspector-preview" data-testid="inspector-asset-metadata">
      <div>
        <span>Asset</span>
        <strong>{nodeData.assetKind ?? "reference"}</strong>
      </div>
      {nodeData.assetId ? <p>ID: {nodeData.assetId}</p> : null}
      {nodeData.assetPath ? <pre>{nodeData.assetPath}</pre> : null}
    </section>
  );
}

function ContractSummary({ nodeData }: { nodeData: CanvasNodeData }) {
  const contract = getOptionalNodeContract(nodeData.definitionId);

  return (
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
            <dt>Action</dt>
            <dd>{contract.help.primaryAction}</dd>
          </div>
          <div>
            <dt>Inputs</dt>
            <dd>{contract.help.acceptedInputs}</dd>
          </div>
          <div>
            <dt>Outputs</dt>
            <dd>{contract.help.producedOutputs}</dd>
          </div>
          <div>
            <dt>Use case</dt>
            <dd>{contract.help.useCase}</dd>
          </div>
          <div>
            <dt>Prompt vs text</dt>
            <dd>
              Prompt means structured generation-ready prompt material. Text means loose context from notes or assistants.
              Assistant-to-prompt connections fill the downstream Prompt instruction so you can inspect it before generation.
            </dd>
          </div>
        </dl>
      ) : null}
    </section>
  );
}

function NodeSetup({
  context,
  onToggleNodeLock
}: {
  context: InspectorNodeContext;
  onToggleNodeLock(id: string, locked: boolean): void;
}) {
  const { selectedNode, nodeData, nodeDraft, isLocked, commitNodeDraft, commitInputOnEnter, updateNodeDraft } = context;

  return (
    <>
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
      <label title="Canvas title shown on the node. Defaults are provided by the node type, but you can personalize them.">
        Title
        <input
          aria-label="Title"
          data-testid="inspector-node-title"
          value={nodeDraft.title ?? ""}
          onChange={(event) => updateNodeDraft({ title: event.target.value, label: event.target.value })}
          onBlur={commitNodeDraft}
          onKeyDown={commitInputOnEnter}
          disabled={isLocked}
        />
      </label>
      <label title="Primary instruction text used by runnable nodes and context assembly.">
        Instruction
        <textarea
          value={nodeDraft.instruction ?? ""}
          onChange={(event) => updateNodeDraft({ instruction: event.target.value })}
          onBlur={commitNodeDraft}
          disabled={isLocked}
        />
      </label>
      <label title="Private working notes that can also act as context for note-style workflows.">
        Notes
        <textarea
          value={nodeDraft.notes ?? ""}
          onChange={(event) => updateNodeDraft({ notes: event.target.value })}
          onBlur={commitNodeDraft}
          disabled={isLocked}
        />
      </label>
    </>
  );
}

function NodeConnectionRoles({
  selectedNode,
  graph
}: {
  selectedNode: Node<CanvasNodeData>;
  graph: EtherGraph;
}) {
  const outgoingRoles = graph.edges
    .filter((edge) => edge.source === selectedNode.id)
    .map((edge) => {
      const data = edge.data && typeof edge.data === "object" ? edge.data as { role?: unknown; label?: unknown } : {};
      const role = normalizeConnectionRole(data.role ?? data.label ?? edge.label);
      const targetNode = graph.nodes.find((node) => node.id === edge.target);

      return {
        edgeId: edge.id,
        role,
        targetTitle: targetNode?.data?.title ?? edge.target
      };
    })
    .filter((entry) => entry.role !== DEFAULT_CONNECTION_ROLE);

  if (outgoingRoles.length === 0) {
    return null;
  }

  return (
    <div className="inspector-role-summary" data-testid="inspector-outgoing-roles">
      <span>Outgoing roles</span>
      {outgoingRoles.map((entry) => (
        <p key={entry.edgeId}>
          <strong>{roleLabel(entry.role)}</strong>
          <em>to {entry.targetTitle}</em>
        </p>
      ))}
    </div>
  );
}

function RunControls({
  context,
  executionPolicy,
  runCountCap,
  parallelExecution,
  runProviderMode,
  selectedNodeCount,
  onRunNode,
  onPreviewRun,
  onExecutionPolicyChange,
  onRunCountCapChange,
  onParallelExecutionChange,
  onRunProviderModeChange
}: {
  context: InspectorNodeContext;
  executionPolicy: ExecutionPolicy;
  runCountCap: number;
  parallelExecution: boolean;
  runProviderMode: "codex" | "simulation";
  selectedNodeCount: number;
  onRunNode(id: string): void;
  onPreviewRun(policy: ExecutionPolicy): void;
  onExecutionPolicyChange(policy: ExecutionPolicy): void;
  onRunCountCapChange(cap: number): void;
  onParallelExecutionChange(parallel: boolean): void;
  onRunProviderModeChange(mode: "codex" | "simulation"): void;
}) {
  const { selectedNode, nodeData, isLocked, hasOpenProject } = context;

  return (
    <section className="inspector-preview inspector-execution" data-testid="inspector-execution-controls">
      <div>
        <span>Execution</span>
        <strong>{isLocked ? "locked" : nodeData.rerunState ?? "ready"}</strong>
      </div>
      <label title="Determines which part of the graph participates in the next run.">
        Policy
        <select
          aria-label="Run policy"
          value={executionPolicy}
          onChange={(event) => onExecutionPolicyChange(event.target.value as ExecutionPolicy)}
          disabled={isLocked}
        >
          <option value="cached-inputs" title="Run this node using the current cached upstream outputs.">Cached inputs</option>
          <option value="refresh-upstream" title="Run upstream nodes first, then this node.">Refresh upstream</option>
          <option value="downstream" title="Run this node and every connected downstream node.">Downstream</option>
          <option value="branch" title="Run upstream context plus downstream branch nodes.">Branch</option>
          <option value="selected" title="Run the currently selected nodes in dependency order.">Selected</option>
        </select>
      </label>
      <div className="execution-options">
        <label title="Codex CLI is the default real route. Simulation Mode is an explicit local dry-run route.">
          Provider
          <select
            aria-label="Run provider"
            value={runProviderMode}
            onChange={(event) => onRunProviderModeChange(event.target.value as "codex" | "simulation")}
            disabled={isLocked}
          >
            <option value="codex">Codex CLI</option>
            <option value="simulation">Simulation Mode</option>
          </select>
        </label>
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
        {nodeData.kind === "Prompt" ? (
          <button
            type="button"
            className="run-node-button"
            onClick={() => onRunNode(selectedNode.id)}
            data-testid="inspector-run-node"
            disabled={isLocked}
            title="Assemble this prompt node only. This freezes upstream text into an inspectable prompt artifact without image generation."
          >
            <Play size={14} aria-hidden="true" />
            Assemble Prompt
          </button>
        ) : null}
        <button
          type="button"
          className="run-node-button"
          onClick={() => onPreviewRun(executionPolicy)}
          disabled={isLocked || !hasOpenProject}
          title="Show the exact run plan before starting any provider work."
        >
          <ListChecks size={14} aria-hidden="true" />
          Preview Run
        </button>
        <button
          type="button"
          className="run-node-button"
          onClick={() => onPreviewRun(executionPolicy)}
          disabled={isLocked || !hasOpenProject}
          title="Preview the current policy for this node, then confirm before execution."
        >
          <Play size={14} aria-hidden="true" />
          Run Node
        </button>
        <button
          type="button"
          className="run-node-button"
          onClick={() => onPreviewRun("downstream")}
          disabled={isLocked || !hasOpenProject}
          title="Preview this node and all downstream nodes that consume its outputs."
        >
          <Route size={14} aria-hidden="true" />
          Downstream
        </button>
        <button
          type="button"
          className="run-node-button"
          onClick={() => onPreviewRun("branch")}
          disabled={isLocked || !hasOpenProject}
          title="Preview the full branch: upstream context, this node, and downstream results."
        >
          <GitBranch size={14} aria-hidden="true" />
          Branch
        </button>
        <button
          type="button"
          className="run-node-button"
          onClick={() => onPreviewRun("selected")}
          disabled={isLocked || !hasOpenProject || selectedNodeCount === 0}
          title="Preview only the selected nodes, still respecting dependency order."
        >
          <ListChecks size={14} aria-hidden="true" />
          Selected
        </button>
      </div>
    </section>
  );
}

function NodeInspector({
  selectedNode,
  graph,
  onPreviewNode,
  onCommitTextEdit,
  onRunNode,
  onToggleNodeLock,
  onPreviewRun,
  onEnsureStoreFolder,
  onSaveFakeGeneratedAsset,
  onCreateMaskAsset,
  onUploadReferenceForNode,
  onMoveLatestGeneratedAssetToCollection,
  onDeleteSelection,
  executionPolicy,
  runCountCap,
  parallelExecution,
  runProviderMode,
  selectedNodeCount,
  onExecutionPolicyChange,
  onRunCountCapChange,
  onParallelExecutionChange,
  onRunProviderModeChange,
  hasOpenProject
}: InspectorShellProps & { selectedNode: Node<CanvasNodeData> }) {
  const [nodeDraft, setNodeDraft] = useState<Partial<CanvasNodeData>>(selectedNode.data ?? {});

  useEffect(() => {
    setNodeDraft(selectedNode.data ?? {});
  }, [selectedNode.id]);

  const nodeData = coerceCanvasNodeData(selectedNode.data);
  const isLocked = nodeData.locked === true;
  const promptAssembly = nodeData.kind === "Prompt" ? assemblePromptForNode(graph, selectedNode.id) : null;
  const generationAssembly = nodeData.kind === "Generation" ? assembleGenerationInputs(graph, selectedNode.id) : null;
  const previewPrompt = promptAssembly?.prompt ?? generationAssembly?.prompt ?? "";
  const previewNegativePrompt = promptAssembly?.negativePrompt ?? generationAssembly?.negativePrompt ?? "";
  const mutationArtifact =
    nodeData.mutationArtifact && typeof nodeData.mutationArtifact === "object"
      ? (nodeData.mutationArtifact as Record<string, unknown>)
      : null;

  const commitNodeDraft = () => {
    onCommitTextEdit();
  };

  const commitInputOnEnter = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.currentTarget.blur();
    }
  };

  const updateNodeDraft = (updates: Partial<CanvasNodeData>) => {
    if (isLocked) {
      return;
    }

    setNodeDraft((draft) => ({ ...draft, ...updates }));
    onPreviewNode(selectedNode.id, updates);
  };

  const context: InspectorNodeContext = {
    selectedNode,
    nodeData,
    nodeDraft,
    isLocked,
    hasOpenProject,
    commitNodeDraft,
    commitInputOnEnter,
    updateNodeDraft
  };

  return (
    <div className="inspector-form">
      <InspectorSection id="setup" title="Setup">
        <NodeSetup context={context} onToggleNodeLock={onToggleNodeLock} />
        <NodeConnectionRoles selectedNode={selectedNode} graph={graph} />
      </InspectorSection>
      <InspectorSection id="inputs" title="Inputs">
        <ReferenceInspector context={context} onUploadReferenceForNode={onUploadReferenceForNode} />
        <AssistantInspector context={context} mutationPresets={mutationPresets} />
        <PromptInspector
          context={context}
          mutationPresets={mutationPresets}
          previewPrompt={previewPrompt}
          previewNegativePrompt={previewNegativePrompt}
          hasFrozenPrompt={Boolean(nodeData.assembledPrompt)}
          lastRunAt={nodeData.lastRunAt}
        />
      </InspectorSection>
      <InspectorSection id="run" title="Run">
        <RunControls
          context={context}
          executionPolicy={executionPolicy}
          runCountCap={runCountCap}
          parallelExecution={parallelExecution}
          runProviderMode={runProviderMode}
          selectedNodeCount={selectedNodeCount}
          onRunNode={onRunNode}
          onPreviewRun={onPreviewRun}
          onExecutionPolicyChange={onExecutionPolicyChange}
          onRunCountCapChange={onRunCountCapChange}
          onParallelExecutionChange={onParallelExecutionChange}
          onRunProviderModeChange={onRunProviderModeChange}
        />
      </InspectorSection>
      <InspectorSection id="output" title="Output">
        <GenerationInspector
          context={context}
          generationAssembly={generationAssembly}
          previewPrompt={previewPrompt}
          previewNegativePrompt={previewNegativePrompt}
          onSaveFakeGeneratedAsset={onSaveFakeGeneratedAsset}
        />
        <EditInspector context={context} onCreateMaskAsset={onCreateMaskAsset} />
        {nodeData.kind === "Store" && (nodeData.subtype === "Collection" || nodeData.subtype === "Directory") ? (
          <StoreInspector
            context={context}
            onEnsureStoreFolder={onEnsureStoreFolder}
            onMoveLatestGeneratedAssetToCollection={onMoveLatestGeneratedAssetToCollection}
          />
        ) : null}
        <AssetMetadata nodeData={nodeData} />
        <TextOutput context={context} />
        <MutationLineage mutationArtifact={mutationArtifact} />
      </InspectorSection>
      <InspectorSection id="review" title="Review">
        {nodeData.kind === "Review" || nodeData.kind === "Store" ? <ReviewInspector context={context} /> : null}
        {nodeData.kind === "Note" ? <NoteInspector context={context} /> : null}
      </InspectorSection>
      <InspectorSection id="advanced" title="Advanced">
        <ContractSummary nodeData={nodeData} />
        <button type="button" className="danger-button" onClick={onDeleteSelection} disabled={isLocked}>
          <Trash2 size={15} aria-hidden="true" />
          Delete selection
        </button>
      </InspectorSection>
    </div>
  );
}

function EdgeInspector({
  selectedEdge,
  graph,
  onPreviewEdge,
  onCommitTextEdit,
  onDeleteSelection
}: Pick<InspectorShellProps, "selectedEdge" | "graph" | "onPreviewEdge" | "onCommitTextEdit" | "onDeleteSelection"> & {
  selectedEdge: Edge;
}) {
  const [edgeRoleDraft, setEdgeRoleDraft] = useState(DEFAULT_CONNECTION_ROLE);

  useEffect(() => {
    setEdgeRoleDraft(normalizeConnectionRole(selectedEdge.data?.role ?? selectedEdge.label ?? selectedEdge.data?.label));
  }, [selectedEdge]);

  const commitEdgeDraft = () => {
    onCommitTextEdit();
  };

  const isRelationshipLocked = edgeTouchesLockedNode(selectedEdge, graph);
  const sourceChannel = normalizePayloadChannel(selectedEdge.data?.sourceChannel ?? selectedEdge.sourceHandle);
  const targetChannel = normalizePayloadChannel(selectedEdge.data?.targetChannel ?? selectedEdge.targetHandle);

  return (
    <div className="inspector-form">
      <div className="inspector-meta">
        <span>Edge</span>
        <span>{`${selectedEdge.source} -> ${selectedEdge.target}`}</span>
      </div>
      <label>
        Connection role
        <select
          value={edgeRoleDraft}
          onChange={(event) => {
            if (isRelationshipLocked) {
              return;
            }

            const role = normalizeConnectionRole(event.target.value);
            setEdgeRoleDraft(role);
            onPreviewEdge(selectedEdge.id, role);
          }}
          onBlur={commitEdgeDraft}
          disabled={isRelationshipLocked}
          data-testid="inspector-edge-label"
        >
          {CONNECTION_ROLES.map((role) => (
            <option key={role} value={role}>
              {roleLabel(role)}
            </option>
          ))}
        </select>
      </label>
      <div className="inspector-channel-readout" data-testid="inspector-edge-channels">
        <span>{sourceChannel ? channelLabel(sourceChannel) : "Unknown"} source</span>
        <span>{targetChannel ? channelLabel(targetChannel) : "Unknown"} target</span>
      </div>
      <button type="button" className="danger-button" onClick={onDeleteSelection} disabled={isRelationshipLocked}>
        <Trash2 size={15} aria-hidden="true" />
        Delete selection
      </button>
    </div>
  );
}

export function InspectorShell(props: InspectorShellProps) {
  if (props.selectedNode) {
    return <NodeInspector {...props} selectedNode={props.selectedNode} />;
  }

  if (props.selectedEdge) {
    return (
      <EdgeInspector
        selectedEdge={props.selectedEdge}
        graph={props.graph}
        onPreviewEdge={props.onPreviewEdge}
        onCommitTextEdit={props.onCommitTextEdit}
        onDeleteSelection={props.onDeleteSelection}
      />
    );
  }

  return (
    <div className="panel-placeholder">
      Select a node or connection to edit instructions, notes, roles, and routing.
    </div>
  );
}
