import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  ConnectionDecisionSchema,
  EtherEdgeSchema,
  RecipeManifestSchema,
  type EtherEdge,
  type EtherGraph,
  type GraphOperation,
  type NodeOutputVersion,
  type PayloadEnvelope,
  type RecipeManifest
} from "@ether/schema";

import {
  FULL_ADAPTER_CAPABILITIES,
  GraphKernelError,
  assembleExecutorContext,
  canonicalConnectionIdentity,
  createNodeRegistry,
  deriveLineageKey,
  expandModuleBoundaries,
  getNodeDefinition,
  nodeDefinitions,
  nodeLibraryItems,
  planTraversal,
  previewGraphTransaction,
  resolveOutputSelector,
  structurallyEqual,
  validateConnection,
  validateGraphSet,
  validateFullGraphState,
  validateRecipeManifest
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

function lineageLanes(keys: readonly string[], prefix = "lineage") {
  return keys.map((lineageKey, index) => ({
    edgeId: `${prefix}-edge-${index}`,
    payloads: [payload(`${prefix}-payload-${index}`, `${prefix}-source-${index}`, `${prefix}-version-${index}`, `value-${index}`, lineageKey)]
  }));
}

function semanticRecipeFixture(): RecipeManifest {
  const source = promptNode("recipe-source");
  const target = workerNode("recipe-target");
  return {
    id: "semantic-recipe",
    version: "1.0.0",
    title: "Semantic recipe",
    description: "Kernel validation fixture",
    parameters: [],
    graph: {
      graphRef: "recipe-root", title: "Root", kind: "root", nodes: [source, target],
      edges: [edge("recipe-edge", source.id, target.id)], groups: [], modules: [], viewState
    },
    moduleGraphs: [],
    capabilityRequirements: [{
      id: "llm", operation: "llm", inputChannels: ["text"], outputChannels: ["text"],
      minimumReferences: 0, minimumOutputs: 1, supportsCancellation: false, supportsSeed: false
    }],
    substitutions: [],
    layout: { policy: "preserve", direction: "horizontal", spacing: { x: 80, y: 60 }, focusNodeRef: source.id },
    checkpoints: [],
    expectedWork: { minimumCalls: 1, maximumCalls: 1, minimumWorkItems: 1, maximumWorkItems: 1 },
    acceptanceScenario: {
      id: "success",
      steps: [{ kind: "success", requirementId: "llm", latencyMs: 0, outputs: [{ graphRef: "recipe-root", nodeRef: target.id, channel: "text", fixtureId: "text", mediaType: "text/plain" }] }]
    }
  } as const;
}

describe("Ether 4.0 graph kernel registry", () => {
  it("publishes a runtime-importable pure domain package", () => {
    const packageJson = JSON.parse(readFileSync(`${workspaceRoot}/packages/graph-kernel/package.json`, "utf8")) as { dependencies: Record<string, string> };
    expect(packageJson.dependencies).toEqual({ "@ether/schema": "workspace:*" });
    expect(execFileSync(process.execPath, ["--input-type=module", "--eval", "import('@ether/graph-kernel').then(m => console.log(m.nodeDefinitions.length))"], { cwd: `${workspaceRoot}/packages/testing`, encoding: "utf8" }).trim()).toBe("17");
  });

  it("imports the versioned lineage identity through the built package", () => {
    const output = execFileSync(process.execPath, ["--input-type=module", "--eval", "import('@ether/graph-kernel').then(m => console.log(m.deriveLineageKey([{ edgeId: 'runtime-edge', payloads: [] }])))"], { cwd: `${workspaceRoot}/packages/testing`, encoding: "utf8" }).trim();
    expect(output).toMatch(/^empty:v2:sha256:[0-9a-f]{64}$/);
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
    expect(nodeLibraryItems).toHaveLength(17);
    expect(nodeLibraryItems.map((item) => item.definitionId)).toEqual(nodeDefinitions.map((definition) => definition.id));
    for (const item of nodeLibraryItems) {
      expect(item.defaultConfig.kind).toBe(item.definitionId);
      expect(item.description).not.toMatch(/ node\.$/u);
      expect(item.example.length).toBeGreaterThan(12);
      expect(item.synonyms.length).toBeGreaterThan(2);
      expect(item.inputChannels).toEqual(getNodeDefinition(item.definitionId).library.inputChannels);
      expect(item.outputChannels).toEqual(getNodeDefinition(item.definitionId).library.outputChannels);
    }
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

  it("compares structures canonically without erasing semantic differences", () => {
    expect(structurallyEqual(
      { id: "same", nested: { alpha: 1, beta: [2, 3] } },
      { nested: { beta: [2, 3], alpha: 1 }, id: "same" }
    )).toBe(true);
    expect(structurallyEqual(
      { id: "same", nested: { alpha: 1, beta: [2, 3] } },
      { nested: { beta: [3, 2], alpha: 1 }, id: "same" }
    )).toBe(false);
  });
});

describe("registry-backed recipe semantics", () => {
  it("keeps structural parsing separate from node config, lane, and module contract validation", () => {
    const base = semanticRecipeFixture();
    const badConfig = {
      ...base,
      graph: { ...base.graph, nodes: [{ ...base.graph.nodes[0], config: { kind: "prompt.text", body: 42, assembly: "append" } }, base.graph.nodes[1]] }
    };
    const badConfigStructural = RecipeManifestSchema.safeParse(badConfig);
    expect(badConfigStructural.success, badConfigStructural.success ? "" : badConfigStructural.error.message).toBe(true);
    expect(validateRecipeManifest(badConfig)).toEqual(expect.objectContaining({
      valid: false,
      diagnostics: expect.arrayContaining([expect.objectContaining({ code: "NODE_CONFIG_INVALID", entityId: "recipe-source" })])
    }));

    const badLane = structuredClone(base);
    badLane.graph.edges[0]!.from.channel = "image";
    expect(RecipeManifestSchema.safeParse(badLane).success).toBe(true);
    expect(validateRecipeManifest(badLane)).toEqual(expect.objectContaining({
      valid: false,
      diagnostics: expect.arrayContaining([expect.objectContaining({ code: "SOURCE_CHANNEL_UNAVAILABLE", entityId: "recipe-edge" })])
    }));

    const internal = {
      graphRef: "recipe-module", title: "Internal", kind: "module" as const,
      nodes: [promptNode("internal-prompt")], edges: [], groups: [], modules: [], viewState
    };
    const invalidModule = {
      id: "recipe-module-instance", title: "Module", graphId: internal.graphRef,
      position: { x: 0, y: 0 }, size: { width: 200, height: 100 }, collapsed: false,
      interface: {
        inputs: [],
        outputs: [{ id: "bad-output", name: "Bad", channel: "image", internalNodeId: "internal-prompt", internalChannel: "image", required: true }],
        parameters: []
      }
    };
    const badModule = {
      ...base,
      graph: { ...base.graph, modules: [invalidModule] },
      moduleGraphs: [internal]
    };
    expect(RecipeManifestSchema.safeParse(badModule).success).toBe(true);
    expect(validateRecipeManifest(badModule)).toEqual(expect.objectContaining({
      valid: false,
      diagnostics: expect.arrayContaining([expect.objectContaining({ code: "MODULE_PORT_CHANNEL_MISMATCH", entityId: "recipe-module-instance" })])
    }));

    const badBinding = {
      ...base,
      parameters: [{
        id: "enabled", type: "boolean", title: "Enabled", description: "Invalid body binding",
        required: true, defaultValue: true
      }],
      substitutions: [{
        requirementId: "llm", providerId: "codex", profileId: "llm-balanced", priority: 0,
        capability: {
          providerId: "codex", profileId: "llm-balanced", operation: "llm",
          inputChannels: ["text"], outputChannels: ["text"], aspectRatios: [], resolutions: [],
          maxReferences: 8, maxOutputsPerCall: 1, supportsCancellation: false,
          supportsSeed: false, provenance: "conformance-verified", limitations: []
        },
        parameterBindings: [{
          parameterId: "enabled",
          target: { graphRef: "recipe-root", nodeRef: "recipe-source", configPath: ["body"] }
        }]
      }]
    };
    expect(RecipeManifestSchema.safeParse(badBinding).success).toBe(true);
    expect(validateRecipeManifest(badBinding)).toEqual(expect.objectContaining({
      valid: false,
      diagnostics: expect.arrayContaining([expect.objectContaining({
        code: "RECIPE_PARAMETER_BINDING_INVALID",
        entityId: "recipe-source"
      })])
    }));
  });

  it("rejects a recipe parameter domain that includes invalid target values", () => {
    const base = semanticRecipeFixture();
    const invalidDomain = {
      ...base,
      parameters: [{
        id: "model", type: "string", title: "Model", description: "Worker model",
        required: true, defaultValue: "balanced", minLength: 0, maxLength: 32
      }],
      substitutions: [{
        requirementId: "llm", providerId: "codex", profileId: "llm-balanced", priority: 0,
        capability: {
          providerId: "codex", profileId: "llm-balanced", operation: "llm",
          inputChannels: ["text"], outputChannels: ["text"], aspectRatios: [], resolutions: [],
          maxReferences: 8, maxOutputsPerCall: 1, supportsCancellation: false,
          supportsSeed: false, provenance: "conformance-verified", limitations: []
        },
        parameterBindings: [{
          parameterId: "model",
          target: { graphRef: "recipe-root", nodeRef: "recipe-target", configPath: ["model"] }
        }]
      }]
    };

    expect(RecipeManifestSchema.safeParse(invalidDomain).success).toBe(true);
    expect(validateRecipeManifest(invalidDomain)).toEqual(expect.objectContaining({
      valid: false,
      diagnostics: expect.arrayContaining([expect.objectContaining({
        code: "RECIPE_PARAMETER_BINDING_INVALID",
        entityId: "recipe-target"
      })])
    }));
  });

  it("requires acceptance outputs to use a channel produced by the target node contract", () => {
    const invalidOutput = structuredClone(semanticRecipeFixture());
    invalidOutput.capabilityRequirements[0]!.outputChannels = ["text", "image"];
    const invalidStep = invalidOutput.acceptanceScenario.steps[0]!;
    if (invalidStep.kind !== "success") throw new Error("Fixture must contain a success step.");
    invalidStep.outputs = [{
      graphRef: "recipe-root",
      nodeRef: "recipe-source",
      channel: "image",
      fixtureId: "claimed-image",
      mediaType: "image/png"
    }];

    expect(RecipeManifestSchema.safeParse(invalidOutput).success).toBe(true);
    expect(validateRecipeManifest(invalidOutput)).toEqual(expect.objectContaining({
      valid: false,
      diagnostics: expect.arrayContaining([expect.objectContaining({
        code: "RECIPE_SCENARIO_OUTPUT_CHANNEL_INVALID",
        graphId: "recipe-root",
        entityId: "recipe-source"
      })])
    }));
  });

  it("leaves acceptance output node resolution to the graph-kernel semantic validator", () => {
    const missingOutputNode = structuredClone(semanticRecipeFixture());
    const missingStep = missingOutputNode.acceptanceScenario.steps[0]!;
    if (missingStep.kind !== "success") throw new Error("Fixture must contain a success step.");
    missingStep.outputs[0]!.nodeRef = "missing-node";

    expect(RecipeManifestSchema.safeParse(missingOutputNode).success).toBe(true);
    expect(validateRecipeManifest(missingOutputNode)).toEqual(expect.objectContaining({
      valid: false,
      diagnostics: expect.arrayContaining([expect.objectContaining({
        code: "RECIPE_SCENARIO_OUTPUT_NODE_MISSING",
        graphId: "recipe-root",
        entityId: "missing-node"
      })])
    }));
  });
});

describe("connections and typed remedies", () => {
  it("accepts valid lanes, rejects exact canonical duplicates, and permits distinct selectors", () => {
    const first = edge("edge-1", "source", "target", "subject");
    const duplicate = { ...first, id: "edge-2", order: 99, enabled: false, adapter: { kind: "auto" as const } };
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

  it("rejects an explicit adapter declared for another channel pair", () => {
    const decision = validateConnection({
      sourceDefinitionId: "prompt.text",
      sourceChannel: "text",
      targetDefinitionId: "prompt.worker",
      targetChannel: "text",
      role: "subject",
      adapter: { kind: "explicit", adapterId: "codex.image-to-text" },
      capabilities: FULL_ADAPTER_CAPABILITIES
    });

    expect(decision).toEqual(expect.objectContaining({
      allowed: false,
      code: "ADAPTER_UNAVAILABLE"
    }));
    expect(() => ConnectionDecisionSchema.parse(decision)).not.toThrow();
  });

  it("rejects an unknown explicit adapter id", () => {
    const decision = validateConnection({
      sourceDefinitionId: "prompt.text",
      sourceChannel: "text",
      targetDefinitionId: "prompt.worker",
      targetChannel: "text",
      role: "subject",
      adapter: { kind: "explicit", adapterId: "missing.adapter" },
      capabilities: FULL_ADAPTER_CAPABILITIES
    });

    expect(decision).toEqual(expect.objectContaining({
      allowed: false,
      code: "ADAPTER_UNAVAILABLE"
    }));
    expect(() => ConnectionDecisionSchema.parse(decision)).not.toThrow();
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
    const textPayloads = [
      payload("payload-approved", "source", "approved", "approved", "approved-lineage"),
      payload("payload-latest", "source", "latest", "latest", "latest-lineage")
    ];
    expect(resolveOutputSelector({ selector: { kind: "latest-approved" }, nodeId: "source", channel: "text", versions, payloads: textPayloads }).versionIds).toEqual(["approved"]);
    expect(resolveOutputSelector({ selector: { kind: "latest" }, nodeId: "source", channel: "text", versions, payloads: textPayloads }).versionIds).toEqual(["latest"]);
    expect(resolveOutputSelector({ selector: { kind: "all" }, nodeId: "source", channel: "text", versions, payloads: textPayloads }).versionIds).toEqual(["approved", "latest"]);
    expect(resolveOutputSelector({ selector: { kind: "pinned", outputVersionId: "latest" }, nodeId: "source", channel: "text", versions, payloads: textPayloads }).diagnostics).toEqual([]);
    expect(resolveOutputSelector({ selector: { kind: "pinned", outputVersionId: "other" }, nodeId: "source", channel: "text", versions, payloads: [] }).diagnostics[0]?.code).toBe("PINNED_VERSION_WRONG_NODE");
    const imagePayload = { ...payload("payload-latest", "source", "latest", "image", "lineage"), channel: "image" as const, content: { kind: "artifact" as const, artifactId: "image-1" } };
    expect(resolveOutputSelector({ selector: { kind: "pinned", outputVersionId: "latest" }, nodeId: "source", channel: "text", versions, payloads: [imagePayload] }).diagnostics[0]?.code).toBe("PINNED_VERSION_WRONG_CHANNEL");
  });

  it("filters immutable versions by node and channel before selector ranking", () => {
    const olderText = version("older-text", "source", "2026-07-17T08:00:00.000Z", { state: "approved", actor: "user", at: timestamp });
    const newerImage = version("newer-image", "source", "2026-07-17T09:00:00.000Z", { state: "approved", actor: "user", at: timestamp });
    const text = payload("payload-older-text", "source", olderText.id, "matching text", "text-lineage");
    const image: PayloadEnvelope = {
      ...payload("payload-newer-image", "source", newerImage.id, "unused", "image-lineage"),
      channel: "image",
      content: { kind: "artifact", artifactId: "image-1" }
    };
    const input = { nodeId: "source", channel: "text" as const, versions: [olderText, newerImage], payloads: [text, image] };

    expect(resolveOutputSelector({ ...input, selector: { kind: "latest" } }).versionIds).toEqual([olderText.id]);
    expect(resolveOutputSelector({ ...input, selector: { kind: "latest-approved" } }).versionIds).toEqual([olderText.id]);
    expect(resolveOutputSelector({ ...input, selector: { kind: "all" } }).versionIds).toEqual([olderText.id]);
  });

  it("returns a typed diagnostic when a source has versions but none for the requested channel", () => {
    const imageVersion = version("image-only", "source", timestamp, { state: "approved", actor: "user", at: timestamp });
    const image: PayloadEnvelope = {
      ...payload("payload-image-only", "source", imageVersion.id, "unused", "image-lineage"),
      channel: "image",
      content: { kind: "artifact", artifactId: "image-only" }
    };
    const result = resolveOutputSelector({ selector: { kind: "latest" }, nodeId: "source", channel: "text", versions: [imageVersion], payloads: [image] });

    expect(result.versionIds).toEqual([]);
    expect(result.diagnostics).toEqual([{ code: "NO_OUTPUT_FOR_CHANNEL", message: "The source node has no immutable output version for text.", channel: "text" }]);
  });

  it("attaches complete lane provenance to every assembly selector diagnostic", () => {
    const target = workerNode("target");
    const a = promptNode("a");
    const b = promptNode("b");
    const first = { ...edge("edge-b", b.id, target.id, "style", 2), selector: { kind: "latest-approved" as const } };
    const second = { ...edge("edge-a", a.id, target.id, "subject", 1), selector: { kind: "pinned" as const, outputVersionId: "missing" } };

    const result = assembleExecutorContext({
      graph: { ...graph("root", "root", [a, b, target]), edges: [first, second] },
      targetNodeId: target.id,
      versions: [],
      payloads: [],
      capabilities: FULL_ADAPTER_CAPABILITIES
    });

    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: "PINNED_VERSION_NOT_FOUND",
        edgeId: "edge-a",
        selector: { kind: "pinned", outputVersionId: "missing" },
        sourceNodeId: "a",
        role: "subject",
        order: 1,
        channel: "text"
      }),
      expect.objectContaining({
        code: "NO_OUTPUT_VERSION",
        edgeId: "edge-b",
        selector: { kind: "latest-approved" },
        sourceNodeId: "b",
        role: "style",
        order: 2,
        channel: "text"
      })
    ]);
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
      payloads: [payload("payload-a-version", "a", "a-version", "first", "linear"), payload("payload-b-version", "b", "b-version", "second", "branch")],
      capabilities: FULL_ADAPTER_CAPABILITIES
    });
    expect(result.manifest.inputs.map((input) => input.caption)).toEqual(["Subject", "Subject 2"]);
    expect(result.manifest.lineageKey).toMatch(/^fanin:/);
  });

  it("derives distinct stable lineage for different empty direct lanes", () => {
    expect(deriveLineageKey([{ edgeId: "empty-a", payloads: [] }])).not.toBe(
      deriveLineageKey([{ edgeId: "empty-b", payloads: [] }])
    );
  });

  it("separates lineage values that collide under delimiter joining", () => {
    expect(deriveLineageKey(lineageLanes(["a", "b"]))).not.toBe(
      deriveLineageKey(lineageLanes(["a\u001fb", "a\u001fb"]))
    );
  });

  it("canonicalizes lineage fan-in ordering before deriving identity", () => {
    expect(deriveLineageKey(lineageLanes(["b", "a"]))).toBe(
      deriveLineageKey(lineageLanes(["a", "b"]))
    );
  });

  it("encodes empty lineage values as non-empty versioned identities", () => {
    const emptyValue = deriveLineageKey(lineageLanes([""]));
    const absentValue = deriveLineageKey([{ edgeId: "empty-value-absent", payloads: [] }]);

    expect(emptyValue).toMatch(/^fanin:v2:sha256:[0-9a-f]{64}$/);
    expect(emptyValue).not.toBe(absentValue);
  });

  it("keeps Unicode lineage identities deterministic across repeated calls", () => {
    const lanes = lineageLanes(["caf\u00e9", "\u65e5\u672c\u8a9e", "\ud83d\ude00"]);
    const first = deriveLineageKey(lanes);

    expect(first).toMatch(/^fanin:v2:sha256:[0-9a-f]{64}$/);
    expect(deriveLineageKey(lanes)).toBe(first);
  });

  it("keeps captions attached to their payload when non-text inputs are omitted from prompt bodies", () => {
    const target = workerNode("target");
    const artifactSource = promptNode("artifact-source");
    const textSource = promptNode("text-source");
    const artifactVersion = version("artifact-version", artifactSource.id, timestamp, { state: "approved", actor: "user", at: timestamp });
    const textVersion = version("text-version", textSource.id, timestamp, { state: "approved", actor: "user", at: timestamp });
    const artifactPayload: PayloadEnvelope = {
      ...payload("payload-artifact-version", artifactSource.id, artifactVersion.id, "unused", "artifact-lineage"),
      content: { kind: "artifact", artifactId: "artifact-1" }
    };
    const result = assembleExecutorContext({
      graph: {
        ...graph("root", "root", [artifactSource, textSource, target]),
        edges: [edge("artifact-edge", artifactSource.id, target.id, "subject", 0), edge("text-edge", textSource.id, target.id, "subject", 1)]
      },
      targetNodeId: target.id,
      versions: [artifactVersion, textVersion],
      payloads: [artifactPayload, payload("payload-text-version", textSource.id, textVersion.id, "visible text", "text-lineage")],
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

  it("reports duplicate module parameter IDs in the full graph state", () => {
    const graphs = moduleFixture();
    const module = graphs[0]!.modules[0]!;
    module.interface.parameters.push({
      ...module.interface.parameters[0]!,
      name: "Duplicate instruction"
    });

    expect(validateFullGraphState(graphs)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "DUPLICATE_MODULE_PARAMETER",
        graphId: "root",
        entityId: "module-1"
      })
    ]));
  });

  it("detects cycles that cross virtual module boundaries", () => {
    const graphs = moduleFixture();
    graphs[0]!.edges.push(edge("cycle", "sink", "source"));
    expect(() => planTraversal(graphs, "root")).toThrow(/cycle/i);
  });

  it("rejects a proposed lane that closes a cycle through virtual module boundaries", () => {
    const graphs = moduleFixture();
    const candidate = edge("proposed-cycle", "sink", "source");
    const decision = validateConnection({
      sourceDefinitionId: "prompt.worker", sourceChannel: "text",
      targetDefinitionId: "prompt.text", targetChannel: "text", role: "general",
      candidate,
      existingEdges: graphs.flatMap((item) => item.edges),
      topology: { graphs }
    } as Parameters<typeof validateConnection>[0]);

    expect(decision).toEqual(expect.objectContaining({
      allowed: false,
      code: "CYCLE_NOT_ALLOWED",
      remedies: [expect.objectContaining({
        kind: "remove-cycle-edges",
        edgeIds: expect.arrayContaining(["enter", "inner-edge", "leave"])
      })]
    }));
    expect(() => ConnectionDecisionSchema.parse(decision)).not.toThrow();
  });

  it("detects ownership cycles in detached graph components deterministically", () => {
    const first = graph("detached-a", "module", []);
    const second = graph("detached-b", "module", []);
    const moduleShape = { title: "Detached", position: { x: 0, y: 0 }, size: { width: 200, height: 100 }, interface: { inputs: [], outputs: [], parameters: [] }, collapsed: false };
    first.modules = [{ ...moduleShape, id: "owns-b", graphId: second.id }];
    second.modules = [{ ...moduleShape, id: "owns-a", graphId: first.id }];

    expect(validateGraphSet([second, first]).filter((item) => item.code === "MODULE_OWNERSHIP_CYCLE")).toEqual([
      expect.objectContaining({ graphId: "detached-a" })
    ]);
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
  it("resolves temporary references once and proves forward/inverse replay", () => {
    const initial = graph("root", "root", []);
    const draftNode = {
      ...promptNode("$temp:node:prompt", "$temp:node:prompt"),
      title: "Temporary"
    };
    const preview = previewGraphTransaction({
      graphs: [initial],
      transaction: {
        id: "tx-temp", baseDocumentRevisionId: "doc-rev", baseGraphRevisions: { root: "graph-rev" },
        title: "Add with temp", actor: "recipe", layoutPolicy: "preserve",
        operations: [
          { type: "addNode", graphId: "root", node: draftNode },
          { type: "moveNodes", graphId: "root", positions: [{ nodeId: "$temp:node:prompt", position: { x: 40, y: 50 } }] }
        ]
      },
      idFactory: ({ kind, name }) => `${kind}-${name}-resolved`
    });
    expect(preview.tempIds).toEqual({ "$temp:node:prompt": "node-prompt-resolved" });
    expect(preview.graphs[0]!.nodes[0]).toMatchObject({
      id: "node-prompt-resolved",
      position: { x: 40, y: 50 },
      config: { body: "$temp:node:prompt" }
    });
    expect(preview.inverseReplay).toEqual([initial]);
    expect(preview.forwardReplay).toEqual(preview.graphs);
    expect(preview.forwardOperations[0]).toMatchObject({
      type: "addNode",
      node: { id: "node-prompt-resolved", config: { body: "$temp:node:prompt" } }
    });
  });

  it("keeps exact reserved-looking strings literal in authored node config", () => {
    const initial = graph("root", "root", [promptNode("prompt")]);
    const authored = promptNode("prompt", "$temp:node:authored-literal");

    const preview = previewGraphTransaction({
      graphs: [initial],
      transaction: {
        id: "tx-authored-temp", baseDocumentRevisionId: "doc-rev", baseGraphRevisions: { root: "graph-rev" },
        title: "Keep authored text", actor: "user", layoutPolicy: "preserve",
        operations: [{ type: "updateNode", graphId: "root", nodeId: "prompt", node: authored }]
      }
    });

    expect(preview.graphs[0]!.nodes[0]!.config).toMatchObject({
      body: "$temp:node:authored-literal"
    });
  });

  it("resolves forward temporary references without reordering transaction operations", () => {
    const initial = graph("root", "root", []);
    const source = promptNode("$temp:node:source");
    const target = workerNode("$temp:node:target");
    const forwardEdge = edge("forward-edge", source.id, target.id, "subject");
    const preview = previewGraphTransaction({
      graphs: [initial],
      transaction: {
        id: "tx-temp-order", baseDocumentRevisionId: "doc-rev", baseGraphRevisions: { root: "graph-rev" },
        title: "Keep operation order", actor: "recipe", layoutPolicy: "preserve",
        operations: [
          { type: "addEdge", graphId: "root", edge: forwardEdge },
          { type: "addNode", graphId: "root", node: source },
          { type: "addNode", graphId: "root", node: target }
        ]
      },
      idFactory: ({ kind, name }) => `${kind}-${name}-resolved`
    });

    expect(preview.forwardOperations.map((operation) => operation.type)).toEqual([
      "addEdge",
      "addNode",
      "addNode"
    ]);
    expect(preview.graphs[0]?.edges[0]).toMatchObject({
      from: { kind: "node", nodeId: "node-source-resolved" },
      to: { kind: "node", nodeId: "node-target-resolved" }
    });
    expect(preview.inverseReplay).toEqual([initial]);
  });

  it("preserves explicit remove-then-add order when replacing an exact lane", () => {
    const initial = graph("root", "root", [promptNode("source"), workerNode("target")]);
    initial.edges = [edge("old-lane", "source", "target", "subject")];
    const replacement = { ...initial.edges[0]!, id: "new-lane" };
    const preview = previewGraphTransaction({
      graphs: [initial],
      transaction: {
        id: "replace-lane", baseDocumentRevisionId: "doc", baseGraphRevisions: { root: "r" },
        title: "Replace lane", actor: "user", layoutPolicy: "preserve",
        operations: [
          { type: "removeEdge", graphId: "root", edgeId: "old-lane" },
          { type: "addEdge", graphId: "root", edge: replacement }
        ]
      }
    });

    expect(preview.forwardOperations.map((operation) => operation.type)).toEqual(["removeEdge", "addEdge"]);
    expect(preview.graphs[0]!.edges.map((item) => item.id)).toEqual(["new-lane"]);
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
