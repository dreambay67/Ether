import { describe, expect, it } from "vitest";
import {
  createCanvasHistory,
  deleteCanvasElements,
  pushCanvasHistoryFromBaseline,
  pushCanvasHistoryIfChanged,
  redoCanvasHistory,
  shouldPushNodeChangesToHistory,
  undoCanvasHistory,
  updateCanvasHistoryPresent
} from "../../../apps/desktop/src/renderer/canvas/canvasHistory";

describe("canvas node change history", () => {
  it("does not push selection or intermediate resize changes into history", () => {
    expect(shouldPushNodeChangesToHistory([{ type: "select" }])).toBe(false);
    expect(shouldPushNodeChangesToHistory([{ type: "dimensions", resizing: true }])).toBe(false);
  });

  it("pushes completed dimension changes into history", () => {
    expect(shouldPushNodeChangesToHistory([{ type: "dimensions", resizing: false }])).toBe(true);
  });

  it("does not push active node drags into history", () => {
    expect(shouldPushNodeChangesToHistory([{ type: "position", dragging: true }])).toBe(false);
    expect(shouldPushNodeChangesToHistory([{ type: "position", dragging: false }])).toBe(false);
  });

  it("pushes normal graph edits into history", () => {
    expect(shouldPushNodeChangesToHistory([{ type: "position" }])).toBe(true);
  });

  it("treats a resize gesture as one undoable edit from original to final dimensions", () => {
    const original = {
      nodes: [{ id: "node-1", position: { x: 0, y: 0 }, width: 224, height: 138 }],
      edges: []
    };
    const intermediate = {
      nodes: [{ id: "node-1", position: { x: 0, y: 0 }, width: 260, height: 160 }],
      edges: []
    };
    const final = {
      nodes: [{ id: "node-1", position: { x: 0, y: 0 }, width: 300, height: 190 }],
      edges: []
    };
    const baselineHistory = createCanvasHistory(original);

    const liveHistory = updateCanvasHistoryPresent(baselineHistory, intermediate);
    const committedHistory = pushCanvasHistoryFromBaseline(liveHistory, baselineHistory.present, final);
    const undoneHistory = undoCanvasHistory(committedHistory);
    const redoneHistory = redoCanvasHistory(undoneHistory);

    expect(liveHistory.past).toEqual([]);
    expect(liveHistory.present.nodes[0]).toMatchObject({ width: 260, height: 160 });
    expect(committedHistory.past).toEqual([original]);
    expect(committedHistory.present.nodes[0]).toMatchObject({ width: 300, height: 190 });
    expect(undoneHistory.present.nodes[0]).toMatchObject({ width: 224, height: 138 });
    expect(redoneHistory.present.nodes[0]).toMatchObject({ width: 300, height: 190 });
  });

  it("deletes a connected node and incident edges in one undoable edit", () => {
    const original = {
      nodes: [
        { id: "node-a", position: { x: 0, y: 0 } },
        { id: "node-b", position: { x: 240, y: 0 } }
      ],
      edges: [{ id: "edge-a-b", source: "node-a", target: "node-b" }]
    };
    const deleted = deleteCanvasElements(original, { nodeIds: ["node-a"] });

    expect(deleted?.nodes.map((node) => node.id)).toEqual(["node-b"]);
    expect(deleted?.edges).toEqual([]);

    const committed = pushCanvasHistoryIfChanged(createCanvasHistory(original), deleted);
    const undone = undoCanvasHistory(committed);
    const redone = redoCanvasHistory(undone);

    expect(undone.present).toEqual(original);
    expect(redone.present.edges.every((edge) => {
      const nodeIds = new Set(redone.present.nodes.map((node) => node.id));
      return nodeIds.has(edge.source) && nodeIds.has(edge.target);
    })).toBe(true);
  });

  it("treats a drag gesture as one undoable edit from original to final position", () => {
    const original = {
      nodes: [{ id: "node-1", position: { x: 0, y: 0 } }],
      edges: []
    };
    const intermediate = {
      nodes: [{ id: "node-1", position: { x: 48, y: 16 } }],
      edges: []
    };
    const final = {
      nodes: [{ id: "node-1", position: { x: 120, y: 80 } }],
      edges: []
    };
    const baselineHistory = createCanvasHistory(original);

    const liveHistory = updateCanvasHistoryPresent(baselineHistory, intermediate);
    const committedHistory = pushCanvasHistoryFromBaseline(liveHistory, baselineHistory.present, final);
    const undoneHistory = undoCanvasHistory(committedHistory);
    const redoneHistory = redoCanvasHistory(undoneHistory);

    expect(liveHistory.past).toEqual([]);
    expect(committedHistory.past).toEqual([original]);
    expect(undoneHistory.present.nodes[0]).toMatchObject({ position: { x: 0, y: 0 } });
    expect(redoneHistory.present.nodes[0]).toMatchObject({ position: { x: 120, y: 80 } });
  });

  it("does not create a history entry when a grouped edit returns to its baseline", () => {
    const original = {
      nodes: [{ id: "node-1", position: { x: 0, y: 0 } }],
      edges: []
    };
    const history = createCanvasHistory(original);

    expect(pushCanvasHistoryIfChanged(history, original)).toBe(history);
  });
});
