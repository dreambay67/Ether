import { Eraser } from "lucide-react";
import { coerceNoteStrokes, type CanvasNodeData, type NoteStroke } from "@ether/engine/graph/nodeCatalog";
import { StrokeCanvas } from "../drawing/StrokeCanvas";

type NoteNodeVisualProps = {
  nodeId: string;
  data: CanvasNodeData;
  isLocked: boolean;
  onUpdateData(nodeId: string, updates: Partial<CanvasNodeData>, traceMessage?: string): void;
};

function noteText(data: CanvasNodeData) {
  return data.notes || data.instruction || "";
}

function updateStrokes(
  nodeId: string,
  strokes: NoteStroke[],
  onUpdateData: NoteNodeVisualProps["onUpdateData"]
) {
  onUpdateData(nodeId, { noteStrokes: strokes }, "Updated note drawing");
}

export function NoteNodeVisual({ nodeId, data, isLocked, onUpdateData }: NoteNodeVisualProps) {
  const subtype = data.subtype.toLowerCase();
  const text = noteText(data);

  if (subtype === "cloud") {
    return (
      <div className="note-node-visual note-node-visual-cloud" data-testid="note-visual-cloud">
        <svg viewBox="0 0 240 136" aria-hidden="true" preserveAspectRatio="none">
          <path d="M55 111 C29 111 13 95 17 73 C20 55 35 44 53 45 C59 25 77 14 99 19 C111 7 132 4 150 14 C166 23 174 37 174 53 C194 50 214 62 221 82 C228 102 212 120 187 120 L57 120 C56 117 55 114 55 111 Z" />
        </svg>
        <div className="note-node-content">
          <h3>{data.title}</h3>
          {text ? <p>{text}</p> : <p className="note-node-empty">Cloud note</p>}
        </div>
      </div>
    );
  }

  if (subtype === "bubble") {
    return (
      <div className="note-node-visual note-node-visual-bubble" data-testid="note-visual-bubble">
        <svg viewBox="0 0 240 136" aria-hidden="true" preserveAspectRatio="none">
          <ellipse cx="120" cy="62" rx="96" ry="48" />
          <path d="M86 104 C78 118 65 125 49 127 C58 118 61 109 59 98" />
        </svg>
        <div className="note-node-content">
          <h3>{data.title}</h3>
          {text ? <p>{text}</p> : <p className="note-node-empty">Bubble note</p>}
        </div>
      </div>
    );
  }

  if (subtype === "free draw") {
    const strokes = coerceNoteStrokes(data.noteStrokes);

    return (
      <div className="note-node-visual note-node-visual-free-draw" data-testid="note-visual-free-draw">
        <div className="note-drawing-header">
          <div>
            <h3>{data.title}</h3>
            <span>{strokes.length} stroke{strokes.length === 1 ? "" : "s"}</span>
          </div>
          <button
            type="button"
            className="nodrag nopan"
            aria-label="Clear drawing"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              updateStrokes(nodeId, [], onUpdateData);
            }}
            disabled={isLocked || strokes.length === 0}
          >
            <Eraser size={13} aria-hidden="true" />
          </button>
        </div>
        <StrokeCanvas
          strokes={strokes}
          disabled={isLocked}
          onChange={(nextStrokes) => updateStrokes(nodeId, nextStrokes, onUpdateData)}
        />
      </div>
    );
  }

  return (
    <div className="ether-node-main">
      <h3>{data.title}</h3>
      {text ? <p className="ether-node-body">{text}</p> : null}
    </div>
  );
}
