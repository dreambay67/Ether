export type GenerationCapability =
  | "image.generate"
  | "image.edit"
  | "image.reference-input"
  | "assistant.text"
  | "assistant.vision"
  | "evaluation.vision";

export const PROVIDER_PAYLOAD_CHANNELS = ["text", "image", "mask", "data", "video", "audio"] as const;

export type ProviderPayloadChannel = (typeof PROVIDER_PAYLOAD_CHANNELS)[number];

export const PROVIDER_CONNECTION_ROLES = [
  "general",
  "negative",
  "subject",
  "product",
  "face",
  "clothing",
  "pose",
  "setting",
  "composition",
  "style",
  "lighting",
  "colourPalette",
  "typography",
  "motion",
  "timing"
] as const;

export type ProviderConnectionRole = (typeof PROVIDER_CONNECTION_ROLES)[number];

export type PayloadEnvelope = {
  id?: string;
  channel: ProviderPayloadChannel;
  role?: ProviderConnectionRole;
  uri?: string;
  assetPath?: string;
  mimeType?: string;
  text?: string;
  data?: unknown;
  metadata?: Record<string, unknown>;
  sourceNodeId?: string;
  sourceEdgeId?: string;
  assetId?: string;
  lineage?: {
    parentIds?: string[];
    sourceOperation?: ProviderOperation;
    metadata?: Record<string, unknown>;
  };
};

export type ProviderOperation =
  | "image.generate"
  | "image.edit"
  | "assistant.text"
  | "assistant.vision"
  | "evaluation.vision"
  | "adapter.transcribe"
  | "adapter.caption"
  | "adapter.extract"
  | "adapter.interpret"
  | "adapter.transform"
  | "adapter.serialize";

export type ProviderCapabilitySource =
  | "codex-cli"
  | "simulation"
  | "api-slot"
  | "adapter-slot"
  | "unconfigured-provider";

export type ProviderMediaLimits = {
  maxInputs?: number;
  maxInputBytes?: number;
  maxOutputBytes?: number;
  maxDurationSeconds?: number;
  maxWidth?: number;
  maxHeight?: number;
  mimeTypes?: string[];
  notes?: string[];
};

export type ProviderAvailability = "available" | "unavailable";

export type ProviderMode = "real" | "simulation" | "experimental";

export type ProviderMatrixStatus = "ready" | "unavailable" | "experimental";

export type ProviderRoute =
  | "local-fake"
  | "codex-cli"
  | "unconfigured-clean-cli-or-mcp"
  | "adapter"
  | "api-generation"
  | "api-assistant";

export type ProviderCapabilityProfile = {
  providerId: string;
  providerName?: string;
  route: ProviderRoute;
  operation: ProviderOperation;
  inputChannels: readonly ProviderPayloadChannel[];
  outputChannels: readonly ProviderPayloadChannel[];
  availability: ProviderAvailability;
  status: ProviderMatrixStatus;
  capabilitySource: ProviderCapabilitySource;
  requiresExplicitSelection: boolean;
  noHiddenFallback: boolean;
  model?: string;
  unavailableReason?: string;
  messages?: string[];
  mediaLimits?: ProviderMediaLimits;
};

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
  profiles?: ProviderCapabilityProfile[];
  details?: Record<string, unknown>;
  readiness?: import("./api/types.js").ApiProviderReadiness;
  credentialStatus?: import("./api/types.js").ApiCredentialStatus;
  requestPolicy?: import("./api/types.js").ApiRequestPolicy;
  dataDisclosure?: import("./api/types.js").ApiDataDisclosure;
  noHiddenFallback?: true;
};

export type ProviderCapabilityMatrixEntry = {
  id: string;
  displayName: string;
  name: string;
  route: ProviderRoute;
  availability: ProviderAvailability;
  status: ProviderMatrixStatus;
  mode: ProviderMode;
  capabilities: GenerationCapability[];
  profiles: ProviderCapabilityProfile[];
  messages: string[];
  details?: Record<string, unknown>;
  unavailableReason?: string;
  model?: string;
  notes?: string[];
  readiness?: import("./api/types.js").ApiProviderReadiness;
  credentialStatus?: import("./api/types.js").ApiCredentialStatus;
  requestPolicy?: import("./api/types.js").ApiRequestPolicy;
  dataDisclosure?: import("./api/types.js").ApiDataDisclosure;
  noHiddenFallback?: true;
  noApiPolicy: "openai-platform-api-blocked";
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
  matrix: ProviderCapabilityMatrixEntry[];
  optionalApiProviders?: {
    generation: import("./api/types.js").ApiProviderDiagnostic;
    assistant: import("./api/types.js").ApiProviderDiagnostic;
  };
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

export type GenerationOutputSettings = {
  aspectRatio: string;
  resolution: string;
  width: number;
  height: number;
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
  outputCount: number;
  inputs?: PayloadEnvelope[];
  output?: GenerationOutputSettings;
  requestedAt: string;
};

export type ImageEditOperation = "inpaint" | "outpaint" | "draw-note" | "upscale";

export type ImageEditSourceInput = {
  assetId?: string;
  assetKind?: string;
  assetPath: string;
  assetMetadata?: Record<string, unknown>;
};

export type ImageEditMaskInput = {
  assetId?: string;
  assetPath?: string;
  assetMetadata?: Record<string, unknown>;
} | null;

export type ImageEditRecipeInput = {
  id: string;
  label?: string;
  metadata?: Record<string, unknown>;
};

export type ImageEditFrameInput = {
  mode: "source" | "crop" | "outpaint";
  x: number;
  y: number;
  width: number;
  height: number;
  canvasWidth?: number;
  canvasHeight?: number;
};

export type ImageEditProviderInput = {
  projectPath: string;
  runId: string;
  editNodeId: string;
  editSubtype: string;
  operation: ImageEditOperation;
  iteration: number;
  prompt: string;
  negativePrompt: string;
  instruction: string;
  notes: string;
  sections: GenerationProviderInput["sections"];
  references: GenerationReferenceInput[];
  edgeRoles: GenerationProviderInput["edgeRoles"];
  sourceImage: ImageEditSourceInput;
  mask: ImageEditMaskInput;
  recipe?: ImageEditRecipeInput;
  frame?: ImageEditFrameInput;
  inputs?: PayloadEnvelope[];
  requestedAt: string;
};

export type AssistantProviderInput = {
  projectPath: string;
  runId: string;
  assistantNodeId: string;
  assistantSubtype: string;
  prompt: string;
  instruction: string;
  notes: string;
  sections: GenerationProviderInput["sections"];
  references: GenerationReferenceInput[];
  edgeRoles: GenerationProviderInput["edgeRoles"];
  inputs?: PayloadEnvelope[];
  requestedAt: string;
};

export type VisionEvaluationImageInput = {
  id: string;
  nodeId: string;
  title: string;
  assetId?: string;
  assetKind?: string;
  assetPath: string;
  assetMetadata?: Record<string, unknown>;
  tags?: string[];
  decision?: string;
  notes?: string;
};

export type VisionEvaluationProviderInput = {
  projectPath: string;
  runId: string;
  evaluationNodeId: string;
  instruction: string;
  criteria: string;
  threshold: number;
  images: VisionEvaluationImageInput[];
  inputs?: PayloadEnvelope[];
  requestedAt: string;
};

export type VisionEvaluationDecision = "pass" | "needs-edit" | "fail";

export type VisionEvaluationItemResult = {
  id: string;
  assetId?: string;
  assetPath?: string;
  score: number;
  tags: string[];
  decision: VisionEvaluationDecision;
  confidence: number;
  explanation: string;
  detectedIssues: string[];
};

export type VisionEvaluationProviderResult = {
  providerId: string;
  providerName: string;
  capabilities: GenerationCapability[];
  items: VisionEvaluationItemResult[];
  summary: string;
  outputs?: PayloadEnvelope[];
  metadata?: Record<string, unknown>;
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
  outputs?: PayloadEnvelope[];
  metadata?: Record<string, unknown>;
};

export type ProviderAssistantResult = {
  providerId: string;
  providerName: string;
  capabilities: GenerationCapability[];
  text: string;
  outputs?: PayloadEnvelope[];
  metadata?: Record<string, unknown>;
};

export type ProviderProcessCall = {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  stdin?: string;
};

export type ProviderProcessResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

export type ProviderExecutionContext<TResult = ProviderGenerationResult> = {
  signal: AbortSignal;
  providerAttemptId: string;
  attemptOrdinal: number;
  stagingDirectory: string;
  complete: (result: TResult) => Promise<void>;
};

export type ProviderProcessRunner = (
  call: ProviderProcessCall
) => Promise<ProviderProcessResult>;

export interface GenerationProvider {
  readonly descriptor: ProviderDescriptor;
  diagnose(context?: ProviderDiagnosticContext): Promise<ProviderDiagnostic> | ProviderDiagnostic;
  generate(
    input: GenerationProviderInput,
    context?: ProviderExecutionContext
  ): Promise<ProviderGenerationResult>;
  edit(
    input: ImageEditProviderInput,
    context?: ProviderExecutionContext
  ): Promise<ProviderGenerationResult>;
}

export interface AssistantProvider {
  readonly descriptor: ProviderDescriptor;
  diagnose(context?: ProviderDiagnosticContext): Promise<ProviderDiagnostic> | ProviderDiagnostic;
  run(
    input: AssistantProviderInput,
    context?: ProviderExecutionContext<ProviderAssistantResult>
  ): Promise<ProviderAssistantResult>;
}

export interface VisionEvaluationProvider {
  readonly descriptor: ProviderDescriptor;
  diagnose(context?: ProviderDiagnosticContext): Promise<ProviderDiagnostic> | ProviderDiagnostic;
  evaluate(
    input: VisionEvaluationProviderInput,
    context?: ProviderExecutionContext<VisionEvaluationProviderResult>
  ): Promise<VisionEvaluationProviderResult>;
}
