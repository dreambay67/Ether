import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
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
    await baseline.input.pressKey("Control+S", "Save metadata baseline", "The Windows Save dialog persists the baseline before the copied fixture is corrupted.");
    await sendNativeSavePath(baselinePath);
    await expect.poll(async () => isFile(baselinePath)).toBe(true);
    await copyFile(baselinePath, corruptPath);
    const database = new DatabaseSync(corruptPath);
    try { database.exec("PRAGMA application_id = 1234"); } finally { database.close(); }
    const damagedHash = await sha256(corruptPath);
    await baseline.input.leftClick(baseline.page.getByRole("button", { name: "Open", exact: true }), "Open corrupt metadata copy", "The visible packaged Open command sends the copied corrupt document to the native picker.");
    await sendNativeSavePath(corruptPath);
    const nativeError = await readNativeErrorDialog(profile);
    expect(nativeError).toMatch(/unsupported|not an Ether|application/i);
    baseline.input.observe("Native unsupported metadata error", "The exact packaged browser process presents a clear native unsupported-document error for the corrupt copy.", nativeError);
    await baseline.input.screenshot("corrupt-metadata-unsupported.png", baseline.evidence, "Capture unsupported corrupt metadata", "The packaged app keeps the valid active baseline after the native unsupported-document error.");
    expect(await sha256(corruptPath)).toBe(damagedHash);
    await expect(baseline.page.getByTestId("project-header")).toContainText("UI-authored metadata baseline.ether");
    await baseline.close("passed");
    baseline = null;
    profile = undefined;
  } finally {
    if (baseline !== null) await baseline.close("failed");
    if (profile !== undefined) await cleanupIsolatedJourneyProfile(profile).catch(() => undefined);
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

async function sha256(filePath: string): Promise<string> {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

async function readNativeErrorDialog(profile: RecoveryJourneySession["profile"]): Promise<string> {
  const { execFile } = await import("node:child_process");
  const executable = path.join(workspaceRoot, "release", "windows", "win-unpacked", "Ether.exe").replaceAll("'", "''");
  const marker = profile.userData.replaceAll("'", "''");
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "Add-Type -AssemblyName UIAutomationClient",
    "$all = @(Get-CimInstance Win32_Process)",
    `$roots = @($all | Where-Object { [string]::Equals($_.ExecutablePath, '${executable}', [System.StringComparison]::OrdinalIgnoreCase) -and $_.CommandLine -like '*${marker}*' -and $_.CommandLine -notmatch '(?:^|\\s)--type(?:=|\\s)' })`,
    "if ($roots.Count -ne 1) { throw ('Expected one exact packaged browser process; found ' + $roots.Count) }",
    "$byProcess = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, [int]$roots[0].ProcessId)",
    "$byDialog = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ClassNameProperty, '#32770')",
    "$condition = New-Object System.Windows.Automation.AndCondition($byProcess, $byDialog)",
    "Start-Sleep -Milliseconds 500",
    "$dialogs = [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, $condition)",
    "if ($dialogs.Count -ne 1) { throw ('Expected one exact packaged native error dialog; found ' + $dialogs.Count) }",
    "$dialog = $dialogs[0]",
    "$text = @($dialog.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition) | ForEach-Object { $_.Current.Name } | Where-Object { $_ }) -join ' '",
    "$ok = $dialog.FindFirst([System.Windows.Automation.TreeScope]::Descendants, (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, 'OK')))",
    "if ($null -eq $ok) { throw 'Native error dialog has no OK button.' }",
    "([System.Windows.Automation.InvokePattern]$ok.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)).Invoke()",
    "$text"
  ].join("; ");
  return await new Promise<string>((resolve, reject) => execFile("powershell.exe", ["-NoProfile", "-Sta", "-Command", script], { windowsHide: true }, (error, stdout) => error === null ? resolve(stdout.trim()) : reject(error)));
}
