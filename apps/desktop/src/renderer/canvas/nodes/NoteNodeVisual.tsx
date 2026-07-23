import type { CanvasDrawingConfig, CanvasNoteConfig, DrawingStroke } from "@ether/schema";
import { StrokeCanvas, drawingPath } from "../drawing/StrokeCanvas";
import { NotePresentation } from "./NotePresentation";

export type NoteNodeVisualProps = {
  config: CanvasNoteConfig | CanvasDrawingConfig;
  compact?: boolean;
  disabled?: boolean;
  onDrawingChange?(strokes: DrawingStroke[]): void;
};

export function NoteNodeVisual({ config, compact = false, disabled = false, onDrawingChange }: NoteNodeVisualProps) {
  if (config.kind === "canvas.note") return <NotePresentation config={config} compact={compact} />;

  if (compact) {
    return (
      <div className="drawing-presentation" data-testid="drawing-presentation" style={{ background: config.background }}>
        <svg viewBox={`0 0 ${config.width} ${config.height}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label={`${config.strokes.length} stroke drawing`}>
          {config.strokes.map((stroke) => <path key={stroke.id} d={drawingPath(stroke.points)} fill="none" stroke={stroke.color} strokeWidth={stroke.width} strokeLinecap="round" strokeLinejoin="round" />)}
        </svg>
        {config.strokes.length === 0 ? <span>Blank drawing</span> : null}
      </div>
    );
  }

  return (
    <StrokeCanvas
      width={config.width}
      height={config.height}
      background={config.background}
      strokes={config.strokes}
      disabled={disabled || !onDrawingChange}
      onChange={(strokes) => onDrawingChange?.(strokes)}
    />
  );
}
