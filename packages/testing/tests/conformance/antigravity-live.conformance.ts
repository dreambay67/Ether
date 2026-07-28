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
  type AntigravityConformanceEvidence,
  type AntigravityProfileConformance,
  type GenerationProviderInput,
  type ProviderExecutionContext
} from "@ether/providers";

const liveEnabled = process.env.ETHER_ANTIGRAVITY_LIVE === "1" && process.env.ETHER_ANTIGRAVITY_CREDIT_OVERAGES_NEVER === "1";
const liveTimeoutMs = 30 * 60 * 1_000;
const profiles = [
  {
    id: "nano-banana-2",
    name: "Nano Banana 2",
    lite1k: false,
    cases: [
      { aspectRatio: "1:1", resolution: "1K", width: 1024, height: 1024 },
      { aspectRatio: "16:9", resolution: "1K", width: 1376, height: 768 }
    ],
    resolutionProbes: [
      { aspectRatio: "16:9", resolution: "2K", width: 2752, height: 1536, expectedWidth: 1376, expectedHeight: 768 },
      { aspectRatio: "16:9", resolution: "4K", width: 5504, height: 3072, expectedWidth: 1376, expectedHeight: 768 }
    ]
  },
  {
    id: "nano-banana-pro",
    name: "Nano Banana Pro",
    lite1k: false,
    cases: [
      { aspectRatio: "1:1", resolution: "1K", width: 1024, height: 1024 },
      { aspectRatio: "4:3", resolution: "1K", width: 1200, height: 896 }
    ],
    resolutionProbes: [
      { aspectRatio: "4:3", resolution: "2K", width: 2400, height: 1792, expectedWidth: 1200, expectedHeight: 896 },
      { aspectRatio: "4:3", resolution: "4K", width: 4800, height: 3584, expectedWidth: 1200, expectedHeight: 896 }
    ]
  },
  {
    id: "nano-banana-2-lite",
    name: "Nano Banana 2 Lite",
    lite1k: true,
    cases: [{ aspectRatio: "1:1", resolution: "1K", width: 1024, height: 1024 }],
    resolutionProbes: []
  }
] as const;

describe.runIf(liveEnabled)("Antigravity live conformance", () => {
  it("conforms every release-supported Nano Banana profile and 1K aspect-ratio control through the official CLI", async () => {
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
    const startedAt = Date.now();
    const evidence: AntigravityConformanceEvidence = {
      schemaVersion: 1,
      cli: { version: cli.version, sha256: cliHash },
      createdAt: new Date().toISOString(),
      attempt: {
        arguments: ["--sandbox", "--new-project", "--model", "Gemini 3.5 Flash (Medium)", "--add-dir", "<redacted-path>", "--print-timeout", "300s", "--log-file", "<redacted-path>", "--print", "<redacted-prompt>"],
        requestedProfileInstruction: "Run one isolated built-in generative image call for every release-supported Nano Banana profile and conformance-gated 1K aspect ratio, plus bounded 2K/4K limitation probes.",
        exitState: "failure"
      },
      profiles: profiles.map((profile) => ({
        requestedProfile: profile.id,
        result: "fail" as const,
        reason: "Conformance did not complete.",
        providerIdentity: null,
        ...(profile.lite1k ? { lite1kVerified: false } : {})
      }))
    };
    try {
      for (const [index, profile] of profiles.entries()) {
        const provider = new AntigravityImageProvider(profile.id, {
          executablePath: cli.executablePath,
          brainRoot: path.join(process.env.USERPROFILE ?? os.homedir(), ".gemini", "antigravity-cli", "brain"),
          conformanceRoot: evidenceRoot,
          allowConformanceProbe: true,
          authProbe: true,
          creditOveragesPolicy: "never-confirmed",
          processTimeoutMs: 5 * 60 * 1_000
        });
        const artifacts: NonNullable<AntigravityProfileConformance["artifacts"]> = [];
        let providerIdentity: string | null = null;
        for (const [caseIndex, requested] of profile.cases.entries()) {
          const input: GenerationProviderInput = {
            workspacePath: runRoot,
            runId: randomUUID(),
            generationNodeId: `antigravity-live-${profile.id}-${requested.resolution.toLowerCase()}-${requested.aspectRatio.replace(":", "x")}`,
            iteration: caseIndex + 1,
            prompt: `Create one clean image of a blue ceramic sphere on a neutral background for ${profile.name} ${requested.resolution} ${requested.aspectRatio} conformance.`,
            negativePrompt: "text, watermark, collage",
            sections: [],
            references: [],
            edgeRoles: [],
            outputCount: 1,
            requestedAt: new Date().toISOString(),
            output: {
              aspectRatio: requested.aspectRatio,
              resolution: requested.resolution,
              width: requested.width,
              height: requested.height
            }
          };
          const result = await provider.generate(input, executionContext(stagingDirectory));
          expect(result.artifacts).toHaveLength(1);
          const artifact = result.artifacts[0]!;
          if (!artifact.sourcePath) throw new Error(`${profile.name} did not return an imported staged image path.`);
          const image = await readFile(artifact.sourcePath);
          const dimensions = artifact.metadata?.dimensions as { width: number; height: number } | undefined;
          if (!dimensions) throw new Error(`${profile.name} did not report validated dimensions.`);
          expectResolutionTier(dimensions, requested.resolution);
          expectAspectRatio(dimensions, requested.aspectRatio);
          expect(dimensions).toEqual({ width: requested.width, height: requested.height });
          if (profile.lite1k) expect(Math.max(dimensions.width, dimensions.height)).toBe(1024);
          const explicitIdentity = typeof artifact.metadata?.providerIdentity === "string" ? artifact.metadata.providerIdentity : null;
          providerIdentity ??= explicitIdentity;
          artifacts.push({
            sha256: sha256(image),
            width: dimensions.width,
            height: dimensions.height,
            mimeType: artifact.mimeType,
            requestedAspectRatio: requested.aspectRatio,
            requestedResolution: requested.resolution
          });
        }
        const resolutionProbes: NonNullable<AntigravityProfileConformance["resolutionControl"]>["probes"] = [];
        for (const [probeIndex, requested] of profile.resolutionProbes.entries()) {
          const input: GenerationProviderInput = {
            workspacePath: runRoot,
            runId: randomUUID(),
            generationNodeId: `antigravity-resolution-limit-${profile.id}-${requested.resolution.toLowerCase()}`,
            iteration: profile.cases.length + probeIndex + 1,
            prompt: `Create one clean image of a blue ceramic sphere on a neutral background for the ${profile.name} ${requested.resolution} resolution-control probe.`,
            negativePrompt: "text, watermark, collage",
            sections: [],
            references: [],
            edgeRoles: [],
            outputCount: 1,
            requestedAt: new Date().toISOString(),
            output: {
              aspectRatio: requested.aspectRatio,
              resolution: requested.resolution,
              width: requested.width,
              height: requested.height
            }
          };
          const result = await provider.generate(input, executionContext(stagingDirectory));
          expect(result.artifacts).toHaveLength(1);
          const artifact = result.artifacts[0]!;
          if (!artifact.sourcePath) throw new Error(`${profile.name} did not return the resolution-limit probe image.`);
          const image = await readFile(artifact.sourcePath);
          const dimensions = artifact.metadata?.dimensions as { width: number; height: number } | undefined;
          if (!dimensions) throw new Error(`${profile.name} did not report resolution-limit probe dimensions.`);
          expect(dimensions).toEqual({ width: requested.expectedWidth, height: requested.expectedHeight });
          resolutionProbes.push({
            requestedResolution: requested.resolution,
            requestedAspectRatio: requested.aspectRatio,
            actualWidth: dimensions.width,
            actualHeight: dimensions.height,
            sha256: sha256(image)
          });
        }
        evidence.profiles[index] = {
          requestedProfile: profile.id,
          result: "pass",
          providerIdentity,
          ...(profile.lite1k ? { lite1kVerified: true } : {}),
          resolutionControl: {
            structurallySupported: false,
            reason: `Antigravity CLI ${cli.version} generate_image exposes AspectRatio but no resolution or image-size parameter.`,
            probes: resolutionProbes
          },
          artifacts
        };
      }
      if (evidence.attempt === undefined) throw new Error("Antigravity evidence is missing its attempt record.");
      evidence.attempt.exitState = "success";
      const evidencePath = await writeAntigravityConformance(evidenceRoot, evidence);
      expect(await access(evidencePath)).toBeUndefined();
      process.stdout.write(`Antigravity conformance evidence: ${evidencePath}\n`);
    } catch (error) {
      const pending = evidence.profiles.findIndex((profile) => profile.result !== "pass");
      if (pending >= 0) {
        evidence.profiles[pending] = {
          ...evidence.profiles[pending]!,
          result: "fail",
          reason: redact(error),
          providerIdentity: null
        };
      }
      const evidencePath = await writeAntigravityConformance(evidenceRoot, evidence);
      throw new Error(`Antigravity live conformance failed: ${redact(error)} Evidence: ${evidencePath}`, { cause: error });
    } finally {
      process.stdout.write(`Antigravity live elapsed: ${Date.now() - startedAt}ms\n`);
    }
  }, liveTimeoutMs);
});

describe.skipIf(liveEnabled)("Antigravity live conformance", () => {
  it("requires explicit ETHER_ANTIGRAVITY_LIVE=1 opt-in because it makes nine real Nano Banana images", () => {
    expect(liveEnabled).toBe(false);
  });
});

function executionContext(stagingDirectory: string): ProviderExecutionContext {
  return { signal: new AbortController().signal, providerAttemptId: randomUUID(), attemptOrdinal: 1, stagingDirectory, complete: async () => undefined };
}

function sha256(value: Buffer) { return createHash("sha256").update(value).digest("hex"); }
function expectResolutionTier(dimensions: { width: number; height: number }, tier: "1K" | "2K" | "4K") {
  const longest = Math.max(dimensions.width, dimensions.height);
  const range = tier === "1K" ? [700, 1_600] : tier === "2K" ? [1_600, 3_300] : [3_300, 6_600];
  expect(longest).toBeGreaterThanOrEqual(range[0]!);
  expect(longest).toBeLessThanOrEqual(range[1]!);
}
function expectAspectRatio(dimensions: { width: number; height: number }, aspectRatio: string) {
  const [widthRatio, heightRatio] = aspectRatio.split(":").map(Number);
  if (!widthRatio || !heightRatio) throw new Error(`Invalid conformance aspect ratio ${aspectRatio}.`);
  expect(Math.abs(dimensions.width / dimensions.height - widthRatio / heightRatio)).toBeLessThan(0.03);
}
function redact(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return redactSensitiveText(message).slice(0, 1_000);
}
