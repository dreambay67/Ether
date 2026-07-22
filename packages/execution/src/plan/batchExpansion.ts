import { createHash } from "node:crypto";

import { canonicalJson, type BatchDimension, type JsonObject, type JsonValue } from "@ether/schema";

export const DEFAULT_BATCH_CAP = 10_000;

export type BatchExclusion =
  | readonly JsonValue[]
  | JsonObject
  | { values: JsonObject }
  | { coordinates: JsonObject }
  | { dimensionValues: JsonObject }
  | { dimensionId: string; value: JsonValue };

export type BatchExpansionInput = {
  dimensions: readonly BatchDimension[];
  exclusions?: readonly BatchExclusion[];
  cap?: number;
  maxItems?: number;
  stepId?: string;
  requestedParallelism?: number;
  failOnCap?: boolean;
};

export type ExpandedBatchItem = {
  id: string;
  ordinal: number;
  values: JsonObject;
  parameters: Array<{ name: string; value: JsonValue }>;
};

export type BatchExpansionSummary = {
  dimensions: number;
  combinations: number;
  exclusions: number;
  workItemCount: number;
  capped: boolean;
  cap: number | null;
};

export type BatchExpansionResult = {
  items: ExpandedBatchItem[];
  summary: BatchExpansionSummary;
  requestedParallelism: number;
  effectiveParallelism: number;
};

export class BatchExpansionError extends Error {
  readonly code:
    | "INVALID_BATCH_DIMENSION"
    | "DUPLICATE_BATCH_DIMENSION"
    | "INVALID_BATCH_CAP"
    | "BATCH_EXPANSION_CAP";

  constructor(
    code: BatchExpansionError["code"],
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "BatchExpansionError";
    this.code = code;
  }
}

export function expandBatch(input: BatchExpansionInput): BatchExpansionResult {
  const dimensions = validateDimensions(input.dimensions);
  const exclusions = input.exclusions ?? [];
  const cap = input.cap ?? input.maxItems ?? DEFAULT_BATCH_CAP;
  if (!Number.isInteger(cap) || cap <= 0) {
    throw new BatchExpansionError("INVALID_BATCH_CAP", "Batch expansion cap must be a positive integer.");
  }
  const requestedParallelism = normalizeParallelism(input.requestedParallelism);
  const combinations = combinationCount(dimensions);
  const capped = combinations > cap;
  if (capped && input.failOnCap === true) {
    throw new BatchExpansionError(
      "BATCH_EXPANSION_CAP",
      `Batch expansion has ${combinations} combinations, exceeding the cap of ${cap}.`
    );
  }

  const items: ExpandedBatchItem[] = [];
  let excludedCount = 0;
  let stoppedAtCap = false;
  const values: JsonValue[] = [];
  const visit = (dimensionIndex: number): void => {
    if (stoppedAtCap) return;
    if (dimensionIndex === dimensions.length) {
      const assignment = assignmentFor(dimensions, values);
      if (exclusions.some((exclusion) => matchesExclusion(exclusion, dimensions, assignment))) {
        excludedCount += 1;
        return;
      }
      if (items.length >= cap) {
        stoppedAtCap = true;
        return;
      }
      const ordinal = items.length;
      const id = workItemId(input.stepId, assignment);
      items.push({
        id,
        ordinal,
        values: assignment,
        parameters: dimensions.map((dimension) => ({
          name: dimension.id,
          value: assignment[dimension.id]!
        }))
      });
      return;
    }
    for (const value of dimensions[dimensionIndex]!.values) {
      values.push(value);
      visit(dimensionIndex + 1);
      values.pop();
      if (stoppedAtCap) return;
    }
  };
  visit(0);

  const effectiveParallelism = Math.min(
    requestedParallelism,
    Math.max(items.length, 1)
  );
  return {
    items,
    summary: {
      dimensions: dimensions.length,
      combinations,
      exclusions: excludedCount,
      workItemCount: items.length,
      capped: capped || stoppedAtCap,
      cap: capped || stoppedAtCap ? cap : null
    },
    requestedParallelism,
    effectiveParallelism
  };
}

export const expandBatchDimensions = expandBatch;
export const createBatchExpansion = expandBatch;

function validateDimensions(dimensions: readonly BatchDimension[]): BatchDimension[] {
  const ids = new Set<string>();
  return dimensions.map((dimension) => {
    if (dimension.id.length === 0 || dimension.name.length === 0 || dimension.values.length === 0) {
      throw new BatchExpansionError(
        "INVALID_BATCH_DIMENSION",
        "Every batch dimension needs a non-empty id, name, and at least one value."
      );
    }
    if (ids.has(dimension.id)) {
      throw new BatchExpansionError(
        "DUPLICATE_BATCH_DIMENSION",
        `Batch dimension ${dimension.id} appears more than once.`
      );
    }
    ids.add(dimension.id);
    for (const value of dimension.values) {
      try {
        canonicalJson(value);
      } catch (error) {
        throw new BatchExpansionError(
          "INVALID_BATCH_DIMENSION",
          `Batch dimension ${dimension.id} contains a non-serializable value.`,
          { cause: error }
        );
      }
    }
    return { ...dimension, values: [...dimension.values] };
  });
}

function combinationCount(dimensions: readonly BatchDimension[]): number {
  let count = 1;
  for (const dimension of dimensions) {
    count *= dimension.values.length;
    if (!Number.isSafeInteger(count)) return Number.MAX_SAFE_INTEGER;
  }
  return count;
}

function assignmentFor(
  dimensions: readonly BatchDimension[],
  values: readonly JsonValue[]
): JsonObject {
  return Object.fromEntries(dimensions.map((dimension, index) => [dimension.id, values[index]!])) as JsonObject;
}

function matchesExclusion(
  exclusion: BatchExclusion,
  dimensions: readonly BatchDimension[],
  assignment: JsonObject
): boolean {
  if (Array.isArray(exclusion)) {
    return dimensions.every((dimension, index) =>
      index >= exclusion.length || canonicalJson(exclusion[index]) === canonicalJson(assignment[dimension.id])
    );
  }
  const map = exclusionMap(exclusion);
  return Object.entries(map).every(([dimensionId, value]) =>
    Object.hasOwn(assignment, dimensionId) && canonicalJson(assignment[dimensionId]) === canonicalJson(value)
  );
}

function exclusionMap(exclusion: BatchExclusion): JsonObject {
  if (Array.isArray(exclusion)) return {};
  const object = exclusion as Record<string, JsonValue>;
  if (typeof object.dimensionId === "string" && Object.hasOwn(object, "value")) {
    return { [object.dimensionId]: object.value! };
  }
  if (object.dimensionValues !== undefined && isJsonObject(object.dimensionValues)) {
    return object.dimensionValues;
  }
  if (object.coordinates !== undefined && isJsonObject(object.coordinates)) {
    return object.coordinates;
  }
  if (object.values !== undefined && isJsonObject(object.values)) {
    return object.values;
  }
  return object as JsonObject;
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function workItemId(stepId: string | undefined, assignment: JsonObject): string {
  const digest = createHash("sha256")
    .update(canonicalJson(assignment))
    .digest("hex")
    .slice(0, 24);
  return `${stepId ?? "batch"}:work:${digest}`;
}

function normalizeParallelism(value: number | undefined): number {
  if (value === undefined) return 1;
  if (!Number.isInteger(value) || value <= 0) {
    throw new BatchExpansionError(
      "INVALID_BATCH_CAP",
      "Requested batch parallelism must be a positive integer."
    );
  }
  return value;
}
