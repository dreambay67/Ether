import { describe, expect, it } from "vitest";

import {
  FULL_ADAPTER_CAPABILITIES,
  connectionMatrixHash,
  enumerateConnectionMatrix,
  nodeDefinitions,
  payloadChannels,
  connectionRoles,
  resolveAdapter
} from "../../graph-kernel/src/index.js";

describe("Ether 4.0 exhaustive connection matrix", () => {
  it("enumerates every definition, channel, and role tuple in stable order", () => {
    const rows = enumerateConnectionMatrix(FULL_ADAPTER_CAPABILITIES);

    expect(nodeDefinitions).toHaveLength(17);
    expect(rows).toHaveLength(17 * 6 * 17 * 6 * 15);
    expect(rows[0]).toMatchObject({
      sourceDefinitionId: "prompt.text",
      sourceChannel: "text",
      targetDefinitionId: "prompt.text",
      targetChannel: "text",
      role: "general"
    });
    expect(rows.at(-1)).toMatchObject({
      sourceDefinitionId: "canvas.drawing",
      sourceChannel: "audio",
      targetDefinitionId: "canvas.drawing",
      targetChannel: "audio",
      role: "timing"
    });
    expect(new Set(rows.map((row) => row.key)).size).toBe(156_060);
    expect(connectionMatrixHash(rows)).toBe("ether-matrix-v1:0a4b8a01bd0d3498");
    expect(connectionMatrixHash(rows)).toBe(connectionMatrixHash(enumerateConnectionMatrix(FULL_ADAPTER_CAPABILITIES)));
  });

  it("gives every row either a named consequence or a deterministic typed rejection", () => {
    const invalidRows: string[] = [];
    for (const capabilities of [FULL_ADAPTER_CAPABILITIES, []] as const) {
      const rows = enumerateConnectionMatrix(capabilities);
      for (const row of rows) {
        if (row.decision.allowed) {
          if (row.decision.consequences.length === 0 || row.decision.consequences.some((consequence) => consequence.executorInputField === "")) invalidRows.push(row.key);
        } else {
          if (!/^[A-Z_]+$/.test(row.decision.code) || row.decision.remedies.length === 0 || row.decision.remedies.some((remedy) => !("kind" in remedy))) invalidRows.push(row.key);
        }
      }
    }
    expect(invalidRows).toEqual([]);
  }, 20_000);

  it("contains only the bounded adapter graph and never invents generation or masking", () => {
    const full = new Set(FULL_ADAPTER_CAPABILITIES);
    expect(resolveAdapter("image", "text", "auto", full)?.id).toBe("codex.image-to-text");
    expect(resolveAdapter("audio", "text", "auto", full)?.id).toBe("native.audio-to-text");
    expect(resolveAdapter("video", "image", "auto", full)?.id).toBe("local.video-to-image");
    expect(resolveAdapter("video", "audio", "auto", full)?.id).toBe("local.video-to-audio");
    expect(resolveAdapter("text", "data", "auto", full)?.id).toBe("local.text-to-data");
    expect(resolveAdapter("data", "text", "auto", full)?.id).toBe("local.data-to-text");
    expect(resolveAdapter("mask", "data", "auto", full)?.id).toBe("local.mask-to-data");
    expect(resolveAdapter("data", "mask", "auto", full)?.id).toBe("local.data-to-mask");
    expect(resolveAdapter("text", "image", "auto", full)).toBeNull();
    expect(resolveAdapter("image", "mask", "auto", full)).toBeNull();
  });

  it("uses the canonical six channels and fifteen roles as matrix axes", () => {
    expect(payloadChannels).toEqual(["text", "image", "mask", "data", "video", "audio"]);
    expect(connectionRoles).toHaveLength(15);
  });
});
