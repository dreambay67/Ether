import { useState } from "react";
import { GitPullRequestArrow, Sparkles, X } from "lucide-react";
import {
  createGraphNodeData
} from "@ether/engine/graph/nodeCatalog";
import type {
  GraphPatch,
  GraphPatchPreview
} from "@ether/engine/graph/graphPatch";

type CommandPaletteProps = {
  isOpen: boolean;
  previewPatch(patch: GraphPatch): GraphPatchPreview;
  applyPatch(patch: GraphPatch): void;
  onClose(): void;
};

export function CommandPalette({
  isOpen,
  previewPatch,
  applyPatch,
  onClose
}: CommandPaletteProps) {
  const [pendingPatch, setPendingPatch] = useState<GraphPatch | null>(null);
  const preview = pendingPatch ? previewPatch(pendingPatch) : null;

  if (!isOpen) {
    return null;
  }

  const proposeStarterWorkflow = () => {
    setPendingPatch(createStarterWorkflowPatch());
  };

  const rejectPatch = () => {
    setPendingPatch(null);
  };

  const applyPendingPatch = () => {
    if (!pendingPatch) {
      return;
    }

    applyPatch(pendingPatch);
    setPendingPatch(null);
  };

  return (
    <section
      className="command-palette"
      aria-label="Codex Co-Pilot"
      data-testid="codex-command-palette"
    >
      <div className="command-palette-title">
        <div>
          <p>Codex Co-Pilot</p>
          <h2>Graph Patch Lane</h2>
        </div>
        <button type="button" aria-label="Close command palette" onClick={onClose}>
          <X size={16} aria-hidden="true" />
        </button>
      </div>

      <button
        type="button"
        className="command-palette-primary"
        onClick={proposeStarterWorkflow}
      >
        <Sparkles size={16} aria-hidden="true" />
        Propose starter workflow
      </button>

      {preview ? (
        <div className="graph-patch-diff" data-testid="graph-patch-diff">
          <div className="graph-patch-diff-heading">
            <GitPullRequestArrow size={16} aria-hidden="true" />
            <strong>{pendingPatch?.title ?? "Graph patch"}</strong>
          </div>
          <dl>
            <div>
              <dt>Added nodes</dt>
              <dd>{preview.summary.addedNodes}</dd>
            </div>
            <div>
              <dt>Changed nodes</dt>
              <dd>{preview.summary.changedNodes}</dd>
            </div>
            <div>
              <dt>Removed nodes</dt>
              <dd>{preview.summary.removedNodes}</dd>
            </div>
            <div>
              <dt>Added edges</dt>
              <dd>{preview.summary.addedEdges}</dd>
            </div>
            <div>
              <dt>Changed edges</dt>
              <dd>{preview.summary.changedEdges}</dd>
            </div>
            <div>
              <dt>Removed edges</dt>
              <dd>{preview.summary.removedEdges}</dd>
            </div>
          </dl>
          <div className="graph-patch-actions">
            <button type="button" onClick={applyPendingPatch}>
              Apply Patch
            </button>
            <button type="button" onClick={rejectPatch}>
              Reject Patch
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function createStarterWorkflowPatch(): GraphPatch {
  const stamp = Date.now();
  const promptId = `copilot-prompt-${stamp}`;
  const generationId = `copilot-generation-${stamp}`;

  return {
    id: `desktop-starter-${stamp}`,
    title: "Starter prompt to image workflow",
    operations: [
      {
        type: "addNode",
        node: {
          id: promptId,
          type: "etherNode",
          position: { x: 220, y: 180 },
          width: 236,
          height: 188,
          selected: false,
          data: {
            ...createGraphNodeData("prompt-general"),
            instruction: "Describe the visual direction before running generation."
          }
        }
      },
      {
        type: "addNode",
        node: {
          id: generationId,
          type: "etherNode",
          position: { x: 540, y: 180 },
          width: 260,
          height: 188,
          selected: true,
          data: createGraphNodeData("generation-image")
        }
      },
      {
        type: "addEdge",
        edge: {
          id: `copilot-edge-${stamp}`,
          source: promptId,
          target: generationId,
          label: "prompt",
          data: { label: "prompt" }
        }
      }
    ]
  };
}
