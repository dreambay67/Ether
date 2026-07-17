import {
  ApplicationCommandSchema,
  ApplicationCommandResponseSchema,
  ApplicationEventSchema,
  ApplicationMessageSchema,
  ApplicationQuerySchema,
  ApplicationQueryResponseSchema,
  ArtifactSchema,
  CollectionSchema,
  ConnectionDecisionSchema,
  ConnectionRoleSchema,
  DocumentHeaderSchema,
  ExecutionAttemptSchema,
  ExecutionJobSchema,
  ExecutionPlanSchema,
  ExecutionWorkItemSchema,
  GraphTransactionSchema,
  GraphBlueprintSchema,
  LiveOutputSettingsSchema,
  NodeConfigSchemas,
  NodeDefinitionSchema,
  NodeDefinitionIdSchema,
  NodeOutputVersionSchema,
  OutputSelectorSchema,
  PayloadChannelSchema,
  PayloadEnvelopeSchema,
  PreparedGraphCommitSchema,
  ProviderCapabilitySchema,
  RecipeManifestSchema,
  applicationCommandNames,
  applicationCommandPayloadSchemas,
  applicationContractRegistry,
  applicationEventNames,
  applicationEventPayloadSchemas,
  applicationQueryNames,
  applicationQueryPayloadSchemas,
  applicationRequestNames,
  applicationResponsePayloadSchemas,
  canonicalNodeDefinitionIds,
  connectionRoles,
  parseApplicationMessage,
  parseEtherGraph,
  parseExecutionPlan,
  parseGraphTransaction,
  parseRecipeManifest,
  payloadChannels
} from "@ether/schema";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { EtherNode, NodeDefinition, PromptTextConfig } from "@ether/schema";

const workspaceRoot = fileURLToPath(new URL("../../..", import.meta.url));

const nodeConfigs = {
  "prompt.text": {
    kind: "prompt.text",
    body: "Photograph the product on a clean studio set.",
    assembly: "append"
  },
  "prompt.worker": {
    kind: "prompt.worker",
    behavior: "rewrite",
    instruction: "Make the direction more precise.",
    profile: "balanced",
    model: "gpt-5",
    reasoningEffort: "medium",
    variation: 0.3,
    contextPolicy: {
      includeUpstream: true,
      includeDownstreamCapabilities: true,
      maxTokens: 8_000
    },
    memoryPolicy: { mode: "stateless" },
    outputContract: {
      channel: "text",
      count: 1,
      selectionPolicy: "latest"
    }
  },
  "reference.set": {
    kind: "reference.set",
    artifactIds: ["artifact-reference"],
    enabledChannels: ["image"],
    ordering: "manual"
  },
  "generation.image": {
    kind: "generation.image",
    providerId: "codex",
    profileId: "image-default",
    aspectRatio: "1:1",
    resolution: { width: 1024, height: 1024 },
    outputCount: 1
  },
  "edit.image": {
    kind: "edit.image",
    providerId: "codex",
    profileId: "image-edit",
    strength: 0.75,
    outputCount: 1
  },
  "edit.mask": {
    kind: "edit.mask",
    mode: "manual",
    feather: 0
  },
  "edit.transform": {
    kind: "edit.transform",
    operation: "resize",
    width: 1024,
    height: 1024,
    preserveAspectRatio: true
  },
  "review.compare": {
    kind: "review.compare",
    selectionMode: "one",
    minimumSelections: 1
  },
  "review.evaluate": {
    kind: "review.evaluate",
    instruction: "Score fidelity and composition.",
    rubric: [{ id: "fidelity", label: "Fidelity", weight: 1 }],
    profile: "balanced",
    model: "gpt-5",
    reasoningEffort: "medium"
  },
  "review.filter": {
    kind: "review.filter",
    match: "all",
    rules: [{ id: "passing", field: "score", operator: "gte", value: 0.8 }],
    routes: [{ id: "accept", label: "Accept", outcome: "matched" }]
  },
  "flow.variables": {
    kind: "flow.variables",
    variables: [{ name: "season", value: "spring" }]
  },
  "flow.batch": {
    kind: "flow.batch",
    dimensions: [{ id: "angle", name: "Angle", values: ["front", "side"] }],
    parallelism: 1
  },
  "flow.join": {
    kind: "flow.join",
    strategy: "ordered",
    requireComplete: true
  },
  "output.collection": {
    kind: "output.collection",
    collectionId: "collection-primary",
    membershipMode: "add",
    makePrimary: true
  },
  "output.export": {
    kind: "output.export",
    pathGrantId: "grant-export",
    namingTemplate: "{node}-{index}",
    format: "original",
    collisionPolicy: "rename",
    includeMetadata: true
  },
  "canvas.note": {
    kind: "canvas.note",
    body: "Explore a brighter variant.",
    style: "note"
  },
  "canvas.drawing": {
    kind: "canvas.drawing",
    width: 1200,
    height: 800,
    background: "transparent",
    strokes: []
  }
} as const;

const basePresentation = {
  collapsed: false,
  accent: "default",
  previewMode: "summary"
} as const;

function makeNode<TDefinitionId extends keyof typeof nodeConfigs>(
  definitionId: TDefinitionId,
  index: number
) {
  return {
    id: `node-${index}`,
    definitionId,
    title: definitionId,
    position: { x: index * 240, y: 80 },
    size: { width: 220, height: 140 },
    config: nodeConfigs[definitionId],
    presentation: basePresentation
  };
}

const validGraph = {
  id: "graph-root",
  title: "Product campaign",
  kind: "root",
  createdAt: "2026-07-17T08:00:00.000Z",
  updatedAt: "2026-07-17T08:00:00.000Z",
  nodes: [makeNode("prompt.text", 0), makeNode("generation.image", 1)],
  edges: [
    {
      id: "edge-1",
      from: { kind: "node", nodeId: "node-0", channel: "text" },
      to: { kind: "node", nodeId: "node-1", channel: "text" },
      role: "subject",
      order: 0,
      selector: { kind: "latest-approved" },
      adapter: { kind: "auto" },
      enabled: true
    }
  ],
  groups: [
    {
      id: "group-1",
      title: "Inputs",
      nodeIds: ["node-0"],
      position: { x: -20, y: 40 },
      size: { width: 260, height: 200 },
      color: "teal"
    }
  ],
  modules: [],
  viewState: {
    viewport: { x: 0, y: 0, zoom: 1 },
    selectedNodeIds: [],
    selectedEdgeIds: [],
    inspectorTarget: null
  }
} as const;

const validTransaction = {
  id: "transaction-1",
  baseDocumentRevisionId: "document-revision-1",
  baseGraphRevisions: {
    "graph-root": "graph-revision-1",
    "graph-module": "graph-revision-4"
  },
  title: "Add campaign prompt",
  actor: "codex",
  operations: [
    { type: "addNode", graphId: "graph-root", node: makeNode("prompt.text", 3) },
    {
      type: "moveNodes",
      graphId: "graph-root",
      positions: [{ nodeId: "node-3", position: { x: 640, y: 120 } }]
    }
  ],
  layoutPolicy: "tidy-affected"
} as const;

const providerCapability = {
  providerId: "codex",
  profileId: "image-default",
  operation: "generate-image",
  inputChannels: ["text", "image"],
  outputChannels: ["image"],
  aspectRatios: ["1:1", "16:9"],
  resolutions: [{ id: "1k", width: 1024, height: 1024, label: "1K" }],
  maxReferences: 8,
  maxOutputsPerCall: 4,
  supportsCancellation: true,
  supportsSeed: false,
  provenance: "conformance-verified",
  limitations: []
} as const;

const llmCapability = {
  providerId: "codex",
  profileId: "llm-balanced",
  operation: "llm",
  inputChannels: ["text", "image", "data"],
  outputChannels: ["text", "data"],
  aspectRatios: [],
  resolutions: [],
  maxReferences: 8,
  maxOutputsPerCall: 4,
  supportsCancellation: true,
  supportsSeed: false,
  provenance: "runtime-discovered",
  limitations: []
} as const;

const evaluationCapability = {
  ...llmCapability,
  profileId: "evaluation-deep",
  outputChannels: ["text", "data", "image"]
} as const;

describe("Ether 4.0 schema", () => {
  it("publishes runtime-importable package exports from built artifacts", () => {
    const packageJson = JSON.parse(
      readFileSync(`${workspaceRoot}/packages/schema/package.json`, "utf8")
    ) as {
      types: string;
      exports: { ".": { types: string; import: string } };
    };

    expect(packageJson.types).toBe("./dist/index.d.ts");
    expect(packageJson.exports["."]).toEqual({
      types: "./dist/index.d.ts",
      import: "./dist/index.js"
    });
    expect(
      execFileSync(
        process.execPath,
        ["--input-type=module", "--eval", "import('@ether/schema').then(m => console.log(typeof m.parseEtherGraph))"],
        { cwd: `${workspaceRoot}/packages/testing`, encoding: "utf8" }
      ).trim()
    ).toBe("function");
  });

  it("exposes exactly the six canonical payload channels", () => {
    expect(payloadChannels).toEqual(["text", "image", "mask", "data", "video", "audio"]);
    for (const channel of payloadChannels) {
      expect(PayloadChannelSchema.parse(channel)).toBe(channel);
    }
    expect(PayloadChannelSchema.safeParse("file").success).toBe(false);
  });

  it("exposes exactly the fifteen canonical connection roles", () => {
    expect(connectionRoles).toEqual([
      "general",
      "negative",
      "subject",
      "product",
      "face",
      "clothing",
      "pose",
      "setting",
      "composition",
      "style",
      "lighting",
      "colourPalette",
      "typography",
      "motion",
      "timing"
    ]);
    expect(ConnectionRoleSchema.safeParse("colorPalette").success).toBe(false);
    expect(ConnectionRoleSchema.safeParse("assistant").success).toBe(false);
  });

  it("exposes only the seventeen canonical node definition IDs", () => {
    expect(canonicalNodeDefinitionIds).toEqual([
      "prompt.text",
      "prompt.worker",
      "reference.set",
      "generation.image",
      "edit.image",
      "edit.mask",
      "edit.transform",
      "review.compare",
      "review.evaluate",
      "review.filter",
      "flow.variables",
      "flow.batch",
      "flow.join",
      "output.collection",
      "output.export",
      "canvas.note",
      "canvas.drawing"
    ]);

    for (const legacyId of [
      "assistant",
      "assistant.worker",
      "store.directory",
      "output.directory",
      "prompt.subject",
      "prompt.composition",
      "prompt.lighting",
      "grid",
      "character-sheet"
    ]) {
      expect(NodeDefinitionIdSchema.safeParse(legacyId).success).toBe(false);
    }
  });

  it("validates a distinct strict configuration for every canonical node", () => {
    expect(Object.keys(NodeConfigSchemas)).toEqual(canonicalNodeDefinitionIds);

    for (const definitionId of canonicalNodeDefinitionIds) {
      const config = nodeConfigs[definitionId];
      expect(NodeConfigSchemas[definitionId].parse(config)).toEqual(config);
      expect(
        NodeConfigSchemas[definitionId].safeParse({
          ...config,
          runtimeStatus: "running",
          selectedOutput: "output-1",
          providerResponse: { ok: true },
          artifacts: ["artifact-1"]
        }).success
      ).toBe(false);
    }
  });

  it("validates registry definitions and structured connection decisions", () => {
    const subjectConsequence = {
      executorInputField: "positivePrompt",
      assemblyStrategy: "role-section",
      preservationRule: "preserve-lineage",
      requiredAdapterCapability: null,
      failureReason: null
    } as const;
    const definition: NodeDefinition<PromptTextConfig> = {
      id: "prompt.text",
      family: "prompt",
      title: "Prompt",
      description: "Authored text and deterministic assembly.",
      configSchema: NodeConfigSchemas["prompt.text"],
      defaultConfig: () => nodeConfigs["prompt.text"],
      contract: {
        inputs: [
          { id: "text", name: "Text", channel: "text", required: false, multiple: true },
          { id: "data", name: "Data", channel: "data", required: false, multiple: true }
        ],
        outputs: [
          { id: "text", name: "Text", channel: "text", required: false, multiple: true },
          { id: "data", name: "Data", channel: "data", required: false, multiple: true }
        ],
        consequences: {
          text: {
            subject: subjectConsequence
          }
        }
      },
      inspector: {
        sections: [{ id: "content", title: "Content", fields: ["body", "assembly"] }]
      },
      executor: "deterministic-assembly",
      presentation: { width: 220, height: 140, previewMode: "content" }
    };
    const typedDefinition: NodeDefinition<PromptTextConfig> = definition;
    expect(typedDefinition.id).toBe("prompt.text");
    expect(NodeDefinitionSchema.parse(definition)).toEqual(definition);
    expect(NodeDefinitionSchema.safeParse({ ...definition, id: "assistant" }).success).toBe(false);
    expect(
      NodeDefinitionSchema.safeParse({
        ...definition,
        configSchema: NodeConfigSchemas["prompt.worker"]
      }).success
    ).toBe(false);
    expect(() =>
      NodeDefinitionSchema.safeParse({ ...definition, defaultConfig: () => null })
    ).not.toThrow();
    expect(
      NodeDefinitionSchema.safeParse({ ...definition, defaultConfig: () => null }).success
    ).toBe(false);
    expect(
      NodeDefinitionSchema.safeParse({ ...definition, family: "generation" }).success
    ).toBe(true);
    expect(
      NodeDefinitionSchema.safeParse({
        ...definition,
        contract: { ...definition.contract, outputs: [] }
      }).success
    ).toBe(true);
    expect(() =>
      NodeDefinitionSchema.safeParse({
        ...definition,
        defaultConfig: () => {
          throw new Error("default factory failed");
        }
      })
    ).not.toThrow();
    expect(
      NodeDefinitionSchema.safeParse({
        ...definition,
        defaultConfig: () => {
          throw new Error("default factory failed");
        }
      }).success
    ).toBe(false);

    expect(
      ConnectionDecisionSchema.parse({
        allowed: true,
        adapter: null,
        consequences: [subjectConsequence]
      })
    ).toEqual({
      allowed: true,
      adapter: null,
      consequences: [subjectConsequence]
    });
    expect(
      ConnectionDecisionSchema.parse({
        allowed: false,
        code: "UNKNOWN_CHANNEL",
        message: "The source channel is not part of the node contract.",
        remedies: [{ kind: "select-channel", endpoint: "source", channels: ["text", "data"] }]
      })
    ).toMatchObject({ allowed: false, code: "UNKNOWN_CHANNEL" });
  });

  it("round-trips a strict graph and rejects mismatched or legacy node data", () => {
    const typedNode: EtherNode<PromptTextConfig> = makeNode("prompt.text", 0);
    expect(typedNode.config.kind).toBe("prompt.text");
    expect(parseEtherGraph(validGraph)).toEqual(validGraph);

    expect(() =>
      parseEtherGraph({
        ...validGraph,
        nodes: [
          {
            ...validGraph.nodes[0],
            definitionId: "generation.image"
          }
        ]
      })
    ).toThrow(/config|definitionId|generation\.image/);

    expect(() =>
      parseEtherGraph({
        ...validGraph,
        nodes: [
          {
            ...validGraph.nodes[0],
            definitionId: "assistant.worker",
            config: { kind: "assistant.worker", prompt: "legacy" }
          }
        ]
      })
    ).toThrow(/definitionId|Invalid/);

    expect(() => parseEtherGraph({ ...validGraph, directoryStore: "C:/legacy" })).toThrow(
      /Unrecognized key|directoryStore/
    );
  });

  it("validates prepared persistence commits and typed live output settings", () => {
    const commit = {
      id: "prepared-1",
      baseDocumentRevisionId: "document-revision-1",
      baseGraphRevisions: { "graph-root": "graph-revision-1" },
      title: "Persist validated result",
      actor: "user",
      graphSnapshots: [validGraph],
      forwardOperations: [
        { type: "updateGraphProperties", graphId: "graph-root", title: "Product campaign" }
      ],
      inverseOperations: [
        { type: "updateGraphProperties", graphId: "graph-root", title: "Previous title" }
      ]
    } as const;
    expect(PreparedGraphCommitSchema.parse(commit)).toEqual(commit);
    const deletionCommit = {
      ...commit,
      baseGraphRevisions: {
        "graph-root": "graph-revision-1",
        "graph-module": "graph-revision-module"
      },
      deletedGraphIds: ["graph-module"]
    } as const;
    expect(PreparedGraphCommitSchema.parse(deletionCommit)).toEqual(deletionCommit);
    expect(
      PreparedGraphCommitSchema.safeParse({
        ...deletionCommit,
        graphSnapshots: [...deletionCommit.graphSnapshots, { ...validGraph, id: "graph-module" }]
      }).success
    ).toBe(false);
    expect(
      PreparedGraphCommitSchema.safeParse({
        ...commit,
        graphSnapshots: [validGraph, validGraph]
      }).success
    ).toBe(false);
    expect(
      PreparedGraphCommitSchema.safeParse({
        ...commit,
        inverseOperations: [
          ...commit.inverseOperations,
          { type: "updateGraphProperties", graphId: "graph-root", title: "Extra inverse" }
        ]
      }).success
    ).toBe(false);
    expect(
      PreparedGraphCommitSchema.safeParse({
        ...commit,
        forwardOperations: [
          { type: "updateGraphProperties", graphId: "missing", title: "Missing" }
        ]
      }).success
    ).toBe(false);
    expect(
      PreparedGraphCommitSchema.safeParse({
        ...commit,
        graphSnapshots: [
          validGraph,
          { ...validGraph, id: "graph-module", kind: "module", nodes: [] }
        ],
        forwardOperations: commit.forwardOperations,
        inverseOperations: commit.inverseOperations
      }).success
    ).toBe(true);
    expect(
      PreparedGraphCommitSchema.safeParse({
        ...commit,
        graphSnapshots: [
          validGraph,
          { ...validGraph, id: "graph-module", kind: "module", nodes: [] }
        ],
        forwardOperations: [
          ...commit.forwardOperations,
          {
            type: "updateGraphProperties",
            graphId: "graph-module",
            title: "Module"
          }
        ],
        inverseOperations: [
          {
            type: "updateGraphProperties",
            graphId: "graph-module",
            title: "Before module"
          },
          ...commit.inverseOperations
        ]
      }).success
    ).toBe(false);

    const liveOutput = {
      enabled: true,
      pathGrantId: "grant-1",
      namingPolicy: { template: "{node}-{version}" },
      collisionPolicy: "suffix",
      transferPolicy: "copy",
      lastReconciledAt: null
    } as const;
    expect(LiveOutputSettingsSchema.parse(liveOutput)).toEqual(liveOutput);
    expect(
      LiveOutputSettingsSchema.safeParse({ ...liveOutput, pathGrantId: null }).success
    ).toBe(false);
    expect(
      LiveOutputSettingsSchema.safeParse({ ...liveOutput, collisionPolicy: "overwrite" }).success
    ).toBe(false);
  });

  it("validates output selectors, payload envelopes, and immutable output versions", () => {
    expect(OutputSelectorSchema.parse({ kind: "pinned", outputVersionId: "output-v1" })).toEqual({
      kind: "pinned",
      outputVersionId: "output-v1"
    });
    expect(OutputSelectorSchema.safeParse({ kind: "current" }).success).toBe(false);

    const payload = {
      id: "payload-1",
      channel: "image",
      role: "product",
      content: { kind: "artifact", artifactId: "artifact-1" },
      source: {
        nodeId: "node-1",
        outputVersionId: "output-v1",
        edgeId: "edge-1",
        lineageKey: "product-primary"
      },
      metadata: { width: 1024, reviewed: false }
    } as const;
    expect(PayloadEnvelopeSchema.parse(payload)).toEqual(payload);

    const outputVersion = {
      id: "output-v1",
      nodeId: "node-1",
      graphId: "graph-root",
      graphRevisionId: "graph-revision-1",
      inputPayloadIds: ["payload-input"],
      selectedOutputVersionIds: ["output-upstream"],
      compiledContextHash: "sha256:context",
      producer: {
        kind: "provider",
        providerId: "codex",
        modelId: "gpt-image-1",
        profileId: "image-default",
        capabilitySnapshot: providerCapability
      },
      outputPayloadIds: ["payload-1"],
      parentOutputVersionId: null,
      approval: { state: "approved", actor: "user", at: "2026-07-17T08:01:00.000Z" },
      runId: "run-1",
      stepId: "step-1",
      workItemId: "work-1",
      attemptId: "attempt-1",
      timing: { startedAt: "2026-07-17T08:00:00.000Z", completedAt: "2026-07-17T08:01:00.000Z" },
      failure: null,
      createdAt: "2026-07-17T08:01:00.000Z"
    } as const;
    expect(NodeOutputVersionSchema.parse(outputVersion)).toEqual(outputVersion);
    expect(
      NodeOutputVersionSchema.parse({
        ...outputVersion,
        id: "output-llm",
        producer: {
          kind: "provider",
          providerId: "codex",
          modelId: "gpt-5",
          profileId: "llm-balanced",
          capabilitySnapshot: llmCapability
        }
      })
    ).toMatchObject({ id: "output-llm", producer: { modelId: "gpt-5" } });
    expect(
      NodeOutputVersionSchema.parse({
        ...outputVersion,
        id: "output-evaluation",
        producer: {
          kind: "provider",
          providerId: "codex",
          modelId: "gpt-5",
          profileId: "evaluation-deep",
          capabilitySnapshot: evaluationCapability
        }
      })
    ).toMatchObject({ id: "output-evaluation", producer: { profileId: "evaluation-deep" } });
    const { modelId: _modelId, ...producerWithoutModel } = outputVersion.producer;
    expect(
      NodeOutputVersionSchema.safeParse({ ...outputVersion, producer: producerWithoutModel }).success
    ).toBe(false);
    expect(
      NodeOutputVersionSchema.safeParse({
        ...outputVersion,
        producer: { ...outputVersion.producer, profileId: "wrong-profile" }
      }).success
    ).toBe(false);
    expect(
      NodeOutputVersionSchema.safeParse({
        ...outputVersion,
        producer: { kind: "manual", actor: "user" },
        parentOutputVersionId: null
      }).success
    ).toBe(false);
    expect(
      NodeOutputVersionSchema.safeParse({
        ...outputVersion,
        producer: { kind: "manual", actor: "user" },
        parentOutputVersionId: "output-parent"
      }).success
    ).toBe(true);
    expect(NodeOutputVersionSchema.safeParse({ ...outputVersion, providerResponse: {} }).success).toBe(
      false
    );
    expect(
      NodeOutputVersionSchema.safeParse({ ...outputVersion, attemptId: null }).success
    ).toBe(false);
    expect(
      NodeOutputVersionSchema.safeParse({
        ...outputVersion,
        timing: {
          startedAt: "2026-07-17T08:02:00.000Z",
          completedAt: "2026-07-17T08:01:00.000Z"
        }
      }).success
    ).toBe(false);
    expect(
      NodeOutputVersionSchema.safeParse({
        ...outputVersion,
        timing: { ...outputVersion.timing, completedAt: null }
      }).success
    ).toBe(false);
  });

  it("round-trips multi-graph transactions and rejects open operation bodies", () => {
    expect(parseGraphTransaction(validTransaction)).toEqual(validTransaction);
    expect(GraphTransactionSchema.safeParse({ ...validTransaction, actor: "assistant" }).success).toBe(
      false
    );
    expect(
      GraphTransactionSchema.safeParse({
        ...validTransaction,
        operations: [{ ...validTransaction.operations[0], legacyPatch: {} }]
      }).success
    ).toBe(false);

    expect(
      GraphTransactionSchema.safeParse({
        ...validTransaction,
        operations: [
          {
            type: "updateNode",
            graphId: "graph-root",
            nodeId: "node-0",
            node: { ...validGraph.nodes[0], id: "node-replacement" }
          }
        ]
      }).success
    ).toBe(false);
    expect(
      GraphTransactionSchema.safeParse({
        ...validTransaction,
        operations: [
          {
            type: "moveNodes",
            graphId: "graph-root",
            positions: [
              { nodeId: "node-0", position: { x: 1, y: 1 } },
              { nodeId: "node-0", position: { x: 2, y: 2 } }
            ]
          }
        ]
      }).success
    ).toBe(false);
    expect(
      GraphTransactionSchema.safeParse({
        ...validTransaction,
        baseGraphRevisions: {},
        operations: [{ type: "removeNode", graphId: "graph-root", nodeId: "node-0" }]
      }).success
    ).toBe(false);

    const internalGraph = {
      ...validGraph,
      id: "graph-module-new",
      title: "Internal module",
      kind: "module",
      modules: []
    } as const;
    const module = {
      id: "module-new",
      title: "Generation module",
      graphId: internalGraph.id,
      position: { x: 480, y: 80 },
      size: { width: 260, height: 180 },
      interface: { inputs: [], outputs: [], parameters: [] },
      collapsed: false
    } as const;
    const createModuleTransaction = {
      ...validTransaction,
      baseGraphRevisions: { "graph-root": "graph-revision-1" },
      operations: [
        { type: "createModule", graphId: "graph-root", module, subtree: { rootGraphId: internalGraph.id, graphs: [internalGraph] } },
        {
          type: "addNode",
          graphId: internalGraph.id,
          node: { ...makeNode("canvas.note", 8), id: "module-note" }
        }
      ]
    } as const;
    expect(GraphTransactionSchema.parse(createModuleTransaction)).toEqual(createModuleTransaction);
    expect(
      GraphTransactionSchema.safeParse({
        ...createModuleTransaction,
        operations: [
          {
            ...createModuleTransaction.operations[0],
            module: { ...module, graphId: "another-internal-graph" }
          }
        ]
      }).success
    ).toBe(false);
    expect(
      GraphTransactionSchema.safeParse({
        ...createModuleTransaction,
        operations: [
          {
            ...createModuleTransaction.operations[0],
            subtree: { rootGraphId: internalGraph.id, graphs: [{ ...internalGraph, kind: "root" }] }
          }
        ]
      }).success
    ).toBe(false);
    expect(
      GraphTransactionSchema.safeParse({
        ...createModuleTransaction,
        baseGraphRevisions: {
          "graph-root": "graph-revision-1",
          [internalGraph.id]: "impossible-existing-revision"
        }
      }).success
    ).toBe(false);
  });

  it("validates document identity, artifacts, and collections without directory-store state", () => {
    const header = {
      documentId: "document-1",
      formatMarker: "ETHERDOC",
      formatVersion: "4.0.0",
      schemaVersion: 40000,
      title: "Campaign",
      createdAt: "2026-07-17T08:00:00.000Z",
      updatedAt: "2026-07-17T08:00:00.000Z",
      appVersion: "4.0.0",
      featureFlags: {}
    } as const;
    expect(DocumentHeaderSchema.parse(header)).toEqual(header);
    expect(DocumentHeaderSchema.safeParse({ ...header, formatMarker: "ETHERPROJECT" }).success).toBe(
      false
    );

    const artifact = {
      id: "artifact-1",
      contentKey: "a".repeat(64),
      channel: "image",
      mediaType: "image/png",
      byteLength: 1024,
      source: { outputVersionId: "output-v1", payloadId: "payload-1" },
      createdAt: "2026-07-17T08:01:00.000Z",
      metadata: { width: 1024, height: 1024 }
    } as const;
    expect(ArtifactSchema.parse(artifact)).toEqual(artifact);
    expect(ArtifactSchema.safeParse({ ...artifact, filePath: "C:/legacy/output.png" }).success).toBe(
      false
    );

    const collection = {
      id: "collection-primary",
      title: "Final selects",
      description: "Approved campaign images",
      primary: true,
      createdAt: "2026-07-17T08:00:00.000Z",
      updatedAt: "2026-07-17T08:01:00.000Z"
    } as const;
    expect(CollectionSchema.parse(collection)).toEqual(collection);
  });

  it("round-trips the immutable execution plan and rejects malformed capabilities", () => {
    expect(ProviderCapabilitySchema.parse(providerCapability)).toEqual(providerCapability);

    const plan = {
      id: "plan-1",
      documentId: "document-1",
      graphId: "graph-root",
      graphRevisionId: "graph-revision-1",
      scope: { kind: "selected", nodeIds: ["node-1"] },
      steps: [
        {
          id: "step-1",
          nodeId: "node-1",
          executor: "image-provider",
          dependencyStepIds: [],
          inputPayloadIds: ["payload-input"],
          workItemIds: ["work-1"]
        }
      ],
      workItems: [
        {
          id: "work-1",
          stepId: "step-1",
          ordinal: 0,
          inputs: [{ name: "prompt", payloadId: "payload-input" }],
          parameters: [{ name: "outputCount", value: 1 }]
        }
      ],
      providerCapabilitySnapshots: [providerCapability],
      estimatedCalls: 1,
      warnings: [],
      contentHash: "sha256:plan"
    } as const;

    expect(parseExecutionPlan(plan)).toEqual(plan);
    expect(ExecutionPlanSchema.safeParse({ ...plan, contentHash: "" }).success).toBe(false);
    expect(
      ExecutionPlanSchema.safeParse({
        ...plan,
        workItems: [{ ...plan.workItems[0], parameters: { outputCount: 1 } }]
      }).success
    ).toBe(false);
    expect(
      ExecutionPlanSchema.safeParse({
        ...plan,
        providerCapabilitySnapshots: [{ ...providerCapability, inputChannels: ["file"] }]
      }).success
    ).toBe(false);
  });

  it("enforces execution lifecycle and immutable output provenance matrices", () => {
    const queuedJob = {
      id: "job-1",
      planId: "plan-1",
      planContentHash: "sha256:plan",
      status: "queued",
      createdAt: "2026-07-17T08:00:00.000Z",
      startedAt: null,
      completedAt: null,
      cancellationRequestedAt: null
    } as const;
    expect(ExecutionJobSchema.parse(queuedJob)).toEqual(queuedJob);
    expect(
      ExecutionJobSchema.safeParse({
        ...queuedJob,
        status: "completed",
        startedAt: "2026-07-17T08:01:00.000Z",
        completedAt: "2026-07-17T08:02:00.000Z"
      }).success
    ).toBe(true);
    expect(
      ExecutionJobSchema.safeParse({ ...queuedJob, completedAt: "2026-07-17T08:02:00.000Z" })
        .success
    ).toBe(false);
    expect(
      ExecutionJobSchema.safeParse({
        ...queuedJob,
        status: "completed",
        startedAt: "2026-07-17T08:03:00.000Z",
        completedAt: "2026-07-17T08:02:00.000Z"
      }).success
    ).toBe(false);
    const cancelledJob = {
      ...queuedJob,
      status: "cancelled",
      completedAt: "2026-07-17T08:02:00.000Z",
      cancellationRequestedAt: "2026-07-17T08:01:00.000Z"
    } as const;
    expect(ExecutionJobSchema.safeParse(cancelledJob).success).toBe(true);
    expect(
      ExecutionJobSchema.safeParse({
        ...cancelledJob,
        completedAt: "2026-07-17T07:59:00.000Z"
      }).success
    ).toBe(false);
    expect(
      ExecutionJobSchema.safeParse({
        ...cancelledJob,
        cancellationRequestedAt: "2026-07-17T07:59:00.000Z"
      }).success
    ).toBe(false);

    const queuedWorkItem = {
      id: "work-1",
      jobId: "job-1",
      plannedWorkItemId: "planned-work-1",
      status: "queued",
      acceptedAttemptId: null,
      createdAt: "2026-07-17T08:00:00.000Z",
      updatedAt: "2026-07-17T08:00:00.000Z"
    } as const;
    expect(ExecutionWorkItemSchema.parse(queuedWorkItem)).toEqual(queuedWorkItem);
    expect(
      ExecutionWorkItemSchema.safeParse({
        ...queuedWorkItem,
        status: "accepted",
        acceptedAttemptId: null
      }).success
    ).toBe(false);

    const queuedAttempt = {
      id: "attempt-1",
      workItemId: "work-1",
      ordinal: 1,
      status: "queued",
      providerRunId: null,
      outputVersionIds: [],
      failure: null,
      createdAt: "2026-07-17T08:00:00.000Z",
      startedAt: null,
      completedAt: null
    } as const;
    expect(ExecutionAttemptSchema.parse(queuedAttempt)).toEqual(queuedAttempt);
    expect(
      ExecutionAttemptSchema.safeParse({
        ...queuedAttempt,
        status: "accepted",
        startedAt: "2026-07-17T08:01:00.000Z",
        completedAt: "2026-07-17T08:02:00.000Z",
        outputVersionIds: ["output-1"],
        failure: { code: "FAILED", message: "No", retryable: false, details: {} }
      }).success
    ).toBe(false);
    expect(
      ExecutionAttemptSchema.safeParse({
        ...queuedAttempt,
        status: "failed",
        startedAt: "2026-07-17T08:01:00.000Z",
        completedAt: "2026-07-17T08:02:00.000Z"
      }).success
    ).toBe(false);
    expect(
      ExecutionAttemptSchema.safeParse({
        ...queuedAttempt,
        status: "failed",
        startedAt: "2026-07-17T08:01:00.000Z",
        completedAt: "2026-07-17T08:02:00.000Z",
        failure: { code: "PROVIDER_ERROR", message: "Failed", retryable: true, details: {} }
      }).success
    ).toBe(true);
    expect(
      ExecutionAttemptSchema.safeParse({
        ...queuedAttempt,
        status: "cancelled",
        completedAt: "2026-07-17T07:59:00.000Z"
      }).success
    ).toBe(false);
  });

  it("round-trips strict recipe manifests and rejects permissive blueprints", () => {
    const recipe = {
      id: "prompt-to-image",
      version: "1.0.0",
      title: "Prompt to Image",
      description: "Generate an image from authored direction.",
      parameters: [
        {
          id: "prompt",
          type: "string",
          title: "Prompt",
          description: "Primary image direction",
          required: true,
          defaultValue: "Studio product photograph",
          minLength: 1,
          maxLength: 2_000
        }
      ],
      graph: {
        graphRef: "recipe-root",
        title: "Prompt to Image",
        kind: "root",
        nodes: [makeNode("prompt.text", 0), makeNode("generation.image", 1)],
        edges: validGraph.edges,
        groups: [],
        modules: [],
        viewState: validGraph.viewState
      },
      moduleGraphs: [],
      capabilityRequirements: [
        {
          id: "image-generation",
          operation: "generate-image",
          inputChannels: ["text"],
          outputChannels: ["image"],
          minimumReferences: 0,
          minimumOutputs: 1,
          supportsCancellation: true,
          supportsSeed: false
        }
      ],
      substitutions: [
        {
          requirementId: "image-generation",
          providerId: "codex",
          profileId: "image-default",
          priority: 0,
          capability: providerCapability,
          parameterBindings: [
            {
              parameterId: "prompt",
              target: { graphRef: "recipe-root", nodeRef: "node-0", configPath: ["body"] }
            }
          ]
        }
      ],
      layout: {
        policy: "tidy-affected",
        direction: "horizontal",
        spacing: { x: 80, y: 60 },
        focusNodeRef: "node-0"
      },
      checkpoints: [
        {
          id: "select-image",
          graphRef: "recipe-root",
          nodeRef: "node-1",
          title: "Select an image",
          policy: "approve-one",
          required: true,
          minimumApprovals: 1
        }
      ],
      expectedWork: { minimumCalls: 1, maximumCalls: 1, minimumWorkItems: 1, maximumWorkItems: 4 },
      acceptanceScenario: {
        id: "prompt-to-image-happy-path",
        steps: [
          {
            kind: "success",
            requirementId: "image-generation",
            latencyMs: 0,
            outputs: [
              {
                graphRef: "recipe-root",
                nodeRef: "node-1",
                channel: "image",
                fixtureId: "image-square",
                mediaType: "image/png"
              }
            ]
          }
        ]
      }
    } as const;

    const blueprintWithModule = {
      ...recipe.graph,
      modules: [
        {
          id: "module-1",
          title: "Generation module",
          graphId: "recipe-module",
          position: { x: 480, y: 80 },
          size: { width: 260, height: 180 },
          interface: {
            inputs: [
              {
                id: "prompt-input",
                name: "Prompt",
                channel: "text",
                internalNodeId: "node-0",
                internalChannel: "text",
                required: true
              }
            ],
            outputs: [
              {
                id: "image-output",
                name: "Image",
                channel: "image",
                internalNodeId: "node-1",
                internalChannel: "image",
                required: true
              }
            ],
            parameters: [
              {
                id: "prompt-parameter",
                name: "Prompt",
                nodeId: "node-0",
                configPath: ["body"],
                required: true
              }
            ]
          },
          collapsed: false
        }
      ]
    } as const;

    const moduleGraph = {
      graphRef: "recipe-module",
      title: "Generation module internals",
      kind: "module",
      nodes: [makeNode("prompt.text", 0), makeNode("generation.image", 1)],
      edges: validGraph.edges,
      groups: [],
      modules: [],
      viewState: validGraph.viewState
    } as const;

    const recipeWithModule = {
      ...recipe,
      graph: blueprintWithModule,
      moduleGraphs: [moduleGraph]
    } as const;

    expect(GraphBlueprintSchema.parse(recipe.graph)).toEqual(recipe.graph);
    expect(GraphBlueprintSchema.parse(blueprintWithModule)).toEqual(blueprintWithModule);
    expect(parseRecipeManifest(recipe)).toEqual(recipe);
    expect(parseRecipeManifest(recipeWithModule)).toEqual(recipeWithModule);
    expect(RecipeManifestSchema.safeParse({ ...recipe, legacyDirectory: "C:/project" }).success).toBe(
      false
    );
    expect(
      RecipeManifestSchema.safeParse({
        ...recipe,
        graph: { ...recipe.graph, legacyDirectory: "C:/project" }
      }).success
    ).toBe(false);
    expect(
      RecipeManifestSchema.safeParse({
        ...recipe,
        parameters: [
          {
            id: "assembly",
            type: "string",
            title: "Assembly",
            description: "Prompt assembly mode",
            required: true,
            defaultValue: "append",
            minLength: 1,
            maxLength: 20
          }
        ],
        substitutions: [
          {
            ...recipe.substitutions[0],
            parameterBindings: [
              {
                parameterId: "assembly",
                target: {
                  graphRef: "recipe-root",
                  nodeRef: "node-0",
                  configPath: ["assembly"]
                }
              }
            ]
          }
        ]
      }).success
    ).toBe(true);
    expect(
      RecipeManifestSchema.safeParse({
        ...recipe,
        parameters: [
          {
            id: "count",
            type: "number",
            title: "Count",
            description: "Generated image count",
            required: true,
            defaultValue: 1,
            minimum: 0.5,
            maximum: 4,
            step: 0.5
          }
        ],
        substitutions: [
          {
            ...recipe.substitutions[0],
            parameterBindings: [
              {
                parameterId: "count",
                target: {
                  graphRef: "recipe-root",
                  nodeRef: "node-1",
                  configPath: ["outputCount"]
                }
              }
            ]
          }
        ]
      }).success
    ).toBe(true);
    expect(
      RecipeManifestSchema.safeParse({
        ...recipe,
        parameters: [
          {
            id: "count",
            type: "number",
            title: "Count",
            description: "Generated image count",
            required: true,
            defaultValue: 1,
            minimum: 0,
            maximum: 4,
            step: 1
          }
        ],
        substitutions: [
          {
            ...recipe.substitutions[0],
            parameterBindings: [
              {
                parameterId: "count",
                target: {
                  graphRef: "recipe-root",
                  nodeRef: "node-1",
                  configPath: ["outputCount"]
                }
              }
            ]
          }
        ]
      }).success
    ).toBe(true);
    expect(
      RecipeManifestSchema.safeParse({
        ...recipe,
        parameters: [
          {
            id: "assembly",
            type: "choice",
            title: "Assembly",
            description: "Prompt assembly mode",
            required: true,
            options: [
              { id: "append", label: "Append", value: "append" },
              { id: "legacy", label: "Legacy", value: "legacy" }
            ],
            defaultOptionId: "append"
          }
        ],
        substitutions: [
          {
            ...recipe.substitutions[0],
            parameterBindings: [
              {
                parameterId: "assembly",
                target: {
                  graphRef: "recipe-root",
                  nodeRef: "node-0",
                  configPath: ["assembly"]
                }
              }
            ]
          }
        ]
      }).success
    ).toBe(true);
    expect(
      RecipeManifestSchema.safeParse({
        ...recipe,
        parameters: [
          {
            id: "count",
            type: "number",
            title: "Count",
            description: "Generated image count",
            required: true,
            defaultValue: 2,
            minimum: 1,
            maximum: 4,
            step: 1
          }
        ],
        substitutions: [
          {
            ...recipe.substitutions[0],
            parameterBindings: [
              {
                parameterId: "count",
                target: {
                  graphRef: "recipe-root",
                  nodeRef: "node-1",
                  configPath: ["outputCount"]
                }
              }
            ]
          }
        ]
      }).success
    ).toBe(true);
    expect(
      RecipeManifestSchema.safeParse({
        ...recipe,
        parameters: [
          {
            id: "style",
            type: "choice",
            title: "Style",
            description: "Prompt style",
            required: true,
            options: [
              { id: "clean", label: "Clean", value: "clean" },
              { id: "editorial", label: "Editorial", value: "editorial" }
            ],
            defaultOptionId: "clean"
          }
        ],
        substitutions: [
          {
            ...recipe.substitutions[0],
            parameterBindings: [
              {
                parameterId: "style",
                target: { graphRef: "recipe-root", nodeRef: "node-0", configPath: ["body"] }
              }
            ]
          }
        ]
      }).success
    ).toBe(true);
    expect(
      GraphBlueprintSchema.safeParse({
        ...recipe.graph,
        nodes: [recipe.graph.nodes[0], { ...recipe.graph.nodes[1], id: "node-0" }]
      }).success
    ).toBe(false);
    expect(
      GraphBlueprintSchema.safeParse({
        ...recipe.graph,
        groups: [
          {
            id: "group-duplicate-members",
            title: "Duplicate members",
            nodeIds: ["node-0", "node-0"],
            position: { x: 0, y: 0 },
            size: { width: 100, height: 100 },
            color: "teal"
          }
        ]
      }).success
    ).toBe(false);
    expect(
      GraphBlueprintSchema.safeParse({
        ...recipe.graph,
        edges: [recipe.graph.edges[0], { ...recipe.graph.edges[0] }]
      }).success
    ).toBe(false);
    expect(
      GraphBlueprintSchema.safeParse({
        ...recipe.graph,
        edges: [
          {
            ...recipe.graph.edges[0],
            to: { kind: "node", nodeId: "missing-node", channel: "text" }
          }
        ]
      }).success
    ).toBe(false);
    expect(
      GraphBlueprintSchema.safeParse({
        ...blueprintWithModule,
        modules: [{ ...blueprintWithModule.modules[0], graphId: blueprintWithModule.graphRef }]
      }).success
    ).toBe(false);
    expect(
      RecipeManifestSchema.safeParse({ ...recipeWithModule, moduleGraphs: [] }).success
    ).toBe(false);
    expect(
      RecipeManifestSchema.safeParse({
        ...recipeWithModule,
        graph: {
          ...blueprintWithModule,
          modules: [
            {
              ...blueprintWithModule.modules[0],
              interface: {
                ...blueprintWithModule.modules[0].interface,
                inputs: [
                  {
                    ...blueprintWithModule.modules[0].interface.inputs[0],
                    internalNodeId: "missing-node"
                  }
                ]
              }
            }
          ]
        }
      }).success
    ).toBe(false);
    expect(
      RecipeManifestSchema.safeParse({
        ...recipeWithModule,
        graph: {
          ...blueprintWithModule,
          modules: [
            {
              ...blueprintWithModule.modules[0],
              interface: {
                ...blueprintWithModule.modules[0].interface,
                outputs: [
                  {
                    ...blueprintWithModule.modules[0].interface.outputs[0],
                    internalChannel: "audio"
                  }
                ]
              }
            }
          ]
        }
      }).success
    ).toBe(true);
    expect(
      RecipeManifestSchema.safeParse({
        ...recipeWithModule,
        graph: {
          ...blueprintWithModule,
          modules: [
            {
              ...blueprintWithModule.modules[0],
              interface: {
                ...blueprintWithModule.modules[0].interface,
                parameters: [
                  {
                    ...blueprintWithModule.modules[0].interface.parameters[0],
                    configPath: ["missing"]
                  }
                ]
              }
            }
          ]
        }
      }).success
    ).toBe(false);
    expect(
      RecipeManifestSchema.safeParse({
        ...recipe,
        graph: {
          ...recipe.graph,
          edges: [
            {
              ...recipe.graph.edges[0],
              from: { kind: "node", nodeId: "missing-node", channel: "text" }
            }
          ]
        }
      }).success
    ).toBe(false);
    expect(
      RecipeManifestSchema.safeParse({
        ...recipe,
        parameters: [
          {
            id: "enabled",
            type: "boolean",
            title: "Enabled",
            description: "Whether prompt text is enabled",
            required: true,
            defaultValue: true
          }
        ],
        substitutions: [
          {
            ...recipe.substitutions[0],
            parameterBindings: [
              {
                parameterId: "enabled",
                target: { graphRef: "recipe-root", nodeRef: "node-0", configPath: ["body"] }
              }
            ]
          }
        ]
      }).success
    ).toBe(true);
    expect(
      RecipeManifestSchema.safeParse({
        ...recipe,
        parameters: [
          {
            id: "style",
            type: "choice",
            title: "Style",
            description: "Prompt style",
            required: true,
            options: [
              { id: "clean", label: "Clean", value: "clean" },
              { id: "enabled", label: "Enabled", value: true }
            ],
            defaultOptionId: "clean"
          }
        ],
        substitutions: [
          {
            ...recipe.substitutions[0],
            parameterBindings: [
              {
                parameterId: "style",
                target: { graphRef: "recipe-root", nodeRef: "node-0", configPath: ["body"] }
              }
            ]
          }
        ]
      }).success
    ).toBe(true);
    expect(
      RecipeManifestSchema.safeParse({
        ...recipe,
        acceptanceScenario: {
          ...recipe.acceptanceScenario,
          steps: [{ ...recipe.acceptanceScenario.steps[0], outputs: [] }]
        }
      }).success
    ).toBe(false);
    expect(
      RecipeManifestSchema.safeParse({
        ...recipe,
        graph: {
          ...recipe.graph,
          nodes: [
            {
              ...recipe.graph.nodes[0],
              definitionId: "assistant.worker",
              config: { kind: "assistant.worker", prompt: "legacy" }
            }
          ]
        }
      }).success
    ).toBe(false);
    expect(
      RecipeManifestSchema.safeParse({
        ...recipe,
        parameters: [{ ...recipe.parameters[0], defaultValue: 42 }]
      }).success
    ).toBe(false);
    expect(
      RecipeManifestSchema.safeParse({
        ...recipe,
        parameters: [
          {
            id: "style",
            type: "choice",
            title: "Style",
            description: "Image style",
            required: true,
            options: [
              { id: "clean", label: "Clean", value: "clean" },
              { id: "clean", label: "Editorial", value: "editorial" }
            ],
            defaultOptionId: "clean"
          }
        ],
        substitutions: []
      }).success
    ).toBe(false);
    expect(
      RecipeManifestSchema.safeParse({
        ...recipe,
        substitutions: [
          {
            ...recipe.substitutions[0],
            parameterBindings: [
              {
                parameterId: "prompt",
                target: { graphRef: "recipe-root", nodeRef: "node-0", configPath: ["missing"] }
              }
            ]
          }
        ]
      }).success
    ).toBe(false);
    expect(
      RecipeManifestSchema.safeParse({
        ...recipe,
        substitutions: [
          {
            ...recipe.substitutions[0],
            capability: { ...providerCapability, outputChannels: ["text"] }
          }
        ]
      }).success
    ).toBe(false);
    expect(
      RecipeManifestSchema.safeParse({
        ...recipe,
        acceptanceScenario: {
          ...recipe.acceptanceScenario,
          steps: [
            {
              ...recipe.acceptanceScenario.steps[0],
              outputs: [
                {
                  ...recipe.acceptanceScenario.steps[0].outputs[0],
                  channel: "audio"
                }
              ]
            }
          ]
        }
      }).success
    ).toBe(true);
    expect(
      RecipeManifestSchema.safeParse({
        ...recipe,
        capabilityRequirements: [{ ...recipe.capabilityRequirements[0], operation: "assistant" }]
      }).success
    ).toBe(false);
    expect(
      RecipeManifestSchema.safeParse({
        ...recipe,
        acceptanceScenario: {
          ...recipe.acceptanceScenario,
          steps: [{ kind: "failure", requirementId: "image-generation", latencyMs: 0 }]
        }
      }).success
    ).toBe(false);
  });

  it("parses strict application command, query, event, and error envelopes", () => {
    expect(Object.keys(applicationCommandPayloadSchemas)).toEqual(applicationCommandNames);
    expect(Object.keys(applicationQueryPayloadSchemas)).toEqual(applicationQueryNames);
    expect(Object.keys(applicationEventPayloadSchemas)).toEqual(applicationEventNames);
    expect(Object.keys(applicationResponsePayloadSchemas)).toEqual(applicationRequestNames);
    expect(
      applicationContractRegistry.filter((entry) => entry.kind === "command").map((entry) => entry.name)
    ).toEqual(applicationCommandNames);
    expect(
      applicationContractRegistry.filter((entry) => entry.kind === "query").map((entry) => entry.name)
    ).toEqual(applicationQueryNames);
    expect(
      applicationContractRegistry.filter((entry) => entry.kind === "event").map((entry) => entry.name)
    ).toEqual(applicationEventNames);
    expect(ApplicationCommandSchema.options.map((option) => option.shape.name.value)).toEqual(
      applicationCommandNames
    );
    expect(ApplicationQuerySchema.options.map((option) => option.shape.name.value)).toEqual(
      applicationQueryNames
    );
    expect(ApplicationEventSchema.options.map((option) => option.shape.name.value)).toEqual(
      applicationEventNames
    );
    expect([
      ...ApplicationCommandResponseSchema.options.map((option) => option.shape.name.value),
      ...ApplicationQueryResponseSchema.options.map((option) => option.shape.name.value)
    ]).toEqual(applicationRequestNames);
    expect(new Set(applicationContractRegistry.map((entry) => `${entry.kind}:${entry.name}`)).size).toBe(
      applicationContractRegistry.length
    );

    const messages = [
      {
        kind: "command",
        id: "message-1",
        correlationId: "correlation-1",
        name: "graph.applyTransaction",
        documentId: "document-1",
        payload: {
          transaction: validTransaction
        }
      },
      {
        kind: "query",
        id: "message-2",
        correlationId: "correlation-2",
        name: "graph.snapshot",
        documentId: "document-1",
        payload: { graphId: "graph-root" }
      },
      {
        kind: "event",
        id: "message-3",
        correlationId: "correlation-1",
        name: "graph.revisionChanged",
        documentId: "document-1",
        occurredAt: "2026-07-17T08:01:00.000Z",
        payload: { graphId: "graph-root", revisionId: "graph-revision-2" }
      },
      {
        kind: "response",
        id: "message-4",
        correlationId: "correlation-1",
        requestId: "message-1",
        name: "graph.applyTransaction",
        documentId: "document-1",
        payload: {
          kind: "revision",
          documentRevisionId: "document-revision-2",
          graphRevisions: [{ graphId: "graph-root", revisionId: "graph-revision-2" }]
        }
      },
      {
        kind: "response",
        id: "message-save-response",
        correlationId: "correlation-save",
        requestId: "message-save",
        name: "document.save",
        documentId: "document-1",
        payload: { kind: "acknowledgement", accepted: true }
      },
      {
        kind: "response",
        id: "message-snapshot-response",
        correlationId: "correlation-snapshot",
        requestId: "message-snapshot",
        name: "graph.snapshot",
        documentId: "document-1",
        payload: { graph: validGraph }
      },
      {
        kind: "error",
        id: "message-5",
        correlationId: "correlation-1",
        requestId: "message-1",
        error: {
          code: "GRAPH_CONFLICT",
          category: "graph",
          message: "The graph changed after this transaction was prepared.",
          userAction: "Preview the transaction against the latest revision.",
          retryable: true,
          details: { graphId: "graph-root" },
          causeId: "cause-1"
        }
      }
    ] as const;

    for (const message of messages) {
      expect(parseApplicationMessage(message)).toEqual(message);
      expect(ApplicationMessageSchema.safeParse({ ...message, legacyDirectory: "C:/project" }).success).toBe(
        false
      );
    }

    expect(() =>
      parseApplicationMessage({
        kind: "command",
        id: "legacy",
        correlationId: "legacy",
        name: "assistant.run",
        payload: {}
      })
    ).toThrow(/name|Invalid/);
    expect(() => parseApplicationMessage({ kind: "command", name: "run.start" })).toThrow(
      /id|correlationId|payload/
    );
    expect(() =>
      parseApplicationMessage({
        kind: "command",
        id: "mismatch",
        correlationId: "mismatch",
        name: "document.save",
        payload: { transaction: validTransaction }
      })
    ).toThrow(/payload|Unrecognized key/);
    expect(() =>
      parseApplicationMessage({
        kind: "query",
        id: "mismatch-query",
        correlationId: "mismatch-query",
        name: "graph.snapshot",
        payload: { jobId: "job-1" }
      })
    ).toThrow(/payload|graphId/);
    expect(() =>
      parseApplicationMessage({
        kind: "event",
        id: "legacy-event",
        correlationId: "legacy-event",
        name: "graph.revisionChanged",
        occurredAt: "2026-07-17T08:01:00.000Z",
        payload: {
          graphId: "graph-root",
          revisionId: "graph-revision-2",
          assistant: { legacyDirectory: "C:/project" }
        }
      })
    ).toThrow(/payload|assistant|Unrecognized key/);
    expect(() =>
      parseApplicationMessage({
        kind: "command",
        id: "legacy-transaction",
        correlationId: "legacy-transaction",
        name: "graph.applyTransaction",
        payload: {
          transaction: {
            ...validTransaction,
            operations: [
              {
                type: "addNode",
                graphId: "graph-root",
                node: {
                  ...validGraph.nodes[0],
                  definitionId: "assistant.worker",
                  config: { kind: "assistant.worker", legacyDirectory: "C:/project" }
                }
              }
            ]
          }
        }
      })
    ).toThrow(/definitionId|config|Invalid/);
    expect(() =>
      parseApplicationMessage({
        kind: "response",
        id: "uncorrelated-response",
        correlationId: "correlation-1",
        name: "graph.applyTransaction",
        payload: { kind: "acknowledgement", accepted: true }
      })
    ).toThrow(/requestId/);
    expect(() =>
      parseApplicationMessage({
        kind: "error",
        id: "uncorrelated-error",
        correlationId: "correlation-1",
        error: {
          code: "GRAPH_CONFLICT",
          category: "graph",
          message: "Conflict",
          retryable: true
        }
      })
    ).toThrow(/requestId/);
    expect(() =>
      parseApplicationMessage({
        kind: "response",
        id: "mismatched-snapshot-response",
        correlationId: "correlation-snapshot",
        requestId: "message-snapshot",
        name: "graph.snapshot",
        payload: { kind: "acknowledgement", accepted: true }
      })
    ).toThrow(/payload|graph/);
    const diagnosticMessage = {
      kind: "error",
      id: "diagnostic-error",
      correlationId: "correlation-1",
      requestId: "message-1",
      error: {
        code: "VALIDATION_FAILED",
        category: "validation",
        message: "Invalid payload",
        retryable: false,
        details: { context: { assistant: { legacyDirectory: "C:/project" } } }
      }
    } as const;
    expect(parseApplicationMessage(diagnosticMessage)).toEqual(diagnosticMessage);

    expect(
      ApplicationMessageSchema.safeParse({
        kind: "command",
        id: "missing-document",
        correlationId: "missing-document",
        name: "graph.applyTransaction",
        payload: { transaction: validTransaction }
      }).success
    ).toBe(false);
    expect(
      ApplicationMessageSchema.safeParse({
        kind: "command",
        id: "global-with-document",
        correlationId: "global-with-document",
        name: "provider.refresh",
        documentId: "document-1",
        payload: {}
      }).success
    ).toBe(false);
    expect(
      ApplicationMessageSchema.safeParse({
        kind: "query",
        id: "snapshot-without-document",
        correlationId: "snapshot-without-document",
        name: "graph.snapshot",
        payload: { graphId: "graph-root" }
      }).success
    ).toBe(false);
    expect(
      ApplicationMessageSchema.safeParse({
        kind: "response",
        id: "snapshot-response-without-document",
        correlationId: "snapshot-response-without-document",
        requestId: "snapshot-without-document",
        name: "graph.snapshot",
        payload: { graph: validGraph }
      }).success
    ).toBe(false);
    expect(
      ApplicationMessageSchema.safeParse({
        kind: "event",
        id: "global-event-with-document",
        correlationId: "global-event-with-document",
        name: "provider.healthChanged",
        documentId: "document-1",
        occurredAt: "2026-07-17T08:01:00.000Z",
        payload: {
          providerId: "codex",
          status: "available",
          message: null
        }
      }).success
    ).toBe(false);
  });
});
