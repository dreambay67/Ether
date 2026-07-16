import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  NODE_CATEGORIES,
  NODE_CATEGORY_LABELS,
  NODE_CONTRACTS,
  NODE_DEFINITIONS,
  canConnectNodeKinds,
  coerceCanvasNodeData,
  CANVAS_TEMPLATE_CATALOG,
  createCanvasTemplate,
  createReviewRouterTemplate,
  decorateEdgeForNodes,
  createGraphNodeData,
  defaultHandlesForConnection,
  findEdgeInsertionTarget,
  getOptionalNodeContract,
  assembleGenerationInputs
} from "@ether/engine";
import { REFERENCE_ROLE_OPTIONS, DEFAULT_REFERENCE_ROLE } from "../../../apps/desktop/src/renderer/canvas/referenceRoles";

const manualPath = fileURLToPath(new URL("../../../docs/product/ether-2.0-user-manual.md", import.meta.url));

const artifactHelpLabels = new Map([
  ["prompt", "prompt"],
  ["negativePrompt", "negative prompt"],
  ["reference", "reference"],
  ["image", "image"],
  ["mask", "mask"],
  ["metadata", "metadata"],
  ["collection", "collection"],
  ["note", "note"],
  ["compare", "compare"],
  ["evaluation", "evaluation"],
  ["filterRule", "rule"],
  ["editedImage", "edited image"],
  ["text", "text"],
  ["route", "route"]
]);

type ContractHelpShape = {
  acceptedInputs: string;
  producedOutputs: string;
  primaryAction: string;
  useCase: string;
  graphInputs?: string[];
  manualInputs?: string[];
  graphInputHelp?: string;
  manualInputHelp?: string;
};

function expectHelpMentionsArtifacts(text: string, artifactKinds: string[]) {
  const normalized = text.toLowerCase();

  if (artifactKinds.length === 0) {
    expect(normalized).toContain("no upstream");
    return;
  }

  for (const artifactKind of artifactKinds) {
    expect(normalized).toContain(artifactHelpLabels.get(artifactKind) ?? artifactKind.toLowerCase());
  }
}

function definitionForContract(contract: { definitionId: string }) {
  const definition = NODE_DEFINITIONS.find((candidate) => candidate.id === contract.definitionId);

  if (!definition) {
    throw new Error(`Missing definition for contract ${contract.definitionId}`);
  }

  return definition;
}

function hasValidGraphProducer(targetContract: { definitionId: string }, artifactKind: string) {
  const targetDefinition = definitionForContract(targetContract);

  return NODE_CONTRACTS.some((sourceContract) => {
    const sourceDefinition = definitionForContract(sourceContract);

    return sourceContract.outputPorts.some((port) => port.artifactKind === artifactKind) &&
      canConnectNodeKinds(sourceDefinition.category, targetDefinition.category, {
        sourceDefinitionId: sourceContract.definitionId,
        targetDefinitionId: targetContract.definitionId,
        sourcePortId: artifactKind,
        targetPortId: artifactKind
      }).allowed;
  });
}

const requiredSubtypes = {
  Prompt: ["Prompt", "Brainstormer", "Mutator", "Expander", "Reinforcer"],
  Reference: ["Image", "Video Reference", "Audio Reference", "Colour Grid", "Moodboard"],
  Generation: ["Image", "Grid", "Character Sheet", "Infographic"],
  Edit: ["Inpaint", "Expand / Outpaint", "Draw & Note", "Upscale"],
  Review: ["Compare", "Evaluation", "Filter"],
  Store: ["Collection", "Directory"],
  Note: ["Cloud", "Bubble", "Free Draw"]
} as const;

const documentedManualCategories = ["Prompt", "Reference", "Edit", "Store", "Review", "Generation", "Note"] as const;
const manualCategoryHeadings = new Map<string, string>([
  ["Review", "## compare evaluate filter"]
]);

describe("graph node catalog", () => {
  it("includes every required subtype exactly once", () => {
    expect(NODE_CATEGORIES.map((category) => category.label)).toEqual(Object.keys(requiredSubtypes));

    for (const [category, subtypes] of Object.entries(requiredSubtypes)) {
      const definitions = NODE_DEFINITIONS.filter((definition) => definition.category === category);

      expect(definitions.map((definition) => definition.subtype).sort()).toEqual([...subtypes].sort());
      expect(new Set(definitions.map((definition) => definition.subtype)).size).toBe(subtypes.length);
    }
  });

  it("assembles every image from a bundled Reference node as generation references", () => {
    const graph = {
      nodes: [
        {
          id: "reference",
          type: "etherNode",
          position: { x: 0, y: 0 },
          data: {
            definitionId: "reference-moodboard",
            kind: "Reference",
            subtype: "Moodboard",
            title: "Moodboard",
            label: "Moodboard",
            instruction: "Linked moodboard image references",
            notes: "",
            status: "complete",
            referenceAssets: [
              {
                assetId: "asset-a",
                assetKind: "reference",
                assetPath: "C:\\Project\\refs\\a.png",
                title: "A"
              },
              {
                assetId: "asset-b",
                assetKind: "reference",
                assetPath: "C:\\Project\\refs\\b.png",
                title: "B"
              }
            ]
          }
        },
        {
          id: "generation",
          type: "etherNode",
          position: { x: 260, y: 0 },
          data: {
            definitionId: "generation-image",
            kind: "Generation",
            subtype: "Image",
            title: "Image",
            label: "Image",
            instruction: "",
            notes: "",
            status: "idle"
          }
        }
      ],
      edges: [
        {
          id: "edge-reference-generation",
          source: "reference",
          target: "generation",
          label: "style",
          data: { label: "style" }
        }
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
      selectedSnapshotId: null,
      updatedAt: "2026-06-17T00:00:00.000Z"
    };

    const assembly = assembleGenerationInputs(graph, "generation");

    expect(assembly.references).toEqual([
      expect.objectContaining({ assetId: "asset-a", assetPath: "C:\\Project\\refs\\a.png", role: "style", title: "A" }),
      expect.objectContaining({ assetId: "asset-b", assetPath: "C:\\Project\\refs\\b.png", role: "style", title: "B" })
    ]);
  });

  it("creates editable default node data from a catalog definition", () => {
    const data = createGraphNodeData("prompt-prompt");

    expect(data).toMatchObject({
      definitionId: "prompt-prompt",
      kind: "Prompt",
      subtype: "Prompt",
      title: "Prompt",
      label: "Prompt",
      status: "idle"
    });
    expect(data.instruction).toContain("Prompt");
  });

  it("marks locally executable Prompt, Generation, Edit, Review, and Store contracts runnable", () => {
    const runnableContracts = NODE_CONTRACTS.filter((contract) => contract.runnable);

    expect(runnableContracts.map((contract) => contract.definitionId).sort()).toEqual(
      NODE_DEFINITIONS.filter((definition) =>
        ["Prompt", "Generation", "Edit", "Review", "Store"].includes(definition.category)
      )
        .map((definition) => definition.id)
        .sort()
    );
    expect(getOptionalNodeContract("edit-inpaint")).toMatchObject({
      runnable: true,
      runLabel: "Run Edit",
      producedOutputs: expect.arrayContaining(["editedImage", "mask", "metadata"])
    });
    expect(getOptionalNodeContract("edit-upscale")).toMatchObject({
      runnable: true,
      runLabel: "Upscale"
    });
    expect(getOptionalNodeContract("prompt-mutator")).toMatchObject({
      runnable: true,
      runLabel: "Assemble Prompt",
      producedOutputs: expect.arrayContaining(["prompt"])
    });
    expect(getOptionalNodeContract("review-compare")).toMatchObject({
      runnable: true,
      runLabel: "Compare",
      producedOutputs: expect.arrayContaining(["compare", "metadata"])
    });
    expect(getOptionalNodeContract("review-evaluation")).toMatchObject({
      runnable: true,
      runLabel: "Evaluate",
      producedOutputs: expect.arrayContaining(["evaluation", "metadata"])
    });
    expect(getOptionalNodeContract("review-filter")).toMatchObject({
      runnable: true,
      runLabel: "Filter"
    });
  });

  it("teaches every node contract with dedicated help fields", () => {
    for (const contract of NODE_CONTRACTS) {
      const help = (contract as typeof contract & { help?: ContractHelpShape }).help;

      expect(help).toMatchObject({
        acceptedInputs: expect.any(String),
        producedOutputs: expect.any(String),
        primaryAction: expect.any(String),
        useCase: expect.any(String)
      });
      expect(help?.acceptedInputs.length).toBeGreaterThan(24);
      expect(help?.producedOutputs.length).toBeGreaterThan(24);
      expect(help?.primaryAction).toContain(contract.runLabel);
      expect(help?.useCase.length).toBeGreaterThan(24);
      expectHelpMentionsArtifacts(help?.acceptedInputs ?? "", contract.acceptedInputs);
      expectHelpMentionsArtifacts(help?.producedOutputs ?? "", contract.producedOutputs);
    }
  });

  it("separates graph-connectable inputs from manual or local context inputs in help", () => {
    for (const contract of NODE_CONTRACTS) {
      const help = (contract as typeof contract & { help?: ContractHelpShape }).help;
      const graphInputs = help?.graphInputs ?? [];
      const manualInputs = help?.manualInputs ?? [];
      const classifiedInputs = new Set([...graphInputs, ...manualInputs]);

      expect(help?.acceptedInputs.toLowerCase()).not.toContain("connect these artifacts");
      expect(graphInputs).toEqual(expect.any(Array));
      expect(manualInputs).toEqual(expect.any(Array));
      expect([...classifiedInputs].sort()).toEqual([...contract.acceptedInputs].sort());
      expect(graphInputs.every((artifactKind) => contract.acceptedInputs.some((input) => input === artifactKind))).toBe(true);
      expect(manualInputs.every((artifactKind) => contract.acceptedInputs.some((input) => input === artifactKind))).toBe(true);

      for (const artifactKind of graphInputs) {
        expect(hasValidGraphProducer(contract, artifactKind)).toBe(true);
      }

      if (manualInputs.length > 0) {
        expect(help?.manualInputHelp?.toLowerCase()).toMatch(/manual|local|context-only/);
      }
    }
  });

  it("offers a safe optional contract lookup for malformed persisted nodes", () => {
    expect(getOptionalNodeContract("missing-definition")).toBeNull();
    expect(getOptionalNodeContract(undefined)).toBeNull();
    expect(getOptionalNodeContract("prompt-prompt")).toMatchObject({ definitionId: "prompt-prompt" });
  });

  it("coerces missing persisted node data into a safe legacy fallback", () => {
    expect(coerceCanvasNodeData(undefined)).toMatchObject({
      definitionId: "",
      kind: "Note",
      subtype: "Legacy node",
      title: "Legacy node",
      label: "Legacy node",
      instruction: "",
      notes: "",
      status: "idle"
    });
  });

  it("coerces legacy Assistant mutators into Prompt mutator helpers", () => {
    expect(
      coerceCanvasNodeData({
        definitionId: "assistant-mutator",
        kind: "Assistant",
        subtype: "Mutator",
        title: "Mutation pass",
        label: "Mutation helper",
        notes: "Preserve this note",
        instruction: "Make the prompt stranger.",
        textOutput: "More cinematic",
        status: "complete"
      })
    ).toMatchObject({
      definitionId: "prompt-mutator",
      kind: "Prompt",
      subtype: "Mutator",
      title: "Mutation pass",
      label: "Mutation helper",
      notes: "Preserve this note",
      instruction: "Make the prompt stranger.",
      textOutput: "More cinematic",
      status: "complete"
    });
  });
});

describe("Ether 2.0 user manual source", () => {
  it("documents core user flows, systems, and every node category", () => {
    const manual = readFileSync(manualPath, "utf8");
    const normalized = manual.toLowerCase();

    for (const category of documentedManualCategories) {
      expect(normalized).toContain(manualCategoryHeadings.get(category) ?? `### ${category.toLowerCase()} nodes`);
    }

    for (const requiredTopic of [
      "start flow",
      "canvas",
      "nodes",
      "edges and reference roles",
      "prompt mutation",
      "assistant and codex co-pilot",
      "run preview and execution",
      "mask and edit workspace",
      "compare evaluate filter",
      "artifact browser",
      "providers and api infrastructure",
      "collections",
      "project health recovery and privacy",
      "troubleshooting",
      "manual acceptance basics"
    ]) {
      expect(normalized).toContain(`## ${requiredTopic}`);
    }
  });

  it("does not overpromise planned start-flow or recovery behavior", () => {
    const manual = readFileSync(manualPath, "utf8").toLowerCase();

    expect(manual).toMatch(/try sample[\s\S]{0,160}(planned|disabled|unavailable)/);
    expect(manual).toMatch(/recover project[\s\S]{0,160}(planned|disabled|unavailable)/);
    expect(manual).toMatch(/project health[\s\S]{0,260}(provider logs|run metadata|run artifacts)/);
    expect(manual).not.toMatch(/try sample[\s\S]{0,120}creates a starter graph/);
    expect(manual).not.toMatch(/recover project[\s\S]{0,120}opens recovery controls/);
    expect(manual).not.toMatch(/restore(?:ing)? a revision|previous graph revision|revision restore/);
  });
});

describe("review router template", () => {
  it("exposes every gallery template with valid graph fragments", () => {
    expect(CANVAS_TEMPLATE_CATALOG.map((template) => template.title)).toEqual([
      "Prompt to Image",
      "Reference Set",
      "Product Shoot",
      "Character Sheet",
      "Edit Loop",
      "Review Router",
      "Collection Routing"
    ]);

    for (const summary of CANVAS_TEMPLATE_CATALOG) {
      const template = createCanvasTemplate(summary.id, {
        idPrefix: summary.id,
        origin: { x: 80, y: 120 }
      });

      expect(template.nodes.length).toBeGreaterThan(0);
      expect(template.nodes.every((node) => NODE_DEFINITIONS.some((definition) => definition.id === node.data.definitionId))).toBe(true);
      expect(template.edges.every((edge) => (
        template.nodes.some((node) => node.id === edge.source) &&
        template.nodes.some((node) => node.id === edge.target)
      ))).toBe(true);
    }
  });

  it("creates a reusable Compare -> Evaluate -> Filter router with collection destinations", () => {
    const template = createReviewRouterTemplate({
      idPrefix: "review",
      origin: { x: 120, y: 240 }
    });

    expect(template.nodes.map((node) => node.id)).toEqual([
      "review-compare",
      "review-evaluation",
      "review-filter",
      "review-selected",
      "review-needs-edit",
      "review-rejected"
    ]);
    expect(template.nodes.map((node) => node.data.subtype)).toEqual([
      "Compare",
      "Evaluation",
      "Filter",
      "Collection",
      "Collection",
      "Collection"
    ]);
    expect(template.edges.map((edge) => [edge.source, edge.target, edge.label])).toEqual([
      ["review-compare", "review-evaluation", "review"],
      ["review-evaluation", "review-filter", "evaluation"],
      ["review-filter", "review-selected", "pass"],
      ["review-filter", "review-needs-edit", "needs-edit"],
      ["review-filter", "review-rejected", "fail"]
    ]);
  });

  it("decorates review router template edges with semantic typed handles", () => {
    const template = createReviewRouterTemplate({ idPrefix: "review" });
    const decoratedEdges = template.edges.map((edge) => decorateEdgeForNodes(edge, template.nodes));

    expect(decoratedEdges).toEqual([
      expect.objectContaining({
        source: "review-compare",
        target: "review-evaluation",
        sourceHandle: "compare",
        targetHandle: "compare",
        data: expect.objectContaining({
          sourceChannel: "data",
          targetChannel: "data"
        })
      }),
      expect.objectContaining({
        source: "review-evaluation",
        target: "review-filter",
        sourceHandle: "evaluation",
        targetHandle: "evaluation",
        data: expect.objectContaining({
          sourceChannel: "data",
          targetChannel: "data"
        })
      }),
      expect.objectContaining({
        source: "review-filter",
        target: "review-selected",
        sourceHandle: "route",
        targetHandle: "collection",
        data: expect.objectContaining({
          sourceChannel: "data",
          targetChannel: "data"
        })
      }),
      expect.objectContaining({
        source: "review-filter",
        target: "review-needs-edit",
        sourceHandle: "route",
        targetHandle: "collection"
      }),
      expect.objectContaining({
        source: "review-filter",
        target: "review-rejected",
        sourceHandle: "route",
        targetHandle: "collection"
      })
    ]);
  });

  it("decorates collection routing exits as route-to-collection edges", () => {
    const template = createCanvasTemplate("collection-routing", { idPrefix: "route" });
    const decoratedEdges = template.edges
      .filter((edge) => edge.source === "route-filter")
      .map((edge) => decorateEdgeForNodes(edge, template.nodes));

    expect(decoratedEdges).toEqual([
      expect.objectContaining({
        id: "route-edge-filter-heroes",
        sourceHandle: "route",
        targetHandle: "collection",
        data: expect.objectContaining({
          sourceChannel: "data",
          targetChannel: "data"
        })
      }),
      expect.objectContaining({
        id: "route-edge-filter-alternates",
        sourceHandle: "route",
        targetHandle: "collection",
        data: expect.objectContaining({
          sourceChannel: "data",
          targetChannel: "data"
        })
      })
    ]);
  });

  it("decorates template edges with typed handles and rejects mismatched ports", () => {
    const promptNode = {
      id: "prompt",
      data: createGraphNodeData("prompt-prompt")
    };
    const generationNode = {
      id: "generation",
      data: createGraphNodeData("generation-image")
    };
    const handles = defaultHandlesForConnection(promptNode, generationNode);

    expect(handles).toEqual({ sourceHandle: "prompt", targetHandle: "prompt" });
    expect(
      decorateEdgeForNodes(
        {
          id: "edge-valid",
          source: "prompt",
          target: "generation"
        },
        [promptNode, generationNode]
      )
    ).toMatchObject({
      sourceHandle: "prompt",
      targetHandle: "prompt",
      label: "prompt",
      type: "etherEdge"
    });
    expect(
      decorateEdgeForNodes(
        {
          id: "edge-image-channel",
          source: "prompt",
          target: "generation",
          sourceHandle: "prompt",
          targetHandle: "reference"
        },
        [promptNode, generationNode]
      )
    ).toMatchObject({
      sourceHandle: "prompt",
      targetHandle: "reference",
      data: expect.objectContaining({
        sourceChannel: "text",
        targetChannel: "image"
      })
    });
    expect(
      decorateEdgeForNodes(
        {
          id: "edge-invalid",
          source: "prompt",
          target: "generation",
          sourceHandle: "prompt",
          targetHandle: "audio"
        },
        [promptNode, generationNode]
      )
    ).toBeNull();
  });
});

describe("connection rules", () => {
  it("exposes typed input and output ports on node contracts", () => {
    expect(getOptionalNodeContract("prompt-prompt")).toMatchObject({
      inputPorts: expect.arrayContaining([
        expect.objectContaining({
          id: "prompt",
          label: "Prompt",
          artifactKind: "prompt",
          direction: "input",
          required: false
        })
      ]),
      outputPorts: expect.arrayContaining([
        expect.objectContaining({
          id: "prompt",
          label: "Prompt",
          artifactKind: "prompt",
          direction: "output",
          required: true
        })
      ])
    });
    expect(getOptionalNodeContract("generation-image")).toMatchObject({
      inputPorts: expect.arrayContaining([
        expect.objectContaining({
          id: "prompt",
          label: "Prompt",
          artifactKind: "prompt",
          direction: "input",
          required: true
        }),
        expect.objectContaining({
          id: "reference",
          label: "Reference",
          artifactKind: "reference",
          direction: "input",
          required: false
        })
      ]),
      outputPorts: expect.arrayContaining([
        expect.objectContaining({
          id: "image",
          label: "Image",
          artifactKind: "image",
          direction: "output",
          required: true
        })
      ])
    });
  });

  it.each([
    ["Prompt", "Generation"],
    ["Reference", "Generation"],
    ["Generation", "Edit"],
    ["Edit", "Edit"],
    ["Generation", "Store"],
    ["Generation", "Review"],
    ["Generation", "Compare"],
    ["Evaluation", "Filter"],
    ["Filter", "Collection"],
    ["Prompt", "Prompt"],
    ["Reference", "Prompt"],
    ["Reference", "Review"],
    ["Review", "Review"],
    ["Review", "Store"],
    ["Store", "Store"],
    ["Note", "Prompt"]
  ])("accepts %s -> %s", (sourceKind, targetKind) => {
    expect(canConnectNodeKinds(sourceKind, targetKind)).toMatchObject({ allowed: true });
  });

  it.each([
    ["Generation", "Prompt"],
    ["Edit", "Reference"],
    ["Store", "Generation"]
  ])("rejects invalid %s -> %s", (sourceKind, targetKind) => {
    expect(canConnectNodeKinds(sourceKind, targetKind)).toMatchObject({ allowed: false });
  });

  it("rejects self-connections with a clear reason", () => {
    expect(
      canConnectNodeKinds("Prompt", "Generation", { sourceId: "node-1", targetId: "node-1" })
    ).toMatchObject({ allowed: false, reason: "A node cannot connect to itself." });
  });

  it("rejects incompatible typed ports with a clear reason", () => {
    expect(
      canConnectNodeKinds("Reference", "Generation", {
        sourceDefinitionId: "reference-image",
        targetDefinitionId: "generation-image",
        sourcePortId: "metadata",
        targetPortId: "prompt"
      })
    ).toMatchObject({
      allowed: false,
      reason: "Cannot connect Metadata output to Prompt input. Generation Image expects prompt, but Reference Image produces metadata."
    });
  });

  it("rejects channel context that drifts outside advertised node contracts", () => {
    expect(
      canConnectNodeKinds("Reference", "Review", {
        sourceDefinitionId: "reference-image",
        targetDefinitionId: "review-evaluation",
        sourceChannel: "audio",
        targetChannel: "text"
      })
    ).toMatchObject({
      allowed: false,
      reason: expect.stringContaining("does not produce Audio")
    });

    expect(
      canConnectNodeKinds("Prompt", "Generation", {
        sourceDefinitionId: "prompt-prompt",
        targetDefinitionId: "generation-image",
        sourceChannel: "text",
        targetChannel: "audio"
      })
    ).toMatchObject({
      allowed: false,
      reason: expect.stringContaining("does not accept Audio")
    });
  });

  it("defaults reference edge roles to context", () => {
    expect(
      canConnectNodeKinds("Reference", "Generation", {
        sourceDefinitionId: "reference-image",
        targetDefinitionId: "generation-image",
        sourcePortId: "reference",
        targetPortId: "reference"
      })
    ).toMatchObject({
      allowed: true,
      defaultLabel: DEFAULT_REFERENCE_ROLE,
      defaultRole: "general"
    });
  });

  it("keeps the reference role selector on the established 11 options", () => {
    expect(DEFAULT_REFERENCE_ROLE).toBe("context");
    expect(REFERENCE_ROLE_OPTIONS.map((role) => [role.value, role.label])).toEqual([
      ["context", "Context (general)"],
      ["subject", "Subject"],
      ["style", "Style"],
      ["composition", "Composition"],
      ["product", "Product"],
      ["face", "Face"],
      ["setting", "Setting"],
      ["lighting", "Lighting"],
      ["colourPalette", "Colour palette"],
      ["negative", "Negative"],
      ["reference", "Reference"]
    ]);
  });
});

describe("edge insertion geometry", () => {
  const nodes = [
    { id: "source", position: { x: 0, y: 0 }, width: 120, height: 80 },
    { id: "target", position: { x: 300, y: 0 }, width: 120, height: 80 },
    { id: "insert", position: { x: 155, y: 15 }, width: 70, height: 50 },
    { id: "far", position: { x: 100, y: 260 }, width: 70, height: 50 }
  ];
  const edges = [{ id: "edge-1", source: "source", target: "target" }];

  it("identifies a dragged node near an edge", () => {
    expect(findEdgeInsertionTarget({ draggedNodeId: "insert", nodes, edges })).toEqual(edges[0]);
  });

  it("ignores a dragged node far from an edge", () => {
    expect(findEdgeInsertionTarget({ draggedNodeId: "far", nodes, edges })).toBeNull();
  });
});
