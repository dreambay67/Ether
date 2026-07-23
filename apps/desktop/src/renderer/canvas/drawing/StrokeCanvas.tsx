import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Brush, Eraser, Redo2, Undo2 } from "lucide-react";
import type { CanvasDrawingConfig, DrawingPoint, DrawingStroke } from "@ether/schema";

export type StrokeCanvasProps = {
  width: number;
  height: number;
  background: string;
  strokes: DrawingStroke[];
  disabled?: boolean;
  onChange(strokes: DrawingStroke[]): void;
};

type Tool = "brush" | "eraser";

const HISTORY_LIMIT = 50;

export function StrokeCanvas({ width, height, background, strokes, disabled = false, onChange }: StrokeCanvasProps) {
  const [tool, setTool] = useState<Tool>("brush");
  const [brushSize, setBrushSize] = useState(18);
  const [opacity, setOpacity] = useState(.8);
  const [color, setColor] = useState("#37e6ea");
  const [localStrokes, setLocalStrokes] = useState(strokes);
  const [draft, setDraft] = useState<DrawingPoint[]>([]);
  const [undoStack, setUndoStack] = useState<DrawingStroke[][]>([]);
  const [redoStack, setRedoStack] = useState<DrawingStroke[][]>([]);
  const pointerIdRef = useRef<number | null>(null);
  const draftRef = useRef<DrawingPoint[]>([]);
  const localStrokesRef = useRef(strokes);
  const gestureStartRef = useRef<DrawingStroke[] | null>(null);
  const externalSignatureRef = useRef(signature(strokes));
  const emittedSignatureRef = useRef<string | null>(null);

  useEffect(() => {
    const nextSignature = signature(strokes);
    if (nextSignature === externalSignatureRef.current) return;

    externalSignatureRef.current = nextSignature;
    localStrokesRef.current = strokes;
    setLocalStrokes(strokes);

    if (nextSignature === emittedSignatureRef.current) {
      emittedSignatureRef.current = null;
      return;
    }

    pointerIdRef.current = null;
    gestureStartRef.current = null;
    draftRef.current = [];
    setDraft([]);
    setUndoStack([]);
    setRedoStack([]);
  }, [strokes]);

  const rendered = useMemo(() => {
    if (draft.length === 0) return localStrokes;
    return [...localStrokes, {
      id: "ether-drawing-draft",
      color: colorWithOpacity(color, opacity),
      width: brushSize,
      points: draft
    }];
  }, [brushSize, color, draft, localStrokes, opacity]);

  const emit = (previous: DrawingStroke[], next: DrawingStroke[]) => {
    setUndoStack((history) => [...history.slice(-(HISTORY_LIMIT - 1)), previous]);
    setRedoStack([]);
    localStrokesRef.current = next;
    setLocalStrokes(next);
    emittedSignatureRef.current = signature(next);
    onChange(next);
  };

  const undo = () => {
    const previous = undoStack.at(-1);
    if (!previous) return;
    const current = localStrokesRef.current;
    setUndoStack((history) => history.slice(0, -1));
    setRedoStack((history) => [...history.slice(-(HISTORY_LIMIT - 1)), current]);
    localStrokesRef.current = previous;
    setLocalStrokes(previous);
    emittedSignatureRef.current = signature(previous);
    onChange(previous);
  };

  const redo = () => {
    const next = redoStack.at(-1);
    if (!next) return;
    const current = localStrokesRef.current;
    setRedoStack((history) => history.slice(0, -1));
    setUndoStack((history) => [...history.slice(-(HISTORY_LIMIT - 1)), current]);
    localStrokesRef.current = next;
    setLocalStrokes(next);
    emittedSignatureRef.current = signature(next);
    onChange(next);
  };

  const point = (event: ReactPointerEvent<SVGSVGElement>): DrawingPoint => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: clamp(((event.clientX - rect.left) / Math.max(1, rect.width)) * width, 0, width),
      y: clamp(((event.clientY - rect.top) / Math.max(1, rect.height)) * height, 0, height),
      pressure: event.pressure > 0 ? event.pressure : .5
    };
  };

  const erasePreview = (at: DrawingPoint) => {
    const threshold = Math.max(10, brushSize);
    const next = localStrokesRef.current.filter((stroke) => !stroke.points.some((candidate) => (
      Math.hypot(candidate.x - at.x, candidate.y - at.y) <= threshold + stroke.width / 2
    )));
    if (next.length === localStrokesRef.current.length) return;
    localStrokesRef.current = next;
    setLocalStrokes(next);
  };

  const start = (event: ReactPointerEvent<SVGSVGElement>) => {
    event.stopPropagation();
    if (disabled || !event.isPrimary || event.button !== 0 || pointerIdRef.current !== null) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointerIdRef.current = event.pointerId;
    gestureStartRef.current = localStrokesRef.current;
    const first = point(event);
    if (tool === "eraser") {
      erasePreview(first);
      return;
    }
    draftRef.current = [first];
    setDraft([first]);
  };

  const move = (event: ReactPointerEvent<SVGSVGElement>) => {
    event.stopPropagation();
    if (disabled || pointerIdRef.current !== event.pointerId || event.buttons !== 1) return;
    const nextPoint = point(event);
    if (tool === "eraser") {
      erasePreview(nextPoint);
      return;
    }
    const last = draftRef.current.at(-1);
    if (last && Math.hypot(last.x - nextPoint.x, last.y - nextPoint.y) < .5) return;
    draftRef.current = [...draftRef.current, nextPoint];
    setDraft(draftRef.current);
  };

  const endGesture = (event: ReactPointerEvent<SVGSVGElement>, cancelled: boolean) => {
    event.stopPropagation();
    if (pointerIdRef.current !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    pointerIdRef.current = null;
    const before = gestureStartRef.current ?? localStrokesRef.current;
    gestureStartRef.current = null;

    if (cancelled) {
      localStrokesRef.current = before;
      setLocalStrokes(before);
    } else if (tool === "brush" && draftRef.current.length > 0) {
      const nextStroke: DrawingStroke = {
        id: crypto.randomUUID(),
        color: colorWithOpacity(color, opacity),
        width: brushSize,
        points: draftRef.current
      };
      emit(before, [...before, nextStroke]);
    } else if (tool === "eraser" && signature(before) !== signature(localStrokesRef.current)) {
      emit(before, localStrokesRef.current);
    }

    draftRef.current = [];
    setDraft([]);
  };

  return (
    <div className="drawing-surface" data-testid="drawing-surface">
      <div className="drawing-toolbar nodrag nopan" role="toolbar" aria-label="Drawing tools" onPointerDown={(event) => event.stopPropagation()}>
        <button type="button" aria-label="Brush" aria-pressed={tool === "brush"} onClick={() => setTool("brush")} disabled={disabled}><Brush size={14} aria-hidden="true" />Brush</button>
        <button type="button" aria-label="Eraser" aria-pressed={tool === "eraser"} onClick={() => setTool("eraser")} disabled={disabled}><Eraser size={14} aria-hidden="true" />Eraser</button>
        <button type="button" aria-label="Undo stroke" onClick={undo} disabled={disabled || undoStack.length === 0}><Undo2 size={14} aria-hidden="true" /></button>
        <button type="button" aria-label="Redo stroke" onClick={redo} disabled={disabled || redoStack.length === 0}><Redo2 size={14} aria-hidden="true" /></button>
        <label>Color<input type="color" aria-label="Brush color" value={color} onChange={(event) => setColor(event.target.value)} disabled={disabled} /></label>
        <label>Size<input type="range" aria-label="Brush size" min="2" max="96" value={brushSize} onChange={(event) => setBrushSize(Number(event.target.value))} disabled={disabled} /></label>
        <label>Opacity<input type="range" aria-label="Brush opacity" min="0.1" max="1" step="0.05" value={opacity} onChange={(event) => setOpacity(Number(event.target.value))} disabled={disabled} /></label>
      </div>
      <svg
        className={`stroke-canvas nodrag nopan${tool === "eraser" ? " is-erasing" : ""}`}
        data-testid="stroke-canvas"
        data-tool={tool}
        data-stroke-count={localStrokes.length}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={disabled ? "Locked drawing" : "Editable drawing canvas"}
        style={{ background }}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={(event) => endGesture(event, false)}
        onPointerCancel={(event) => endGesture(event, true)}
      >
        {rendered.map((stroke) => <path key={stroke.id} data-testid={stroke.id === "ether-drawing-draft" ? "drawing-draft" : "drawing-stroke"} d={path(stroke.points)} fill="none" stroke={stroke.color} strokeWidth={stroke.width} strokeLinecap="round" strokeLinejoin="round" />)}
      </svg>
      <small aria-live="polite">{localStrokes.length} persistent stroke{localStrokes.length === 1 ? "" : "s"}</small>
    </div>
  );
}

export function drawingPath(points: DrawingPoint[]) {
  if (points.length === 1) return `M ${points[0]!.x.toFixed(2)} ${points[0]!.y.toFixed(2)} l 0.01 0`;
  return points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(" ");
}

export function buildDrawingSvg(drawing: CanvasDrawingConfig) {
  const paths = drawing.strokes.map((stroke) => (
    `  <path d="${drawingPath(stroke.points)}" fill="none" stroke="${escapeXml(stroke.color)}" stroke-width="${stroke.width}" stroke-linecap="round" stroke-linejoin="round"/>`
  )).join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${drawing.width}" height="${drawing.height}" viewBox="0 0 ${drawing.width} ${drawing.height}" role="img" aria-label="Ether published drawing">
  <title>Ether published drawing</title>
  <rect width="${drawing.width}" height="${drawing.height}" fill="${escapeXml(drawing.background)}"/>
${paths}
  <metadata>${escapeXml(JSON.stringify({ version: 1, drawing }))}</metadata>
</svg>`;
}

function path(points: DrawingPoint[]) {
  return drawingPath(points);
}

function colorWithOpacity(hex: string, opacity: number) {
  const alpha = Math.round(opacity * 255).toString(16).padStart(2, "0");
  return `${hex.slice(0, 7)}${alpha}`;
}

function escapeXml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function signature(value: DrawingStroke[]) {
  return JSON.stringify(value);
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
