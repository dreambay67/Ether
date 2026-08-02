import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";
import { FakeImageProvider } from "@ether/providers";

import { DesktopApplicationService } from "../../../../apps/desktop/src/main/services/applicationService.js";
import { writeRecoveryJournal } from "@ether/document";
import {
  blankAuthoringJourney,
  cleanupIsolatedJourneyProfile,
  launchRecoveryJourney,
  packagedJourneyConfig,
  type RecoveryJourneySession
} from "../../recovery/journeyDriver.js";

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
    await baseline.input.pressKey("Control+S", "Save packaged recovery baseline", "The Windows Save dialog persists the UI-authored `.ether` baseline.");
    await sendNativeSavePath(documentPath);
    await expect.poll(async () => isFile(documentPath)).toBe(true);
    await baseline.close("passed");

    await stageProviderRecoveryFixture(documentPath, baseline.profile.userData);
    recovered = await launchPackaged("visible-recovery-provider", documentPath, recoveryProfile);
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

async function launchPackaged(journeyId: string, documentPath?: string, profile?: RecoveryJourneySession["profile"]): Promise<RecoveryJourneySession> {
  return launchRecoveryJourney({
    ...packagedJourneyConfig(workspaceRoot, journeyId),
    evidenceMode: "ephemeral",
    declaration: blankAuthoringJourney(journeyId),
    ...(profile === undefined ? { cleanupProfile: false } : { profile, cleanupProfile: true }),
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

async function sendNativeSavePath(destination: string): Promise<void> {
  const { execFile } = await import("node:child_process");
  await new Promise<void>((resolve, reject) => execFile("powershell.exe", ["-NoProfile", "-Sta", "-Command", `Add-Type -AssemblyName System.Windows.Forms; Start-Sleep -Milliseconds 500; [System.Windows.Forms.SendKeys]::SendWait('^a'); [System.Windows.Forms.SendKeys]::SendWait('${destination.replaceAll("'", "''")}'); [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')`], { windowsHide: true }, (error) => error === null ? resolve() : reject(error)));
}

async function isFile(filePath: string): Promise<boolean> {
  try { return (await stat(filePath)).isFile(); } catch { return false; }
}
