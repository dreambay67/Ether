import { ExecutorFailure, type ExecutorContext, type ExecutorResult, type StepExecutor } from "./types.js";

export class ReviewExecutor implements StepExecutor {
  readonly kinds = ["human-checkpoint"] as const;

  async execute(context: ExecutorContext): Promise<ExecutorResult> {
    const selectionMode = context.step.parameters.selectionMode;
    const minimumSelections = context.step.parameters.minimumSelections;
    if ((selectionMode !== "one" && selectionMode !== "many") || typeof minimumSelections !== "number") {
      throw new ExecutorFailure("REVIEW_CONFIGURATION_INVALID", "Compare requires a valid selection mode and minimum selection count.");
    }
    if (!Number.isInteger(minimumSelections) || minimumSelections < 0) {
      throw new ExecutorFailure("REVIEW_CONFIGURATION_INVALID", "Compare minimum selections must be a non-negative integer.");
    }
    return {
      kind: "waiting-review",
      checkpoint: {
        selectionMode,
        minimumSelections,
        candidateOutputVersionIds: [...new Set(context.inputs.map((input) => input.source.outputVersionId))]
      }
    };
  }
}
