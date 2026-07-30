import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { app, safeStorage } from "electron";
import {
  GeminiImageProvider,
  type GeneratedArtifact,
  type GenerationProviderInput,
  type ImageEditProviderInput
} from "@ether/providers";

import { createGeminiCredentialStore } from "./services/geminiCredentialStore.js";

const INTERNAL_RUN_GENERATED_IMAGE_LIMIT = 8;
const PLANNED_GENERATED_IMAGES = 8;
const MAX_ESTIMATED_COST_USD = 1.129;

type GenerationScenario = {
  id: string;
  profile: "nano-banana-2" | "nano-banana-pro" | "nano-banana-2-lite";
  model: string;
  tier: "1K" | "2K" | "4K";
  aspectRatio: string;
  width: number;
  height: number;
  estimatedCostUsd: number;
  usesReference?: true;
};

const GENERATION_SCENARIOS: readonly GenerationScenario[] = [
  {
    id: "flash-1k-square",
    profile: "nano-banana-2",
    model: "gemini-3.1-flash-image",
    tier: "1K",
    aspectRatio: "1:1",
    width: 1024,
    height: 1024,
    estimatedCostUsd: 0.067
  },
  {
    id: "flash-2k-reference-landscape",
    profile: "nano-banana-2",
    model: "gemini-3.1-flash-image",
    tier: "2K",
    aspectRatio: "16:9",
    width: 2752,
    height: 1536,
    estimatedCostUsd: 0.101,
    usesReference: true
  },
  {
    id: "flash-4k-portrait",
    profile: "nano-banana-2",
    model: "gemini-3.1-flash-image",
    tier: "4K",
    aspectRatio: "9:16",
    width: 3072,
    height: 5504,
    estimatedCostUsd: 0.151
  },
  {
    id: "pro-1k-square",
    profile: "nano-banana-pro",
    model: "gemini-3-pro-image",
    tier: "1K",
    aspectRatio: "1:1",
    width: 1024,
    height: 1024,
    estimatedCostUsd: 0.134
  },
  {
    id: "pro-2k-landscape",
    profile: "nano-banana-pro",
    model: "gemini-3-pro-image",
    tier: "2K",
    aspectRatio: "3:2",
    width: 2528,
    height: 1696,
    estimatedCostUsd: 0.134
  },
  {
    id: "pro-4k-portrait",
    profile: "nano-banana-pro",
    model: "gemini-3-pro-image",
    tier: "4K",
    aspectRatio: "3:4",
    width: 3584,
    height: 4800,
    estimatedCostUsd: 0.24
  },
  {
    id: "lite-1k-landscape",
    profile: "nano-banana-2-lite",
    model: "gemini-3.1-flash-lite-image",
    tier: "1K",
    aspectRatio: "4:3",
    width: 1200,
    height: 896,
    estimatedCostUsd: 0.0336
  }
] as const;

type ConformanceResult = {
  id: string;
  operation: "generate" | "edit";
  profile: string;
  model: string;
  state: "passed" | "failed";
  requested: {
    tier: string | null;
    aspectRatio: string | null;
    width: number | null;
    height: number | null;
    mimeType: "image/jpeg";
    referenceCount: number;
  };
  returned?: {
    width: number;
    height: number;
    mimeType: string;
    sha256: string;
  };
  estimatedCostUsd: number;
  failure?: {
    code: string;
    category: string;
  };
};

type LiveEvidence = {
  schemaVersion: 1;
  reviewedAt: string;
  completedAt: string | null;
  state: "running" | "passed" | "failed";
  route: "gemini-developer-api";
  apiVersion: "v1beta";
  endpoint: "generativelanguage.googleapis.com/v1beta/interactions";
  credentialState: "verified";
  store: false;
  searchGrounding: false;
  imageSearchGrounding: false;
  internalRunGeneratedImageLimit: number;
  plannedGeneratedImages: number;
  completedGeneratedImages: number;
  estimatedMaximumUsd: number;
  estimateOnly: true;
  results: ConformanceResult[];
};

export async function runGeminiLiveConformance(): Promise<void> {
  if (PLANNED_GENERATED_IMAGES > INTERNAL_RUN_GENERATED_IMAGE_LIMIT) {
    throw new Error("The Gemini live-conformance plan exceeds its conservative per-run image limit.");
  }
  await app.whenReady();
  const evidenceRoot = path.join(
    app.getPath("userData"),
    "4.0",
    "live-conformance",
    `gemini-${new Date().toISOString().replace(/[:.]/gu, "-")}`
  );
  const stagingRoot = path.join(evidenceRoot, "staging");
  const evidencePath = path.join(evidenceRoot, "evidence.json");
  await mkdir(stagingRoot, { recursive: true });

  const credentials = createGeminiCredentialStore({
    credentialPath: () => path.join(app.getPath("userData"), "gemini-api-credential.json"),
    safeStorage
  });
  const status = await credentials.status();
  if (status.state !== "verified") {
    throw Object.assign(new Error("The protected Gemini connection must be Verified before live conformance."), {
      code: "GEMINI_LIVE_CREDENTIAL_NOT_VERIFIED"
    });
  }

  const evidence: LiveEvidence = {
    schemaVersion: 1,
    reviewedAt: new Date().toISOString(),
    completedAt: null,
    state: "running",
    route: "gemini-developer-api",
    apiVersion: "v1beta",
    endpoint: "generativelanguage.googleapis.com/v1beta/interactions",
    credentialState: "verified",
    store: false,
    searchGrounding: false,
    imageSearchGrounding: false,
    internalRunGeneratedImageLimit: INTERNAL_RUN_GENERATED_IMAGE_LIMIT,
    plannedGeneratedImages: PLANNED_GENERATED_IMAGES,
    completedGeneratedImages: 0,
    estimatedMaximumUsd: MAX_ESTIMATED_COST_USD,
    estimateOnly: true,
    results: []
  };
  await writeEvidence(evidencePath, evidence);

  const provider = (profile: GenerationScenario["profile"]) => new GeminiImageProvider(profile, {
    getApiKey: () => credentials.readApiKey(),
    credentialState: () => "verified"
  });
  let referenceArtifact: GeneratedArtifact | null = null;

  try {
    for (const scenario of GENERATION_SCENARIOS) {
      const references = scenario.usesReference
        ? [{
            nodeId: "live-reference",
            role: "style",
            title: "Live conformance reference",
            sourceKind: "generated-image",
            assetPath: requireSourcePath(referenceArtifact)
          }]
        : [];
      const result = await provider(scenario.profile).generate({
        workspacePath: stagingRoot,
        runId: `live-${scenario.id}`,
        generationNodeId: scenario.id,
        iteration: 1,
        prompt: scenario.usesReference
          ? "Create a clean geometric landscape composition that visibly reuses the reference palette and shape language."
          : "Create a clean geometric composition with a pale background, a blue circle, and an orange triangle.",
        negativePrompt: "text, logo, watermark, photograph",
        sections: [],
        references,
        edgeRoles: [],
        outputCount: 1,
        output: {
          aspectRatio: scenario.aspectRatio,
          resolution: scenario.tier,
          width: scenario.width,
          height: scenario.height,
          outputFormat: "image/jpeg"
        },
        timeoutMs: 120_000,
        requestedAt: new Date().toISOString()
      } satisfies GenerationProviderInput, executionContext(stagingRoot, scenario.id));
      const artifact = requireArtifact(result.artifacts[0]);
      if (scenario.id === "flash-1k-square") referenceArtifact = artifact;
      evidence.results.push(passedResult(scenario, artifact, references.length));
      evidence.completedGeneratedImages += 1;
      await writeEvidence(evidencePath, evidence);
    }

    const editSource = requireSourcePath(referenceArtifact);
    const editProvider = provider("nano-banana-pro");
    const editResult = await editProvider.edit({
      workspacePath: stagingRoot,
      runId: "live-pro-edit",
      editNodeId: "pro-edit",
      editSubtype: "freeform",
      operation: "draw-note",
      iteration: 1,
      prompt: "Change the blue circle to green while preserving the composition.",
      negativePrompt: "text, logo, watermark",
      instruction: "Change the blue circle to green while preserving the orange triangle and pale background.",
      notes: "",
      sections: [],
      references: [],
      edgeRoles: [],
      outputCount: 1,
      sourceImage: { assetPath: editSource },
      mask: null,
      timeoutMs: 120_000,
      requestedAt: new Date().toISOString()
    } satisfies ImageEditProviderInput, executionContext(stagingRoot, "pro-edit"));
    const editedArtifact = requireArtifact(editResult.artifacts[0]);
    evidence.results.push({
      id: "pro-edit-source-image",
      operation: "edit",
      profile: "nano-banana-pro",
      model: "gemini-3-pro-image",
      state: "passed",
      requested: {
        tier: null,
        aspectRatio: null,
        width: null,
        height: null,
        mimeType: "image/jpeg",
        referenceCount: 1
      },
      returned: returnedArtifact(editedArtifact),
      estimatedCostUsd: 0.134
    });
    evidence.completedGeneratedImages += 1;
    evidence.state = "passed";
    evidence.completedAt = new Date().toISOString();
    await writeEvidence(evidencePath, evidence);
    process.stdout.write(`${JSON.stringify(publicSummary(evidence))}\n`);
  } catch (error) {
    const scenario = GENERATION_SCENARIOS[evidence.results.length];
    evidence.results.push({
      id: scenario?.id ?? "pro-edit-source-image",
      operation: scenario === undefined ? "edit" : "generate",
      profile: scenario?.profile ?? "nano-banana-pro",
      model: scenario?.model ?? "gemini-3-pro-image",
      state: "failed",
      requested: {
        tier: scenario?.tier ?? null,
        aspectRatio: scenario?.aspectRatio ?? null,
        width: scenario?.width ?? null,
        height: scenario?.height ?? null,
        mimeType: "image/jpeg",
        referenceCount: scenario?.usesReference ? 1 : scenario === undefined ? 1 : 0
      },
      estimatedCostUsd: scenario?.estimatedCostUsd ?? 0.134,
      failure: redactedFailure(error)
    });
    evidence.state = "failed";
    evidence.completedAt = new Date().toISOString();
    await writeEvidence(evidencePath, evidence);
    process.stdout.write(`${JSON.stringify(publicSummary(evidence))}\n`);
    throw error;
  }
}

function executionContext(stagingDirectory: string, providerAttemptId: string) {
  return {
    signal: new AbortController().signal,
    providerAttemptId,
    attemptOrdinal: 1,
    stagingDirectory,
    complete: async () => undefined
  };
}

function requireArtifact(artifact: GeneratedArtifact | undefined): GeneratedArtifact {
  if (artifact === undefined) {
    throw Object.assign(new Error("Live conformance completed without validated artifact metadata."), {
      code: "GEMINI_LIVE_ARTIFACT_INVALID"
    });
  }
  returnedArtifact(artifact);
  return artifact;
}

function requireSourcePath(artifact: GeneratedArtifact | null): string {
  if (artifact?.sourcePath === undefined) {
    throw Object.assign(new Error("Live conformance reference staging is unavailable."), {
      code: "GEMINI_LIVE_REFERENCE_UNAVAILABLE"
    });
  }
  return artifact.sourcePath;
}

function passedResult(
  scenario: GenerationScenario,
  artifact: GeneratedArtifact,
  referenceCount: number
): ConformanceResult {
  return {
    id: scenario.id,
    operation: "generate",
    profile: scenario.profile,
    model: scenario.model,
    state: "passed",
    requested: {
      tier: scenario.tier,
      aspectRatio: scenario.aspectRatio,
      width: scenario.width,
      height: scenario.height,
      mimeType: "image/jpeg",
      referenceCount
    },
    returned: returnedArtifact(artifact),
    estimatedCostUsd: scenario.estimatedCostUsd
  };
}

function returnedArtifact(artifact: GeneratedArtifact) {
  const dimensions = artifact.metadata?.dimensions;
  const sha256 = artifact.metadata?.sha256;
  if (
    !isRecord(dimensions) ||
    typeof dimensions.width !== "number" ||
    typeof dimensions.height !== "number" ||
    typeof sha256 !== "string"
  ) {
    throw Object.assign(new Error("Live conformance artifact validation metadata is malformed."), {
      code: "GEMINI_LIVE_ARTIFACT_INVALID"
    });
  }
  return {
    width: dimensions.width,
    height: dimensions.height,
    mimeType: artifact.mimeType,
    sha256
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function redactedFailure(error: unknown) {
  const candidate = error as { code?: unknown; failureCategory?: unknown; category?: unknown } | null;
  return {
    code: typeof candidate?.code === "string" ? candidate.code : "GEMINI_LIVE_UNKNOWN",
    category: typeof candidate?.failureCategory === "string"
      ? candidate.failureCategory
      : typeof candidate?.category === "string"
        ? candidate.category
        : "unknown"
  };
}

async function writeEvidence(evidencePath: string, evidence: LiveEvidence) {
  const temporary = `${evidencePath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(evidence, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600
    });
    await rename(temporary, evidencePath);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

function publicSummary(evidence: LiveEvidence) {
  return {
    state: evidence.state,
    completedGeneratedImages: evidence.completedGeneratedImages,
    plannedGeneratedImages: evidence.plannedGeneratedImages,
    estimatedMaximumUsd: evidence.estimatedMaximumUsd,
    evidenceStoredInProtectedAppData: true
  };
}
