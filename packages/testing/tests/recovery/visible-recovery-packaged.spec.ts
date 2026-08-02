import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";
import { FakeImageProvider } from "@ether/providers";

import { DesktopApplicationService } from "../../../../apps/desktop/src/main/services/applicationService.js";
import { DocumentStore, writeRecoveryJournal } from "@ether/document";
import {
  blankAuthoringJourney,
  cleanupIsolatedJourneyProfile,
  launchRecoveryJourney,
  packagedJourneyConfig,
  type RecoveryJourneySession
} from "../../recovery/journeyDriver.js";
import {
  completeNativeFileDialogWithUia,
  findExactPackagedProcessId,
  openExactWindowWithNativeKeyboard,
  readAndCloseExactOwnedNativeDialogWithUia
} from "../../recovery/windowsIntegration.js";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl5oKAAAAAASUVORK5CYII=", "base64");

test.skip(process.platform !== "win32", "Visible recovery P journeys operate the packaged Windows Ether.exe only.");

test("shows a staged fake-provider completion as a review-required Recovery revision", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ether-visible-recovery-"));
  const documentPath = path.join(root, "UI-authored recovery baseline.ether");
  let baseline: RecoveryJourneySession | null = null;
  let recovered: RecoveryJourneySession | null = null;
  let recoveryProfile: RecoveryJourneySession["profile"] | undefined;

  try {
    baseline = await launchPackaged("visible-recovery-provider-baseline");
    recoveryProfile = baseline.profile;
    await expect(baseline.page.getByTestId("document-canvas")).toBeVisible({ timeout: 30_000 });
    await baseline.input.leftClick(baseline.page.getByRole("button", { name: "Prompt", exact: true }), "Create baseline graph", "The recovery document starts as a blank graph authored through packaged UI.");
    await baseline.input.pressKey("Control+s", "Save packaged recovery baseline", "The Windows Save dialog persists the UI-authored `.ether` baseline.");
    await completeNativeFileDialogWithUia(await exactPackagedPid(baseline), documentPath);
    await expect.poll(async () => isFile(documentPath)).toBe(true);
    await baseline.close("passed");

    await stageProviderRecoveryFixture(documentPath, baseline.profile.userData);
    recovered = await launchPackaged("visible-recovery-provider", documentPath, recoveryProfile, true);
    baseline = null;
    await expect(recovered.page.getByTestId("document-canvas")).toBeVisible({ timeout: 30_000 });
    await recovered.input.leftClick(recovered.page.getByRole("button", { name: "Document History", exact: true }), "Inspect recovered revision", "Recovery is visibly reviewable rather than silently applied.");
    await expect(recovered.page.getByRole("dialog", { name: "Document History" })).toBeVisible();
    await expect(recovered.page.getByText("Recovery revision", { exact: true })).toBeVisible();
    await expect(recovered.page.getByText("Recovered · review required", { exact: true })).toBeVisible();
    await recovered.input.screenshot("recovery-revision-review-required.png", recovered.evidence, "Capture visible provider recovery", "Document History identifies the staged provider output as recovery work requiring review.");
    await recovered.close("passed");
    recovered = null;
    recoveryProfile = undefined;
  } finally {
    if (baseline !== null) await baseline.close("failed");
    if (recovered !== null) await recovered.close("failed");
    if (recoveryProfile !== undefined) await cleanupIsolatedJourneyProfile(recoveryProfile).catch(() => undefined);
    await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  }
});

test("keeps a deliberately corrupted metadata copy unchanged while the packaged app reports it unsupported", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ether-visible-corrupt-metadata-"));
  const baselinePath = path.join(root, "UI-authored metadata baseline.ether");
  const corruptPath = path.join(root, "UI-authored metadata corrupt.ether");
  let baseline: RecoveryJourneySession | null = null;
  let profile: RecoveryJourneySession["profile"] | undefined;
  try {
    baseline = await launchPackaged("visible-recovery-metadata-baseline");
    profile = baseline.profile;
    await expect(baseline.page.getByTestId("document-canvas")).toBeVisible({ timeout: 30_000 });
    await baseline.input.leftClick(baseline.page.getByRole("button", { name: "Prompt", exact: true }), "Create metadata baseline", "The corrupt-metadata fixture begins with a packaged UI-authored document.");
    await baseline.input.pressKey("Control+s", "Save metadata baseline", "The Windows Save dialog persists the baseline before the copied fixture is corrupted.");
    const ownerPid = await exactPackagedPid(baseline);
    await completeNativeFileDialogWithUia(ownerPid, baselinePath);
    await expect.poll(async () => isFile(baselinePath)).toBe(true);
    await copyFile(baselinePath, corruptPath);
    const database = new DatabaseSync(corruptPath);
    try { database.exec("PRAGMA application_id = 1234"); } finally { database.close(); }
    const damagedHash = await sha256(corruptPath);
    const openAction = await openExactWindowWithNativeKeyboard(ownerPid);
    baseline.input.observe("Open corrupt metadata copy", "A native Ctrl+O sent to the exact packaged Ether window opens the document picker.", openAction);
    await completeNativeFileDialogWithUia(ownerPid, corruptPath);
    const nativeError = await readAndCloseExactOwnedNativeDialogWithUia(ownerPid);
    expect(nativeError).toMatch(/unsupported|not an Ether|application/i);
    baseline.input.observe("Native unsupported metadata error", "The exact packaged browser process presents a clear native unsupported-document error for the corrupt copy.", nativeError);
    await baseline.input.screenshot("corrupt-metadata-unsupported.png", baseline.evidence, "Capture unsupported corrupt metadata", "The packaged app keeps the valid active baseline after the native unsupported-document error.");
    expect(await sha256(corruptPath)).toBe(damagedHash);
    await expect(baseline.page.getByTestId("project-header")).toContainText("UI-authored metadata baseline.ether");
    await baseline.close("passed");
    baseline = null;
  } finally {
    if (baseline !== null) await baseline.close("failed");
    if (profile !== undefined) await cleanupIsolatedJourneyProfile(profile).catch(() => undefined);
    await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  }
});

test("repairs a copied media-corrupt document through the visible packaged lossy-repair flow", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ether-visible-media-repair-"));
  const baselinePath = path.join(root, "UI-authored artifact baseline.ether");
  const damagedPath = path.join(root, "UI-authored media corrupt.ether");
  const repairedPath = path.join(root, "UI-authored media repaired.ether");
  let baseline: RecoveryJourneySession | null = null;
  let artifactPreview: RecoveryJourneySession | null = null;
  let repair: RecoveryJourneySession | null = null;
  let profile: RecoveryJourneySession["profile"] | undefined;
  try {
    baseline = await launchPackaged("visible-recovery-media-baseline");
    profile = baseline.profile;
    await expect(baseline.page.getByTestId("document-canvas")).toBeVisible({ timeout: 30_000 });
    await baseline.input.leftClick(baseline.page.getByRole("button", { name: "Prompt", exact: true }), "Create media baseline", "The media-repair fixture begins with a packaged UI-authored graph.");
    await baseline.input.pressKey("Control+s", "Save media baseline", "The Windows Save dialog persists the visible baseline before its copied fixture is damaged.");
    await completeNativeFileDialogWithUia(await exactPackagedPid(baseline), baselinePath);
    await expect.poll(async () => isFile(baselinePath)).toBe(true);
    await baseline.close("passed");
    baseline = null;
    const contentKey = await createFakeArtifactFixture(baselinePath, profile.userData);
    artifactPreview = await launchPackaged("visible-recovery-artifact-baseline", baselinePath, profile, false);
    await expect(artifactPreview.page.getByTestId("document-canvas")).toBeVisible({ timeout: 30_000 });
    await artifactPreview.input.leftClick(artifactPreview.page.getByRole("button", { name: "Artifacts", exact: true }), "Open visible artifact baseline", "The packaged UI visibly opens the artifact-bearing baseline before a copied fixture is corrupted.");
    await expect(artifactPreview.page.getByRole("region", { name: "Reference Desk" })).toBeVisible();
    await artifactPreview.input.leftClick(artifactPreview.page.getByRole("button", { name: "Review", exact: true }), "Open artifact review", "The visible Review workspace exposes the embedded fake-provider artifact.");
    await expect(artifactPreview.page.getByTestId("artifact-observatory")).toBeVisible();
    await expect(artifactPreview.page.getByTestId("artifact-card")).toHaveCount(1);
    await artifactPreview.input.screenshot("artifact-bearing-baseline.png", artifactPreview.evidence, "Capture artifact-bearing baseline", "A fake-provider artifact is visibly present in the valid packaged baseline.");
    await artifactPreview.close("passed");
    artifactPreview = null;
    await copyFile(baselinePath, damagedPath);
    const corrupt = new DatabaseSync(damagedPath);
    try { corrupt.prepare("UPDATE blob_chunks SET data = ? WHERE content_key = ? AND chunk_index = 0").run(Buffer.from("corrupt-media"), contentKey); } finally { corrupt.close(); }
    const damagedHash = await sha256(damagedPath);

    repair = await launchPackaged("visible-recovery-media-repair", undefined, profile, true);
    await expect(repair.page.getByTestId("document-canvas")).toBeVisible({ timeout: 30_000 });
    await repair.input.leftClick(repair.page.getByRole("button", { name: "Repair damaged document", exact: true }), "Begin repair", "The persistent Repair command opens native source and destination selection for the damaged copied document.");
    const executable = path.join(workspaceRoot, "release", "windows", "win-unpacked", "Ether.exe");
    const ownerPid = await findExactPackagedProcessId(executable, profile.userData);
    await completeNativeFileDialogWithUia(ownerPid, damagedPath);
    await completeNativeFileDialogWithUia(ownerPid, repairedPath);
    await expect(repair.page.getByRole("dialog", { name: "Review repair losses" })).toBeVisible({ timeout: 30_000 });
    await expect(repair.page.getByRole("heading", { name: "Media and artifact losses" })).toBeVisible();
    await expect(repair.page.getByRole("heading", { name: "Graph losses" })).toBeVisible();
    await repair.input.screenshot("media-repair-preview.png", repair.evidence, "Capture distinct repair loss classes", "The strict preview names media/artifact losses separately from graph losses before any lossy output is created.");
    await repair.input.leftClick(repair.page.getByRole("button", { name: "Create partial repaired copy", exact: true }), "Confirm lossy repair", "The user explicitly confirms the reviewable lossy repair.");
    await expect(repair.page.getByRole("dialog", { name: "Repair report" })).toBeVisible({ timeout: 30_000 });
    await expect(repair.page.getByText("Ether created a new repaired document. The damaged source was left unchanged.", { exact: true })).toBeVisible();
    await repair.input.screenshot("media-repair-completed.png", repair.evidence, "Capture completed repair report", "The completed path-free report confirms a new repaired document and an unchanged damaged source.");
    expect(await sha256(damagedPath)).toBe(damagedHash);
    expect(await isFile(repairedPath)).toBe(true);
    const [damaged, repaired] = await Promise.all([
      DocumentStore.open(damagedPath, { access: "read-only" }),
      DocumentStore.open(repairedPath, { access: "read-only" })
    ]);
    try {
      expect(repaired.documentId).not.toBe(damaged.documentId);
    } finally {
      await Promise.all([damaged.close(), repaired.close()]);
    }
    await repair.close("passed");
    repair = null;
    profile = undefined;
  } finally {
    if (baseline !== null) await baseline.close("failed");
    if (artifactPreview !== null) await artifactPreview.close("failed");
    if (repair !== null) await repair.close("failed");
    if (profile !== undefined) await cleanupIsolatedJourneyProfile(profile).catch(() => undefined);
    await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  }
});

async function launchPackaged(journeyId: string, documentPath?: string, profile?: RecoveryJourneySession["profile"], cleanupProfile = false): Promise<RecoveryJourneySession> {
  return launchRecoveryJourney({
    ...packagedJourneyConfig(workspaceRoot, journeyId),
    evidenceMode: "committed",
    committedEvidencePath: ["phase-0", "visible-recovery", journeyId],
    declaration: blankAuthoringJourney(journeyId),
    ...(profile === undefined ? { cleanupProfile } : { profile, cleanupProfile }),
    packagedArgs: () => documentPath === undefined ? [] : [documentPath]
  });
}

async function stageProviderRecoveryFixture(documentPath: string, userData: string): Promise<void> {
  const appDataRoot = path.join(userData, "4.0");
  const service = new DesktopApplicationService({
    appDataRoot,
    appVersion: "4.0.0-visible-recovery-fixture",
    dialogs: {
      openDocument: async () => null,
      saveDocument: async () => null,
      locateReference: async () => null,
      searchReferenceFolder: async () => null,
      confirmPortable: async () => true
    },
    provider: new FakeImageProvider(),
    simulationMode: true
  });
  try {
    const opened = await service.openPath(documentPath);
    // This separate recovery fixture adds only the minimal local fake-provider
    // provenance needed to validate the staged recovery artifact. The visible
    // UI baseline above remains the proof for the ordinary save/reopen path;
    // the recovery journal below describes a distinct, unimported output.
    await service.generateFakeArtifact(opened.documentId);
    const seed = (await service.searchArtifacts(opened.documentId, ""))[0];
    if (seed === undefined) throw new Error("Fake provider fixture did not create an artifact provenance record.");
    const { byteLength: _byteLength, contentKey: _contentKey, ...artifact } = seed;
    const recoveryId = `visible-provider-${randomUUID()}`;
    const stagedPath = path.join(appDataRoot, "staging", "provider", recoveryId, "recovered.png");
    await mkdir(path.dirname(stagedPath), { recursive: true });
    await writeFile(stagedPath, png, { flag: "wx" });
    const now = new Date().toISOString();
    writeRecoveryJournal({
      appDataRoot,
      entry: {
        id: recoveryId,
        kind: "provider-output",
        state: "staged",
        documentId: opened.documentId,
        documentPath,
        stagedPath,
        sourceName: "recovered.png",
        mediaType: "image/png",
        artifact: { ...artifact, id: `recovered-artifact-${randomUUID()}` },
        createdAt: now,
        updatedAt: now
      }
    });
  } finally {
    await service.close();
  }
}

async function createFakeArtifactFixture(documentPath: string, userData: string): Promise<string> {
  const service = new DesktopApplicationService({
    appDataRoot: path.join(userData, "4.0"),
    appVersion: "4.0.0-visible-repair-fixture",
    dialogs: { openDocument: async () => null, saveDocument: async () => null, locateReference: async () => null, searchReferenceFolder: async () => null, confirmPortable: async () => true },
    provider: new FakeImageProvider(),
    simulationMode: true
  });
  try {
    const opened = await service.openPath(documentPath);
    await service.generateFakeArtifact(opened.documentId);
    const artifact = (await service.searchArtifacts(opened.documentId, ""))[0];
    if (artifact === undefined) throw new Error("Fake provider fixture did not create an artifact to corrupt.");
    return artifact.contentKey;
  } finally {
    await service.close();
  }
}

async function exactPackagedPid(session: RecoveryJourneySession): Promise<number> {
  return findExactPackagedProcessId(
    path.join(workspaceRoot, "release", "windows", "win-unpacked", "Ether.exe"),
    session.profile.userData
  );
}

async function isFile(filePath: string): Promise<boolean> {
  try { return (await stat(filePath)).isFile(); } catch { return false; }
}

async function sha256(filePath: string): Promise<string> {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}
