import { readFile } from "node:fs/promises";
import type {
  AssistantProviderInput,
  VisionEvaluationItemResult,
  VisionEvaluationProviderInput
} from "../types.js";

export type AssistantWorkerRequest = AssistantProviderInput & {
  outputDirectory: string;
};

export type CodexAssistantWorkerResult = {
  id: string;
  status: string;
  text: string;
  error: string | null;
  caveats: string;
};

export type EvaluationWorkerRequest = VisionEvaluationProviderInput & {
  outputDirectory: string;
};

export type CodexEvaluationWorkerResult = {
  id: string;
  status: string;
  items: VisionEvaluationItemResult[];
  summary: string;
  error: string | null;
  caveats: string;
};

export function createAssistantWorkerRequest(
  input: AssistantProviderInput,
  outputDirectory: string
): AssistantWorkerRequest {
  const request = { ...input, outputDirectory };
  assertAssistantWorkerRequest(request);
  return request;
}

export function createEvaluationWorkerRequest(
  input: VisionEvaluationProviderInput,
  outputDirectory: string
): EvaluationWorkerRequest {
  const request = { ...input, outputDirectory };
  assertEvaluationWorkerRequest(request);
  return request;
}

export function assertAssistantWorkerRequest(value: unknown): asserts value is AssistantWorkerRequest {
  assertObject(value, "Codex assistant worker request");
  assertString(value.workspacePath, "Codex assistant worker request.workspacePath");
  assertString(value.runId, "Codex assistant worker request.runId");
  assertString(value.assistantNodeId, "Codex assistant worker request.assistantNodeId");
  assertString(value.assistantSubtype, "Codex assistant worker request.assistantSubtype");
  assertString(value.prompt, "Codex assistant worker request.prompt");
  assertString(value.instruction, "Codex assistant worker request.instruction");
  assertString(value.notes, "Codex assistant worker request.notes");
  assertSectionArray(value.sections, "Codex assistant worker request.sections");
  assertReferenceArray(value.references, "Codex assistant worker request.references");
  assertEdgeRoleArray(value.edgeRoles, "Codex assistant worker request.edgeRoles");
  assertString(value.requestedAt, "Codex assistant worker request.requestedAt");
  assertString(value.outputDirectory, "Codex assistant worker request.outputDirectory");
}

export function assertEvaluationWorkerRequest(value: unknown): asserts value is EvaluationWorkerRequest {
  assertObject(value, "Codex evaluation worker request");
  assertString(value.workspacePath, "Codex evaluation worker request.workspacePath");
  assertString(value.runId, "Codex evaluation worker request.runId");
  assertString(value.evaluationNodeId, "Codex evaluation worker request.evaluationNodeId");
  assertString(value.instruction, "Codex evaluation worker request.instruction");
  assertString(value.criteria, "Codex evaluation worker request.criteria");
  assertNumber(value.threshold, "Codex evaluation worker request.threshold");
  assertEvaluationImageArray(value.images, "Codex evaluation worker request.images");
  assertString(value.outputDirectory, "Codex evaluation worker request.outputDirectory");
  assertString(value.requestedAt, "Codex evaluation worker request.requestedAt");
}

export async function readAssistantWorkerResult(resultPath: string): Promise<CodexAssistantWorkerResult> {
  const parsed = await readWorkerJson(resultPath, "Codex assistant worker");
  assertObject(parsed, "Codex assistant worker result.json");

  return {
    id: requiredString(parsed.id, "Codex assistant worker result.json id"),
    status: requiredString(parsed.status, "Codex assistant worker result.json status"),
    text: requiredString(parsed.text, "Codex assistant worker result.json text"),
    error: requiredNullableString(parsed.error, "Codex assistant worker result.json error"),
    caveats: requiredString(parsed.caveats, "Codex assistant worker result.json caveats")
  };
}

export async function readEvaluationWorkerResult(resultPath: string): Promise<CodexEvaluationWorkerResult> {
  const parsed = await readWorkerJson(resultPath, "Codex evaluation worker");
  assertObject(parsed, "Codex evaluation worker result.json");
  const id = requiredString(parsed.id, "Codex evaluation worker result.json id");
  const status = requiredString(parsed.status, "Codex evaluation worker result.json status");

  if (parsed.items === undefined) {
    requiredString(parsed.text, "Codex evaluation worker result.json text");
    requiredString(parsed.caveats, "Codex evaluation worker result.json caveats");
  }

  const items = requiredEvaluationItemArray(parsed.items, "Codex evaluation worker result.json items");
  const summary = typeof parsed.summary === "string" ? parsed.summary : "";

  return {
    id,
    status,
    items,
    summary,
    error: requiredNullableString(parsed.error, "Codex evaluation worker result.json error"),
    caveats: requiredString(parsed.caveats, "Codex evaluation worker result.json caveats")
  };
}

async function readWorkerJson(resultPath: string, workerLabel: string) {
  try {
    return JSON.parse(await readFile(resultPath, "utf8")) as unknown;
  } catch (error) {
    if (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`${workerLabel} did not write required result file: ${resultPath}`, { cause: error });
    }

    throw new Error(
      `${workerLabel} result file is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error }
    );
  }
}

function assertObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
}

function assertString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string.`);
  }
}

function assertNumber(value: unknown, label: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number.`);
  }
}

function assertArray(value: unknown, label: string): asserts value is unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array.`);
  }
}

function assertSectionArray(value: unknown, label: string): asserts value is AssistantWorkerRequest["sections"] {
  assertArray(value, label);

  value.forEach((section, index) => {
    const itemLabel = `${label}[${index}]`;
    assertObject(section, itemLabel);
    assertString(section.nodeId, `${itemLabel}.nodeId`);
    assertSectionKind(section.kind, `${itemLabel}.kind`);
    assertString(section.section, `${itemLabel}.section`);
    assertString(section.title, `${itemLabel}.title`);
    assertString(section.text, `${itemLabel}.text`);
  });
}

function assertReferenceArray(value: unknown, label: string): asserts value is AssistantWorkerRequest["references"] {
  assertArray(value, label);

  value.forEach((reference, index) => {
    const itemLabel = `${label}[${index}]`;
    assertObject(reference, itemLabel);
    assertString(reference.nodeId, `${itemLabel}.nodeId`);
    assertString(reference.role, `${itemLabel}.role`);
    assertString(reference.title, `${itemLabel}.title`);
    assertString(reference.sourceKind, `${itemLabel}.sourceKind`);
    assertOptionalString(reference.steeringText, `${itemLabel}.steeringText`);
    assertOptionalString(reference.assetId, `${itemLabel}.assetId`);
    assertOptionalString(reference.assetKind, `${itemLabel}.assetKind`);
    assertOptionalString(reference.assetPath, `${itemLabel}.assetPath`);
    assertOptionalObject(reference.assetMetadata, `${itemLabel}.assetMetadata`);
  });
}

function assertEdgeRoleArray(value: unknown, label: string): asserts value is AssistantWorkerRequest["edgeRoles"] {
  assertArray(value, label);

  value.forEach((edgeRole, index) => {
    const itemLabel = `${label}[${index}]`;
    assertObject(edgeRole, itemLabel);
    assertString(edgeRole.edgeId, `${itemLabel}.edgeId`);
    assertString(edgeRole.role, `${itemLabel}.role`);
  });
}

function assertEvaluationImageArray(value: unknown, label: string): asserts value is EvaluationWorkerRequest["images"] {
  assertArray(value, label);

  value.forEach((image, index) => {
    const itemLabel = `${label}[${index}]`;
    assertObject(image, itemLabel);
    assertString(image.id, `${itemLabel}.id`);
    assertString(image.nodeId, `${itemLabel}.nodeId`);
    assertString(image.title, `${itemLabel}.title`);
    assertString(image.assetPath, `${itemLabel}.assetPath`);
    assertOptionalString(image.assetId, `${itemLabel}.assetId`);
    assertOptionalString(image.assetKind, `${itemLabel}.assetKind`);
    assertOptionalObject(image.assetMetadata, `${itemLabel}.assetMetadata`);
    assertOptionalStringArray(image.tags, `${itemLabel}.tags`);
    assertOptionalString(image.decision, `${itemLabel}.decision`);
    assertOptionalString(image.notes, `${itemLabel}.notes`);
  });
}

function assertSectionKind(value: unknown, label: string): asserts value is "prompt" | "negativePrompt" {
  if (value !== "prompt" && value !== "negativePrompt") {
    throw new Error(`${label} must be "prompt" or "negativePrompt".`);
  }
}

function assertOptionalString(value: unknown, label: string): asserts value is string | undefined {
  if (value !== undefined) {
    assertString(value, label);
  }
}

function assertOptionalObject(
  value: unknown,
  label: string
): asserts value is Record<string, unknown> | undefined {
  if (value !== undefined) {
    assertObject(value, label);
  }
}

function assertOptionalStringArray(value: unknown, label: string): asserts value is string[] | undefined {
  if (value === undefined) {
    return;
  }

  assertArray(value, label);
  value.forEach((entry, index) => assertString(entry, `${label}[${index}]`));
}

function requiredString(value: unknown, label: string) {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string.`);
  }

  return value;
}

function requiredNonEmptyString(value: unknown, label: string) {
  const text = requiredString(value, label).trim();

  if (!text) {
    throw new Error(`${label} must be a non-empty string.`);
  }

  return text;
}

function requiredNullableString(value: unknown, label: string) {
  if (value === null) {
    return null;
  }

  return requiredString(value, label);
}

function requiredEvaluationItemArray(value: unknown, label: string): VisionEvaluationItemResult[] {
  assertArray(value, label);

  return value.map((entry, index) => {
    const itemLabel = `${label}[${index}]`;
    assertObject(entry, itemLabel);
    const id = requiredString(entry.id, `${itemLabel}.id`);
    const score = requiredNumberInRange(entry.score, `${itemLabel}.score`, 0, 100);
    const decision = requiredEvaluationDecision(entry.decision, `${itemLabel}.decision`);
    const confidence = requiredNumberInRange(entry.confidence, `${itemLabel}.confidence`, 0, 1);
    const tags = requiredStringArray(entry.tags, `${itemLabel}.tags`);
    const explanation = requiredNonEmptyString(entry.explanation, `${itemLabel}.explanation`);
    const detectedIssues = requiredStringArray(entry.detectedIssues, `${itemLabel}.detectedIssues`);
    const assetId = optionalResultString(entry.assetId, `${itemLabel}.assetId`);
    const assetPath = optionalResultString(entry.assetPath, `${itemLabel}.assetPath`);

    return {
      id,
      ...(assetId ? { assetId } : {}),
      ...(assetPath ? { assetPath } : {}),
      score,
      tags,
      decision,
      confidence,
      explanation,
      detectedIssues
    };
  });
}

function requiredStringArray(value: unknown, label: string) {
  assertArray(value, label);
  return value.map((entry, index) => requiredString(entry, `${label}[${index}]`));
}

function requiredNumberInRange(value: unknown, label: string, min: number, max: number) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${label} must be a finite number from ${min} to ${max}.`);
  }

  return value;
}

function requiredEvaluationDecision(value: unknown, label: string): VisionEvaluationItemResult["decision"] {
  if (value === "pass" || value === "needs-edit" || value === "fail") {
    return value;
  }

  throw new Error(`${label} must be "pass", "needs-edit", or "fail".`);
}

function optionalResultString(value: unknown, label: string) {
  if (value === undefined) {
    return undefined;
  }

  return requiredString(value, label);
}
