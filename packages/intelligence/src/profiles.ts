import type { PromptWorkerConfig, ProviderCapability, WorkerProfile } from "@ether/schema";

export type RuntimeProfileMapping = {
  profile: Exclude<WorkerProfile, "custom">;
  model: string;
  reasoningEffort: string;
};

export type RuntimeModelDiscovery = {
  model: string;
  reasoningEfforts: readonly string[];
  capability: ProviderCapability;
};

export type RuntimeWorkerCatalog = {
  profileMappings: readonly RuntimeProfileMapping[];
  models: readonly RuntimeModelDiscovery[];
};

export type ResolvedWorkerProfile = {
  profile: WorkerProfile;
  model: string;
  reasoningEffort: string;
  capability: ProviderCapability;
};

export type WorkerProfileResolutionErrorCode =
  | "PROFILE_MAPPING_UNAVAILABLE"
  | "PROFILE_MAPPING_AMBIGUOUS"
  | "MODEL_REASONING_PAIR_UNAVAILABLE"
  | "MODEL_REASONING_PAIR_AMBIGUOUS"
  | "MODEL_CAPABILITY_INVALID";

export class WorkerProfileResolutionError extends Error {
  readonly code: WorkerProfileResolutionErrorCode;

  constructor(code: WorkerProfileResolutionErrorCode, message: string) {
    super(message);
    this.name = "WorkerProfileResolutionError";
    this.code = code;
  }
}

function stableModels(models: readonly RuntimeModelDiscovery[]): RuntimeModelDiscovery[] {
  return [...models].sort((left, right) =>
    left.model.localeCompare(right.model)
    || left.capability.providerId.localeCompare(right.capability.providerId)
    || left.capability.profileId.localeCompare(right.capability.profileId)
  );
}

export function resolveWorkerProfile(
  config: PromptWorkerConfig,
  runtimeCatalog: RuntimeWorkerCatalog
): ResolvedWorkerProfile {
  let model = config.model;
  let reasoningEffort = config.reasoningEffort;

  if (config.profile !== "custom") {
    const mappings = runtimeCatalog.profileMappings.filter((mapping) => mapping.profile === config.profile);
    if (mappings.length === 0) {
      throw new WorkerProfileResolutionError(
        "PROFILE_MAPPING_UNAVAILABLE",
        `No runtime-discovered mapping is available for the ${config.profile} profile.`
      );
    }
    if (mappings.length > 1) {
      throw new WorkerProfileResolutionError(
        "PROFILE_MAPPING_AMBIGUOUS",
        `More than one runtime-discovered mapping is available for the ${config.profile} profile.`
      );
    }
    model = mappings[0]!.model;
    reasoningEffort = mappings[0]!.reasoningEffort;
  }

  const discoveries = stableModels(runtimeCatalog.models).filter((discovery) =>
    discovery.model === model && discovery.reasoningEfforts.includes(reasoningEffort)
  );
  if (discoveries.length === 0) {
    throw new WorkerProfileResolutionError(
      "MODEL_REASONING_PAIR_UNAVAILABLE",
      `The model and reasoning pair ${model}/${reasoningEffort} was not discovered at runtime.`
    );
  }
  if (discoveries.length > 1) {
    throw new WorkerProfileResolutionError(
      "MODEL_REASONING_PAIR_AMBIGUOUS",
      `The model and reasoning pair ${model}/${reasoningEffort} resolves to more than one runtime capability.`
    );
  }
  const capability = discoveries[0]!.capability;
  if (capability.operation !== "llm" || capability.provenance !== "runtime-discovered") {
    throw new WorkerProfileResolutionError(
      "MODEL_CAPABILITY_INVALID",
      `The discovered capability for ${model}/${reasoningEffort} is not a runtime-discovered LLM capability.`
    );
  }
  return { profile: config.profile, model, reasoningEffort, capability };
}
