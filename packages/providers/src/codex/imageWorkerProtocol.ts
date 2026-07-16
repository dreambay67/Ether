import { readFile } from "node:fs/promises";
import type { GenerationProviderInput, ImageEditProviderInput } from "../types.js";

export type ImageWorkerRequest = GenerationProviderInput & {
  outputDirectory: string;
};

export type ImageEditWorkerRequest = ImageEditProviderInput & {
  outputDirectory: string;
};

export type CodexImageWorkerResult = {
  id: string;
  status: string;
  image_path: string | null;
  error: string | null;
  caveats: string;
};

const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const crc32Table = createCrc32Table();

export function createImageWorkerRequest(
  input: GenerationProviderInput,
  outputDirectory: string
): ImageWorkerRequest {
  const request = { ...input, outputDirectory };
  assertImageWorkerRequest(request);
  return request;
}

export function createImageEditWorkerRequest(
  input: ImageEditProviderInput,
  outputDirectory: string
): ImageEditWorkerRequest {
  const request = { ...input, outputDirectory };
  assertImageEditWorkerRequest(request);
  return request;
}

export function assertImageWorkerRequest(value: unknown): asserts value is ImageWorkerRequest {
  assertObject(value, "Codex image worker request");
  assertString(value.projectPath, "Codex image worker request.projectPath");
  assertString(value.runId, "Codex image worker request.runId");
  assertString(value.generationNodeId, "Codex image worker request.generationNodeId");
  assertNumber(value.iteration, "Codex image worker request.iteration");
  assertString(value.prompt, "Codex image worker request.prompt");
  assertString(value.negativePrompt, "Codex image worker request.negativePrompt");
  assertSectionArray(value.sections, "Codex image worker request.sections");
  assertReferenceArray(value.references, "Codex image worker request.references");
  assertEdgeRoleArray(value.edgeRoles, "Codex image worker request.edgeRoles");
  if (value.output !== undefined) {
    assertObject(value.output, "Codex image worker request.output");
    assertString(value.output.aspectRatio, "Codex image worker request.output.aspectRatio");
    assertString(value.output.resolution, "Codex image worker request.output.resolution");
    assertNumber(value.output.width, "Codex image worker request.output.width");
    assertNumber(value.output.height, "Codex image worker request.output.height");
  }
  assertString(value.requestedAt, "Codex image worker request.requestedAt");
  assertString(value.outputDirectory, "Codex image worker request.outputDirectory");
}

export function assertImageEditWorkerRequest(value: unknown): asserts value is ImageEditWorkerRequest {
  assertObject(value, "Codex image edit worker request");
  assertString(value.projectPath, "Codex image edit worker request.projectPath");
  assertString(value.runId, "Codex image edit worker request.runId");
  assertString(value.editNodeId, "Codex image edit worker request.editNodeId");
  assertString(value.editSubtype, "Codex image edit worker request.editSubtype");
  assertString(value.operation, "Codex image edit worker request.operation");
  assertNumber(value.iteration, "Codex image edit worker request.iteration");
  assertString(value.prompt, "Codex image edit worker request.prompt");
  assertString(value.negativePrompt, "Codex image edit worker request.negativePrompt");
  assertString(value.instruction, "Codex image edit worker request.instruction");
  assertString(value.notes, "Codex image edit worker request.notes");
  assertSectionArray(value.sections, "Codex image edit worker request.sections");
  assertReferenceArray(value.references, "Codex image edit worker request.references");
  assertEdgeRoleArray(value.edgeRoles, "Codex image edit worker request.edgeRoles");
  assertObject(value.sourceImage, "Codex image edit worker request.sourceImage");
  assertString(value.sourceImage.assetPath, "Codex image edit worker request.sourceImage.assetPath");
  assertOptionalString(value.sourceImage.assetId, "Codex image edit worker request.sourceImage.assetId");
  assertOptionalString(value.sourceImage.assetKind, "Codex image edit worker request.sourceImage.assetKind");
  assertOptionalObject(value.sourceImage.assetMetadata, "Codex image edit worker request.sourceImage.assetMetadata");
  if (value.mask !== null && value.mask !== undefined) {
    assertObject(value.mask, "Codex image edit worker request.mask");
    assertOptionalString(value.mask.assetId, "Codex image edit worker request.mask.assetId");
    assertOptionalString(value.mask.assetPath, "Codex image edit worker request.mask.assetPath");
    assertOptionalObject(value.mask.assetMetadata, "Codex image edit worker request.mask.assetMetadata");
  }
  if (value.recipe !== undefined) {
    assertObject(value.recipe, "Codex image edit worker request.recipe");
    assertString(value.recipe.id, "Codex image edit worker request.recipe.id");
    assertOptionalString(value.recipe.label, "Codex image edit worker request.recipe.label");
    assertOptionalObject(value.recipe.metadata, "Codex image edit worker request.recipe.metadata");
  }
  if (value.frame !== undefined) {
    assertObject(value.frame, "Codex image edit worker request.frame");
    assertFrameMode(value.frame.mode, "Codex image edit worker request.frame.mode");
    assertNumber(value.frame.x, "Codex image edit worker request.frame.x");
    assertNumber(value.frame.y, "Codex image edit worker request.frame.y");
    assertNumber(value.frame.width, "Codex image edit worker request.frame.width");
    assertNumber(value.frame.height, "Codex image edit worker request.frame.height");
    assertOptionalNumber(value.frame.canvasWidth, "Codex image edit worker request.frame.canvasWidth");
    assertOptionalNumber(value.frame.canvasHeight, "Codex image edit worker request.frame.canvasHeight");
  }
  assertString(value.requestedAt, "Codex image edit worker request.requestedAt");
  assertString(value.outputDirectory, "Codex image edit worker request.outputDirectory");
}

export async function readCodexImageWorkerResult(resultPath: string): Promise<CodexImageWorkerResult> {
  const parsed = await readWorkerJson(resultPath, "Codex image worker");
  assertObject(parsed, "Codex image worker result.json");

  return {
    id: requiredString(parsed.id, "Codex image worker result.json id"),
    status: requiredString(parsed.status, "Codex image worker result.json status"),
    image_path: requiredNullableString(parsed.image_path, "Codex image worker result.json image_path"),
    error: requiredNullableString(parsed.error, "Codex image worker result.json error"),
    caveats: requiredString(parsed.caveats, "Codex image worker result.json caveats")
  };
}

export async function readRequiredPngOutput(filePath: string) {
  let content: Buffer;

  try {
    content = await readFile(filePath);
  } catch (error) {
    if (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`Codex image worker required PNG output was not found: ${filePath}`);
    }

    throw new Error(
      `Codex image worker required PNG output could not be read: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  const invalidReason = getPngValidationError(content);

  if (invalidReason) {
    throw new Error(`Codex image worker output is not valid PNG bytes: ${filePath} (${invalidReason})`);
  }

  return content;
}

async function readWorkerJson(resultPath: string, workerLabel: string) {
  try {
    return JSON.parse(await readFile(resultPath, "utf8")) as unknown;
  } catch (error) {
    if (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`${workerLabel} did not write required result file: ${resultPath}`);
    }

    throw new Error(
      `${workerLabel} result file is not valid JSON: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

function getPngValidationError(content: Buffer) {
  if (content.length < pngSignature.length) {
    return "missing PNG signature";
  }

  if (!pngSignature.every((byte, index) => content[index] === byte)) {
    return "invalid PNG signature";
  }

  let offset = pngSignature.length;
  let chunkIndex = 0;
  let foundIend = false;
  let totalIdatDataLength = 0;

  while (offset < content.length) {
    if (content.length - offset < 12) {
      return "truncated PNG chunk header";
    }

    const length = content.readUInt32BE(offset);
    offset += 4;
    const typeStart = offset;
    const type = content.toString("ascii", typeStart, typeStart + 4);
    offset += 4;
    const dataStart = offset;
    const dataEnd = dataStart + length;
    const crcEnd = dataEnd + 4;

    if (dataEnd > content.length || crcEnd > content.length) {
      return `PNG chunk ${type || "(unknown)"} length exceeds file bounds`;
    }

    if (chunkIndex === 0 && (type !== "IHDR" || length !== 13)) {
      return "first PNG chunk must be IHDR with length 13";
    }

    const expectedCrc = content.readUInt32BE(dataEnd);
    const actualCrc = calculateCrc32(content.subarray(typeStart, dataEnd));

    if (actualCrc !== expectedCrc) {
      return `PNG chunk ${type} CRC mismatch`;
    }

    if (type === "IDAT") {
      totalIdatDataLength += length;
    }

    offset = crcEnd;
    chunkIndex += 1;

    if (type === "IEND") {
      if (length !== 0) {
        return "PNG IEND chunk must have length 0";
      }

      if (totalIdatDataLength <= 0) {
        return "PNG is missing non-empty IDAT image data";
      }

      foundIend = true;

      if (offset !== content.length) {
        return "PNG data has trailing bytes after IEND";
      }

      break;
    }
  }

  if (!foundIend) {
    return "PNG is missing IEND chunk";
  }

  return null;
}

function createCrc32Table() {
  const table = new Uint32Array(256);

  for (let index = 0; index < table.length; index += 1) {
    let value = index;

    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }

    table[index] = value >>> 0;
  }

  return table;
}

function calculateCrc32(content: Uint8Array) {
  let crc = 0xffffffff;

  for (const byte of content) {
    crc = crc32Table[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
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

function assertSectionArray(value: unknown, label: string): asserts value is ImageWorkerRequest["sections"] {
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

function assertReferenceArray(value: unknown, label: string): asserts value is ImageWorkerRequest["references"] {
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

function assertEdgeRoleArray(value: unknown, label: string): asserts value is ImageWorkerRequest["edgeRoles"] {
  assertArray(value, label);

  value.forEach((edgeRole, index) => {
    const itemLabel = `${label}[${index}]`;
    assertObject(edgeRole, itemLabel);
    assertString(edgeRole.edgeId, `${itemLabel}.edgeId`);
    assertString(edgeRole.role, `${itemLabel}.role`);
  });
}

function assertSectionKind(value: unknown, label: string): asserts value is "prompt" | "negativePrompt" {
  if (value !== "prompt" && value !== "negativePrompt") {
    throw new Error(`${label} must be "prompt" or "negativePrompt".`);
  }
}

function assertFrameMode(value: unknown, label: string): asserts value is "source" | "crop" | "outpaint" {
  if (value !== "source" && value !== "crop" && value !== "outpaint") {
    throw new Error(`${label} must be "source", "crop", or "outpaint".`);
  }
}

function assertOptionalString(value: unknown, label: string): asserts value is string | undefined {
  if (value !== undefined) {
    assertString(value, label);
  }
}

function assertOptionalNumber(value: unknown, label: string): asserts value is number | undefined {
  if (value !== undefined) {
    assertNumber(value, label);
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

function requiredString(value: unknown, label: string) {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string.`);
  }

  return value;
}

function requiredNullableString(value: unknown, label: string) {
  if (value === null) {
    return null;
  }

  return requiredString(value, label);
}
