import { describe, expect, it } from "vitest";
import {
  canConnectNodeKinds,
  createGraphNodeData,
  decorateEdgeForNodes
} from "@ether/engine";

describe("Ether 2.5 canonical edge semantics", () => {
  it("returns canonical data for a same-channel Text -> Text edge", () => {
    expect(
      canConnectNodeKinds("Prompt", "Assistant", {
        sourceChannel: "text",
        targetChannel: "text"
      })
    ).toMatchObject({
      allowed: true,
      sourceChannel: "text",
      targetChannel: "text",
      defaultRole: "general"
    });
  });

  it("accepts legacy reference -> image selected ports as the Image channel", () => {
    expect(
      canConnectNodeKinds("Reference", "Edit", {
        sourceDefinitionId: "reference-image",
        targetDefinitionId: "edit-inpaint",
        sourcePortId: "reference",
        targetPortId: "image"
      })
    ).toMatchObject({
      allowed: true,
      sourceChannel: "image",
      targetChannel: "image",
      defaultRole: "general"
    });
  });

  it("marks Audio -> Text as an unavailable transcription adapter", () => {
    expect(
      canConnectNodeKinds("Assistant", "Prompt", {
        sourceChannel: "audio",
        targetChannel: "text"
      })
    ).toMatchObject({
      allowed: true,
      sourceChannel: "audio",
      targetChannel: "text",
      adapter: {
        operation: "transcribe",
        status: "unavailable"
      },
      disabledReason: expect.stringContaining("transcription")
    });
  });

  it("marks Image -> Text as an unavailable caption adapter", () => {
    expect(
      canConnectNodeKinds("Reference", "Assistant", {
        sourceChannel: "image",
        targetChannel: "text"
      })
    ).toMatchObject({
      allowed: true,
      sourceChannel: "image",
      targetChannel: "text",
      adapter: {
        operation: "caption",
        status: "unavailable"
      },
      disabledReason: expect.stringContaining("caption")
    });
  });

  it("marks Video -> Text as an unavailable caption adapter", () => {
    expect(
      canConnectNodeKinds("Reference", "Assistant", {
        sourceChannel: "video",
        targetChannel: "text"
      })
    ).toMatchObject({
      allowed: true,
      sourceChannel: "video",
      targetChannel: "text",
      adapter: {
        operation: "caption",
        status: "unavailable"
      },
      disabledReason: expect.stringMatching(/video caption|transcription|provider/)
    });
  });

  it("marks Video -> Image as an unavailable extraction adapter", () => {
    expect(
      canConnectNodeKinds("Reference", "Generation", {
        sourceChannel: "video",
        targetChannel: "image"
      })
    ).toMatchObject({
      allowed: true,
      sourceChannel: "video",
      targetChannel: "image",
      adapter: {
        operation: "extract",
        status: "unavailable"
      },
      disabledReason: expect.stringMatching(/frame extraction|provider/)
    });
  });

  it("marks Data -> Mask as an unavailable transform adapter", () => {
    expect(
      canConnectNodeKinds("Store", "Store", {
        sourceChannel: "data",
        targetChannel: "mask"
      })
    ).toMatchObject({
      allowed: true,
      sourceChannel: "data",
      targetChannel: "mask",
      adapter: {
        operation: "transform",
        status: "unavailable"
      },
      disabledReason: expect.stringContaining("rasterization")
    });
  });

  it("marks Text -> Audio as disabled without a provider", () => {
    expect(
      canConnectNodeKinds("Prompt", "Generation", {
        sourceChannel: "text",
        targetChannel: "audio"
      })
    ).toMatchObject({
      allowed: true,
      sourceChannel: "text",
      targetChannel: "audio",
      disabledReason: expect.stringContaining("audio provider")
    });
  });

  it("allows Text -> Image as direct generation intent", () => {
    expect(
      canConnectNodeKinds("Prompt", "Generation", {
        sourceDefinitionId: "prompt-prompt",
        targetDefinitionId: "generation-image",
        sourceChannel: "text",
        targetChannel: "image"
      })
    ).toMatchObject({
      allowed: true,
      sourceChannel: "text",
      targetChannel: "image",
      defaultRole: "general"
    });
  });

  it("canonicalizes an old reference edge into Ether 2.5 edge data", () => {
    const referenceNode = {
      id: "reference",
      data: createGraphNodeData("reference-image")
    };
    const generationNode = {
      id: "generation",
      data: createGraphNodeData("generation-image")
    };

    expect(
      decorateEdgeForNodes(
        {
          id: "edge-reference-generation",
          source: "reference",
          target: "generation",
          label: "reference",
          data: { role: "reference" }
        },
        [referenceNode, generationNode]
      )
    ).toMatchObject({
      sourceHandle: "reference",
      targetHandle: "reference",
      label: "reference",
      type: "etherEdge",
      data: {
        graphVersion: "2.5",
        sourceChannel: "image",
        targetChannel: "image",
        role: "general"
      }
    });
  });

  it("preserves saved Ether 2.5 channel handles when redecorating an edge", () => {
    const promptNode = {
      id: "prompt",
      data: createGraphNodeData("prompt-general")
    };
    const generationNode = {
      id: "generation",
      data: createGraphNodeData("generation-image")
    };

    expect(
      decorateEdgeForNodes(
        {
          id: "edge-canonical-handles",
          source: "prompt",
          target: "generation",
          sourceHandle: "text",
          targetHandle: "text",
          label: "prompt",
          data: {
            label: "prompt",
            graphVersion: "2.5",
            sourceChannel: "text",
            targetChannel: "text",
            role: "general"
          }
        },
        [promptNode, generationNode]
      )
    ).toMatchObject({
      sourceHandle: "text",
      targetHandle: "text",
      label: "prompt",
      type: "etherEdge",
      data: {
        graphVersion: "2.5",
        sourceChannel: "text",
        targetChannel: "text",
        role: "general"
      }
    });
  });

  it("uses selected port channels instead of stale edge data channels", () => {
    const promptNode = {
      id: "prompt",
      data: createGraphNodeData("prompt-general")
    };
    const generationNode = {
      id: "generation",
      data: createGraphNodeData("generation-image")
    };

    expect(
      decorateEdgeForNodes(
        {
          id: "edge-stale-channel",
          source: "prompt",
          target: "generation",
          sourceHandle: "prompt",
          targetHandle: "reference",
          data: {
            sourceChannel: "text",
            targetChannel: "text"
          }
        },
        [promptNode, generationNode]
      )
    ).toMatchObject({
      sourceHandle: "prompt",
      targetHandle: "reference",
      data: {
        graphVersion: "2.5",
        sourceChannel: "text",
        targetChannel: "image",
        role: "general"
      }
    });
  });

  it("removes stale adapter data when redecorating a same-channel edge", () => {
    const promptNode = {
      id: "prompt",
      data: createGraphNodeData("prompt-general")
    };
    const generationNode = {
      id: "generation",
      data: createGraphNodeData("generation-image")
    };

    const decorated = decorateEdgeForNodes(
      {
        id: "edge-stale-adapter",
        source: "prompt",
        target: "generation",
        sourceHandle: "prompt",
        targetHandle: "prompt",
        data: {
          graphVersion: "2.5",
          sourceChannel: "image",
          targetChannel: "text",
          role: "style",
          adapter: {
            operation: "caption",
            providerId: "visual-description",
            status: "unavailable"
          },
          disabledReason: "Stale caption provider message."
        }
      },
      [promptNode, generationNode]
    );

    expect(decorated?.data).toMatchObject({
      graphVersion: "2.5",
      sourceChannel: "text",
      targetChannel: "text",
      role: "style"
    });
    expect(decorated?.data).not.toHaveProperty("adapter");
    expect(decorated?.data).not.toHaveProperty("disabledReason");
  });

  it("rejects unsupported cross-channel pairs with a clear reason", () => {
    expect(
      canConnectNodeKinds("Reference", "Assistant", {
        sourceChannel: "image",
        targetChannel: "audio"
      })
    ).toMatchObject({
      allowed: false,
      sourceChannel: "image",
      targetChannel: "audio",
      reason: expect.stringContaining("No adapter")
    });
  });
});
