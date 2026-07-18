import type {
  ConnectionRole,
  DownstreamCapabilitySummary,
  EtherGraph,
  JsonObject,
  NodeOutputVersion,
  PayloadChannel,
  PayloadEnvelope,
  PromptWorkerConfig,
  WorkerRequest
} from "@ether/schema";
import { assembleExecutorContext, validateConnection } from "@ether/graph-kernel";

import { behaviorInstructions, compileBehaviorInstruction } from "./behaviors.js";
import { inspectStructuredOutputSchema, type StructuredOutputSchema } from "./outputValidation.js";
import {
  resolveWorkerProfile,
  WorkerProfileResolutionError,
  type ResolvedWorkerProfile,
  type RuntimeWorkerCatalog
} from "./profiles.js";

export type ContextDiagnostic = {
  code: string;
  message: string;
  blocking: boolean;
  details: JsonObject;
};

export type ContextManifestInput = {
  edgeId: string;
  role: ConnectionRole;
  order: number;
  caption: string;
  lineageKey: string;
  payloadId: string;
  outputVersionId: string;
  channel: PayloadChannel;
  included: boolean;
  exclusionCode: "UPSTREAM_DISABLED" | "UNSUPPORTED_CHANNEL" | "MEDIA_REFERENCE_LIMIT" | "TEXT_TOKEN_LIMIT" | null;
  estimatedTextTokens: number;
};

export type ContextManifest = {
  targetNodeId: string;
  authoredInstruction: string;
  behaviorInstructions: readonly string[];
  resolvedProfile: ResolvedWorkerProfile | null;
  lineageKey: string;
  selectedOutputVersionIds: readonly string[];
  inputs: readonly ContextManifestInput[];
  downstream: DownstreamCapabilitySummary | null;
  outputSchemaId: string | null;
  budget: {
    textTokens: { included: number; maximum: number };
    mediaReferences: { included: number; maximum: number };
  };
  diagnostics: readonly ContextDiagnostic[];
  dispatchable: boolean;
};

export type CompileWorkerContextInput = {
  graph: EtherGraph;
  targetNodeId: string;
  versions: readonly NodeOutputVersion[];
  payloads: readonly PayloadEnvelope[];
  runtimeCatalog: RuntimeWorkerCatalog;
  adapterCapabilities: readonly string[];
  downstream: DownstreamCapabilitySummary | null;
  schemaCatalog: readonly StructuredOutputSchema[];
};

export class WorkerContextCompilationError extends Error {
  readonly code: string;
  readonly manifest: ContextManifest;

  constructor(manifest: ContextManifest) {
    const firstBlocking = manifest.diagnostics.find((diagnostic) => diagnostic.blocking);
    super(firstBlocking?.message ?? "Worker context is not dispatchable.");
    this.name = "WorkerContextCompilationError";
    this.code = firstBlocking?.code ?? "CONTEXT_NOT_DISPATCHABLE";
    this.manifest = manifest;
  }
}

const mediaChannels = new Set<PayloadChannel>(["image", "mask", "audio", "video"]);

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
}

function estimatedTextTokens(payload: PayloadEnvelope): number {
  if (payload.content.kind === "text") return Math.ceil(payload.content.value.length / 4);
  if (payload.content.kind === "object") return Math.ceil(stableJson(payload.content.value).length / 4);
  return 0;
}

function targetConfig(graph: EtherGraph, targetNodeId: string): PromptWorkerConfig {
  const target = graph.nodes.find((node) => node.id === targetNodeId);
  if (target === undefined) throw new Error(`Unknown target node: ${targetNodeId}`);
  if (target.definitionId !== "prompt.worker") throw new Error(`Target node is not a prompt.worker: ${targetNodeId}`);
  return target.config;
}

function emptyManifest(targetNodeId: string, config: PromptWorkerConfig): ContextManifest {
  return {
    targetNodeId,
    authoredInstruction: config.instruction,
    behaviorInstructions: behaviorInstructions(config.behavior),
    resolvedProfile: null,
    lineageKey: "",
    selectedOutputVersionIds: [],
    inputs: [],
    downstream: null,
    outputSchemaId: config.outputContract.schemaId ?? null,
    budget: {
      textTokens: { included: 0, maximum: config.contextPolicy.maxTokens },
      mediaReferences: { included: 0, maximum: 0 }
    },
    diagnostics: [],
    dispatchable: false
  };
}

function withDiagnostic(manifest: ContextManifest, diagnostic: ContextDiagnostic): ContextManifest {
  return { ...manifest, diagnostics: [...manifest.diagnostics, diagnostic], dispatchable: false };
}

function throwProfileFailure(manifest: ContextManifest, error: WorkerProfileResolutionError): never {
  throw new WorkerContextCompilationError(withDiagnostic(manifest, {
    code: error.code,
    message: error.message,
    blocking: true,
    details: {}
  }));
}

function versionRanks(versions: readonly NodeOutputVersion[]): Map<string, number> {
  const ordered = [...versions].sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
  return new Map(ordered.map((version, index) => [version.id, index]));
}

function unresolvedConnectionDiagnostic(input: CompileWorkerContextInput): ContextDiagnostic | null {
  const target = input.graph.nodes.find((node) => node.id === input.targetNodeId);
  if (target === undefined) return null;
  const incomingEdges = input.graph.edges.filter((edge) =>
    edge.enabled
    && edge.from.kind === "node"
    && edge.to.kind === "node"
    && edge.to.nodeId === input.targetNodeId
  ).sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));

  for (const edge of incomingEdges) {
    if (edge.from.kind !== "node" || edge.to.kind !== "node") continue;
    const sourceNodeId = edge.from.nodeId;
    const source = input.graph.nodes.find((node) => node.id === sourceNodeId);
    if (source === undefined) continue;
    const decision = validateConnection({
      sourceDefinitionId: source.definitionId,
      sourceChannel: edge.from.channel,
      targetDefinitionId: target.definitionId,
      targetChannel: edge.to.channel,
      role: edge.role,
      adapter: edge.adapter,
      capabilities: input.adapterCapabilities
    });
    if (decision.allowed) continue;
    const requiredCapability = decision.remedies.find((remedy) => remedy.kind === "enable-capability")?.capability;
    return {
      code: decision.code,
      message: decision.message,
      blocking: true,
      details: {
        edgeId: edge.id,
        ...(requiredCapability === undefined ? {} : { requiredCapability }),
        sourceChannel: edge.from.channel,
        targetChannel: edge.to.channel,
        remedies: decision.remedies
      }
    };
  }
  return null;
}

export function compileWorkerContext(input: CompileWorkerContextInput): {
  request: WorkerRequest;
  manifest: ContextManifest;
} {
  const config = targetConfig(input.graph, input.targetNodeId);
  let manifest = emptyManifest(input.targetNodeId, config);
  let resolvedProfile: ResolvedWorkerProfile;
  try {
    resolvedProfile = resolveWorkerProfile(config, input.runtimeCatalog);
  } catch (error) {
    if (error instanceof WorkerProfileResolutionError) throwProfileFailure(manifest, error);
    throw error;
  }

  manifest = {
    ...manifest,
    resolvedProfile,
    budget: {
      ...manifest.budget,
      mediaReferences: { included: 0, maximum: resolvedProfile.capability.maxReferences }
    }
  };

  const connectionDiagnostic = unresolvedConnectionDiagnostic(input);
  if (connectionDiagnostic !== null) {
    throw new WorkerContextCompilationError(withDiagnostic(manifest, connectionDiagnostic));
  }

  let assembled: ReturnType<typeof assembleExecutorContext>;
  try {
    assembled = assembleExecutorContext({
      graph: input.graph,
      targetNodeId: input.targetNodeId,
      versions: input.versions,
      payloads: input.payloads,
      capabilities: input.adapterCapabilities
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Context assembly failed.";
    throw new WorkerContextCompilationError(withDiagnostic(manifest, {
      code: "CONNECTION_UNRESOLVED",
      message,
      blocking: true,
      details: {}
    }));
  }

  const diagnostics: ContextDiagnostic[] = assembled.diagnostics.map((diagnostic) => ({
    code: diagnostic.code,
    message: diagnostic.message,
    blocking: true,
    details: {
      ...(diagnostic.outputVersionId === undefined ? {} : { outputVersionId: diagnostic.outputVersionId }),
      ...(diagnostic.channel === undefined ? {} : { channel: diagnostic.channel })
    }
  }));
  const ranks = versionRanks(input.versions);
  const orderedInputs = [...assembled.manifest.inputs].sort((left, right) =>
    left.order - right.order
    || left.edgeId.localeCompare(right.edgeId)
    || (ranks.get(left.payload.source.outputVersionId) ?? Number.MAX_SAFE_INTEGER)
      - (ranks.get(right.payload.source.outputVersionId) ?? Number.MAX_SAFE_INTEGER)
    || left.payload.id.localeCompare(right.payload.id)
  );

  let includedTextTokens = 0;
  let includedMediaReferences = 0;
  const includedPayloads: PayloadEnvelope[] = [];
  const manifestInputs: ContextManifestInput[] = [];
  for (const item of orderedInputs) {
    const tokens = estimatedTextTokens(item.payload);
    let exclusionCode: ContextManifestInput["exclusionCode"] = null;
    if (!config.contextPolicy.includeUpstream) {
      exclusionCode = "UPSTREAM_DISABLED";
    } else if (!resolvedProfile.capability.inputChannels.includes(item.payload.channel)) {
      exclusionCode = "UNSUPPORTED_CHANNEL";
    } else if (mediaChannels.has(item.payload.channel)) {
      if (includedMediaReferences >= resolvedProfile.capability.maxReferences) {
        exclusionCode = "MEDIA_REFERENCE_LIMIT";
      }
    } else if (includedTextTokens + tokens > config.contextPolicy.maxTokens) {
      exclusionCode = "TEXT_TOKEN_LIMIT";
    }

    if (exclusionCode === null) {
      includedPayloads.push(item.payload);
      if (mediaChannels.has(item.payload.channel)) includedMediaReferences += 1;
      else includedTextTokens += tokens;
    }
    manifestInputs.push({
      edgeId: item.edgeId,
      role: item.role,
      order: item.order,
      caption: item.caption,
      lineageKey: item.lineageKey,
      payloadId: item.payload.id,
      outputVersionId: item.payload.source.outputVersionId,
      channel: item.payload.channel,
      included: exclusionCode === null,
      exclusionCode,
      estimatedTextTokens: tokens
    });
  }

  if (!resolvedProfile.capability.outputChannels.includes(config.outputContract.channel)) {
    diagnostics.push({
      code: "OUTPUT_CHANNEL_UNSUPPORTED",
      message: `The discovered model capability does not produce ${config.outputContract.channel} output.`,
      blocking: true,
      details: { channel: config.outputContract.channel }
    });
  }
  const schemaId = config.outputContract.schemaId;
  if (schemaId !== undefined) {
    const schema = input.schemaCatalog.find((candidate) => candidate.id === schemaId);
    if (schema === undefined) {
      diagnostics.push({
        code: "UNKNOWN_OUTPUT_SCHEMA",
        message: `Unknown structured output schema: ${schemaId}.`,
        blocking: true,
        details: { schemaId }
      });
    } else {
      const schemaIssue = inspectStructuredOutputSchema(schema);
      if (schemaIssue !== null) {
        diagnostics.push({
          code: schemaIssue.code,
          message: schemaIssue.message,
          blocking: true,
          details: { schemaId, path: schemaIssue.path ?? "$" }
        });
      }
    }
  }

  const downstream = config.contextPolicy.includeDownstreamCapabilities ? input.downstream : null;
  manifest = {
    ...manifest,
    lineageKey: assembled.manifest.lineageKey,
    selectedOutputVersionIds: [...new Set(orderedInputs.map((item) => item.payload.source.outputVersionId))],
    inputs: manifestInputs,
    downstream,
    budget: {
      textTokens: { included: includedTextTokens, maximum: config.contextPolicy.maxTokens },
      mediaReferences: { included: includedMediaReferences, maximum: resolvedProfile.capability.maxReferences }
    },
    diagnostics,
    dispatchable: !diagnostics.some((diagnostic) => diagnostic.blocking)
  };
  if (!manifest.dispatchable) throw new WorkerContextCompilationError(manifest);

  return {
    request: {
      behavior: config.behavior,
      instruction: compileBehaviorInstruction(config.behavior, config.instruction),
      profile: config.profile,
      model: resolvedProfile.model,
      reasoningEffort: resolvedProfile.reasoningEffort,
      variation: config.variation,
      contextPolicy: config.contextPolicy,
      memoryPolicy: config.memoryPolicy,
      outputContract: config.outputContract,
      inputs: includedPayloads,
      downstream
    },
    manifest
  };
}
