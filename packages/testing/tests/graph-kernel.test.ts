import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  ConnectionDecisionSchema,
  EtherEdgeSchema,
  type EtherEdge,
  type EtherGraph,
  type GraphOperation,
  type NodeOutputVersion,
  type PayloadEnvelope
} from "@ether/schema";

import {
  FULL_ADAPTER_CAPABILITIES,
  GraphKernelError,
  assembleExecutorContext,
  canonicalConnectionIdentity,
  createNodeRegistry,
  expandModuleBoundaries,
  getNodeDefinition,
  nodeDefinitions,
  planTraversal,
  previewGraphTransaction,
  resolveOutputSelector,
  validateConnection,
  validateGraphSet
} from "../../graph-kernel/src/index.js";

const timestamp = "2026-07-17T08:00:00.000Z";
const workspaceRoot = fileURLToPath(new URL("../../..", import.meta.url));
const presentation = { collapsed: false, accent: "default", previewMode: "summary" as const };
const viewState = {
  viewport: { x: 0, y: 0, zoom: 1 },
  selectedNodeIds: [],
  selectedEdgeIds: [],
  inspectorTarget: null
};

function promptNode(id: string, body = id) {
  return {
    id,
    definitionId: "prompt.text" as const,
    title: id,
    position: { x: 0, y: 0 },
    size: { width: 220, height: 140 },
    config: { kind: "prompt.text" as const, body, assembly: "append" as const },
    presentation
  };
}

function workerNode(id: string, instruction = `Instruction for ${id}`) {
  return {
    id,
    definitionId: "prompt.worker" as const,
    title: id,
    position: { x: 240, y: 0 },
    size: { width: 220, height: 140 },
    config: {
      kind: "prompt.worker" as const,
      behavior: "rewrite" as const,
      instruction,
      profile: "balanced" as const,
      model: "gpt-5",
      reasoningEffort: "medium",
      variation: 0.2,
      contextPolicy: { includeUpstream: true, includeDownstreamCapabilities: true, maxTokens: 4_000 },
      memoryPolicy: { mode: "stateless" as const },
      outputContract: { channel: "text" as const, count: 1, selectionPolicy: "latest" as const }
    },
    presentation
  };
}

function graph(id: string, kind: "root" | "module", nodes: EtherGraph["nodes"] = []): EtherGraph {
  return {
    id,
    title: id,
    kind,
    createdAt: timestamp,
    updatedAt: timestamp,
    nodes,
    edges: [],
    groups: [],
    modules: [],
    viewState
  };
}

function nodeEndpoint(nodeId: string, channel = "text" as const) {
  return { kind: "node" as const, nodeId, channel };
}

function edge(id: string, fromId: string, toId: string, role: EtherEdge["role"] = "general", order = 0): EtherEdge {
  return {
    id,
    from: nodeEndpoint(fromId),
    to: nodeEndpoint(toId),
    role,
    order,
    selector: { kind: "latest-approved" },
    adapter: { kind: "auto" },
    enabled: true
  };
}

function version(id: string, nodeId: string, createdAt: string, approval: NodeOutputVersion["approval"]): NodeOutputVersion {
  return {
    id,
    nodeId,
    graphId: "root",
    graphRevisionId: "revision-1",
    inputPayloadIds: [],
    selectedOutputVersionIds: [],
    compiledContextHash: `hash:${id}`,
    producer: { kind: "local", executor: "deterministic-assembly" },
    outputPayloadIds: [`payload-${id}`],
    parentOutputVersionId: null,
    approval,
    runId: null,
    stepId: null,
    workItemId: null,
    attemptId: null,
    timing: { startedAt: createdAt, completedAt: createdAt },
    failure: null,
    createdAt
  };
}

function payload(id: string, nodeId: string, versionId: string, value: string, lineageKey: string): PayloadEnvelope {
  return {
    id,
    channel: "text",
    role: "general",
    content: { kind: "text", value },
    source: { nodeId, outputVersionId: versionId, lineageKey },
    metadata: {}
  };
}

describe("Ether 4.0 graph kernel registry", () => {
  it("publishes a runtime-importable pure domain package", () => {
    const packageJson = JSON.parse(readFileSync(`${workspaceRoot}/packages/graph-kernel/package.json`, "utf8")) as { dependencies: Record<string, string> };
    expect(packageJson.dependencies).toEqual({ "@ether/schema": "workspace:*" });
    expect(execFileSync(process.execPath, ["--input-type=module", "--eval", "import('@ether/graph-kernel').then(m => console.log(m.nodeDefinitions.length))"], { cwd: `${workspaceRoot}/packages/testing`, encoding: "utf8" }).trim()).toBe("17");
  });

  it("is the complete semantic source for exactly seventeen canonical definitions", () => {
    expect(nodeDefinitions.map((definition) => definition.id)).toEqual([
      "prompt.text", "prompt.worker", "reference.set", "generation.image", "edit.image",
      "edit.mask", "edit.transform", "review.compare", "review.evaluate", "review.filter",
      "flow.variables", "flow.batch", "flow.join", "output.collection", "output.export",
      "canvas.note", "canvas.drawing"
    ]);

    for (const definition of nodeDefinitions) {
      expect(definition.configSchema.parse(definition.defaultConfig())).toEqual(definition.defaultConfig());
      expect(definition.defaultConfig().kind).toBe(definition.id);
      expect(definition.contract.outputs.map((port) => port.channel)).toEqual(definition.library.outputChannels);
      expect(definition.recipe.definitionId).toBe(definition.id);
      expect(definition.mcp.definitionId).toBe(definition.id);
      if (definition.executor !== "non-runnable") {
        expect(Object.keys(definition.contract.consequences).length).toBeGreaterThan(0);
      }
    }
    expect(getNodeDefinition("review.filter").contract.consequences.data?.subject?.preservationRule).toBe("preserve-role");
    expect(getNodeDefinition("output.collection").contract.consequences.image?.style?.preservationRule).toBe("preserve-role");
    expect(() => getNodeDefinition("assistant.worker" as never)).toThrow(/Unknown node definition/);
  });

  it("fails registry initialization for incomplete or invalid semantic definitions", () => {
    expect(() => createNodeRegistry(nodeDefinitions.slice(1))).toThrow(/Missing node definition/);
    expect(() => createNodeRegistry([...nodeDefinitions, nodeDefinitions[0]!])).toThrow(/Duplicate node definition/);
    const bad = { ...nodeDefinitions[0]!, inspector: { sections: [{ id: "bad", title: "Bad", fields: ["missing.path"] }] } };
    expect(() => createNodeRegistry(nodeDefinitions.map((item, index) => index === 0 ? bad : item))).toThrow(/inspector path/);
    const mismatchedProjection = { ...nodeDefinitions[0]!, library: { ...nodeDefinitions[0]!.library, outputChannels: ["image" as const] } };
    expect(() => createNodeRegistry(nodeDefinitions.map((item, index) => index === 0 ? mismatchedProjection : item))).toThrow(/library.*contract/i);
    const emptyRunnable = { ...nodeDefinitions[3]!, contract: { inputs: [], outputs: nodeDefinitions[3]!.contract.outputs, consequences: {} }, library: { ...nodeDefinitions[3]!.library, inputChannels: [] } };
    expect(() => createNodeRegistry(nodeDefinitions.map((item, index) => index === 3 ? emptyRunnable : item))).toThrow(/meaningful consequence/i);
  });
});

describe("connections and typed remedies", () => {
  it("accepts valid lanes, rejects exact canonical duplicates, and permits distinct selectors", () => {
    const first = edge("edge-1", "source", "target", "subject");
    const duplicate = { ...first, id: "edge-2", order: 99, enabled: false, adapter: { kind: "explicit" as const, adapterId: "local.data-to-text" } };
    expect(canonicalConnectionIdentity(first)).toBe(canonicalConnectionIdentity(duplicate));

    const rejected = validateConnection({
      sourceDefinitionId: "prompt.text",
      sourceChannel: "text",
      targetDefinitionId: "prompt.worker",
      targetChannel: "text",
      role: "subject",
      candidate: duplicate,
      existingEdges: [first],
      capabilities: FULL_ADAPTER_CAPABILITIES
    });
    expect(rejected).toEqual(expect.objectContaining({
      allowed: false,
      code: "DUPLICATE_LANE",
      remedies: [{ kind: "remove-edge", edgeId: "edge-1" }]
    }));

    const distinct = { ...duplicate, selector: { kind: "latest" as const } };
    expect(validateConnection({
      sourceDefinitionId: "prompt.text", sourceChannel: "text",
      targetDefinitionId: "prompt.worker", targetChannel: "text", role: "subject",
      candidate: distinct, existingEdges: [first], capabilities: FULL_ADAPTER_CAPABILITIES
    }).allowed).toBe(true);
    expect(() => ConnectionDecisionSchema.parse(validateConnection({
      sourceDefinitionId: "reference.set", sourceChannel: "image",
      targetDefinitionId: "prompt.worker", targetChannel: "text", role: "style",
      capabilities: FULL_ADAPTER_CAPABILITIES
    }))).not.toThrow();
  });

  it("returns operational remedies when a declared capability is absent", () => {
    const decision = validateConnection({
      sourceDefinitionId: "reference.set", sourceChannel: "image",
      targetDefinitionId: "prompt.worker", targetChannel: "text", role: "style",
      capabilities: []
    });
    expect(decision).toEqual(expect.objectContaining({
      allowed: false,
      code: "PROVIDER_CAPABILITY_UNAVAILABLE",
      remedies: [{ kind: "enable-capability", capability: "codex.vision" }]
    }));
  });

  it("parses only discriminated node and module graph endpoints", () => {
    const moduleEdge = {
      ...edge("module-edge", "source", "target"),
      to: { kind: "module", moduleId: "module-1", portId: "input", channel: "text" }
    };
    expect(EtherEdgeSchema.parse(moduleEdge)).toEqual(moduleEdge);
    expect(EtherEdgeSchema.safeParse({ ...moduleEdge, from: { nodeId: "legacy", channel: "text" } }).success).toBe(false);
  });
});

describe("immutable selectors and context assembly", () => {
  const approved = version("approved", "source", "2026-07-17T08:00:00.000Z", { state: "approved", actor: "user", at: "2026-07-17T08:00:00.000Z" });
  const latest = version("latest", "source", "2026-07-17T09:00:00.000Z", { state: "unreviewed" });
  const other = version("other", "other-node", "2026-07-17T10:00:00.000Z", { state: "unreviewed" });

  it("resolves approved, latest, all, and owned pinned versions deterministically", () => {
    const versions = [other, latest, approved];
    expect(resolveOutputSelector({ selector: { kind: "latest-approved" }, nodeId: "source", channel: "text", versions, payloads: [] }).versionIds).toEqual(["approved"]);
    expect(resolveOutputSelector({ selector: { kind: "latest" }, nodeId: "source", channel: "text", versions, payloads: [] }).versionIds).toEqual(["latest"]);
    expect(resolveOutputSelector({ selector: { kind: "all" }, nodeId: "source", channel: "text", versions, payloads: [] }).versionIds).toEqual(["approved", "latest"]);
    expect(resolveOutputSelector({ selector: { kind: "pinned", outputVersionId: "latest" }, nodeId: "source", channel: "text", versions, payloads: [] }).diagnostics).toEqual([]);
    expect(resolveOutputSelector({ selector: { kind: "pinned", outputVersionId: "other" }, nodeId: "source", channel: "text", versions, payloads: [] }).diagnostics[0]?.code).toBe("PINNED_VERSION_WRONG_NODE");
    const imagePayload = { ...payload("payload-latest", "source", "latest", "image", "lineage"), channel: "image" as const, content: { kind: "artifact" as const, artifactId: "image-1" } };
    expect(resolveOutputSelector({ selector: { kind: "pinned", outputVersionId: "latest" }, nodeId: "source", channel: "text", versions, payloads: [imagePayload] }).diagnostics[0]?.code).toBe("PINNED_VERSION_WRONG_CHANNEL");
  });

  it("runs selector, payload, adapter, role/order, consequence, and manifest stages in order", () => {
    const target = workerNode("target", "Keep this target instruction separate");
    const source = promptNode("source");
    const subjectEdge = edge("subject", source.id, target.id, "subject", 2);
    const negativeEdge = edge("negative", source.id, target.id, "negative", 1);
    const outputs = [approved];
    const payloads = [
      payload("payload-approved", "source", "approved", "red dress", "lineage-dress")
    ];
    const result = assembleExecutorContext({
      graph: { ...graph("root", "root", [source, target]), edges: [subjectEdge, negativeEdge] },
      targetNodeId: target.id,
      versions: outputs,
      payloads,
      capabilities: FULL_ADAPTER_CAPABILITIES
    });

    expect(result.trace).toEqual(["selector", "channel-payload", "adapter", "role-order", "target-consequence", "executor-manifest"]);
    expect(result.manifest.instruction).toBe("Keep this target instruction separate");
    expect(result.manifest.positiveBody).toContain("Subject: red dress");
    expect(result.manifest.positiveBody).not.toContain("Negative:");
    expect(result.manifest.negativeBody).toContain("red dress");
  });

  it("numbers direct independent lanes and preserves replacement or fan-in lineage", () => {
    const target = workerNode("target");
    const a = promptNode("a");
    const b = promptNode("b");
    const versions = [
      version("a-version", "a", "2026-07-17T08:00:00.000Z", { state: "approved", actor: "user", at: timestamp }),
      version("b-version", "b", "2026-07-17T08:01:00.000Z", { state: "approved", actor: "user", at: timestamp })
    ];
    const result = assembleExecutorContext({
      graph: { ...graph("root", "root", [a, b, target]), edges: [edge("b-edge", "b", "target", "subject", 0), edge("a-edge", "a", "target", "subject", 0)] },
      targetNodeId: "target",
      versions,
      payloads: [payload("pa", "a", "a-version", "first", "linear"), payload("pb", "b", "b-version", "second", "branch")],
      capabilities: FULL_ADAPTER_CAPABILITIES
    });
    expect(result.manifest.inputs.map((input) => input.caption)).toEqual(["Subject", "Subject 2"]);
    expect(result.manifest.lineageKey).toMatch(/^fanin:/);
  });

  it("keeps captions attached to their payload when non-text inputs are omitted from prompt bodies", () => {
    const target = workerNode("target");
    const artifactSource = promptNode("artifact-source");
    const textSource = promptNode("text-source");
    const artifactVersion = version("artifact-version", artifactSource.id, timestamp, { state: "approved", actor: "user", at: timestamp });
    const textVersion = version("text-version", textSource.id, timestamp, { state: "approved", actor: "user", at: timestamp });
    const artifactPayload: PayloadEnvelope = {
      ...payload("artifact", artifactSource.id, artifactVersion.id, "unused", "artifact-lineage"),
      content: { kind: "artifact", artifactId: "artifact-1" }
    };
    const result = assembleExecutorContext({
      graph: {
        ...graph("root", "root", [artifactSource, textSource, target]),
        edges: [edge("artifact-edge", artifactSource.id, target.id, "subject", 0), edge("text-edge", textSource.id, target.id, "subject", 1)]
      },
      targetNodeId: target.id,
      versions: [artifactVersion, textVersion],
      payloads: [artifactPayload, payload("text", textSource.id, textVersion.id, "visible text", "text-lineage")],
      capabilities: FULL_ADAPTER_CAPABILITIES
    });

    expect(result.manifest.positiveBody).toBe("Subject 2: visible text");
  });
});

describe("modules and traversal", () => {
  function moduleFixture() {
    const root = graph("root", "root", [promptNode("source"), workerNode("sink")]);
    const inner = graph("inner", "module", [workerNode("inner-in"), workerNode("inner-out")]);
    inner.edges = [edge("inner-edge", "inner-in", "inner-out")];
    root.modules = [{
      id: "module-1", title: "Module", graphId: "inner", position: { x: 100, y: 100 },
      size: { width: 300, height: 180 }, collapsed: true,
      interface: {
        inputs: [{ id: "in", name: "In", channel: "text", internalNodeId: "inner-in", internalChannel: "text", required: true }],
        outputs: [{ id: "out", name: "Out", channel: "text", internalNodeId: "inner-out", internalChannel: "text", required: true }],
        parameters: [{ id: "instruction", name: "Instruction", nodeId: "inner-in", configPath: ["instruction"], required: false }]
      }
    }];
    root.edges = [
      { ...edge("enter", "source", "inner-in", "subject", 3), to: { kind: "module", moduleId: "module-1", portId: "in", channel: "text" } },
      { ...edge("leave", "inner-out", "sink", "style", 4), from: { kind: "module", moduleId: "module-1", portId: "out", channel: "text" } }
    ];
    return [root, inner] as EtherGraph[];
  }

  it("expands parent module ports without changing lane semantics or adding adapters", () => {
    const expanded = expandModuleBoundaries(moduleFixture());
    expect(expanded.find((item) => item.id === "enter")).toMatchObject({
      from: nodeEndpoint("source"), to: nodeEndpoint("inner-in"), role: "subject", order: 3,
      selector: { kind: "latest-approved" }, adapter: { kind: "auto" }
    });
    expect(expanded.find((item) => item.id === "leave")).toMatchObject({
      from: nodeEndpoint("inner-out"), to: nodeEndpoint("sink"), role: "style", order: 4
    });
  });

  it("validates nested unique acyclic ownership and flattens deterministic execution order", () => {
    const graphs = moduleFixture();
    graphs[0]!.nodes.splice(1, 0, {
      id: "note", definitionId: "canvas.note", title: "Note", position: { x: 0, y: 0 },
      size: { width: 220, height: 140 }, config: { kind: "canvas.note", body: "Reference", style: "note" }, presentation
    });
    expect(validateGraphSet(graphs)).toEqual([]);
    expect(planTraversal(graphs, "root").nodeIds).toEqual(["source", "inner-in", "inner-out", "sink"]);

    const recursive = structuredClone(graphs);
    recursive[1]!.modules = [{ ...recursive[0]!.modules[0]!, id: "recursive", graphId: "root" }];
    expect(validateGraphSet(recursive).map((diagnostic) => diagnostic.code)).toContain("MODULE_OWNERSHIP_CYCLE");

    const shared = structuredClone(graphs);
    shared[0]!.modules.push({ ...shared[0]!.modules[0]!, id: "module-2" });
    expect(validateGraphSet(shared).map((diagnostic) => diagnostic.code)).toContain("SHARED_MODULE_GRAPH");
  });

  it("rejects duplicate lane identity, stale groups, and invalid module interface paths", () => {
    const duplicateGraph = graph("root", "root", [promptNode("a"), workerNode("b")]);
    duplicateGraph.edges = [edge("one", "a", "b"), { ...edge("two", "a", "b"), order: 8, enabled: false }];
    duplicateGraph.groups = [{ id: "stale", title: "Stale", nodeIds: ["missing"], position: { x: 0, y: 0 }, size: { width: 200, height: 100 }, color: "teal" }];
    expect(validateGraphSet([duplicateGraph]).map((diagnostic) => diagnostic.code)).toEqual(expect.arrayContaining(["DUPLICATE_LANE", "GROUP_NODE_MISSING"]));

    const moduleGraphs = moduleFixture();
    moduleGraphs[0]!.modules[0]!.interface.parameters[0]!.configPath = ["missing"];
    expect(validateGraphSet(moduleGraphs).map((diagnostic) => diagnostic.code)).toContain("MODULE_PARAMETER_PATH_INVALID");
  });

  it("detects cycles that cross virtual module boundaries", () => {
    const graphs = moduleFixture();
    graphs[0]!.edges.push(edge("cycle", "sink", "source"));
    expect(() => planTraversal(graphs, "root")).toThrow(/cycle/i);
  });

  it("flattens nested module interfaces into executable internal nodes", () => {
    const [root, inner] = moduleFixture();
    const deep = graph("deep", "module", [workerNode("deep-worker")]);
    inner!.modules = [{
      id: "deep-module", title: "Deep", graphId: "deep", position: { x: 0, y: 0 }, size: { width: 200, height: 100 }, collapsed: true,
      interface: {
        inputs: [{ id: "in", name: "In", channel: "text", internalNodeId: "deep-worker", internalChannel: "text", required: true }],
        outputs: [{ id: "out", name: "Out", channel: "text", internalNodeId: "deep-worker", internalChannel: "text", required: true }],
        parameters: []
      }
    }];
    inner!.edges = [
      { ...edge("deep-enter", "inner-in", "deep-worker"), to: { kind: "module", moduleId: "deep-module", portId: "in", channel: "text" } },
      { ...edge("deep-leave", "deep-worker", "inner-out"), from: { kind: "module", moduleId: "deep-module", portId: "out", channel: "text" } }
    ];
    expect(planTraversal([root!, inner!, deep], "root").nodeIds).toEqual(["source", "inner-in", "deep-worker", "inner-out", "sink"]);
  });
});

describe("atomic graph transactions", () => {
  it("produces a complete inverse for every explicit graph edit", () => {
    const base = graph("root", "root", [promptNode("a"), workerNode("b")]);
    base.edges = [edge("lane", "a", "b")];
    base.groups = [{ id: "group", title: "Group", nodeIds: ["a"], position: { x: 0, y: 0 }, size: { width: 200, height: 100 }, color: "teal" }];
    const cases: Array<{ name: string; graphs: EtherGraph[]; operations: GraphOperation[] }> = [
      { name: "update node", graphs: [base], operations: [{ type: "updateNode", graphId: "root", nodeId: "a", node: { ...promptNode("a"), title: "Updated" } }] },
      { name: "update edge", graphs: [base], operations: [{ type: "updateEdge", graphId: "root", edgeId: "lane", edge: { ...base.edges[0]!, role: "style" } }] },
      { name: "add edge", graphs: [{ ...base, edges: [] }], operations: [{ type: "addEdge", graphId: "root", edge: base.edges[0]! }] },
      { name: "remove edge", graphs: [base], operations: [{ type: "removeEdge", graphId: "root", edgeId: "lane" }] },
      { name: "move nodes", graphs: [base], operations: [{ type: "moveNodes", graphId: "root", positions: [{ nodeId: "a", position: { x: 9, y: 8 } }] }] },
      { name: "resize nodes", graphs: [base], operations: [{ type: "resizeNodes", graphId: "root", sizes: [{ nodeId: "a", size: { width: 300, height: 200 } }] }] },
      { name: "create group", graphs: [{ ...base, groups: [] }], operations: [{ type: "createGroup", graphId: "root", group: base.groups[0] }] },
      { name: "update group", graphs: [base], operations: [{ type: "updateGroup", graphId: "root", groupId: "group", group: { ...base.groups[0]!, title: "Updated" } }] },
      { name: "remove group", graphs: [base], operations: [{ type: "removeGroup", graphId: "root", groupId: "group" }] },
      { name: "graph properties", graphs: [base], operations: [{ type: "updateGraphProperties", graphId: "root", title: "Updated" }] },
      { name: "remove node explicitly", graphs: [base], operations: [{ type: "removeEdge", graphId: "root", edgeId: "lane" }, { type: "updateGroup", graphId: "root", groupId: "group", group: { ...base.groups[0]!, nodeIds: [] } }, { type: "removeNode", graphId: "root", nodeId: "a" }] }
    ];
    for (const item of cases) {
      const preview = previewGraphTransaction({
        graphs: item.graphs,
        transaction: { id: `tx-${item.name}`, baseDocumentRevisionId: "doc", baseGraphRevisions: { root: "r" }, title: item.name, actor: "user", operations: item.operations, layoutPolicy: "preserve" }
      });
      expect(preview.inverseOperations, item.name).toHaveLength(preview.forwardOperations.length);
      expect(preview.inverseReplay, item.name).toEqual(structuredClone(item.graphs).sort((left, right) => left.id.localeCompare(right.id)));
    }
  });

  it("creates and updates module subtrees reversibly", () => {
    const root = graph("root", "root", []);
    const inner = graph("inner", "module", [promptNode("inside")]);
    const module = { id: "module", title: "Module", graphId: "inner", position: { x: 0, y: 0 }, size: { width: 200, height: 100 }, interface: { inputs: [], outputs: [], parameters: [] }, collapsed: false };
    const created = previewGraphTransaction({
      graphs: [root],
      transaction: { id: "create-module", baseDocumentRevisionId: "doc", baseGraphRevisions: { root: "r" }, title: "Create", actor: "user", layoutPolicy: "preserve", operations: [{ type: "createModule", graphId: "root", module, subtree: { rootGraphId: "inner", graphs: [inner] } }] }
    });
    expect(created.inverseReplay).toEqual([root]);

    const updatedInner = { ...inner, title: "Updated inner" };
    expect(() => previewGraphTransaction({
      graphs: created.graphs,
      transaction: { id: "update-module-missing-base", baseDocumentRevisionId: "doc-2", baseGraphRevisions: { root: "r2" }, title: "Update", actor: "user", layoutPolicy: "preserve", operations: [{ type: "updateModule", graphId: "root", moduleId: "module", module: { ...module, collapsed: true }, subtree: { rootGraphId: "inner", graphs: [updatedInner] } }] }
    })).toThrow(/base graph revision.*inner/i);
    const updated = previewGraphTransaction({
      graphs: created.graphs,
      transaction: { id: "update-module", baseDocumentRevisionId: "doc-2", baseGraphRevisions: { root: "r2", inner: "i2" }, title: "Update", actor: "user", layoutPolicy: "preserve", operations: [{ type: "updateModule", graphId: "root", moduleId: "module", module: { ...module, collapsed: true }, subtree: { rootGraphId: "inner", graphs: [updatedInner] } }] }
    });
    expect(updated.graphs.find((item) => item.id === "inner")?.title).toBe("Updated inner");
    expect(updated.inverseReplay).toEqual(created.graphs);

    const interfaceUpdate = previewGraphTransaction({
      graphs: created.graphs,
      transaction: { id: "update-interface", baseDocumentRevisionId: "doc-3", baseGraphRevisions: { root: "r3" }, title: "Interface", actor: "user", layoutPolicy: "preserve", operations: [{ type: "updateModuleInterface", graphId: "root", moduleId: "module", interface: { inputs: [], outputs: [{ id: "out", name: "Out", channel: "text", internalNodeId: "inside", internalChannel: "text", required: false }], parameters: [] } }] }
    });
    expect(interfaceUpdate.inverseReplay).toEqual(created.graphs);
  });

  it("rejects module subtree updates that collide with graphs outside the owned subtree", () => {
    const root = graph("root", "root", []);
    const inner = graph("inner", "module", []);
    const unrelated = graph("unrelated", "root", []);
    const module = { id: "module", title: "Module", graphId: "inner", position: { x: 0, y: 0 }, size: { width: 200, height: 100 }, interface: { inputs: [], outputs: [], parameters: [] }, collapsed: false };
    root.modules = [module];

    expect(() => previewGraphTransaction({
      graphs: [root, inner, unrelated],
      transaction: {
        id: "subtree-collision", baseDocumentRevisionId: "doc", baseGraphRevisions: { root: "r", inner: "i", unrelated: "u" },
        title: "Collision", actor: "user", layoutPolicy: "preserve",
        operations: [{
          type: "updateModule", graphId: root.id, moduleId: module.id, module,
          subtree: { rootGraphId: inner.id, graphs: [inner, { ...unrelated, title: "Overwrite" }] }
        }]
      }
    })).toThrow(/graph collision/i);
  });

  it("requires layout policies to be expanded into explicit operations", () => {
    expect(() => previewGraphTransaction({
      graphs: [graph("root", "root", [])],
      transaction: { id: "layout", baseDocumentRevisionId: "doc", baseGraphRevisions: { root: "r" }, title: "Layout", actor: "system", layoutPolicy: "tidy-affected", operations: [{ type: "updateGraphProperties", graphId: "root", title: "No implicit layout" }] }
    })).toThrow(/explicit move\/resize/i);
  });
  it("resolves forward temporary references once and proves forward/inverse replay", () => {
    const initial = graph("root", "root", []);
    const draftNode = { ...promptNode("$temp:node:prompt"), title: "Temporary" };
    const preview = previewGraphTransaction({
      graphs: [initial],
      transaction: {
        id: "tx-temp", baseDocumentRevisionId: "doc-rev", baseGraphRevisions: { root: "graph-rev" },
        title: "Add with temp", actor: "recipe", layoutPolicy: "preserve",
        operations: [
          { type: "moveNodes", graphId: "root", positions: [{ nodeId: "$temp:node:prompt", position: { x: 40, y: 50 } }] },
          { type: "addNode", graphId: "root", node: draftNode }
        ]
      },
      idFactory: ({ kind, name }) => `${kind}-${name}-resolved`
    });
    expect(preview.tempIds).toEqual({ "$temp:node:prompt": "node-prompt-resolved" });
    expect(preview.graphs[0]!.nodes[0]).toMatchObject({ id: "node-prompt-resolved", position: { x: 40, y: 50 } });
    expect(preview.inverseReplay).toEqual([initial]);
    expect(preview.forwardReplay).toEqual(preview.graphs);
  });

  it("rejects temp kind mismatches, ID collisions, and any invalid graph atomically", () => {
    const initial = graph("root", "root", [promptNode("existing")]);
    const base = {
      id: "tx", baseDocumentRevisionId: "doc-rev", baseGraphRevisions: { root: "graph-rev" },
      title: "Invalid", actor: "codex" as const, layoutPolicy: "preserve" as const
    };
    expect(() => previewGraphTransaction({
      graphs: [initial], transaction: { ...base, operations: [{ type: "moveNodes", graphId: "root", positions: [{ nodeId: "$temp:edge:oops", position: { x: 1, y: 1 } }] }] }
    })).toThrow(/temporary.*kind/i);
    expect(() => previewGraphTransaction({
      graphs: [initial], transaction: { ...base, operations: [{ type: "addNode", graphId: "root", node: promptNode("$temp:node:new") }] },
      idFactory: () => "existing"
    })).toThrow(/collision/i);

    const second = graph("second", "root", []);
    expect(() => previewGraphTransaction({
      graphs: [initial, second],
      transaction: {
        ...base, baseGraphRevisions: { root: "r1", second: "r2" },
        operations: [
          { type: "addNode", graphId: "root", node: promptNode("valid-new") },
          { type: "addEdge", graphId: "second", edge: edge("invalid", "missing", "also-missing") }
        ]
      }
    })).toThrow(GraphKernelError);
    expect(initial.nodes.map((node) => node.id)).toEqual(["existing"]);
  });

  it("requires explicit dependency removal and restores complete nested module subtrees", () => {
    const [root, inner, nested] = (() => {
      const parent = graph("root", "root", [promptNode("source")]);
      const child = graph("inner", "module", [workerNode("worker")]);
      const nested = graph("nested", "module", [promptNode("nested-node")]);
      child.modules = [{ id: "nested-module", title: "Nested", graphId: "nested", position: { x: 0, y: 0 }, size: { width: 200, height: 120 }, interface: { inputs: [], outputs: [], parameters: [] }, collapsed: false }];
      parent.modules = [{ id: "module", title: "Module", graphId: "inner", position: { x: 0, y: 0 }, size: { width: 200, height: 120 }, interface: { inputs: [{ id: "in", name: "In", channel: "text", internalNodeId: "worker", internalChannel: "text", required: true }], outputs: [], parameters: [] }, collapsed: true }];
      parent.edges = [{ ...edge("connected", "source", "worker"), to: { kind: "module", moduleId: "module", portId: "in", channel: "text" } }];
      return [parent, child, nested] as const;
    })();
    const base = { id: "remove", baseDocumentRevisionId: "doc", baseGraphRevisions: { root: "r", inner: "i", nested: "n" }, title: "Remove", actor: "user" as const, layoutPolicy: "preserve" as const };
    expect(() => previewGraphTransaction({ graphs: [root, inner, nested], transaction: { ...base, operations: [{ type: "removeModule", graphId: "root", moduleId: "module" }] } })).toThrow(/connected edge|dependency/i);

    const preview = previewGraphTransaction({
      graphs: [root, inner, nested],
      transaction: {
        ...base,
        operations: [
          { type: "removeEdge", graphId: "root", edgeId: "connected" },
          { type: "removeModule", graphId: "root", moduleId: "module" }
        ]
      }
    });
    expect(preview.graphs.map((item) => item.id)).toEqual(["root"]);
    expect(preview.inverseReplay).toEqual([inner, nested, root].sort((left, right) => left.id.localeCompare(right.id)));
  });
});
