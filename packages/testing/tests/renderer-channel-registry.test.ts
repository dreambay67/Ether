import { describe, expect, it } from "vitest";
import {
  CONNECTION_ROLES,
  DEFAULT_CONNECTION_ROLE,
  PAYLOAD_CHANNELS,
  channelLabel,
  roleLabel
} from "../../../apps/desktop/src/renderer/canvas/ports/channelRegistry";

describe("renderer channel registry", () => {
  it("keeps the Ether 2.5 channel and role lists exact", () => {
    expect(PAYLOAD_CHANNELS).toEqual(["text", "image", "mask", "data", "video", "audio"]);
    expect(CONNECTION_ROLES).toEqual([
      "general",
      "negative",
      "subject",
      "product",
      "face",
      "clothing",
      "pose",
      "setting",
      "composition",
      "style",
      "lighting",
      "colourPalette",
      "typography",
      "motion",
      "timing"
    ]);
    expect(DEFAULT_CONNECTION_ROLE).toBe("general");
    expect(channelLabel("text")).toBe("Text");
    expect(channelLabel("audio")).toBe("Audio");
    expect(roleLabel("colourPalette")).toBe("Colour palette");
  });
});
