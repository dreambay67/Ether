import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import type {
  EtherEdge,
  EtherGraph,
  JsonObject,
  JsonValue,
  NodeOutputVersion,
  OutputSelector,
  PayloadChannel,
  PayloadEnvelope,
  PromptWorkerConfig,
  ProviderCapability
} from "@ether/schema";

import {
  WorkerContextCompilationError,
  WorkerProfileResolutionError,
  compileWorkerContext,
  resolveMemoryScopeKey,
  resolveWorkerProfile,
  validateWorkerOutput,
  type CompileWorkerContextInput,
  type RuntimeWorkerCatalog,
  type StructuredOutputSchema
} from "../../intelligence/src/index.js";

const workspaceRoot = fileURLToPath(new URL("../../..", import.meta.url));
const timestamp = "2026-07-18T10:00:00.000Z";

function capability(overrides: Partial<ProviderCapability> = {}): ProviderCapability {
  return {
    providerId: "codex",
    profileId: "runtime-llm",
    operation: "llm",
    inputChannels: ["text", "data", "image"],
    outputChannels: ["text", "data"],
    aspectRatios: [],
    resolutions: [],
    maxReferences: 4,
    maxOutputsPerCall: 4,
    supportsCancellation: true,
    supportsSeed: false,
    provenance: "runtime-discovered",
    limitations: [],
    ...overrides
  };
}

function runtimeCatalog(overrides: Partial<RuntimeWorkerCatalog> = {}): RuntimeWorkerCatalog {
  const sharedCapability = capability();
  return {
    profileMappings: [
      { profile: "fast", model: "runtime-alpha", reasoningEffort: "low" },
      { profile: "balanced", model: "runtime-beta", reasoningEffort: "medium" },
      { profile: "deep", model: "runtime-omega", reasoningEffort: "high" }
    ],
    models: [
      { model: "runtime-alpha", reasoningEfforts: ["low"], capability: sharedCapability },
      { model: "runtime-beta", reasoningEfforts: ["medium"], capability: sharedCapability },
      { model: "runtime-omega", reasoningEfforts: ["high"], capability: sharedCapability }
    ],
    ...overrides
  };
}

function workerConfig(overrides: Partial<PromptWorkerConfig> = {}): PromptWorkerConfig {
  return {
    kind: "prompt.worker",
    behavior: "rewrite",
    instruction: "Replace the fruit with a pineapple.",
    profile: "balanced",
    model: "ignored-for-balanced",
    reasoningEffort: "ignored-for-balanced",
    variation: 0.2,
    contextPolicy: {
      includeUpstream: true,
      includeDownstreamCapabilities: true,
      maxTokens: 8_000
    },
    memoryPolicy: { mode: "stateless" },
    outputContract: { channel: "text", count: 1, selectionPolicy: "latest" },
    ...overrides
  };
}

function sourceNode(id: string, channel: PayloadChannel): EtherGraph["nodes"][number] {
  const shared = {
    id,
    title: id,
    position: { x: 0, y: 0 },
    size: { width: 240, height: 160 },
    presentation: { collapsed: false, accent: "neutral", previewMode: "content" as const }
  };
  if (channel === "text" || channel === "data") {
    return {
      ...shared,
      definitionId: "prompt.text",
      config: { kind: "prompt.text", body: "", assembly: "append" }
    };
  }
  return {
    ...shared,
    definitionId: "reference.set",
    config: { kind: "reference.set", artifactIds: [], enabledChannels: [channel], ordering: "manual" }
  };
}

function workerNode(config: PromptWorkerConfig): EtherGraph["nodes"][number] {
  return {
    id: "worker",
    title: "Worker",
    definitionId: "prompt.worker",
    config,
    position: { x: 400, y: 0 },
    size: { width: 280, height: 180 },
    presentation: { collapsed: false, accent: "neutral", previewMode: "content" }
  };
}

function edge(input: {
  id: string;
  sourceNodeId: string;
  channel?: PayloadChannel;
  role?: EtherEdge["role"];
  order?: number;
  selector?: OutputSelector;
}): EtherEdge {
  const channel = input.channel ?? "text";
  return {
    id: input.id,
    from: { kind: "node", nodeId: input.sourceNodeId, channel },
    to: { kind: "node", nodeId: "worker", channel },
    role: input.role ?? "general",
    order: input.order ?? 0,
    selector: input.selector ?? { kind: "latest" },
    adapter: { kind: "auto" },
    enabled: true
  };
}

function graph(config: PromptWorkerConfig, edges: EtherEdge[]): EtherGraph {
  const sourceNodes = edges.flatMap((candidate) => {
    if (candidate.from.kind !== "node") return [];
    return [sourceNode(candidate.from.nodeId, candidate.from.channel)];
  });
  const uniqueSources = [...new Map(sourceNodes.map((node) => [node.id, node])).values()];
  return {
    id: "graph",
    title: "Intelligence fixture",
    kind: "root",
    createdAt: timestamp,
    updatedAt: timestamp,
    nodes: [...uniqueSources, workerNode(config)],
    edges,
    groups: [],
    modules: [],
    viewState: {
      viewport: { x: 0, y: 0, zoom: 1 },
      selectedNodeIds: [],
      selectedEdgeIds: [],
      inspectorTarget: null
    }
  };
}

function payload(input: {
  id: string;
  nodeId: string;
  versionId: string;
  channel?: PayloadChannel;
  value?: JsonValue;
  lineageKey?: string;
}): PayloadEnvelope {
  const channel = input.channel ?? "text";
  const content = channel === "text"
    ? { kind: "text" as const, value: String(input.value ?? input.id) }
    : channel === "data"
      ? { kind: "object" as const, value: input.value ?? { id: input.id } }
      : { kind: "artifact" as const, artifactId: `artifact-${input.id}` };
  return {
    id: input.id,
    channel,
    role: "general",
    content,
    source: {
      nodeId: input.nodeId,
      outputVersionId: input.versionId,
      lineageKey: input.lineageKey ?? `lineage-${input.nodeId}`
    },
    metadata: {}
  };
}

function version(input: {
  id: string;
  nodeId: string;
  payloadIds: string[];
  createdAt?: string;
  approval?: NodeOutputVersion["approval"];
}): NodeOutputVersion {
  return {
    id: input.id,
    nodeId: input.nodeId,
    graphId: "graph",
    graphRevisionId: "revision-1",
    inputPayloadIds: [],
    selectedOutputVersionIds: [],
    compiledContextHash: "fixture-context",
    producer: { kind: "local", executor: "deterministic-assembly" },
    outputPayloadIds: input.payloadIds,
    parentOutputVersionId: null,
    approval: input.approval ?? { state: "unreviewed" },
    runId: null,
    stepId: null,
    workItemId: null,
    attemptId: null,
    timing: { startedAt: timestamp, completedAt: timestamp },
    failure: null,
    createdAt: input.createdAt ?? timestamp
  };
}

function compileInput(input: {
  config?: PromptWorkerConfig;
  edges?: EtherEdge[];
  versions?: NodeOutputVersion[];
  payloads?: PayloadEnvelope[];
  catalog?: RuntimeWorkerCatalog;
  downstream?: CompileWorkerContextInput["downstream"];
  schemas?: StructuredOutputSchema[];
} = {}): CompileWorkerContextInput {
  const config = input.config ?? workerConfig();
  const edges = input.edges ?? [];
  return {
    graph: graph(config, edges),
    targetNodeId: "worker",
    versions: input.versions ?? [],
    payloads: input.payloads ?? [],
    runtimeCatalog: input.catalog ?? runtimeCatalog(),
    adapterCapabilities: [],
    downstream: input.downstream ?? null,
    schemaCatalog: input.schemas ?? []
  };
}

function structuredSchema(): StructuredOutputSchema {
  return {
    id: "campaign-brief",
    schema: {
      type: "object",
      required: ["title"],
      properties: { title: { type: "string" } },
      additionalProperties: false
    }
  };
}

function constrainedSchema(): StructuredOutputSchema {
  return {
    id: "constrained-brief",
    schema: {
      type: "object",
      required: ["title", "score", "tags", "mode"],
      properties: {
        title: { type: "string", minLength: 5 },
        score: { type: "number", minimum: 0, maximum: 10, multipleOf: 0.5 },
        tags: {
          type: "array",
          minItems: 2,
          uniqueItems: true,
          items: { type: "string", pattern: "^[a-z]+$" }
        },
        mode: {
          anyOf: [{ const: "draft" }, { const: "final" }]
        }
      },
      allOf: [{ properties: { title: { maxLength: 40 } } }],
      additionalProperties: false
    }
  };
}

function expectCompilationDiagnostic(input: CompileWorkerContextInput, code: string): void {
  try {
    compileWorkerContext(input);
    throw new Error("Expected context compilation to fail.");
  } catch (error) {
    expect(error).toBeInstanceOf(WorkerContextCompilationError);
    expect((error as WorkerContextCompilationError).manifest.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code, blocking: true })])
    );
  }
}

describe("runtime-discovered worker profiles", () => {
  it.each([
    ["fast", "runtime-alpha", "low"],
    ["balanced", "runtime-beta", "medium"],
    ["deep", "runtime-omega", "high"]
  ] as const)("resolves %s only through its injected mapping", (profile, model, reasoningEffort) => {
    const resolved = resolveWorkerProfile(workerConfig({ profile, model: "misleading-name", reasoningEffort: "other" }), runtimeCatalog());
    expect(resolved).toMatchObject({ profile, model, reasoningEffort });
    expect(resolved.capability.provenance).toBe("runtime-discovered");
  });

  it("requires custom to match an exact discovered model and reasoning pair", () => {
    const config = workerConfig({ profile: "custom", model: "runtime-alpha", reasoningEffort: "low" });
    expect(resolveWorkerProfile(config, runtimeCatalog())).toMatchObject({
      profile: "custom",
      model: "runtime-alpha",
      reasoningEffort: "low"
    });
    expect(() => resolveWorkerProfile({ ...config, reasoningEffort: "high" }, runtimeCatalog())).toThrowError(
      expect.objectContaining({ code: "MODEL_REASONING_PAIR_UNAVAILABLE" })
    );
  });

  it("does not infer profile mappings from model names", () => {
    const catalog = runtimeCatalog({
      profileMappings: [],
      models: [{ model: "obviously-fast-model", reasoningEfforts: ["low"], capability: capability() }]
    });
    expect(() => resolveWorkerProfile(workerConfig({ profile: "fast" }), catalog)).toThrowError(
      expect.objectContaining({ code: "PROFILE_MAPPING_UNAVAILABLE" })
    );
  });
});

describe("deterministic worker context compilation", () => {
  it("returns a deterministic request and inspectable manifest while separating instruction from upstream content", () => {
    const lane = edge({ id: "edge-subject", sourceNodeId: "subject", role: "subject" });
    const upstream = payload({ id: "payload-subject", nodeId: "subject", versionId: "version-subject", value: "woman holding a watermelon" });
    const input = compileInput({
      edges: [lane],
      versions: [version({ id: "version-subject", nodeId: "subject", payloadIds: [upstream.id] })],
      payloads: [upstream]
    });
    const first = compileWorkerContext(input);
    const second = compileWorkerContext({ ...input, payloads: [...input.payloads].reverse() });

    expect(second).toEqual(first);
    expect(first.request.instruction).toContain("Replace the fruit with a pineapple.");
    expect(first.request.instruction).not.toContain("woman holding a watermelon");
    expect(first.request.inputs.map((candidate) => candidate.id)).toEqual(["payload-subject"]);
    expect(first.manifest.authoredInstruction).toBe("Replace the fruit with a pineapple.");
    expect(first.manifest.lineageKey).toBe("lineage-subject");
    expect(first.manifest.dispatchable).toBe(true);
  });

  it("sorts direct lanes by order then edge ID and numbers repeated direct roles", () => {
    const edges = [
      edge({ id: "edge-z", sourceNodeId: "subject-z", role: "subject", order: 2 }),
      edge({ id: "edge-b", sourceNodeId: "subject-b", role: "subject", order: 1 }),
      edge({ id: "edge-a", sourceNodeId: "subject-a", role: "subject", order: 1 })
    ];
    const payloads = [
      payload({ id: "payload-z", nodeId: "subject-z", versionId: "version-z" }),
      payload({ id: "payload-b", nodeId: "subject-b", versionId: "version-b" }),
      payload({ id: "payload-a", nodeId: "subject-a", versionId: "version-a" })
    ];
    const versions = payloads.map((candidate) => version({
      id: candidate.source.outputVersionId,
      nodeId: candidate.source.nodeId,
      payloadIds: [candidate.id]
    }));
    const compiled = compileWorkerContext(compileInput({ edges, versions: versions.reverse(), payloads: payloads.reverse() }));

    expect(compiled.request.inputs.map((candidate) => candidate.id)).toEqual(["payload-a", "payload-b", "payload-z"]);
    expect(compiled.manifest.inputs.map((candidate) => [candidate.edgeId, candidate.caption])).toEqual([
      ["edge-a", "Subject"],
      ["edge-b", "Subject 2"],
      ["edge-z", "Subject 3"]
    ]);
  });

  it("preserves one lineage through linear replacement and derives independent fan-in lineage", () => {
    const linearEdge = edge({ id: "linear", sourceNodeId: "replacement" });
    const linearPayload = payload({
      id: "linear-payload",
      nodeId: "replacement",
      versionId: "linear-version",
      lineageKey: "original-branch"
    });
    const linear = compileWorkerContext(compileInput({
      edges: [linearEdge],
      payloads: [linearPayload],
      versions: [version({ id: "linear-version", nodeId: "replacement", payloadIds: [linearPayload.id] })]
    }));
    expect(linear.manifest.lineageKey).toBe("original-branch");

    const fanEdges = [edge({ id: "fan-a", sourceNodeId: "a" }), edge({ id: "fan-b", sourceNodeId: "b", order: 1 })];
    const fanPayloads = [
      payload({ id: "fan-payload-a", nodeId: "a", versionId: "fan-version-a", lineageKey: "branch-a" }),
      payload({ id: "fan-payload-b", nodeId: "b", versionId: "fan-version-b", lineageKey: "branch-b" })
    ];
    const fan = compileWorkerContext(compileInput({
      edges: fanEdges,
      payloads: fanPayloads,
      versions: [
        version({ id: "fan-version-a", nodeId: "a", payloadIds: ["fan-payload-a"] }),
        version({ id: "fan-version-b", nodeId: "b", payloadIds: ["fan-payload-b"] })
      ]
    }));
    expect(fan.manifest.lineageKey).toMatch(/^fanin:v2:sha256:[0-9a-f]{64}$/);
    expect(fan.manifest.lineageKey).not.toContain("fan-a");
  });

  it.each([
    ["latest-approved", { kind: "latest-approved" } as OutputSelector, ["payload-old"]],
    ["latest", { kind: "latest" } as OutputSelector, ["payload-new"]],
    ["all", { kind: "all" } as OutputSelector, ["payload-old", "payload-new"]],
    ["pinned", { kind: "pinned", outputVersionId: "version-old" } as OutputSelector, ["payload-old"]]
  ])("resolves the %s output selector", (_name, selector, expectedPayloadIds) => {
    const lane = edge({ id: "selector-edge", sourceNodeId: "source", selector });
    const oldPayload = payload({ id: "payload-old", nodeId: "source", versionId: "version-old" });
    const newPayload = payload({ id: "payload-new", nodeId: "source", versionId: "version-new" });
    const compiled = compileWorkerContext(compileInput({
      edges: [lane],
      payloads: [newPayload, oldPayload],
      versions: [
        version({
          id: "version-new",
          nodeId: "source",
          payloadIds: [newPayload.id],
          createdAt: "2026-07-18T11:00:00.000Z"
        }),
        version({
          id: "version-old",
          nodeId: "source",
          payloadIds: [oldPayload.id],
          createdAt: "2026-07-18T09:00:00.000Z",
          approval: { state: "approved", actor: "user", at: timestamp }
        })
      ]
    }));
    expect(compiled.request.inputs.map((candidate) => candidate.id)).toEqual(expectedPayloadIds);
  });

  it.each([
    ["NO_OUTPUT_VERSION", { kind: "latest" } as OutputSelector, "none", []],
    ["NO_OUTPUT_FOR_CHANNEL", { kind: "latest" } as OutputSelector, "wrong-channel", ["version-source"]],
    ["NO_APPROVED_OUTPUT", { kind: "latest-approved" } as OutputSelector, "matching", ["version-source"]],
    ["PINNED_VERSION_NOT_FOUND", { kind: "pinned", outputVersionId: "missing" } as OutputSelector, "none", []],
    ["PINNED_VERSION_WRONG_NODE", { kind: "pinned", outputVersionId: "other-version" } as OutputSelector, "other-node", ["other-version"]],
    ["PINNED_VERSION_WRONG_CHANNEL", { kind: "pinned", outputVersionId: "version-source" } as OutputSelector, "wrong-channel", ["version-source"]]
  ])("blocks dispatch with the %s selector diagnostic", (code, selector, fixtureKind, versionIds) => {
    const lane = edge({ id: "selector-edge", sourceNodeId: "source", selector });
    const matching = payload({ id: "payload-source", nodeId: "source", versionId: "version-source" });
    const wrongChannel = payload({ id: "payload-image", nodeId: "source", versionId: "version-source", channel: "image" });
    const otherNode = payload({ id: "payload-other", nodeId: "other", versionId: "other-version" });
    const payloads = fixtureKind === "matching" ? [matching] : fixtureKind === "wrong-channel" ? [wrongChannel] : fixtureKind === "other-node" ? [otherNode] : [];
    const versions = versionIds.map((id) => id === "other-version"
      ? version({ id, nodeId: "other", payloadIds: [otherNode.id] })
      : version({
        id,
        nodeId: "source",
        payloadIds: [fixtureKind === "matching" ? matching.id : wrongChannel.id]
      }));
    expectCompilationDiagnostic(compileInput({ edges: [lane], payloads, versions }), code);
  });

  it("omits upstream inputs when includeUpstream is false", () => {
    const config = workerConfig({
      contextPolicy: { includeUpstream: false, includeDownstreamCapabilities: true, maxTokens: 8_000 }
    });
    const lane = edge({ id: "edge-upstream", sourceNodeId: "source" });
    const upstream = payload({ id: "upstream", nodeId: "source", versionId: "version-upstream" });
    const compiled = compileWorkerContext(compileInput({
      config,
      edges: [lane],
      payloads: [upstream],
      versions: [version({ id: "version-upstream", nodeId: "source", payloadIds: [upstream.id] })]
    }));
    expect(compiled.request.inputs).toEqual([]);
    expect(compiled.manifest.inputs).toEqual([expect.objectContaining({ included: false, exclusionCode: "UPSTREAM_DISABLED" })]);
  });

  it("includes or suppresses the injected downstream summary according to context policy", () => {
    const downstream = {
      requiredChannels: ["image" as const],
      providerProfileIds: ["image-edit"],
      limitations: ["maximum of two references"]
    };
    expect(compileWorkerContext(compileInput({ downstream })).request.downstream).toEqual(downstream);
    const disabled = workerConfig({
      contextPolicy: { includeUpstream: true, includeDownstreamCapabilities: false, maxTokens: 8_000 }
    });
    expect(compileWorkerContext(compileInput({ config: disabled, downstream })).request.downstream).toBeNull();
  });

  it("excludes unsupported media and records the capability decision", () => {
    const videoEdge = edge({ id: "edge-video", sourceNodeId: "video", channel: "video" });
    const video = payload({ id: "video-payload", nodeId: "video", versionId: "video-version", channel: "video" });
    const compiled = compileWorkerContext(compileInput({
      edges: [videoEdge],
      payloads: [video],
      versions: [version({ id: "video-version", nodeId: "video", payloadIds: [video.id] })]
    }));
    expect(compiled.request.inputs).toEqual([]);
    expect(compiled.manifest.inputs[0]).toMatchObject({ included: false, exclusionCode: "UNSUPPORTED_CHANNEL" });
  });

  it("uses one deterministic maxReferences budget across image, mask, audio, and video", () => {
    const channels = ["video", "image", "audio", "mask"] as const;
    const edges = channels.map((channel, index) => edge({
      id: `edge-${channel}`,
      sourceNodeId: channel,
      channel,
      order: index === 0 ? 3 : index === 1 ? 1 : index === 2 ? 2 : 1
    }));
    const payloads = channels.map((channel) => payload({
      id: `payload-${channel}`,
      nodeId: channel,
      versionId: `version-${channel}`,
      channel
    }));
    const versions = payloads.map((candidate) => version({
      id: candidate.source.outputVersionId,
      nodeId: candidate.source.nodeId,
      payloadIds: [candidate.id]
    }));
    const catalog = runtimeCatalog({
      models: runtimeCatalog().models.map((model) => ({
        ...model,
        capability: capability({ inputChannels: ["text", "data", "image", "mask", "audio", "video"], maxReferences: 2 })
      }))
    });
    const compiled = compileWorkerContext(compileInput({ edges, payloads: payloads.reverse(), versions, catalog }));
    expect(compiled.request.inputs.map((candidate) => candidate.id)).toEqual(["payload-image", "payload-mask"]);
    expect(compiled.manifest.budget.mediaReferences).toEqual({ included: 2, maximum: 2 });
    expect(compiled.manifest.inputs.filter((candidate) => candidate.exclusionCode === "MEDIA_REFERENCE_LIMIT")).toHaveLength(2);
  });

  it("does not charge media against maxTokens", () => {
    const config = workerConfig({
      contextPolicy: { includeUpstream: true, includeDownstreamCapabilities: true, maxTokens: 1 }
    });
    const edges = [
      edge({ id: "edge-text", sourceNodeId: "text", order: 0 }),
      edge({ id: "edge-image", sourceNodeId: "image", channel: "image", order: 1 })
    ];
    const text = payload({ id: "payload-text", nodeId: "text", versionId: "version-text", value: "four" });
    const image = payload({ id: "payload-image", nodeId: "image", versionId: "version-image", channel: "image" });
    const compiled = compileWorkerContext(compileInput({
      config,
      edges,
      payloads: [text, image],
      versions: [
        version({ id: "version-text", nodeId: "text", payloadIds: [text.id] }),
        version({ id: "version-image", nodeId: "image", payloadIds: [image.id] })
      ]
    }));
    expect(compiled.request.inputs.map((candidate) => candidate.id)).toEqual([text.id, image.id]);
    expect(compiled.manifest.budget.textTokens).toEqual({ included: 1, maximum: 1 });
  });

  it("excludes text and data over budget in stable lane order while allowing later inputs that fit", () => {
    const config = workerConfig({
      contextPolicy: { includeUpstream: true, includeDownstreamCapabilities: true, maxTokens: 2 }
    });
    const edges = [
      edge({ id: "edge-a", sourceNodeId: "a", order: 0 }),
      edge({ id: "edge-b", sourceNodeId: "b", channel: "data", order: 1 }),
      edge({ id: "edge-c", sourceNodeId: "c", order: 2 })
    ];
    const payloads = [
      payload({ id: "payload-a", nodeId: "a", versionId: "version-a", value: "one" }),
      payload({ id: "payload-b", nodeId: "b", versionId: "version-b", channel: "data", value: { long: "1234567890" } }),
      payload({ id: "payload-c", nodeId: "c", versionId: "version-c", value: "two" })
    ];
    const versions = payloads.map((candidate) => version({
      id: candidate.source.outputVersionId,
      nodeId: candidate.source.nodeId,
      payloadIds: [candidate.id]
    }));
    const compiled = compileWorkerContext(compileInput({ config, edges, payloads: payloads.reverse(), versions }));
    expect(compiled.request.inputs.map((candidate) => candidate.id)).toEqual(["payload-a", "payload-c"]);
    expect(compiled.manifest.inputs.find((candidate) => candidate.payloadId === "payload-b")).toMatchObject({
      included: false,
      exclusionCode: "TEXT_TOKEN_LIMIT"
    });
  });

  it("accepts known structured schema IDs and blocks unknown IDs", () => {
    const config = workerConfig({
      outputContract: { channel: "data", schemaId: "campaign-brief", count: 1, selectionPolicy: "latest" }
    });
    expect(compileWorkerContext(compileInput({ config, schemas: [structuredSchema()] })).manifest.dispatchable).toBe(true);
    expectCompilationDiagnostic(compileInput({ config }), "UNKNOWN_OUTPUT_SCHEMA");
  });

  it("blocks missing runtime model capabilities and unsupported output channels", () => {
    const missingCatalog = runtimeCatalog({ models: [] });
    expectCompilationDiagnostic(compileInput({ catalog: missingCatalog }), "MODEL_REASONING_PAIR_UNAVAILABLE");
    const imageOnlyCatalog = runtimeCatalog({
      models: runtimeCatalog().models.map((model) => ({
        ...model,
        capability: capability({ outputChannels: ["data"] })
      }))
    });
    expectCompilationDiagnostic(compileInput({ catalog: imageOnlyCatalog }), "OUTPUT_CHANNEL_UNSUPPORTED");
  });

  it("preserves missing adapter capability identity and remedies in the blocking manifest", () => {
    const imageToText = {
      ...edge({ id: "edge-image-to-text", sourceNodeId: "image-source", channel: "image" }),
      to: { kind: "node" as const, nodeId: "worker", channel: "text" as const }
    };
    const image = payload({
      id: "payload-image-to-text",
      nodeId: "image-source",
      versionId: "version-image-to-text",
      channel: "image"
    });
    const input = compileInput({
      edges: [imageToText],
      payloads: [image],
      versions: [version({
        id: "version-image-to-text",
        nodeId: "image-source",
        payloadIds: [image.id]
      })]
    });

    try {
      compileWorkerContext(input);
      throw new Error("Expected missing adapter capability to block compilation.");
    } catch (error) {
      expect(error).toBeInstanceOf(WorkerContextCompilationError);
      expect((error as WorkerContextCompilationError).code).toBe("PROVIDER_CAPABILITY_UNAVAILABLE");
      expect((error as WorkerContextCompilationError).manifest.diagnostics).toContainEqual({
        code: "PROVIDER_CAPABILITY_UNAVAILABLE",
        message: "Adapter requires capability codex.vision.",
        blocking: true,
        details: {
          edgeId: "edge-image-to-text",
          requiredCapability: "codex.vision",
          sourceChannel: "image",
          targetChannel: "text",
          remedies: [{ kind: "enable-capability", capability: "codex.vision" }]
        }
      });
    }
  });

  it("blocks a known but invalid structured output schema before dispatch", () => {
    const config = workerConfig({
      outputContract: { channel: "data", schemaId: "invalid-schema", count: 1, selectionPolicy: "latest" }
    });
    expectCompilationDiagnostic(compileInput({
      config,
      schemas: [{
        id: "invalid-schema",
        schema: { type: "object", properties: { title: { type: "not-a-json-schema-type" } } }
      }]
    }), "INVALID_OUTPUT_SCHEMA");
  });
});

describe("worker output validation and transformation guard", () => {
  it("accepts valid structured output and rejects schema-invalid structured output", () => {
    const config = workerConfig({
      behavior: "extract",
      outputContract: { channel: "data", schemaId: "campaign-brief", count: 1, selectionPolicy: "latest" }
    });
    expect(validateWorkerOutput({ config, output: { title: "Summer launch" }, schemaCatalog: [structuredSchema()], attempt: 0 })).toMatchObject({
      accepted: true,
      value: { title: "Summer launch" }
    });
    expect(validateWorkerOutput({ config, output: { title: 42 }, schemaCatalog: [structuredSchema()], attempt: 0 })).toMatchObject({
      accepted: false,
      issues: [expect.objectContaining({ code: "SCHEMA_INVALID" })]
    });
  });

  it("applies transformation guards recursively to structured string leaves with stable JSON paths", () => {
    const config = workerConfig({
      outputContract: { channel: "data", count: 1, selectionPolicy: "latest" }
    });
    const result = validateWorkerOutput({
      config,
      output: {
        metadata: { summary: "Sure, here is the revised prompt." },
        variants: [
          { prompt: "A woman holding a pineapple instead of a watermelon." },
          { prompt: "A corrected studio portrait." }
        ]
      },
      schemaCatalog: [],
      attempt: 0
    });

    expect(result).toMatchObject({
      accepted: false,
      issues: [
        expect.objectContaining({ code: "CONVERSATIONAL_PREFACE", path: "$.metadata.summary" }),
        expect.objectContaining({ code: "CHANGE_NARRATION", path: "$.variants[0].prompt" })
      ],
      correctiveRetry: { attempt: 1, maximumAttempts: 1 }
    });
    expect(new Set(result.issues.map((issue) => `${issue.code}|${issue.path}|${issue.message}`)).size).toBe(result.issues.length);
    const retryLines = result.correctiveRetry?.instruction.split("\n") ?? [];
    expect(new Set(retryLines).size).toBe(retryLines.length);
  });

  it("accepts corrected structured transformation content", () => {
    const config = workerConfig({
      behavior: "mutate",
      outputContract: { channel: "data", count: 1, selectionPolicy: "latest" }
    });
    expect(validateWorkerOutput({
      config,
      output: { prompt: "A woman holding a ripe pineapple on a marble counter." },
      schemaCatalog: [],
      attempt: 1
    })).toMatchObject({ accepted: true, correctiveRetry: null });
  });

  it("validates representative JSON Schema constraints and normalizes errors stably", () => {
    const schema = constrainedSchema();
    const snapshot = JSON.stringify(schema);
    const config = workerConfig({
      behavior: "extract",
      outputContract: { channel: "data", schemaId: schema.id, count: 1, selectionPolicy: "latest" }
    });
    const valid = validateWorkerOutput({
      config,
      output: { title: "Launch brief", score: 8.5, tags: ["summer", "studio"], mode: "final" },
      schemaCatalog: [schema],
      attempt: 0
    });
    expect(valid.accepted).toBe(true);

    const invalidInput = {
      title: "tiny",
      score: 10.25,
      tags: ["Summer", "Summer"],
      mode: "unknown",
      extra: true
    };
    const first = validateWorkerOutput({ config, output: invalidInput, schemaCatalog: [schema], attempt: 0 });
    const second = validateWorkerOutput({ config, output: invalidInput, schemaCatalog: [schema], attempt: 0 });
    expect(first.accepted).toBe(false);
    expect(first.issues).toEqual(second.issues);
    expect(first.issues).toEqual([...first.issues].sort((left, right) =>
      (left.path ?? "$ ").localeCompare(right.path ?? "$ ")
      || left.message.localeCompare(right.message)
    ));
    expect(first.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "SCHEMA_INVALID", path: "$.title" }),
      expect.objectContaining({ code: "SCHEMA_INVALID", path: "$.score" }),
      expect.objectContaining({ code: "SCHEMA_INVALID", path: "$.tags" }),
      expect.objectContaining({ code: "SCHEMA_INVALID", path: "$.mode" }),
      expect.objectContaining({ code: "SCHEMA_INVALID", path: "$.extra" })
    ]));
    expect(first.issues.find((issue) => issue.path === "$.title")?.message).toContain("minLength");
    expect(JSON.stringify(schema)).toBe(snapshot);
  });

  it.each([
    [
      "invalid type declaration",
      { type: "object", properties: { title: { type: "not-a-json-schema-type" } } }
    ],
    [
      "unresolved external reference",
      { $ref: "https://schemas.ether.invalid/missing.json" }
    ]
  ] as const)("rejects an %s explicitly", (_name, schemaDefinition) => {
    const schema: StructuredOutputSchema = { id: "broken-schema", schema: schemaDefinition };
    const config = workerConfig({
      behavior: "extract",
      outputContract: { channel: "data", schemaId: schema.id, count: 1, selectionPolicy: "latest" }
    });
    expect(validateWorkerOutput({
      config,
      output: { title: "Launch" },
      schemaCatalog: [schema],
      attempt: 0
    })).toMatchObject({
      accepted: false,
      issues: [expect.objectContaining({ code: "INVALID_OUTPUT_SCHEMA" })],
      correctiveRetry: { attempt: 1, maximumAttempts: 1 }
    });
  });

  it("validates JSON null instead of treating it as a parse-failure sentinel", () => {
    const schema: StructuredOutputSchema = { id: "object-only", schema: { type: "object" } };
    const config = workerConfig({
      behavior: "extract",
      outputContract: { channel: "data", schemaId: schema.id, count: 1, selectionPolicy: "latest" }
    });
    expect(validateWorkerOutput({
      config,
      output: null,
      schemaCatalog: [schema],
      attempt: 0
    })).toMatchObject({
      accepted: false,
      issues: [expect.objectContaining({ code: "SCHEMA_INVALID", path: "$" })]
    });
  });

  it.each(["rewrite", "mutate"] as const)("adds a content-only contract for %s", (behavior) => {
    const compiled = compileWorkerContext(compileInput({ config: workerConfig({ behavior }) }));
    expect(compiled.request.instruction).toContain("Return transformed content only.");
    expect(compiled.request.instruction).toContain("Preserve unaffected details.");
  });

  it.each([
    ["empty", "   ", "EMPTY_OUTPUT"],
    ["conversational preface", "Sure, here is the revised prompt: A woman holding a pineapple.", "CONVERSATIONAL_PREFACE"],
    ["change narration", "A woman holding a pineapple instead of a watermelon.", "CHANGE_NARRATION"]
  ])("rejects %s", (_name, output, code) => {
    const result = validateWorkerOutput({ config: workerConfig(), output, schemaCatalog: [], attempt: 0 });
    expect(result).toMatchObject({
      accepted: false,
      issues: [expect.objectContaining({ code })],
      correctiveRetry: { attempt: 1, maximumAttempts: 1 }
    });
  });

  it("accepts corrected transformed content and permits contrastive narration only when explicitly requested", () => {
    expect(validateWorkerOutput({
      config: workerConfig(),
      output: "A woman holding a ripe pineapple on a marble counter.",
      schemaCatalog: [],
      attempt: 1
    })).toMatchObject({ accepted: true, correctiveRetry: null });
    expect(validateWorkerOutput({
      config: workerConfig({ instruction: "Compare and contrast a pineapple instead of a watermelon." }),
      output: "A pineapple instead of a watermelon creates a sharper tropical silhouette.",
      schemaCatalog: [],
      attempt: 0
    })).toMatchObject({ accepted: true });
  });

  it.each([
    "Do not compare or contrast the old and new content.",
    "Never compare the pineapple with the watermelon.",
    "Rewrite the prompt without a comparison to the prior fruit.",
    "Avoid contrasting the revised content with the original.",
    "Rewrite the result and not compare it with the original.",
    "A comparison with the original is not requested."
  ])("does not grant the contrast exception for negated intent: %s", (instruction) => {
    expect(validateWorkerOutput({
      config: workerConfig({ instruction }),
      output: "A pineapple instead of a watermelon creates a tropical silhouette.",
      schemaCatalog: [],
      attempt: 0
    })).toMatchObject({
      accepted: false,
      issues: [expect.objectContaining({ code: "CHANGE_NARRATION" })]
    });
  });

  it.each([
    "Compare the pineapple with the watermelon.",
    "Contrast the revised content against the original.",
    "Show a before and after comparison of the fruit."
  ])("grants the contrast exception for affirmative intent: %s", (instruction) => {
    expect(validateWorkerOutput({
      config: workerConfig({ instruction }),
      output: "A pineapple instead of a watermelon creates a tropical silhouette.",
      schemaCatalog: [],
      attempt: 0
    })).toMatchObject({ accepted: true });
  });

  it("allows a genuinely affirmative contrast cue in a separate clause", () => {
    expect(validateWorkerOutput({
      config: workerConfig({
        instruction: "Do not narrate the rewrite or mention editing steps. Compare the pineapple with the watermelon."
      }),
      output: "A pineapple instead of a watermelon creates a tropical silhouette.",
      schemaCatalog: [],
      attempt: 0
    })).toMatchObject({ accepted: true });
  });

  it("offers exactly one bounded corrective retry and never performs it", () => {
    const first = validateWorkerOutput({ config: workerConfig(), output: "", schemaCatalog: [], attempt: 0 });
    const second = validateWorkerOutput({ config: workerConfig(), output: "", schemaCatalog: [], attempt: 1 });
    expect(first.correctiveRetry).toMatchObject({ attempt: 1, maximumAttempts: 1 });
    expect(first.correctiveRetry?.instruction).toContain("Return corrected content only.");
    expect(second.correctiveRetry).toBeNull();
  });
});

describe("worker memory policy", () => {
  it("resolves stateless, per-node, and per-branch scope keys", () => {
    expect(resolveMemoryScopeKey({ mode: "stateless" }, "worker", "branch-a")).toBeNull();
    expect(resolveMemoryScopeKey({ mode: "per-node" }, "worker", "branch-a")).toBe("node:worker");
    expect(resolveMemoryScopeKey({ mode: "per-branch" }, "worker", "branch-a")).toBe("branch:branch-a");
  });
});

describe("intelligence package boundary", () => {
  it("publishes ESM with the approved direct dependencies", () => {
    const packageJson = JSON.parse(readFileSync(`${workspaceRoot}/packages/intelligence/package.json`, "utf8")) as {
      name: string;
      type: string;
      dependencies: Record<string, string>;
    };
    expect(packageJson).toMatchObject({ name: "@ether/intelligence", type: "module" });
    expect(packageJson.dependencies).toEqual({
      "@ether/graph-kernel": "workspace:*",
      "@ether/schema": "workspace:*",
      "ajv": "^8.20.0"
    });
    const source = ["index", "profiles", "behaviors", "compileContext", "transformationGuard", "outputValidation", "memoryPolicy"]
      .map((name) => readFileSync(`${workspaceRoot}/packages/intelligence/src/${name}.ts`, "utf8"))
      .join("\n");
    expect(source).not.toMatch(/@ether\/(providers|execution)/);
  });

  it("builds and imports the public ESM package", () => {
    execFileSync(process.env.ComSpec ?? "cmd.exe", [
      "/d",
      "/s",
      "/c",
      "pnpm.cmd --filter @ether/intelligence build"
    ], { cwd: workspaceRoot, stdio: "pipe" });
    const output = execFileSync(process.execPath, [
      "--input-type=module",
      "--eval",
      "import('@ether/intelligence').then(m => console.log([typeof m.compileWorkerContext, typeof m.resolveWorkerProfile, typeof m.resolveMemoryScopeKey, typeof m.validateWorkerOutput].join(',')))"
    ], { cwd: `${workspaceRoot}/packages/testing`, encoding: "utf8" }).trim();
    expect(output).toBe("function,function,function,function");
  }, 30_000);
});

void WorkerProfileResolutionError;
void ({} as JsonObject);
