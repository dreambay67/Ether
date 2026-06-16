import { describe, expect, it } from "vitest";
import { shouldPushNodeChangesToHistory } from "../../../apps/desktop/src/renderer/canvas/canvasHistory";

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
});
