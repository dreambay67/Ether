import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  CODEX_APP_SERVER_MANIFEST_SHA256,
  CODEX_APP_SERVER_VERSION,
  CodexAppServerRuntime,
  createCodexAppServerProviderBundle,
  resolveCodexCliPath,
  type AssistantProviderInput,
  type GenerationProviderInput,
  type ProviderExecutionContext,
  type VisionEvaluationProviderInput
} from "@ether/providers";

const liveTimeoutMs = 15 * 60 * 1000;
const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=",
  "base64"
);

describe("Codex App Server authenticated conformance", () => {
  it("discovers models and runs text, vision evaluation, and image generation", async () => {
    const executablePath = resolveCodexCliPath();
    if (!executablePath) throw new Error("Codex live conformance blocker: CODEX_CLI_PATH is not configured.");
    const evidenceRoot = path.join(
      process.env.APPDATA ?? process.env.LOCALAPPDATA ?? process.cwd(),
      "Ether",
      "4.0",
      "conformance"
    );
    const runRoot = path.join(evidenceRoot, `codex-${Date.now()}-${randomUUID()}`);
    const evidencePath = path.join(runRoot, "evidence.json");
    await mkdir(runRoot, { recursive: true });
    const inputImagePath = path.join(runRoot, "vision-input.png");
    await writeFile(inputImagePath, tinyPng);
    const runtime = new CodexAppServerRuntime({
      executablePath,
      cwd: runRoot,
      initializationTimeoutMs: 20_000,
      restartBudget: 1
    });
    const bundle = createCodexAppServerProviderBundle({ runtime });
    const evidence: Record<string, unknown> = {
      schemaVersion: 1,
      cliVersion: CODEX_APP_SERVER_VERSION,
      transport: "app-server",
      manifestHash: CODEX_APP_SERVER_MANIFEST_SHA256,
      startedAt: new Date().toISOString(),
      result: "running"
    };
    try {
      const runtimeStart = Date.now();
      await runtime.start();
      expect(runtime.health().transport).toBe("app-server");
      const models = await runtime.getClient().listModels({ includeHidden: false });
      const defaultModel = models.find((model) => model.isDefault) ?? models[0];
      if (!defaultModel) throw new Error("Codex App Server returned no visible models.");
      evidence.discovery = {
        modelCount: models.length,
        defaultModelHash: sha256(defaultModel.id),
        defaultReasoningEffort: defaultModel.defaultReasoningEffort,
        supportedReasoningEfforts: defaultModel.supportedReasoningEfforts.map((entry) => entry.reasoningEffort),
        initializationMs: runtime.health().initializationMs,
        discoveryMs: Date.now() - runtimeStart
      };

      const controller = new AbortController();
      const context = <T>(): ProviderExecutionContext<T> => ({
        signal: controller.signal,
        providerAttemptId: randomUUID(),
        attemptOrdinal: 1,
        stagingDirectory: runRoot,
        complete: async () => undefined
      });
      const assistantInput: AssistantProviderInput = {
        projectPath: runRoot,
        runId: randomUUID(),
        assistantNodeId: "live-text-worker",
        assistantSubtype: "Worker",
        prompt: "Respond with one short sentence confirming the text worker is operational.",
        instruction: "Do not use tools.",
        notes: "",
        sections: [],
        references: [],
        edgeRoles: [],
        requestedAt: new Date().toISOString()
      };
      const textStarted = Date.now();
      const text = await bundle.assistant.run(assistantInput, context());
      expect(text.text.trim().length).toBeGreaterThan(0);
      expect(text.metadata).toMatchObject({ transport: "app-server" });
      evidence.textWorker = {
        result: "pass",
        outputHash: sha256(text.text),
        outputBytes: Buffer.byteLength(text.text),
        elapsedMs: Date.now() - textStarted,
        timing: redactedTiming(text.metadata?.timing)
      };

      const evaluationInput: VisionEvaluationProviderInput = {
        projectPath: runRoot,
        runId: randomUUID(),
        evaluationNodeId: "live-vision-evaluation",
        instruction: "Evaluate whether the image is a valid visible raster image.",
        criteria: "Return one item for the supplied image with a concise factual explanation.",
        threshold: 50,
        images: [{ id: "image-1", nodeId: "source", title: "Input", assetPath: inputImagePath }],
        requestedAt: new Date().toISOString()
      };
      const visionStarted = Date.now();
      const vision = await bundle.evaluation.evaluate(evaluationInput, context());
      expect(vision.items).toHaveLength(1);
      expect(vision.metadata).toMatchObject({ transport: "app-server" });
      evidence.visionEvaluation = {
        result: "pass",
        itemCount: vision.items.length,
        outputHash: sha256(JSON.stringify(vision.items)),
        elapsedMs: Date.now() - visionStarted,
        timing: redactedTiming(vision.metadata?.timing)
      };

      const generationInput: GenerationProviderInput = {
        projectPath: runRoot,
        runId: randomUUID(),
        generationNodeId: "live-image-generation",
        iteration: 1,
        prompt: "A simple centered red circle on a plain white background, clean flat graphic.",
        negativePrompt: "text, watermark, clutter",
        sections: [],
        references: [],
        edgeRoles: [],
        outputCount: 1,
        output: { aspectRatio: "1:1", resolution: "1024", width: 1024, height: 1024 },
        requestedAt: new Date().toISOString()
      };
      const imageStarted = Date.now();
      const generated = await bundle.generation.generate(generationInput, context());
      expect(generated.artifacts).toHaveLength(1);
      expect(generated.metadata).toMatchObject({ transport: "app-server" });
      const output = await readFile(generated.artifacts[0]!.sourcePath!);
      evidence.imageGeneration = {
        result: "pass",
        outputHash: sha256(output),
        outputBytes: output.byteLength,
        dimensions: pngDimensions(output),
        elapsedMs: Date.now() - imageStarted,
        timing: redactedTiming(generated.metadata?.timing)
      };
      evidence.result = "pass";
      evidence.completedAt = new Date().toISOString();
      await writeEvidence(evidencePath, evidence);
    } catch (error) {
      evidence.result = "fail";
      evidence.blocker = sanitizeBlocker(error);
      evidence.completedAt = new Date().toISOString();
      await writeEvidence(evidencePath, evidence);
      throw new Error(`Codex live conformance failed: ${sanitizeBlocker(error)} Evidence: ${evidencePath}`, {
        cause: error
      });
    } finally {
      await bundle.close();
    }
  }, liveTimeoutMs);
});

function sha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function pngDimensions(content: Buffer) {
  if (content.length < 24 || content.toString("hex", 0, 8) !== "89504e470d0a1a0a") {
    throw new Error("Generated image output is not a PNG.");
  }
  return { width: content.readUInt32BE(16), height: content.readUInt32BE(20) };
}

function redactedTiming(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const timing = value as Record<string, unknown>;
  return Object.fromEntries(Object.entries(timing).filter(([, entry]) => typeof entry === "number"));
}

function sanitizeBlocker(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/[A-Za-z]:\\[^\r\n"']+/g, "<redacted-path>")
    .replace(/(?:sk-|sess-)[A-Za-z0-9_-]+/gi, "<redacted-secret>")
    .slice(0, 2_000);
}

async function writeEvidence(evidencePath: string, evidence: Record<string, unknown>) {
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}
