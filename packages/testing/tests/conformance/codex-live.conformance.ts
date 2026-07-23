import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  CODEX_APP_SERVER_VERSION,
  CodexAppServerRuntime,
  createCodexAppServerProviderBundle,
  resolveCodexCliPath,
  type AssistantProviderInput,
  type GenerationProviderInput,
  type ProviderExecutionContext,
  type ProviderGenerationResult,
  type VisionEvaluationProviderInput
} from "@ether/providers";

const liveTimeoutMs = 15 * 60 * 1000;
const nominalImageDimensions = { width: 1024, height: 1024 };
const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=",
  "base64"
);

type ImageImportEvidence = {
  completionCalled: true;
  stagedCopyDistinct: true;
  importedCopyDistinct: true;
  stagedPreservedAfterImport: true;
  stagedHash: string;
  importedHash: string;
  bytes: number;
};

describe("Codex App Server authenticated conformance", () => {
  it("proves discovery, text, vision, cancellation, and provider-determined reference image output", async () => {
    const executablePath = resolveCodexCliPath();
    if (!executablePath) throw new Error("Codex live conformance blocker: CODEX_CLI_PATH is not configured.");
    const appData = process.env.LOCALAPPDATA ?? process.env.APPDATA;
    if (!appData) throw new Error("Codex live conformance blocker: Windows AppData is unavailable.");
    const evidenceRoot = path.join(appData, "Ether", "4.0", "conformance");
    const runRoot = path.join(evidenceRoot, `codex-${Date.now()}-${randomUUID()}`);
    const sourceDirectory = path.join(runRoot, "source");
    const stagingDirectory = path.join(runRoot, "staging");
    const importDirectory = path.join(runRoot, "imported");
    const evidencePath = path.join(runRoot, "evidence.json");
    await Promise.all([
      mkdir(sourceDirectory, { recursive: true }),
      mkdir(stagingDirectory, { recursive: true }),
      mkdir(importDirectory, { recursive: true })
    ]);
    const inputImagePath = path.join(sourceDirectory, "reference.png");
    await writeFile(inputImagePath, tinyPng);
    const runtime = new CodexAppServerRuntime({
      executablePath,
      cwd: runRoot,
      initializationTimeoutMs: 20_000,
      restartBudget: 1,
      clientOptions: {
        requestTimeoutMs: 30_000,
        turnTimeoutMs: 5 * 60 * 1000
      }
    });
    const bundle = createCodexAppServerProviderBundle({ runtime });
    const evidence: Record<string, unknown> = {
      schemaVersion: 2,
      pinnedVersion: CODEX_APP_SERVER_VERSION,
      startedAt: new Date().toISOString(),
      result: "running"
    };
    try {
      const runtimeStart = Date.now();
      await runtime.start();
      const health = runtime.health();
      expect(health).toMatchObject({
        transport: "app-server",
        reportedVersion: CODEX_APP_SERVER_VERSION,
        versionCompatible: true,
        imageCapability: "available",
        imageCapabilityProfile: {
          dimensionMode: "provider-determined",
          exactResolution: false,
          verifiedAspectRatios: ["1:1"]
        }
      });
      if (!health.reportedVersion || !health.imageCapabilityManifestHash || !health.imageCapabilityProfile) {
        throw new Error("Codex runtime did not report a compatible version and verified image capability manifest.");
      }
      const defaultModel = health.models.find((model) => model.isDefault) ?? health.models[0];
      if (!defaultModel) throw new Error("Codex App Server returned no visible models.");
      const selectedReasoningEffort = defaultModel.reasoningEfforts.includes(defaultModel.defaultReasoningEffort)
        ? defaultModel.defaultReasoningEffort
        : defaultModel.reasoningEfforts[0];
      if (!selectedReasoningEffort) throw new Error("Codex App Server returned no reasoning effort for its default model.");

      evidence.runtime = {
        transport: health.transport,
        reportedVersion: health.reportedVersion,
        protocolManifestHash: health.manifestHash,
        generation: health.generation,
        initializationMs: health.initializationMs
      };
      evidence.discovery = {
        visibleModelCount: health.models.length,
        visibleModelHashes: health.models.map((model) => sha256(model.id)),
        defaultModelHash: sha256(defaultModel.id),
        defaultReasoningEffort: defaultModel.defaultReasoningEffort,
        selectedReasoningEffort,
        supportedReasoningEfforts: defaultModel.reasoningEfforts,
        elapsedMs: Date.now() - runtimeStart
      };
      evidence.imageCapability = {
        manifestHash: health.imageCapabilityManifestHash,
        outputDiscovery: health.imageCapabilityProfile.outputDiscovery,
        referenceInputs: health.imageCapabilityProfile.referenceInputs,
        dimensionMode: health.imageCapabilityProfile.dimensionMode,
        exactResolution: health.imageCapabilityProfile.exactResolution,
        verifiedAspectRatios: health.imageCapabilityProfile.verifiedAspectRatios,
        aspectRatioTolerance: health.imageCapabilityProfile.aspectRatioTolerance,
        decision: "provider-determined-pixels-with-verified-square-aspect"
      };

      const baseInput = {
        workspacePath: runRoot,
        model: defaultModel.id,
        reasoningEffort: selectedReasoningEffort,
        requestedAt: new Date().toISOString()
      };
      const assistantInput: AssistantProviderInput = {
        ...baseInput,
        runId: randomUUID(),
        assistantNodeId: "live-text-worker",
        assistantSubtype: "Worker",
        prompt: "Respond with one short sentence confirming the text worker is operational.",
        instruction: "Do not use tools.",
        notes: "",
        sections: [],
        references: [],
        edgeRoles: []
      };
      const textStarted = Date.now();
      const text = await bundle.assistant.run(assistantInput, executionContext(new AbortController().signal, stagingDirectory));
      expect(text.text.trim().length).toBeGreaterThan(0);
      expect(text.metadata).toMatchObject({ transport: "app-server", reportedVersion: health.reportedVersion });
      evidence.textWorker = {
        result: "pass",
        outputHash: sha256(text.text),
        outputBytes: Buffer.byteLength(text.text),
        elapsedMs: Date.now() - textStarted,
        timing: redactedTiming(text.metadata?.timing)
      };

      const evaluationInput: VisionEvaluationProviderInput = {
        ...baseInput,
        runId: randomUUID(),
        evaluationNodeId: "live-vision-evaluation",
        instruction: "Evaluate whether the supplied image is a valid visible raster image.",
        criteria: "Return one item for the supplied image with a concise factual explanation.",
        threshold: 50,
        images: [{ id: "image-1", nodeId: "source", title: "Input", assetPath: inputImagePath }]
      };
      const visionStarted = Date.now();
      const vision = await bundle.evaluation.evaluate(
        evaluationInput,
        executionContext(new AbortController().signal, stagingDirectory)
      );
      expect(vision.items).toHaveLength(1);
      expect(vision.metadata).toMatchObject({ transport: "app-server", reportedVersion: health.reportedVersion });
      evidence.visionEvaluation = {
        result: "pass",
        inputHash: sha256(tinyPng),
        itemCount: vision.items.length,
        outputHash: sha256(JSON.stringify(vision.items)),
        elapsedMs: Date.now() - visionStarted,
        timing: redactedTiming(vision.metadata?.timing)
      };

      const cancellationController = new AbortController();
      let cancellationStarted = false;
      let cancellationCompletedStatus: string | null = null;
      let abortScheduled = false;
      const unsubscribe = runtime.getClient().subscribe((event) => {
        if (event.method === "turn/started" && !abortScheduled) {
          cancellationStarted = true;
          abortScheduled = true;
          setTimeout(() => cancellationController.abort(), 50);
        }
        if (event.method === "turn/completed") cancellationCompletedStatus = turnStatus(event.params.turn);
      });
      const cancellationStartedAt = Date.now();
      let cancellationError: unknown;
      try {
        await bundle.assistant.run({
          ...assistantInput,
          runId: randomUUID(),
          assistantNodeId: "live-cancellation",
          prompt: "Perform a long-running analysis before replying so the caller can cancel this turn.",
          instruction: "Begin the requested work and do not answer immediately.",
          timeoutMs: 60_000
        }, executionContext(cancellationController.signal, stagingDirectory));
      } catch (error) {
        cancellationError = error;
      } finally {
        unsubscribe();
      }
      expect(cancellationStarted).toBe(true);
      expect(cancellationError).toMatchObject({
        name: "AbortError",
        code: "CODEX_APP_SERVER_CANCELLED",
        category: "cancellation",
        completedStatus: "interrupted"
      });
      expect(cancellationCompletedStatus).toBe("interrupted");
      evidence.cancellation = {
        result: "pass",
        dispatched: cancellationStarted,
        interruptAcknowledged: cancellationCompletedStatus === "interrupted",
        completedStatus: cancellationCompletedStatus,
        category: errorField(cancellationError, "category"),
        code: errorField(cancellationError, "code"),
        elapsedMs: Date.now() - cancellationStartedAt
      };

      let importEvidence: ImageImportEvidence | null = null;
      const generationInput: GenerationProviderInput = {
        ...baseInput,
        runId: randomUUID(),
        generationNodeId: "live-image-reference-generation",
        iteration: 1,
        prompt: "Create a clean square graphic inspired by the supplied reference image.",
        negativePrompt: "text, watermark, clutter",
        sections: [],
        references: [{
          nodeId: "reference-source",
          role: "reference",
          title: "Reference image",
          sourceKind: "asset",
          assetPath: inputImagePath
        }],
        edgeRoles: [],
        outputCount: 1,
        output: {
          aspectRatio: "1:1",
          resolution: "provider-determined",
          ...nominalImageDimensions
        }
      };
      const imageStarted = Date.now();
      const generated = await bundle.generation.generate(
        generationInput,
        executionContext(new AbortController().signal, stagingDirectory, async (result) => {
          const stagedPath = requiredArtifactPath(result);
          requirePathWithin(stagingDirectory, stagedPath);
          const stagedBeforeImport = await readFile(stagedPath);
          const importedPath = path.join(importDirectory, `codex-import-${randomUUID()}.png`);
          await copyFile(stagedPath, importedPath, constants.COPYFILE_EXCL);
          const [stagedAfterImport, imported] = await Promise.all([readFile(stagedPath), readFile(importedPath)]);
          expect(importedPath).not.toBe(stagedPath);
          expect(sha256(stagedAfterImport)).toBe(sha256(stagedBeforeImport));
          expect(sha256(imported)).toBe(sha256(stagedBeforeImport));
          importEvidence = {
            completionCalled: true,
            stagedCopyDistinct: true,
            importedCopyDistinct: true,
            stagedPreservedAfterImport: true,
            stagedHash: sha256(stagedBeforeImport),
            importedHash: sha256(imported),
            bytes: imported.byteLength
          };
        })
      );
      expect(generated.artifacts).toHaveLength(1);
      expect(generated.metadata).toMatchObject({
        transport: "app-server",
        reportedVersion: health.reportedVersion,
        imageCapability: {
          dimensionMode: "provider-determined",
          exactResolution: false,
          verifiedAspectRatios: ["1:1"]
        }
      });
      expect(importEvidence).not.toBeNull();
      const artifact = generated.artifacts[0]!;
      const outputPath = requiredArtifactPath(generated);
      requirePathWithin(stagingDirectory, outputPath);
      const output = await readFile(outputPath);
      const dimensions = pngDimensions(output);
      const actualAspect = dimensions.width / dimensions.height;
      expect(Math.abs(actualAspect - 1)).toBeLessThanOrEqual(health.imageCapabilityProfile.aspectRatioTolerance);
      expect(artifact.metadata).toMatchObject({
        outputDiscovery: "imageGeneration.savedPath",
        originalPreserved: true,
        originalOutputHash: sha256(output),
        stagedOutputHash: sha256(output),
        dimensionMode: "provider-determined",
        exactResolution: false,
        actualDimensions: dimensions
      });
      evidence.imageGeneration = {
        result: "pass",
        referenceInput: true,
        referenceInputHash: sha256(tinyPng),
        outputDiscovery: artifact.metadata?.outputDiscovery,
        originalPreserved: artifact.metadata?.originalPreserved,
        originalOutputHash: artifact.metadata?.originalOutputHash,
        outputHash: sha256(output),
        outputBytes: output.byteLength,
        dimensions,
        requestedAspectRatio: "1:1",
        actualAspectRatio: `${dimensions.width}:${dimensions.height}`,
        aspectVerified: Math.abs(actualAspect - 1) <= health.imageCapabilityProfile.aspectRatioTolerance,
        dimensionMode: "provider-determined",
        exactResolution: false,
        nominalInputDimensions: nominalImageDimensions,
        exactNominalDimensionMatch: dimensions.width === nominalImageDimensions.width
          && dimensions.height === nominalImageDimensions.height,
        stagingAndImport: importEvidence,
        elapsedMs: Date.now() - imageStarted,
        timing: redactedTiming(generated.metadata?.timing)
      };
      evidence.result = "pass";
      evidence.completedAt = new Date().toISOString();
      await writeEvidence(evidencePath, evidence);
      process.stdout.write(`Codex conformance evidence: ${evidencePath}\n`);
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

function executionContext<T>(
  signal: AbortSignal,
  stagingDirectory: string,
  complete: (result: T) => Promise<void> = async () => undefined
): ProviderExecutionContext<T> {
  return {
    signal,
    providerAttemptId: randomUUID(),
    attemptOrdinal: 1,
    stagingDirectory,
    complete
  };
}

function requiredArtifactPath(result: ProviderGenerationResult) {
  const sourcePath = result.artifacts[0]?.sourcePath;
  if (!sourcePath) throw new Error("Codex image result did not contain a staged artifact path.");
  return sourcePath;
}

function requirePathWithin(parent: string, candidate: string) {
  const relative = path.relative(parent, candidate);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Codex image artifact was not a distinct file inside the requested staging directory.");
  }
}

function turnStatus(value: unknown) {
  if (!value || typeof value !== "object" || !("status" in value)) return null;
  return typeof value.status === "string" ? value.status : null;
}

function errorField(error: unknown, field: string) {
  if (!error || typeof error !== "object" || !(field in error)) return null;
  const value = (error as Record<string, unknown>)[field];
  return typeof value === "string" ? value : null;
}

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
