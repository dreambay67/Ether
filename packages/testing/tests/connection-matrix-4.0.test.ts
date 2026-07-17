import { describe, expect, it } from "vitest";
import type { PayloadEnvelope } from "@ether/schema";

import {
  FULL_ADAPTER_CAPABILITIES,
  adapterDefinitions,
  applyInputConsequence,
  connectionMatrixHash,
  createExecutorInputFixture,
  enumerateConnectionMatrix,
  enumerateExplicitAdapterMatrix,
  nodeDefinitions,
  payloadChannels,
  connectionRoles,
  resolveAdapter,
  validateConnection
} from "../../graph-kernel/src/index.js";

function matrixPayload(row: { key: string; targetChannel: PayloadEnvelope["channel"]; role: PayloadEnvelope["role"] }): PayloadEnvelope {
  const content: PayloadEnvelope["content"] = row.targetChannel === "text"
    ? { kind: "text", value: row.key }
    : row.targetChannel === "data"
      ? { kind: "object", value: { key: row.key } }
      : { kind: "artifact", artifactId: `artifact:${row.key}` };
  return {
    id: `payload:${row.key}`,
    channel: row.targetChannel,
    role: row.role,
    content,
    source: { nodeId: `source:${row.key}`, outputVersionId: `version:${row.key}`, lineageKey: `lineage:${row.key}` },
    metadata: {}
  };
}

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
  }, 15_000);

  it("gives every row either a named consequence or a deterministic typed rejection", () => {
    const invalidRows: string[] = [];
    for (const capabilities of [FULL_ADAPTER_CAPABILITIES, []] as const) {
      const rows = enumerateConnectionMatrix(capabilities);
      for (const row of rows) {
        if (row.decision.allowed) {
          if (row.decision.consequences.length === 0 || row.decision.consequences.some((consequence) => consequence.executorInputField === "")) invalidRows.push(row.key);
          for (const consequence of row.decision.consequences) {
            const applied = applyInputConsequence(createExecutorInputFixture(row.targetDefinitionId), consequence, matrixPayload(row));
            expect(applied.inputs[consequence.executorInputField]?.payloads).toHaveLength(1);
          }
        } else {
          if (!/^[A-Z_]+$/.test(row.decision.code) || row.decision.remedies.length === 0 || row.decision.remedies.some((remedy) => !("kind" in remedy))) invalidRows.push(row.key);
        }
      }
    }
    expect(invalidRows).toEqual([]);
  }, 20_000);

  it("enumerates and executes every explicit adapter tuple and capability scenario", () => {
    const rows = enumerateExplicitAdapterMatrix();
    expect(adapterDefinitions).toHaveLength(16);
    expect(rows).toHaveLength(65_970);
    expect(new Set(rows.map((row) => row.key)).size).toBe(rows.length);
    expect(new Set(rows.map((row) => row.adapterId))).toEqual(new Set(adapterDefinitions.map((adapter) => adapter.id)));

    for (const row of rows) {
      if (row.decision.allowed) {
        expect(row.decision.adapter?.adapterId).toBe(row.adapterId);
        for (const consequence of row.decision.consequences) {
          const applied = applyInputConsequence(createExecutorInputFixture(row.targetDefinitionId), consequence, matrixPayload(row));
          expect(applied.inputs[consequence.executorInputField]).toMatchObject({
            assemblyStrategy: consequence.assemblyStrategy,
            preservationRule: consequence.preservationRule,
            payloads: [expect.objectContaining({ id: `payload:${row.key}` })]
          });
        }
      } else {
        const adapter = adapterDefinitions.find((candidate) => candidate.id === row.adapterId)!;
        expect(adapter.requiredCapability).not.toBeNull();
        expect(row.capabilityScenario).toBe("none");
        expect(row.decision.code).toBe("PROVIDER_CAPABILITY_UNAVAILABLE");
      }
    }
    expect(connectionMatrixHash(rows)).toBe("ether-matrix-v1:603a2c5521278897");
    expect(connectionMatrixHash(rows)).toBe(connectionMatrixHash(enumerateExplicitAdapterMatrix()));
  }, 30_000);

  it("rejects every supported channel pairing outside each adapter's declared pair", () => {
    const sourceByChannel = new Map(payloadChannels.map((channel) => [
      channel,
      nodeDefinitions.find((definition) => definition.library.outputChannels.includes(channel))!
    ]));
    const targetByChannel = new Map(payloadChannels.map((channel) => [
      channel,
      nodeDefinitions.find((definition) => definition.library.inputChannels.includes(channel))!
    ]));
    const rows: Array<{ key: string; decision: ReturnType<typeof validateConnection> }> = [];

    for (const adapter of adapterDefinitions) {
      for (const sourceChannel of payloadChannels) {
        for (const targetChannel of payloadChannels) {
          if (sourceChannel === adapter.fromChannel && targetChannel === adapter.toChannel) continue;
          const source = sourceByChannel.get(sourceChannel)!;
          const target = targetByChannel.get(targetChannel)!;
          for (const role of connectionRoles) {
            rows.push({
              key: `${adapter.id}|${source.id}|${sourceChannel}|${target.id}|${targetChannel}|${role}`,
              decision: validateConnection({
                sourceDefinitionId: source.id,
                sourceChannel,
                targetDefinitionId: target.id,
                targetChannel,
                role,
                adapter: { kind: "explicit", adapterId: adapter.id },
                capabilities: FULL_ADAPTER_CAPABILITIES
              })
            });
          }
        }
      }
    }

    expect(rows).toHaveLength(adapterDefinitions.length * (payloadChannels.length ** 2 - 1) * connectionRoles.length);
    expect(new Set(rows.map((row) => row.key)).size).toBe(rows.length);
    expect(rows.every((row) => !row.decision.allowed && row.decision.code === "ADAPTER_UNAVAILABLE")).toBe(true);
  }, 30_000);

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
