import {
  CODEX_ASSISTANT_PROVIDER_ID,
  CODEX_PROVIDER_ID,
  CODEX_VISION_EVALUATION_PROVIDER_ID,
  type CodexCliImageProviderOptions,
  type CodexCliVisionEvaluationProviderOptions
} from "./codex.js";
import type { CodexAppServerProviderBundle } from "./codex/appServerProvider.js";
import { createDefaultApiAssistantProvider } from "./api/assistantApiProvider.js";
import { createDefaultApiGenerationProvider } from "./api/generationApiProvider.js";
import { BLOCKED_OPENAI_ENV_KEYS, hasBlockedOpenAiEnvKey } from "./env.js";
import { ProviderNotFoundError } from "./errors.js";
import { FAKE_PROVIDER_ID, FakeImageProvider } from "./fake.js";
import { createAntigravityImageProviders } from "./antigravity/imageProvider.js";
import type { AntigravityCliImageProviderOptions } from "./antigravity/imageProvider.js";
import { createGeminiImageProviders, type GeminiImageProviderOptions } from "./gemini/imageProvider.js";
import { UnavailableImageProvider } from "./unavailable.js";
import type {
  AssistantProvider,
  GenerationProvider,
  ProviderCapabilityMatrixEntry,
  ProviderCapabilityProfile,
  ProviderDescriptor,
  ProviderDiagnosticContext,
  ProviderDiagnostic,
  ProviderMode,
  ProviderOperation,
  ProviderPayloadChannel,
  ProviderRegistryDiagnostics,
  VisionEvaluationProvider
} from "./types.js";
import type { ApiProviderDiagnostic } from "./api/types.js";

export type DefaultProviderRegistryOptions = Partial<CodexCliImageProviderOptions> & {
  codexBundle?: CodexAppServerProviderBundle;
  antigravity?: AntigravityCliImageProviderOptions;
  gemini?: GeminiImageProviderOptions;
};
export type DefaultVisionEvaluationProviderRegistryOptions = Partial<CodexCliVisionEvaluationProviderOptions> & {
  codexBundle?: CodexAppServerProviderBundle;
};

const runtimeBundles = new WeakMap<GenerationProviderRegistry, CodexAppServerProviderBundle>();

export class GenerationProviderRegistry {
  private readonly providers = new Map<string, GenerationProvider>();

  constructor(providers: GenerationProvider[] = []) {
    for (const provider of providers) {
      this.register(provider);
    }
  }

  register(provider: GenerationProvider) {
    if (this.providers.has(provider.descriptor.id)) {
      throw new Error(`Generation provider "${provider.descriptor.id}" is already registered.`);
    }

    this.providers.set(provider.descriptor.id, provider);
  }

  get(providerId: string) {
    return this.providers.get(providerId) ?? null;
  }

  require(providerId: string) {
    const provider = this.get(providerId);

    if (!provider) {
      throw new ProviderNotFoundError(providerId, this.listDescriptors().map((entry) => entry.id));
    }

    return provider;
  }

  listDescriptors(): ProviderDescriptor[] {
    return [...this.providers.values()].map((provider) => ({
      ...provider.descriptor,
      capabilities: [...provider.descriptor.capabilities],
      notes: provider.descriptor.notes ? [...provider.descriptor.notes] : undefined
    }));
  }

  async diagnose(providerId: string, context: ProviderDiagnosticContext = {}) {
    return this.require(providerId).diagnose(context);
  }

  async diagnoseAll(context: ProviderDiagnosticContext = {}) {
    return Promise.all([...this.providers.values()].map((provider) => provider.diagnose(context)));
  }
}

export class AssistantProviderRegistry {
  private readonly providers = new Map<string, AssistantProvider>();

  constructor(providers: AssistantProvider[] = []) {
    for (const provider of providers) {
      this.register(provider);
    }
  }

  register(provider: AssistantProvider) {
    if (this.providers.has(provider.descriptor.id)) {
      throw new Error(`Assistant provider "${provider.descriptor.id}" is already registered.`);
    }

    this.providers.set(provider.descriptor.id, provider);
  }

  get(providerId: string) {
    return this.providers.get(providerId) ?? null;
  }

  require(providerId: string) {
    const provider = this.get(providerId);

    if (!provider) {
      throw new ProviderNotFoundError(providerId, this.listDescriptors().map((entry) => entry.id), "Assistant");
    }

    return provider;
  }

  listDescriptors(): ProviderDescriptor[] {
    return [...this.providers.values()].map((provider) => ({
      ...provider.descriptor,
      capabilities: [...provider.descriptor.capabilities],
      notes: provider.descriptor.notes ? [...provider.descriptor.notes] : undefined
    }));
  }

  async diagnose(providerId: string, context: ProviderDiagnosticContext = {}) {
    return this.require(providerId).diagnose(context);
  }

  async diagnoseAll(context: ProviderDiagnosticContext = {}) {
    return Promise.all([...this.providers.values()].map((provider) => provider.diagnose(context)));
  }
}

export class VisionEvaluationProviderRegistry {
  private readonly providers = new Map<string, VisionEvaluationProvider>();

  constructor(providers: VisionEvaluationProvider[] = []) {
    for (const provider of providers) {
      this.register(provider);
    }
  }

  register(provider: VisionEvaluationProvider) {
    if (this.providers.has(provider.descriptor.id)) {
      throw new Error(`Vision evaluation provider "${provider.descriptor.id}" is already registered.`);
    }

    this.providers.set(provider.descriptor.id, provider);
  }

  get(providerId: string) {
    return this.providers.get(providerId) ?? null;
  }

  require(providerId: string) {
    const provider = this.get(providerId);

    if (!provider) {
      throw new ProviderNotFoundError(
        providerId,
        this.listDescriptors().map((entry) => entry.id),
        "Vision evaluation"
      );
    }

    return provider;
  }

  listDescriptors(): ProviderDescriptor[] {
    return [...this.providers.values()].map((provider) => ({
      ...provider.descriptor,
      capabilities: [...provider.descriptor.capabilities],
      notes: provider.descriptor.notes ? [...provider.descriptor.notes] : undefined
    }));
  }

  async diagnose(providerId: string, context: ProviderDiagnosticContext = {}) {
    return this.require(providerId).diagnose(context);
  }

  async diagnoseAll(context: ProviderDiagnosticContext = {}) {
    return Promise.all([...this.providers.values()].map((provider) => provider.diagnose(context)));
  }
}

export function createDefaultProviderRegistry(options: DefaultProviderRegistryOptions = {}) {
  const codexProvider = options.codexBundle?.generation ?? new UnavailableImageProvider({
    id: CODEX_PROVIDER_ID,
    name: "ChatGPT Image 2 / Codex",
    route: "codex-cli",
    capabilities: ["image.generate", "image.edit", "image.reference-input"],
    notes: ["A shared application-owned Codex runtime bundle was not supplied."]
  }, "Codex is unavailable until the application supplies its shared App Server provider bundle.");
  const registry = new GenerationProviderRegistry([
    new FakeImageProvider(),
    codexProvider,
    ...(options.gemini ? createGeminiImageProviders(options.gemini) : []),
    ...createAntigravityImageProviders(options.antigravity)
  ]);
  if (options.codexBundle) runtimeBundles.set(registry, options.codexBundle);
  return registry;
}

export function createDefaultVisionEvaluationProviderRegistry(
  options: DefaultVisionEvaluationProviderRegistryOptions = {}
) {
  return new VisionEvaluationProviderRegistry(options.codexBundle ? [options.codexBundle.evaluation] : []);
}

export async function diagnoseProviderRegistry(
  registry: GenerationProviderRegistry,
  context: ProviderDiagnosticContext = {}
): Promise<ProviderRegistryDiagnostics> {
  const env = context.env ?? process.env;
  const providers = await registry.diagnoseAll(context);
  const optionalApiProviders = {
    generation: await createDefaultApiGenerationProvider().diagnose(context),
    assistant: await createDefaultApiAssistantProvider().diagnose(context)
  };
  const bundle = runtimeBundles.get(registry);
  const assistantDiagnostics = bundle
    ? await bundle.assistant.diagnose(context)
    : unavailableFacetDiagnostic(
        CODEX_ASSISTANT_PROVIDER_ID,
        "Codex Assistant",
        ["assistant.text", "assistant.vision", "image.reference-input"]
      );
  const evaluationDiagnostics = bundle
    ? await bundle.evaluation.diagnose(context)
    : unavailableFacetDiagnostic(
        CODEX_VISION_EVALUATION_PROVIDER_ID,
        "Codex Vision Evaluation",
        ["evaluation.vision", "assistant.vision", "image.reference-input"]
      );
  const policy = {
    openAiPlatformApi: {
      status: "blocked" as const,
      envKeyDetected: hasBlockedOpenAiEnvKey(env),
      blockedEnvKeys: [...BLOCKED_OPENAI_ENV_KEYS],
      message:
        "Ether blocks OpenAI Platform API fallback. API keys are ignored and stripped from provider child environments."
    }
  };

  return {
    policy,
    providers,
    matrix: buildProviderCapabilityMatrix({
      providers,
      assistantDiagnostics,
      evaluationDiagnostics,
      optionalApiProviders
    }),
    optionalApiProviders
  };
}

function unavailableFacetDiagnostic(
  id: string,
  name: string,
  capabilities: ProviderDiagnostic["capabilities"]
): ProviderDiagnostic {
  return {
    id,
    name,
    route: "codex-cli",
    capabilities: [...capabilities],
    availability: "unavailable",
    messages: ["A shared application-owned Codex runtime bundle was not supplied."],
    details: {
      transport: "unavailable",
      manifestHash: null,
      noIndependentProviderConstruction: true
    }
  };
}

function buildProviderCapabilityMatrix(input: {
  providers: ProviderDiagnostic[];
  assistantDiagnostics: ProviderDiagnostic;
  evaluationDiagnostics: ProviderDiagnostic;
  optionalApiProviders: {
    generation: ApiProviderDiagnostic;
    assistant: ApiProviderDiagnostic;
  };
}): ProviderCapabilityMatrixEntry[] {
  const diagnosticsById = new Map(input.providers.map((diagnostic) => [diagnostic.id, diagnostic]));
  const rows = [
    matrixEntry(diagnosticsById.get(CODEX_PROVIDER_ID), {
      displayName: "ChatGPT Image 2 / Codex image",
      mode: "real"
    }),
    matrixEntry(input.assistantDiagnostics, {
      displayName: "Codex assistant",
      mode: "real"
    }),
    matrixEntry(input.evaluationDiagnostics, {
      displayName: "Codex evaluation",
      mode: "real"
    }),
    matrixEntry(diagnosticsById.get(FAKE_PROVIDER_ID), {
      displayName: "Simulation Mode fake provider",
      mode: "simulation"
    }),
    matrixEntry(input.optionalApiProviders.generation, {
      displayName: "Optional API generation slot",
      mode: "experimental"
    }),
    matrixEntry(input.optionalApiProviders.assistant, {
      displayName: "Optional API assistant slot",
      mode: "experimental"
    }),
    matrixEntry(diagnosticsById.get("google-nano-banana-pro"), {
      displayName: "Nano Banana Pro",
      mode: "experimental"
    }),
    matrixEntry(diagnosticsById.get("google-nano-banana-2"), {
      displayName: "Nano Banana 2",
      mode: "experimental"
    }),
    matrixEntry(diagnosticsById.get("google-nano-banana-2-lite"), {
      displayName: "Nano Banana 2 Lite",
      mode: "experimental"
    }),
    ...buildUnavailableAdapterMatrixEntries()
  ];

  return rows.filter((row): row is ProviderCapabilityMatrixEntry => Boolean(row));
}

function matrixEntry(
  diagnostic: ProviderDiagnostic | ApiProviderDiagnostic | undefined,
  options: { displayName: string; mode: ProviderMode }
): ProviderCapabilityMatrixEntry | null {
  if (!diagnostic) {
    return null;
  }

  const status = options.mode === "experimental"
    ? "experimental"
    : diagnostic.availability === "available"
      ? "ready"
      : "unavailable";

  return {
    id: diagnostic.id,
    displayName: options.displayName,
    name: diagnostic.name,
    route: diagnostic.route,
    availability: diagnostic.availability,
    status,
    mode: options.mode,
    capabilities: [...diagnostic.capabilities],
    profiles: buildDiagnosticProfiles(diagnostic),
    messages: [...diagnostic.messages],
    details: diagnostic.details ? { ...diagnostic.details } : undefined,
    unavailableReason: diagnostic.availability === "unavailable" ? diagnostic.messages[0] : undefined,
    model: diagnostic.model,
    notes: diagnostic.notes ? [...diagnostic.notes] : undefined,
    readiness: diagnostic.readiness,
    credentialStatus: diagnostic.credentialStatus,
    requestPolicy: diagnostic.requestPolicy,
    dataDisclosure: diagnostic.dataDisclosure,
    noHiddenFallback: diagnostic.noHiddenFallback,
    noApiPolicy: "openai-platform-api-blocked"
  };
}

function buildDiagnosticProfiles(diagnostic: ProviderDiagnostic | ApiProviderDiagnostic): ProviderCapabilityProfile[] {
  if (diagnostic.profiles) {
    return diagnostic.profiles.map(cloneCapabilityProfile);
  }

  const availability = diagnostic.availability;
  const profileStatus = availability === "available" ? "ready" : "unavailable";
  const unavailableReason = availability === "unavailable" ? diagnostic.messages[0] : undefined;
  const capabilitySource = capabilitySourceForDiagnostic(diagnostic);
  const requiresExplicitSelection =
    capabilitySource === "api-slot" || capabilitySource === "adapter-slot";
  const noHiddenFallback = Boolean(diagnostic.noHiddenFallback) || capabilitySource === "api-slot";

  return diagnostic.capabilities.flatMap((capability) => {
    const channels = operationChannels(capability);

    if (!channels || !isProviderOperation(capability)) {
      return [];
    }

    return [
      {
        providerId: diagnostic.id,
        profileId: `${diagnostic.id}:${capability}`,
        providerName: diagnostic.name,
        route: diagnostic.route,
        operation: capability,
        inputChannels: channels.inputChannels,
        outputChannels: channels.outputChannels,
        availability,
        status: profileStatus,
        capabilitySource,
        requiresExplicitSelection,
        noHiddenFallback,
        model: diagnostic.model,
        unavailableReason,
        messages: [...diagnostic.messages]
      }
    ];
  });
}

function isProviderOperation(operation: ProviderOperation | "image.reference-input"): operation is ProviderOperation {
  return operation !== "image.reference-input";
}

function cloneCapabilityProfile(profile: ProviderCapabilityProfile): ProviderCapabilityProfile {
  return {
    ...profile,
    inputChannels: [...profile.inputChannels],
    outputChannels: [...profile.outputChannels],
    messages: profile.messages ? [...profile.messages] : undefined,
    aspectRatios: profile.aspectRatios ? [...profile.aspectRatios] : undefined,
    resolutions: profile.resolutions ? profile.resolutions.map((resolution) => ({ ...resolution })) : undefined,
    outputFormats: profile.outputFormats ? [...profile.outputFormats] : undefined,
    mediaLimits: profile.mediaLimits
      ? {
          ...profile.mediaLimits,
          mimeTypes: profile.mediaLimits.mimeTypes ? [...profile.mediaLimits.mimeTypes] : undefined,
          notes: profile.mediaLimits.notes ? [...profile.mediaLimits.notes] : undefined
        }
      : undefined
  };
}

function capabilitySourceForDiagnostic(diagnostic: ProviderDiagnostic) {
  const route = diagnostic.route;
  if (route === "codex-cli") {
    return "codex-cli";
  }

  if (route === "antigravity-cli") {
    return "antigravity-cli";
  }

  if (route === "api-generation" && diagnostic.details?.providerRoute === "gemini-developer-api") {
    return "gemini-developer-api";
  }

  if (route === "local-fake") {
    return "simulation";
  }

  if (route === "api-generation" || route === "api-assistant") {
    return "api-slot";
  }

  if (route === "adapter") {
    return "adapter-slot";
  }

  return "unconfigured-provider";
}

function operationChannels(
  operation: ProviderOperation | "image.reference-input"
): { inputChannels: ProviderPayloadChannel[]; outputChannels: ProviderPayloadChannel[] } | null {
  switch (operation) {
    case "image.generate":
      return { inputChannels: ["text", "image"], outputChannels: ["image"] };
    case "image.edit":
      return { inputChannels: ["text", "image", "mask"], outputChannels: ["image"] };
    case "assistant.text":
      return { inputChannels: ["text"], outputChannels: ["text"] };
    case "assistant.vision":
      return { inputChannels: ["text", "image"], outputChannels: ["text"] };
    case "evaluation.vision":
      return { inputChannels: ["text", "image"], outputChannels: ["data"] };
    default:
      return null;
  }
}

function buildUnavailableAdapterMatrixEntries(): ProviderCapabilityMatrixEntry[] {
  return [
    unavailableAdapterMatrixEntry({
      id: "adapter-audio-to-text",
      displayName: "Audio to text adapter",
      operation: "adapter.transcribe",
      inputChannels: ["audio"],
      outputChannels: ["text"],
      unavailableReason:
        "Audio transcription adapter is not configured. Ether will not silently route audio to text through a hidden provider."
    }),
    unavailableAdapterMatrixEntry({
      id: "adapter-video-to-text",
      displayName: "Video to text adapter",
      operation: "adapter.caption",
      inputChannels: ["video"],
      outputChannels: ["text"],
      unavailableReason:
        "Video caption/transcription adapter is not configured. Ether will not silently caption video through a hidden provider."
    }),
    unavailableAdapterMatrixEntry({
      id: "adapter-image-to-text",
      displayName: "Image to text adapter",
      operation: "adapter.caption",
      inputChannels: ["image"],
      outputChannels: ["text"],
      unavailableReason:
        "Image caption/interpret adapter is conservatively unavailable until an explicit adapter is configured; Codex vision may exist, but it is not claimed as an automatic media adapter.",
      messages: [
        "Codex assistant/evaluation can inspect images when explicitly selected, but this adapter slot remains unavailable by default."
      ]
    }),
    unavailableAdapterMatrixEntry({
      id: "adapter-video-to-image",
      displayName: "Video frame extraction adapter",
      operation: "adapter.extract",
      inputChannels: ["video"],
      outputChannels: ["image"],
      unavailableReason:
        "Video frame extraction adapter is not configured. Ether will not silently extract frames through a hidden provider."
    }),
    unavailableAdapterMatrixEntry({
      id: "adapter-data-to-mask",
      displayName: "Data to mask adapter",
      operation: "adapter.transform",
      inputChannels: ["data"],
      outputChannels: ["mask"],
      unavailableReason:
        "Data-to-mask transform adapter is not configured. Ether will not silently create masks through a hidden provider."
    }),
    unavailableAdapterMatrixEntry({
      id: "adapter-text-to-audio",
      displayName: "Text to audio adapter",
      operation: "adapter.transform",
      inputChannels: ["text"],
      outputChannels: ["audio"],
      unavailableReason:
        "Text-to-audio transform adapter is not configured. Ether does not provide hidden audio generation."
    })
  ];
}

function unavailableAdapterMatrixEntry(input: {
  id: string;
  displayName: string;
  operation: ProviderOperation;
  inputChannels: ProviderPayloadChannel[];
  outputChannels: ProviderPayloadChannel[];
  unavailableReason: string;
  messages?: string[];
}): ProviderCapabilityMatrixEntry {
  const messages = [input.unavailableReason, ...(input.messages ?? [])];
  const profile: ProviderCapabilityProfile = {
    providerId: input.id,
    profileId: `${input.id}:${input.operation}`,
    providerName: input.displayName,
    route: "adapter",
    operation: input.operation,
    inputChannels: input.inputChannels,
    outputChannels: input.outputChannels,
    availability: "unavailable",
    status: "unavailable",
    capabilitySource: "adapter-slot",
    requiresExplicitSelection: true,
    noHiddenFallback: true,
    unavailableReason: input.unavailableReason,
    messages
  };

  return {
    id: input.id,
    displayName: input.displayName,
    name: input.displayName,
    route: "adapter",
    availability: "unavailable",
    status: "unavailable",
    mode: "experimental",
    capabilities: [],
    profiles: [profile],
    messages,
    unavailableReason: input.unavailableReason,
    noHiddenFallback: true,
    noApiPolicy: "openai-platform-api-blocked"
  };
}
