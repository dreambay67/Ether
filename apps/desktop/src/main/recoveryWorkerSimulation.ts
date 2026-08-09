import type {
  AssistantProvider,
  AssistantProviderInput,
  PayloadEnvelope,
  ProviderAssistantResult,
  ProviderExecutionContext
} from "@ether/providers";
import type { ProviderCapability } from "@ether/schema";

export const RECOVERY_WORKER_SIMULATION_PROVIDER_ID = "ether-fake-local";
export const RECOVERY_WORKER_SIMULATION_PROFILE_ID = "worker:deterministic-transform-v1";
export const RECOVERY_WORKER_SIMULATION_MODEL_ID = "deterministic-transform-v1";

/**
 * The schema represents LLM and media interpretation as distinct operations.
 * Both entries intentionally identify the same opt-in local simulation route.
 */
export const RECOVERY_WORKER_SIMULATION_CAPABILITIES = [
  {
    providerId: RECOVERY_WORKER_SIMULATION_PROVIDER_ID,
    profileId: RECOVERY_WORKER_SIMULATION_PROFILE_ID,
    modelId: RECOVERY_WORKER_SIMULATION_MODEL_ID,
    reasoningEfforts: ["low", "medium", "high"],
    operation: "llm",
    inputChannels: ["text", "image", "data"],
    outputChannels: ["text", "data"],
    aspectRatios: [],
    resolutions: [],
    maxReferences: 32,
    maxOutputsPerCall: 1,
    maxParallelism: 1,
    supportsCancellation: true,
    supportsSeed: false,
    provenance: "runtime-discovered",
    limitations: ["Offline deterministic recovery simulation. No external LLM provider is contacted."]
  },
  {
    providerId: RECOVERY_WORKER_SIMULATION_PROVIDER_ID,
    profileId: RECOVERY_WORKER_SIMULATION_PROFILE_ID,
    modelId: RECOVERY_WORKER_SIMULATION_MODEL_ID,
    reasoningEfforts: ["low", "medium", "high"],
    operation: "interpret",
    inputChannels: ["text", "image", "data"],
    outputChannels: ["text"],
    aspectRatios: [],
    resolutions: [],
    maxReferences: 32,
    maxOutputsPerCall: 1,
    maxParallelism: 1,
    supportsCancellation: true,
    supportsSeed: false,
    provenance: "runtime-discovered",
    limitations: ["Offline deterministic recovery simulation. No external interpretation provider is contacted."]
  }
] satisfies ProviderCapability[];

export type RecoveryWorkerSimulationFacets = {
  worker: Pick<AssistantProvider, "run">;
  media: {
    interpret(input: {
      prompt: string;
      inputs: PayloadEnvelope[];
      model?: string;
      reasoningEffort?: string;
      signal: AbortSignal;
    }): Promise<{ text: string; metadata?: Record<string, unknown> }>;
  };
};

/**
 * Creates recovery-only execution facets. This module deliberately performs no
 * registration: a caller must explicitly wire the returned facets into an
 * application created in recovery simulation mode.
 */
export function createRecoveryWorkerSimulationFacets(): RecoveryWorkerSimulationFacets {
  const transform = (input: {
    prompt: string;
    instruction?: string;
    inputs?: readonly PayloadEnvelope[];
    signal: AbortSignal;
  }) => {
    throwIfAborted(input.signal);
    const text = deterministicTransformation(input);
    throwIfAborted(input.signal);
    return text;
  };

  return {
    worker: {
      run: async (
        input: AssistantProviderInput,
        context?: ProviderExecutionContext<ProviderAssistantResult>
      ): Promise<ProviderAssistantResult> => {
        const signal = context?.signal ?? new AbortController().signal;
        throwIfAborted(signal);
        context?.reportPhase?.("first-event");
        const result: ProviderAssistantResult = {
          providerId: RECOVERY_WORKER_SIMULATION_PROVIDER_ID,
          providerName: "Ether Recovery Worker Simulation",
          capabilities: ["assistant.text"],
          text: transform({
            prompt: input.prompt,
            instruction: input.instruction,
            inputs: input.inputs,
            signal
          }),
          metadata: simulationMetadata("llm")
        };
        throwIfAborted(signal);
        await context?.complete(result);
        return result;
      }
    },
    media: {
      interpret: async (input) => ({
        text: transform(input),
        metadata: simulationMetadata("interpret")
      })
    }
  };
}

function deterministicTransformation(input: {
  prompt: string;
  instruction?: string;
  inputs?: readonly PayloadEnvelope[];
}): string {
  const instruction = normalized(input.instruction);
  const prompt = normalized(input.prompt);
  const context = (input.inputs ?? [])
    .flatMap((value) => value.channel === "text" && typeof value.text === "string"
      ? [normalized(value.text)]
      : value.channel === "data" && value.data !== undefined
        ? [JSON.stringify(value.data)]
        : [])
    .filter((value) => value.length > 0);
  return [
    "[Ether recovery simulation: deterministic transformation]",
    ...(instruction.length > 0 ? [`Instruction: ${instruction}`] : []),
    ...(prompt.length > 0 ? [`Output: ${prompt}`] : ["Output: (empty)"]),
    ...context.map((value) => `Context: ${value}`)
  ].join("\n");
}

function normalized(value: string | undefined): string {
  return (value ?? "").trim().replace(/\s+/gu, " ");
}

function simulationMetadata(operation: "llm" | "interpret"): Record<string, unknown> {
  return {
    deterministic: true,
    simulation: "recovery",
    operation,
    providerId: RECOVERY_WORKER_SIMULATION_PROVIDER_ID,
    profileId: RECOVERY_WORKER_SIMULATION_PROFILE_ID,
    modelId: RECOVERY_WORKER_SIMULATION_MODEL_ID
  };
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  const error = new Error("Provider execution was cancelled.");
  error.name = "AbortError";
  throw error;
}
