import type {
  AssistantProviderInput,
  GenerationCapability,
  GenerationProviderInput,
  ImageEditProviderInput,
  ProviderAssistantResult,
  ProviderDescriptor,
  ProviderDiagnostic,
  ProviderExecutionContext,
  ProviderGenerationResult,
  ProviderRoute
} from "../types.js";

export type ApiProviderReadiness = "configured" | "missing_credentials" | "missing_adapter" | "disabled";

export type ApiCredentialState = "present" | "missing" | "not_checked";

export type ApiCredentialStatus = {
  state: ApiCredentialState;
  envKey?: string;
  referenceId?: string;
  source: "environment" | "explicit" | "secure-store" | "none";
};

export type ApiCredentialReference = {
  source: "environment" | "explicit" | "secure-store";
  id: string;
  validated: true;
};

export type ApiProviderActivation =
  | { state: "disabled" }
  | {
      state: "explicit-user-selection";
      selectedProviderId: string;
      credentialReference: ApiCredentialReference;
    };

export type ApiRequestPolicy = {
  requiresExplicitSelection: boolean;
  noHiddenFallback: true;
  allowNetworkRequests: boolean;
  notes?: string[];
};

export type ApiDataDisclosure = {
  sendsPrompts: boolean;
  sendsImages: boolean;
  sendsProjectMetadata: boolean;
  notes?: string[];
};

export type ApiProviderDescriptorInput = Omit<ProviderDescriptor, "route" | "capabilities"> & {
  route?: Extract<ProviderRoute, "api-generation" | "api-assistant">;
  capabilities: readonly GenerationCapability[];
};

export type ApiProviderConfig = {
  descriptor: ApiProviderDescriptorInput;
  activation: ApiProviderActivation;
  credential?: string;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  requestPolicy?: Partial<ApiRequestPolicy>;
  dataDisclosure?: Partial<ApiDataDisclosure>;
  unavailableMessage?: string;
};

export type ApiProviderDiagnostic = ProviderDiagnostic & {
  readiness: ApiProviderReadiness;
  credentialStatus: ApiCredentialStatus;
  requestPolicy: ApiRequestPolicy;
  dataDisclosure: ApiDataDisclosure;
  noHiddenFallback: true;
};

export interface ApiGenerationAdapter {
  readonly maxOutputsPerCall?: number;
  generate(input: GenerationProviderInput, context?: ProviderExecutionContext): Promise<ProviderGenerationResult>;
  edit(input: ImageEditProviderInput, context?: ProviderExecutionContext): Promise<ProviderGenerationResult>;
}

export interface ApiAssistantAdapter {
  run(
    input: AssistantProviderInput,
    context?: ProviderExecutionContext<ProviderAssistantResult>
  ): Promise<ProviderAssistantResult>;
}
