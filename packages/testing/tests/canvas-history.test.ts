import { describe, expect, it } from "vitest";
import {
  createCanvasHistory,
  pushCanvasHistoryFromBaseline,
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
});
