import type {
  AssistantProvider,
  GenerationProvider,
  PayloadEnvelope as ProviderPayloadEnvelope,
  VisionEvaluationProvider
} from "@ether/providers";
import type {
  ConnectionRole,
  ExecutionPlan,
  JsonObject,
  NodeExecutorKind,
  PayloadChannel,
  PayloadContent,
  PlanStep,
  PlannedWorkItem,
  PayloadEnvelope
} from "@ether/schema";

export type ExecutorClaim = {
  plan: ExecutionPlan;
  job: {
    id: string;
    requestedParallelism?: number;
    effectiveParallelism?: number;
    status: string;
  };
  workItem: {
    id: string;
    plannedWorkItemId: string;
    status: string;
  };
  attempt: {
    id: string;
    ordinal: number;
    status: string;
    startedAt: string | null;
    createdAt: string;
  };
  providerAttemptId: string;
};

export type ExecutorPayloadDraft = {
  channel: PayloadChannel;
  role: ConnectionRole;
  content: PayloadContent;
  metadata?: JsonObject;
};

export type LocalMediaOutput = {
  channel: "image" | "mask";
  role: ConnectionRole;
  fileName: string;
  mediaType: string;
  metadata?: JsonObject;
  stagedPath: string;
};

export type ExecutorResult =
  | {
      kind: "complete";
      /** Provider identity returned by a provider-backed executor. */
      providerId?: string;
      outputs: ExecutorPayloadDraft[];
      effects?: Array<Record<string, unknown>>;
      adapterIntermediates?: Array<{
        adapterId: string;
        inputPayloadIds: string[];
        outputPayloadIds: string[];
        metadata?: Record<string, unknown>;
      }>;
    }
  | {
      kind: "provider-generation";
      provider: ImageFacet;
      operation: "generate" | "edit";
      input: import("@ether/providers").GenerationProviderInput | import("@ether/providers").ImageEditProviderInput;
      expectedOutputCount: number;
    }
  | { kind: "local-media"; outputs: LocalMediaOutput[] }
  | {
      kind: "waiting-review";
      checkpoint: {
        candidateOutputVersionIds: string[];
        selectionMode: "one" | "many";
        minimumSelections: number;
      };
    };

export type WorkerFacet = Pick<AssistantProvider, "run">;
export type EvaluationFacet = Pick<VisionEvaluationProvider, "evaluate">;
export type ImageFacet = Pick<GenerationProvider, "generate" | "edit" | "descriptor">;

export type MediaInterpretationFacet = {
  interpret(input: {
    prompt: string;
    inputs: ProviderPayloadEnvelope[];
    model?: string;
    reasoningEffort?: string;
    signal: AbortSignal;
  }): Promise<{ providerId: string; text: string; metadata?: Record<string, unknown> }>;
};

export type LocalMediaFacet = {
  transform(input: {
    operation: "resize" | "crop" | "rotate" | "upscale" | "mask";
    inputs: PayloadEnvelope[];
    parameters: JsonObject;
    signal: AbortSignal;
    stagingDirectory: string;
  }): Promise<LocalMediaOutput[]>;
};

export type CollectionFacet = {
  apply(input: {
    collectionId: string;
    collectionTitle: string;
    mode: "add" | "replace";
    makePrimary: boolean;
    payloads: PayloadEnvelope[];
  }): Promise<{ collectionId: string; memberCount: number }>;
};

export type ExportFacet = {
  export(input: {
    pathGrantId: string;
    namingTemplate: string;
    format: "original" | "png" | "jpeg" | "webp";
    collisionPolicy: "rename" | "skip" | "error";
    includeMetadata: boolean;
    payloads: PayloadEnvelope[];
    signal: AbortSignal;
  }): Promise<{ exported: number; skipped: number; paths: string[] }>;
};

export type ExecutionProviderFacets = {
  image?: ImageFacet;
  worker?: WorkerFacet;
  evaluation?: EvaluationFacet;
  media?: MediaInterpretationFacet;
  localMedia?: LocalMediaFacet;
  collection?: CollectionFacet;
  export?: ExportFacet;
};

export type ExecutionProviderResolver = (input: {
  binding: PlanStep["providerBinding"];
  step: PlanStep;
}) => ExecutionProviderFacets | Promise<ExecutionProviderFacets>;

export type ExecutorContext = {
  claim: ExecutorClaim;
  step: PlanStep;
  plannedWorkItem: PlannedWorkItem;
  inputs: PayloadEnvelope[];
  providerInputs: ProviderPayloadEnvelope[];
  signal: AbortSignal;
  stagingDirectory: string;
  providers: ExecutionProviderFacets;
};

export interface StepExecutor {
  readonly kinds: readonly NodeExecutorKind[];
  execute(context: ExecutorContext): Promise<ExecutorResult>;
}

export class ExecutorFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = false,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "ExecutorFailure";
  }
}

export function requireFacet<T>(facet: T | undefined, capability: string): T {
  if (facet === undefined) {
    throw new ExecutorFailure(
      "PROVIDER_FACET_UNAVAILABLE",
      `This execution requires the ${capability} provider facet, but it was not selected for this run.`
    );
  }
  return facet;
}
