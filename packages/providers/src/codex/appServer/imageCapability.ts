import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { CODEX_APP_SERVER_MANIFEST_SHA256, CODEX_APP_SERVER_VERSION, isRecord } from "./protocol.js";

export type CodexImageCapabilityProfile = {
  status: "verified";
  outputDiscovery: "imageGeneration.savedPath";
  referenceInputs: true;
  dimensionMode: "provider-determined";
  exactResolution: false;
  verifiedAspectRatios: string[];
  aspectRatioTolerance: number;
};

export type CodexImageCapabilityManifest = {
  schemaVersion: 1;
  codexVersion: string;
  appServerManifestSha256: string;
  toolContract: {
    itemType: "imageGeneration";
    completionMethod: "item/completed";
    outputPathField: "savedPath";
    referenceInputType: "localImage";
  };
  profile: CodexImageCapabilityProfile;
};

const manifestPath = path.resolve(__dirname, "../../../protocol/codex-0.144.2/image-capability.json");
const manifestBytes = readFileSync(manifestPath);

export const CODEX_IMAGE_CAPABILITY_MANIFEST_SHA256 = createHash("sha256").update(manifestBytes).digest("hex");
export const CODEX_IMAGE_CAPABILITY_MANIFEST = readManifest(JSON.parse(manifestBytes.toString("utf8")));

export function resolveCodexImageCapability(
  reportedVersion: string,
  appServerManifestSha256: string,
  manifest: CodexImageCapabilityManifest | null = CODEX_IMAGE_CAPABILITY_MANIFEST
) {
  if (!manifest
    || manifest.codexVersion !== reportedVersion
    || manifest.codexVersion !== CODEX_APP_SERVER_VERSION
    || manifest.appServerManifestSha256 !== appServerManifestSha256
    || manifest.appServerManifestSha256 !== CODEX_APP_SERVER_MANIFEST_SHA256
    || manifest.profile.status !== "verified") return null;
  const manifestHash = manifest === CODEX_IMAGE_CAPABILITY_MANIFEST
    ? CODEX_IMAGE_CAPABILITY_MANIFEST_SHA256
    : createHash("sha256").update(JSON.stringify(manifest)).digest("hex");
  return { manifestHash, profile: structuredClone(manifest.profile) };
}

function readManifest(value: unknown): CodexImageCapabilityManifest {
  if (!isRecord(value) || value.schemaVersion !== 1 || typeof value.codexVersion !== "string"
    || typeof value.appServerManifestSha256 !== "string" || !isRecord(value.toolContract)
    || !isRecord(value.profile)) throw new Error("Codex image capability manifest is malformed.");
  const toolContract = value.toolContract;
  const profile = value.profile;
  if (toolContract.itemType !== "imageGeneration" || toolContract.completionMethod !== "item/completed"
    || toolContract.outputPathField !== "savedPath" || toolContract.referenceInputType !== "localImage"
    || profile.status !== "verified" || profile.outputDiscovery !== "imageGeneration.savedPath"
    || profile.referenceInputs !== true || profile.dimensionMode !== "provider-determined"
    || profile.exactResolution !== false || !Array.isArray(profile.verifiedAspectRatios)
    || profile.verifiedAspectRatios.some((entry) => typeof entry !== "string")
    || typeof profile.aspectRatioTolerance !== "number") {
    throw new Error("Codex image capability manifest has an unsupported tool or image profile.");
  }
  return value as CodexImageCapabilityManifest;
}
