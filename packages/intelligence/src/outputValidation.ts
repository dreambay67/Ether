import Ajv, { type AnySchema, type ErrorObject, type ValidateFunction } from "ajv";
import { JsonValueSchema, type JsonObject, type JsonValue, type PromptWorkerConfig } from "@ether/schema";

import {
  deduplicateWorkerOutputIssues,
  inspectStructuredTransformationOutput,
  inspectTransformationOutput,
  type WorkerOutputIssue
} from "./transformationGuard.js";

export type StructuredOutputSchema = {
  id: string;
  schema: JsonObject;
};

export type CorrectiveRetryContract = {
  attempt: 1;
  maximumAttempts: 1;
  instruction: string;
};

export type WorkerOutputValidationResult = {
  accepted: boolean;
  value: string | JsonValue | null;
  issues: readonly WorkerOutputIssue[];
  correctiveRetry: CorrectiveRetryContract | null;
};

export type ValidateWorkerOutputInput = {
  config: PromptWorkerConfig;
  output: string | JsonValue;
  schemaCatalog: readonly StructuredOutputSchema[];
  attempt: number;
};

const ajv = new Ajv({
  addUsedSchema: false,
  allErrors: true,
  coerceTypes: false,
  messages: true,
  removeAdditional: false,
  strict: true,
  strictTypes: false,
  useDefaults: false,
  validateSchema: true
});

type CompiledSchema =
  | { valid: true; validator: ValidateFunction }
  | { valid: false; issue: WorkerOutputIssue };

const schemaCache = new Map<string, CompiledSchema>();

function stableJson(value: JsonValue): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key]!)}`).join(",")}}`;
}

function cloneSchema(schema: JsonObject): AnySchema {
  return JSON.parse(stableJson(schema)) as AnySchema;
}

function schemaCompilationMessage(error: unknown, validationErrors: readonly ErrorObject[] | null | undefined): string {
  if (validationErrors !== null && validationErrors !== undefined && validationErrors.length > 0) {
    const descriptions = validationErrors.map((entry) =>
      `${entry.schemaPath || "#"} ${entry.keyword}: ${entry.message ?? "invalid schema"}`
    ).sort();
    return `Invalid structured output schema: ${descriptions.join("; ")}`;
  }
  const message = error instanceof Error ? error.message : "unknown schema compilation error";
  if (/can't resolve reference|can't resolve schema/i.test(message)) {
    return `Invalid structured output schema: unresolved reference (${message}).`;
  }
  return `Invalid or unsupported structured output schema: ${message}.`;
}

function compileSchema(schema: StructuredOutputSchema): CompiledSchema {
  const cacheKey = stableJson(schema.schema);
  const cached = schemaCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const cloned = cloneSchema(schema.schema);
  let compiled: CompiledSchema;
  try {
    if (!ajv.validateSchema(cloned)) {
      compiled = {
        valid: false,
        issue: {
          code: "INVALID_OUTPUT_SCHEMA",
          message: schemaCompilationMessage(null, ajv.errors),
          path: "$"
        }
      };
    } else {
      compiled = { valid: true, validator: ajv.compile(cloned) };
    }
  } catch (error) {
    compiled = {
      valid: false,
      issue: {
        code: "INVALID_OUTPUT_SCHEMA",
        message: schemaCompilationMessage(error, null),
        path: "$"
      }
    };
  }
  schemaCache.set(cacheKey, compiled);
  return compiled;
}

function appendJsonPath(path: string, segment: string): string {
  if (/^(?:0|[1-9][0-9]*)$/.test(segment)) return `${path}[${segment}]`;
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(segment)
    ? `${path}.${segment}`
    : `${path}[${JSON.stringify(segment)}]`;
}

function pointerPath(pointer: string, error: ErrorObject): string {
  let path = "$";
  if (pointer.length > 0) {
    for (const encoded of pointer.slice(1).split("/")) {
      path = appendJsonPath(path, encoded.replace(/~1/g, "/").replace(/~0/g, "~"));
    }
  }
  const property = error.keyword === "required"
    ? error.params.missingProperty
    : error.keyword === "additionalProperties"
      ? error.params.additionalProperty
      : undefined;
  return typeof property === "string" ? appendJsonPath(path, property) : path;
}

function normalizeSchemaErrors(errors: readonly ErrorObject[] | null | undefined): WorkerOutputIssue[] {
  return deduplicateWorkerOutputIssues((errors ?? []).map((error) => ({
    code: "SCHEMA_INVALID" as const,
    message: `${error.keyword}: ${error.message ?? "schema validation failed"}`,
    path: pointerPath(error.instancePath, error)
  })));
}

export function inspectStructuredOutputSchema(schema: StructuredOutputSchema): WorkerOutputIssue | null {
  const compiled = compileSchema(schema);
  return compiled.valid ? null : compiled.issue;
}

function validateJsonSchema(value: JsonValue, schema: StructuredOutputSchema): WorkerOutputIssue[] {
  const compiled = compileSchema(schema);
  if (!compiled.valid) return [compiled.issue];
  return compiled.validator(value) ? [] : normalizeSchemaErrors(compiled.validator.errors);
}

function parseStructuredOutput(output: string | JsonValue):
  | { success: true; value: JsonValue; issues: [] }
  | { success: false; value: null; issues: WorkerOutputIssue[] } {
  let candidate: unknown = output;
  if (typeof output === "string") {
    try {
      candidate = JSON.parse(output);
    } catch {
      return { success: false, value: null, issues: [{ code: "INVALID_JSON", message: "Structured worker output must be valid JSON." }] };
    }
  }
  const parsed = JsonValueSchema.safeParse(candidate);
  if (!parsed.success) {
    return { success: false, value: null, issues: [{ code: "OUTPUT_CHANNEL_MISMATCH", message: "Structured output is not a JSON value." }] };
  }
  return { success: true, value: parsed.data, issues: [] };
}

function correctiveRetry(issues: readonly WorkerOutputIssue[], attempt: number): CorrectiveRetryContract | null {
  if (issues.length === 0 || attempt >= 1) return null;
  return {
    attempt: 1,
    maximumAttempts: 1,
    instruction: [
      "Return corrected content only.",
      ...issues.map((issue) => `- ${issue.path === undefined ? "" : `${issue.path}: `}${issue.message}`)
    ].join("\n")
  };
}

export function validateWorkerOutput(input: ValidateWorkerOutputInput): WorkerOutputValidationResult {
  const issues: WorkerOutputIssue[] = [];
  let value: string | JsonValue | null = null;

  if (input.config.outputContract.channel === "text") {
    if (typeof input.output !== "string") {
      issues.push({ code: "OUTPUT_CHANNEL_MISMATCH", message: "Text output must be a string." });
    } else {
      value = input.output.trim();
      issues.push(...inspectTransformationOutput(input.config, input.output));
    }
  } else {
    const parsed = parseStructuredOutput(input.output);
    value = parsed.value;
    issues.push(...parsed.issues);
    if (parsed.success) {
      issues.push(...inspectStructuredTransformationOutput(input.config, parsed.value));
    }
    const schemaId = input.config.outputContract.schemaId;
    if (schemaId !== undefined) {
      const schema = input.schemaCatalog.find((candidate) => candidate.id === schemaId);
      if (schema === undefined) {
        issues.push({ code: "UNKNOWN_OUTPUT_SCHEMA", message: `Unknown structured output schema: ${schemaId}.` });
      } else {
        const schemaIssue = inspectStructuredOutputSchema(schema);
        if (schemaIssue !== null) {
          issues.push(schemaIssue);
        } else if (parsed.success) {
          issues.push(...validateJsonSchema(parsed.value, schema));
        }
      }
    }
  }

  const normalizedIssues = deduplicateWorkerOutputIssues(issues);
  return {
    accepted: normalizedIssues.length === 0,
    value,
    issues: normalizedIssues,
    correctiveRetry: correctiveRetry(normalizedIssues, input.attempt)
  };
}
