import { JsonValueSchema, type JsonObject, type JsonValue, type PromptWorkerConfig } from "@ether/schema";

import { inspectTransformationOutput, type WorkerOutputIssue } from "./transformationGuard.js";

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

function objectValue(value: JsonValue | undefined): JsonObject | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
}

function stringArray(value: JsonValue | undefined): string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string") ? value : [];
}

function sameJson(left: JsonValue, right: JsonValue): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function validateJsonSchema(value: JsonValue, schema: JsonObject, path = "$"): WorkerOutputIssue[] {
  const issues: WorkerOutputIssue[] = [];
  const expectedType = typeof schema.type === "string" ? schema.type : null;
  const typeMatches = expectedType === null
    || (expectedType === "null" && value === null)
    || (expectedType === "array" && Array.isArray(value))
    || (expectedType === "object" && objectValue(value) !== null)
    || (expectedType === "integer" && typeof value === "number" && Number.isInteger(value))
    || (expectedType === "number" && typeof value === "number")
    || (expectedType === "string" && typeof value === "string")
    || (expectedType === "boolean" && typeof value === "boolean");
  if (!typeMatches) {
    return [{ code: "SCHEMA_INVALID", message: `Expected ${path} to be ${expectedType}.`, path }];
  }

  if (Array.isArray(schema.enum) && !schema.enum.some((candidate) => sameJson(candidate, value))) {
    issues.push({ code: "SCHEMA_INVALID", message: `${path} is not an allowed value.`, path });
  }
  if (Object.hasOwn(schema, "const") && !sameJson(schema.const!, value)) {
    issues.push({ code: "SCHEMA_INVALID", message: `${path} does not match the required constant.`, path });
  }

  const record = objectValue(value);
  if (record !== null) {
    const properties = objectValue(schema.properties);
    for (const required of stringArray(schema.required)) {
      if (!Object.hasOwn(record, required)) {
        issues.push({ code: "SCHEMA_INVALID", message: `${path}.${required} is required.`, path: `${path}.${required}` });
      }
    }
    if (properties !== null) {
      for (const key of Object.keys(record).sort()) {
        const propertySchema = objectValue(properties[key]);
        if (propertySchema !== null) {
          issues.push(...validateJsonSchema(record[key]!, propertySchema, `${path}.${key}`));
        } else if (schema.additionalProperties === false) {
          issues.push({ code: "SCHEMA_INVALID", message: `${path}.${key} is not allowed.`, path: `${path}.${key}` });
        }
      }
    }
  }

  if (Array.isArray(value)) {
    const itemSchema = objectValue(schema.items);
    if (itemSchema !== null) {
      value.forEach((entry, index) => issues.push(...validateJsonSchema(entry, itemSchema, `${path}[${index}]`)));
    }
  }
  return issues;
}

function parseStructuredOutput(output: string | JsonValue): { value: JsonValue | null; issues: WorkerOutputIssue[] } {
  let candidate: unknown = output;
  if (typeof output === "string") {
    try {
      candidate = JSON.parse(output);
    } catch {
      return { value: null, issues: [{ code: "INVALID_JSON", message: "Structured worker output must be valid JSON." }] };
    }
  }
  const parsed = JsonValueSchema.safeParse(candidate);
  if (!parsed.success) {
    return { value: null, issues: [{ code: "OUTPUT_CHANNEL_MISMATCH", message: "Structured output is not a JSON value." }] };
  }
  return { value: parsed.data, issues: [] };
}

function correctiveRetry(issues: readonly WorkerOutputIssue[], attempt: number): CorrectiveRetryContract | null {
  if (issues.length === 0 || attempt >= 1) return null;
  return {
    attempt: 1,
    maximumAttempts: 1,
    instruction: [
      "Return corrected content only.",
      ...issues.map((issue) => `- ${issue.message}`)
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
    const schemaId = input.config.outputContract.schemaId;
    if (schemaId !== undefined) {
      const schema = input.schemaCatalog.find((candidate) => candidate.id === schemaId);
      if (schema === undefined) {
        issues.push({ code: "UNKNOWN_OUTPUT_SCHEMA", message: `Unknown structured output schema: ${schemaId}.` });
      } else if (parsed.value !== null) {
        issues.push(...validateJsonSchema(parsed.value, schema.schema));
      }
    }
  }

  return {
    accepted: issues.length === 0,
    value,
    issues,
    correctiveRetry: correctiveRetry(issues, input.attempt)
  };
}
