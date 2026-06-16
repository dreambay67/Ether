import { describe, expect, it } from "vitest";
import {
  NODE_CATEGORIES,
  NODE_CONTRACTS,
  NODE_DEFINITIONS,
  canConnectNodeKinds,
  coerceCanvasNodeData,
  createGraphNodeData,
  getOptionalNodeContract,
  findEdgeInsertionTarget
} from "@ether/engine";

const requiredSubtypes = {
  Prompt: [
    "General",
    "Subject",
    "Clothing",
    "Pose",
    "Setting",
    "Composition",
    "Style",
    "Lighting",
    "Colour Palette",
    "Typography",
    "Custom",
    "Negative"
  ],
  Reference: ["Image", "Video Reference", "Colour Grid", "Moodboard"],
  Edit: ["Inpaint", "Expand / Outpaint", "Draw & Note", "Upscale"],
  Store: ["Directory", "Collection", "Compare", "Evaluate", "Filter"],
  Assistant: ["Brainstormer", "Mutator", "Expander", "Reinforcer"],
  Generation: ["Image", "Grid", "Character Sheet", "Infographic"],
  Note: ["Cloud", "Bubble", "Free Draw"]
} as const;

describe("graph node catalog", () => {
  it("includes every required subtype exactly once", () => {
    expect(NODE_CATEGORIES.map((category) => category.label)).toEqual(Object.keys(requiredSubtypes));

    for (const [category, subtypes] of Object.entries(requiredSubtypes)) {
      const definitions = NODE_DEFINITIONS.filter((definition) => definition.category === category);

      expect(definitions.map((definition) => definition.subtype).sort()).toEqual([...subtypes].sort());
      expect(new Set(definitions.map((definition) => definition.subtype)).size).toBe(subtypes.length);
    }
  });

  it("creates editable default node data from a catalog definition", () => {
    const data = createGraphNodeData("prompt-general");

    expect(data).toMatchObject({
      definitionId: "prompt-general",
      kind: "Prompt",
      subtype: "General",
      title: "General Prompt",
      label: "General Prompt",
      status: "idle"
    });
    expect(data.instruction).toContain("General");
  });

  it("marks only prompt contracts runnable for current local Task 3 execution", () => {
    const runnableContracts = NODE_CONTRACTS.filter((contract) => contract.runnable);

    expect(runnableContracts.map((contract) => contract.definitionId).sort()).toEqual(
      NODE_DEFINITIONS.filter((definition) => definition.category === "Prompt")
        .map((definition) => definition.id)
        .sort()
    );
  });

  it("offers a safe optional contract lookup for malformed persisted nodes", () => {
    expect(getOptionalNodeContract("missing-definition")).toBeNull();
    expect(getOptionalNodeContract(undefined)).toBeNull();
    expect(getOptionalNodeContract("prompt-general")).toMatchObject({ definitionId: "prompt-general" });
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
});

describe("connection rules", () => {
  it.each([
    ["Prompt", "Generation"],
    ["Reference", "Generation"],
    ["Generation", "Edit"],
    ["Generation", "Store"],
    ["Generation", "Compare"],
    ["Evaluate", "Filter"],
    ["Filter", "Collection"],
    ["Prompt", "Prompt"],
    ["Reference", "Prompt"],
    ["Store", "Store"],
    ["Assistant", "Prompt"],
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
