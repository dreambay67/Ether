import { describe, expect, it, vi } from "vitest";
import { createDroppedFilePathReader } from "../../../apps/desktop/src/preload/filePathBridge";

describe("preload dropped file path bridge", () => {
  it("maps a dropped File through Electron webUtils.getPathForFile", () => {
    const file = new File(["image"], "reference.png", { type: "image/png" });
    const getPathForFile = vi.fn(() => "C:\\References\\reference.png");
    const readPath = createDroppedFilePathReader({ getPathForFile });

    expect(readPath(file)).toBe("C:\\References\\reference.png");
    expect(getPathForFile).toHaveBeenCalledWith(file);
  });

  it("returns null when Electron cannot resolve a local path", () => {
    const file = new File(["image"], "reference.png", { type: "image/png" });
    const readPath = createDroppedFilePathReader({ getPathForFile: () => "" });

    expect(readPath(file)).toBeNull();
  });
});
