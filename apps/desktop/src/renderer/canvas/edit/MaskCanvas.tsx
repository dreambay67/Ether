import { useEffect, useId, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Brush, Eraser, Redo2, RotateCcw, Save, Undo2 } from "lucide-react";
import type { DrawingPoint } from "@ether/schema";
import { drawingPath } from "../drawing/StrokeCanvas";

export type MaskTool = "brush" | "eraser";

export type MaskStroke = {
  id: string;
  tool: MaskTool;
  size: number;
  opacity: number;
  points: DrawingPoint[];
};

export type MaskGeometry = {
  width: number;
  height: number;
  strokes: MaskStroke[];
};

export type RasterReadyMask = {
  content: string;
  mimeType: "image/svg+xml";
  width: number;
  height: number;
  polarity: "white-selected-black-clear";
};

export type MaskCommitResult = {
  geometry: MaskGeometry;
  raster: RasterReadyMask;
};

export type MaskCanvasProps = {
  sourceKey: string;
  sourcePreviewUrl: string;
  sourceLabel: string;
  width?: number;
  height?: number;
  initialGeometry?: MaskGeometry;
  disabled?: boolean;
  onGeometryChange?(geometry: MaskGeometry): void;
  onCommit(result: MaskCommitResult): void;
};

const DEFAULT_WIDTH = 1024;
const DEFAULT_HEIGHT = 768;
const HISTORY_LIMIT = 50;

export function MaskCanvas({
  sourcePreviewUrl,
  sourceKey,
  sourceLabel,
  width = DEFAULT_WIDTH,
  height = DEFAULT_HEIGHT,
  initialGeometry,
  disabled = false,
  onGeometryChange,
  onCommit
}: MaskCanvasProps) {
  const initial = normalizeGeometry(initialGeometry, width, height);
  const [tool, setTool] = useState<MaskTool>("brush");
  const [brushSize, setBrushSize] = useState(36);
  const [opacity, setOpacity] = useState(.7);
  const [strokes, setStrokes] = useState<MaskStroke[]>(initial.strokes);
  const [draft, setDraft] = useState<MaskStroke | null>(null);
  const [undoStack, setUndoStack] = useState<MaskStroke[][]>([]);
  const [redoStack, setRedoStack] = useState<MaskStroke[][]>([]);
  const overlayMaskId = `ether-mask-${useId().replaceAll(":", "")}`;
  const pointerIdRef = useRef<number | null>(null);
  const draftRef = useRef<MaskStroke | null>(null);
  const strokesRef = useRef(initial.strokes);
  const externalSignatureRef = useRef(geometrySignature(sourceKey, initialGeometry, width, height));
  const emittedSignatureRef = useRef<string | null>(null);

  useEffect(() => {
    const nextSignature = geometrySignature(sourceKey, initialGeometry, width, height);
    if (nextSignature === externalSignatureRef.current) return;
    externalSignatureRef.current = nextSignature;
    const next = normalizeGeometry(initialGeometry, width, height).strokes;
    strokesRef.current = next;
    setStrokes(next);
    if (nextSignature === emittedSignatureRef.current) {
      emittedSignatureRef.current = null;
      return;
    }
    setDraft(null);
    draftRef.current = null;
    pointerIdRef.current = null;
    setUndoStack([]);
    setRedoStack([]);
  }, [height, initialGeometry, sourceKey, width]);

  const renderedStrokes = useMemo(() => draft ? [...strokes, draft] : strokes, [draft, strokes]);
  const geometry: MaskGeometry = useMemo(() => ({ width, height, strokes }), [height, strokes, width]);

  const emitGeometry = (next: MaskStroke[]) => {
    const nextGeometry = { width, height, strokes: next };
    emittedSignatureRef.current = geometrySignature(sourceKey, nextGeometry, width, height);
    onGeometryChange?.(nextGeometry);
  };

  const applyHistory = (next: MaskStroke[], previous = strokesRef.current) => {
    setUndoStack((history) => [...history.slice(-(HISTORY_LIMIT - 1)), previous]);
    setRedoStack([]);
    strokesRef.current = next;
    setStrokes(next);
    emitGeometry(next);
  };

  const undo = () => {
    const previous = undoStack.at(-1);
    if (!previous) return;
    const current = strokesRef.current;
    setUndoStack((history) => history.slice(0, -1));
    setRedoStack((history) => [...history.slice(-(HISTORY_LIMIT - 1)), current]);
    strokesRef.current = previous;
    setStrokes(previous);
    emitGeometry(previous);
  };

  const redo = () => {
    const next = redoStack.at(-1);
    if (!next) return;
    const current = strokesRef.current;
    setRedoStack((history) => history.slice(0, -1));
    setUndoStack((history) => [...history.slice(-(HISTORY_LIMIT - 1)), current]);
    strokesRef.current = next;
    setStrokes(next);
    emitGeometry(next);
  };

  const clear = () => {
    if (strokesRef.current.length === 0) return;
    applyHistory([], strokesRef.current);
  };

  const pointFromEvent = (event: ReactPointerEvent<SVGSVGElement>): DrawingPoint => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: clamp(((event.clientX - rect.left) / Math.max(1, rect.width)) * width, 0, width),
      y: clamp(((event.clientY - rect.top) / Math.max(1, rect.height)) * height, 0, height),
      pressure: event.pressure > 0 ? event.pressure : .5
    };
  };

  const start = (event: ReactPointerEvent<SVGSVGElement>) => {
    event.stopPropagation();
    if (disabled || !event.isPrimary || event.button !== 0 || pointerIdRef.current !== null) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointerIdRef.current = event.pointerId;
    const next: MaskStroke = {
      id: crypto.randomUUID(),
      tool,
      size: brushSize,
      opacity,
      points: [pointFromEvent(event)]
    };
    draftRef.current = next;
    setDraft(next);
  };

  const move = (event: ReactPointerEvent<SVGSVGElement>) => {
    event.stopPropagation();
    const current = draftRef.current;
    if (disabled || !current || pointerIdRef.current !== event.pointerId || event.buttons !== 1) return;
    const nextPoint = pointFromEvent(event);
    const last = current.points.at(-1);
    if (last && Math.hypot(last.x - nextPoint.x, last.y - nextPoint.y) < .5) return;
    const next = { ...current, points: [...current.points, nextPoint] };
    draftRef.current = next;
    setDraft(next);
  };

  const finish = (event: ReactPointerEvent<SVGSVGElement>, cancelled: boolean) => {
    event.stopPropagation();
    if (pointerIdRef.current !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    pointerIdRef.current = null;
    const completed = draftRef.current;
    draftRef.current = null;
    setDraft(null);
    if (!cancelled && completed && completed.points.length > 0) applyHistory([...strokesRef.current, completed]);
  };

  const commit = () => {
    onCommit({
      geometry,
      raster: {
        content: buildMaskSvg(geometry),
        mimeType: "image/svg+xml",
        width,
        height,
        polarity: "white-selected-black-clear"
      }
    });
  };

  return (
    <section className="mask-canvas" data-testid="mask-canvas" aria-label="Mask editor">
      <div className="mask-tool-row nodrag nopan" role="toolbar" aria-label="Mask tools" onPointerDown={(event) => event.stopPropagation()}>
        <button type="button" aria-label="Mask brush" aria-pressed={tool === "brush"} onClick={() => setTool("brush")} disabled={disabled}><Brush size={14} aria-hidden="true" />Brush</button>
        <button type="button" aria-label="Mask eraser" aria-pressed={tool === "eraser"} onClick={() => setTool("eraser")} disabled={disabled}><Eraser size={14} aria-hidden="true" />Eraser</button>
        <button type="button" aria-label="Undo mask stroke" onClick={undo} disabled={disabled || undoStack.length === 0}><Undo2 size={14} aria-hidden="true" /></button>
        <button type="button" aria-label="Redo mask stroke" onClick={redo} disabled={disabled || redoStack.length === 0}><Redo2 size={14} aria-hidden="true" /></button>
        <button type="button" aria-label="Clear mask" onClick={clear} disabled={disabled || strokes.length === 0}><RotateCcw size={14} aria-hidden="true" /></button>
        <label>Size<input aria-label="Mask brush size" type="range" min="4" max="160" value={brushSize} onChange={(event) => setBrushSize(Number(event.target.value))} disabled={disabled} /></label>
        <label>Opacity<input aria-label="Mask opacity" type="range" min="0.1" max="1" step="0.05" value={opacity} onChange={(event) => setOpacity(Number(event.target.value))} disabled={disabled} /></label>
      </div>
      <div className="mask-canvas-frame" style={{ aspectRatio: `${width} / ${height}` }}>
        <img data-testid="mask-canvas-source" src={sourcePreviewUrl} alt={`${sourceLabel} source`} draggable={false} />
        <svg
          data-testid="mask-canvas-overlay"
          role="img"
          aria-label="Editable mask overlay"
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={(event) => finish(event, false)}
          onPointerCancel={(event) => finish(event, true)}
        >
          <defs>
            <mask id={overlayMaskId}>
              <rect width={width} height={height} fill="black" />
              {renderedStrokes.map((stroke) => (
                <path key={stroke.id} d={drawingPath(stroke.points)} fill="none" stroke={stroke.tool === "brush" ? "white" : "black"} strokeWidth={stroke.size} strokeLinecap="round" strokeLinejoin="round" opacity={stroke.opacity} />
              ))}
            </mask>
          </defs>
          <rect width={width} height={height} fill="transparent" pointerEvents="all" />
          <rect width={width} height={height} fill="#37e6ea" opacity=".68" mask={`url(#${overlayMaskId})`} pointerEvents="none" />
        </svg>
      </div>
      <footer className="mask-action-row">
        <span aria-live="polite">{strokes.length} mask stroke{strokes.length === 1 ? "" : "s"}</span>
        <button type="button" className="run-node-button" onClick={commit} disabled={disabled}><Save size={14} aria-hidden="true" />Commit mask</button>
      </footer>
    </section>
  );
}

export function buildMaskSvg(geometry: MaskGeometry) {
  const paths = geometry.strokes.map((stroke) => (
    `  <path d="${drawingPath(stroke.points)}" fill="none" stroke="${stroke.tool === "brush" ? "#ffffff" : "#000000"}" stroke-width="${stroke.size}" stroke-linecap="round" stroke-linejoin="round" opacity="${stroke.opacity.toFixed(3)}" data-tool="${stroke.tool}"/>`
  )).join("\n");
  const metadata = escapeXml(JSON.stringify({ version: 1, geometry, polarity: "white-selected-black-clear" }));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${geometry.width}" height="${geometry.height}" viewBox="0 0 ${geometry.width} ${geometry.height}" role="img" aria-label="Ether raster-ready mask">
  <title>Ether raster-ready mask</title>
  <rect width="${geometry.width}" height="${geometry.height}" fill="#000000"/>
${paths}
  <metadata>${metadata}</metadata>
</svg>`;
}

function normalizeGeometry(value: MaskGeometry | undefined, width: number, height: number): MaskGeometry {
  return value ? { width, height, strokes: value.strokes } : { width, height, strokes: [] };
}

function geometrySignature(sourceKey: string, value: MaskGeometry | undefined, width: number, height: number) {
  return JSON.stringify({ sourceKey, geometry: normalizeGeometry(value, width, height) });
}

function escapeXml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
