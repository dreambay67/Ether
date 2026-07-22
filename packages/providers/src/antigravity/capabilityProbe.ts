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
  artifacts?: Array<{ sha256: string; width: number; height: number; mimeType: string }>;
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
  return entry.schemaVersion === 1 && typeof entry.createdAt === "string" && Boolean(entry.cli)
    && typeof entry.cli?.version === "string" && Array.isArray(entry.profiles);
}

function redactEvidence(evidence: AntigravityConformanceEvidence): AntigravityConformanceEvidence {
  return {
    ...evidence,
    profiles: evidence.profiles.map((profile) => ({
      ...profile,
      reason: profile.reason ? redactSensitiveText(profile.reason).slice(0, 1_000) : undefined,
      providerIdentity: profile.providerIdentity ? redactSensitiveText(profile.providerIdentity).slice(0, 200) : profile.providerIdentity
    }))
  };
}
