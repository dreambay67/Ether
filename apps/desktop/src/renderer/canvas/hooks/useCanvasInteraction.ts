import { useCallback, useEffect, useRef, useState } from "react";

export type CanvasInteractionMode =
  | "idle"
  | "selecting"
  | "marquee"
  | "moving"
  | "panning"
  | "connecting"
  | "resizing"
  | "editing";

export function useCanvasInteraction(selectedIds: readonly string[], onSelected: (ids: string[]) => void) {
  const [mode, setMode] = useState<CanvasInteractionMode>("idle");
  const currentSelection = useRef<string[]>([...selectedIds]);
  const marqueeBase = useRef<string[]>([]);
  const marqueeAdditive = useRef(false);
  const marqueeActive = useRef(false);

  useEffect(() => {
    currentSelection.current = [...selectedIds];
  }, [selectedIds]);

  const commit = useCallback((ids: readonly string[]) => {
    const next = unique(ids);
    if (sameIds(currentSelection.current, next)) return;
    currentSelection.current = next;
    onSelected(next);
  }, [onSelected]);

  const settle = useCallback(() => setMode("idle"), []);
  const selectNode = useCallback((id: string, additive: boolean) => {
    setMode("selecting");
    commit(additive ? toggleId(currentSelection.current, id) : [id]);
    queueMicrotask(settle);
  }, [commit, settle]);
  const clearSelection = useCallback(() => {
    setMode("selecting");
    commit([]);
    queueMicrotask(settle);
  }, [commit, settle]);
  const beginMarquee = useCallback((additive: boolean) => {
    const start = marqueeSelectionStart(currentSelection.current, additive);
    marqueeBase.current = start.base;
    marqueeAdditive.current = additive;
    marqueeActive.current = true;
    setMode("marquee");
    commit(start.selection);
  }, [commit]);
  const updateMarquee = useCallback((ids: readonly string[]) => {
    if (!marqueeActive.current) return;
    commit(marqueeSelectionUpdate(marqueeBase.current, ids, marqueeAdditive.current));
  }, [commit]);
  const endMarquee = useCallback(() => {
    marqueeActive.current = false;
    marqueeBase.current = [];
    marqueeAdditive.current = false;
    settle();
  }, [settle]);
  const cancel = useCallback(() => {
    if (mode === "marquee") commit(marqueeBase.current);
    if (mode === "idle" || mode === "selecting") commit([]);
    marqueeActive.current = false;
    marqueeBase.current = [];
    marqueeAdditive.current = false;
    settle();
  }, [commit, mode, settle]);

  return {
    mode,
    selectNode,
    clearSelection,
    beginMarquee,
    updateMarquee,
    endMarquee,
    beginMove: useCallback((id?: string) => {
      if (id !== undefined && !currentSelection.current.includes(id)) commit([id]);
      setMode("moving");
    }, [commit]),
    beginPan: useCallback(() => setMode("panning"), []),
    beginConnect: useCallback(() => setMode("connecting"), []),
    beginResize: useCallback(() => setMode("resizing"), []),
    beginEdit: useCallback(() => setMode("editing"), []),
    settle,
    cancel
  };
}

export function toggleId(ids: readonly string[], id: string) {
  return ids.includes(id) ? ids.filter((candidate) => candidate !== id) : [...ids, id];
}

export function marqueeSelectionStart(ids: readonly string[], additive: boolean) {
  const base = [...ids];
  return { base, selection: additive ? base : [] };
}

export function marqueeSelectionUpdate(base: readonly string[], hits: readonly string[], additive: boolean) {
  return unique(additive ? [...base, ...hits] : hits);
}

export function marqueeHitIds(
  nodes: readonly { id: string; rect: { x: number; y: number; width: number; height: number } }[],
  start: { x: number; y: number },
  end: { x: number; y: number }
) {
  if (Math.hypot(end.x - start.x, end.y - start.y) <= 1) return [];
  const left = Math.min(start.x, end.x);
  const right = Math.max(start.x, end.x);
  const top = Math.min(start.y, end.y);
  const bottom = Math.max(start.y, end.y);
  return nodes.filter(({ rect }) => (
    rect.x < right && rect.x + rect.width > left && rect.y < bottom && rect.y + rect.height > top
  )).map(({ id }) => id);
}

export function marqueeRectangle(
  start: { x: number; y: number },
  end: { x: number; y: number },
  surface: { left: number; top: number }
) {
  const left = Math.min(start.x, end.x) - surface.left;
  const top = Math.min(start.y, end.y) - surface.top;
  return {
    left,
    top,
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y)
  };
}

function unique(ids: readonly string[]) {
  return [...new Set(ids)];
}

function sameIds(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}
