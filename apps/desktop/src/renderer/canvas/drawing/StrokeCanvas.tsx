import { useId, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { NoteStroke, NoteStrokePoint } from "@ether/engine/graph/nodeCatalog";

type StrokeCanvasProps = {
  strokes: NoteStroke[];
  disabled?: boolean;
  onChange(strokes: NoteStroke[]): void;
};

function pointToPath(points: NoteStrokePoint[]) {
  if (points.length === 0) {
    return "";
  }

  const [first, ...rest] = points;
  return [
    `M ${first.x * 100} ${first.y * 100}`,
    ...rest.map((point) => `L ${point.x * 100} ${point.y * 100}`)
  ].join(" ");
}

function pointFromEvent(event: ReactPointerEvent<SVGSVGElement>): NoteStrokePoint {
  const rect = event.currentTarget.getBoundingClientRect();

  return {
    x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
    y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))
  };
}

export function StrokeCanvas({ strokes, disabled = false, onChange }: StrokeCanvasProps) {
  const patternId = useId();
  const activePointerIdRef = useRef<number | null>(null);
  const draftPointsRef = useRef<NoteStrokePoint[]>([]);
  const [draftPoints, setDraftPoints] = useState<NoteStrokePoint[]>([]);
  const renderedStrokes = useMemo(
    () =>
      draftPoints.length > 0
        ? strokes.concat({
            id: "draft",
            points: draftPoints,
            color: "#37e6ea",
            width: 4
          })
        : strokes,
    [draftPoints, strokes]
  );

  const stopDrawingEvent = (event: ReactPointerEvent<SVGSVGElement>) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const startStroke = (event: ReactPointerEvent<SVGSVGElement>) => {
    stopDrawingEvent(event);

    if (disabled || !event.isPrimary || event.button !== 0) {
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    const firstPoint = pointFromEvent(event);
    activePointerIdRef.current = event.pointerId;
    draftPointsRef.current = [firstPoint];
    setDraftPoints([firstPoint]);
  };

  const extendStroke = (event: ReactPointerEvent<SVGSVGElement>) => {
    stopDrawingEvent(event);

    if (disabled || activePointerIdRef.current !== event.pointerId || event.buttons !== 1) {
      return;
    }

    const nextPoint = pointFromEvent(event);
    const nextPoints = draftPointsRef.current.concat(nextPoint);
    draftPointsRef.current = nextPoints;
    setDraftPoints(nextPoints);
  };

  const finishStroke = (event: ReactPointerEvent<SVGSVGElement>) => {
    stopDrawingEvent(event);

    if (activePointerIdRef.current !== event.pointerId) {
      return;
    }

    const finalPoints = draftPointsRef.current.length > 0
      ? draftPointsRef.current.concat(pointFromEvent(event))
      : draftPointsRef.current;

    activePointerIdRef.current = null;
    draftPointsRef.current = [];
    setDraftPoints([]);

    if (!disabled && finalPoints.length > 1) {
      onChange(
        strokes.concat({
          id: `stroke-${Date.now()}`,
          points: finalPoints,
          color: "#37e6ea",
          width: 4
        })
      );
    }
  };

  return (
    <svg
      className="note-stroke-canvas nodrag nopan"
      data-testid="note-stroke-surface"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      role="img"
      aria-label={disabled ? "Locked drawing" : "Free draw note surface"}
      onPointerDown={startStroke}
      onPointerMove={extendStroke}
      onPointerUp={finishStroke}
      onPointerCancel={finishStroke}
    >
      <defs>
        <pattern id={patternId} width="10" height="10" patternUnits="userSpaceOnUse">
          <path d="M 10 0 L 0 0 0 10" />
        </pattern>
      </defs>
      <rect className="note-stroke-grid" x="0" y="0" width="100" height="100" fill={`url(#${patternId})`} />
      {renderedStrokes.map((stroke) => (
        <path
          key={stroke.id}
          data-testid={stroke.id === "draft" ? "note-stroke-draft" : "note-stroke"}
          d={pointToPath(stroke.points)}
          vectorEffect="non-scaling-stroke"
          stroke={stroke.color ?? "#37e6ea"}
          strokeWidth={stroke.width ?? 4}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      ))}
    </svg>
  );
}
