import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ProviderOutputCountUnsupportedError, ProviderUnavailableError } from "../errors.js";
import { inferMimeType } from "../mime.js";
import type {
  GeneratedArtifact,
  GenerationProvider,
  GenerationProviderInput,
  ImageEditProviderInput,
  ProviderDiagnostic,
  ProviderDiagnosticContext,
  ProviderExecutionContext,
  ProviderGenerationResult,
  ProviderProcessCall
} from "../types.js";
import { readAntigravityConformance, type AntigravityProfileConformance } from "./capabilityProbe.js";
import { discoverAntigravityCli, type AntigravityCliDiscoveryOptions } from "./discovery.js";
import { redactSensitiveText, runAntigravityProcess } from "./processRunner.js";
import {
  buildAntigravityProcessCall,
  buildAntigravityPrompt,
  extractExplicitProviderIdentity,
  type AntigravityProfile
} from "./workerProtocol.js";

export { ANTIGRAVITY_MODEL, ANTIGRAVITY_PROFILE_IDS } from "./workerProtocol.js";
export type { AntigravityProfile } from "./workerProtocol.js";
export type AntigravityCreditOveragesPolicy = "never-confirmed" | "unverified";
export const ANTIGRAVITY_PROFILE_IDS_BY_PROVIDER = {
  "nano-banana-2": "google-nano-banana-2",
  "nano-banana-pro": "google-nano-banana-pro",
  "nano-banana-2-lite": "google-nano-banana-2-lite"
} as const;

export type AntigravityCliImageProviderOptions = Omit<AntigravityCliDiscoveryOptions, "run"> & {
  brainRoot?: string;
  conformanceRoot?: string;
  processTimeoutMs?: number;
  processOutputLimitBytes?: number;
  run?: (call: ProviderProcessCall, options: { timeoutMs: number; signal?: AbortSignal }) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
  sha256File?: (filePath: string) => Promise<string | null>;
  /** Reserved for the live conformance harness; normal provider registration never enables this. */
  allowConformanceProbe?: boolean;
  /** The official CLI has no per-call overage override; default remains unavailable until this is confirmed. */
  creditOveragesPolicy?: AntigravityCreditOveragesPolicy;
};

const defaultConformanceRoot = path.join(process.env.LOCALAPPDATA ?? os.tmpdir(), "Ether", "4.0", "conformance");
const maxCandidateFiles = 128;
const maxImageBytes = 50 * 1024 * 1024;

export class AntigravityImageProvider implements GenerationProvider {
  readonly descriptor;
  private readonly env: NodeJS.ProcessEnv | Record<string, string | undefined>;
  private readonly brainRoot: string;
  private readonly conformanceRoot: string;
  private readonly processTimeoutMs: number;
  private readonly processOutputLimitBytes: number;
  private readonly run: NonNullable<AntigravityCliImageProviderOptions["run"]>;
  private readonly discoveryOptions: AntigravityCliDiscoveryOptions;
  private readonly sha256File: (filePath: string) => Promise<string | null>;
  private readonly allowConformanceProbe: boolean;
  private readonly creditOveragesPolicy: AntigravityCreditOveragesPolicy;

  constructor(readonly profile: AntigravityProfile, options: AntigravityCliImageProviderOptions = {}) {
    const descriptor = profileDescriptor(profile);
    this.descriptor = descriptor;
    this.env = options.env ?? process.env;
    this.brainRoot = options.brainRoot ?? path.join(this.env.USERPROFILE ?? os.homedir(), ".gemini", "antigravity-cli", "brain");
    this.conformanceRoot = options.conformanceRoot ?? defaultConformanceRoot;
    this.processTimeoutMs = options.processTimeoutMs ?? 5 * 60 * 1000;
    this.processOutputLimitBytes = options.processOutputLimitBytes ?? 64 * 1024;
    this.run = options.run ?? ((call, runOptions) => runAntigravityProcess(call, {
      timeoutMs: runOptions.timeoutMs,
      signal: runOptions.signal,
      outputLimitBytes: this.processOutputLimitBytes
    }));
    this.discoveryOptions = {
      executablePath: options.executablePath,
      env: this.env,
      fileExists: options.fileExists,
      authProbe: options.authProbe === true,
      run: options.run ? (call) => options.run!(call, { timeoutMs: 15_000 }) : undefined
    };
    this.sha256File = options.sha256File ?? sha256File;
    this.allowConformanceProbe = options.allowConformanceProbe === true;
    this.creditOveragesPolicy = options.creditOveragesPolicy ?? "unverified";
  }

  async diagnose(context: ProviderDiagnosticContext = {}): Promise<ProviderDiagnostic> {
    const discovery = await discoverAntigravityCli({ ...this.discoveryOptions, fileExists: context.fileExists ?? this.discoveryOptions.fileExists });
    const details: Record<string, unknown> = {
      executable: discovery.executablePath ? "<redacted-local-path>" : null,
      cliVersion: discovery.version,
      authenticated: discovery.authenticated,
      visibleModelCount: discovery.visibleModels.length,
      authentication: discovery.authentication,
      creditOveragesPolicy: this.creditOveragesPolicy,
      orchestratorSelection: "Gemini 3.5 Flash (Medium)",
      requestedProfile: this.profile,
      providerIdentity: null
    };
    if (!discovery.executablePath || !discovery.version) return unavailable(this.descriptor, discovery.message ?? "Antigravity CLI is unavailable.", details);
    const sha256 = await this.sha256File(discovery.executablePath);
    const evidence = await readAntigravityConformance(this.conformanceRoot, { version: discovery.version, sha256 });
    const profileEvidence = evidence?.profiles.find((entry) => entry.requestedProfile === this.profile);
    const conformanceAuthProof = evidence?.profiles.some((entry) => entry.result === "pass") === true;
    if (conformanceAuthProof) {
      details.authentication = "conformance-verified";
      details.authenticated = false;
    }
    if (!discovery.authenticated && !conformanceAuthProof) {
      return unavailable(this.descriptor, discovery.message ?? "Antigravity CLI authentication is unverified.", details);
    }
    details.conformance = profileEvidence?.result ?? "missing";
    if (!profileEvidence || profileEvidence.result !== "pass") {
      const reason = profileEvidence?.reason ?? "No matching real Antigravity conformance evidence is present for this CLI version.";
      return unavailable(this.descriptor, reason, details, profileEvidence);
    }
    if (this.profile === "nano-banana-2-lite" && profileEvidence.lite1kVerified !== true) {
      return unavailable(this.descriptor, "Nano Banana 2 Lite is disabled until a real 1K output limit is verified.", details, profileEvidence);
    }
    if (this.creditOveragesPolicy !== "never-confirmed") {
      return unavailable(this.descriptor, creditOveragesMessage, details, profileEvidence);
    }
    return {
      ...this.descriptor,
      capabilities: [...this.descriptor.capabilities],
      availability: "available",
      messages: ["Antigravity is conformance-verified; current keyring state was not inspected."],
      profiles: [capabilityProfile(this.descriptor, "available", profileEvidence)],
      details: {
        ...details,
        conformance: "pass",
        providerIdentity: profileEvidence.providerIdentity ?? null
      }
    };
  }

  async generate(input: GenerationProviderInput, context?: ProviderExecutionContext): Promise<ProviderGenerationResult> {
    if (input.outputCount !== 1) throw new ProviderOutputCountUnsupportedError(this.descriptor.id, input.outputCount, 1);
    if (context?.signal.aborted) throw cancellationError();
    const diagnostic = await this.diagnose();
    if (this.creditOveragesPolicy !== "never-confirmed") throw new ProviderUnavailableError(diagnostic);
    if (diagnostic.availability !== "available" && !this.allowConformanceProbe) throw new ProviderUnavailableError(diagnostic);
    const discovery = await discoverAntigravityCli(this.discoveryOptions);
    if (!discovery.executablePath) throw new ProviderUnavailableError(diagnostic);
    const attemptId = context?.providerAttemptId ?? randomUUID();
    const parent = context?.stagingDirectory ?? path.join(input.workspacePath, ".ether-antigravity-staging");
    const attemptDirectory = path.join(parent, `antigravity-${safeSegment(attemptId)}-${randomUUID()}`);
    const importedDirectory = path.join(attemptDirectory, "imported");
    const referencesDirectory = path.join(attemptDirectory, "references");
    const logPath = path.join(attemptDirectory, "agy.log");
    await mkdir(referencesDirectory, { recursive: true });
    await mkdir(importedDirectory, { recursive: true });
    const stagedReferences = await stageReferences(input.references, referencesDirectory);
    const before = await snapshotRoots([this.brainRoot, attemptDirectory]);
    const prompt = buildAntigravityPrompt(this.profile, input, stagedReferences);
    const call = buildAntigravityProcessCall({
      executablePath: discovery.executablePath,
      env: this.env,
      workspacePath: input.workspacePath,
      request: {
        profile: this.profile,
        prompt,
        attemptDirectory,
        logPath,
        timeoutMs: input.timeoutMs ?? this.processTimeoutMs,
        addDirectories: [attemptDirectory]
      }
    });
    let result: { stdout: string; stderr: string; exitCode: number };
    try {
      result = await this.run(call, { timeoutMs: input.timeoutMs ?? this.processTimeoutMs, signal: context?.signal });
    } finally {
      await rm(logPath, { force: true });
    }
    if (result.exitCode !== 0) {
      throw new Error(`Antigravity CLI exited with ${result.exitCode}: ${redactSensitiveText(`${result.stderr}\n${result.stdout}`).slice(0, 2_000)}`);
    }
    const providerIdentity = extractExplicitProviderIdentity(result.stdout);
    const candidates = await changedImageCandidates([this.brainRoot, attemptDirectory], before);
    const validated = await Promise.all(candidates.map(validateImageCandidate));
    const images = validated.filter((candidate): candidate is ValidatedImage => candidate !== null);
    if (images.length !== 1) throw new Error(`Antigravity completed without exactly one newly created valid image artifact (found ${images.length}).`);
    const image = images[0]!;
    if (this.profile === "nano-banana-2-lite" && (image.width > 1024 || image.height > 1024)) {
      throw new Error("Nano Banana 2 Lite produced an image beyond the verified 1K limit.");
    }
    const importedPath = path.join(importedDirectory, `${image.sha256}${path.extname(image.path).toLowerCase() || ".png"}`);
    await copyFile(image.path, importedPath);
    const artifact: GeneratedArtifact = {
      fileName: path.basename(importedPath),
      sourcePath: importedPath,
      mimeType: image.mimeType,
      metadata: {
        requestedProfile: this.profile,
        providerIdentity,
        outputDiscovery: "changed-image-candidate",
        sha256: image.sha256,
        dimensions: { width: image.width, height: image.height }
      }
    };
    const completion: ProviderGenerationResult = {
      providerId: this.descriptor.id,
      providerName: this.descriptor.name,
      capabilities: [...this.descriptor.capabilities],
      artifacts: [artifact],
      metadata: {
        route: this.descriptor.route,
        requestedProfile: this.profile,
        providerIdentity,
        attemptId,
        exitCode: result.exitCode
      }
    };
    await context?.complete(completion);
    return completion;
  }

  async edit(_input: ImageEditProviderInput): Promise<never> {
    throw new Error("Antigravity image edit is disabled until separately conformed.");
  }
}

export function createAntigravityImageProviders(options: AntigravityCliImageProviderOptions = {}) {
  return (["nano-banana-pro", "nano-banana-2", "nano-banana-2-lite"] as const)
    .map((profile) => new AntigravityImageProvider(profile, options));
}

function profileDescriptor(profile: AntigravityProfile) {
  const id = ANTIGRAVITY_PROFILE_IDS_BY_PROVIDER[profile];
  const name = profile === "nano-banana-2" ? "Nano Banana 2" : profile === "nano-banana-pro" ? "Nano Banana Pro" : "Nano Banana 2 Lite";
  return {
    id,
    name,
    route: "antigravity-cli" as const,
    capabilities: ["image.generate"] as const,
    notes: ["Official local Antigravity CLI only; no API, browser, or token fallback.", "Enabled only by matching real CLI conformance evidence."]
  };
}

function unavailable(descriptor: AntigravityImageProvider["descriptor"], message: string, details: Record<string, unknown>, evidence?: AntigravityProfileConformance): ProviderDiagnostic {
  return {
    ...descriptor,
    capabilities: [...descriptor.capabilities],
    availability: "unavailable",
    messages: [redactSensitiveText(message).slice(0, 1_000)],
    profiles: [capabilityProfile(descriptor, "unavailable", evidence, message)],
    details
  };
}

function capabilityProfile(
  descriptor: AntigravityImageProvider["descriptor"],
  availability: "available" | "unavailable",
  evidence?: AntigravityProfileConformance,
  unavailableReason?: string
) {
  return {
    providerId: descriptor.id,
    profileId: descriptor.id,
    providerName: descriptor.name,
    route: descriptor.route,
    operation: "image.generate" as const,
    inputChannels: ["text", "image"] as const,
    outputChannels: ["image"] as const,
    availability,
    status: availability === "available" ? "experimental" as const : "unavailable" as const,
    capabilitySource: "antigravity-cli" as const,
    requiresExplicitSelection: true,
    noHiddenFallback: true,
    maxParallelism: 4,
    model: evidence?.providerIdentity ?? undefined,
    unavailableReason: availability === "unavailable" ? redactSensitiveText(unavailableReason ?? evidence?.reason ?? "Conformance unavailable.") : undefined,
    messages: availability === "available"
      ? ["Real conformance passed. Antigravity shares four active requests across the application."]
      : [redactSensitiveText(unavailableReason ?? evidence?.reason ?? "Conformance unavailable.")],
    mediaLimits: descriptor.id === "google-nano-banana-2-lite" ? { maxWidth: 1024, maxHeight: 1024, notes: ["Enabled only after verified 1K conformance."] } : undefined
  };
}

type Snapshot = Map<string, string>;
async function snapshotRoots(roots: string[]) {
  const snapshot: Snapshot = new Map();
  for (const root of roots) for (const file of await enumerateFiles(root)) {
    const details = await stat(file);
    snapshot.set(file, `${details.size}:${details.mtimeMs}`);
  }
  return snapshot;
}

async function changedImageCandidates(roots: string[], before: Snapshot) {
  const files = new Set<string>();
  for (const root of roots) for (const file of await enumerateFiles(root)) files.add(file);
  const candidates: string[] = [];
  for (const file of files) {
    if (!isImageExtension(file)) continue;
    const details = await stat(file);
    if (before.get(file) !== `${details.size}:${details.mtimeMs}`) candidates.push(file);
    if (candidates.length >= maxCandidateFiles) break;
  }
  return candidates;
}

async function enumerateFiles(root: string) {
  const files: string[] = [];
  const walk = async (directory: string): Promise<void> => {
    if (files.length >= maxCandidateFiles) return;
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (files.length >= maxCandidateFiles) return;
      const candidate = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(candidate);
      else if (entry.isFile()) files.push(candidate);
    }
  };
  await walk(root);
  return files;
}

type ValidatedImage = { path: string; sha256: string; width: number; height: number; mimeType: string };
async function validateImageCandidate(filePath: string): Promise<ValidatedImage | null> {
  try {
    const details = await stat(filePath);
    if (details.size <= 0 || details.size > maxImageBytes) return null;
    const content = await readFile(filePath);
    const dimensions = imageDimensions(content);
    if (!dimensions || dimensions.width < 1 || dimensions.height < 1) return null;
    return { path: filePath, sha256: createHash("sha256").update(content).digest("hex"), mimeType: inferMimeType(filePath), ...dimensions };
  } catch { return null; }
}

function imageDimensions(content: Buffer) {
  if (content.length >= 24 && content.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return { width: content.readUInt32BE(16), height: content.readUInt32BE(20) };
  }
  if (content.length >= 10 && content.subarray(0, 2).equals(Buffer.from([0xff, 0xd8]))) {
    let offset = 2;
    while (offset + 9 < content.length) {
      if (content[offset] !== 0xff) return null;
      const marker = content[offset + 1]!;
      const length = content.readUInt16BE(offset + 2);
      if (marker >= 0xc0 && marker <= 0xc3) return { width: content.readUInt16BE(offset + 7), height: content.readUInt16BE(offset + 5) };
      offset += 2 + length;
    }
  }
  return null;
}

function isImageExtension(filePath: string) { return [".png", ".jpg", ".jpeg"].includes(path.extname(filePath).toLowerCase()); }
function safeSegment(value: string) { return value.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80) || "attempt"; }
function cancellationError() { return Object.assign(new Error("Antigravity image generation was cancelled."), { name: "AbortError", category: "cancellation" }); }
async function sha256File(filePath: string) { try { return createHash("sha256").update(await readFile(filePath)).digest("hex"); } catch { return null; } }

const creditOveragesMessage = "Confirm the official Antigravity AI Credit Overages setting is Never before connecting or generating. Ether cannot override Google billing.";

async function stageReferences(references: GenerationProviderInput["references"], referencesDirectory: string) {
  const stagedNames: string[] = [];
  for (const [index, reference] of references.entries()) {
    if (!reference.assetPath) continue;
    const extension = safeExtension(reference.assetPath);
    const fileName = `reference-${String(index + 1).padStart(3, "0")}-${randomUUID()}${extension}`;
    await copyFile(reference.assetPath, path.join(referencesDirectory, fileName));
    stagedNames.push(path.join("references", fileName));
  }
  return stagedNames;
}

function safeExtension(filePath: string) {
  const extension = path.extname(filePath).toLowerCase();
  return /^\.[a-z0-9]{1,10}$/.test(extension) ? extension : ".bin";
}
