import { describe, expect, it } from "vitest";
import {
  assembleGenerationInputs,
  assemblePromptForNode,
  freezePromptNode,
  getNodeContract,
  NODE_CONTRACTS,
  NODE_DEFINITIONS,
  type CanvasNodeData,
  type EtherGraph
} from "@ether/engine";

function node(
  id: string,
  data: Partial<CanvasNodeData> & Pick<CanvasNodeData, "definitionId" | "kind" | "subtype">
) {
  const title = data.title ?? `${data.subtype} ${data.kind}`;

  return {
    id,
    type: "etherNode",
    position: { x: 0, y: 0 },
    data: {
      title,
      label: data.label ?? title,
      instruction: data.instruction ?? "",
      notes: data.notes ?? "",
      status: data.status ?? "idle",
      ...data
    }
  };
}

function graph(nodes: EtherGraph["nodes"], edges: EtherGraph["edges"]): EtherGraph {
  return {
    nodes,
    edges,
    viewport: { x: 0, y: 0, zoom: 1 },
    selectedSnapshotId: null,
    updatedAt: "2026-06-17T00:00:00.000Z"
  };
}

describe("node contracts", () => {
  it("defines exactly one contract for every node definition", () => {
    const contractIds = NODE_CONTRACTS.map((contract) => contract.definitionId);

    expect(contractIds.sort()).toEqual(NODE_DEFINITIONS.map((definition) => definition.id).sort());
    expect(new Set(contractIds).size).toBe(NODE_DEFINITIONS.length);
    expect(getNodeContract("prompt-general")).toMatchObject({
      definitionId: "prompt-general",
      producedOutputs: ["prompt"],
      runnable: true,
      runLabel: "Assemble Prompt"
    });
  });
});

describe("prompt assembly", () => {
  it("composes chained prompt nodes in deterministic upstream order", () => {
    const canvas = graph(
      [
        node("subject", {
          definitionId: "prompt-subject",
          kind: "Prompt",
          subtype: "Subject",
          title: "Subject",
          instruction: "silver astronaut"
        }),
        node("style", {
          definitionId: "prompt-style",
          kind: "Prompt",
          subtype: "Style",
          title: "Style",
          instruction: "editorial fashion lighting"
        }),
        node("final", {
          definitionId: "prompt-general",
          kind: "Prompt",
          subtype: "General",
          title: "Final",
          instruction: "cinematic campaign key art"
        })
      ],
      [
        { id: "edge-subject-final", source: "subject", target: "final", label: "subject" },
        { id: "edge-style-final", source: "style", target: "final", label: "style" }
      ]
    );

    const assembly = assemblePromptForNode(canvas, "final");

    expect(assembly.prompt).toBe(
      ["silver astronaut", "editorial fashion lighting", "cinematic campaign key art"].join("\n\n")
    );
    expect(assembly.sections.map((section) => section.nodeId)).toEqual(["subject", "style", "final"]);
  });

  it("separates negative prompt nodes into negativePrompt constraints", () => {
    const canvas = graph(
      [
        node("subject", {
          definitionId: "prompt-subject",
          kind: "Prompt",
          subtype: "Subject",
          instruction: "clean product render"
        }),
        node("negative", {
          definitionId: "prompt-negative",
          kind: "Prompt",
          subtype: "Negative",
          instruction: "no blur, no warped hands"
        }),
        node("generation", {
          definitionId: "generation-image",
          kind: "Generation",
          subtype: "Image"
        })
      ],
      [
        { id: "edge-subject-generation", source: "subject", target: "generation", label: "prompt" },
        { id: "edge-negative-generation", source: "negative", target: "generation", label: "negative" }
      ]
    );

    const assembly = assembleGenerationInputs(canvas, "generation");

    expect(assembly.prompt).toBe("clean product render");
    expect(assembly.negativePrompt).toBe("no blur, no warped hands");
    expect(assembly.sections.map((section) => section.kind)).toEqual(["prompt", "negativePrompt"]);
  });

  it("uses editable edge labels when resolving reference roles", () => {
    const canvas = graph(
      [
        node("reference", {
          definitionId: "reference-image",
          kind: "Reference",
          subtype: "Image",
          title: "Hero Face",
          instruction: "keep the face identity"
        }),
        node("generation", {
          definitionId: "generation-image",
          kind: "Generation",
          subtype: "Image"
        })
      ],
      [{ id: "edge-reference-generation", source: "reference", target: "generation", label: "face" }]
    );

    const assembly = assembleGenerationInputs(canvas, "generation");

    expect(assembly.references).toEqual([
      {
        nodeId: "reference",
        role: "face",
        title: "Hero Face",
        sourceKind: "Image",
        steeringText: "keep the face identity"
      }
    ]);
    expect(assembly.edgeRoles).toEqual([{ edgeId: "edge-reference-generation", role: "face" }]);
  });

  it("falls back to sensible default reference roles for unknown edge labels", () => {
    const canvas = graph(
      [
        node("palette", {
          definitionId: "reference-colour-grid",
          kind: "Reference",
          subtype: "Colour Grid",
          title: "Brand Palette"
        }),
        node("generation", {
          definitionId: "generation-image",
          kind: "Generation",
          subtype: "Image"
        })
      ],
      [{ id: "edge-palette-generation", source: "palette", target: "generation", label: "vibes" }]
    );

    expect(assembleGenerationInputs(canvas, "generation").references[0].role).toBe("colourPalette");
  });

  it("collects prompt sections, negative constraints, and references for generation nodes", () => {
    const canvas = graph(
      [
        node("prompt", {
          definitionId: "prompt-general",
          kind: "Prompt",
          subtype: "General",
          instruction: "sharp studio portrait"
        }),
        node("negative", {
          definitionId: "prompt-negative",
          kind: "Prompt",
          subtype: "Negative",
          instruction: "low quality"
        }),
        node("reference", {
          definitionId: "reference-moodboard",
          kind: "Reference",
          subtype: "Moodboard",
          instruction: "muted editorial mood"
        }),
        node("generation", {
          definitionId: "generation-image",
          kind: "Generation",
          subtype: "Image"
        })
      ],
      [
        { id: "edge-prompt-generation", source: "prompt", target: "generation", label: "prompt" },
        { id: "edge-negative-generation", source: "negative", target: "generation", label: "negative" },
        { id: "edge-reference-generation", source: "reference", target: "generation", label: "style" }
      ]
    );

    expect(assembleGenerationInputs(canvas, "generation")).toMatchObject({
      nodeId: "generation",
      prompt: "sharp studio portrait",
      negativePrompt: "low quality",
      sections: [
        { nodeId: "prompt", kind: "prompt" },
        { nodeId: "negative", kind: "negativePrompt" }
      ],
      references: [{ nodeId: "reference", role: "style" }]
    });
  });

  it("freezes an assembled prompt artifact into prompt node data", () => {
    const canvas = graph(
      [
        node("subject", {
          definitionId: "prompt-subject",
          kind: "Prompt",
          subtype: "Subject",
          instruction: "glass perfume bottle"
        }),
        node("final", {
          definitionId: "prompt-general",
          kind: "Prompt",
          subtype: "General",
          title: "Campaign Prompt",
          instruction: "on reflective acrylic"
        })
      ],
      [{ id: "edge-subject-final", source: "subject", target: "final", label: "subject" }]
    );

    const frozen = freezePromptNode(canvas, "final", "2026-06-17T08:00:00.000Z");
    const promptNode = frozen.nodes.find((candidate) => candidate.id === "final");

    expect(promptNode?.data).toMatchObject({
      artifactKind: "assembledPrompt",
      assembledPrompt: "glass perfume bottle\n\non reflective acrylic",
      lastRunAt: "2026-06-17T08:00:00.000Z",
      status: "complete"
    });
    expect(promptNode?.data.instruction).toBe("on reflective acrylic");
  });
});
