import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  AntigravityImageProvider,
  discoverAntigravityCli,
  redactSensitiveText,
  writeAntigravityConformance,
  type GenerationProviderInput,
  type ProviderExecutionContext
} from "@ether/providers";

const liveEnabled = process.env.ETHER_ANTIGRAVITY_LIVE === "1" && process.env.ETHER_ANTIGRAVITY_CREDIT_OVERAGES_NEVER === "1";
const liveTimeoutMs = 7 * 60 * 1_000;

describe.runIf(liveEnabled)("Antigravity live conformance", () => {
  it("generates and imports one real Nano Banana 2 image through the official CLI", async () => {
    const cli = await discoverAntigravityCli({ authProbe: true });
    if (!cli.executablePath || !cli.version || !cli.authenticated) {
      throw new Error(`Antigravity live conformance blocker: ${cli.message ?? "official CLI authentication is unavailable"}.`);
    }
    const appData = process.env.LOCALAPPDATA;
    if (!appData) throw new Error("Antigravity live conformance blocker: LOCALAPPDATA is unavailable.");
    const evidenceRoot = path.join(appData, "Ether", "4.0", "conformance");
    const runRoot = path.join(evidenceRoot, `antigravity-run-${Date.now()}-${randomUUID()}`);
    const stagingDirectory = path.join(runRoot, "staging");
    await mkdir(stagingDirectory, { recursive: true });
    const cliHash = sha256(await readFile(cli.executablePath));
    const provider = new AntigravityImageProvider("nano-banana-2", {
      executablePath: cli.executablePath,
      brainRoot: path.join(process.env.USERPROFILE ?? os.homedir(), ".gemini", "antigravity-cli", "brain"),
      conformanceRoot: evidenceRoot,
      allowConformanceProbe: true,
      authProbe: true,
      creditOveragesPolicy: "never-confirmed",
      processTimeoutMs: 5 * 60 * 1_000
    });
    const startedAt = Date.now();
    const evidence = {
      schemaVersion: 1 as const,
      cli: { version: cli.version, sha256: cliHash },
      createdAt: new Date().toISOString(),
      attempt: {
        arguments: ["--sandbox", "--new-project", "--model", "Gemini 3.5 Flash (Medium)", "--add-dir", "<redacted-path>", "--print-timeout", "300s", "--log-file", "<redacted-path>", "--print", "<redacted-prompt>"],
        requestedProfileInstruction: "Use the built-in generative image tool exactly once; generate exactly one image using Nano Banana 2.",
        exitState: "failure" as const
      },
      profiles: [
        { requestedProfile: "nano-banana-2" as const, result: "fail" as const, reason: "Conformance did not complete.", providerIdentity: null },
        { requestedProfile: "nano-banana-pro" as const, result: "disabled" as const, reason: "Not live-probed to avoid repeated paid or quota-consuming generations.", providerIdentity: null },
        { requestedProfile: "nano-banana-2-lite" as const, result: "disabled" as const, reason: "Not live-probed; verified 1K output evidence is required before enabling Lite.", providerIdentity: null, lite1kVerified: false }
      ]
    };
    try {
      const input: GenerationProviderInput = {
        projectPath: runRoot, runId: randomUUID(), generationNodeId: "antigravity-live", iteration: 1,
        prompt: "Create a single clean square image of a blue ceramic sphere on a neutral background.", negativePrompt: "text, watermark, collage",
        sections: [], references: [], edgeRoles: [], outputCount: 1, requestedAt: new Date().toISOString(),
        output: { aspectRatio: "1:1", resolution: "provider-determined", width: 1024, height: 1024 }
      };
      const result = await provider.generate(input, executionContext(stagingDirectory));
      expect(result.artifacts).toHaveLength(1);
      const artifact = result.artifacts[0]!;
      if (!artifact.sourcePath) throw new Error("Antigravity did not return an imported staged image path.");
      const image = await readFile(artifact.sourcePath);
      const dimensions = artifact.metadata?.dimensions as { width: number; height: number } | undefined;
      if (!dimensions) throw new Error("Antigravity image did not report validated dimensions.");
      evidence.attempt.exitState = "success";
      const providerIdentity = typeof artifact.metadata?.providerIdentity === "string" ? artifact.metadata.providerIdentity : null;
      evidence.profiles[0] = {
        requestedProfile: "nano-banana-2",
        result: "pass",
        providerIdentity,
        artifacts: [{ sha256: sha256(image), width: dimensions.width, height: dimensions.height, mimeType: artifact.mimeType }]
      };
      const evidencePath = await writeAntigravityConformance(evidenceRoot, evidence);
      expect(await access(evidencePath)).toBeUndefined();
      process.stdout.write(`Antigravity conformance evidence: ${evidencePath}\n`);
    } catch (error) {
      evidence.profiles[0] = {
        requestedProfile: "nano-banana-2",
        result: "fail",
        reason: redact(error),
        providerIdentity: null
      };
      const evidencePath = await writeAntigravityConformance(evidenceRoot, evidence);
      throw new Error(`Antigravity live conformance failed: ${redact(error)} Evidence: ${evidencePath}`, { cause: error });
    } finally {
      process.stdout.write(`Antigravity live elapsed: ${Date.now() - startedAt}ms\n`);
    }
  }, liveTimeoutMs);
});

describe.skipIf(liveEnabled)("Antigravity live conformance", () => {
  it("requires explicit ETHER_ANTIGRAVITY_LIVE=1 opt-in because it makes one real Nano Banana 2 image", () => {
    expect(liveEnabled).toBe(false);
  });
});

function executionContext(stagingDirectory: string): ProviderExecutionContext {
  return { signal: new AbortController().signal, providerAttemptId: randomUUID(), attemptOrdinal: 1, stagingDirectory, complete: async () => undefined };
}

function sha256(value: Buffer) { return createHash("sha256").update(value).digest("hex"); }
function redact(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return redactSensitiveText(message).slice(0, 1_000);
}
