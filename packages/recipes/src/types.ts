import type {
  CapabilityRequirement,
  EtherGraph,
  GraphTransaction,
  ProviderCapability,
  RecipeManifest,
  RecipeParameterValue
} from "@ether/schema";

export type RecipeDiagnostic = {
  code: string;
  message: string;
  recipeId?: string;
  graphId?: string;
  entityId?: string;
};

export type RecipeCatalogValidation =
  | { valid: true; recipes: readonly RecipeManifest[]; diagnostics: readonly [] }
  | { valid: false; diagnostics: readonly RecipeDiagnostic[] };

export type ResolvedRecipeParameter = RecipeParameterValue & {
  source: "provided" | "default";
};

export type RecipeProviderResolution = {
  requirementId: string;
  capability: ProviderCapability;
  mode: "primary" | "substitution" | "compatible";
  substitutionProviderId: string | null;
  substitutionProfileId: string | null;
};

export type RecipeProviderOption = {
  providerId: string;
  profileId: string;
  priority: number;
  available: boolean;
};

export type RecipeProviderSetup = {
  requirementId: string;
  operation: CapabilityRequirement["operation"];
  inputChannels: CapabilityRequirement["inputChannels"];
  outputChannels: CapabilityRequirement["outputChannels"];
  state: "primary" | "substitution" | "compatible" | "missing";
  selectedProviderId: string | null;
  selectedProfileId: string | null;
  options: readonly RecipeProviderOption[];
};

export type RecipeBlocker = {
  code: "RECIPE_MANIFEST_INVALID" | "TARGET_GRAPH_MISSING" | "PARAMETER_INVALID" | "PARAMETER_REQUIRED" | "CAPABILITY_MISSING" | "TRANSACTION_INVALID";
  message: string;
  parameterId?: string;
  requirement?: CapabilityRequirement;
  supportedSubstitutions?: ReadonlyArray<{ providerId: string; profileId: string }>;
};

export type InstantiateRecipeInput = {
  manifest: RecipeManifest;
  graphs: readonly EtherGraph[];
  targetGraphId: string;
  baseDocumentRevisionId: string;
  baseGraphRevisions: Record<string, string>;
  parameters?: readonly RecipeParameterValue[];
  providerCapabilities: readonly ProviderCapability[];
  /** Adapter capability IDs available to graph-kernel validation. */
  graphCapabilities?: readonly string[];
  idPrefix?: string;
  transactionId?: string;
};

export type RecipeInstantiation =
  | {
      kind: "ready";
      manifest: RecipeManifest;
      resolvedParameters: readonly ResolvedRecipeParameter[];
      providers: readonly RecipeProviderResolution[];
      transaction: GraphTransaction;
      focus: { nodeId: string; graphId: string } | null;
    }
  | { kind: "blocked"; manifest: RecipeManifest; blockers: readonly RecipeBlocker[] };
