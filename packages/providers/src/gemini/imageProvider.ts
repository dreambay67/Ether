import { createHash, randomUUID } from "node:crypto";
import { link, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { ProviderOutputCountUnsupportedError, ProviderUnavailableError } from "../errors.js";
import type {
  GeneratedArtifact,
  GenerationProvider,
  GenerationProviderInput,
  ImageEditProviderInput,
  ProviderDiagnostic,
  ProviderDiagnosticContext,
  ProviderExecutionContext,
  ProviderGenerationResult
} from "../types.js";

/**
 * Google Gemini Developer API, Interactions API (v1beta), reviewed 2026-07-30.
 * The adapter deliberately uses the documented REST endpoint instead of adding
 * an SDK dependency. This keeps the paid credential in Electron main process.
 */
export const GEMINI_INTERACTIONS_API_VERSION = "v1beta";
export const GEMINI_INTERACTIONS_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/interactions";
export const GEMINI_IMAGE_PROVIDER_IDS = {
  "nano-banana-2": "google-gemini-api-nano-banana-2",
  "nano-banana-pro": "google-gemini-api-nano-banana-pro",
  "nano-banana-2-lite": "google-gemini-api-nano-banana-2-lite"
} as const;

export type GeminiImageProfile = keyof typeof GEMINI_IMAGE_PROVIDER_IDS;

type GeminiProfileDefinition = {
  id: GeminiImageProfile;
  name: string;
  model: "gemini-3.1-flash-image" | "gemini-3-pro-image" | "gemini-3.1-flash-lite-image";
  sizes: readonly ("0.5K" | "1K" | "2K" | "4K")[];
  aspectRatios: readonly string[];
  maxReferences: number;
  referenceNote: string;
  costEstimateUsd: Partial<Record<"0.5K" | "1K" | "2K" | "4K", number>>;
};

const STANDARD_RATIOS = ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"] as const;
const PROFILE_DEFINITIONS: Record<GeminiImageProfile, GeminiProfileDefinition> = {
  "nano-banana-2": {
    id: "nano-banana-2",
    name: "Nano Banana 2",
    model: "gemini-3.1-flash-image",
    sizes: ["0.5K", "1K", "2K", "4K"],
    aspectRatios: ["1:1", "1:4", "1:8", "2:3", "3:2", "3:4", "4:1", "4:3", "4:5", "5:4", "8:1", "9:16", "16:9", "21:9"],
    maxReferences: 10,
    referenceNote: "Up to 10 object references; up to 4 character references when that mode is used.",
    costEstimateUsd: { "0.5K": 0.045, "1K": 0.067, "2K": 0.101, "4K": 0.151 }
  },
  "nano-banana-pro": {
    id: "nano-banana-pro",
    name: "Nano Banana Pro",
    model: "gemini-3-pro-image",
    sizes: ["1K", "2K", "4K"],
    aspectRatios: STANDARD_RATIOS,
    maxReferences: 6,
    referenceNote: "Up to 6 object references; character and style-reference limits are separately lower or higher by Google category.",
    costEstimateUsd: { "1K": 0.134, "2K": 0.134, "4K": 0.24 }
  },
  "nano-banana-2-lite": {
    id: "nano-banana-2-lite",
    name: "Nano Banana 2 Lite",
    model: "gemini-3.1-flash-lite-image",
    sizes: ["1K"],
    aspectRatios: STANDARD_RATIOS,
    maxReferences: 14,
    referenceNote: "Up to 14 object references. This Lite model is not optimized for multi-reference or sequential editing.",
    costEstimateUsd: { "1K": 0.0336 }
  }
};

const MAX_IMAGE_BYTES = 50 * 1024 * 1024;
const MAX_AGGREGATE_IMAGE_BYTES = 100 * 1024 * 1024;
const MAX_TIMEOUT_MS = 300_000;
const MAX_RETRY_AFTER_MS = 5_000;

export class GeminiImageProviderError extends Error {
  readonly category = "provider" as const;
  readonly failureCategory:
    | "authentication"
    | "billing"
    | "quota"
    | "safety"
    | "network"
    | "server"
    | "timeout"
    | "cancellation"
    | "invalid-input"
    | "malformed-output"
    | "ambiguous";
  readonly code: string;
  readonly retryable: boolean;

  constructor(
    category: GeminiImageProviderError["failureCategory"],
    code: string,
    message: string,
    retryable = false
  ) {
    super(message);
    this.name = category === "cancellation" ? "AbortError" : "GeminiImageProviderError";
    this.failureCategory = category;
    this.code = code;
    this.retryable = retryable;
  }
}

export type GeminiImageProviderOptions = {
  /** Main-process callback only. Do not pass credentials via environment variables. */
  getApiKey: () => Promise<string | null> | string | null;
  credentialState?: () => GeminiCredentialState;
  fetch?: typeof fetch;
  timeoutMs?: number;
};

export type GeminiCredentialState = "not-configured" | "configured" | "verified" | "error" | "encryption-unavailable";

export class GeminiImageProvider implements GenerationProvider {
  readonly descriptor;
  private readonly definition: GeminiProfileDefinition;
  private readonly getApiKey: GeminiImageProviderOptions["getApiKey"];
  private readonly getCredentialState: () => GeminiCredentialState;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(readonly profile: GeminiImageProfile, options: GeminiImageProviderOptions) {
    this.definition = PROFILE_DEFINITIONS[profile];
    this.descriptor = {
      id: GEMINI_IMAGE_PROVIDER_IDS[profile],
      name: `${this.definition.name} / Gemini API`,
      route: "api-generation" as const,
      capabilities: ["image.generate", "image.edit", "image.reference-input"] as const,
      model: this.definition.model,
      notes: [
        "Paid Gemini Developer API via the official Interactions API; this is the default Nano Banana route.",
        "Google Search and Google Image Search grounding are off and never enabled by Ether.",
        "All generated images include Google SynthID according to the model documentation."
      ]
    };
    this.getApiKey = options.getApiKey;
    this.getCredentialState = options.credentialState ?? (() => "not-configured");
    this.fetchImpl = options.fetch ?? fetch;
    this.timeoutMs = boundedTimeout(options.timeoutMs ?? MAX_TIMEOUT_MS);
  }

  diagnose(_context: ProviderDiagnosticContext = {}): ProviderDiagnostic {
    const credentialState = this.getCredentialState();
    const available = credentialState === "configured" || credentialState === "verified";
    return {
      ...this.descriptor,
      capabilities: [...this.descriptor.capabilities],
      availability: available ? "available" : "unavailable",
      messages: available
        ? [
            credentialState === "verified"
              ? "The protected Gemini API connection was verified without generating an image."
              : "A protected Gemini API key is configured but has not been verified yet.",
            "Google Search and Google Image Search grounding are disabled. No fallback provider is used."
          ]
        : [credentialMessage(credentialState)],
      profiles: [
        capabilityProfile(this.definition, this.descriptor.id, available, "image.generate"),
        capabilityProfile(this.definition, this.descriptor.id, available, "image.edit")
      ],
      details: {
        providerRoute: "gemini-developer-api",
        apiVersion: GEMINI_INTERACTIONS_API_VERSION,
        endpoint: "https://generativelanguage.googleapis.com/<redacted>",
        credentialState,
        searchGrounding: "off",
        imageSearchGrounding: "off",
        synthId: "included-by-google",
        costEstimateUsd: { ...this.definition.costEstimateUsd },
        pricingLabel: "List-price estimate only; final billing is determined by Google and can include token usage."
      }
    };
  }

  async testConnection(signal?: AbortSignal): Promise<void> {
    const apiKey = await this.requireApiKey();
    const result = await this.request("https://generativelanguage.googleapis.com/v1beta/models", {
      method: "GET",
      headers: { "x-goog-api-key": apiKey },
      signal
    }, false);
    if (!result.ok) throw classifyHttpFailure(result.status, await safeBody(result));
    // A successful authenticated model-list response deliberately generates no image.
  }

  async generate(input: GenerationProviderInput, context?: ProviderExecutionContext): Promise<ProviderGenerationResult> {
    if ((input.outputCount ?? 1) !== 1) {
      throw new ProviderOutputCountUnsupportedError(this.descriptor.id, input.outputCount ?? 1, 1);
    }
    if (context?.signal.aborted) throw cancellationError();
    if (input.output?.outputFormat !== undefined && input.output.outputFormat !== "image/jpeg") {
      throw new GeminiImageProviderError(
        "invalid-input",
        "GEMINI_OUTPUT_FORMAT_UNSUPPORTED",
        "The Gemini Developer API Interactions image route currently returns JPEG for Nano Banana 2, Pro, and Lite. Direct PNG output is unavailable on this route."
      );
    }
    const output = requestedOutput(this.definition, input.output);
    const apiInput = await this.imageInputs(input.prompt, input.negativePrompt, input.references, []);
    return this.createImage({
      input,
      context,
      apiInput,
      responseFormat: {
        type: "image",
        mime_type: "image/jpeg",
        aspect_ratio: output.aspectRatio,
        image_size: output.size
      },
      expectedMimeType: "image/jpeg",
      expected: output
    });
  }

  async edit(input: ImageEditProviderInput, context?: ProviderExecutionContext): Promise<ProviderGenerationResult> {
    if ((input.outputCount ?? 1) !== 1) {
      throw new ProviderOutputCountUnsupportedError(this.descriptor.id, input.outputCount ?? 1, 1);
    }
    if (context?.signal.aborted) throw cancellationError();
    const apiInput = await this.imageInputs(
      input.instruction || input.prompt,
      input.negativePrompt,
      input.references,
      [input.sourceImage.assetPath, input.mask?.assetPath].filter((filePath): filePath is string => Boolean(filePath))
    );
    return this.createImage({
      input,
      context,
      apiInput,
      responseFormat: { type: "image", mime_type: "image/jpeg" },
      expectedMimeType: "image/jpeg"
    });
  }

  private async createImage(args: {
    input: GenerationProviderInput | ImageEditProviderInput;
    context?: ProviderExecutionContext;
    apiInput: Array<Record<string, string>>;
    responseFormat: Record<string, string>;
    expectedMimeType: "image/png" | "image/jpeg";
    expected?: RequestedOutput;
  }): Promise<ProviderGenerationResult> {
    const apiKey = await this.requireApiKey();
    const timeoutMs = boundedTimeout(args.input.timeoutMs ?? this.timeoutMs);
    const body = {
      model: this.definition.model,
      input: args.apiInput,
      response_format: args.responseFormat,
      // Interactions defaults to stored state; prompts and images must not be retained by Ether's calls.
      store: false
      // No `tools` member: Google Search and Google Image Search are intentionally disabled.
    };
    const response = await this.request(GEMINI_INTERACTIONS_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(body),
      signal: args.context?.signal
    }, true, timeoutMs);
    if (!response.ok) throw classifyHttpFailure(response.status, await safeBody(response));
    const parsed = await parseResponse(response);
    const image = parseOutputImage(parsed, args.expectedMimeType);
    if (args.expected && (image.width !== args.expected.width || image.height !== args.expected.height)) {
      throw new GeminiImageProviderError(
        "malformed-output",
        "GEMINI_DIMENSIONS_MISMATCH",
        `Gemini returned ${image.width} x ${image.height}; ${args.expected.width} x ${args.expected.height} was requested.`
      );
    }
    const attemptId = args.context?.providerAttemptId ?? randomUUID();
    const staged = await stageOutput(args.context?.stagingDirectory ?? args.input.workspacePath, attemptId, image);
    const artifact: GeneratedArtifact = {
      fileName: path.basename(staged.path),
      sourcePath: staged.path,
      mimeType: image.mimeType,
      metadata: {
        sha256: staged.sha256,
        dimensions: { width: image.width, height: image.height },
        provenance: {
          route: "gemini-developer-api",
          model: this.definition.model,
          profile: this.profile,
          apiVersion: GEMINI_INTERACTIONS_API_VERSION,
          synthId: "included-by-google",
          searchGrounding: false,
          imageSearchGrounding: false
        }
      }
    };
    const completion: ProviderGenerationResult = {
      providerId: this.descriptor.id,
      providerName: this.descriptor.name,
      capabilities: [...this.descriptor.capabilities],
      artifacts: [artifact],
      metadata: {
        route: "gemini-developer-api",
        model: this.definition.model,
        profile: this.profile,
        attemptId,
        apiVersion: GEMINI_INTERACTIONS_API_VERSION,
        responseRequestId: response.headers.get("x-request-id") ?? response.headers.get("x-goog-request-id") ?? null,
        synthId: "included-by-google",
        searchGrounding: false,
        imageSearchGrounding: false,
        costEstimateUsd: args.expected ? this.definition.costEstimateUsd[args.expected.size] ?? null : null,
        costEstimateLabel: "Estimate only; Google billing is authoritative."
      }
    };
    await args.context?.complete(completion);
    return completion;
  }

  private async imageInputs(
    prompt: string,
    negativePrompt: string,
    references: GenerationProviderInput["references"],
    requiredImages: string[]
  ) {
    const imagePaths = uniqueImagePaths([
      ...requiredImages,
      ...references.flatMap((reference) => reference.assetPath ? [reference.assetPath] : [])
    ]);
    if (imagePaths.length > this.definition.maxReferences) {
      throw new GeminiImageProviderError(
        "invalid-input",
        "GEMINI_REFERENCE_LIMIT",
        `${this.definition.name} accepts at most ${this.definition.maxReferences} total source, mask, and reference images.`
      );
    }
    const result: Array<Record<string, string>> = [{ type: "text", text: composePrompt(prompt, negativePrompt) }];
    let aggregateBytes = 0;
    for (const filePath of imagePaths) {
      const image = await readInputImage(filePath);
      aggregateBytes += image.content.length;
      if (aggregateBytes > MAX_AGGREGATE_IMAGE_BYTES) {
        throw new GeminiImageProviderError(
          "invalid-input",
          "GEMINI_REFERENCE_AGGREGATE_SIZE",
          "Gemini source, mask, and reference images exceed Ether's safe 100 MB aggregate request limit."
        );
      }
      result.push({ type: "image", mime_type: image.mimeType, data: image.content.toString("base64") });
    }
    return result;
  }

  private async requireApiKey() {
    const state = this.getCredentialState();
    if (state !== "configured" && state !== "verified") {
      throw new ProviderUnavailableError(this.diagnose());
    }
    const key = await this.getApiKey();
    if (!key?.trim()) throw new ProviderUnavailableError(this.diagnose());
    return key;
  }

  private async request(url: string, init: RequestInit, allowQuotaRetry: boolean, timeoutMs = this.timeoutMs): Promise<Response> {
    const first = await this.fetchWithBoundary(url, init, timeoutMs);
    if (!allowQuotaRetry || first.status !== 429) return first;
    const retryAfterMs = retryAfter(first.headers.get("retry-after"));
    if (retryAfterMs === null) return first;
    // 429 does not contain an output. One bounded retry is safe; all ambiguous completions fail closed.
    await waitForRetry(retryAfterMs, init.signal ?? undefined);
    return this.fetchWithBoundary(url, init, timeoutMs);
  }

  private async fetchWithBoundary(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
    const controller = new AbortController();
    let timedOut = false;
    const forwardAbort = () => controller.abort();
    init.signal?.addEventListener("abort", forwardAbort, { once: true });
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    try {
      return await this.fetchImpl(url, { ...init, signal: controller.signal });
    } catch (_error) {
      if (init.signal?.aborted) throw cancellationError();
      if (timedOut) throw new GeminiImageProviderError("timeout", "GEMINI_TIMEOUT", "Gemini did not respond before Ether's bounded timeout.");
      throw new GeminiImageProviderError("network", "GEMINI_NETWORK", "Ether could not reach the Gemini API. No output was accepted; retry manually if appropriate.");
    } finally {
      clearTimeout(timer);
      init.signal?.removeEventListener("abort", forwardAbort);
    }
  }
}

export function createGeminiImageProviders(options: GeminiImageProviderOptions) {
  return (["nano-banana-2", "nano-banana-pro", "nano-banana-2-lite"] as const)
    .map((profile) => new GeminiImageProvider(profile, options));
}

function capabilityProfile(
  definition: GeminiProfileDefinition,
  providerId: string,
  available: boolean,
  operation: "image.generate" | "image.edit"
) {
  return {
    providerId,
    profileId: definition.id,
    providerName: `${definition.name} / Gemini API`,
    route: "api-generation" as const,
    operation,
    inputChannels: ["text", "image"] as const,
    outputChannels: ["image"] as const,
    availability: available ? "available" as const : "unavailable" as const,
    status: available ? "ready" as const : "unavailable" as const,
    capabilitySource: "gemini-developer-api" as const,
    requiresExplicitSelection: false,
    noHiddenFallback: true,
    model: definition.model,
    maxParallelism: 4,
    messages: [
      "Gemini API profiles share four active requests across the application.",
      definition.referenceNote,
      operation === "image.edit"
        ? "Editing sends the source image plus instruction and validates the returned image; masks are guidance, not a promise of pixel-exact native inpainting."
        : "",
      "Search grounding is off. Prices shown by Ether are estimates, not billing truth."
    ].filter(Boolean),
    aspectRatios: [...definition.aspectRatios],
    resolutions: definition.sizes.flatMap((size) => definition.aspectRatios.map((ratio) => ({
      id: `${size.toLowerCase()}-${ratio.replace(":", "x")}`,
      ...dimensionsFor(ratio, size),
      label: `${size} · ${ratio} (${dimensionsFor(ratio, size).width} × ${dimensionsFor(ratio, size).height})`,
      aspectRatio: ratio,
      tier: size
    }))),
    outputFormats: ["image/jpeg"] as const,
    mediaLimits: {
      maxInputs: definition.maxReferences,
      maxInputBytes: MAX_IMAGE_BYTES,
      mimeTypes: ["image/png", "image/jpeg"],
      notes: [definition.referenceNote]
    }
  };
}

type RequestedOutput = { aspectRatio: string; size: "0.5K" | "1K" | "2K" | "4K"; width: number; height: number };
function requestedOutput(definition: GeminiProfileDefinition, output: GenerationProviderInput["output"] | undefined): RequestedOutput {
  const aspectRatio = output?.aspectRatio ?? "1:1";
  const size = sizeForDimensions(aspectRatio, output?.width ?? 1024, output?.height ?? 1024, definition.sizes);
  if (!definition.aspectRatios.includes(aspectRatio) || size === null) {
    throw new GeminiImageProviderError("invalid-input", "GEMINI_OUTPUT_UNSUPPORTED", `${definition.name} does not support the requested structural aspect ratio and image size.`);
  }
  const dimensions = dimensionsFor(aspectRatio, size);
  if (output && (output.width !== dimensions.width || output.height !== dimensions.height)) {
    throw new GeminiImageProviderError("invalid-input", "GEMINI_OUTPUT_DIMENSIONS", `The requested dimensions must exactly match Gemini's ${size} ${aspectRatio} output (${dimensions.width} × ${dimensions.height}).`);
  }
  return { aspectRatio, size, ...dimensions };
}

function dimensionsFor(ratio: string, size: "0.5K" | "1K" | "2K" | "4K") {
  const base: Record<string, readonly [number, number]> = {
    "1:1": [1024, 1024], "1:4": [512, 2048], "1:8": [384, 3072], "2:3": [848, 1264],
    "3:2": [1264, 848], "3:4": [896, 1200], "4:1": [2048, 512], "4:3": [1200, 896],
    "4:5": [928, 1152], "5:4": [1152, 928], "8:1": [3072, 384], "9:16": [768, 1376],
    "16:9": [1376, 768], "21:9": [1584, 672]
  };
  const pair = base[ratio];
  if (!pair) throw new Error(`Unsupported Gemini aspect ratio ${ratio}.`);
  const scale = size === "0.5K" ? 0.5 : size === "2K" ? 2 : size === "4K" ? 4 : 1;
  // Gemini's 0.5K 1:8 and 8:1 values are 192×1536 / 1536×192, not rounded halves.
  if (size === "0.5K" && ratio === "1:8") return { width: 192, height: 1536 };
  if (size === "0.5K" && ratio === "8:1") return { width: 1536, height: 192 };
  return { width: pair[0] * scale, height: pair[1] * scale };
}

function sizeForDimensions(ratio: string, width: number, height: number, allowed: readonly ("0.5K" | "1K" | "2K" | "4K")[]) {
  return allowed.find((size) => {
    const expected = dimensionsFor(ratio, size);
    return expected.width === width && expected.height === height;
  }) ?? null;
}

function composePrompt(prompt: string, negativePrompt: string) {
  const primary = prompt.trim();
  if (!primary) throw new GeminiImageProviderError("invalid-input", "GEMINI_PROMPT_REQUIRED", "Gemini requires a non-empty image instruction.");
  return negativePrompt.trim() ? `${primary}\n\nAvoid: ${negativePrompt.trim()}` : primary;
}

async function readInputImage(filePath: string) {
  let content: Buffer;
  try { content = await readFile(filePath); } catch { throw new GeminiImageProviderError("invalid-input", "GEMINI_REFERENCE_UNREADABLE", "A selected reference image could not be read."); }
  if (content.length === 0 || content.length > MAX_IMAGE_BYTES) throw new GeminiImageProviderError("invalid-input", "GEMINI_REFERENCE_SIZE", "A selected reference image is empty or exceeds Ether's safe 50 MB limit.");
  const mimeType = sniffImageMimeType(content);
  if (mimeType === null) throw new GeminiImageProviderError("invalid-input", "GEMINI_REFERENCE_FORMAT", "Ether supports PNG and JPEG reference images for this Gemini route.");
  return { content, mimeType };
}

type ParsedImage = { content: Buffer; mimeType: "image/png" | "image/jpeg"; width: number; height: number };
function parseOutputImage(value: unknown, requestedMime: string): ParsedImage {
  const imageBlocks = outputImageBlocks(value);
  if (imageBlocks.length === 0) {
    throw new GeminiImageProviderError("malformed-output", "GEMINI_OUTPUT_MISSING", "Gemini completed without one valid image output. Ether did not import an ambiguous result.");
  }
  if (imageBlocks.length !== 1) {
    throw new GeminiImageProviderError("malformed-output", "GEMINI_OUTPUT_COUNT", `Gemini returned ${imageBlocks.length} final image outputs when Ether requested exactly one. No ambiguous result was imported.`);
  }
  let content: Buffer;
  try { content = Buffer.from(imageBlocks[0]!.data, "base64"); } catch { throw new GeminiImageProviderError("malformed-output", "GEMINI_OUTPUT_BASE64", "Gemini returned malformed image data."); }
  if (content.length === 0 || content.length > MAX_IMAGE_BYTES) throw new GeminiImageProviderError("malformed-output", "GEMINI_OUTPUT_SIZE", "Gemini returned an image outside Ether's safe import bounds.");
  const mimeType = sniffImageMimeType(content);
  if (mimeType === null || mimeType !== requestedMime) throw new GeminiImageProviderError("malformed-output", "GEMINI_OUTPUT_MIME", "Gemini returned an image whose actual format did not match the requested format.");
  const dimensions = imageDimensions(content);
  if (!dimensions) throw new GeminiImageProviderError("malformed-output", "GEMINI_OUTPUT_DIMENSIONS", "Gemini returned an image with unreadable dimensions.");
  return { content, mimeType, ...dimensions };
}

function outputImageBlocks(value: unknown): Array<{ data: string }> {
  if (!isRecord(value)) return [];
  if (isRecord(value.output_image) && typeof value.output_image.data === "string") {
    return [{ data: value.output_image.data }];
  }
  if (!Array.isArray(value.steps)) return [];
  return value.steps.flatMap((step) => {
    if (!isRecord(step) || step.type !== "model_output" || !Array.isArray(step.content)) return [];
    return step.content.flatMap((block) =>
      isRecord(block) && block.type === "image" && typeof block.data === "string"
        ? [{ data: block.data }]
        : []
    );
  });
}

function sniffImageMimeType(content: Buffer): "image/png" | "image/jpeg" | null {
  if (content.length >= 8 && content.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (content.length >= 3 && content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff) return "image/jpeg";
  return null;
}

function imageDimensions(content: Buffer): { width: number; height: number } | null {
  if (sniffImageMimeType(content) === "image/png" && content.length >= 24) return { width: content.readUInt32BE(16), height: content.readUInt32BE(20) };
  if (sniffImageMimeType(content) === "image/jpeg") {
    let offset = 2;
    while (offset + 9 < content.length) {
      if (content[offset] !== 0xff) return null;
      const marker = content[offset + 1]!;
      const length = content.readUInt16BE(offset + 2);
      if (length < 2 || offset + length + 2 > content.length) return null;
      if (marker >= 0xc0 && marker <= 0xc3) return { width: content.readUInt16BE(offset + 7), height: content.readUInt16BE(offset + 5) };
      offset += 2 + length;
    }
  }
  return null;
}

async function stageOutput(root: string, attemptId: string, image: ParsedImage) {
  const directory = path.join(root, "gemini-api", `attempt-${safeSegment(attemptId)}`);
  await mkdir(directory, { recursive: true });
  const sha256 = createHash("sha256").update(image.content).digest("hex");
  const extension = image.mimeType === "image/jpeg" ? ".jpg" : ".png";
  const stagedPath = path.join(directory, `${sha256}${extension}`);
  const temporaryPath = `${stagedPath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, image.content, { flag: "wx" });
    await verifyStagedImage(temporaryPath, sha256, image);
    await link(temporaryPath, stagedPath).catch(async (error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
      await verifyStagedImage(stagedPath, sha256, image);
    });
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
  return { path: stagedPath, sha256 };
}

async function verifyStagedImage(filePath: string, expectedSha256: string, expectedImage: ParsedImage) {
  const content = await readFile(filePath);
  const actualSha256 = createHash("sha256").update(content).digest("hex");
  const dimensions = imageDimensions(content);
  if (
    actualSha256 !== expectedSha256 ||
    sniffImageMimeType(content) !== expectedImage.mimeType ||
    dimensions?.width !== expectedImage.width ||
    dimensions?.height !== expectedImage.height
  ) {
    throw new GeminiImageProviderError(
      "malformed-output",
      "GEMINI_STAGING_MISMATCH",
      "Gemini output staging did not preserve the validated response bytes."
    );
  }
}

async function parseResponse(response: Response): Promise<unknown> {
  try { return await response.json(); } catch { throw new GeminiImageProviderError("malformed-output", "GEMINI_RESPONSE_JSON", "Gemini returned a response that Ether could not validate."); }
}

async function safeBody(response: Response) {
  try { return (await response.text()).slice(0, 2_000); } catch { return ""; }
}

function classifyHttpFailure(status: number, body: string): GeminiImageProviderError {
  const lower = body.toLowerCase();
  const detail = googleErrorDetail(body);
  if (/safety|blocked|policy/i.test(lower)) return new GeminiImageProviderError("safety", "GEMINI_SAFETY", "Gemini blocked the request under its safety policy. No fallback was used.");
  if (status === 401 || status === 403) return new GeminiImageProviderError("authentication", "GEMINI_AUTH", "Gemini rejected the protected API key. Connect, replace, or remove it in Settings.");
  if (status === 429) return new GeminiImageProviderError("quota", "GEMINI_QUOTA", "Gemini quota is unavailable or exhausted. Ether did not switch providers.");
  if (status === 402 || /billing|prepay|spend|payment|credit/i.test(lower)) return new GeminiImageProviderError("billing", "GEMINI_BILLING", "Gemini billing or prepaid capacity prevented this request. Ether did not switch providers.");
  if (status >= 500) return new GeminiImageProviderError("server", "GEMINI_SERVER", "Gemini returned a server error. Ether did not retry an ambiguous paid request.");
  return new GeminiImageProviderError(
    "invalid-input",
    "GEMINI_REQUEST",
    detail === null
      ? "Gemini rejected the request. Check the selected model, size, aspect ratio, and references."
      : `Gemini rejected the request (${detail}). Check the selected model, size, aspect ratio, and references.`
  );
}

function googleErrorDetail(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as unknown;
    if (!isRecord(parsed) || !isRecord(parsed.error)) return null;
    const status = typeof parsed.error.status === "string" ? parsed.error.status : "";
    // Google status names are bounded machine codes. Remote prose can contain
    // account, project, request, or credential material and is never surfaced.
    return /^[A-Z][A-Z0-9_]{0,63}$/u.test(status) ? status : null;
  } catch {
    return null;
  }
}

function retryAfter(value: string | null) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return null;
  return Math.min(Math.max(0, timestamp - Date.now()), MAX_RETRY_AFTER_MS);
}

function waitForRetry(delayMs: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) { reject(cancellationError()); return; }
    const finish = () => {
      signal?.removeEventListener("abort", cancel);
      resolve();
    };
    const timer = setTimeout(finish, delayMs);
    const cancel = () => { clearTimeout(timer); reject(cancellationError()); };
    signal?.addEventListener("abort", cancel, { once: true });
  });
}

function boundedTimeout(value: number) { return Number.isFinite(value) && value > 0 ? Math.min(Math.floor(value), MAX_TIMEOUT_MS) : MAX_TIMEOUT_MS; }
function safeSegment(value: string) { return value.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80) || "attempt"; }
function uniqueImagePaths(filePaths: readonly string[]) {
  const seen = new Set<string>();
  return filePaths.filter((filePath) => {
    const key = path.resolve(filePath).toLocaleLowerCase("en-US");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function cancellationError() { return new GeminiImageProviderError("cancellation", "GEMINI_CANCELLED", "Gemini image generation was cancelled."); }
function credentialMessage(state: GeminiCredentialState) {
  if (state === "encryption-unavailable") return "Windows protected storage is unavailable, so Gemini API use is fail-closed.";
  if (state === "error") return "The protected Gemini credential needs replacement before Ether can use this provider.";
  return "Connect a Gemini API key in Settings to use the paid Gemini Developer API route.";
}
