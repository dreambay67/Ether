import type { EtherGraph, EtherModule, GraphOperation } from "@ether/schema";
import { describe, expect, it } from "vitest";

import { replayGraphOperations } from "../../document/src/repositories/operationReplay.js";

const timestamp = "2026-07-17T08:00:00.000Z";

function node(id: string) {
  return {
    id,
    definitionId: "prompt.text" as const,
    title: id,
    position: { x: 10, y: 20 },
    size: { width: 220, height: 140 },
    config: { kind: "prompt.text" as const, body: id, assembly: "append" as const },
    presentation: { collapsed: false, accent: "default", previewMode: "summary" as const }
  };
}

function module(id: string, graphId: string): EtherModule {
  return {
    id,
    title: id,
    graphId,
    position: { x: 20, y: 30 },
    size: { width: 240, height: 160 },
    interface: { inputs: [], outputs: [], parameters: [] },
    collapsed: false
  };
}

function graph(id = "graph-root", kind: "root" | "module" = "root"): EtherGraph {
  return {
    id,
    title: id,
    kind,
    createdAt: timestamp,
    updatedAt: timestamp,
    nodes: [node("node-update"), node("node-remove")],
    edges: [
      {
        id: "edge-update",
        from: { kind: "node", nodeId: "node-update", channel: "text" },
        to: { kind: "node", nodeId: "node-remove", channel: "text" },
        role: "subject",
        order: 0,
        selector: { kind: "latest-approved" },
        adapter: { kind: "auto" },
        enabled: true
      },
      {
        id: "edge-remove",
        from: { kind: "node", nodeId: "node-remove", channel: "text" },
        to: { kind: "node", nodeId: "node-update", channel: "text" },
        role: "general",
        order: 1,
        selector: { kind: "latest" },
        adapter: { kind: "auto" },
        enabled: true
      }
    ],
    groups: [
      {
        id: "group-update",
        title: "Update",
        nodeIds: ["node-update"],
        position: { x: 0, y: 0 },
        size: { width: 300, height: 200 },
        color: "teal"
      },
      {
        id: "group-remove",
        title: "Remove",
        nodeIds: ["node-remove"],
        position: { x: 300, y: 0 },
        size: { width: 300, height: 200 },
        color: "blue"
      }
    ],
    modules: [module("module-update", "graph-module-update"), module("module-remove", "graph-module-remove")],
    viewState: {
      viewport: { x: 0, y: 0, zoom: 1 },
      selectedNodeIds: [],
      selectedEdgeIds: [],
      inspectorTarget: null
    }
  };
}

function replay(operation: GraphOperation): EtherGraph[] {
  return replayGraphOperations(
    [graph(), graph("graph-module-update", "module"), graph("graph-module-remove", "module")],
    [operation]
  );
}

function root(result: EtherGraph[]): EtherGraph {
  const value = result.find(({ id }) => id === "graph-root");
  expect(value).toBeDefined();
  return value!;
}

describe("document graph operation replay", () => {
  const createdModuleGraph = graph("graph-module-created", "module");
  const createdModule = module("module-created", createdModuleGraph.id);
  const updatedInterface = {
    inputs: [
      {
        id: "input-1",
        name: "Prompt",
        channel: "text" as const,
        internalNodeId: "node-update",
        internalChannel: "text" as const,
        required: true
      }
    ],
    outputs: [],
    parameters: []
  };
  const cases: Array<{
    name: string;
    operation: GraphOperation;
    verify(result: EtherGraph[]): void;
  }> = [
    {
      name: "addNode",
      operation: { type: "addNode", graphId: "graph-root", node: node("node-added") },
      verify: (result) => expect(root(result).nodes.map(({ id }) => id)).toContain("node-added")
    },
    {
      name: "updateNode",
      operation: {
        type: "updateNode",
        graphId: "graph-root",
        nodeId: "node-update",
        node: { ...node("node-update"), title: "Updated node" }
      },
      verify: (result) => expect(root(result).nodes[0]?.title).toBe("Updated node")
    },
    {
      name: "removeNode",
      operation: { type: "removeNode", graphId: "graph-root", nodeId: "node-remove" },
      verify: (result) => expect(root(result).nodes.some(({ id }) => id === "node-remove")).toBe(false)
    },
    {
      name: "addEdge",
      operation: {
        type: "addEdge",
        graphId: "graph-root",
        edge: {
          id: "edge-added",
          from: { kind: "node", nodeId: "node-update", channel: "text" },
          to: { kind: "node", nodeId: "node-remove", channel: "text" },
          role: "subject",
          order: 2,
          selector: { kind: "all" },
          adapter: { kind: "auto" },
          enabled: true
        }
      },
      verify: (result) => expect(root(result).edges.map(({ id }) => id)).toContain("edge-added")
    },
    {
      name: "updateEdge",
      operation: {
        type: "updateEdge",
        graphId: "graph-root",
        edgeId: "edge-update",
        edge: { ...graph().edges[0]!, enabled: false }
      },
      verify: (result) => expect(root(result).edges[0]?.enabled).toBe(false)
    },
    {
      name: "removeEdge",
      operation: { type: "removeEdge", graphId: "graph-root", edgeId: "edge-remove" },
      verify: (result) => expect(root(result).edges.some(({ id }) => id === "edge-remove")).toBe(false)
    },
    {
      name: "moveNodes",
      operation: {
        type: "moveNodes",
        graphId: "graph-root",
        positions: [{ nodeId: "node-update", position: { x: 111, y: 222 } }]
      },
      verify: (result) => expect(root(result).nodes[0]?.position).toEqual({ x: 111, y: 222 })
    },
    {
      name: "resizeNodes",
      operation: {
        type: "resizeNodes",
        graphId: "graph-root",
        sizes: [{ nodeId: "node-update", size: { width: 333, height: 222 } }]
      },
      verify: (result) => expect(root(result).nodes[0]?.size).toEqual({ width: 333, height: 222 })
    },
    {
      name: "createGroup",
      operation: {
        type: "createGroup",
        graphId: "graph-root",
        group: {
          id: "group-created",
          title: "Created",
          nodeIds: ["node-update"],
          position: { x: 1, y: 2 },
          size: { width: 200, height: 160 },
          color: "green"
        }
      },
      verify: (result) => expect(root(result).groups.map(({ id }) => id)).toContain("group-created")
    },
    {
      name: "updateGroup",
      operation: {
        type: "updateGroup",
        graphId: "graph-root",
        groupId: "group-update",
        group: { ...graph().groups[0]!, title: "Updated group" }
      },
      verify: (result) => expect(root(result).groups[0]?.title).toBe("Updated group")
    },
    {
      name: "removeGroup",
      operation: { type: "removeGroup", graphId: "graph-root", groupId: "group-remove" },
      verify: (result) => expect(root(result).groups.some(({ id }) => id === "group-remove")).toBe(false)
    },
    {
      name: "createModule across parent and internal graph",
      operation: {
        type: "createModule",
        graphId: "graph-root",
        module: createdModule,
        subtree: { rootGraphId: createdModuleGraph.id, graphs: [createdModuleGraph] }
      },
      verify: (result) => {
        expect(root(result).modules.map(({ id }) => id)).toContain(createdModule.id);
        expect(result.find(({ id }) => id === createdModuleGraph.id)).toEqual(createdModuleGraph);
      }
    },
    {
      name: "updateModule",
      operation: {
        type: "updateModule",
        graphId: "graph-root",
        moduleId: "module-update",
        module: { ...module("module-update", "graph-module-update"), collapsed: true }
      },
      verify: (result) => expect(root(result).modules[0]?.collapsed).toBe(true)
    },
    {
      name: "removeModule",
      operation: { type: "removeModule", graphId: "graph-root", moduleId: "module-remove" },
      verify: (result) => expect(root(result).modules.some(({ id }) => id === "module-remove")).toBe(false)
    },
    {
      name: "updateModuleInterface",
      operation: {
        type: "updateModuleInterface",
        graphId: "graph-root",
        moduleId: "module-update",
        interface: updatedInterface
      },
      verify: (result) => expect(root(result).modules[0]?.interface).toEqual(updatedInterface)
    },
    {
      name: "updateGraphProperties",
      operation: {
        type: "updateGraphProperties",
        graphId: "graph-root",
        title: "Updated graph",
        viewState: {
          viewport: { x: 10, y: 20, zoom: 2 },
          selectedNodeIds: ["node-update"],
          selectedEdgeIds: [],
          inspectorTarget: { kind: "node", id: "node-update" }
        }
      },
      verify: (result) => {
        expect(root(result).title).toBe("Updated graph");
        expect(root(result).viewState.viewport.zoom).toBe(2);
      }
    }
  ];

  it.each(cases)("replays $name", ({ operation, verify }) => {
    verify(replay(operation));
  });

  it("applies updateModule subtree graph changes atomically, including nested internals", () => {
    const deep = { ...graph("graph-deep", "module"), modules: [], edges: [], groups: [], nodes: [node("deep-node")] };
    const innerModule = module("nested-module", deep.id);
    const inner = { ...graph("graph-inner", "module"), modules: [innerModule], edges: [], groups: [], nodes: [node("inner-node")] };
    const parentModule = module("parent-module", inner.id);
    const parent = { ...graph("graph-parent"), modules: [parentModule], edges: [], groups: [] };
    const updatedInner = { ...inner, title: "Updated inner", nodes: [{ ...inner.nodes[0]!, config: { kind: "prompt.text" as const, body: "Updated inner body", assembly: "append" as const } }] };
    const updatedDeep = { ...deep, title: "Updated deep", nodes: [{ ...deep.nodes[0]!, config: { kind: "prompt.text" as const, body: "Updated deep body", assembly: "append" as const } }] };

    const result = replayGraphOperations([parent, inner, deep], [{
      type: "updateModule",
      graphId: parent.id,
      moduleId: parentModule.id,
      module: { ...parentModule, collapsed: true },
      subtree: { rootGraphId: inner.id, graphs: [updatedInner, updatedDeep] }
    }]);

    expect(result.find((item) => item.id === inner.id)).toEqual(updatedInner);
    expect(result.find((item) => item.id === deep.id)).toEqual(updatedDeep);
    expect(result.find((item) => item.id === parent.id)?.modules[0]?.collapsed).toBe(true);
  });

  it("compares existing module subtrees by canonical structure rather than object key order", () => {
    const internal = { ...graph("graph-canonical", "module"), modules: [], edges: [], groups: [] };
    const reordered: EtherGraph = {
      updatedAt: internal.updatedAt,
      createdAt: internal.createdAt,
      kind: internal.kind,
      title: internal.title,
      id: internal.id,
      viewState: internal.viewState,
      modules: internal.modules,
      groups: internal.groups,
      edges: internal.edges,
      nodes: internal.nodes
    };
    const parent = { ...graph("graph-canonical-parent"), modules: [], edges: [], groups: [] };
    const created = module("canonical-module", internal.id);

    expect(() => replayGraphOperations([parent, internal], [{
      type: "createModule", graphId: parent.id, module: created,
      subtree: { rootGraphId: internal.id, graphs: [reordered] }
    }])).not.toThrow();
    expect(() => replayGraphOperations([parent, internal], [{
      type: "createModule", graphId: parent.id, module: created,
      subtree: { rootGraphId: internal.id, graphs: [{ ...reordered, title: "Different" }] }
    }])).toThrow(/different state/i);
  });
});
