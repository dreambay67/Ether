import type { ExecutorContext, ExecutorResult, StepExecutor } from "./types.js";

export class AssemblyExecutor implements StepExecutor {
  readonly kinds = ["deterministic-assembly"] as const;

  async execute(context: ExecutorContext): Promise<ExecutorResult> {
    const parts = context.inputs
      .filter((input) => input.channel === "text")
      .map((input) => input.content.kind === "text" ? `${title(input.role)}: ${input.content.value}` : "")
      .filter((value) => value.length > 0);
    const body = parts.length > 0 ? parts.join("\n\n") : context.step.compiledPrompt;
    return {
      kind: "complete",
      outputs: [{ channel: "text", role: "general", content: { kind: "text", value: body }, metadata: {} }]
    };
  }
}

function title(value: string): string {
  return value.length === 0 ? value : `${value[0]!.toUpperCase()}${value.slice(1)}`;
}
