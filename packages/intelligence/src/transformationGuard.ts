import type { JsonValue, PromptWorkerConfig } from "@ether/schema";

import { instructionRequestsContrast, isTransformationBehavior } from "./behaviors.js";

export type WorkerOutputIssueCode =
  | "EMPTY_OUTPUT"
  | "OUTPUT_CHANNEL_MISMATCH"
  | "INVALID_JSON"
  | "UNKNOWN_OUTPUT_SCHEMA"
  | "INVALID_OUTPUT_SCHEMA"
  | "OUTPUT_LIMIT_EXCEEDED"
  | "INVALID_VALIDATION_ATTEMPT"
  | "SCHEMA_INVALID"
  | "CONVERSATIONAL_PREFACE"
  | "CHANGE_NARRATION";

export type WorkerOutputIssue = {
  code: WorkerOutputIssueCode;
  message: string;
  path?: string;
};

const conversationalPreface = /^(?:(?:sure|certainly|of course)(?![-\p{L}\p{N}_])[\s,!:;-]*(?:here(?:'s| is)\b[\s,!:;-]*)?|i(?:'ve| have)\s+(?:revised|updated|corrected)\b|(?:the\s+)?(?:revised|updated|corrected)\s+(?:content|prompt|text|result)\b)/iu;
const contrastiveNarration = /\binstead\s+of\b/i;

function inspectString(config: PromptWorkerConfig, output: string, path?: string): WorkerOutputIssue[] {
  const trimmed = output.trim();
  if (trimmed.length === 0) {
    return path === undefined ? [{ code: "EMPTY_OUTPUT", message: "The worker returned no content." }] : [];
  }

  const issues: WorkerOutputIssue[] = [];
  if (conversationalPreface.test(trimmed)) {
    issues.push({
      code: "CONVERSATIONAL_PREFACE",
      message: "Return the requested content without a conversational preface.",
      ...(path === undefined ? {} : { path })
    });
  }
  if (
    isTransformationBehavior(config.behavior)
    && contrastiveNarration.test(trimmed)
    && !instructionRequestsContrast(config.instruction)
  ) {
    issues.push({
      code: "CHANGE_NARRATION",
      message: "Return the transformed content without describing what it replaced.",
      ...(path === undefined ? {} : { path })
    });
  }
  return issues;
}

function propertyPath(path: string, property: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(property)
    ? `${path}.${property}`
    : `${path}[${JSON.stringify(property)}]`;
}

export function deduplicateWorkerOutputIssues(issues: readonly WorkerOutputIssue[]): WorkerOutputIssue[] {
  const unique = new Map<string, WorkerOutputIssue>();
  for (const issue of issues) {
    const key = `${issue.code}\u0000${issue.path ?? ""}\u0000${issue.message}`;
    if (!unique.has(key)) unique.set(key, issue);
  }
  return [...unique.values()].sort((left, right) =>
    (left.path ?? "$").localeCompare(right.path ?? "$")
    || left.message.localeCompare(right.message)
    || left.code.localeCompare(right.code)
  );
}

export function inspectTransformationOutput(config: PromptWorkerConfig, output: string): WorkerOutputIssue[] {
  return inspectString(config, output);
}

export function inspectStructuredTransformationOutput(
  config: PromptWorkerConfig,
  output: JsonValue,
  path = "$"
): WorkerOutputIssue[] {
  if (!isTransformationBehavior(config.behavior)) return [];
  if (!hasSubstantiveValue(output)) {
    return [{ code: "EMPTY_OUTPUT", message: "The worker returned no substantive content.", path }];
  }
  return inspectStructuredStringLeaves(config, output, path);
}

function hasSubstantiveValue(value: JsonValue): boolean {
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "boolean") return true;
  if (value === null) return false;
  if (Array.isArray(value)) return value.some(hasSubstantiveValue);
  return Object.values(value).some(hasSubstantiveValue);
}

function inspectStructuredStringLeaves(
  config: PromptWorkerConfig,
  output: JsonValue,
  path: string
): WorkerOutputIssue[] {
  if (typeof output === "string") return inspectString(config, output, path);
  if (Array.isArray(output)) {
    return deduplicateWorkerOutputIssues(output.flatMap((value, index) =>
      inspectStructuredStringLeaves(config, value, `${path}[${index}]`)
    ));
  }
  if (typeof output === "object" && output !== null) {
    return deduplicateWorkerOutputIssues(Object.keys(output).sort().flatMap((property) =>
      inspectStructuredStringLeaves(config, output[property]!, propertyPath(path, property))
    ));
  }
  return [];
}
