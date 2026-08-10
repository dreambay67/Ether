import { randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

import { EditMaskGeometrySchema, type EditMaskGeometry, type PayloadEnvelope } from "@ether/schema";

import { ExecutorFailure, requireFacet, type ExecutorContext, type ExecutorResult, type LocalMediaFacet, type LocalMediaOutput, type StepExecutor } from "./types.js";
import { jsonValue } from "./input.js";

export class LocalMediaExecutor implements StepExecutor {
  readonly kinds = ["mask", "transform", "deterministic", "batch", "deterministic-filter"] as const;

  async execute(context: ExecutorContext): Promise<ExecutorResult> {
    if (context.step.executor === "deterministic-filter") return filter(context);
    if (context.step.executor === "batch" || context.step.executor === "deterministic") {
      return {
        kind: "complete",
        outputs: context.inputs.map((input) => ({
          channel: input.channel,
          role: input.role,
          content: input.content,
          metadata: { ...input.metadata, executor: context.step.executor }
        }))
      };
    }
    const localMedia = requireFacet(context.providers.localMedia, "deterministic local media");
    const operation = context.step.executor === "mask"
      ? "mask"
      : stringOperation(context.step.parameters.operation);
    const outputs = await localMedia.transform({
      operation,
      inputs: context.inputs,
      parameters: context.step.parameters,
      signal: context.signal,
      stagingDirectory: context.stagingDirectory
    });
    return { kind: "local-media", outputs };
  }
}

/**
 * The canonical edit.mask and edit.transform routes are intentionally local:
 * their results are derived only from scheduler-staged inputs, never a remote
 * provider.  The scheduler later imports the output file atomically as a local
 * artifact with ordinary output lineage.
 */
export function createSharpLocalMediaFacet(): LocalMediaFacet {
  return { transform: transformWithSharp };
}

async function transformWithSharp(input: Parameters<LocalMediaFacet["transform"]>[0]): Promise<LocalMediaOutput[]> {
  ensureNotAborted(input.signal);
  const source = requiredStagedInput(input.inputs, "image", "source image");
  const output = input.operation === "mask"
    ? await makeMask(input, source)
    : await transformImage(input, source);
  ensureNotAborted(input.signal);
  await mkdir(input.stagingDirectory, { recursive: true });
  const fileName = `local-${input.operation}-${randomUUID()}.png`;
  const stagedPath = path.join(input.stagingDirectory, fileName);
  await writeFile(stagedPath, output.bytes, { flag: "wx", mode: 0o600 });
  return [{
    channel: output.channel,
    role: output.role,
    fileName,
    mediaType: "image/png",
    stagedPath,
    metadata: {
      localMediaOperation: input.operation,
      sourcePayloadId: source.id,
      width: output.width,
      height: output.height,
      ...(source.content.kind === "artifact" ? { sourceArtifactId: source.content.artifactId } : {}),
      ...(output.channel === "mask" && output.maskPayloadId !== undefined ? { maskPayloadId: output.maskPayloadId } : {}),
      ...(output.channel === "mask" && output.workspaceMaskStrokeCount !== undefined
        ? { workspaceMaskStrokeCount: output.workspaceMaskStrokeCount }
        : {})
    }
  }];
}

async function transformImage(
  input: Parameters<LocalMediaFacet["transform"]>[0],
  source: PayloadEnvelope
): Promise<{ bytes: Buffer; channel: "image"; height: number; role: PayloadEnvelope["role"]; width: number }> {
  const sourceBytes = await stagedAssetBytes(source, input.stagingDirectory, "source image");
  const pipeline = sharp(sourceBytes, { failOn: "error" }).rotate();
  const metadata = await sharp(sourceBytes, { failOn: "error" }).metadata().catch((error: unknown) => decodeFailure("source image", error));
  const sourceWidth = metadata.width;
  const sourceHeight = metadata.height;
  if (sourceWidth === undefined || sourceHeight === undefined) {
    throw new ExecutorFailure("LOCAL_MEDIA_SOURCE_INVALID", "The source image has no readable dimensions.");
  }
  const operation = input.operation;
  if (operation === "resize") {
    const width = optionalPositiveInteger(input.parameters.width);
    const height = optionalPositiveInteger(input.parameters.height);
    if (width === undefined && height === undefined) {
      throw new ExecutorFailure("LOCAL_MEDIA_PARAMETERS_INVALID", "Resize requires a positive width or height.");
    }
    pipeline.resize({
      ...(width === undefined ? {} : { width }),
      ...(height === undefined ? {} : { height }),
      fit: input.parameters.preserveAspectRatio === false ? "fill" : "inside"
    });
  } else if (operation === "crop") {
    const width = requiredPositiveInteger(input.parameters.width, "Crop width");
    const height = requiredPositiveInteger(input.parameters.height, "Crop height");
    pipeline.resize({ width, height, fit: "cover", position: "centre" });
  } else if (operation === "rotate") {
    const angle = finiteAngle(input.parameters.angle);
    pipeline.rotate(angle);
  } else if (operation === "upscale") {
    const width = requiredPositiveInteger(input.parameters.width, "Upscale width");
    const height = requiredPositiveInteger(input.parameters.height, "Upscale height");
    if (width < sourceWidth || height < sourceHeight) {
      throw new ExecutorFailure("LOCAL_MEDIA_PARAMETERS_INVALID", "Upscale dimensions must not shrink the source image.");
    }
    pipeline.resize({ width, height, fit: input.parameters.preserveAspectRatio === false ? "fill" : "inside", withoutEnlargement: false });
  } else {
    throw new ExecutorFailure("LOCAL_MEDIA_OPERATION_UNSUPPORTED", `Unsupported deterministic transform operation ${String(operation)}.`);
  }
  const bytes = await pipeline.png({ compressionLevel: 9 }).toBuffer().catch((error: unknown) => decodeFailure("source image", error));
  const result = await sharp(bytes, { failOn: "error" }).metadata().catch((error: unknown) => decodeFailure("transformed image", error));
  if (result.width === undefined || result.height === undefined) {
    throw new ExecutorFailure("LOCAL_MEDIA_OUTPUT_INVALID", "The transformed image has no readable dimensions.");
  }
  return { bytes, channel: "image", role: source.role, width: result.width, height: result.height };
}

async function makeMask(
  input: Parameters<LocalMediaFacet["transform"]>[0],
  source: PayloadEnvelope
): Promise<{
  bytes: Buffer;
  channel: "mask";
  height: number;
  maskPayloadId?: string;
  role: "general";
  width: number;
  workspaceMaskStrokeCount?: number;
}> {
  if (input.parameters.mode === "provider") {
    throw new ExecutorFailure("LOCAL_MEDIA_OPERATION_UNSUPPORTED", "Provider mask mode is not a deterministic local operation.");
  }
  const sourceBytes = await stagedAssetBytes(source, input.stagingDirectory, "source image");
  const sourceMetadata = await sharp(sourceBytes, { failOn: "error" }).metadata().catch((error: unknown) => decodeFailure("source image", error));
  if (sourceMetadata.width === undefined || sourceMetadata.height === undefined) {
    throw new ExecutorFailure("LOCAL_MEDIA_SOURCE_INVALID", "The source image has no readable dimensions.");
  }
  const mask = input.inputs.find((candidate) => candidate.channel === "mask");
  const maskBytes = mask === undefined ? undefined : await stagedAssetBytes(mask, input.stagingDirectory, "mask");
  const geometry = workspaceMaskGeometry(input.parameters);
  const feather = optionalNonnegativeNumber(input.parameters.feather) ?? 0;
  if (feather > 100) {
    throw new ExecutorFailure("LOCAL_MEDIA_PARAMETERS_INVALID", "Mask feather must be between 0 and 100 pixels.");
  }
  let pipeline = geometry !== undefined
    ? sharp(rasterMaskSvg(geometry, sourceMetadata.width, sourceMetadata.height))
    : maskBytes === undefined
    ? sharp({ create: { width: sourceMetadata.width, height: sourceMetadata.height, channels: 3, background: 0 } })
    : sharp(maskBytes, { failOn: "error" })
      .resize({ width: sourceMetadata.width, height: sourceMetadata.height, fit: "fill" })
      .grayscale();
  pipeline = pipeline.grayscale();
  if (feather > 0) pipeline = pipeline.blur(Math.max(0.3, feather));
  const bytes = await pipeline.png({ compressionLevel: 9 }).toBuffer().catch((error: unknown) => decodeFailure("mask", error));
  return {
    bytes,
    channel: "mask",
    role: "general",
    width: sourceMetadata.width,
    height: sourceMetadata.height,
    ...(mask === undefined ? {} : { maskPayloadId: mask.id }),
    ...(geometry === undefined ? {} : { workspaceMaskStrokeCount: geometry.strokes.length })
  };
}

function requiredStagedInput(
  inputs: readonly PayloadEnvelope[],
  channel: "image" | "mask",
  label: string
): PayloadEnvelope {
  const input = inputs.find((candidate) => candidate.channel === channel);
  if (input === undefined) {
    throw new ExecutorFailure("LOCAL_MEDIA_SOURCE_REQUIRED", `The deterministic local operation requires an authorized ${label} input.`);
  }
  return input;
}

function workspaceMaskGeometry(parameters: Record<string, unknown>): EditMaskGeometry | undefined {
  const workspace = parameters.workspace;
  if (workspace === null || typeof workspace !== "object" || Array.isArray(workspace)) return undefined;
  const geometry = (workspace as Record<string, unknown>).geometry;
  if (geometry === undefined) return undefined;
  const parsed = EditMaskGeometrySchema.safeParse(geometry);
  if (!parsed.success) {
    throw new ExecutorFailure("LOCAL_MEDIA_PARAMETERS_INVALID", "The persisted mask workspace geometry is invalid.");
  }
  return parsed.data;
}

function rasterMaskSvg(geometry: EditMaskGeometry, width: number, height: number): Buffer {
  const scaleX = width / geometry.width;
  const scaleY = height / geometry.height;
  const scale = (scaleX + scaleY) / 2;
  const strokes = geometry.strokes.flatMap((stroke) => {
    if (stroke.points.length === 0) return [];
    const color = stroke.tool === "brush" ? "white" : "black";
    const opacity = Math.max(0, Math.min(1, stroke.opacity));
    const strokeWidth = stroke.size * scale;
    const points = stroke.points.map((point) => ({
      x: point.x * scaleX,
      y: point.y * scaleY,
      pressure: point.pressure
    }));
    if (points.length === 1) {
      const point = points[0]!;
      return [`<circle cx="${point.x}" cy="${point.y}" r="${Math.max(.5, strokeWidth * point.pressure / 2)}" fill="${color}" fill-opacity="${opacity}"/>`];
    }
    const pathData = points.map((point, index) => `${index === 0 ? "M" : "L"}${point.x} ${point.y}`).join(" ");
    return [`<path d="${pathData}" fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-opacity="${opacity}" stroke-linecap="round" stroke-linejoin="round"/>`];
  }).join("");
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="black"/>${strokes}</svg>`);
}

async function stagedAssetBytes(input: PayloadEnvelope, stagingDirectory: string, label: string): Promise<Buffer> {
  const assetPath = typeof input.metadata.assetPath === "string" ? input.metadata.assetPath : "";
  let root: string;
  try {
    root = await realpath(stagingDirectory);
  } catch (error) {
    throw new ExecutorFailure("LOCAL_MEDIA_SOURCE_INVALID", "The scheduler-owned media staging directory is unavailable.", false, { cause: error });
  }
  if (assetPath.length === 0) {
    throw new ExecutorFailure("LOCAL_MEDIA_SOURCE_INVALID", `The ${label} is not an authorized staged asset.`);
  }
  let canonical: string;
  try {
    canonical = await realpath(path.resolve(assetPath));
  } catch (error) {
    throw new ExecutorFailure("LOCAL_MEDIA_SOURCE_INVALID", `The ${label} staged asset is unavailable.`, false, { cause: error });
  }
  const canonicalRelative = path.relative(root, canonical);
  if (canonicalRelative === ".." || canonicalRelative.startsWith(`..${path.sep}`) || path.isAbsolute(canonicalRelative)) {
    throw new ExecutorFailure("LOCAL_MEDIA_SOURCE_INVALID", `The ${label} staged asset escapes its authorized directory.`);
  }
  try {
    if (!(await stat(canonical)).isFile()) {
      throw new ExecutorFailure("LOCAL_MEDIA_SOURCE_INVALID", `The ${label} staged asset is not a regular file.`);
    }
    return await readFile(canonical);
  } catch (error) {
    if (error instanceof ExecutorFailure) throw error;
    throw new ExecutorFailure("LOCAL_MEDIA_SOURCE_INVALID", `The ${label} staged asset could not be read.`, false, { cause: error });
  }
}

function requiredPositiveInteger(value: unknown, label: string): number {
  const parsed = optionalPositiveInteger(value);
  if (parsed === undefined) throw new ExecutorFailure("LOCAL_MEDIA_PARAMETERS_INVALID", `${label} must be a positive integer.`);
  return parsed;
}

function optionalPositiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 32_768 ? value : undefined;
}

function optionalNonnegativeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function finiteAngle(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= -360 || value >= 360 || value === 0) {
    throw new ExecutorFailure("LOCAL_MEDIA_PARAMETERS_INVALID", "Rotate angle must be a finite non-zero number between -360 and 360 degrees.");
  }
  return value;
}

function ensureNotAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new ExecutorFailure("CANCELLED", "Deterministic local media execution was cancelled.");
}

function decodeFailure(label: string, error: unknown): never {
  throw new ExecutorFailure(
    "LOCAL_MEDIA_DECODE_FAILED",
    `The ${label} could not be decoded as a supported image.`,
    false,
    { cause: error instanceof Error ? error : undefined }
  );
}

function filter(context: ExecutorContext): ExecutorResult {
  const rules = Array.isArray(context.step.parameters.rules) ? context.step.parameters.rules : [];
  const mode = context.step.parameters.match === "any" ? "any" : "all";
  const routes = Array.isArray(context.step.parameters.routes) ? context.step.parameters.routes : [];
  const items = context.inputs.flatMap((input) => expandFilterItems(input)).map((item) => {
    const explanations = rules.map((rule, index) => explainRule(item, rule, index));
    const matched = mode === "any" ? explanations.some((rule) => rule.matched) : explanations.every((rule) => rule.matched);
    const routeIds = routes.flatMap((route, index) => {
      if (route === null || typeof route !== "object" || Array.isArray(route)) return [];
      const value = route as { id?: unknown; outcome?: unknown };
      const outcome = value.outcome === "unmatched" ? "unmatched" : "matched";
      return matched === (outcome === "matched") ? [typeof value.id === "string" ? value.id : `route-${index + 1}`] : [];
    });
    return { ...item, matched, routeIds, explanations };
  });
  return {
    kind: "complete",
    outputs: [{
      channel: "data",
      role: "general",
      content: {
        kind: "object",
        value: jsonValue({
          match: mode,
          matchedPayloadIds: items.filter((item) => item.matched).map((item) => item.input.id),
          unmatchedPayloadIds: items.filter((item) => !item.matched).map((item) => item.input.id),
          items: items.map((item) => ({
            payloadId: item.input.id,
            ...(item.itemId === undefined ? {} : { itemId: item.itemId }),
            matched: item.matched,
            routeIds: item.routeIds,
            rules: item.explanations
          }))
        }),
        schemaId: "ether.filter-result.v1"
      },
      metadata: { ruleCount: rules.length, match: mode }
    }, ...items.map((item) => ({
      channel: item.input.channel,
      role: item.input.role,
      content: item.content,
      metadata: {
        ...item.input.metadata,
        filterPassthrough: true,
        filterSourcePayloadId: item.input.id,
        filterSourceOutputVersionId: item.input.source.outputVersionId,
        ...(item.itemId === undefined ? {} : { filterItemId: item.itemId }),
        filterMatched: item.matched,
        filterRouteIds: item.routeIds,
        filterExplanations: item.explanations
      }
    }))]
  };
}

function expandFilterItems(input: PayloadEnvelope): Array<{
  input: PayloadEnvelope;
  content: PayloadEnvelope["content"];
  itemId?: string;
  structured: Record<string, unknown> | null;
}> {
  const contentValue = input.content.kind === "object" && input.content.value !== null && typeof input.content.value === "object" && !Array.isArray(input.content.value)
    ? input.content.value as Record<string, unknown>
    : null;
  const evaluationItem = input.metadata.evaluationItem !== null && typeof input.metadata.evaluationItem === "object" && !Array.isArray(input.metadata.evaluationItem)
    ? input.metadata.evaluationItem as Record<string, unknown>
    : null;
  const structured = contentValue === null && evaluationItem === null
    ? null
    : { ...(contentValue ?? {}), ...(evaluationItem ?? {}) };
  const evaluationItems = Array.isArray(structured?.items)
    ? structured.items.filter((item): item is Record<string, unknown> => item !== null && typeof item === "object" && !Array.isArray(item))
    : [];
  if (evaluationItems.length === 0) return [{ input, content: input.content, structured }];
  return evaluationItems.map((evaluationItem, index) => ({
    input,
    content: { kind: "object", value: jsonValue(evaluationItem), schemaId: "ether.evaluation.item.v1" },
    itemId: typeof evaluationItem.id === "string" ? evaluationItem.id : `${input.id}:${index + 1}`,
    structured: { ...structured, ...evaluationItem }
  }));
}

function explainRule(
  item: { input: PayloadEnvelope; structured: Record<string, unknown> | null },
  rule: unknown,
  index: number
) {
  if (rule === null || typeof rule !== "object" || Array.isArray(rule)) {
    return { ruleId: `rule-${index + 1}`, field: "", operator: "invalid", matched: false, explanation: "Rule is not an object." };
  }
  const value = rule as { field?: unknown; operator?: unknown; value?: unknown };
  const ruleId = typeof (rule as { id?: unknown }).id === "string" ? String((rule as { id?: unknown }).id) : `rule-${index + 1}`;
  if (typeof value.field !== "string" || typeof value.operator !== "string") {
    return { ruleId, field: "", operator: "invalid", matched: false, explanation: "Rule needs a field and operator." };
  }
  const actual = structuredRuleValue(item, value.field);
  const matched = matchesValue(actual, value.operator, value.value);
  return {
    ruleId,
    field: value.field,
    operator: value.operator,
    matched,
    explanation: `${value.field} ${value.operator} ${displayValue(value.value)}; actual ${displayValue(actual)}: ${matched ? "matched" : "did not match"}.`
  };
}

function structuredRuleValue(
  item: { input: PayloadEnvelope; structured: Record<string, unknown> | null },
  field: string
): unknown {
  const structured = item.structured === null ? undefined : propertyAt(item.structured, field);
  return structured === undefined ? propertyAt(item.input.metadata, field) : structured;
}

function propertyAt(value: Record<string, unknown>, field: string): unknown {
  if (Object.hasOwn(value, field)) return value[field];
  return field.split(".").reduce<unknown>((current, segment) =>
    current !== null && typeof current === "object" && !Array.isArray(current)
      ? (current as Record<string, unknown>)[segment]
      : undefined,
  value);
}

function matchesValue(actual: unknown, operator: string, expected: unknown): boolean {
  switch (operator) {
    case "exists": return actual !== undefined;
    case "eq": return JSON.stringify(actual) === JSON.stringify(expected);
    case "neq": return JSON.stringify(actual) !== JSON.stringify(expected);
    case "contains": return typeof actual === "string" && actual.includes(String(expected ?? ""));
    case "gt": return typeof actual === "number" && typeof expected === "number" && actual > expected;
    case "gte": return typeof actual === "number" && typeof expected === "number" && actual >= expected;
    case "lt": return typeof actual === "number" && typeof expected === "number" && actual < expected;
    case "lte": return typeof actual === "number" && typeof expected === "number" && actual <= expected;
    default: return false;
  }
}

function displayValue(value: unknown): string {
  const encoded = JSON.stringify(value);
  return encoded === undefined ? "missing" : encoded;
}

function stringOperation(value: unknown): "resize" | "crop" | "rotate" | "upscale" {
  return value === "crop" || value === "rotate" || value === "upscale" ? value : "resize";
}
