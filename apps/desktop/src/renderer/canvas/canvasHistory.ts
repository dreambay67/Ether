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

type CanvasNodeChangeLike = {
  type: string;
  resizing?: boolean;
};

export function shouldPushNodeChangesToHistory(changes: CanvasNodeChangeLike[]) {
  return changes.some((change) => {
    if (change.type === "select") {
      return false;
    }

    if (change.type === "dimensions") {
      // React Flow marks active NodeResizer drags with resizing=true and the release with resizing=false.
      // Dimension changes without that flag are treated as measurement noise so initial layout does not pollute undo.
      return change.resizing === false;
    }

    return true;
  });
}

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

export function pushCanvasHistoryFromBaseline(
  history: CanvasHistory,
  baseline: CanvasSnapshot,
  snapshot: CanvasSnapshot
): CanvasHistory {
  return {
    past: [...history.past, baseline].slice(-80),
    present: snapshot,
    future: []
  };
}

export function updateCanvasHistoryPresent(
  history: CanvasHistory,
  snapshot: CanvasSnapshot
): CanvasHistory {
  return {
    ...history,
    present: snapshot
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
