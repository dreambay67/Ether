import Ajv, { type AnySchema, type ErrorObject, type ValidateFunction } from "ajv";
import { sha256Hex } from "@ether/graph-kernel";
import { JsonValueSchema, type JsonObject, type JsonValue, type PromptWorkerConfig } from "@ether/schema";

import {
  deduplicateWorkerOutputIssues,
  inspectStructuredTransformationOutput,
  inspectTransformationOutput,
  type WorkerOutputIssue,
  type WorkerOutputIssueCode
} from "./transformationGuard.js";

export type StructuredOutputSchema = {
  id: string;
  schema: JsonObject;
};

export type IndexedStructuredOutputSchema = StructuredOutputSchema & {
  canonicalSchema: string;
  fingerprint: string;
  validationComplexity: number;
};

export type StructuredOutputSchemaIndex = {
  schemas: ReadonlyMap<string, IndexedStructuredOutputSchema>;
  issues: readonly WorkerOutputIssue[];
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

export const structuredOutputLimits = Object.freeze({
  schemaBytes: 65_536,
  outputBytes: 1_048_576,
  nestingDepth: 64,
  valueNodes: 10_000,
  validationErrors: 32,
  combinatorBranches: 64,
  validationComplexityProduct: 50_000,
  schemaCacheEntries: 64
});

export type StructuredSchemaCacheStats = {
  capacity: number;
  size: number;
  hits: number;
  misses: number;
  evictions: number;
};

const ajv = new Ajv({
  addUsedSchema: false,
  allErrors: false,
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
let cacheHits = 0;
let cacheMisses = 0;
let cacheEvictions = 0;
const textEncoder = new TextEncoder();

const hazardousSchemaKeywords = new Set([
  "$anchor",
  "$dynamicAnchor",
  "$dynamicRef",
  "$id",
  "$recursiveAnchor",
  "$recursiveRef",
  "$ref",
  "$schema",
  "$vocabulary",
  "contentEncoding",
  "contentMediaType",
  "contentSchema",
  "format",
  "formatMaximum",
  "formatMinimum",
  "pattern",
  "patternProperties"
]);

const schemaMapKeywords = new Set([
  "$defs",
  "definitions",
  "dependentSchemas",
  "properties"
]);

const schemaValueKeywords = new Set([
  "additionalItems",
  "additionalProperties",
  "contains",
  "else",
  "if",
  "not",
  "propertyNames",
  "then",
  "unevaluatedItems",
  "unevaluatedProperties"
]);

const schemaArrayKeywords = new Set(["allOf", "anyOf", "oneOf", "prefixItems"]);

const validationKeywords = new Set([
  "additionalItems",
  "additionalProperties",
  "const",
  "contains",
  "dependentRequired",
  "dependencies",
  "else",
  "enum",
  "exclusiveMaximum",
  "exclusiveMinimum",
  "if",
  "items",
  "maxContains",
  "maxItems",
  "maxLength",
  "maxProperties",
  "maximum",
  "minContains",
  "minItems",
  "minLength",
  "minProperties",
  "minimum",
  "multipleOf",
  "not",
  "propertyNames",
  "required",
  "then",
  "type",
  "unevaluatedItems",
  "unevaluatedProperties",
  "uniqueItems"
]);

const correctableIssueCodes = new Set<WorkerOutputIssueCode>([
  "EMPTY_OUTPUT",
  "OUTPUT_CHANNEL_MISMATCH",
  "INVALID_JSON",
  "SCHEMA_INVALID",
  "CONVERSATIONAL_PREFACE",
  "CHANGE_NARRATION"
]);

function stableJson(value: JsonValue): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key]!)}`).join(",")}}`;
}

function byteLength(value: string): number {
  return textEncoder.encode(value).byteLength;
}

function appendJsonPath(path: string, segment: string): string {
  if (/^(?:0|[1-9][0-9]*)$/.test(segment)) return `${path}[${segment}]`;
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(segment)
    ? `${path}.${segment}`
    : `${path}[${JSON.stringify(segment)}]`;
}

function limitIssue(message: string, path: string): WorkerOutputIssue {
  return { code: "OUTPUT_LIMIT_EXCEEDED", message, path };
}

function inspectJsonStructure(
  value: unknown,
  kind: "schema" | "output",
  rootPath: string
): { issue: WorkerOutputIssue | null; nodeCount: number } {
  type Frame = { value: unknown; depth: number; path: string; leaving: boolean };
  const active = new WeakSet<object>();
  const stack: Frame[] = [{ value, depth: 0, path: rootPath, leaving: false }];
  let nodes = 0;

  while (stack.length > 0) {
    const frame = stack.pop()!;
    if (frame.leaving) {
      active.delete(frame.value as object);
      continue;
    }
    nodes += 1;
    if (nodes > structuredOutputLimits.valueNodes) {
      return {
        issue: limitIssue(`${kind === "schema" ? "Structured output schema" : "Worker output"} exceeds the ${structuredOutputLimits.valueNodes} node limit.`, rootPath),
        nodeCount: nodes
      };
    }
    if (frame.depth > structuredOutputLimits.nestingDepth) {
      return {
        issue: limitIssue(`${kind === "schema" ? "Structured output schema" : "Worker output"} exceeds the ${structuredOutputLimits.nestingDepth} level nesting limit.`, rootPath),
        nodeCount: nodes
      };
    }
    if (frame.value === null || typeof frame.value === "string" || typeof frame.value === "boolean") continue;
    if (typeof frame.value === "number") {
      if (Number.isFinite(frame.value)) continue;
      return { issue: {
          code: kind === "schema" ? "INVALID_OUTPUT_SCHEMA" : "OUTPUT_CHANNEL_MISMATCH",
          message: `${kind === "schema" ? "Structured output schemas" : "Structured worker outputs"} require finite JSON numbers.`,
          path: frame.path
        }, nodeCount: nodes };
    }
    if (typeof frame.value !== "object") {
      return { issue: {
          code: kind === "schema" ? "INVALID_OUTPUT_SCHEMA" : "OUTPUT_CHANNEL_MISMATCH",
          message: `${kind === "schema" ? "Structured output schema" : "Structured worker output"} is not a JSON value.`,
          path: frame.path
        }, nodeCount: nodes };
    }

    const objectValue = frame.value as object;
    if (active.has(objectValue)) {
      return { issue: {
          code: kind === "schema" ? "INVALID_OUTPUT_SCHEMA" : "OUTPUT_CHANNEL_MISMATCH",
          message: `${kind === "schema" ? "Structured output schema" : "Structured worker output"} must not contain cycles.`,
          path: frame.path
        }, nodeCount: nodes };
    }
    active.add(objectValue);
    stack.push({ ...frame, leaving: true });

    if (Array.isArray(frame.value)) {
      for (let index = frame.value.length - 1; index >= 0; index -= 1) {
        stack.push({ value: frame.value[index], depth: frame.depth + 1, path: `${frame.path}[${index}]`, leaving: false });
      }
      continue;
    }

    const prototype = Object.getPrototypeOf(frame.value);
    if (prototype !== Object.prototype && prototype !== null) {
      return { issue: {
          code: kind === "schema" ? "INVALID_OUTPUT_SCHEMA" : "OUTPUT_CHANNEL_MISMATCH",
          message: `${kind === "schema" ? "Structured output schema" : "Structured worker output"} must use plain JSON objects.`,
          path: frame.path
        }, nodeCount: nodes };
    }
    const record = frame.value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    for (let index = keys.length - 1; index >= 0; index -= 1) {
      const key = keys[index]!;
      stack.push({ value: record[key], depth: frame.depth + 1, path: appendJsonPath(frame.path, key), leaving: false });
    }
  }
  return { issue: null, nodeCount: nodes };
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function inspectSchemaSafety(
  root: JsonObject,
  rootPath: string
): { issue: WorkerOutputIssue | null; validationComplexity: number } {
  type SchemaFrame = { value: unknown; path: string };
  const stack: SchemaFrame[] = [{ value: root, path: rootPath }];
  let validationComplexity = 0;

  const pushSchemaArray = (value: unknown, path: string): WorkerOutputIssue | null => {
    if (!Array.isArray(value)) return null;
    if (value.length > structuredOutputLimits.combinatorBranches) {
      return limitIssue(`Structured output schema exceeds the ${structuredOutputLimits.combinatorBranches} branch applicator limit.`, path);
    }
    validationComplexity += value.length;
    for (let index = value.length - 1; index >= 0; index -= 1) {
      stack.push({ value: value[index], path: `${path}[${index}]` });
    }
    return null;
  };

  const pushSchemaMap = (value: unknown, path: string): void => {
    if (!isJsonObject(value)) return;
    const names = Object.keys(value).sort();
    for (let index = names.length - 1; index >= 0; index -= 1) {
      const name = names[index]!;
      stack.push({ value: value[name], path: appendJsonPath(path, name) });
    }
  };

  while (stack.length > 0) {
    const frame = stack.pop()!;
    if (typeof frame.value === "boolean") {
      validationComplexity += 1;
      continue;
    }
    if (!isJsonObject(frame.value)) continue;
    validationComplexity += 1;

    for (const keyword of Object.keys(frame.value).sort()) {
      const keywordPath = appendJsonPath(frame.path, keyword);
      const keywordValue = frame.value[keyword];
      if (hazardousSchemaKeywords.has(keyword)) {
        return {
          issue: {
            code: "INVALID_OUTPUT_SCHEMA",
            message: `Unsupported structured output schema keyword: ${keyword}.`,
            path: keywordPath
          },
          validationComplexity
        };
      }
      if (validationKeywords.has(keyword)) validationComplexity += 1;

      if (schemaArrayKeywords.has(keyword)) {
        const issue = pushSchemaArray(keywordValue, keywordPath);
        if (issue !== null) return { issue, validationComplexity };
      } else if (keyword === "items") {
        if (Array.isArray(keywordValue)) {
          const issue = pushSchemaArray(keywordValue, keywordPath);
          if (issue !== null) return { issue, validationComplexity };
        } else {
          stack.push({ value: keywordValue, path: keywordPath });
        }
      } else if (schemaMapKeywords.has(keyword)) {
        pushSchemaMap(keywordValue, keywordPath);
      } else if (keyword === "dependencies" && isJsonObject(keywordValue)) {
        const names = Object.keys(keywordValue).sort();
        for (let index = names.length - 1; index >= 0; index -= 1) {
          const name = names[index]!;
          const dependency = keywordValue[name];
          if (!Array.isArray(dependency)) {
            stack.push({ value: dependency, path: appendJsonPath(keywordPath, name) });
          }
        }
      } else if (schemaValueKeywords.has(keyword)) {
        stack.push({ value: keywordValue, path: keywordPath });
      }
    }
  }
  return { issue: null, validationComplexity };
}

function schemaCatalogPath(id: string): string {
  return appendJsonPath("$.schemaCatalog", id);
}

function inspectSchemaCandidate(schema: StructuredOutputSchema):
  | { indexed: IndexedStructuredOutputSchema; issue: null }
  | { indexed: null; issue: WorkerOutputIssue } {
  if (typeof schema.id !== "string" || schema.id.length === 0) {
    return { indexed: null, issue: { code: "INVALID_OUTPUT_SCHEMA", message: "Structured output schema IDs must be non-empty strings.", path: "$.schemaCatalog" } };
  }
  const rootPath = `${schemaCatalogPath(schema.id)}.schema`;
  const structure = inspectJsonStructure(schema.schema, "schema", rootPath);
  if (structure.issue !== null) return { indexed: null, issue: structure.issue };
  const safety = inspectSchemaSafety(schema.schema, rootPath);
  if (safety.issue !== null) return { indexed: null, issue: safety.issue };
  const canonicalSchema = stableJson(schema.schema);
  if (byteLength(canonicalSchema) > structuredOutputLimits.schemaBytes) {
    return {
      indexed: null,
      issue: limitIssue(`Structured output schema exceeds the ${structuredOutputLimits.schemaBytes} byte limit.`, rootPath)
    };
  }
  return {
    indexed: {
      id: schema.id,
      schema: JSON.parse(canonicalSchema) as JsonObject,
      canonicalSchema,
      fingerprint: `sha256:v1:${sha256Hex(textEncoder.encode(canonicalSchema))}`,
      validationComplexity: safety.validationComplexity
    },
    issue: null
  };
}

export function indexStructuredOutputSchemas(catalog: readonly StructuredOutputSchema[]): StructuredOutputSchemaIndex {
  const candidates: IndexedStructuredOutputSchema[] = [];
  const issues: WorkerOutputIssue[] = [];
  for (const schema of catalog) {
    const inspected = inspectSchemaCandidate(schema);
    if (inspected.issue !== null) issues.push(inspected.issue);
    else candidates.push(inspected.indexed);
  }
  candidates.sort((left, right) => left.id.localeCompare(right.id) || left.canonicalSchema.localeCompare(right.canonicalSchema));

  const schemas = new Map<string, IndexedStructuredOutputSchema>();
  for (const candidate of candidates) {
    const existing = schemas.get(candidate.id);
    if (existing === undefined) {
      schemas.set(candidate.id, candidate);
    } else if (existing.canonicalSchema !== candidate.canonicalSchema) {
      issues.push({
        code: "INVALID_OUTPUT_SCHEMA",
        message: `Structured output schema ID ${candidate.id} has conflicting definitions.`,
        path: schemaCatalogPath(candidate.id)
      });
    }
  }
  return { schemas, issues: deduplicateWorkerOutputIssues(issues) };
}

export function resolveStructuredOutputSchema(
  index: StructuredOutputSchemaIndex,
  schemaId: string
): { schema: IndexedStructuredOutputSchema | null; issue: WorkerOutputIssue | null } {
  if (index.issues.length > 0) return { schema: null, issue: index.issues[0]! };
  const schema = index.schemas.get(schemaId);
  if (schema === undefined) {
    return {
      schema: null,
      issue: { code: "UNKNOWN_OUTPUT_SCHEMA", message: `Unknown structured output schema: ${schemaId}.`, path: "$.outputContract.schemaId" }
    };
  }
  return { schema, issue: null };
}

function schemaCompilationMessage(error: unknown, validationErrors: readonly ErrorObject[] | null | undefined): string {
  if (validationErrors !== null && validationErrors !== undefined && validationErrors.length > 0) {
    const descriptions = validationErrors.slice(0, structuredOutputLimits.validationErrors).map((entry) =>
      `${entry.schemaPath || "#"} ${entry.keyword}: ${entry.message ?? "invalid schema"}`
    ).sort();
    return `Invalid structured output schema: ${descriptions.join("; ")}`;
  }
  const message = error instanceof Error ? error.message : "unknown schema compilation error";
  return `Invalid or unsupported structured output schema: ${message}.`;
}

function cacheCompiledSchema(key: string, compiled: CompiledSchema): CompiledSchema {
  if (schemaCache.size >= structuredOutputLimits.schemaCacheEntries) {
    const oldest = schemaCache.keys().next().value as string | undefined;
    if (oldest !== undefined) {
      schemaCache.delete(oldest);
      cacheEvictions += 1;
    }
  }
  schemaCache.set(key, compiled);
  return compiled;
}

function compileSchema(schema: IndexedStructuredOutputSchema): CompiledSchema {
  const cached = schemaCache.get(schema.fingerprint);
  if (cached !== undefined) {
    cacheHits += 1;
    schemaCache.delete(schema.fingerprint);
    schemaCache.set(schema.fingerprint, cached);
    return cached;
  }
  cacheMisses += 1;

  const cloned = JSON.parse(schema.canonicalSchema) as AnySchema;
  let compiled: CompiledSchema;
  try {
    if (!ajv.validateSchema(cloned)) {
      compiled = {
        valid: false,
        issue: { code: "INVALID_OUTPUT_SCHEMA", message: schemaCompilationMessage(null, ajv.errors), path: `${schemaCatalogPath(schema.id)}.schema` }
      };
    } else {
      compiled = { valid: true, validator: ajv.compile(cloned) };
    }
  } catch (error) {
    compiled = {
      valid: false,
      issue: { code: "INVALID_OUTPUT_SCHEMA", message: schemaCompilationMessage(error, null), path: `${schemaCatalogPath(schema.id)}.schema` }
    };
  }
  return cacheCompiledSchema(schema.fingerprint, compiled);
}

export function clearStructuredSchemaCache(): void {
  schemaCache.clear();
  cacheHits = 0;
  cacheMisses = 0;
  cacheEvictions = 0;
}

export function getStructuredSchemaCacheStats(): StructuredSchemaCacheStats {
  return {
    capacity: structuredOutputLimits.schemaCacheEntries,
    size: schemaCache.size,
    hits: cacheHits,
    misses: cacheMisses,
    evictions: cacheEvictions
  };
}

export function inspectStructuredOutputSchema(schema: StructuredOutputSchema): WorkerOutputIssue | null {
  const index = indexStructuredOutputSchemas([schema]);
  if (index.issues.length > 0) return index.issues[0]!;
  const indexed = index.schemas.get(schema.id)!;
  const compiled = compileSchema(indexed);
  return compiled.valid ? null : compiled.issue;
}

export function inspectIndexedStructuredOutputSchema(schema: IndexedStructuredOutputSchema): WorkerOutputIssue | null {
  const compiled = compileSchema(schema);
  return compiled.valid ? null : compiled.issue;
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
  }))).slice(0, structuredOutputLimits.validationErrors);
}

function validateJsonSchema(value: JsonValue, compiled: Extract<CompiledSchema, { valid: true }>): WorkerOutputIssue[] {
  return compiled.validator(value) ? [] : normalizeSchemaErrors(compiled.validator.errors);
}

function validationComplexityIssue(
  schema: IndexedStructuredOutputSchema,
  outputNodeCount: number
): WorkerOutputIssue | null {
  const boundedNodeCount = Math.max(1, outputNodeCount);
  if (schema.validationComplexity <= Math.floor(structuredOutputLimits.validationComplexityProduct / boundedNodeCount)) {
    return null;
  }
  return limitIssue(
    `Structured output validation exceeds the ${structuredOutputLimits.validationComplexityProduct} schema-output complexity limit.`,
    "$"
  );
}

function parseStructuredOutput(output: string | JsonValue):
  | { success: true; value: JsonValue; nodeCount: number; issues: [] }
  | { success: false; value: null; issues: WorkerOutputIssue[] } {
  let candidate: unknown = output;
  if (typeof output === "string") {
    if (byteLength(output) > structuredOutputLimits.outputBytes) {
      return { success: false, value: null, issues: [limitIssue(`Worker output exceeds the ${structuredOutputLimits.outputBytes} byte limit.`, "$")] };
    }
    try {
      candidate = JSON.parse(output);
    } catch {
      return { success: false, value: null, issues: [{ code: "INVALID_JSON", message: "Structured worker output must be valid JSON." }] };
    }
  }
  const structure = inspectJsonStructure(candidate, "output", "$");
  if (structure.issue !== null) return { success: false, value: null, issues: [structure.issue] };
  const parsed = JsonValueSchema.safeParse(candidate);
  if (!parsed.success) {
    return { success: false, value: null, issues: [{ code: "OUTPUT_CHANNEL_MISMATCH", message: "Structured output is not a JSON value." }] };
  }
  if (byteLength(stableJson(parsed.data)) > structuredOutputLimits.outputBytes) {
    return { success: false, value: null, issues: [limitIssue(`Worker output exceeds the ${structuredOutputLimits.outputBytes} byte limit.`, "$")] };
  }
  return { success: true, value: parsed.data, nodeCount: structure.nodeCount, issues: [] };
}

function correctiveRetry(issues: readonly WorkerOutputIssue[], attempt: 0 | 1): CorrectiveRetryContract | null {
  if (issues.length === 0 || attempt === 1 || issues.some((issue) => !correctableIssueCodes.has(issue.code))) return null;
  return {
    attempt: 1,
    maximumAttempts: 1,
    instruction: [
      "Return corrected content only.",
      ...issues.map((issue) => `- ${issue.path === undefined ? "" : `${issue.path}: `}${issue.message}`)
    ].join("\n")
  };
}

function validationResult(
  issues: readonly WorkerOutputIssue[],
  value: string | JsonValue | null,
  attempt: 0 | 1
): WorkerOutputValidationResult {
  const normalizedIssues = deduplicateWorkerOutputIssues(issues);
  return {
    accepted: normalizedIssues.length === 0,
    value,
    issues: normalizedIssues,
    correctiveRetry: correctiveRetry(normalizedIssues, attempt)
  };
}

export function validateWorkerOutput(input: ValidateWorkerOutputInput): WorkerOutputValidationResult {
  if (input.attempt !== 0 && input.attempt !== 1) {
    return validationResult([{
      code: "INVALID_VALIDATION_ATTEMPT",
      message: "Worker output validation attempt must be exactly 0 or 1.",
      path: "$.attempt"
    }], null, 1);
  }

  const issues: WorkerOutputIssue[] = [];
  let value: string | JsonValue | null = null;

  if (input.config.outputContract.channel === "text") {
    if (typeof input.output !== "string") {
      issues.push({ code: "OUTPUT_CHANNEL_MISMATCH", message: "Text output must be a string." });
    } else if (byteLength(input.output) > structuredOutputLimits.outputBytes) {
      issues.push(limitIssue(`Worker output exceeds the ${structuredOutputLimits.outputBytes} byte limit.`, "$"));
    } else {
      value = input.output.trim();
      issues.push(...inspectTransformationOutput(input.config, input.output));
    }
    return validationResult(issues, value, input.attempt);
  }

  const schemaIndex = indexStructuredOutputSchemas(input.schemaCatalog);
  if (schemaIndex.issues.length > 0) return validationResult(schemaIndex.issues, null, input.attempt);

  let compiledSchema: Extract<CompiledSchema, { valid: true }> | null = null;
  let selectedSchema: IndexedStructuredOutputSchema | null = null;
  const schemaId = input.config.outputContract.schemaId;
  if (schemaId !== undefined) {
    const resolution = resolveStructuredOutputSchema(schemaIndex, schemaId);
    if (resolution.issue !== null) return validationResult([resolution.issue], null, input.attempt);
    selectedSchema = resolution.schema!;
    const compiled = compileSchema(selectedSchema);
    if (!compiled.valid) return validationResult([compiled.issue], null, input.attempt);
    compiledSchema = compiled;
  }

  const parsed = parseStructuredOutput(input.output);
  value = parsed.value;
  issues.push(...parsed.issues);
  if (parsed.success) {
    issues.push(...inspectStructuredTransformationOutput(input.config, parsed.value));
    if (compiledSchema !== null && selectedSchema !== null) {
      const complexityIssue = validationComplexityIssue(selectedSchema, parsed.nodeCount);
      if (complexityIssue !== null) issues.push(complexityIssue);
      else issues.push(...validateJsonSchema(parsed.value, compiledSchema));
    }
  }
  return validationResult(issues, value, input.attempt);
}
