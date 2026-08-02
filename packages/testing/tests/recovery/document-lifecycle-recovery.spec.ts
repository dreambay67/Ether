import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { expect, test } from "@playwright/test";

import {
  assertAuthoringJourneySourceSafety,
  blankAuthoringJourney,
  cleanupIsolatedJourneyProfile,
  launchRecoveryJourney,
  packagedJourneyConfig,
  sourceElectronJourneyConfig,
  type JourneyMode,
  type RecoveryJourneySession
} from "../../recovery/journeyDriver.js";

const execFileAsync = promisify(execFile);
const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const thisSource = fileURLToPath(import.meta.url);

test.skip(process.platform !== "win32", "The recovery lifecycle journey operates Windows Electron only.");

test("records a blank-UI authored document through save, document actions, close, and exact reopen", async () => {
  await assertLifecycleSpecIsSafe();
  const mode = journeyMode();
  const journeyRoot = await mkdtemp(path.join(os.tmpdir(), "ether-lifecycle-recovery-"));
  const firstPath = path.join(journeyRoot, "UI authored document.ether");
  const renamedPath = path.join(journeyRoot, "UI authored renamed.ether");
  const copyPath = path.join(journeyRoot, "UI authored copy.ether");
  let first: RecoveryJourneySession | null = null;
  let reopened: RecoveryJourneySession | null = null;
  let cleanReopened: RecoveryJourneySession | null = null;
  let contender: RecoveryJourneySession | null = null;
  let recoveryProfile: RecoveryJourneySession["profile"] | undefined;

  try {
    first = await launch(mode, "document-lifecycle", journeyRoot, undefined);
    const { page, input, evidence } = first;
    await expect(page.getByTestId("document-canvas")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".react-flow__node")).toHaveCount(0);

    await input.leftClick(
      page.getByRole("button", { name: "Prompt", exact: true }),
      "Create the first graph node on the blank canvas",
      "A Prompt node is created only through the visible authoring UI."
    );
    await expect(page.locator(".react-flow__node")).toHaveCount(1);
    await input.screenshot("01-blank-ui-node.png", evidence, "Capture the UI-authored graph", "The first node is visibly authored from a blank document.");

    await input.pressKey("Control+S", "Save the untitled UI-authored document", "The native Save dialog writes one .ether document.");
    await completeNativeSaveIfNeeded(mode, firstPath);
    const ctrlSSaved = await waitForFile(firstPath, 1_000);
    input.observe(
      "Ctrl+S document save",
      "Ctrl+S opens the native Save dialog for an untitled document.",
      ctrlSSaved ? "The Ctrl+S route created the requested .ether file." : "No file appeared after the real Ctrl+S input."
    );
    expect(ctrlSSaved).toBe(true);
    await expect.poll(async () => isFile(firstPath)).toBe(true);
    await expect(page.getByTestId("project-header")).toContainText("UI authored document.ether");
    input.observe("Save result", "The UI-created graph is stored as one .ether file.", `Saved ${path.basename(firstPath)} after Ctrl+S.`);
    await input.leftClick(page.getByRole("button", { name: "Document History", exact: true }), "Inspect the manual save milestone", "Document History shows the Ctrl+S manual milestone as a reviewable record.");
    await expect(page.getByRole("dialog", { name: "Document History" })).toBeVisible();
    await expect(page.getByText("Manual milestone: Manual save", { exact: true })).toBeVisible();
    await input.screenshot("manual-save-history.png", evidence, "Capture the visible manual milestone", "The document history names the manual Ctrl+S milestone.");
    await input.leftClick(page.getByRole("button", { name: "Close Document History", exact: true }), "Close Document History", "The history review returns to the document canvas.");

    await input.leftClick(page.getByRole("button", { name: "Save as", exact: true }), "Save As to a second path", "The active document switches only after the new destination is complete.");
    await completeNativeSaveIfNeeded(mode, renamedPath);
    await expect.poll(async () => isFile(renamedPath)).toBe(true);
    await expect(page.getByTestId("project-header")).toContainText("UI authored renamed.ether");

    await input.leftClick(page.getByRole("button", { name: "Save a copy", exact: true }), "Save a copy without switching", "A complete copy is created while the active title remains the Save As destination.");
    await completeNativeSaveIfNeeded(mode, copyPath);
    await expect.poll(async () => isFile(copyPath)).toBe(true);
    await expect(page.getByTestId("project-header")).toContainText("UI authored renamed.ether");

    await input.leftClick(page.getByRole("button", { name: "Compact document", exact: true }), "Compact the UI-authored document", "Compaction reports actual before and after sizes without invalidating the document.");
    await expect(page.getByText(/Compacted document: .* before, .* after; reclaimed/)).toBeVisible({ timeout: 15_000 });

    await input.leftClick(page.getByRole("button", { name: "Make document portable", exact: true }), "Make the UI-authored document portable", "The native confirmation completes a zero-reference portability check honestly.");
    await confirmPortableIfNeeded(mode);
    await expect(page.getByText(/Made portable: embedded 0 references \(0 B\); no missing references/)).toBeVisible({ timeout: 15_000 });
    await input.screenshot("02-saved-compact-portable.png", evidence, "Capture completed document actions", "Save As, Copy, Compact, and Portable actions have completed on the UI-authored document.");

    if (mode === "packaged") {
      contender = await launch(mode, "document-lifecycle-writer-lock", journeyRoot, renamedPath, undefined, true);
      await expect(contender.page.getByTestId("project-header")).toContainText("Read-only: another Ether window is editing this document");
      await expect(contender.page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
      contender.input.observe("Competing writer", "A second process opens the exact document read-only while the first process retains the writer lease.", "The competing Ether.exe displayed the writer-active read-only explanation and disabled Save.");
      await contender.input.screenshot("writer-lock-read-only.png", contender.evidence, "Capture the competing writer lock", "The second process cannot acquire writable access.");
      await contender.close("passed");
      contender = null;
    }

    await input.leftClick(
      page.getByRole("button", { name: "Image", exact: true }),
      "Edit the saved document through the visible UI before a recovery restart",
      "A second node is committed and autosaved before the deliberate process kill."
    );
    await expect(page.locator(".react-flow__node")).toHaveCount(2);
    await page.waitForTimeout(2_000);
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    await hardKillLaunchedJourney(mode, first, journeyRoot);
    input.observe(
      "Hard-kill after UI edit/autosave",
      "The exact journey process exits without a clean close, leaving normal AppData recovery state for the next launch.",
      "The journey process was terminated only after the visible two-node graph returned to Saved."
    );
    recoveryProfile = first.profile;
    await first.close("passed");
    first = null;
    await expect.poll(async () => isFile(renamedPath)).toBe(true);

    reopened = await launch(mode, "document-lifecycle-reopen", journeyRoot, renamedPath, recoveryProfile, false);
    await expect(reopened.page.getByTestId("document-canvas")).toBeVisible({ timeout: 30_000 });
    await expect(reopened.page.getByTestId("project-header")).toContainText("UI authored renamed.ether");
    await expect(reopened.page.locator(".react-flow__node")).toHaveCount(2);
    await expect(reopened.page.getByText("Saved", { exact: true })).toBeVisible();
    reopened.input.observe(
      "Close/reopen recovery check",
      "A cleanly closed UI-authored .ether reopens writable without a stale recovery warning.",
      "The exact Save As destination reopened with both UI-authored nodes and Saved state."
    );
    await reopened.input.screenshot("03-reopened-ui-authored-document.png", reopened.evidence, "Capture the exact reopened document", "The graph comes from the ordinary Save/Save As journey, not a recovery fixture.");
    reopened.input.observe(
      "Windows accessibility close",
      "A Windows UI Automation close action drains the Saved document without an unsaved-changes prompt.",
      "The exact owned Ether window will be closed through its UI Automation WindowPattern."
    );
    await closeWithWindowsAccessibility(mode, reopened, journeyRoot);
    await expect.poll(() => reopened?.page.isClosed() ?? false, { timeout: 15_000 }).toBe(true);
    expect(reopened.recorder.snapshot().errors).toEqual([]);
    await reopened.close("passed");
    reopened = null;

    cleanReopened = await launch(mode, "document-lifecycle-clean-reopen", journeyRoot, renamedPath, recoveryProfile, true);
    await expect(cleanReopened.page.getByTestId("project-header")).toContainText("UI authored renamed.ether");
    await expect(cleanReopened.page.locator(".react-flow__node")).toHaveCount(2);
    await cleanReopened.input.screenshot("04-clean-close-reopen.png", cleanReopened.evidence, "Capture the clean-close reopen", "The same user-saved document remains writable after a real Alt+F4 close.");
    await cleanReopened.close("passed");
    cleanReopened = null;

    for (const documentPath of [firstPath, renamedPath, copyPath]) {
      expect((await stat(documentPath)).size).toBeGreaterThan(0);
    }
  } finally {
    if (first !== null) await first.close("failed");
    if (reopened !== null) await reopened.close("failed");
    if (cleanReopened !== null) await cleanReopened.close("failed");
    if (contender !== null) await contender.close("failed");
    if (recoveryProfile !== undefined) await cleanupIsolatedJourneyProfile(recoveryProfile).catch(() => undefined);
    await rm(journeyRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  }
});

async function launch(
  mode: JourneyMode,
  journeyId: string,
  fixtureRoot: string,
  reopenPath: string | undefined,
  profile?: RecoveryJourneySession["profile"],
  cleanupProfile = false
): Promise<RecoveryJourneySession> {
  const base = mode === "source-electron"
    ? sourceElectronJourneyConfig(workspaceRoot, journeyId)
    : packagedJourneyConfig(workspaceRoot, journeyId);
  return launchRecoveryJourney({
    ...base,
    evidenceMode: "committed",
    committedEvidencePath: ["phase-0", "document-lifecycle", journeyId],
    declaration: blankAuthoringJourney(journeyId),
    ...(profile === undefined ? { cleanupProfile } : { profile, cleanupProfile }),
    ...(mode === "source-electron" ? {
      sourceEntrypoint: path.join(workspaceRoot, "packages", "testing", "fixtures", "desktop-main.mjs"),
      sourceArgs: () => [
        `--fixture-root=${fixtureRoot}`,
        `--save-path=${path.join(fixtureRoot, "UI authored document.ether")}`,
        `--save-path=${path.join(fixtureRoot, "UI authored renamed.ether")}`,
        `--save-path=${path.join(fixtureRoot, "UI authored copy.ether")}`,
        ...(reopenPath === undefined ? [] : [`--open-document=${reopenPath}`])
      ]
    } : {
      packagedArgs: () => reopenPath === undefined ? [] : [reopenPath]
    })
  });
}

function journeyMode(): JourneyMode {
  const mode = process.env.ETHER_DOCUMENT_LIFECYCLE_MODE;
  if (mode === "source-electron" || mode === "packaged") return mode;
  throw new Error("Set ETHER_DOCUMENT_LIFECYCLE_MODE to source-electron or packaged.");
}

async function completeNativeSaveIfNeeded(mode: JourneyMode, destination: string): Promise<void> {
  if (mode === "source-electron") return;
  await sendNativeKeys(["^a", destination, "{ENTER}"]);
}

async function confirmPortableIfNeeded(mode: JourneyMode): Promise<void> {
  if (mode === "source-electron") return;
  await sendNativeKeys(["{ENTER}"]);
}

async function hardKillLaunchedJourney(mode: JourneyMode, session: RecoveryJourneySession, fixtureRoot: string): Promise<void> {
  const { executable, marker } = journeyProcessIdentity(mode, session, fixtureRoot);
  const escapedExecutable = executable.replaceAll("'", "''");
  const escapedMarker = marker.replaceAll("'", "''");
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `$processes = Get-CimInstance Win32_Process | Where-Object { [string]::Equals($_.ExecutablePath, '${escapedExecutable}', [System.StringComparison]::OrdinalIgnoreCase) -and $_.CommandLine -like '*${escapedMarker}*' }`,
    "if ($processes.Count -eq 0) { throw 'No exact journey process was found for termination.' }",
    "$processes | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"
  ].join("; ");
  await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true });
  await session.page.waitForTimeout(500).catch(() => undefined);
}

function journeyProcessIdentity(mode: JourneyMode, session: RecoveryJourneySession, fixtureRoot: string) {
  return {
    executable: mode === "packaged"
      ? path.join(workspaceRoot, "release", "windows", "win-unpacked", "Ether.exe")
      : path.join(workspaceRoot, "node_modules", "electron", "dist", "electron.exe"),
    marker: mode === "packaged" ? session.profile.userData : fixtureRoot
  };
}

async function closeWithWindowsAccessibility(mode: JourneyMode, session: RecoveryJourneySession, fixtureRoot: string): Promise<void> {
  const { executable, marker } = journeyProcessIdentity(mode, session, fixtureRoot);
  const escapedExecutable = executable.replaceAll("'", "''");
  const escapedMarker = marker.replaceAll("'", "''");
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `$processes = Get-CimInstance Win32_Process | Where-Object { [string]::Equals($_.ExecutablePath, '${escapedExecutable}', [System.StringComparison]::OrdinalIgnoreCase) -and $_.CommandLine -like '*${escapedMarker}*' }`,
    "if ($processes.Count -eq 0) { throw 'No exact journey process was found for accessibility close.' }",
    "Add-Type -AssemblyName UIAutomationClient",
    "$condition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, [int]$processes[0].ProcessId)",
    "$windows = [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, $condition)",
    "if ($windows.Count -ne 1) { throw ('Expected one exact journey top-level window; found ' + $windows.Count) }",
    "$pattern = $windows[0].GetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern)",
    "if ($null -eq $pattern) { throw 'The exact journey window has no UI Automation WindowPattern.' }",
    "$pattern.Close()"
  ].join("; ");
  await execFileAsync("powershell.exe", ["-NoProfile", "-Sta", "-Command", script], { windowsHide: true });
}

async function sendNativeKeys(keys: readonly string[]): Promise<void> {
  const commands = keys.map((keysToSend) => `[System.Windows.Forms.SendKeys]::SendWait('${escapeSendKeys(keysToSend)}')`).join("; ");
  const script = `Add-Type -AssemblyName System.Windows.Forms; Start-Sleep -Milliseconds 500; ${commands}`;
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  await execFileAsync("powershell.exe", ["-NoProfile", "-Sta", "-EncodedCommand", encoded], { windowsHide: true });
}

function escapeSendKeys(value: string): string {
  return value.replaceAll("'", "''");
}

async function isFile(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

async function waitForFile(filePath: string, timeoutMs: number): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await isFile(filePath)) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return isFile(filePath);
}

async function assertLifecycleSpecIsSafe(): Promise<void> {
  assertAuthoringJourneySourceSafety(await readFile(thisSource, "utf8"), "document lifecycle recovery spec");
}
