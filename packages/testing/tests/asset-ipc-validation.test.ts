import { describe, expect, it } from "vitest";
import { assertImageFilePathForIpc } from "../../../apps/desktop/src/main/assetIpcValidation";

describe("asset IPC validation", () => {
  it("accepts common image file paths", () => {
    expect(() => assertImageFilePathForIpc("C:\\References\\hero.PNG")).not.toThrow();
    expect(() => assertImageFilePathForIpc("C:\\References\\mood.webp")).not.toThrow();
  });

  it("rejects dropped non-image paths before linking references", () => {
    expect(() => assertImageFilePathForIpc("C:\\References\\notes.txt")).toThrow(
      "Dropped reference must be an image file."
    );
  });
});
