import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

export const recoveryManifestRelativePath = "docs/evidence/ether-4.0-recovery/phase-5/manual-packaged/packaged/manifest.json";

export const recoveryCaptureInventory = Object.freeze([
  capture("first-run", "First-run blank canvas", "docs/evidence/ether-4.0-recovery/phase-5/manual-packaged/packaged/result.json", "screenshots/01-first-run-blank.png"),
  capture("shortcuts", "Keyboard and pointer reference", "docs/evidence/ether-4.0-recovery/phase-5/manual-packaged/packaged/result.json", "screenshots/02-shortcut-reference.png"),
  capture("direct-editing", "Direct editing on the canvas", "docs/evidence/ether-4.0-recovery/phase-5/manual-packaged/packaged/result.json", "screenshots/03-direct-editing.png"),
  capture("all-17-nodes", "All 17 canonical nodes authored from blank", "docs/evidence/ether-4.0-recovery/phase-1/blank-gui-checkpoint/packaged/result.json", "screenshots/04-all-17-node-types.png"),
  capture("channels-roles", "Six channels with a visible semantic role", "docs/evidence/ether-4.0-recovery/phase-5/manual-packaged/packaged/result.json", "screenshots/04-channels-and-roles.png"),
  capture("locked-module", "Locked Module created from selection", "docs/evidence/ether-4.0-recovery/phase-5/manual-packaged/packaged/result.json", "screenshots/05-locked-module.png"),
  capture("reference-setup", "Reference Set and honest empty Reference Desk", "docs/evidence/ether-4.0-recovery/phase-5/manual-packaged/packaged/result.json", "screenshots/06-reference-setup.png"),
  capture("batch-run", "Batch Matrix in the Run workspace", "docs/evidence/ether-4.0-recovery/phase-5/manual-packaged/packaged/result.json", "screenshots/07-batch-run-workspace.png"),
  capture("review-empty", "Artifact Observatory empty state", "docs/evidence/ether-4.0-recovery/phase-5/manual-packaged/packaged/result.json", "screenshots/08-review-empty-state.png"),
  capture("export-setup", "Export setup before a folder grant", "docs/evidence/ether-4.0-recovery/phase-5/manual-packaged/packaged/result.json", "screenshots/09-export-setup.png"),
  capture("provider-guard", "Provider-safe run-preview error", "docs/evidence/ether-4.0-recovery/phase-5/manual-packaged/packaged/result.json", "screenshots/10-provider-safe-error.png"),
  capture("recipes", "Recipe Gallery before insertion", "docs/evidence/ether-4.0-recovery/phase-5/manual-packaged/packaged/result.json", "screenshots/11-recipe-gallery.png"),
  capture("recovery-settings", "Recovery and provider setup in Settings", "docs/evidence/ether-4.0-recovery/phase-5/manual-packaged/packaged/result.json", "screenshots/12-recovery-and-provider-setup.png")
]);

const requiredArtifacts = Object.freeze([
  "release/windows/win-unpacked/Ether.exe",
  "release/windows/win-unpacked/resources/app.asar"
]);

export async function createRecoveryManualManifest(root) {
  const results = new Map();
  for (const item of recoveryCaptureInventory) {
    if (!results.has(item.sourceResult)) results.set(item.sourceResult, await readResult(root, item.sourceResult));
  }
  const identities = [...results.values()].map(({ result }) => result.identity);
  const gitCommit = identities[0]?.gitCommit;
  if (!/^[a-f0-9]{40}$/u.test(gitCommit ?? "")) throw new Error("Manual evidence lacks an exact product commit.");
  if (identities.some((identity) => identity.gitCommit !== gitCommit || identity.mode !== "packaged")) {
    throw new Error("Manual journeys do not share one packaged product commit.");
  }
  const artifacts = requiredArtifacts.map((artifactPath) => {
    const hashes = identities.map((identity) => new Map(identity.artifacts.map((item) => [normalize(item.path), item.sha256])).get(artifactPath));
    if (hashes.some((hash) => !/^[a-f0-9]{64}$/u.test(hash ?? "")) || new Set(hashes).size !== 1) {
      throw new Error(`Manual journeys do not share an exact ${artifactPath} hash.`);
    }
    return { path: artifactPath, sha256: hashes[0] };
  });
  for (const artifact of artifacts) {
    const actual = await sha256File(path.join(root, ...artifact.path.split("/")));
    if (actual !== artifact.sha256) throw new Error(`Current package does not match manual evidence: ${artifact.path}.`);
  }
  const captures = [];
  for (const item of recoveryCaptureInventory) {
    const source = results.get(item.sourceResult);
    if (source === undefined) throw new Error(`Manual result was not loaded: ${item.sourceResult}.`);
    const action = source.result.actions.find((candidate) => normalize(candidate.screenshotPath ?? "") === item.screenshotPath);
    if (action === undefined || action.kind !== "screenshot") {
      throw new Error(`Manual capture lacks a recorded screenshot action: ${item.label}.`);
    }
    const capturePath = normalize(path.posix.join(path.posix.dirname(item.sourceResult), item.screenshotPath));
    const bytes = await readFile(path.join(root, ...capturePath.split("/")));
    const dimensions = pngDimensions(bytes);
    captures.push({
      ...item,
      path: capturePath,
      actionSequence: action.sequence,
      actionLabel: action.label,
      width: dimensions.width,
      height: dimensions.height,
      sha256: sha256(bytes)
    });
  }
  const finished = [...results.values()].map(({ result }) => result.finishedAt).filter((value) => typeof value === "string").sort();
  return {
    schemaVersion: 1,
    version: "4.0.0",
    source: "packaged-blank-document-journeys",
    sourceProfile: "fresh-isolated",
    capturedAt: finished.at(-1),
    package: { gitCommit, artifacts },
    labels: recoveryCaptureInventory.map((item) => item.label),
    captures
  };
}

export async function validateRecoveryManualEvidence(root, { verifyPackageFiles = true } = {}) {
  const manifestPath = path.join(root, ...recoveryManifestRelativePath.split("/"));
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (
    manifest?.schemaVersion !== 1 ||
    manifest?.version !== "4.0.0" ||
    manifest?.source !== "packaged-blank-document-journeys" ||
    manifest?.sourceProfile !== "fresh-isolated"
  ) throw new Error("Manual manifest does not identify the isolated packaged blank-document route.");
  if (JSON.stringify(manifest.labels) !== JSON.stringify(recoveryCaptureInventory.map((item) => item.label))) {
    throw new Error("Manual manifest labels do not match the T25 capture inventory.");
  }
  if (!/^[a-f0-9]{40}$/u.test(manifest.package?.gitCommit ?? "")) throw new Error("Manual manifest lacks an exact product commit.");
  if (!Array.isArray(manifest.package?.artifacts) || manifest.package.artifacts.length !== requiredArtifacts.length) {
    throw new Error("Manual manifest lacks the packaged executable identities.");
  }
  const artifactMap = new Map(manifest.package.artifacts.map((item) => [normalize(item.path), item.sha256]));
  for (const artifactPath of requiredArtifacts) {
    const expected = artifactMap.get(artifactPath);
    if (!/^[a-f0-9]{64}$/u.test(expected ?? "")) throw new Error(`Manual manifest lacks ${artifactPath}.`);
    if (verifyPackageFiles && await sha256File(path.join(root, ...artifactPath.split("/"))) !== expected) {
      throw new Error(`Manual package hash is stale: ${artifactPath}.`);
    }
  }
  if (!Array.isArray(manifest.captures) || manifest.captures.length !== recoveryCaptureInventory.length) {
    throw new Error("Manual manifest capture count is incomplete.");
  }
  const resultCache = new Map();
  const captures = [];
  for (const inventory of recoveryCaptureInventory) {
    const evidence = manifest.captures.find((item) => item.label === inventory.label);
    if (evidence === undefined || evidence.title !== inventory.title || evidence.sourceResult !== inventory.sourceResult || evidence.screenshotPath !== inventory.screenshotPath) {
      throw new Error(`Manual capture metadata is stale or substituted: ${inventory.label}.`);
    }
    assertSafeRelative(evidence.path, `capture ${inventory.label}`);
    if (!resultCache.has(inventory.sourceResult)) resultCache.set(inventory.sourceResult, await readResult(root, inventory.sourceResult));
    const { result, actionLog } = resultCache.get(inventory.sourceResult);
    if (result.identity.gitCommit !== manifest.package.gitCommit || result.mode !== "packaged" || result.outcome !== "passed") {
      throw new Error(`Manual capture result is not a passing exact-package journey: ${inventory.label}.`);
    }
    if (result.errors.length !== 0) throw new Error(`Manual journey captured runtime errors: ${inventory.sourceResult}.`);
    for (const artifactPath of requiredArtifacts) {
      const resultHash = new Map(result.identity.artifacts.map((item) => [normalize(item.path), item.sha256])).get(artifactPath);
      if (resultHash !== artifactMap.get(artifactPath)) throw new Error(`Manual journey package identity diverged: ${inventory.sourceResult}.`);
    }
    const action = result.actions.find((candidate) => candidate.sequence === evidence.actionSequence);
    if (action?.kind !== "screenshot" || action.label !== evidence.actionLabel || normalize(action.screenshotPath ?? "") !== inventory.screenshotPath) {
      throw new Error(`Manual screenshot does not match its recorded visible action: ${inventory.label}.`);
    }
    if (!actionLog.includes(`Outcome: passed`) || !actionLog.includes(action.label)) {
      throw new Error(`Manual action log does not carry the screenshot action: ${inventory.label}.`);
    }
    const absolutePath = path.join(root, ...normalize(evidence.path).split("/"));
    const bytes = await readFile(absolutePath);
    const dimensions = pngDimensions(bytes);
    if (sha256(bytes) !== evidence.sha256 || dimensions.width !== evidence.width || dimensions.height !== evidence.height) {
      throw new Error(`Manual screenshot bytes do not match the manifest: ${inventory.label}.`);
    }
    if (dimensions.width < 300 || dimensions.height < 100 || (await stat(absolutePath)).size < 2_048) {
      throw new Error(`Manual screenshot is too small for review: ${inventory.label}.`);
    }
    captures.push({ ...evidence, absolutePath, bytes });
  }
  if (Number.isNaN(Date.parse(manifest.capturedAt ?? ""))) throw new Error("Manual manifest capturedAt is invalid.");
  return { manifest, captures, manifestPath };
}

async function readResult(root, relativePath) {
  assertSafeRelative(relativePath, "journey result");
  const absolutePath = path.join(root, ...normalize(relativePath).split("/"));
  const result = JSON.parse(await readFile(absolutePath, "utf8"));
  if (result?.mode !== "packaged" || result?.outcome !== "passed" || result?.profile?.kind !== "fresh-isolated") {
    throw new Error(`Manual source journey did not pass in a fresh packaged profile: ${relativePath}.`);
  }
  if (!Array.isArray(result.actions) || !Array.isArray(result.errors)) throw new Error(`Manual journey result is malformed: ${relativePath}.`);
  const actionLogPath = path.join(path.dirname(absolutePath), "action-log.md");
  return { result, actionLog: await readFile(actionLogPath, "utf8") };
}

function capture(label, title, sourceResult, screenshotPath) {
  return Object.freeze({ label, title, sourceResult, screenshotPath });
}

function assertSafeRelative(value, label) {
  const normalized = normalize(value);
  if (!normalized || normalized.startsWith("/") || normalized.startsWith("../") || normalized.includes("/../") || path.isAbsolute(value)) {
    throw new Error(`Unsafe ${label} path: ${value}.`);
  }
}

function normalize(value) {
  return String(value).replaceAll("\\", "/");
}

function pngDimensions(bytes) {
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    throw new Error("Manual capture is not a valid PNG.");
  }
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function sha256File(filePath) {
  return sha256(await readFile(filePath));
}
