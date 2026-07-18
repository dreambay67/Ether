import type { PromptWorkerConfig } from "@ether/schema";

import { instructionRequestsContrast, isTransformationBehavior } from "./behaviors.js";

export type WorkerOutputIssueCode =
  | "EMPTY_OUTPUT"
  | "OUTPUT_CHANNEL_MISMATCH"
  | "INVALID_JSON"
  | "UNKNOWN_OUTPUT_SCHEMA"
  | "SCHEMA_INVALID"
  | "CONVERSATIONAL_PREFACE"
  | "CHANGE_NARRATION";

export type WorkerOutputIssue = {
  code: WorkerOutputIssueCode;
  message: string;
  path?: string;
};

const conversationalPreface = /^(?:sure\b|certainly\b|of course\b|here(?:'s| is)\b|i(?:'ve| have)\b|the revised\b|updated (?:content|prompt)\b)[\s,:-]*/i;
const contrastiveNarration = /\binstead\s+of\b/i;

export function inspectTransformationOutput(config: PromptWorkerConfig, output: string): WorkerOutputIssue[] {
  const trimmed = output.trim();
  if (trimmed.length === 0) {
    return [{ code: "EMPTY_OUTPUT", message: "The worker returned no content." }];
  }

  const issues: WorkerOutputIssue[] = [];
  if (conversationalPreface.test(trimmed)) {
    issues.push({
      code: "CONVERSATIONAL_PREFACE",
      message: "Return the requested content without a conversational preface."
    });
  }
  if (
    isTransformationBehavior(config.behavior)
    && contrastiveNarration.test(trimmed)
    && !instructionRequestsContrast(config.instruction)
  ) {
    issues.push({
      code: "CHANGE_NARRATION",
      message: "Return the transformed content without describing what it replaced."
    });
  }
  return issues;
}
