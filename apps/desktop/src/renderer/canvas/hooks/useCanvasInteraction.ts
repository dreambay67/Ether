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
    setMode("marquee");
    commit(start.selection);
  }, [commit]);
  const updateMarquee = useCallback((ids: readonly string[]) => {
    commit(marqueeAdditive.current ? [...marqueeBase.current, ...ids] : ids);
  }, [commit]);
  const endMarquee = useCallback(() => {
    marqueeBase.current = [];
    marqueeAdditive.current = false;
    settle();
  }, [settle]);
  const cancel = useCallback(() => {
    if (mode === "marquee") commit(marqueeBase.current);
    if (mode === "idle" || mode === "selecting") commit([]);
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

function unique(ids: readonly string[]) {
  return [...new Set(ids)];
}

function sameIds(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}
