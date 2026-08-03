import type { PayloadEnvelope } from "@ether/schema";

import { ExecutorFailure, type ExecutorContext, type ExecutorResult, type StepExecutor } from "./types.js";

type JoinStrategy = "ordered" | "zip" | "merge";

type JoinSettings = {
  strategy: JoinStrategy;
  requireComplete: boolean;
  expectedSourceEdgeIds: string[];
};

type IndexedInput = {
  input: PayloadEnvelope;
  index: number;
  sourceKey: string;
};

/** Deterministically gathers parallel payload pools without changing payload content. */
export class JoinExecutor implements StepExecutor {
  readonly kinds = ["join"] as const;

  async execute(context: ExecutorContext): Promise<ExecutorResult> {
    const settings = joinSettings(context);
    const indexed = context.inputs.map((input, index) => ({
      input,
      index,
      sourceKey: input.source.edgeId ?? metadataString(input.metadata, "edgeId") ?? input.source.nodeId
    }));
    const expected = settings.expectedSourceEdgeIds;
    const sourceKeys = expected.length > 0 ? expected : [...new Set(indexed.map((item) => item.sourceKey))].sort();
    const groups = new Map(sourceKeys.map((key) => [key, [] as IndexedInput[]]));
    for (const item of indexed) {
      const group = groups.get(item.sourceKey);
      if (group === undefined) {
        groups.set(item.sourceKey, [item]);
      } else {
        group.push(item);
      }
    }
    if (settings.requireComplete) {
      const missing = sourceKeys.filter((key) => (groups.get(key)?.length ?? 0) === 0);
      if (missing.length > 0) {
        throw new ExecutorFailure(
          "JOIN_INPUT_INCOMPLETE",
          `Join requires one payload pool from every connected source; missing ${missing.join(", ")}.`
        );
      }
    }
    const orderedGroups = sourceKeys.map((key) => groups.get(key) ?? []);
    if (settings.strategy === "zip") {
      const sizes = orderedGroups.map((group) => group.length);
      const isComplete = sourceKeys.every((key) => (groups.get(key)?.length ?? 0) > 0) && sizes.every((size) => size === (sizes[0] ?? 0));
      if (settings.requireComplete && !isComplete) {
        throw new ExecutorFailure(
          "JOIN_INPUT_INCOMPLETE",
          `Zip join requires equal payload counts per source; received ${sizes.join(", ")}.`
        );
      }
      const zipped: IndexedInput[] = [];
      const width = settings.requireComplete ? (sizes[0] ?? 0) : Math.max(0, ...sizes);
      for (let index = 0; index < width; index += 1) {
        for (const group of orderedGroups) {
          const item = group[index];
          if (item !== undefined) zipped.push(item);
        }
      }
      return joinOutputs(zipped, settings, context.inputs.length, isComplete);
    }
    if (settings.strategy === "merge") {
      const merged = indexed.slice().sort((left, right) =>
        left.input.source.lineageKey.localeCompare(right.input.source.lineageKey) || left.index - right.index
      );
      const isComplete = sourceKeys.every((key) => (groups.get(key)?.length ?? 0) > 0);
      return joinOutputs(merged, settings, context.inputs.length, isComplete);
    }
    const ordered = indexed.slice().sort((left, right) => {
      const sourceOrder = sourceKeys.indexOf(left.sourceKey) - sourceKeys.indexOf(right.sourceKey);
      return sourceOrder || left.index - right.index;
    });
    const isComplete = sourceKeys.every((key) => (groups.get(key)?.length ?? 0) > 0);
    return joinOutputs(ordered, settings, context.inputs.length, isComplete);
  }
}

function joinOutputs(indexed: readonly IndexedInput[], settings: JoinSettings, inputCount: number, isComplete: boolean): ExecutorResult {
  return {
    kind: "complete",
    outputs: indexed.map(({ input, sourceKey }, index) => ({
      channel: input.channel,
      role: input.role,
      content: input.content,
      metadata: {
        ...input.metadata,
        joinStrategy: settings.strategy,
        joinIndex: index,
        joinSource: sourceKey,
        joinInputCount: inputCount,
        joinComplete: isComplete,
        joinInputLineageKey: input.source.lineageKey
      }
    }))
  };
}

function joinSettings(context: ExecutorContext): JoinSettings {
  const value = context.step.executorConfig?.join ?? context.step.parameters;
  const config = value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const strategy = config.strategy;
  if (strategy !== "ordered" && strategy !== "zip" && strategy !== "merge") {
    throw new ExecutorFailure("JOIN_CONFIGURATION_INVALID", "Join strategy must be ordered, zip, or merge.");
  }
  const expectedSourceEdgeIds = Array.isArray(config.expectedSourceEdgeIds)
    ? config.expectedSourceEdgeIds.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];
  return {
    strategy,
    requireComplete: config.requireComplete === true,
    expectedSourceEdgeIds
  };
}

function metadataString(metadata: Record<string, unknown>, key: string): string | undefined {
  const value = metadata[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
