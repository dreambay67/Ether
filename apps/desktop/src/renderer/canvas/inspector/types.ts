import type { KeyboardEvent } from "react";
import type { Edge, Node } from "@xyflow/react";
import type { EtherGraph, ExecutionPolicy } from "@ether/engine";
import type { CanvasNodeData, EditFrameData } from "@ether/engine/graph/nodeCatalog";
import type { RunProviderMode } from "../hooks/useRunController";
import type { ReferenceUploadMode } from "../hooks/useCanvasCommands";

export type MaskWorkspaceSavePayload = {
  content?: string;
  mimeType?: string;
  fileName?: string;
  metadata?: Record<string, unknown>;
  recipe?: { id: string; label: string };
  frame?: EditFrameData;
};

export type InspectorShellProps = {
  selectedNode: Node<CanvasNodeData> | null;
  selectedEdge: Edge | null;
  graph: EtherGraph;
  onPreviewNode(id: string, updates: Partial<CanvasNodeData>): void;
  onPreviewEdge(id: string, label: string): void;
  onCommitTextEdit(): void;
  onRunNode(id: string): void;
  onToggleNodeLock(id: string, locked: boolean): void;
  onPreviewRun(policy: ExecutionPolicy): void;
  onEnsureStoreFolder(id: string, updates?: Partial<CanvasNodeData>): void;
  onSaveFakeGeneratedAsset(id: string): void;
  onCreateMaskAsset(id: string, payload?: MaskWorkspaceSavePayload): void;
  onUploadReferenceForNode(id: string, mode?: ReferenceUploadMode): void;
  onMoveLatestGeneratedAssetToCollection(id: string): void;
  onDeleteSelection(): void;
  executionPolicy: ExecutionPolicy;
  runCountCap: number;
  parallelExecution: boolean;
  runProviderMode: RunProviderMode;
  selectedNodeCount: number;
  onExecutionPolicyChange(policy: ExecutionPolicy): void;
  onRunCountCapChange(cap: number): void;
  onParallelExecutionChange(parallel: boolean): void;
  onRunProviderModeChange(mode: RunProviderMode): void;
  hasOpenProject: boolean;
};

export type MutationPreset = {
  id: string;
  description: string;
};

export type InspectorNodeContext = {
  selectedNode: Node<CanvasNodeData>;
  nodeData: CanvasNodeData;
  nodeDraft: Partial<CanvasNodeData>;
  isLocked: boolean;
  hasOpenProject: boolean;
  commitNodeDraft(): void;
  commitInputOnEnter(event: KeyboardEvent<HTMLInputElement>): void;
  updateNodeDraft(updates: Partial<CanvasNodeData>): void;
};
