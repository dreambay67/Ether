import path from "node:path";

import {
  CODEX_ASSISTANT_PROVIDER_ID
} from "./assistantProvider.js";
import {
  CODEX_VISION_EVALUATION_PROVIDER_ID
} from "./evaluationProvider.js";
import { CODEX_PROVIDER_ID } from "./imageProvider.js";
import { readRequiredPngOutput } from "./imageWorkerProtocol.js";
import { CodexAppServerSessionPool } from "./appServer/sessionPool.js";
import {
  CodexAppServerTurnRunner,
  type CodexTurnImageInput,
  type CodexTurnRunnerResult
} from "./appServer/turnRunner.js";
import {
  CODEX_APP_SERVER_MANIFEST_SHA256,
  CODEX_APP_SERVER_VERSION,
  isRecord,
  type JsonObject
} from "./appServer/protocol.js";
import {
  CodexAppServerRuntime,
  CodexRuntimeUnavailableError,
  type CodexRuntimeHealth
} from "../runtime.js";
import type {
  AssistantProvider,
  AssistantProviderInput,
  GeneratedArtifact,
  GenerationProvider,
  GenerationProviderInput,
  ImageEditProviderInput,
  ProviderAssistantResult,
  ProviderDiagnostic,
  ProviderExecutionContext,
  ProviderGenerationResult,
  VisionEvaluationItemResult,
  VisionEvaluationProvider,
  VisionEvaluationProviderInput,
  VisionEvaluationProviderResult
} from "../types.js";

export type CodexExecFallbackFacets = {
  generation?: GenerationProvider;
  assistant?: AssistantProvider;
  evaluation?: VisionEvaluationProvider;
};

export type CodexAppServerProviderBundleOptions = {
  runtime: CodexAppServerRuntime;
  execFallback?: CodexExecFallbackFacets;
};

export type CodexAppServerProviderBundle = {
  runtime: CodexAppServerRuntime;
  generation: GenerationProvider;
  assistant: AssistantProvider;
  evaluation: VisionEvaluationProvider;
  sessions: CodexAppServerSessionPool;
  clearDocument(documentId: string): void;
  close(): Promise<void>;
};

export function createCodexAppServerProviderBundle(
  options: CodexAppServerProviderBundleOptions
): CodexAppServerProviderBundle {
  const sessions = new CodexAppServerSessionPool(() => ({
    client: options.runtime.getClient(),
    generation: options.runtime.health().generation
  }));
  const runner = new CodexAppServerTurnRunner(() => ({
    client: options.runtime.getClient(),
    generation: options.runtime.health().generation
  }), sessions);
  const route = new CodexProviderRoute(options.runtime, runner, options.execFallback ?? {});
  return {
    runtime: options.runtime,
    generation: new AppServerGenerationProvider(route),
    assistant: new AppServerAssistantProvider(route),
    evaluation: new AppServerEvaluationProvider(route),
    sessions,
    clearDocument: (documentId) => sessions.clearDocument(documentId),
    close: async () => {
      await sessions.close();
      await options.runtime.stop();
    }
  };
}

class CodexProviderRoute {
  constructor(
    readonly runtime: CodexAppServerRuntime,
    readonly runner: CodexAppServerTurnRunner,
    readonly fallback: CodexExecFallbackFacets
  ) {}

  async select<K extends keyof CodexExecFallbackFacets>(facet: K): Promise<CodexExecFallbackFacets[K] | null> {
    try {
      await this.runtime.ensureAvailable();
      return null;
    } catch (error) {
      if (!(error instanceof CodexRuntimeUnavailableError)) throw error;
      if (this.runtime.health().transport !== "exec-fallback") throw error;
      const fallback = this.fallback[facet];
      if (!fallback) throw error;
      return fallback;
    }
  }

  diagnostic(descriptor: ProviderDiagnostic): ProviderDiagnostic {
    const health = this.runtime.health();
    const fallbackAvailable = health.transport === "exec-fallback" && Object.values(this.fallback).length > 0;
    return {
      ...descriptor,
      capabilities: [...descriptor.capabilities],
      availability: health.status === "ready" || fallbackAvailable ? "available" : "unavailable",
      messages: [healthMessage(health, fallbackAvailable)],
      details: runtimeDetails(health)
    };
  }
}

class AppServerGenerationProvider implements GenerationProvider {
  readonly descriptor = {
    id: CODEX_PROVIDER_ID,
    name: "ChatGPT Image 2 / Codex",
    route: "codex-cli" as const,
    capabilities: ["image.generate", "image.edit", "image.reference-input"] as const,
    model: "Codex discovered default",
    notes: ["Uses one application-owned Codex App Server with an explicit codex exec fallback."]
  };

  constructor(private readonly route: CodexProviderRoute) {}

  diagnose(): ProviderDiagnostic {
    return this.route.diagnostic({ ...this.descriptor, capabilities: [...this.descriptor.capabilities], availability: "unavailable", messages: [] });
  }

  async generate(
    input: GenerationProviderInput,
    context?: ProviderExecutionContext
  ): Promise<ProviderGenerationResult> {
    if (input.outputCount !== 1) {
      const error = new Error(`Generation provider "${this.descriptor.id}" supports exactly one output per App Server turn.`) as Error & { code?: string; retryable?: boolean };
      error.code = "PROVIDER_OUTPUT_COUNT_UNSUPPORTED";
      error.retryable = false;
      throw error;
    }
    const fallback = await this.route.select("generation");
    if (fallback) return withFallbackMetadata(await fallback.generate(input, context), this.route.runtime.health());
    const result = await this.route.runner.run({
      documentId: documentIdFromInput(input.projectPath),
      memoryScopeKey: null,
      cwd: input.projectPath,
      prompt: generationPrompt(input),
      images: collectGenerationImages(input),
      signal: context?.signal
    });
    const output = await generationResult(result, this.descriptor);
    await context?.complete(output);
    return output;
  }

  async edit(
    input: ImageEditProviderInput,
    context?: ProviderExecutionContext
  ): Promise<ProviderGenerationResult> {
    const fallback = await this.route.select("generation");
    if (fallback) return withFallbackMetadata(await fallback.edit(input, context), this.route.runtime.health());
    const images: CodexTurnImageInput[] = [
      { kind: "local-image", value: input.sourceImage.assetPath },
      ...(input.mask?.assetPath ? [{ kind: "local-image" as const, value: input.mask.assetPath }] : [])
    ];
    const result = await this.route.runner.run({
      documentId: documentIdFromInput(input.projectPath),
      memoryScopeKey: null,
      cwd: input.projectPath,
      prompt: editPrompt(input),
      images,
      signal: context?.signal
    });
    const output = await generationResult(result, this.descriptor);
    await context?.complete(output);
    return output;
  }
}

class AppServerAssistantProvider implements AssistantProvider {
  readonly descriptor = {
    id: CODEX_ASSISTANT_PROVIDER_ID,
    name: "Codex Assistant",
    route: "codex-cli" as const,
    capabilities: ["assistant.text", "assistant.vision", "image.reference-input"] as const,
    model: "Codex discovered default",
    notes: ["Uses the application-owned Codex App Server session pool."]
  };

  constructor(private readonly route: CodexProviderRoute) {}

  diagnose(): ProviderDiagnostic {
    return this.route.diagnostic({ ...this.descriptor, capabilities: [...this.descriptor.capabilities], availability: "unavailable", messages: [] });
  }

  async run(
    input: AssistantProviderInput,
    context?: ProviderExecutionContext<ProviderAssistantResult>
  ): Promise<ProviderAssistantResult> {
    const fallback = await this.route.select("assistant");
    if (fallback) return withFallbackMetadata(await fallback.run(input, context), this.route.runtime.health());
    const result = await this.route.runner.run({
      documentId: documentIdFromInput(input.projectPath),
      memoryScopeKey: memoryScopeFromMetadata(input.inputs),
      cwd: input.projectPath,
      prompt: assistantPrompt(input),
      images: collectEnvelopeImages(input.inputs),
      signal: context?.signal
    });
    return {
      providerId: this.descriptor.id,
      providerName: this.descriptor.name,
      capabilities: [...this.descriptor.capabilities],
      text: result.text,
      outputs: [{ channel: "text", text: result.text }],
      metadata: provenanceMetadata(result)
    };
  }
}

class AppServerEvaluationProvider implements VisionEvaluationProvider {
  readonly descriptor = {
    id: CODEX_VISION_EVALUATION_PROVIDER_ID,
    name: "Codex Vision Evaluation",
    route: "codex-cli" as const,
    capabilities: ["evaluation.vision", "assistant.vision", "image.reference-input"] as const,
    model: "Codex discovered default",
    notes: ["Uses structured output over the application-owned Codex App Server."]
  };

  constructor(private readonly route: CodexProviderRoute) {}

  diagnose(): ProviderDiagnostic {
    return this.route.diagnostic({ ...this.descriptor, capabilities: [...this.descriptor.capabilities], availability: "unavailable", messages: [] });
  }

  async evaluate(
    input: VisionEvaluationProviderInput,
    context?: ProviderExecutionContext<VisionEvaluationProviderResult>
  ): Promise<VisionEvaluationProviderResult> {
    const fallback = await this.route.select("evaluation");
    if (fallback) return withFallbackMetadata(await fallback.evaluate(input, context), this.route.runtime.health());
    const result = await this.route.runner.run({
      documentId: documentIdFromInput(input.projectPath),
      memoryScopeKey: memoryScopeFromMetadata(input.inputs),
      cwd: input.projectPath,
      prompt: evaluationPrompt(input),
      images: input.images.map((image) => ({ kind: "local-image", value: image.assetPath })),
      outputSchema: evaluationOutputSchema,
      signal: context?.signal
    });
    const structured = readEvaluationOutput(result.structuredOutput, input);
    return {
      providerId: this.descriptor.id,
      providerName: this.descriptor.name,
      capabilities: [...this.descriptor.capabilities],
      items: structured.items,
      summary: structured.summary,
      outputs: [{ channel: "data", data: structured }],
      metadata: provenanceMetadata(result)
    };
  }
}

const evaluationOutputSchema: JsonObject = {
  type: "object",
  additionalProperties: false,
  required: ["items", "summary"],
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "assetId", "score", "tags", "decision", "confidence", "explanation", "detectedIssues"],
        properties: {
          id: { type: "string" },
          assetId: { type: ["string", "null"] },
          score: { type: "number", minimum: 0, maximum: 100 },
          tags: { type: "array", items: { type: "string" } },
          decision: { type: "string", enum: ["pass", "needs-edit", "fail"] },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          explanation: { type: "string" },
          detectedIssues: { type: "array", items: { type: "string" } }
        }
      }
    },
    summary: { type: "string" }
  }
};

function generationPrompt(input: GenerationProviderInput) {
  return [
    "Use the version-pinned image generation tool to create exactly one PNG image.",
    `Prompt: ${input.prompt}`,
    input.negativePrompt ? `Avoid: ${input.negativePrompt}` : "",
    input.output ? `Target: ${input.output.width}x${input.output.height}, ${input.output.aspectRatio}.` : "",
    "Return only after the imageGeneration item reports a savedPath."
  ].filter(Boolean).join("\n");
}

function editPrompt(input: ImageEditProviderInput) {
  return [
    "Use the version-pinned image generation/editing tool to create exactly one edited PNG image.",
    `Operation: ${input.operation}`,
    `Instruction: ${input.instruction || input.prompt}`,
    input.negativePrompt ? `Avoid: ${input.negativePrompt}` : "",
    "The first image is the source and the second image, when present, is the mask."
  ].filter(Boolean).join("\n");
}

function assistantPrompt(input: AssistantProviderInput) {
  return [
    `Role: ${input.assistantSubtype}`,
    input.instruction,
    input.prompt,
    input.notes,
    ...input.sections.map((section) => `${section.title}: ${section.text}`)
  ].filter((value) => value.trim()).join("\n\n");
}

function evaluationPrompt(input: VisionEvaluationProviderInput) {
  return [
    "STRUCTURED vision evaluation.",
    input.instruction,
    input.criteria,
    `Threshold: ${input.threshold}`,
    `Evaluate image IDs in order: ${input.images.map((image) => image.id).join(", ")}.`
  ].join("\n");
}

function collectGenerationImages(input: GenerationProviderInput): CodexTurnImageInput[] {
  const paths = [
    ...input.references.map((reference) => reference.assetPath),
    ...(input.inputs ?? []).filter((envelope) => envelope.channel === "image").map((envelope) => envelope.assetPath ?? envelope.uri)
  ];
  return paths.flatMap((value) => value ? [imageInput(value)] : []);
}

function collectEnvelopeImages(inputs: AssistantProviderInput["inputs"]): CodexTurnImageInput[] {
  return (inputs ?? []).flatMap((envelope) => {
    if (envelope.channel !== "image") return [];
    const value = envelope.assetPath ?? envelope.uri;
    return value ? [imageInput(value)] : [];
  });
}

function imageInput(value: string): CodexTurnImageInput {
  return value.startsWith("data:image/")
    ? { kind: "data-url", value }
    : { kind: "local-image", value };
}

async function generationResult(
  result: CodexTurnRunnerResult,
  descriptor: AppServerGenerationProvider["descriptor"]
): Promise<ProviderGenerationResult> {
  const artifacts: GeneratedArtifact[] = [];
  for (const image of result.imageGenerations) {
    if (!image.savedPath) continue;
    await readRequiredPngOutput(image.savedPath);
    artifacts.push({
      fileName: path.basename(image.savedPath),
      mimeType: "image/png",
      sourcePath: image.savedPath,
      metadata: { toolItemId: image.id, status: image.status, revisedPrompt: image.revisedPrompt }
    });
  }
  if (artifacts.length !== 1) {
    throw new Error(`Codex App Server image turn produced ${artifacts.length} validated PNG outputs; exactly one is required.`);
  }
  return {
    providerId: descriptor.id,
    providerName: descriptor.name,
    capabilities: [...descriptor.capabilities],
    artifacts,
    outputs: artifacts.map((artifact) => ({ channel: "image", assetPath: artifact.sourcePath, mimeType: artifact.mimeType })),
    metadata: provenanceMetadata(result)
  };
}

function readEvaluationOutput(value: unknown, input: VisionEvaluationProviderInput) {
  if (isRecord(value) && Array.isArray(value.items) && typeof value.summary === "string") {
    return {
      items: value.items.map((item, index) => readEvaluationItem(item, input.images[index]?.id ?? `item-${index + 1}`)),
      summary: value.summary
    };
  }
  if (input.images.length === 0 && isRecord(value)) {
    return { items: [], summary: "Evaluation completed without image items." };
  }
  throw new Error("Codex evaluation structured output did not match the required items/summary contract.");
}

function readEvaluationItem(value: unknown, fallbackId: string): VisionEvaluationItemResult {
  if (!isRecord(value)) throw new Error("Codex evaluation item must be an object.");
  const decision = value.decision;
  if (decision !== "pass" && decision !== "needs-edit" && decision !== "fail") {
    throw new Error("Codex evaluation item has an invalid decision.");
  }
  if (typeof value.score !== "number" || typeof value.confidence !== "number" || typeof value.explanation !== "string") {
    throw new Error("Codex evaluation item is missing numeric score/confidence or explanation.");
  }
  return {
    id: typeof value.id === "string" ? value.id : fallbackId,
    assetId: typeof value.assetId === "string" ? value.assetId : undefined,
    score: value.score,
    tags: Array.isArray(value.tags) ? value.tags.filter((entry): entry is string => typeof entry === "string") : [],
    decision,
    confidence: value.confidence,
    explanation: value.explanation,
    detectedIssues: Array.isArray(value.detectedIssues)
      ? value.detectedIssues.filter((entry): entry is string => typeof entry === "string")
      : []
  };
}

function provenanceMetadata(result: CodexTurnRunnerResult) {
  return {
    transport: "app-server",
    version: CODEX_APP_SERVER_VERSION,
    manifestHash: CODEX_APP_SERVER_MANIFEST_SHA256,
    generation: result.provenance.generation,
    threadId: result.threadId,
    turnId: result.turnId,
    timing: result.provenance.timing,
    warnings: result.warnings,
    errors: result.errors,
    imageViews: result.imageViews,
    toolEvents: result.toolEvents,
    unknownEventCount: result.unknownEvents.length,
    captureTruncated: result.truncated
  };
}

function withFallbackMetadata<T extends ProviderGenerationResult | ProviderAssistantResult | VisionEvaluationProviderResult>(
  result: T,
  health: CodexRuntimeHealth
): T {
  return {
    ...result,
    metadata: {
      ...(result.metadata ?? {}),
      transport: "exec-fallback",
      version: CODEX_APP_SERVER_VERSION,
      manifestHash: CODEX_APP_SERVER_MANIFEST_SHA256,
      generation: health.generation,
      fallbackReason: health.fallbackReason
    }
  };
}

function healthMessage(health: CodexRuntimeHealth, fallbackAvailable: boolean) {
  if (health.status === "ready") return "Codex App Server is initialized and ready.";
  if (fallbackAvailable) return `Codex App Server is unavailable; explicit codex exec fallback is active: ${health.fallbackReason}`;
  if (health.status === "stopped") return "Codex App Server runtime has not been started.";
  return health.fallbackReason ?? health.restartReason ?? `Codex App Server status: ${health.status}.`;
}

function runtimeDetails(health: CodexRuntimeHealth) {
  return {
    transport: health.transport,
    version: health.version,
    manifestHash: health.manifestHash,
    generation: health.generation,
    restartCount: health.restartCount,
    restartReason: health.restartReason,
    fallbackReason: health.fallbackReason,
    pid: health.pid,
    processPhase: health.processPhase,
    timing: {
      startedAt: health.startedAt,
      initializedAt: health.initializedAt,
      initializationMs: health.initializationMs,
      lastExitAt: health.lastExitAt
    }
  };
}

function memoryScopeFromMetadata(inputs: AssistantProviderInput["inputs"] | VisionEvaluationProviderInput["inputs"]): string | null {
  for (const input of inputs ?? []) {
    const candidate = input.metadata?.memoryScopeKey;
    if (typeof candidate === "string" && candidate.startsWith("memory:v1:")) return candidate;
  }
  return null;
}

function documentIdFromInput(projectPath: string) {
  return `project:${path.resolve(projectPath).toLocaleLowerCase()}`;
}
