import type { PayloadChannel } from "@ether/schema";

import { jsonObject, jsonValue, toProviderPayloads } from "./input.js";
import { requireFacet, type ExecutorContext, type ExecutorPayloadDraft, type ExecutorResult, type StepExecutor } from "./types.js";

export class WorkerExecutor implements StepExecutor {
  readonly kinds = ["codex-llm", "codex-evaluation"] as const;

  async execute(context: ExecutorContext): Promise<ExecutorResult> {
    if (context.step.executor === "codex-evaluation") return this.evaluate(context);
    const worker = requireFacet(context.providers.worker, "Codex worker");
    const result = await worker.run({
      projectPath: context.stagingDirectory,
      runId: context.claim.job.id,
      assistantNodeId: context.step.nodeId,
      assistantSubtype: String(context.step.parameters.behavior ?? "custom"),
      prompt: context.step.compiledPrompt,
      instruction: String(context.step.parameters.instruction ?? context.step.compiledPrompt),
      notes: "",
      sections: [],
      references: [],
      edgeRoles: [],
      inputs: context.providerInputs,
      model: typeof context.step.parameters.model === "string" ? context.step.parameters.model : undefined,
      reasoningEffort: typeof context.step.parameters.reasoningEffort === "string"
        ? context.step.parameters.reasoningEffort
        : undefined,
      requestedAt: context.claim.attempt.startedAt ?? context.claim.attempt.createdAt
    }, {
      signal: context.signal,
      providerAttemptId: context.claim.providerAttemptId,
      attemptOrdinal: context.claim.attempt.ordinal,
      stagingDirectory: context.stagingDirectory,
      complete: async () => undefined
    });
    return { kind: "complete", outputs: assistantOutputs(result, context.step.parameters.outputChannel) };
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
      projectPath: context.stagingDirectory,
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
    return {
      kind: "complete",
      outputs: [{
        channel: "data",
        role: "general",
        content: { kind: "object", value: { summary: result.summary, items: result.items }, schemaId: "ether.evaluation.v1" },
        metadata: jsonObject(result.metadata)
      }]
    };
  }
}

function assistantOutputs(
  result: { text: string; outputs?: Array<{ channel: string; role?: string; text?: string; data?: unknown; metadata?: Record<string, unknown> }> },
  configuredChannel: unknown
): ExecutorPayloadDraft[] {
  const channel: PayloadChannel = configuredChannel === "data" ? "data" : "text";
  const explicit = result.outputs?.filter((output) => output.channel === "text" || output.channel === "data") ?? [];
  if (explicit.length === 0) {
    return [{
      channel,
      role: "general",
      content: channel === "text" ? { kind: "text", value: result.text } : { kind: "object", value: jsonValue({ text: result.text }) },
      metadata: {}
    }];
  }
  return explicit.map((output) => ({
    channel: output.channel as PayloadChannel,
    role: isRole(output.role) ? output.role : "general",
    content: output.channel === "text"
      ? { kind: "text", value: output.text ?? result.text }
      : { kind: "object", value: jsonValue(output.data ?? { text: result.text }) },
    metadata: jsonObject(output.metadata)
  }));
}

function isRole(value: unknown): value is ExecutorPayloadDraft["role"] {
  return [
    "general", "negative", "subject", "product", "face", "clothing", "pose", "setting", "composition",
    "style", "lighting", "colourPalette", "typography", "motion", "timing"
  ].includes(String(value));
}
