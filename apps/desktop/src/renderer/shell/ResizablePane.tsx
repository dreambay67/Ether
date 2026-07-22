import { useEffect, useRef } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from "lucide-react";
import type { ReactNode } from "react";

export function ResizablePane({
  id,
  label,
  size,
  collapsed,
  direction = "horizontal",
  side = "end",
  minSize,
  maxSize,
  onResize,
  onToggle,
  children
}: {
  id: string;
  label: string;
  size: number;
  collapsed: boolean;
  direction?: "horizontal" | "vertical";
  side?: "start" | "end";
  minSize: number;
  maxSize: number;
  onResize(size: number): void;
  onToggle(): void;
  children: ReactNode;
}) {
  const start = useRef<number | null>(null);
  const initialSize = useRef(size);
  const isVertical = direction === "vertical";
  const collapseLabel = collapsed ? `Show ${label}` : `Hide ${label}`;

  useEffect(() => {
    const move = (event: PointerEvent) => {
      if (start.current === null) return;
      const delta = (isVertical ? event.clientY : event.clientX) - start.current;
      onResize(initialSize.current + (side === "start" ? delta : -delta));
    };
    const end = () => { start.current = null; };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
    };
  }, [isVertical, onResize, side]);

  return (
    <section
      className={`resizable-pane resizable-pane-${id} is-${side} ${collapsed ? "is-collapsed" : ""}`}
      data-testid={`pane-${id}`}
      aria-label={label}
      style={collapsed ? undefined : (isVertical ? { height: size } : { width: size })}
    >
      <header className="resizable-pane-header">
        <strong>{label}</strong>
        <button type="button" aria-label={collapseLabel} title={collapseLabel} onClick={onToggle}>
          {isVertical ? (collapsed ? <ChevronUp size={15} /> : <ChevronDown size={15} />) : (collapsed ? <ChevronRight size={15} /> : <ChevronLeft size={15} />)}
        </button>
      </header>
      {!collapsed ? <div className="resizable-pane-content">{children}</div> : null}
      {!collapsed ? (
        <div
          className={`pane-resizer ${isVertical ? "is-horizontal" : "is-vertical"}`}
          role="separator"
          aria-label={`Resize ${label}`}
          aria-orientation={isVertical ? "horizontal" : "vertical"}
          aria-valuemin={minSize}
          aria-valuemax={maxSize}
          aria-valuenow={Math.round(size)}
          tabIndex={0}
          onPointerDown={(event) => {
            start.current = isVertical ? event.clientY : event.clientX;
            initialSize.current = size;
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onKeyDown={(event) => {
            const decreaseKey = isVertical
              ? (side === "start" ? "ArrowUp" : "ArrowDown")
              : (side === "start" ? "ArrowLeft" : "ArrowRight");
            const increaseKey = isVertical
              ? (side === "start" ? "ArrowDown" : "ArrowUp")
              : (side === "start" ? "ArrowRight" : "ArrowLeft");
            if (event.key !== decreaseKey && event.key !== increaseKey) return;
            event.preventDefault();
            const increment = event.shiftKey ? 48 : 16;
            onResize(size + (event.key === increaseKey ? increment : -increment));
          }}
        />
      ) : null}
    </section>
  );
}
