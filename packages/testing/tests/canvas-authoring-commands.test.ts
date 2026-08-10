import { describe, expect, it } from "vitest";
import { nodeLibraryItems } from "@ether/graph-kernel";
import type { EtherEdge, EtherGraph, EtherNode } from "@ether/schema";

import { cloneGraphSelection, commandIdForKeyboard, commandPreservesCanvasFocus, graphDeleteConfirmationMessage, graphDeleteImpact } from "../../../apps/desktop/src/renderer/canvas/commands/useGraphCommands";
import { configFromPrimaryDraft, primaryEditorFor } from "../../../apps/desktop/src/renderer/canvas/commands/directEditing";
import { createNodeFromDefinition } from "../../../apps/desktop/src/renderer/canvas/commands/useNodeCommands";
import { marqueeHitIds, marqueeRectangle, marqueeSelectionStart, marqueeSelectionUpdate, toggleId } from "../../../apps/desktop/src/renderer/canvas/hooks/useCanvasInteraction";
import { filterNodeCatalog, quickAddPosition } from "../../../apps/desktop/src/renderer/canvas/library/NodeLibrary";
import { centeredCanvasPosition, openCanvasPosition } from "../../../apps/desktop/src/renderer/canvas/placement";
import { canvasPointerActionFor, isBlankCanvas, shouldRouteWorkspaceShortcut } from "../../../apps/desktop/src/renderer/canvas/CanvasSurface";
import { nodeReadinessLabel } from "../../../apps/desktop/src/renderer/canvas/EtherNode";
import { canvasCommandForAccelerator } from "../../../apps/desktop/src/main/canvasAccelerator";

const presentation = { collapsed: false, accent: "default", previewMode: "content" as const };
const base = { id: "node-1", title: "Node", position: { x: 10, y: 20 }, size: { width: 240, height: 150 }, presentation };

function promptNode(id: string, position: { x: number; y: number }) {
  const definition = nodeLibraryItems.find((item) => item.definitionId === "prompt.text");
  if (definition === undefined) throw new Error("The prompt definition is missing from the test catalog.");
  const node = createNodeFromDefinition(definition, 1, position);
  if (node === null) throw new Error("The prompt definition produced an invalid test node.");
  return { ...node, id };
}

function nodeEdge(id: string, fromId: string, toId: string): EtherEdge {
  return { id, from: { kind: "node", nodeId: fromId, channel: "text" }, to: { kind: "node", nodeId: toId, channel: "text" }, role: "general", order: 0, selector: { kind: "latest-approved" }, adapter: { kind: "auto" }, enabled: true };
}

function selectionGraph(): Pick<EtherGraph, "nodes" | "edges"> {
  return {
    nodes: [
      promptNode("source", { x: 10, y: 20 }),
      promptNode("target", { x: 310, y: 20 }),
      promptNode("external", { x: 610, y: 20 }),
      promptNode("isolated", { x: 10, y: 260 })
    ] as unknown as EtherGraph["nodes"],
    edges: [nodeEdge("internal", "source", "target"), nodeEdge("outbound", "target", "external")]
  };
}

describe("canvas authoring command map", () => {
  it("maps the recovery shortcuts through one command vocabulary", () => {
    const key = (value: string, options: Partial<KeyboardEvent> = {}) => commandIdForKeyboard({ key: value, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...options });
    expect(key("Delete")).toBe("delete");
    expect(key("d", { ctrlKey: true })).toBe("duplicate");
    expect(key("c", { ctrlKey: true })).toBe("copy");
    expect(key("x", { ctrlKey: true })).toBe("cut");
    expect(key("v", { ctrlKey: true })).toBe("paste");
    expect(key("a", { ctrlKey: true })).toBe("selectAll");
    expect(key("z", { ctrlKey: true })).toBe("undo");
    expect(key("z", { ctrlKey: true, shiftKey: true })).toBe("redo");
    expect(key("g", { ctrlKey: true })).toBe("createModule");
    expect(key("g", { ctrlKey: true, shiftKey: true })).toBe("dissolveModule");
    expect(key("F2")).toBe("rename");
    expect(key("Enter")).toBe("edit");
    expect(key("Enter", { ctrlKey: true })).toBe("runSelected");
    expect(key("k", { ctrlKey: true })).toBe("palette");
    expect(key("Home")).toBe("fit");
  });

  it("routes Chromium-reserved Module accelerators through Electron main", () => {
    const input = { type: "keyDown", key: "g", control: true, meta: false, alt: false, shift: false };
    expect(canvasCommandForAccelerator(input)).toBe("createModule");
    expect(canvasCommandForAccelerator({ ...input, shift: true })).toBe("dissolveModule");
    expect(canvasCommandForAccelerator({ ...input, isAutoRepeat: true })).toBeNull();
    expect(canvasCommandForAccelerator({ ...input, alt: true })).toBeNull();
    expect(canvasCommandForAccelerator({ ...input, key: "k" })).toBeNull();
  });

  it("keeps canvas focus for graph commands that do not open an editor or dialog", () => {
    expect(commandPreservesCanvasFocus("delete")).toBe(true);
    expect(commandPreservesCanvasFocus("undo")).toBe(true);
    expect(commandPreservesCanvasFocus("edit")).toBe(false);
    expect(commandPreservesCanvasFocus("rename")).toBe(false);
    expect(commandPreservesCanvasFocus("palette")).toBe(false);
  });

  it("keeps workspace shortcuts out of text editors and native controls", () => {
    expect(shouldRouteWorkspaceShortcut({ defaultPrevented: false, textEditing: true })).toBe(false);
    expect(shouldRouteWorkspaceShortcut({ defaultPrevented: false, textEditing: false, nativeEnter: true })).toBe(false);
    expect(shouldRouteWorkspaceShortcut({ defaultPrevented: true, textEditing: false })).toBe(false);
    expect(shouldRouteWorkspaceShortcut({ defaultPrevented: false, textEditing: false })).toBe(true);
  });

  it("dismisses Quick Add before a blank-canvas click can start marquee selection", () => {
    expect(canvasPointerActionFor({ canvasPaneTarget: true, quickAddOpen: true })).toBe("dismiss-quick-add");
    expect(canvasPointerActionFor({ canvasPaneTarget: true, quickAddOpen: false })).toBe("begin-marquee");
    expect(canvasPointerActionFor({ canvasPaneTarget: false, quickAddOpen: true })).toBe("ignore");
  });

  it("toggles additive selection without duplicate IDs", () => {
    expect(toggleId(["a", "b"], "c")).toEqual(["a", "b", "c"]);
    expect(toggleId(["a", "b"], "a")).toEqual(["b"]);
  });

  it("replaces a prior selection when plain marquee begins", () => {
    expect(marqueeSelectionStart(["worker"], false)).toEqual({ base: ["worker"], selection: [] });
    expect(marqueeSelectionStart(["worker"], true)).toEqual({ base: ["worker"], selection: ["worker"] });
    expect(marqueeSelectionUpdate(["prompt"], ["worker"], false)).toEqual(["worker"]);
    expect(marqueeSelectionUpdate(["prompt"], ["worker"], true)).toEqual(["prompt", "worker"]);
  });

  it("derives partial marquee hits from rendered node rectangles", () => {
    const nodes = [
      { id: "prompt", rect: { x: 100, y: 100, width: 200, height: 120 } },
      { id: "worker", rect: { x: 400, y: 100, width: 200, height: 120 } }
    ];
    expect(marqueeHitIds(nodes, { x: 80, y: 80 }, { x: 160, y: 160 })).toEqual(["prompt"]);
    expect(marqueeHitIds(nodes, { x: 380, y: 80 }, { x: 620, y: 240 })).toEqual(["worker"]);
    expect(marqueeHitIds(nodes, { x: 80, y: 80 }, { x: 80.5, y: 80.5 })).toEqual([]);
  });

  it("keeps the marquee rectangle in surface coordinates when dragged in either direction", () => {
    expect(marqueeRectangle({ x: 120, y: 90 }, { x: 40, y: 30 }, { left: 20, top: 10 }))
      .toEqual({ left: 20, top: 20, width: 80, height: 60 });
  });

  it("uses canonical library defaults for searchable node insertion", () => {
    const prompt = nodeLibraryItems.find((item) => item.definitionId === "prompt.text");
    expect(prompt?.presentation).toMatchObject({ width: 220, height: 180 });
    expect(new Set(nodeLibraryItems.map((item) => item.presentation.height))).toEqual(new Set([180]));
    expect(filterNodeCatalog(nodeLibraryItems, "copy").map((item) => item.definitionId)).toEqual(["prompt.text"]);
    expect(filterNodeCatalog(nodeLibraryItems, "nano banana").map((item) => item.definitionId)).toEqual(["generation.image"]);

    const created = prompt === undefined ? null : createNodeFromDefinition(prompt, 1, { x: 12, y: 34 });
    const node = created === null ? null : { ...created, id: "prompt-node" };
    expect(node).not.toBeNull();
    expect(node).toMatchObject({ id: "prompt-node", definitionId: "prompt.text", title: "Prompt 1", size: { width: 220, height: 180 }, config: { kind: "prompt.text", body: "" } });
  });

  it("centers blank insertions and finds the first non-overlapping registry slot", () => {
    const centered = centeredCanvasPosition({ x: 600, y: 400 }, { width: 220, height: 140 });
    expect(centered).toEqual({ x: 490, y: 330 });
    expect(openCanvasPosition(centered, [])).toEqual(centered);
    expect(openCanvasPosition(centered, [{ position: centered, size: { width: 220, height: 140 } }]))
      .toEqual({ x: 230, y: 150 });
  });

  it("keeps Quick Add inside every surface edge while staying near the pointer", () => {
    const surface = { width: 1024, height: 768 };
    const palette = { width: 430, height: 520 };
    expect(quickAddPosition({ x: 0, y: 0 }, palette, surface)).toEqual({ left: 12, top: 12 });
    expect(quickAddPosition({ x: 1024, y: 768 }, palette, surface)).toEqual({ left: 582, top: 236 });
    expect(quickAddPosition({ x: 512, y: 384 }, palette, surface)).toEqual({ left: 502, top: 236 });
  });

  it("shows the blank workflow overlay only for a truly empty canvas", () => {
    expect(isBlankCanvas({ nodes: [], modules: [] })).toBe(true);
    expect(isBlankCanvas({ nodes: [], modules: [{} as EtherGraph["modules"][number]] })).toBe(false);
  });

  it("duplicates a selected subgraph with offset nodes and remapped internal lanes", () => {
    const graph = selectionGraph();
    const clone = cloneGraphSelection(graph, ["source", "target"], { x: 80, y: 40 }, " copy");
    const cloneIds = new Set<string>(clone.nodes.map((node) => node.id));

    expect(clone.nodes).toHaveLength(2);
    expect(clone.nodes.map((node) => node.title)).toEqual(["Prompt 1 copy", "Prompt 1 copy"]);
    expect(clone.nodes.map((node) => node.position)).toEqual([{ x: 90, y: 60 }, { x: 390, y: 60 }]);
    expect(clone.edges).toHaveLength(1);
    const clonedEdge = clone.edges[0];
    expect(clonedEdge?.from.kind).toBe("node");
    expect(clonedEdge?.to.kind).toBe("node");
    if (clonedEdge?.from.kind === "node") expect(cloneIds.has(clonedEdge.from.nodeId)).toBe(true);
    if (clonedEdge?.to.kind === "node") expect(cloneIds.has(clonedEdge.to.nodeId)).toBe(true);
    expect(clone.edges[0]?.id).not.toBe("internal");
  });

  it("summarizes node deletion impact while keeping edge-only and isolated deletes immediate", () => {
    const graph = selectionGraph();
    expect(graphDeleteImpact(graph, ["source", "target"], null)).toEqual({ nodeCount: 2, laneCount: 2 });
    expect(graphDeleteImpact(graph, [], "internal")).toEqual({ nodeCount: 0, laneCount: 1 });
    expect(graphDeleteImpact(graph, ["isolated"], null)).toEqual({ nodeCount: 1, laneCount: 0 });
    expect(graphDeleteConfirmationMessage({ nodeCount: 2, laneCount: 2 })).toContain("2 nodes and 2 lanes");
  });
});

describe("node footer readiness", () => {
  it("reports setup state from config completeness without probing providers", () => {
    const blankPrompt = promptNode("blank-prompt", { x: 0, y: 0 });
    const configuredPrompt = { ...blankPrompt, config: { ...blankPrompt.config, body: "Describe the result." } };
    const imageDefinition = nodeLibraryItems.find((item) => item.definitionId === "generation.image");
    const imageNode = imageDefinition === undefined ? null : createNodeFromDefinition(imageDefinition, 1, { x: 0, y: 0 });
    const exportDefinition = nodeLibraryItems.find((item) => item.definitionId === "output.export");
    const exportNode = exportDefinition === undefined ? null : createNodeFromDefinition(exportDefinition, 1, { x: 0, y: 0 });

    expect(nodeReadinessLabel(blankPrompt)).toBe("Needs setup");
    expect(nodeReadinessLabel(configuredPrompt)).toBe("Ready");
    expect(imageNode === null ? null : nodeReadinessLabel(imageNode)).toBe("Ready");
    expect(exportNode === null ? null : nodeReadinessLabel(exportNode)).toBe("Needs setup");
    expect(nodeReadinessLabel({ ...blankPrompt, config: { ...blankPrompt.config, body: 42 } as never })).toBe("Needs setup");
  });
});

describe("direct node editing", () => {
  it("edits Prompt, Worker, Note, and Evaluate content without changing config identity", () => {
    const nodes: EtherNode[] = [
      { ...base, definitionId: "prompt.text", config: { kind: "prompt.text", body: "before", assembly: "append" } },
      { ...base, definitionId: "prompt.worker", config: { kind: "prompt.worker", behavior: "custom", instruction: "before", profile: "balanced", model: "gpt-5", reasoningEffort: "medium", variation: 0.2, contextPolicy: { includeUpstream: true, includeDownstreamCapabilities: true, maxTokens: 12_000 }, memoryPolicy: { mode: "stateless" }, outputContract: { channel: "text", count: 1, selectionPolicy: "latest" } } },
      { ...base, definitionId: "canvas.note", config: { kind: "canvas.note", body: "before", style: "note" } },
      { ...base, definitionId: "review.evaluate", config: { kind: "review.evaluate", instruction: "before", rubric: [], profile: "balanced", model: "gpt-5", reasoningEffort: "medium" } }
    ];
    for (const node of nodes) {
      expect(primaryEditorFor(node)?.value).toBe("before");
      expect(configFromPrimaryDraft(node, "after")).toMatchObject({ kind: node.definitionId });
      expect(primaryEditorFor({ ...node, config: configFromPrimaryDraft(node, "after") } as EtherNode)?.value).toBe("after");
    }
  });

  it("round-trips Variables and parses Filter rule lines", () => {
    const variables = { ...base, definitionId: "flow.variables" as const, config: { kind: "flow.variables" as const, variables: [] } };
    expect(configFromPrimaryDraft(variables, "subject = \"lamp\"\ncount = 3")).toMatchObject({ variables: [{ name: "subject", value: "lamp" }, { name: "count", value: 3 }] });
    const filter = { ...base, definitionId: "review.filter" as const, config: { kind: "review.filter" as const, match: "all" as const, rules: [], routes: [{ id: "matched", label: "Matched", outcome: "matched" as const }] } };
    expect(configFromPrimaryDraft(filter, "score gte 0.8\ncaption exists")).toMatchObject({ rules: [{ field: "score", operator: "gte", value: 0.8 }, { field: "caption", operator: "exists" }] });
  });
});
