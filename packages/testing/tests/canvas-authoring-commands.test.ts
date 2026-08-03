import { describe, expect, it } from "vitest";
import type { EtherNode } from "@ether/schema";

import { commandIdForKeyboard } from "../../../apps/desktop/src/renderer/canvas/commands/useGraphCommands";
import { configFromPrimaryDraft, primaryEditorFor } from "../../../apps/desktop/src/renderer/canvas/commands/directEditing";
import { toggleId } from "../../../apps/desktop/src/renderer/canvas/hooks/useCanvasInteraction";
import { centeredCanvasPosition, openCanvasPosition } from "../../../apps/desktop/src/renderer/canvas/placement";

const presentation = { collapsed: false, accent: "default", previewMode: "content" as const };
const base = { id: "node-1", title: "Node", position: { x: 10, y: 20 }, size: { width: 240, height: 150 }, presentation };

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

  it("toggles additive selection without duplicate IDs", () => {
    expect(toggleId(["a", "b"], "c")).toEqual(["a", "b", "c"]);
    expect(toggleId(["a", "b"], "a")).toEqual(["b"]);
  });

  it("centers blank insertions and finds the first non-overlapping registry slot", () => {
    const centered = centeredCanvasPosition({ x: 600, y: 400 }, { width: 220, height: 140 });
    expect(centered).toEqual({ x: 490, y: 330 });
    expect(openCanvasPosition(centered, [])).toEqual(centered);
    expect(openCanvasPosition(centered, [{ position: centered, size: { width: 220, height: 140 } }]))
      .toEqual({ x: 230, y: 150 });
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
