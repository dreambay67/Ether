import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, mkdir } from "node:fs/promises";
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
import type { CodexImageCapabilityProfile } from "./appServer/imageCapability.js";
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
    generation: options.runtime.health().generation,
    reportedVersion: options.runtime.health().reportedVersion
  }));
  const runner = new CodexAppServerTurnRunner(() => ({
    client: options.runtime.getClient(),
    generation: options.runtime.health().generation,
    reportedVersion: options.runtime.health().reportedVersion
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

  diagnostic(descriptor: ProviderDiagnostic, requireImageCapability = false): ProviderDiagnostic {
    const health = this.runtime.health();
    const fallbackAvailable = health.transport === "exec-fallback" && Object.values(this.fallback).length > 0;
    const appServerAvailable = health.status === "ready"
      && (!requireImageCapability || health.imageCapability === "available");
    return {
      ...descriptor,
      capabilities: [...descriptor.capabilities],
      availability: appServerAvailable || fallbackAvailable ? "available" : "unavailable",
      messages: [healthMessage(health, fallbackAvailable)],
      details: runtimeDetails(health)
    };
  }

  requireImageCapability(): CodexImageCapabilityProfile {
    const health = this.runtime.health();
    if (health.imageCapability !== "available" || !health.imageCapabilityProfile) {
      throw providerError(
        "CODEX_IMAGE_CAPABILITY_UNAVAILABLE",
        "capability",
        "Codex image generation is unavailable because no verified capability manifest matches the active App Server.",
        false
      );
    }
    return health.imageCapabilityProfile;
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
    const diagnostic = this.route.diagnostic({
      ...this.descriptor,
      capabilities: [...this.descriptor.capabilities],
      availability: "unavailable",
      messages: []
    }, true);
    const availability = diagnostic.availability;
    const maxParallelism = 4;
    const profile = (
      profileId: "image-default" | "image-edit",
      operation: "image.generate" | "image.edit",
      inputChannels: readonly ("text" | "image" | "mask" | "data")[]
    ) => ({
      providerId: this.descriptor.id,
      profileId,
      providerName: this.descriptor.name,
      route: this.descriptor.route,
      operation,
      inputChannels,
      outputChannels: ["image"] as const,
      availability,
      status: availability === "available" ? "ready" as const : "unavailable" as const,
      capabilitySource: "codex-cli" as const,
      requiresExplicitSelection: false,
      noHiddenFallback: true,
      maxParallelism,
      model: this.route.runtime.health().defaultModelId ?? this.descriptor.model,
      messages: [
        availability === "available"
          ? `Codex permits at most ${maxParallelism} simultaneous image requests across the application, including the explicit exec fallback.`
          : diagnostic.messages[0] ?? "Codex image generation is unavailable."
      ]
    });
    return {
      ...diagnostic,
      profiles: [
        profile("image-default", "image.generate", ["text", "image", "data"]),
        profile("image-edit", "image.edit", ["text", "image", "mask", "data"])
      ]
    };
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
    const imageCapability = this.route.requireImageCapability();
    validateRequestedAspect(input.output?.aspectRatio, imageCapability);
    const result = await this.route.runner.run({
      documentId: documentIdFromInput(input.workspacePath),
      memoryScopeKey: null,
      cwd: input.workspacePath,
      prompt: generationPrompt(input),
      images: collectGenerationImages(input),
      model: input.model,
      reasoningEffort: input.reasoningEffort,
      timeoutMs: input.timeoutMs,
      onEvent: () => context?.reportPhase?.("first-event"),
      signal: context?.signal
    });
    context?.reportPhase?.("generation-complete");
    const output = await generationResult(result, this.descriptor, input, context, imageCapability);
    context?.reportPhase?.("provider-validation-complete");
    await context?.complete(output);
    return output;
  }

  async edit(
    input: ImageEditProviderInput,
    context?: ProviderExecutionContext
  ): Promise<ProviderGenerationResult> {
    const fallback = await this.route.select("generation");
    if (fallback) return withFallbackMetadata(await fallback.edit(input, context), this.route.runtime.health());
    const imageCapability = this.route.requireImageCapability();
    const images: CodexTurnImageInput[] = [
      { kind: "local-image", value: input.sourceImage.assetPath },
      ...(input.mask?.assetPath ? [{ kind: "local-image" as const, value: input.mask.assetPath }] : [])
    ];
    const result = await this.route.runner.run({
      documentId: documentIdFromInput(input.workspacePath),
      memoryScopeKey: null,
      cwd: input.workspacePath,
      prompt: editPrompt(input),
      images,
      model: input.model,
      reasoningEffort: input.reasoningEffort,
      timeoutMs: input.timeoutMs,
      onEvent: () => context?.reportPhase?.("first-event"),
      signal: context?.signal
    });
    context?.reportPhase?.("generation-complete");
    const output = await generationResult(result, this.descriptor, input, context, imageCapability);
    context?.reportPhase?.("provider-validation-complete");
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
      documentId: documentIdFromInput(input.workspacePath),
      memoryScopeKey: input.memoryScopeKey ?? memoryScopeFromMetadata(input.inputs),
      cwd: input.workspacePath,
      prompt: assistantPrompt(input),
      images: collectEnvelopeImages(input.inputs),
      ...(input.outputSchema === undefined ? {} : { outputSchema: input.outputSchema }),
      model: input.model,
      reasoningEffort: input.reasoningEffort,
      timeoutMs: input.timeoutMs,
      signal: context?.signal
    });
    return {
      providerId: this.descriptor.id,
      providerName: this.descriptor.name,
      capabilities: [...this.descriptor.capabilities],
      text: result.text,
      outputs: input.outputContract?.channel === "data"
        ? [{ channel: "data", data: result.structuredOutput ?? result.text }]
        : [{ channel: "text", text: result.text }],
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
      documentId: documentIdFromInput(input.workspacePath),
      memoryScopeKey: memoryScopeFromMetadata(input.inputs),
      cwd: input.workspacePath,
      prompt: evaluationPrompt(input),
      images: input.images.map((image) => ({ kind: "local-image", value: image.assetPath })),
      outputSchema: evaluationOutputSchema,
      model: input.model,
      reasoningEffort: input.reasoningEffort,
      timeoutMs: input.timeoutMs,
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
    input.output ? `Target aspect ratio: ${input.output.aspectRatio}. Pixel dimensions are provider-determined.` : "",
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
    ...input.sections.map((section) => `${section.title}: ${section.text}`),
    input.contextPolicy ? `Context policy: ${JSON.stringify(input.contextPolicy)}` : "",
    input.outputContract ? `Output contract: ${JSON.stringify(input.outputContract)}` : "",
    input.downstream ? `Downstream capability summary: ${JSON.stringify(input.downstream)}` : "",
    input.reviewPolicy ? `Review policy: ${input.reviewPolicy}` : ""
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
  descriptor: AppServerGenerationProvider["descriptor"],
  input: GenerationProviderInput | ImageEditProviderInput,
  context: ProviderExecutionContext | undefined,
  imageCapability: CodexImageCapabilityProfile
): Promise<ProviderGenerationResult> {
  const artifacts: GeneratedArtifact[] = [];
  for (const image of result.imageGenerations) {
    if (!image.savedPath) continue;
    const originalContent = await readRequiredPngOutput(image.savedPath);
    const actualDimensions = readPngDimensions(originalContent);
    const requestedOutput = "output" in input ? input.output : undefined;
    if (requestedOutput) validateActualAspect(requestedOutput.aspectRatio, actualDimensions, imageCapability);
    const stagingDirectory = context?.stagingDirectory
      ?? path.join(input.workspacePath, ".ether", "staging", "codex", randomUUID());
    await mkdir(stagingDirectory, { recursive: true });
    const originalBaseName = path.basename(image.savedPath, path.extname(image.savedPath))
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .slice(0, 80) || "codex-image";
    const stagedPath = path.join(stagingDirectory, `${originalBaseName}-${randomUUID()}.png`);
    await copyFile(image.savedPath, stagedPath, constants.COPYFILE_EXCL);
    const stagedContent = await readRequiredPngOutput(stagedPath);
    const originalHash = sha256(originalContent);
    const stagedHash = sha256(stagedContent);
    if (originalHash !== stagedHash) {
      throw providerError(
        "CODEX_IMAGE_STAGING_MISMATCH",
        "malformed-output",
        "The staged Codex image did not match the original generated PNG.",
        false
      );
    }
    artifacts.push({
      fileName: path.basename(stagedPath),
      mimeType: "image/png",
      sourcePath: stagedPath,
      metadata: {
        toolItemId: image.id,
        status: image.status,
        revisedPrompt: image.revisedPrompt,
        outputDiscovery: imageCapability.outputDiscovery,
        originalPreserved: true,
        originalOutputHash: originalHash,
        stagedOutputHash: stagedHash,
        dimensionMode: imageCapability.dimensionMode,
        exactResolution: imageCapability.exactResolution,
        requestedDimensions: requestedOutput ? {
          width: requestedOutput.width,
          height: requestedOutput.height,
          aspectRatio: requestedOutput.aspectRatio
        } : undefined,
        actualDimensions
      }
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
    metadata: {
      ...provenanceMetadata(result),
      imageCapability
    }
  };
}

function validateRequestedAspect(aspectRatio: string | undefined, profile: CodexImageCapabilityProfile) {
  if (!aspectRatio || profile.verifiedAspectRatios.includes(aspectRatio)) return;
  throw providerError(
    "CODEX_IMAGE_ASPECT_UNSUPPORTED",
    "capability",
    `Codex ${CODEX_APP_SERVER_VERSION} has no verified image capability for aspect ratio ${aspectRatio}.`,
    false
  );
}

function validateActualAspect(
  requestedAspect: string,
  actual: { width: number; height: number },
  profile: CodexImageCapabilityProfile
) {
  const expected = parseAspectRatio(requestedAspect);
  if (!expected) {
    throw providerError("CODEX_IMAGE_ASPECT_INVALID", "invalid-input", `Invalid image aspect ratio: ${requestedAspect}.`, false);
  }
  const actualRatio = actual.width / actual.height;
  if (Math.abs(actualRatio - expected) / expected <= profile.aspectRatioTolerance) return;
  throw providerError(
    "CODEX_IMAGE_ASPECT_MISMATCH",
    "malformed-output",
    `Codex generated ${actual.width}x${actual.height}, which does not match the requested ${requestedAspect} aspect ratio.`,
    false
  );
}

function parseAspectRatio(value: string) {
  const match = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(value.trim());
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  return width > 0 && height > 0 ? width / height : null;
}

function readPngDimensions(content: Buffer) {
  if (content.length < 24 || content.toString("ascii", 12, 16) !== "IHDR") {
    throw providerError("CODEX_IMAGE_DIMENSIONS_INVALID", "malformed-output", "Codex image output has no valid PNG IHDR dimensions.", false);
  }
  const width = content.readUInt32BE(16);
  const height = content.readUInt32BE(20);
  if (width < 1 || height < 1) {
    throw providerError("CODEX_IMAGE_DIMENSIONS_INVALID", "malformed-output", "Codex image output has invalid PNG dimensions.", false);
  }
  return { width, height };
}

function sha256(content: Buffer) {
  return createHash("sha256").update(content).digest("hex");
}

function providerError(
  code: string,
  category: "capability" | "invalid-input" | "malformed-output",
  message: string,
  retryable: boolean
) {
  return Object.assign(new Error(message), { code, category, retryable });
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
    reportedVersion: result.provenance.reportedVersion,
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
    reportedVersion: health.reportedVersion,
    versionCompatible: health.versionCompatible,
    manifestHash: health.manifestHash,
    models: health.models,
    defaultModelId: health.defaultModelId,
    reasoningEfforts: health.reasoningEfforts,
    imageCapability: health.imageCapability,
    imageCapabilityManifestHash: health.imageCapabilityManifestHash,
    imageCapabilityProfile: health.imageCapabilityProfile,
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

function documentIdFromInput(workspacePath: string) {
  return `project:${path.resolve(workspacePath).toLocaleLowerCase()}`;
}
