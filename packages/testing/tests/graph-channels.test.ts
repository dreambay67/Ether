import { describe, expect, it } from "vitest";
import {
  CONNECTION_ROLES,
  DEFAULT_CONNECTION_ROLE,
  PAYLOAD_CHANNELS,
  channelLabel,
  isConnectionRole,
  isPayloadChannel,
  normalizeConnectionRole,
  normalizePayloadChannel,
  roleLabel
} from "@ether/engine";

describe("graph channel and role registry", () => {
  it("defines the canonical Ether 2.5 payload channels in order", () => {
    expect(PAYLOAD_CHANNELS).toEqual(["text", "image", "mask", "data", "video", "audio"]);
  });

  it("defines the canonical Ether 2.5 connection roles in order", () => {
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
  });

  it("uses general as the default connection role", () => {
    expect(DEFAULT_CONNECTION_ROLE).toBe("general");
  });

  it("recognizes canonical channels and roles", () => {
    expect(isPayloadChannel("text")).toBe(true);
    expect(isPayloadChannel("prompt")).toBe(false);
    expect(isPayloadChannel(null)).toBe(false);

    expect(isConnectionRole("colourPalette")).toBe(true);
    expect(isConnectionRole("colorPalette")).toBe(false);
    expect(isConnectionRole(undefined)).toBe(false);
  });

  it("normalizes legacy payload channel aliases without defaulting unknown values to text", () => {
    const channelAliases = new Map([
      ["prompt", "text"],
      ["text", "text"],
      ["note", "text"],
      ["negativePrompt", "text"],
      ["assembledPrompt", "text"],
      ["reference", "image"],
      ["image", "image"],
      ["editedImage", "image"],
      ["outputImage", "image"],
      ["metadata", "data"],
      ["data", "data"],
      ["collection", "data"],
      ["route", "data"],
      ["evaluation", "data"],
      ["filterRule", "data"],
      ["compare", "data"],
      ["json", "data"],
      ["mask", "mask"],
      ["matte", "mask"],
      ["selection", "mask"],
      ["video", "video"],
      ["clip", "video"],
      ["movie", "video"],
      ["audio", "audio"],
      ["sound", "audio"],
      ["voice", "audio"],
      ["music", "audio"]
    ] as const);

    for (const [alias, channel] of channelAliases) {
      expect(normalizePayloadChannel(alias)).toBe(channel);
    }

    expect(normalizePayloadChannel("instruction")).toBeUndefined();
    expect(normalizePayloadChannel("not-a-channel")).toBeUndefined();
    expect(normalizePayloadChannel(123)).toBeUndefined();
  });

  it("normalizes connection role aliases and falls back unknown roles to general", () => {
    const roleAliases = new Map([
      ["context", "general"],
      ["prompt", "general"],
      ["instruction", "general"],
      ["reference", "general"],
      ["custom", "general"],
      ["unknown", "general"],
      ["negativePrompt", "negative"],
      ["exclude", "negative"],
      ["avoid", "negative"],
      ["colour", "colourPalette"],
      ["color", "colourPalette"],
      ["palette", "colourPalette"],
      ["colorPalette", "colourPalette"],
      ["type", "typography"],
      ["font", "typography"],
      ["movement", "motion"],
      ["action", "motion"],
      ["cameraMove", "motion"],
      ["rhythm", "timing"],
      ["pace", "timing"],
      ["duration", "timing"],
      ["time", "timing"],
      ["timecode", "timing"]
    ] as const);

    for (const [alias, role] of roleAliases) {
      expect(normalizeConnectionRole(alias)).toBe(role);
    }

    expect(normalizeConnectionRole("not-a-role")).toBe("general");
    expect(normalizeConnectionRole(123)).toBe("general");
  });

  it("provides readable labels for canonical channels and roles", () => {
    expect(channelLabel("text")).toBe("Text");
    expect(channelLabel("data")).toBe("Data");
    expect(roleLabel("colourPalette")).toBe("Colour palette");
    expect(roleLabel("general")).toBe("General");
  });
});
