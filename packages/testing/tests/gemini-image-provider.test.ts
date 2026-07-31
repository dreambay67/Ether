import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  GEMINI_IMAGE_PROVIDER_IDS,
  GeminiImageProvider,
  GeminiImageProviderError,
  resolveGoogleImageProviderAlias,
  type GenerationProviderInput,
  type ImageEditProviderInput
} from "@ether/providers";

const roots: string[] = [];
async function root() {
  const value = await mkdtemp(path.join(os.tmpdir(), "ether-gemini-provider-"));
  roots.push(value);
  return value;
}
afterEach(async () => { await Promise.all(roots.splice(0).map((value) => rm(value, { recursive: true, force: true }))); });

function jpeg(width = 1024, height = 1024) {
  const value = Buffer.alloc(23);
  Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08]).copy(value);
  value.writeUInt16BE(height, 7);
  value.writeUInt16BE(width, 9);
  value[11] = 3;
  value[21] = 0xff;
  value[22] = 0xd9;
  return value;
}
function response(body: unknown, init: ResponseInit = {}) { return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" }, ...init }); }
function input(workspacePath: string, width = 1024, height = 1024): GenerationProviderInput {
  return {
    workspacePath, runId: "run-1", generationNodeId: "image-1", iteration: 1,
    prompt: "a studio bottle", negativePrompt: "blur", sections: [], references: [], edgeRoles: [], outputCount: 1,
    output: { aspectRatio: "1:1", resolution: "1024x1024", width, height, outputFormat: "image/jpeg" },
    requestedAt: "2026-07-30T12:00:00.000Z"
  };
}

function editInput(
  workspacePath: string,
  sourcePath: string,
  outputCount = 1
): ImageEditProviderInput {
  return {
    workspacePath,
    runId: "run-edit",
    editNodeId: "edit-1",
    editSubtype: "freeform",
    operation: "draw-note",
    iteration: 1,
    prompt: "make the circle green",
    negativePrompt: "",
    instruction: "make the circle green",
    notes: "",
    sections: [],
    references: [],
    edgeRoles: [],
    outputCount,
    sourceImage: { assetPath: sourcePath },
    mask: null,
    requestedAt: "2026-07-30T12:00:00.000Z"
  };
}

describe("Gemini Developer API image provider", () => {
  it("migrates only logical Google aliases while preserving explicit Antigravity document bindings", () => {
    expect(resolveGoogleImageProviderAlias("google-nano-banana")).toMatchObject({
      providerId: GEMINI_IMAGE_PROVIDER_IDS["nano-banana-2"], route: "gemini-api", migratedLogicalAlias: true
    });
    expect(resolveGoogleImageProviderAlias("google-nano-banana-pro", "nano-banana-pro")).toEqual({
      providerId: "google-nano-banana-pro", route: "antigravity-fallback", migratedLogicalAlias: false
    });
  });

  it("uses the documented Interactions payload, disables retention/grounding, and stages a validated result", async () => {
    const workspacePath = await root();
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const provider = new GeminiImageProvider("nano-banana-2", {
      getApiKey: () => "local-test-key",
      credentialState: () => "verified",
      fetch: async (url, init) => {
        requests.push({ url: String(url), init });
        return response({
          steps: [{
            type: "model_output",
            content: [{ type: "image", mime_type: "image/jpeg", data: jpeg().toString("base64") }]
          }]
        });
      }
    });

    const result = await provider.generate(input(workspacePath));
    const request = requests[0]!;
    const payload = JSON.parse(String(request.init?.body)) as Record<string, unknown>;
    expect(request.url).toBe("https://generativelanguage.googleapis.com/v1beta/interactions");
    expect(payload).toMatchObject({ model: "gemini-3.1-flash-image", store: false, response_format: { type: "image", mime_type: "image/jpeg", aspect_ratio: "1:1", image_size: "1K" } });
    expect(payload).not.toHaveProperty("tools");
    expect(String((request.init?.headers as Record<string, string>)["x-goog-api-key"])).toBe("local-test-key");
    expect(result.providerId).toBe(GEMINI_IMAGE_PROVIDER_IDS["nano-banana-2"]);
    expect(result.artifacts[0]).toMatchObject({ mimeType: "image/jpeg", metadata: { dimensions: { width: 1024, height: 1024 }, provenance: { synthId: "included-by-google", searchGrounding: false } } });
    await expect(readFile(result.artifacts[0]!.sourcePath!)).resolves.toHaveLength(23);
    await expect(provider.generate({
      ...input(workspacePath),
      output: { ...input(workspacePath).output!, outputFormat: "image/png" }
    })).rejects.toMatchObject({
      code: "GEMINI_OUTPUT_FORMAT_UNSUPPORTED",
      failureCategory: "invalid-input"
    });

    const jpegPayloads: Record<string, unknown>[] = [];
    const jpegProvider = new GeminiImageProvider("nano-banana-2", {
      getApiKey: () => "local-test-key",
      credentialState: () => "verified",
      fetch: async (_url, init) => {
        jpegPayloads.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return response({
          steps: [{
            type: "model_output",
            content: [{ type: "image", mime_type: "image/jpeg", data: jpeg().toString("base64") }]
          }]
        });
      }
    });
    const jpegInput = input(workspacePath);
    jpegInput.output = { ...jpegInput.output!, outputFormat: "image/jpeg" };
    await expect(jpegProvider.generate(jpegInput)).resolves.toMatchObject({
      artifacts: [expect.objectContaining({ mimeType: "image/jpeg" })]
    });
    expect(jpegPayloads[0]?.response_format).toMatchObject({ mime_type: "image/jpeg" });
  });

  it("exposes structural model/ratio/size matrices and rejects fake dimensions", async () => {
    const provider = new GeminiImageProvider("nano-banana-2", { getApiKey: () => null, credentialState: () => "not-configured" });
    const profiles = provider.diagnose().profiles ?? [];
    const profile = profiles.find((item) => item.operation === "image.generate");
    const editProfile = profiles.find((item) => item.operation === "image.edit");
    expect(profile).toMatchObject({
      model: "gemini-3.1-flash-image",
      aspectRatios: expect.arrayContaining(["1:8", "8:1", "16:9"]),
      outputFormats: ["image/jpeg"],
      mediaLimits: { mimeTypes: ["image/png", "image/jpeg"] },
      maxParallelism: 4
    });
    expect(profile?.resolutions).toEqual(expect.arrayContaining([
      expect.objectContaining({ tier: "0.5K", aspectRatio: "1:1", width: 512, height: 512 }),
      expect.objectContaining({ tier: "4K", aspectRatio: "16:9", width: 5504, height: 3072 })
    ]));
    expect(profile?.inputChannels).toEqual(["text", "image"]);
    expect(editProfile?.inputChannels).toEqual(["text", "image", "mask"]);
    await expect(provider.generate(input(await root(), 1000, 1000))).rejects.toMatchObject({ code: "GEMINI_OUTPUT_UNSUPPORTED", category: "provider", failureCategory: "invalid-input" });
  });

  it("keeps paid failure modes distinct, retries only explicit 429 responses, and never substitutes a provider", async () => {
    const workspacePath = await root();
    let calls = 0;
    const provider = new GeminiImageProvider("nano-banana-2", {
      getApiKey: () => "local-test-key",
      credentialState: () => "verified",
      fetch: async () => {
        calls += 1;
        return calls === 1
          ? response({ error: { message: "quota exhausted" } }, { status: 429, headers: { "retry-after": "0" } })
          : response({ output_image: { data: jpeg().toString("base64") } });
      }
    });
    await expect(provider.generate(input(workspacePath))).resolves.toMatchObject({ providerId: GEMINI_IMAGE_PROVIDER_IDS["nano-banana-2"] });
    expect(calls).toBe(2);

    const server = new GeminiImageProvider("nano-banana-2", {
      getApiKey: () => "local-test-key", credentialState: () => "verified",
      fetch: async () => response({ error: { message: "temporary server condition" } }, { status: 503 })
    });
    await expect(server.generate(input(workspacePath))).rejects.toMatchObject({ code: "GEMINI_SERVER", category: "provider", failureCategory: "server", retryable: false });

    const invalid = new GeminiImageProvider("nano-banana-2", {
      getApiKey: () => "local-test-key", credentialState: () => "verified",
      fetch: async () => response({
        error: {
          status: "INVALID_ARGUMENT",
          message: "Unknown field output_size for project 123456789012 and api_key=should-not-escape"
        }
      }, { status: 400 })
    });
    await expect(invalid.generate(input(workspacePath))).rejects.toMatchObject({
      code: "GEMINI_REQUEST",
      message: expect.stringContaining("INVALID_ARGUMENT")
    });
    await expect(invalid.generate(input(workspacePath))).rejects.not.toHaveProperty(
      "message",
      expect.stringMatching(/output_size|project|api_key|should-not-escape/u)
    );
  });

  it("keeps response streaming and the single quota retry inside one deadline", async () => {
    const workspacePath = await root();
    const delayedBody = () => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        setTimeout(() => {
          controller.enqueue(new TextEncoder().encode("{}"));
          controller.close();
        }, 80);
      }
    }));
    const stalled = new GeminiImageProvider("nano-banana-2", {
      getApiKey: () => "local-test-key",
      credentialState: () => "verified",
      timeoutMs: 25,
      fetch: async () => delayedBody()
    });
    await expect(stalled.generate(input(workspacePath))).rejects.toMatchObject({
      code: "GEMINI_TIMEOUT",
      failureCategory: "timeout"
    });

    let calls = 0;
    const retry = new GeminiImageProvider("nano-banana-2", {
      getApiKey: () => "local-test-key",
      credentialState: () => "verified",
      timeoutMs: 35,
      fetch: async () => {
        calls += 1;
        if (calls === 1) return response({ error: { message: "quota" } }, { status: 429, headers: { "retry-after": "0.02" } });
        await new Promise((resolve) => setTimeout(resolve, 30));
        return response({ steps: [{ type: "model_output", content: [{ type: "image", mime_type: "image/jpeg", data: jpeg().toString("base64") }] }] });
      }
    });
    await expect(retry.generate(input(workspacePath))).rejects.toMatchObject({
      code: "GEMINI_TIMEOUT",
      failureCategory: "timeout"
    });
    expect(calls).toBe(2);
  });

  it("cancels a response whose body has not completed", async () => {
    const workspacePath = await root();
    const controller = new AbortController();
    const provider = new GeminiImageProvider("nano-banana-2", {
      getApiKey: () => "local-test-key",
      credentialState: () => "verified",
      timeoutMs: 500,
      fetch: async () => new Response(new ReadableStream<Uint8Array>({
        start(streamController) {
          setTimeout(() => {
            streamController.enqueue(new TextEncoder().encode("{}"));
            streamController.close();
          }, 80);
        }
      }))
    });
    const pending = provider.generate(input(workspacePath), {
      signal: controller.signal,
      providerAttemptId: "cancel-body",
      attemptOrdinal: 1,
      stagingDirectory: workspacePath,
      complete: async () => undefined
    });
    setTimeout(() => controller.abort(), 15);
    await expect(pending).rejects.toMatchObject({ code: "GEMINI_CANCELLED", failureCategory: "cancellation" });
  });

  it("fails closed on cancellation and malformed paid output", async () => {
    const workspacePath = await root();
    const malformed = new GeminiImageProvider("nano-banana-pro", {
      getApiKey: () => "local-test-key", credentialState: () => "verified",
      fetch: async () => response({ output_image: { data: Buffer.from("not an image").toString("base64") } })
    });
    await expect(malformed.generate(input(workspacePath))).rejects.toMatchObject({ code: "GEMINI_OUTPUT_MIME", failureCategory: "malformed-output" });
    const controller = new AbortController(); controller.abort();
    await expect(malformed.generate(input(workspacePath), { signal: controller.signal, providerAttemptId: "x", attemptOrdinal: 1, stagingDirectory: workspacePath, complete: async () => undefined })).rejects.toBeInstanceOf(GeminiImageProviderError);
  });

  it("rejects unsupported edit counts before dispatch and de-duplicates the primary source", async () => {
    const workspacePath = await root();
    const sourcePath = path.join(workspacePath, "source.jpg");
    await writeFile(sourcePath, jpeg());
    let calls = 0;
    const payloads: Record<string, unknown>[] = [];
    const provider = new GeminiImageProvider("nano-banana-pro", {
      getApiKey: () => "local-test-key",
      credentialState: () => "verified",
      fetch: async (_url, init) => {
        calls += 1;
        payloads.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return response({ output_image: { data: jpeg().toString("base64") } });
      }
    });
    await expect(provider.edit(editInput(workspacePath, sourcePath, 2))).rejects.toMatchObject({
      code: "PROVIDER_OUTPUT_COUNT_UNSUPPORTED"
    });
    expect(calls).toBe(0);
    const deduplicated = editInput(workspacePath, sourcePath);
    deduplicated.references = [{
      nodeId: "same-source",
      role: "general",
      title: "same source",
      sourceKind: "image",
      assetPath: sourcePath
    }];
    await expect(provider.edit(deduplicated)).resolves.toMatchObject({
      artifacts: [expect.objectContaining({ mimeType: "image/jpeg" })]
    });
    expect(calls).toBe(1);
    const blocks = payloads[0]!.input as Array<Record<string, unknown>>;
    expect(blocks.filter((block) => block.type === "image")).toHaveLength(1);
  });

  it("fails closed when an existing staged path does not match the validated response", async () => {
    const workspacePath = await root();
    const generated = jpeg();
    const sha256 = createHash("sha256").update(generated).digest("hex");
    const directory = path.join(workspacePath, "gemini-api", "attempt-collision");
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, `${sha256}.jpg`), Buffer.from("corrupt"));
    const provider = new GeminiImageProvider("nano-banana-2", {
      getApiKey: () => "local-test-key",
      credentialState: () => "verified",
      fetch: async () => response({ output_image: { data: generated.toString("base64") } })
    });
    await expect(provider.generate(input(workspacePath), {
      signal: new AbortController().signal,
      providerAttemptId: "collision",
      attemptOrdinal: 1,
      stagingDirectory: workspacePath,
      complete: async () => undefined
    })).rejects.toMatchObject({
      code: "GEMINI_STAGING_MISMATCH",
      failureCategory: "malformed-output"
    });
  });
});
