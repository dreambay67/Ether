import {
  CODEX_ASSISTANT_PROVIDER_ID,
  CODEX_PROVIDER_ID,
  CODEX_VISION_EVALUATION_PROVIDER_ID,
  AssistantProviderRegistry,
  GenerationProviderRegistry,
  VisionEvaluationProviderRegistry,
  createAntigravityImageProviders,
  createGeminiImageProviders,
  GEMINI_IMAGE_PROVIDER_IDS,
  resolveImageProviderAlias,
  type GeminiCredentialState,
  type GeminiImageProvider,
  type CodexRuntimeHealth
} from "@ether/providers";
import type { ProviderCapability, ProviderHealthResult } from "@ether/schema";

import type { CodexRuntimeService } from "./codexRuntime.js";
import type { GeminiCredentialStatus } from "./geminiCredentialStore.js";

export type ProviderService = ReturnType<typeof createProviderService>;

export interface BackgroundProviderStartup {
  readonly done: Promise<void>;
  close(signal?: AbortSignal): Promise<void>;
}

export interface BackgroundProviderStartupOptions {
  shutdownTimeoutMs?: number;
}

export class ProviderServiceShutdownError extends Error {
  readonly code: "PROVIDER_SHUTDOWN_ABORTED" | "PROVIDER_SHUTDOWN_TIMEOUT";

  constructor(
    code: "PROVIDER_SHUTDOWN_ABORTED" | "PROVIDER_SHUTDOWN_TIMEOUT",
    message: string
  ) {
    super(message);
    this.name = "ProviderServiceShutdownError";
    this.code = code;
  }
}

const DEFAULT_PROVIDER_SHUTDOWN_TIMEOUT_MS = 5_000;

async function closeProviderServiceWithinBoundary(
  close: () => void | Promise<void>,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<void> {
  const closeAttempt = Promise.resolve().then(close);
  let timer: NodeJS.Timeout | undefined;
  let onAbort: (() => void) | undefined;
  const boundary = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new ProviderServiceShutdownError(
        "PROVIDER_SHUTDOWN_TIMEOUT",
        `Provider shutdown did not settle within ${timeoutMs}ms.`
      ));
    }, timeoutMs);
    timer.unref?.();
    onAbort = () => {
      reject(new ProviderServiceShutdownError(
        "PROVIDER_SHUTDOWN_ABORTED",
        "Provider shutdown wait was aborted."
      ));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted === true) onAbort();
  });
  try {
    await Promise.race([closeAttempt, boundary]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (onAbort !== undefined) signal?.removeEventListener("abort", onAbort);
  }
}

/**
 * Provider discovery is useful but not part of the critical path to a usable
 * local document. The handle keeps failure reporting and shutdown ordered even
 * when the user closes Ether while discovery is still in flight.
 */
export function startProviderServiceInBackground(
  service: Pick<ProviderService, "close" | "start">,
  onFailure: (error: unknown) => void,
  options: BackgroundProviderStartupOptions = {}
): BackgroundProviderStartup {
  const shutdownTimeoutMs = options.shutdownTimeoutMs ?? DEFAULT_PROVIDER_SHUTDOWN_TIMEOUT_MS;
  if (!Number.isSafeInteger(shutdownTimeoutMs) || shutdownTimeoutMs <= 0) {
    throw new Error("Provider shutdown timeout must be a positive integer.");
  }
  let closing = false;
  const done = Promise.resolve().then(() => service.start()).then(
    () => undefined,
    (error) => {
      if (!closing) {
        try {
          onFailure(error);
        } catch {
          // Optional provider startup remains contained even if reporting fails.
        }
      }
    }
  );
  let closePromise: Promise<void> | null = null;
  return {
    done,
    close: (signal) => {
      closing = true;
      closePromise ??= closeProviderServiceWithinBoundary(
        () => service.close(),
        shutdownTimeoutMs,
        signal
      );
      return closePromise;
    }
  };
}

export function createProviderService(options: {
  codex: CodexRuntimeService;
  antigravityCreditOveragesConfirmed?: boolean;
  geminiCredentials?: {
    status(): Promise<GeminiCredentialStatus>;
    readApiKey(): Promise<string | null>;
    connect(apiKey: string): Promise<GeminiCredentialStatus>;
    markVerified(): Promise<GeminiCredentialStatus>;
    remove(): Promise<GeminiCredentialStatus>;
  };
}) {
  let antigravityCreditOveragesConfirmed =
    options.antigravityCreditOveragesConfirmed === true;
  let antigravityPolicyUpdate: Promise<void> = Promise.resolve();
  let geminiCredentialState: GeminiCredentialState = "not-configured";
  let geminiCredentialStatus: GeminiCredentialStatus = { state: "not-configured", verifiedAt: null };
  const refreshGeminiCredentialState = async () => {
    if (options.geminiCredentials === undefined) return geminiCredentialStatus;
    geminiCredentialStatus = await options.geminiCredentials.status();
    geminiCredentialState = geminiCredentialStatus.state;
    return geminiCredentialStatus;
  };
  const createGenerationRegistry = () => new GenerationProviderRegistry([
    options.codex.bundle.generation,
    ...(options.geminiCredentials === undefined ? [] : createGeminiImageProviders({
      getApiKey: () => options.geminiCredentials!.readApiKey(),
      credentialState: () => geminiCredentialState
    })),
    ...createAntigravityImageProviders({
      creditOveragesPolicy: antigravityCreditOveragesConfirmed
        ? "never-confirmed"
        : "unverified"
    })
  ]);
  let generation = createGenerationRegistry();
  const assistant = new AssistantProviderRegistry([options.codex.bundle.assistant]);
  const evaluation = new VisionEvaluationProviderRegistry([options.codex.bundle.evaluation]);
  let closePromise: Promise<void> | null = null;
  let runtimeStart: Promise<CodexRuntimeHealth> | null = null;
  let capabilityRefresh: Promise<ProviderCapability[]> | null = null;
  let capabilitySnapshot: ProviderCapability[] | null = null;

  const ensureRuntime = () => {
    runtimeStart ??= options.codex.start();
    return runtimeStart;
  };
  const refreshCapabilities = async () => {
    if (capabilityRefresh !== null) return capabilityRefresh;
    capabilityRefresh = (async () => {
      await refreshGeminiCredentialState();
      await ensureRuntime();
      const health = options.codex.health();
      const imageDiagnostics = await Promise.all(generation.listDescriptors().map(async (descriptor) => {
        try {
          return await generation.diagnose(descriptor.id);
        } catch {
          return null;
        }
      }));
      const image = imageDiagnostics.flatMap((diagnostic) =>
        diagnostic?.profiles?.flatMap((profile): ProviderCapability[] => {
          if (
            profile.availability !== "available" ||
            (profile.status !== "ready" && profile.status !== "experimental") ||
            (profile.operation !== "image.generate" && profile.operation !== "image.edit")
          ) return [];
          return [{
            providerId: profile.providerId,
            profileId: profile.profileId,
            ...(profile.model === undefined ? {} : { modelId: profile.model }),
            operation: profile.operation === "image.generate" ? "generate-image" : "edit-image",
            inputChannels: [...profile.inputChannels],
            outputChannels: [...profile.outputChannels],
            aspectRatios: profile.providerId === CODEX_PROVIDER_ID
              ? [...(health.imageCapabilityProfile?.verifiedAspectRatios ?? [])]
              : [...(profile.aspectRatios ?? [])],
            resolutions: (profile.resolutions ?? []).map((resolution) => ({ ...resolution })),
            maxReferences: profile.mediaLimits?.maxInputs
              ?? (profile.inputChannels.includes("image") ? 16 : 0),
            maxOutputsPerCall: 1,
            ...(profile.outputFormats === undefined
              ? {}
              : {
                  outputFormats: [...profile.outputFormats]
                }),
            ...(profile.maxParallelism === undefined
              ? {}
              : { maxParallelism: profile.maxParallelism }),
            supportsCancellation: true,
            supportsSeed: false,
            provenance: profile.capabilitySource === "antigravity-cli"
              ? "conformance-verified"
              : profile.capabilitySource === "gemini-developer-api"
                ? "static-constraint"
                : "runtime-discovered",
            limitations: [...(profile.messages ?? [])]
          }];
        }) ?? []
      );
      const codexAvailable = health.status === "ready" || health.transport === "exec-fallback";
      const workerModels = health.models.length > 0
        ? health.models.map((model) => ({ id: model.id, reasoningEfforts: model.reasoningEfforts }))
        : [{ id: health.defaultModelId ?? "codex-default", reasoningEfforts: health.reasoningEfforts }];
      const intelligence = codexAvailable
        ? workerModels.flatMap(({ id: modelId, reasoningEfforts }): ProviderCapability[] => [{
            providerId: CODEX_ASSISTANT_PROVIDER_ID,
            profileId: `worker:${modelId}`,
            modelId,
            reasoningEfforts,
            operation: "llm",
            inputChannels: ["text", "image", "data"],
            outputChannels: ["text", "data"],
            aspectRatios: [],
            resolutions: [],
            maxReferences: 32,
            // The Worker protocol emits one independently validated result per turn.
            maxOutputsPerCall: 1,
            maxParallelism: 4,
            supportsCancellation: true,
            supportsSeed: false,
            provenance: "runtime-discovered",
            limitations: ["Codex Worker calls share the application-wide Codex concurrency limit."]
          }, {
            providerId: CODEX_VISION_EVALUATION_PROVIDER_ID,
            profileId: `evaluation:${modelId}`,
            modelId,
            reasoningEfforts,
            operation: "llm",
            inputChannels: ["text", "image", "data"],
            outputChannels: ["data"],
            aspectRatios: [],
            resolutions: [],
            maxReferences: 32,
            maxOutputsPerCall: 4,
            maxParallelism: 4,
            supportsCancellation: true,
            supportsSeed: false,
            provenance: "runtime-discovered",
            limitations: ["Codex evaluation calls share the application-wide Codex concurrency limit."]
          }])
        : [];
      capabilitySnapshot = [...image, ...intelligence];
      return capabilitySnapshot;
    })().finally(() => {
      capabilityRefresh = null;
    });
    return capabilityRefresh;
  };

  return {
    get generation() {
      return generation;
    },
    assistant,
    evaluation,
    codex: options.codex.bundle,
    runtimeIdentity: options.codex.identity,
    start: async () => {
      const health = await ensureRuntime();
      await refreshCapabilities();
      return health;
    },
    health: (): CodexRuntimeHealth => options.codex.health(),
    capabilities: async () => structuredClone(capabilitySnapshot ?? await refreshCapabilities()),
    antigravityPolicy: () => ({
      creditOveragesConfirmed: antigravityCreditOveragesConfirmed
    }),
    geminiCredentialStatus: async () => {
      await refreshGeminiCredentialState();
      return { ...geminiCredentialStatus };
    },
    connectGeminiCredential: async (apiKey: string) => {
      if (options.geminiCredentials === undefined) throw providerConfigurationError();
      const status = await options.geminiCredentials.connect(apiKey);
      geminiCredentialStatus = status;
      geminiCredentialState = status.state;
      capabilitySnapshot = null;
      return { ...status };
    },
    testGeminiCredential: async () => {
      if (options.geminiCredentials === undefined) throw providerConfigurationError();
      await refreshGeminiCredentialState();
      const provider = generation.get(GEMINI_IMAGE_PROVIDER_IDS["nano-banana-2"]);
      if (!(provider instanceof Object) || typeof (provider as GeminiImageProvider).testConnection !== "function") {
        throw providerConfigurationError();
      }
      await (provider as GeminiImageProvider).testConnection();
      const status = await options.geminiCredentials.markVerified();
      geminiCredentialStatus = status;
      geminiCredentialState = status.state;
      capabilitySnapshot = null;
      return { ...status };
    },
    removeGeminiCredential: async () => {
      if (options.geminiCredentials === undefined) throw providerConfigurationError();
      const status = await options.geminiCredentials.remove();
      geminiCredentialStatus = status;
      geminiCredentialState = status.state;
      capabilitySnapshot = null;
      return { ...status };
    },
    setAntigravityCreditOveragesConfirmed: (confirmed: boolean) => {
      const update = antigravityPolicyUpdate.then(async () => {
        if (confirmed === antigravityCreditOveragesConfirmed) {
          return {
            creditOveragesConfirmed: antigravityCreditOveragesConfirmed
          };
        }
        await capabilityRefresh?.catch(() => undefined);
        antigravityCreditOveragesConfirmed = confirmed;
        generation = createGenerationRegistry();
        capabilitySnapshot = null;
        try {
          await refreshCapabilities();
        } catch (error) {
          if (confirmed) {
            antigravityCreditOveragesConfirmed = false;
            generation = createGenerationRegistry();
            capabilitySnapshot = null;
          }
          throw error;
        }
        return {
          creditOveragesConfirmed: antigravityCreditOveragesConfirmed
        };
      });
      antigravityPolicyUpdate = update.then(() => undefined, () => undefined);
      return update;
    },
    resolveExecutionProviders: (binding: {
      providerId: string;
      profileId?: string;
    } | null | undefined) => ({
      image: binding === null || binding === undefined
        ? options.codex.bundle.generation
        : generation.get(resolveImageProviderAlias(binding.providerId, binding.profileId).providerId) ?? undefined,
      worker: binding === null || binding === undefined
        ? options.codex.bundle.assistant
        : assistant.get(binding.providerId) ?? undefined,
      evaluation: binding === null || binding === undefined
        ? options.codex.bundle.evaluation
        : evaluation.get(binding.providerId) ?? undefined
    }),
    providerHealth: (): ProviderHealthResult => providerHealth(options.codex.health()),
    subscribe: (listener: (health: CodexRuntimeHealth) => void) => options.codex.subscribe((health) => {
      capabilitySnapshot = null;
      listener(health);
    }),
    clearDocument: (documentId: string) => options.codex.clearDocument(documentId),
    close: () => {
      closePromise ??= options.codex.close();
      return closePromise;
    }
  };
}

function providerConfigurationError(): Error {
  return Object.assign(new Error("Gemini credential storage is unavailable in this application mode."), {
    code: "GEMINI_CREDENTIAL_SERVICE_UNAVAILABLE",
    category: "provider"
  });
}

function providerHealth(health: CodexRuntimeHealth): ProviderHealthResult {
  const status = health.status === "ready"
    ? "available"
    : health.status === "starting" || health.status === "restarting"
      ? "probing"
      : health.transport === "exec-fallback"
        ? "degraded"
        : "unavailable";
  return {
    providerId: CODEX_PROVIDER_ID,
    status,
    message: health.fallbackReason ?? health.restartReason,
    checkedAt: new Date().toISOString(),
    transport: health.transport,
    version: health.reportedVersion,
    manifestHash: health.manifestHash,
    generation: health.generation,
    restartCount: health.restartCount,
    restartReason: health.restartReason,
    fallbackReason: health.fallbackReason,
    processPhase: health.processPhase,
    threadId: null,
    turnId: null,
    timing: {
      startedAt: health.startedAt,
      initializedAt: health.initializedAt,
      initializationMs: health.initializationMs,
      lastExitAt: health.lastExitAt
    }
  };
}
