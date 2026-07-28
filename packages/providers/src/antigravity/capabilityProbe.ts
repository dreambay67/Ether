import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AntigravityProfile } from "./workerProtocol.js";
import { redactSensitiveText } from "./processRunner.js";

export type AntigravityProfileConformance = {
  requestedProfile: AntigravityProfile;
  result: "pass" | "disabled" | "fail";
  reason?: string;
  providerIdentity?: string | null;
  lite1kVerified?: boolean;
  resolutionControl?: {
    structurallySupported: boolean;
    reason?: string;
    probes: Array<{
      requestedResolution: "2K" | "4K";
      requestedAspectRatio: string;
      actualWidth: number;
      actualHeight: number;
      sha256: string;
    }>;
  };
  artifacts?: Array<{
    sha256: string;
    width: number;
    height: number;
    mimeType: string;
    requestedAspectRatio?: string;
    requestedResolution?: "1K" | "2K" | "4K";
  }>;
};

export type AntigravityConformanceEvidence = {
  schemaVersion: 1;
  cli: { version: string; sha256: string | null };
  createdAt: string;
  attempt?: {
    arguments: string[];
    requestedProfileInstruction: string;
    exitState: "success" | "failure";
  };
  profiles: AntigravityProfileConformance[];
};

export async function writeAntigravityConformance(root: string, evidence: AntigravityConformanceEvidence) {
  await mkdir(root, { recursive: true });
  const evidencePath = path.join(root, `antigravity-${Date.now()}.json`);
  await writeFile(evidencePath, `${JSON.stringify(redactEvidence(evidence), null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  return evidencePath;
}

export async function readAntigravityConformance(
  root: string,
  cli: { version: string; sha256: string | null }
): Promise<AntigravityConformanceEvidence | null> {
  let files: string[];
  try {
    files = (await readdir(root)).filter((name) => /^antigravity-\d+\.json$/.test(name)).sort().reverse().slice(0, 32);
  } catch {
    return null;
  }
  for (const file of files) {
    try {
      const parsed = JSON.parse(await readFile(path.join(root, file), "utf8")) as unknown;
      if (!isEvidence(parsed)) continue;
      if (parsed.cli.version === cli.version && parsed.cli.sha256 === cli.sha256) return parsed;
    } catch {
      // A partial or unrelated local evidence file is not conformance evidence.
    }
  }
  return null;
}

function isEvidence(value: unknown): value is AntigravityConformanceEvidence {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<AntigravityConformanceEvidence>;
  return entry.schemaVersion === 1
    && typeof entry.createdAt === "string"
    && isCliEvidence(entry.cli)
    && (entry.attempt === undefined || isAttemptEvidence(entry.attempt))
    && Array.isArray(entry.profiles)
    && entry.profiles.every(isProfileEvidence);
}

function isCliEvidence(value: unknown): value is AntigravityConformanceEvidence["cli"] {
  if (!isRecord(value)) return false;
  return typeof value.version === "string"
    && value.version.length > 0
    && (typeof value.sha256 === "string" || value.sha256 === null);
}

function isAttemptEvidence(value: unknown): value is NonNullable<AntigravityConformanceEvidence["attempt"]> {
  if (!isRecord(value)) return false;
  return Array.isArray(value.arguments)
    && value.arguments.every((argument) => typeof argument === "string")
    && typeof value.requestedProfileInstruction === "string"
    && (value.exitState === "success" || value.exitState === "failure");
}

function isProfileEvidence(value: unknown): value is AntigravityProfileConformance {
  if (!isRecord(value)) return false;
  if (!["nano-banana-2", "nano-banana-pro", "nano-banana-2-lite"].includes(String(value.requestedProfile))) return false;
  if (!["pass", "disabled", "fail"].includes(String(value.result))) return false;
  if (value.reason !== undefined && typeof value.reason !== "string") return false;
  if (value.providerIdentity !== undefined && value.providerIdentity !== null && typeof value.providerIdentity !== "string") return false;
  if (value.lite1kVerified !== undefined && typeof value.lite1kVerified !== "boolean") return false;
  if (value.resolutionControl !== undefined && !isResolutionControl(value.resolutionControl)) return false;
  return value.artifacts === undefined
    || (Array.isArray(value.artifacts) && value.artifacts.every(isArtifactEvidence));
}

function isResolutionControl(value: unknown): value is NonNullable<AntigravityProfileConformance["resolutionControl"]> {
  if (!isRecord(value)) return false;
  return typeof value.structurallySupported === "boolean"
    && (value.reason === undefined || typeof value.reason === "string")
    && Array.isArray(value.probes)
    && value.probes.every((probe) => isRecord(probe)
      && (probe.requestedResolution === "2K" || probe.requestedResolution === "4K")
      && typeof probe.requestedAspectRatio === "string"
      && probe.requestedAspectRatio.length > 0
      && isPositiveInteger(probe.actualWidth)
      && isPositiveInteger(probe.actualHeight)
      && typeof probe.sha256 === "string"
      && probe.sha256.length > 0);
}

function isArtifactEvidence(value: unknown): value is NonNullable<AntigravityProfileConformance["artifacts"]>[number] {
  if (!isRecord(value)) return false;
  return typeof value.sha256 === "string"
    && value.sha256.length > 0
    && isPositiveInteger(value.width)
    && isPositiveInteger(value.height)
    && typeof value.mimeType === "string"
    && value.mimeType.length > 0
    && (value.requestedAspectRatio === undefined
      || (typeof value.requestedAspectRatio === "string" && value.requestedAspectRatio.length > 0))
    && (value.requestedResolution === undefined
      || ["1K", "2K", "4K"].includes(String(value.requestedResolution)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isPositiveInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function redactEvidence(evidence: AntigravityConformanceEvidence): AntigravityConformanceEvidence {
  return {
    ...evidence,
    attempt: evidence.attempt
      ? {
          ...evidence.attempt,
          arguments: evidence.attempt.arguments.map(redactSensitiveText),
          requestedProfileInstruction: redactSensitiveText(evidence.attempt.requestedProfileInstruction)
        }
      : undefined,
    profiles: evidence.profiles.map((profile) => ({
      ...profile,
      reason: profile.reason ? redactSensitiveText(profile.reason).slice(0, 1_000) : undefined,
      providerIdentity: profile.providerIdentity ? redactSensitiveText(profile.providerIdentity).slice(0, 200) : profile.providerIdentity
    }))
  };
}
