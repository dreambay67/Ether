import { useCallback, useMemo, useRef, useState, type MouseEvent, type PointerEvent } from "react";
import { Brush, Eraser, RotateCcw, Save } from "lucide-react";
import { localImageSource } from "../../artifacts/localImageSource";

type MaskTool = "brush" | "eraser";

type MaskPoint = {
  x: number;
  y: number;
};

type MaskStroke = {
  id: string;
  tool: MaskTool;
  size: number;
  opacity: number;
  points: MaskPoint[];
};

export type MaskSaveResult = {
  content: string;
  mimeType: "image/svg+xml";
  metadata: Record<string, unknown>;
};

type MaskCanvasProps = {
  sourceImagePath: string;
  sourceLabel: string;
  disabled?: boolean;
  onSave(result: MaskSaveResult): void;
};

const CANVAS_WIDTH = 1024;
const CANVAS_HEIGHT = 768;

export function MaskCanvas({ sourceImagePath, sourceLabel, disabled = false, onSave }: MaskCanvasProps) {
  const [tool, setTool] = useState<MaskTool>("brush");
  const [brushSize, setBrushSize] = useState(28);
  const [opacityPercent, setOpacityPercent] = useState(60);
  const [strokes, setStrokes] = useState<MaskStroke[]>([]);
  const activeStrokeId = useRef<string | null>(null);
  const activePointerId = useRef<number | null>(null);
  const isErasing = useRef(false);
  const pressHandled = useRef(false);
  const overlayRef = useRef<SVGSVGElement | null>(null);
  const opacity = opacityPercent / 100;

  const metadata = useMemo(
    () => ({
      brush: { tool, size: brushSize, opacity },
      canvas: { width: CANVAS_WIDTH, height: CANVAS_HEIGHT },
      strokeCount: strokes.length,
      strokes: strokes.map((stroke) => ({
        tool: stroke.tool,
        size: stroke.size,
        opacity: stroke.opacity,
        points: stroke.points
      }))
    }),
    [brushSize, opacity, strokes, tool]
  );

  const save = () => {
    onSave({
      content: buildMaskSvg(strokes, metadata),
      mimeType: "image/svg+xml",
      metadata
    });
  };

  const eraseAt = useCallback((point: MaskPoint) => {
    setStrokes((current) =>
      current.filter((stroke) => {
        const threshold = Math.max(brushSize, stroke.size) * 0.85;
        return !stroke.points.some((candidate) => distance(candidate, point) <= threshold);
      })
    );
  }, [brushSize]);

  const beginStrokeAt = (point: MaskPoint) => {
    if (disabled) {
      return;
    }

    if (activeStrokeId.current || isErasing.current) {
      return;
    }

    pressHandled.current = true;

    if (tool === "eraser") {
      isErasing.current = true;
      eraseAt(point);
      return;
    }

    const id = `stroke-${Date.now()}-${Math.round(point.x)}-${Math.round(point.y)}`;
    activeStrokeId.current = id;
    setStrokes((current) => [
      ...current,
      {
        id,
        tool,
        size: brushSize,
        opacity,
        points: [point]
      }
    ]);
  };

  const continueStrokeAt = (point: MaskPoint) => {
    if (disabled) {
      return;
    }

    if (isErasing.current) {
      eraseAt(point);
      return;
    }

    const id = activeStrokeId.current;
    if (!id) {
      return;
    }

    setStrokes((current) =>
      current.map((stroke) =>
        stroke.id === id ? { ...stroke, points: [...stroke.points, point] } : stroke
      )
    );
  };

  const finishStroke = () => {
    activeStrokeId.current = null;
    isErasing.current = false;
  };

  const startStroke = (event: PointerEvent<SVGSVGElement>) => {
    if (
      disabled ||
      activePointerId.current !== null ||
      activeStrokeId.current ||
      isErasing.current ||
      !event.isPrimary ||
      event.button !== 0
    ) {
      return;
    }

    activePointerId.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    beginStrokeAt(pointFromClient(event.currentTarget, event.clientX, event.clientY));
  };

  const continueStroke = (event: PointerEvent<SVGSVGElement>) => {
    if (activePointerId.current !== event.pointerId || !event.isPrimary) {
      return;
    }

    continueStrokeAt(pointFromClient(event.currentTarget, event.clientX, event.clientY));
  };

  const endStroke = (event: PointerEvent<SVGSVGElement>) => {
    const isCancel = event.type === "pointercancel";

    if (
      activePointerId.current !== event.pointerId ||
      !event.isPrimary ||
      (!isCancel && event.button !== 0)
    ) {
      return;
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    activePointerId.current = null;
    finishStroke();
  };

  const clickStroke = (event: MouseEvent<SVGSVGElement>) => {
    if (activePointerId.current !== null) {
      return;
    }

    if (pressHandled.current) {
      pressHandled.current = false;
      return;
    }

    const point = pointFromClient(event.currentTarget, event.clientX, event.clientY);

    if (tool === "eraser") {
      eraseAt(point);
      return;
    }

    const id = `stroke-${Date.now()}-${Math.round(point.x)}-${Math.round(point.y)}`;
    setStrokes((current) => [
      ...current,
      {
        id,
        tool,
        size: brushSize,
        opacity,
        points: [point]
      }
    ]);
  };

  const startMouseStroke = (event: MouseEvent<SVGSVGElement>) => {
    if (activePointerId.current !== null || event.button !== 0) {
      return;
    }

    beginStrokeAt(pointFromClient(event.currentTarget, event.clientX, event.clientY));
  };

  const continueMouseStroke = (event: MouseEvent<SVGSVGElement>) => {
    if (activePointerId.current !== null || event.buttons !== 1) {
      return;
    }

    continueStrokeAt(pointFromClient(event.currentTarget, event.clientX, event.clientY));
  };

  const finishMouseStroke = () => {
    if (activePointerId.current !== null) {
      return;
    }

    finishStroke();
  };

  return (
    <div className="mask-canvas" data-testid="mask-canvas">
      <div className="mask-tool-row" role="toolbar" aria-label="Mask tools">
        <button
          type="button"
          aria-label="Brush"
          aria-pressed={tool === "brush"}
          onClick={() => setTool("brush")}
          disabled={disabled}
        >
          <Brush size={14} aria-hidden="true" />
          Brush
        </button>
        <button
          type="button"
          aria-label="Eraser"
          aria-pressed={tool === "eraser"}
          onClick={() => setTool("eraser")}
          disabled={disabled}
        >
          <Eraser size={14} aria-hidden="true" />
          Eraser
        </button>
      </div>
      <div className="mask-control-grid">
        <label>
          Brush size
          <input
            aria-label="Brush size"
            type="range"
            min={4}
            max={96}
            step={1}
            value={brushSize}
            onChange={(event) => setBrushSize(Number(event.target.value))}
            disabled={disabled}
          />
        </label>
        <label>
          Mask opacity
          <input
            aria-label="Mask opacity"
            type="range"
            min={5}
            max={100}
            step={5}
            value={opacityPercent}
            onChange={(event) => setOpacityPercent(Number(event.target.value))}
            disabled={disabled}
          />
        </label>
      </div>
      <div className="mask-canvas-frame">
        <img
          data-testid="mask-canvas-source"
          src={localImageSource(sourceImagePath)}
          alt={`${sourceLabel} source`}
          draggable={false}
        />
        <svg
          ref={overlayRef}
          data-testid="mask-canvas-overlay"
          role="img"
          aria-label="Editable mask overlay"
          viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`}
          preserveAspectRatio="none"
          onPointerDown={startStroke}
          onPointerMove={continueStroke}
          onPointerUp={endStroke}
          onPointerCancel={endStroke}
          onMouseDown={startMouseStroke}
          onMouseMove={continueMouseStroke}
          onMouseUp={finishMouseStroke}
          onMouseLeave={finishMouseStroke}
          onClick={clickStroke}
        >
          <rect width={CANVAS_WIDTH} height={CANVAS_HEIGHT} fill="transparent" pointerEvents="all" />
          {strokes.map((stroke) => (
            <path
              key={stroke.id}
              data-testid="mask-stroke"
              d={pathForPoints(stroke.points)}
              fill="none"
              stroke={stroke.tool === "eraser" ? "#05090f" : "#37e6ea"}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={stroke.size}
              opacity={stroke.opacity}
            />
          ))}
        </svg>
      </div>
      <div className="mask-action-row">
        <button
          type="button"
          className="run-node-button"
          onClick={() => setStrokes([])}
          disabled={disabled || strokes.length === 0}
        >
          <RotateCcw size={14} aria-hidden="true" />
          Clear mask
        </button>
        <button type="button" className="run-node-button" onClick={save} disabled={disabled}>
          <Save size={14} aria-hidden="true" />
          Save mask
        </button>
      </div>
    </div>
  );
}

function pointFromClient(element: SVGSVGElement, clientX: number, clientY: number): MaskPoint {
  const rect = element.getBoundingClientRect();
  const x = ((clientX - rect.left) / rect.width) * CANVAS_WIDTH;
  const y = ((clientY - rect.top) / rect.height) * CANVAS_HEIGHT;

  return {
    x: Math.max(0, Math.min(CANVAS_WIDTH, Math.round(x))),
    y: Math.max(0, Math.min(CANVAS_HEIGHT, Math.round(y)))
  };
}

function pathForPoints(points: MaskPoint[]) {
  if (points.length === 0) {
    return "";
  }

  if (points.length === 1) {
    const point = points[0]!;
    return `M ${point.x} ${point.y} l 0.01 0`;
  }

  return points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
    .join(" ");
}

function buildMaskSvg(strokes: MaskStroke[], metadata: Record<string, unknown>) {
  const paths = strokes
    .map(
      (stroke) =>
        `  <path d="${pathForPoints(stroke.points)}" fill="none" stroke="${
          stroke.tool === "eraser" ? "#000000" : "#ffffff"
        }" stroke-width="${stroke.size}" stroke-linecap="round" stroke-linejoin="round" opacity="${stroke.opacity.toFixed(
          3
        )}" data-tool="${stroke.tool}"/>`
    )
    .join("\n");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT}" viewBox="0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}" role="img" aria-label="Ether editable mask">
  <title>Ether editable mask</title>
  <rect width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT}" fill="transparent"/>
${paths}
  <metadata>${escapeXml(JSON.stringify(metadata))}</metadata>
</svg>`;
}

function distance(left: MaskPoint, right: MaskPoint) {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
