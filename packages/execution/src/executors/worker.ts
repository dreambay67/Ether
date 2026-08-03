import {
  PromptWorkerConfigSchema,
  WorkerRequestSchema,
  type JsonObject,
  type PayloadChannel,
  type PayloadEnvelope,
  type WorkerRequest
} from "@ether/schema";
import {
  validateWorkerOutput,
  type StructuredOutputSchema
} from "@ether/intelligence";

import { jsonObject, jsonValue, toProviderPayloads } from "./input.js";
import { ExecutorFailure, requireFacet, type ExecutorContext, type ExecutorPayloadDraft, type ExecutorResult, type StepExecutor } from "./types.js";

export class WorkerExecutor implements StepExecutor {
  readonly kinds = ["codex-llm", "codex-evaluation"] as const;

  async execute(context: ExecutorContext): Promise<ExecutorResult> {
    if (context.step.executor === "codex-evaluation") return this.evaluate(context);
    const worker = requireFacet(context.providers.worker, "Codex worker");
    const runtime = workerRuntime(context);
    const configured = PromptWorkerConfigSchema.parse(context.step.parameters);
    const request = WorkerRequestSchema.parse(runtime.request);
    const inputs = boundedWorkerInputs(context.inputs, request, runtime);
    const run = async (instruction: string) => worker.run({
      workspacePath: context.stagingDirectory,
      runId: context.claim.job.id,
      assistantNodeId: context.step.nodeId,
      assistantSubtype: request.behavior,
      prompt: composeWorkerPrompt(context.step.compiledPrompt, inputs),
      instruction,
      notes: "",
      sections: [],
      references: [],
      edgeRoles: [],
      inputs: toProviderPayloads(inputs).map((input) => ({
        ...input,
        metadata: { ...input.metadata, ...(runtime.memoryScopeKey === null ? {} : { memoryScopeKey: runtime.memoryScopeKey }) }
      })),
      contextPolicy: request.contextPolicy,
      memoryScopeKey: runtime.memoryScopeKey,
      outputContract: request.outputContract,
      ...(runtime.outputSchema === undefined ? {} : { outputSchema: runtime.outputSchema }),
      downstream: request.downstream,
      contextManifest: runtime.manifest,
      reviewPolicy: configured.reviewPolicy ?? "inspect-first",
      model: request.model,
      reasoningEffort: request.reasoningEffort,
      requestedAt: context.claim.attempt.startedAt ?? context.claim.attempt.createdAt
    }, {
      signal: context.signal,
      providerAttemptId: context.claim.providerAttemptId,
      attemptOrdinal: context.claim.attempt.ordinal,
      stagingDirectory: context.stagingDirectory,
      complete: async () => undefined
    });
    let result = await run(request.instruction);
    let values = providerOutputValues(result, request.outputContract.channel);
    if (values.length !== configured.outputContract.count) {
      throw new ExecutorFailure(
        "WORKER_OUTPUT_COUNT_MISMATCH",
        `Worker returned ${values.length} ${request.outputContract.channel} output${values.length === 1 ? "" : "s"}; this immutable plan requires ${configured.outputContract.count}.`
      );
    }
    let validations = values.map((output) => validateWorkerOutput({
      config: configured,
      output: validationInput(output, request.outputContract.channel),
      schemaCatalog: runtime.schemaCatalog,
      attempt: 0
    }));
    if (values.length === 1 && !validations[0]!.accepted && validations[0]!.correctiveRetry !== null) {
      result = await run(`${request.instruction}\n\n${validations[0]!.correctiveRetry.instruction}`);
      values = providerOutputValues(result, request.outputContract.channel);
      if (values.length !== 1) {
        throw new ExecutorFailure("WORKER_OUTPUT_COUNT_MISMATCH", "Worker corrective retry did not return exactly one output.");
      }
      validations = [validateWorkerOutput({
        config: configured,
        output: validationInput(values[0], request.outputContract.channel),
        schemaCatalog: runtime.schemaCatalog,
        attempt: 1
      })];
    }
    const invalid = validations.find((validation) => !validation.accepted || validation.value === null);
    if (invalid !== undefined) {
      throw new ExecutorFailure(
        "WORKER_OUTPUT_INVALID",
        invalid.issues.map((issue) => `${issue.path ?? "$"}: ${issue.message}`).join(" ") || "Worker output failed validation."
      );
    }
    return {
      kind: "complete",
      outputs: validations.map((validation) => validatedAssistantOutput(validation.value!, request, runtime))
    };
  }

  private async evaluate(context: ExecutorContext): Promise<ExecutorResult> {
    const evaluation = requireFacet(context.providers.evaluation, "Codex evaluation");
    const images = context.inputs
      .filter((input) => input.channel === "image")
      .map((input) => {
        const assetPath = typeof input.metadata.assetPath === "string" ? input.metadata.assetPath : undefined;
        if (assetPath === undefined) {
          throw new Error(`Evaluation input ${input.id} has no local artifact path.`);
        }
        return {
          id: input.id,
          nodeId: input.source.nodeId,
          title: input.id,
          assetId: input.content.kind === "artifact" ? input.content.artifactId : undefined,
          assetPath
        };
      });
    const result = await evaluation.evaluate({
      workspacePath: context.stagingDirectory,
      runId: context.claim.job.id,
      evaluationNodeId: context.step.nodeId,
      instruction: context.step.compiledPrompt,
      criteria: JSON.stringify(context.step.parameters.rubric ?? []),
      threshold: typeof context.step.parameters.threshold === "number" ? context.step.parameters.threshold : 0,
      images,
      inputs: toProviderPayloads(context.inputs),
      model: typeof context.step.parameters.model === "string" ? context.step.parameters.model : undefined,
      reasoningEffort: typeof context.step.parameters.reasoningEffort === "string"
        ? context.step.parameters.reasoningEffort
        : undefined,
      requestedAt: context.claim.attempt.startedAt ?? context.claim.attempt.createdAt
    });
    const rubric = Array.isArray(context.step.parameters.rubric) ? context.step.parameters.rubric : [];
    const modelId = typeof context.step.parameters.model === "string"
      ? context.step.parameters.model
      : typeof result.metadata?.modelId === "string"
        ? result.metadata.modelId
        : "provider-default";
    const provenance = jsonObject({
      ...result.metadata,
      evaluationProviderId: result.providerId,
      evaluationModelId: modelId,
      evaluationInstruction: context.step.compiledPrompt,
      evaluationRubric: rubric,
      evaluationReasoningEffort: typeof context.step.parameters.reasoningEffort === "string"
        ? context.step.parameters.reasoningEffort
        : null
    });
    return {
      kind: "complete",
      outputs: [{
        channel: "data",
        role: "general",
        content: { kind: "object", value: { summary: result.summary, items: result.items }, schemaId: "ether.evaluation.v1" },
        metadata: provenance
      }, {
        channel: "text",
        role: "general",
        content: { kind: "text", value: result.summary },
        metadata: provenance
      }, ...context.inputs
        .filter((input) => input.channel !== "text" && input.channel !== "data")
        .map((input) => ({
          channel: input.channel,
          role: input.role,
          content: input.content,
          metadata: { ...input.metadata, ...provenance, evaluationPassthrough: true }
        }))]
    };
  }
}

type WorkerRuntime = {
  request: WorkerRequest;
  manifest: JsonObject;
  memoryScopeKey: string | null;
  schemaCatalog: StructuredOutputSchema[];
  inputChannels: PayloadChannel[];
  maxReferences: number;
  outputSchema?: JsonObject;
};

function workerRuntime(context: ExecutorContext): WorkerRuntime {
  const value = context.step.compiledContext.worker;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ExecutorFailure("WORKER_RUNTIME_CONTRACT_MISSING", "This Worker plan has no immutable runtime contract. Preview it again before running.");
  }
  const runtime = value as Record<string, unknown>;
  const request = WorkerRequestSchema.safeParse(runtime.request);
  if (!request.success) {
    throw new ExecutorFailure("WORKER_RUNTIME_CONTRACT_INVALID", `The persisted Worker request is invalid: ${request.error.message}`);
  }
  const manifest = jsonObject(runtime.manifest);
  const memoryScopeKey = runtime.memoryScopeKey === null || typeof runtime.memoryScopeKey === "string"
    ? runtime.memoryScopeKey
    : null;
  const schemaCatalog = Array.isArray(runtime.schemaCatalog)
    ? runtime.schemaCatalog.filter((schema): schema is StructuredOutputSchema =>
      schema !== null && typeof schema === "object" && !Array.isArray(schema) && typeof (schema as Record<string, unknown>).id === "string"
    )
    : [];
  const outputSchema = runtime.outputSchema === null || runtime.outputSchema === undefined
    ? undefined
    : jsonObject(runtime.outputSchema);
  const inputChannels = Array.isArray(runtime.inputChannels)
    ? runtime.inputChannels.filter((channel): channel is PayloadChannel =>
      channel === "text" || channel === "image" || channel === "mask" || channel === "data" || channel === "video" || channel === "audio"
    )
    : [];
  const maxReferences = typeof runtime.maxReferences === "number" && Number.isInteger(runtime.maxReferences) && runtime.maxReferences >= 0
    ? runtime.maxReferences
    : 0;
  return { request: request.data, manifest, memoryScopeKey, schemaCatalog, inputChannels, maxReferences, ...(outputSchema === undefined ? {} : { outputSchema }) };
}

function boundedWorkerInputs(
  inputs: readonly PayloadEnvelope[],
  request: WorkerRequest,
  runtime: WorkerRuntime
): PayloadEnvelope[] {
  if (!request.contextPolicy.includeUpstream) return [];
  let textTokens = 0;
  let media = 0;
  return inputs.filter((input) => {
    if (!runtime.inputChannels.includes(input.channel)) return false;
    if (input.channel === "image" || input.channel === "mask" || input.channel === "video" || input.channel === "audio") {
      if (media >= runtime.maxReferences) return false;
      media += 1;
      return true;
    }
    const text = input.content.kind === "text"
      ? input.content.value
      : input.content.kind === "object" ? JSON.stringify(input.content.value) : "";
    const estimated = Math.ceil(text.length / 4);
    if (textTokens + estimated > request.contextPolicy.maxTokens) return false;
    textTokens += estimated;
    return true;
  });
}

function composeWorkerPrompt(base: string, inputs: readonly PayloadEnvelope[]): string {
  const sections = inputs.flatMap((input) => {
    const value = input.content.kind === "text"
      ? input.content.value
      : input.content.kind === "object" ? JSON.stringify(input.content.value) : null;
    return value === null ? [] : [`${roleLabel(input.role)}: ${value}`];
  });
  return [base, ...sections].filter((value) => value.trim().length > 0).join("\n\n");
}

function providerOutputValues(
  result: { text: string; outputs?: Array<{ channel: string; text?: string; data?: unknown }> },
  channel: "text" | "data"
): unknown[] {
  const explicit = result.outputs?.flatMap((output) => {
    if (output.channel !== channel) return [];
    if (channel === "text") return typeof output.text === "string" ? [output.text] : [];
    return output.data === undefined ? [] : [output.data];
  }) ?? [];
  if (explicit.length > 0) return explicit;
  return [result.text];
}

function validationInput(output: unknown, channel: "text" | "data"): string | import("@ether/schema").JsonValue {
  if (channel === "text") return typeof output === "string" ? output : JSON.stringify(output);
  return typeof output === "string" ? output : jsonValue(output);
}

function validatedAssistantOutput(
  value: string | import("@ether/schema").JsonValue,
  request: WorkerRequest,
  runtime: WorkerRuntime
): ExecutorPayloadDraft {
  const metadata = jsonObject({
    worker: {
      contextManifest: runtime.manifest,
      memoryScopeKey: runtime.memoryScopeKey,
      outputContract: request.outputContract,
      downstream: request.downstream
    }
  });
  if (request.outputContract.channel === "text") {
    return { channel: "text", role: "general", content: { kind: "text", value: String(value) }, metadata };
  }
  return {
    channel: "data",
    role: "general",
    content: {
      kind: "object",
      value: jsonValue(value),
      ...(request.outputContract.schemaId === undefined ? {} : { schemaId: request.outputContract.schemaId })
    },
    metadata
  };
}

function roleLabel(role: ExecutorPayloadDraft["role"]): string {
  if (role === "general") return "Context";
  return role.replace(/([A-Z])/g, " $1").replace(/^./, (value) => value.toUpperCase());
}
