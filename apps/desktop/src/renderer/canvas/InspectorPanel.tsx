import type { Edge, Node } from "@xyflow/react";
import { Trash2 } from "lucide-react";
import type { CanvasNodeData } from "@ether/engine";

type InspectorPanelProps = {
  selectedNode: Node<CanvasNodeData> | null;
  selectedEdge: Edge | null;
  onUpdateNode(id: string, updates: Partial<CanvasNodeData>): void;
  onUpdateEdge(id: string, label: string): void;
  onDeleteSelection(): void;
};

export function InspectorPanel({
  selectedNode,
  selectedEdge,
  onUpdateNode,
  onUpdateEdge,
  onDeleteSelection
}: InspectorPanelProps) {
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
            value={selectedNode.data.title}
            onChange={(event) => onUpdateNode(selectedNode.id, { title: event.target.value })}
            data-testid="inspector-node-title"
          />
        </label>
        <label>
          Label
          <input
            value={selectedNode.data.label}
            onChange={(event) => onUpdateNode(selectedNode.id, { label: event.target.value })}
            data-testid="inspector-node-label"
          />
        </label>
        <label>
          Instruction
          <textarea
            value={selectedNode.data.instruction}
            onChange={(event) => onUpdateNode(selectedNode.id, { instruction: event.target.value })}
          />
        </label>
        <label>
          Notes
          <textarea
            value={selectedNode.data.notes}
            onChange={(event) => onUpdateNode(selectedNode.id, { notes: event.target.value })}
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
            value={String(selectedEdge.label ?? selectedEdge.data?.label ?? "")}
            onChange={(event) => onUpdateEdge(selectedEdge.id, event.target.value)}
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
