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
  dragging?: boolean;
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

    if (change.type === "position" && typeof change.dragging === "boolean") {
      return false;
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

export function areCanvasSnapshotsEqual(left: CanvasSnapshot, right: CanvasSnapshot): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function pushCanvasHistoryIfChanged(
  history: CanvasHistory,
  snapshot: CanvasSnapshot | null
): CanvasHistory {
  if (!snapshot || areCanvasSnapshotsEqual(history.present, snapshot)) {
    return history;
  }

  return pushCanvasHistory(history, snapshot);
}

export function pushCanvasHistoryFromBaseline(
  history: CanvasHistory,
  baseline: CanvasSnapshot,
  snapshot: CanvasSnapshot
): CanvasHistory {
  if (areCanvasSnapshotsEqual(baseline, snapshot)) {
    return {
      ...history,
      present: snapshot
    };
  }

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

export function replaceCanvasHistoryWithDurableCommit(
  _history: CanvasHistory,
  snapshot: CanvasSnapshot
): CanvasHistory {
  return {
    past: [],
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

export function deleteCanvasElements(
  snapshot: CanvasSnapshot,
  selection: { nodeIds?: string[]; edgeIds?: string[] } = {}
): CanvasSnapshot | null {
  const nodeIds = new Set(
    selection.nodeIds ?? snapshot.nodes.filter((node) => node.selected).map((node) => node.id)
  );
  const edgeIds = new Set(
    selection.edgeIds ?? snapshot.edges.filter((edge) => edge.selected).map((edge) => edge.id)
  );

  if (nodeIds.size === 0 && edgeIds.size === 0) {
    return null;
  }

  const nodes = snapshot.nodes.filter((node) => !nodeIds.has(node.id));
  const edges = snapshot.edges.filter(
    (edge) => !edgeIds.has(edge.id) && !nodeIds.has(edge.source) && !nodeIds.has(edge.target)
  );

  if (nodes.length === snapshot.nodes.length && edges.length === snapshot.edges.length) {
    return null;
  }

  return { nodes, edges };
}
