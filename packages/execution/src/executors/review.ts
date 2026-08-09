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
        candidateOutputVersionIds: [...new Set(context.inputs.map(reviewCandidateOutputVersionId))]
      }
    };
  }
}

/**
 * A new singleton Join batch boundary is only a transport wrapper around its
 * original candidates. Older (and ordinary) Join outputs retain their own
 * durable version IDs unless the Join explicitly marked the boundary.
 */
function reviewCandidateOutputVersionId(input: ExecutorContext["inputs"][number]): string {
  const referenceSourceOutputVersionId = input.metadata.referenceArtifactSourceOutputVersionId;
  if (
    input.metadata.referenceMemberKind === "embedded-artifact" &&
    typeof referenceSourceOutputVersionId === "string" &&
    referenceSourceOutputVersionId.length > 0
  ) {
    return referenceSourceOutputVersionId;
  }
  const sourceOutputVersionId = input.metadata.joinInputOutputVersionId;
  return input.metadata.joinBatchBoundary === true
    && typeof sourceOutputVersionId === "string"
    && sourceOutputVersionId.length > 0
    ? sourceOutputVersionId
    : input.source.outputVersionId;
}
