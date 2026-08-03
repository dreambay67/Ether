import { describe, expect, it } from "vitest";
import type { EtherEdge, EtherGraph, EtherModule } from "@ether/schema";

import {
  addNodesToModuleOperations,
  createModuleOperations,
  moduleIsLocked,
  removeNodesFromModuleOperations
} from "../../../apps/desktop/src/renderer/canvas/modules/moduleModel";

function node(id: string, x = 100): EtherGraph["nodes"][number] {
  return {
    id,
    definitionId: "prompt.text",
    title: id,
    position: { x, y: 120 },
    size: { width: 240, height: 150 },
    config: { kind: "prompt.text", body: id, assembly: "append" },
    presentation: { collapsed: false, accent: "default", previewMode: "content" }
  };
}

function edge(id: string, from: string, to: string): EtherEdge {
  return {
    id,
    from: { kind: "node", nodeId: from, channel: "text" },
    to: { kind: "node", nodeId: to, channel: "text" },
    role: "general",
    order: 0,
    selector: { kind: "latest-approved" },
    adapter: { kind: "auto" },
    enabled: true
  };
}

function graph(id: string, kind: "root" | "module", nodes: EtherGraph["nodes"] = []): EtherGraph {
  return {
    id,
    title: id,
    kind,
    createdAt: "2026-08-03T00:00:00.000Z",
    updatedAt: "2026-08-03T00:00:00.000Z",
    nodes,
    edges: [],
    groups: [],
    modules: [],
    viewState: { viewport: { x: 0, y: 0, zoom: 1 }, selectedNodeIds: [], selectedEdgeIds: [], inspectorTarget: null }
  };
}

function module(id: string, graphId: string, locked = false): EtherModule {
  return {
    id,
    title: id,
    description: "",
    accent: "#37e6ea",
    locked,
    graphId,
    position: { x: 300, y: 80 },
    size: { width: 300, height: 220 },
    interface: { inputs: [], outputs: [], parameters: [] },
    collapsed: false
  };
}

describe("module authoring model", () => {
  it("creates a locked module, preserves a boundary lane, and converts one legacy group atomically", () => {
    const root = graph("root", "root", [node("selected"), node("outside", 500)]);
    root.edges = [edge("lane", "selected", "outside")];
    root.groups = [{ id: "legacy", title: "Ideas", nodeIds: ["selected"], position: { x: 80, y: 90 }, size: { width: 280, height: 210 }, color: "#a889ff" }];
    const ids = ["module", "child"];
    const result = createModuleOperations(root, ["selected"], { title: "Ideas", accent: "#a889ff", removeGroupId: "legacy", idFactory: () => ids.shift()!, now: () => "2026-08-03T01:00:00.000Z" });
    expect(result).not.toBeNull();
    expect(result!.module).toMatchObject({ id: "module", title: "Ideas", locked: true, accent: "#a889ff", graphId: "child" });
    expect(moduleIsLocked(result!.module)).toBe(true);
    expect(result!.child.nodes.map((candidate) => candidate.id)).toEqual(["selected"]);
    expect(result!.operations).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "createModule", graphId: "root" }),
      expect.objectContaining({ type: "updateEdge", edgeId: "lane", edge: expect.objectContaining({ from: expect.objectContaining({ kind: "module", moduleId: "module" }) }) }),
      { type: "removeNode", graphId: "root", nodeId: "selected" },
      { type: "removeGroup", graphId: "root", groupId: "legacy" }
    ]));
  });

  it("adds selected parent nodes while preserving the complete nested subtree", () => {
    const root = graph("root", "root", [node("incoming"), node("outside", 700)]);
    const child = graph("child", "module", [node("inside")]);
    const deep = graph("deep", "module", [node("deep-node")]);
    const deepModule = module("deep-module", "deep", true);
    child.modules = [deepModule];
    const target = module("module", "child", false);
    root.modules = [target];
    root.edges = [edge("outgoing", "incoming", "outside")];
    const result = addNodesToModuleOperations(root, target, [child, deep], ["incoming"]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.subtree.map((item) => item.id)).toEqual(["child", "deep"]);
    expect(result.subtree[0]!.nodes.map((candidate) => candidate.id)).toEqual(["inside", "incoming"]);
    expect(result.module.interface.outputs).toHaveLength(1);
    expect(result.operations[0]).toMatchObject({ type: "updateModule", subtree: { graphs: [expect.objectContaining({ id: "child" }), expect.objectContaining({ id: "deep" })] } });
    expect(result.operations).toContainEqual({ type: "removeNode", graphId: "root", nodeId: "incoming" });
  });

  it("moves members back to the parent and rewrites internal and exposed boundaries", () => {
    const root = graph("root", "root", [node("sink", 900)]);
    const child = graph("child", "module", [node("member"), node("remaining", 500)]);
    child.edges = [edge("crossing", "member", "remaining")];
    const target = module("module", "child", false);
    target.interface.outputs = [{ id: "existing-out", name: "Output", channel: "text", internalNodeId: "member", internalChannel: "text", required: false }];
    root.modules = [target];
    root.edges = [{ ...edge("external", "member", "sink"), from: { kind: "module", moduleId: target.id, portId: "existing-out", channel: "text" } }];
    const result = removeNodesFromModuleOperations(root, target, [child], ["member"]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.subtree[0]!.nodes.map((candidate) => candidate.id)).toEqual(["remaining"]);
    expect(result.module.interface.outputs).toHaveLength(0);
    expect(result.module.interface.inputs).toHaveLength(1);
    expect(result.operations).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "addNode", graphId: "root", node: expect.objectContaining({ id: "member" }) }),
      expect.objectContaining({ type: "addEdge", graphId: "root", edge: expect.objectContaining({ id: "crossing", to: expect.objectContaining({ kind: "module", moduleId: "module" }) }) }),
      expect.objectContaining({ type: "updateEdge", edgeId: "external", edge: expect.objectContaining({ from: expect.objectContaining({ kind: "node", nodeId: "member" }) }) })
    ]));
  });
});
