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
    expect(getNodeContract("prompt-prompt")).toMatchObject({
      definitionId: "prompt-prompt",
      producedOutputs: ["prompt", "metadata"],
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
          definitionId: "prompt-prompt",
          kind: "Prompt",
          subtype: "Prompt",
          title: "Subject",
          instruction: "silver astronaut"
        }),
        node("style", {
          definitionId: "prompt-prompt",
          kind: "Prompt",
          subtype: "Prompt",
          title: "Style",
          instruction: "editorial fashion lighting"
        }),
        node("final", {
          definitionId: "prompt-prompt",
          kind: "Prompt",
          subtype: "Prompt",
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
      ["Subject: silver astronaut", "Style: editorial fashion lighting", "General: cinematic campaign key art"].join("\n\n")
    );
    expect(assembly.sections.map((section) => section.nodeId)).toEqual(["subject", "style", "final"]);
  });

  it("uses edge data roles for prompt section captions and numbers repeated roles deterministically", () => {
    const canvas = graph(
      [
        node("subject-a", {
          definitionId: "prompt-prompt",
          kind: "Prompt",
          subtype: "Prompt",
          title: "Hero Subject",
          instruction: "silver astronaut"
        }),
        node("subject-b", {
          definitionId: "prompt-prompt",
          kind: "Prompt",
          subtype: "Prompt",
          title: "Supporting Subject",
          instruction: "reflective helmet"
        }),
        node("palette", {
          definitionId: "prompt-prompt",
          kind: "Prompt",
          subtype: "Prompt",
          instruction: "electric blue with warm white highlights"
        }),
        node("final", {
          definitionId: "prompt-prompt",
          kind: "Prompt",
          subtype: "Prompt",
          title: "Final",
          instruction: "cinematic campaign key art"
        })
      ],
      [
        { id: "edge-subject-a-final", source: "subject-a", target: "final", label: "style", data: { role: "subject" } },
        { id: "edge-subject-b-final", source: "subject-b", target: "final", label: "subject" },
        { id: "edge-palette-final", source: "palette", target: "final", data: { label: "Colour Palette" } }
      ]
    );

    const assembly = assemblePromptForNode(canvas, "final");

    expect(assembly.prompt).toBe(
      [
        "Subject: silver astronaut",
        "Subject 2: reflective helmet",
        "Colour Palette: electric blue with warm white highlights",
        "General: cinematic campaign key art"
      ].join("\n\n")
    );
    expect(assembly.sections.map((section) => section.section)).toEqual([
      "Subject",
      "Subject 2",
      "Colour Palette",
      "General"
    ]);
  });

  it("uses general as the default role for an unconnected prompt node's own text", () => {
    const canvas = graph(
      [
        node("prompt", {
          definitionId: "prompt-prompt",
          kind: "Prompt",
          subtype: "Prompt",
          title: "Starter",
          instruction: "quiet launch poster"
        })
      ],
      []
    );

    const assembly = assemblePromptForNode(canvas, "prompt");

    expect(assembly.prompt).toBe("General: quiet launch poster");
    expect(assembly.sections[0]).toMatchObject({
      nodeId: "prompt",
      section: "General",
      text: "quiet launch poster"
    });
  });

  it("separates negative prompt nodes into negativePrompt constraints", () => {
    const canvas = graph(
      [
        node("subject", {
          definitionId: "prompt-prompt",
          kind: "Prompt",
          subtype: "Prompt",
          instruction: "clean product render"
        }),
        node("negative", {
          definitionId: "prompt-prompt",
          kind: "Prompt",
          subtype: "Prompt",
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

    expect(assembly.prompt).toBe("General: clean product render");
    expect(assembly.negativePrompt).toBe("Negative: no blur, no warped hands");
    expect(assembly.sections.map((section) => section.kind)).toEqual(["prompt", "negativePrompt"]);
  });

  it("numbers repeated negative roles and keeps them out of the positive prompt", () => {
    const canvas = graph(
      [
        node("avoid-a", {
          definitionId: "prompt-prompt",
          kind: "Prompt",
          subtype: "Prompt",
          instruction: "no blur"
        }),
        node("avoid-b", {
          definitionId: "prompt-prompt",
          kind: "Prompt",
          subtype: "Prompt",
          instruction: "no watermarks"
        }),
        node("generation", {
          definitionId: "generation-image",
          kind: "Generation",
          subtype: "Image"
        })
      ],
      [
        { id: "edge-avoid-a-generation", source: "avoid-a", target: "generation", data: { role: "negative" } },
        { id: "edge-avoid-b-generation", source: "avoid-b", target: "generation", label: "negative" }
      ]
    );

    const assembly = assembleGenerationInputs(canvas, "generation");

    expect(assembly.prompt).toBe("");
    expect(assembly.negativePrompt).toBe("Negative: no blur\n\nNegative 2: no watermarks");
    expect(assembly.sections.map((section) => section.section)).toEqual(["Negative", "Negative 2"]);
  });

  it("treats a general prompt as negativePrompt when its generation edge is labeled negative", () => {
    const canvas = graph(
      [
        node("avoid", {
          definitionId: "prompt-prompt",
          kind: "Prompt",
          subtype: "Prompt",
          title: "Avoid",
          instruction: "grain, blur, extra fingers"
        }),
        node("generation", {
          definitionId: "generation-image",
          kind: "Generation",
          subtype: "Image"
        })
      ],
      [{ id: "edge-avoid-generation", source: "avoid", target: "generation", label: "negative" }]
    );

    const assembly = assembleGenerationInputs(canvas, "generation");

    expect(assembly.prompt).toBe("");
    expect(assembly.negativePrompt).toBe("Negative: grain, blur, extra fingers");
    expect(assembly.sections).toEqual([
      expect.objectContaining({ nodeId: "avoid", kind: "negativePrompt", section: "Negative" })
    ]);
  });

  it("treats an entire prompt branch as negativePrompt when the generation edge is negative", () => {
    const canvas = graph(
      [
        node("subject", {
          definitionId: "prompt-prompt",
          kind: "Prompt",
          subtype: "Prompt",
          instruction: "clean product silhouette"
        }),
        node("avoid", {
          definitionId: "prompt-prompt",
          kind: "Prompt",
          subtype: "Prompt",
          title: "Avoid",
          instruction: "blurred reflections"
        }),
        node("generation", {
          definitionId: "generation-image",
          kind: "Generation",
          subtype: "Image"
        })
      ],
      [
        { id: "edge-subject-avoid", source: "subject", target: "avoid", label: "prompt" },
        { id: "edge-avoid-generation", source: "avoid", target: "generation", label: "negative" }
      ]
    );

    const assembly = assembleGenerationInputs(canvas, "generation");

    expect(assembly.prompt).toBe("");
    expect(assembly.negativePrompt).toBe("Negative: clean product silhouette\n\nNegative 2: blurred reflections");
    expect(assembly.sections.map((section) => [section.nodeId, section.kind, section.section])).toEqual([
      ["subject", "negativePrompt", "Negative"],
      ["avoid", "negativePrompt", "Negative 2"]
    ]);
  });

  it("does not infer negative prompt routing from Prompt node subtype names", () => {
    const canvas = graph(
      [
        node("subject", {
          definitionId: "prompt-prompt",
          kind: "Prompt",
          subtype: "Prompt",
          instruction: "clean marble counter"
        }),
        node("negative", {
          definitionId: "prompt-prompt",
          kind: "Prompt",
          subtype: "Prompt",
          title: "Negative Prompt",
          instruction: "no clutter, no reflections"
        }),
        node("generation", {
          definitionId: "generation-image",
          kind: "Generation",
          subtype: "Image"
        })
      ],
      [
        { id: "edge-subject-negative", source: "subject", target: "negative", label: "prompt" },
        { id: "edge-negative-generation", source: "negative", target: "generation", label: "prompt" }
      ]
    );

    const assembly = assembleGenerationInputs(canvas, "generation");

    expect(assembly.prompt).toBe("General: clean marble counter\n\nGeneral 2: no clutter, no reflections");
    expect(assembly.negativePrompt).toBe("");
    expect(assembly.sections.map((section) => [section.nodeId, section.kind, section.section])).toEqual([
      ["subject", "prompt", "General"],
      ["negative", "prompt", "General 2"]
    ]);
  });

  it("assembles Prompt helpers, Note, and Reference textual context into downstream prompts", () => {
    const canvas = graph(
      [
        node("assistant", {
          definitionId: "prompt-brainstormer",
          kind: "Prompt",
          subtype: "Brainstormer",
          title: "Assistant Idea",
          instruction: "make the campaign feel precise"
        }),
        node("note", {
          definitionId: "note-cloud",
          kind: "Note",
          subtype: "Cloud",
          title: "Client Note",
          notes: "avoid a seasonal theme"
        }),
        node("reference", {
          definitionId: "reference-moodboard",
          kind: "Reference",
          subtype: "Moodboard",
          title: "Moodboard",
          instruction: "quiet editorial restraint"
        }),
        node("prompt", {
          definitionId: "prompt-prompt",
          kind: "Prompt",
          subtype: "Prompt",
          instruction: "polished studio minimalism"
        })
      ],
      [
        { id: "edge-assistant-prompt", source: "assistant", target: "prompt", label: "context" },
        { id: "edge-note-prompt", source: "note", target: "prompt", label: "context" },
        { id: "edge-reference-prompt", source: "reference", target: "prompt", label: "style" }
      ]
    );

    const assembly = assemblePromptForNode(canvas, "prompt");

    expect(assembly.prompt).toBe(
      [
        "General: make the campaign feel precise",
        "General 2: avoid a seasonal theme",
        "Style: quiet editorial restraint",
        "General 3: polished studio minimalism"
      ].join("\n\n")
    );
    expect(assembly.sections.map((section) => [section.nodeId, section.section])).toEqual([
      ["assistant", "General"],
      ["note", "General 2"],
      ["reference", "Style"],
      ["prompt", "General 3"]
    ]);
  });

  it("uses visible Prompt helper output as a downstream generation prompt artifact", () => {
    const canvas = graph(
      [
        node("mutator", {
          definitionId: "prompt-mutator",
          kind: "Prompt",
          subtype: "Mutator",
          title: "Mutator",
          instruction: "original mutator instruction",
          textOutput: "seeded editorial variation with chrome bottle" as any
        } as any),
        node("generation", {
          definitionId: "generation-image",
          kind: "Generation",
          subtype: "Image"
        })
      ],
      [{ id: "edge-mutator-generation", source: "mutator", target: "generation", label: "prompt" }]
    );

    const assembly = assembleGenerationInputs(canvas, "generation");

    expect(assembly.prompt).toBe("General: seeded editorial variation with chrome bottle");
    expect(assembly.sections).toEqual([
      expect.objectContaining({
        nodeId: "mutator",
        section: "General",
        text: "seeded editorial variation with chrome bottle"
      })
    ]);
  });

  it("keeps a same-role prompt helper chain as one conceptual generation section", () => {
    const canvas = graph(
      [
        node("subject", {
          definitionId: "prompt-prompt",
          kind: "Prompt",
          subtype: "Prompt",
          instruction: "20-years-old Brazilian woman holding a watermelon"
        }),
        node("mutator", {
          definitionId: "prompt-mutator",
          kind: "Prompt",
          subtype: "Mutator",
          instruction: "Change the fruit to a different tropical fruit",
          textOutput: "20-years-old Brazilian woman holding a ripe pineapple" as any
        } as any),
        node("expander", {
          definitionId: "prompt-expander",
          kind: "Prompt",
          subtype: "Expander",
          instruction: "Make the subject more detailed"
        }),
        node("generation", {
          definitionId: "generation-image",
          kind: "Generation",
          subtype: "Image"
        })
      ],
      [
        { id: "edge-subject-mutator", source: "subject", target: "mutator", data: { role: "subject" } },
        { id: "edge-mutator-expander", source: "mutator", target: "expander", data: { role: "subject" } },
        { id: "edge-expander-generation", source: "expander", target: "generation", data: { role: "subject" } }
      ]
    );

    const assembly = assembleGenerationInputs(canvas, "generation");

    expect(assembly.prompt).toBe(
      "Subject: 20-years-old Brazilian woman holding a ripe pineapple\n\nMake the subject more detailed"
    );
    expect(assembly.sections.map((section) => section.section)).toEqual(["Subject"]);
  });

  it("numbers repeated generation roles only when they arrive on separate direct lanes", () => {
    const canvas = graph(
      [
        node("subject-a", {
          definitionId: "prompt-prompt",
          kind: "Prompt",
          subtype: "Prompt",
          instruction: "first model in a blue coat"
        }),
        node("subject-b", {
          definitionId: "prompt-prompt",
          kind: "Prompt",
          subtype: "Prompt",
          instruction: "second model in a silver coat"
        }),
        node("generation", {
          definitionId: "generation-image",
          kind: "Generation",
          subtype: "Image"
        })
      ],
      [
        { id: "edge-subject-a-generation", source: "subject-a", target: "generation", data: { role: "subject" } },
        { id: "edge-subject-b-generation", source: "subject-b", target: "generation", data: { role: "subject" } }
      ]
    );

    const assembly = assembleGenerationInputs(canvas, "generation");

    expect(assembly.prompt).toBe("Subject: first model in a blue coat\n\nSubject 2: second model in a silver coat");
    expect(assembly.sections.map((section) => section.section)).toEqual(["Subject", "Subject 2"]);
  });

  it("uses a role caption rather than edited Prompt node labels as the assembled section name", () => {
    const canvas = graph(
      [
        node("subject", {
          definitionId: "prompt-prompt",
          kind: "Prompt",
          subtype: "Prompt",
          title: "Subject Prompt",
          label: "Hero Product",
          instruction: "chrome espresso machine"
        })
      ],
      []
    );

    const assembly = assemblePromptForNode(canvas, "subject");

    expect(assembly.sections[0]).toMatchObject({
      nodeId: "subject",
      title: "Subject Prompt",
      section: "General",
      text: "chrome espresso machine"
    });
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

  it("normalizes legacy reference, context, and custom labels to the General connection role", () => {
    const canvas = graph(
      [
        node("reference", {
          definitionId: "reference-image",
          kind: "Reference",
          subtype: "Image",
          title: "Reference",
          instruction: "base image"
        }),
        node("context", {
          definitionId: "note-cloud",
          kind: "Note",
          subtype: "Cloud",
          title: "Context",
          notes: "brief context"
        }),
        node("custom", {
          definitionId: "reference-image",
          kind: "Reference",
          subtype: "Image",
          title: "Custom",
          instruction: "custom steering"
        }),
        node("generation", {
          definitionId: "generation-image",
          kind: "Generation",
          subtype: "Image"
        })
      ],
      [
        { id: "edge-reference-generation", source: "reference", target: "generation", label: "reference" },
        { id: "edge-context-generation", source: "context", target: "generation", label: "context" },
        { id: "edge-custom-generation", source: "custom", target: "generation", label: "custom" }
      ]
    );

    expect(assembleGenerationInputs(canvas, "generation").references.map((reference) => reference.role)).toEqual([
      "general",
      "general",
      "general"
    ]);
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

  it("falls back ordinary image references with unknown labels to General", () => {
    const canvas = graph(
      [
        node("reference", {
          definitionId: "reference-image",
          kind: "Reference",
          subtype: "Image",
          title: "Source Image"
        }),
        node("generation", {
          definitionId: "generation-image",
          kind: "Generation",
          subtype: "Image"
        })
      ],
      [{ id: "edge-reference-generation", source: "reference", target: "generation", label: "vibes" }]
    );

    expect(assembleGenerationInputs(canvas, "generation").references[0].role).toBe("general");
  });

  it("includes linked reference asset paths for provider image inputs", () => {
    const canvas = graph(
      [
        node("reference", {
          definitionId: "reference-image",
          kind: "Reference",
          subtype: "Image",
          title: "Product Reference",
          assetId: "asset-reference-1",
          assetKind: "reference",
          assetPath: "C:\\Project\\references\\product.png",
          assetMetadata: {
            originalName: "product.png"
          }
        }),
        node("generation", {
          definitionId: "generation-image",
          kind: "Generation",
          subtype: "Image"
        })
      ],
      [{ id: "edge-reference-generation", source: "reference", target: "generation", label: "product" }]
    );

    expect(assembleGenerationInputs(canvas, "generation").references[0]).toMatchObject({
      nodeId: "reference",
      role: "product",
      assetId: "asset-reference-1",
      assetKind: "reference",
      assetPath: "C:\\Project\\references\\product.png",
      assetMetadata: {
        originalName: "product.png"
      }
    });
  });

  it("collects prompt sections, negative constraints, and references for generation nodes", () => {
    const canvas = graph(
      [
        node("prompt", {
          definitionId: "prompt-prompt",
          kind: "Prompt",
          subtype: "Prompt",
          instruction: "sharp studio portrait"
        }),
        node("negative", {
          definitionId: "prompt-prompt",
          kind: "Prompt",
          subtype: "Prompt",
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
      prompt: "General: sharp studio portrait",
      negativePrompt: "Negative: low quality",
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
          definitionId: "prompt-prompt",
          kind: "Prompt",
          subtype: "Prompt",
          instruction: "glass perfume bottle"
        }),
        node("final", {
          definitionId: "prompt-prompt",
          kind: "Prompt",
          subtype: "Prompt",
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
      assembledPrompt: "Subject: glass perfume bottle\n\nGeneral: on reflective acrylic",
      lastRunAt: "2026-06-17T08:00:00.000Z",
      status: "complete"
    });
    expect(promptNode?.data.instruction).toBe("on reflective acrylic");
  });
});
