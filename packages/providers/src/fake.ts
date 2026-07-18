import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";

import { removeInvalidPathCharacters } from "./pathSanitization.js";
import type {
  GenerationProvider,
  GenerationProviderInput,
  ImageEditProviderInput,
  ProviderDiagnostic,
  ProviderExecutionContext,
  ProviderGenerationResult
} from "./types.js";

export const FAKE_PROVIDER_ID = "ether-fake-local";

export interface FakeImageProviderOptions {
  delayMs?: number;
  failAttempts?: readonly number[];
}

export class FakeProviderError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, retryable: boolean) {
    super(message);
    this.name = "FakeProviderError";
    this.code = code;
    this.retryable = retryable;
  }
}

export class FakeImageProvider implements GenerationProvider {
  readonly descriptor = {
    id: FAKE_PROVIDER_ID,
    name: "Ether Fake Local",
    route: "local-fake" as const,
    capabilities: ["image.generate", "image.edit", "image.reference-input"] as const,
    model: "deterministic-png-v1",
    notes: ["Offline deterministic PNG provider for tests and local workflow validation."]
  };

  constructor(private readonly options: FakeImageProviderOptions = {}) {}

  diagnose(): ProviderDiagnostic {
    return {
      ...this.descriptor,
      capabilities: [...this.descriptor.capabilities],
      availability: "available",
      messages: ["Deterministic local fake provider is available."]
    };
  }

  async generate(
    input: GenerationProviderInput,
    context?: ProviderExecutionContext
  ): Promise<ProviderGenerationResult> {
    await this.beforeOutput(context);
    const width = input.output?.width ?? 1024;
    const height = input.output?.height ?? 1024;
    const content = deterministicPng(
      JSON.stringify({ input, providerAttemptId: context?.providerAttemptId ?? null }),
      width,
      height
    );
    return this.result(
      `fake-output-${sanitizeFileNamePart(input.generationNodeId)}-${input.iteration}.png`,
      content,
      { deterministic: true, width, height }
    );
  }

  async edit(
    input: ImageEditProviderInput,
    context?: ProviderExecutionContext
  ): Promise<ProviderGenerationResult> {
    await this.beforeOutput(context);
    const content = deterministicPng(
      JSON.stringify({ input, providerAttemptId: context?.providerAttemptId ?? null }),
      1024,
      1024
    );
    return this.result(
      `fake-edit-${sanitizeFileNamePart(input.editNodeId)}-${input.operation}-${input.iteration}.png`,
      content,
      {
        deterministic: true,
        operation: input.operation,
        editSubtype: input.editSubtype,
        localTool: fakeLocalToolForOperation(input.operation)
      }
    );
  }

  private async beforeOutput(context?: ProviderExecutionContext): Promise<void> {
    if (context?.signal.aborted === true) throw abortError();
    if ((this.options.failAttempts ?? []).includes(context?.attemptOrdinal ?? 1)) {
      throw new FakeProviderError(
        "FAKE_RETRYABLE_FAILURE",
        `Deterministic fake failure for attempt ${context?.attemptOrdinal ?? 1}.`,
        true
      );
    }
    if ((this.options.delayMs ?? 0) > 0) {
      await abortableDelay(this.options.delayMs!, context?.signal);
    }
  }

  private result(
    fileName: string,
    content: Uint8Array,
    metadata: Record<string, unknown>
  ): ProviderGenerationResult {
    return {
      providerId: this.descriptor.id,
      providerName: this.descriptor.name,
      capabilities: [...this.descriptor.capabilities],
      artifacts: [{ fileName, mimeType: "image/png", content, metadata }],
      metadata
    };
  }
}

function abortError(): Error {
  const error = new Error("Provider execution was cancelled.");
  error.name = "AbortError";
  return error;
}

function abortableDelay(delayMs: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, delayMs);
    const abort = (): void => {
      clearTimeout(timer);
      reject(abortError());
    };
    if (signal?.aborted === true) abort();
    else signal?.addEventListener("abort", abort, { once: true });
  });
}

function deterministicPng(seed: string, widthInput: number, heightInput: number): Uint8Array {
  const width = Math.max(1, Math.min(4096, Math.round(widthInput)));
  const height = Math.max(1, Math.min(4096, Math.round(heightInput)));
  const digest = createHash("sha256").update(seed).digest();
  const row = Buffer.alloc(1 + width * 4);
  row[0] = 0;
  for (let x = 0; x < width; x += 1) {
    const offset = 1 + x * 4;
    row[offset] = (digest[0]! + x) & 0xff;
    row[offset + 1] = (digest[1]! + x * 3) & 0xff;
    row[offset + 2] = digest[2]!;
    row[offset + 3] = 0xff;
  }
  const raw = Buffer.alloc(row.byteLength * height);
  for (let y = 0; y < height; y += 1) row.copy(raw, y * row.byteLength);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBytes = Buffer.from(type, "ascii");
  const chunk = Buffer.alloc(12 + data.byteLength);
  chunk.writeUInt32BE(data.byteLength, 0);
  typeBytes.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 8 + data.byteLength);
  return chunk;
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function fakeLocalToolForOperation(operation: ImageEditProviderInput["operation"]) {
  return {
    kind: operation === "upscale" ? "fake-deterministic-upscale" : "fake-deterministic-edit",
    route: "local-fake"
  };
}

function sanitizeFileNamePart(value: string): string {
  const safe = removeInvalidPathCharacters(value.trim())
    .replace(/\s+/g, "-")
    .replace(/[. ]+$/g, "");
  return safe || "generation";
}
