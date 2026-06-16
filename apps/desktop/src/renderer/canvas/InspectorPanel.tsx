import { useEffect, useState, type KeyboardEvent } from "react";
import type { Edge, Node } from "@xyflow/react";
import { Trash2 } from "lucide-react";
import type { CanvasNodeData } from "@ether/engine";

type InspectorPanelProps = {
  selectedNode: Node<CanvasNodeData> | null;
  selectedEdge: Edge | null;
  onPreviewNode(id: string, updates: Partial<CanvasNodeData>): void;
  onPreviewEdge(id: string, label: string): void;
  onCommitTextEdit(): void;
  onDeleteSelection(): void;
};

export function InspectorPanel({
  selectedNode,
  selectedEdge,
  onPreviewNode,
  onPreviewEdge,
  onCommitTextEdit,
  onDeleteSelection
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
    return (
      <div className="inspector-form">
        <div className="inspector-meta">
          <span>{selectedNode.data.kind}</span>
          <span>{selectedNode.data.subtype}</span>
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
