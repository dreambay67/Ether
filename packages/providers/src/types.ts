export type GenerationCapability =
  | "image.generate"
  | "image.edit"
  | "image.reference-input";

export type ProviderAvailability = "available" | "unavailable";

export type ProviderRoute =
  | "local-fake"
  | "codex-cli"
  | "unconfigured-clean-cli-or-mcp";

export type ProviderDescriptor = {
  id: string;
  name: string;
  route: ProviderRoute;
  capabilities: readonly GenerationCapability[];
  model?: string;
  notes?: string[];
};

export type ProviderDiagnostic = ProviderDescriptor & {
  availability: ProviderAvailability;
  messages: string[];
  details?: Record<string, unknown>;
};

export type ProviderRegistryDiagnostics = {
  policy: {
    openAiPlatformApi: {
      status: "blocked";
      envKeyDetected: boolean;
      blockedEnvKeys: string[];
      message: string;
    };
  };
  providers: ProviderDiagnostic[];
};

export type ProviderDiagnosticContext = {
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  fileExists?: (filePath: string) => Promise<boolean> | boolean;
};

export type GenerationReferenceInput = {
  nodeId: string;
  role: string;
  title: string;
  sourceKind: string;
  steeringText?: string;
  assetId?: string;
  assetKind?: string;
  assetPath?: string;
  assetMetadata?: Record<string, unknown>;
};

export type GenerationProviderInput = {
  projectPath: string;
  runId: string;
  generationNodeId: string;
  iteration: number;
  prompt: string;
  negativePrompt: string;
  sections: Array<{
    nodeId: string;
    kind: "prompt" | "negativePrompt";
    section: string;
    title: string;
    text: string;
  }>;
  references: GenerationReferenceInput[];
  edgeRoles: Array<{ edgeId: string; role: string }>;
  requestedAt: string;
};

export type GeneratedArtifact = {
  fileName: string;
  mimeType: string;
  content?: string | Uint8Array;
  sourcePath?: string;
  metadata?: Record<string, unknown>;
};

export type ProviderGenerationResult = {
  providerId: string;
  providerName: string;
  capabilities: GenerationCapability[];
  artifacts: GeneratedArtifact[];
  metadata?: Record<string, unknown>;
};

export type ProviderProcessCall = {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
};

export type ProviderProcessResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

export type ProviderProcessRunner = (
  call: ProviderProcessCall
) => Promise<ProviderProcessResult>;

export interface GenerationProvider {
  readonly descriptor: ProviderDescriptor;
  diagnose(context?: ProviderDiagnosticContext): Promise<ProviderDiagnostic> | ProviderDiagnostic;
  generate(input: GenerationProviderInput): Promise<ProviderGenerationResult>;
}
