import { jsonObject, toProviderPayloads } from "./input.js";
import { requireFacet, type ExecutorContext, type ExecutorResult, type StepExecutor } from "./types.js";

export class MediaInterpretationExecutor implements StepExecutor {
  readonly kinds = ["asset-resolution"] as const;

  async execute(context: ExecutorContext): Promise<ExecutorResult> {
    const media = requireFacet(context.providers.media, "media interpretation");
    const result = await media.interpret({
      prompt: context.step.compiledPrompt,
      inputs: toProviderPayloads(context.inputs),
      model: typeof context.step.parameters.model === "string" ? context.step.parameters.model : undefined,
      reasoningEffort: typeof context.step.parameters.reasoningEffort === "string"
        ? context.step.parameters.reasoningEffort
        : undefined,
      signal: context.signal
    });
    return {
      kind: "complete",
      providerId: result.providerId,
      outputs: [{
        channel: "text",
        role: "general",
        content: { kind: "text", value: result.text },
        metadata: jsonObject(result.metadata)
      }]
    };
  }
}
