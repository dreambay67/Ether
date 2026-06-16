import type { Edge, Node } from "@xyflow/react";

export type CanvasSnapshot = {
  nodes: Node[];
  edges: Edge[];
};

export type CanvasHistory = {
  past: CanvasSnapshot[];
  present: CanvasSnapshot;
  future: CanvasSnapshot[];
};

export function createCanvasHistory(snapshot: CanvasSnapshot): CanvasHistory {
  return {
    past: [],
    present: snapshot,
    future: []
  };
}

export function pushCanvasHistory(history: CanvasHistory, snapshot: CanvasSnapshot): CanvasHistory {
  return {
    past: [...history.past, history.present].slice(-80),
    present: snapshot,
    future: []
  };
}

export function undoCanvasHistory(history: CanvasHistory): CanvasHistory {
  const previous = history.past.at(-1);

  if (!previous) {
    return history;
  }

  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future]
  };
}

export function redoCanvasHistory(history: CanvasHistory): CanvasHistory {
  const next = history.future[0];

  if (!next) {
    return history;
  }

  return {
    past: [...history.past, history.present],
    present: next,
    future: history.future.slice(1)
  };
}
