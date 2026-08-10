import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { expect, test, type Page } from "@playwright/test";

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
import {
  completeNativeFileDialogWithUia,
  findExactPackagedProcessId,
  invokeExactOwnedNativeButtonWithUia
} from "../../recovery/windowsIntegration.js";

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
    recoveryProfile = first.profile;
    const { page, input, evidence } = first;
    await expect(page.getByTestId("document-canvas")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".react-flow__node")).toHaveCount(0);

    await input.leftClick(
      page.getByRole("button", { name: "Add Prompt", exact: true }),
      "Create the first graph node on the blank canvas",
      "A Prompt node is created only through the visible authoring UI."
    );
    await expect(page.locator(".react-flow__node")).toHaveCount(1);
    await input.screenshot("01-blank-ui-node.png", evidence, "Capture the UI-authored graph", "The first node is visibly authored from a blank document.");

    await input.pressKey("Control+s", "Save the untitled UI-authored document", "The native Save dialog writes one .ether document.");
    await completeNativeSaveIfNeeded(mode, first, firstPath);
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
    await completeNativeSaveIfNeeded(mode, first, renamedPath);
    await expect.poll(async () => isFile(renamedPath)).toBe(true);
    await expect(page.getByTestId("project-header")).toContainText("UI authored renamed.ether");

    await input.leftClick(page.getByRole("button", { name: "Save a copy", exact: true }), "Save a copy without switching", "A complete copy is created while the active title remains the Save As destination.");
    await completeNativeSaveIfNeeded(mode, first, copyPath);
    await expect.poll(async () => isFile(copyPath)).toBe(true);
    await expect(page.getByTestId("project-header")).toContainText("UI authored renamed.ether");

    await input.leftClick(page.getByRole("button", { name: "Compact document", exact: true }), "Compact the UI-authored document", "Compaction reports actual before and after sizes without invalidating the document.");
    await expect(page.getByText(/Compacted document: .* before, .* after; reclaimed/)).toBeVisible({ timeout: 15_000 });

    await input.leftClick(page.getByRole("button", { name: "Make document portable", exact: true }), "Make the UI-authored document portable", "The native confirmation completes a zero-reference portability check honestly.");
    await confirmPortableIfNeeded(mode, first);
    await expect(page.getByText(/Made portable: embedded 0 references \(0 B\); no missing references/)).toBeVisible({ timeout: 15_000 });
    await input.screenshot("02-saved-compact-portable.png", evidence, "Capture completed document actions", "Save As, Copy, Compact, and Portable actions have completed on the UI-authored document.");

    if (mode === "packaged") {
      const leaseRoot = path.join(first.profile.userData, "4.0", "leases");
      const leaseFiles = (await readdir(leaseRoot)).filter((name) => name.endsWith(".json"));
      expect(leaseFiles).toHaveLength(1);
      const leaseRecord = JSON.parse(await readFile(path.join(leaseRoot, leaseFiles[0]!), "utf8")) as { pid?: unknown; pathHash?: unknown };
      input.observe("Writer lease before contender", "The Save As destination retains one AppData writer lease before the competing process opens it.", `Observed one lease for PID ${String(leaseRecord.pid)} and path hash ${String(leaseRecord.pathHash)}.`);
      const contenderUserData = path.join(first.profile.root, "contender", "Ether-Recovery-Profile");
      const contenderAppData = path.join(contenderUserData, "4.0");
      await mkdir(contenderAppData, { recursive: true });
      await symlink(leaseRoot, path.join(contenderAppData, "leases"), "junction");
      contender = await launch(mode, "document-lifecycle-writer-lock", journeyRoot, renamedPath, {
        ...first.profile,
        userData: contenderUserData
      });
      await expect(contender.page.getByTestId("project-header")).toContainText("Read-only: another Ether window is editing this document");
      await expect(contender.page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
      contender.input.observe("Competing writer", "A second process opens the exact document read-only while the first process retains the writer lease.", "The competing Ether.exe displayed the writer-active read-only explanation and disabled Save.");
      await contender.input.screenshot("writer-lock-read-only.png", contender.evidence, "Capture the competing writer lock", "The second process cannot acquire writable access.");
      await contender.close("passed");
      contender = null;
    }

    const saveStateObservation = observeSavingThenSaved(page);
    await input.leftClick(
      page.getByRole("button", { name: "Add Image Generator", exact: true }),
      "Edit the saved document through the visible UI before a recovery restart",
      "A second node is committed and autosaved before the deliberate process kill."
    );
    await expect(page.locator(".react-flow__node")).toHaveCount(2);
    const saveTransitions = await saveStateObservation;
    expect(saveTransitions).toEqual(expect.arrayContaining(["Saving", "Saved"]));
    input.observe("Visible autosave transition", "The ordinary graph edit visibly transitions through Saving to Saved.", `Observed ${saveTransitions.join(" -> ")}.`);
    await hardKillLaunchedJourney(mode, first, journeyRoot);
    input.observe(
      "Hard-kill after UI edit/autosave",
      "The exact journey process exits without a clean close, leaving normal AppData recovery state for the next launch.",
      "The journey process was terminated only after the visible two-node graph returned to Saved."
    );
    await first.close("passed");
    first = null;
    await expect.poll(async () => isFile(renamedPath)).toBe(true);

    reopened = await launch(mode, "document-lifecycle-reopen", journeyRoot, renamedPath, recoveryProfile, false);
    await expect(reopened.page.getByTestId("document-canvas")).toBeVisible({ timeout: 30_000 });
    await expect(reopened.page.getByTestId("project-header")).toContainText("UI authored renamed.ether");
    await expect(reopened.page.locator(".react-flow__node")).toHaveCount(2);
    await expect(reopened.page.getByText("Saved", { exact: true })).toBeVisible();
    await expectWritableDocument(reopened);
    reopened.input.observe(
      "Hard-kill recovery reopen",
      "The hard-killed UI-authored .ether reclaims its dead same-machine writer lease and reopens writable without a stale recovery warning.",
      "The exact Save As destination reopened writable with both UI-authored nodes and Saved state."
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
    await expect.poll(async () => hasSQLiteSidecar(renamedPath), { timeout: 15_000 }).toBe(false);

    cleanReopened = await launch(mode, "document-lifecycle-clean-reopen", journeyRoot, renamedPath, recoveryProfile, true);
    await expect(cleanReopened.page.getByTestId("project-header")).toContainText("UI authored renamed.ether");
    await expect(cleanReopened.page.locator(".react-flow__node")).toHaveCount(2);
    await expectWritableDocument(cleanReopened);
    await cleanReopened.input.screenshot("04-clean-close-reopen.png", cleanReopened.evidence, "Capture the clean-close reopen", "The same user-saved document remains writable after an exact Windows UI Automation close.");
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

async function completeNativeSaveIfNeeded(mode: JourneyMode, session: RecoveryJourneySession, destination: string): Promise<void> {
  if (mode === "source-electron") return;
  await completeNativeFileDialogWithUia(await packagedProcessId(session), destination);
}

async function confirmPortableIfNeeded(mode: JourneyMode, session: RecoveryJourneySession): Promise<void> {
  if (mode === "source-electron") return;
  await invokeExactOwnedNativeButtonWithUia(await packagedProcessId(session), "Make Portable");
}

async function hardKillLaunchedJourney(mode: JourneyMode, session: RecoveryJourneySession, fixtureRoot: string): Promise<void> {
  const { executable, marker } = journeyProcessIdentity(mode, session, fixtureRoot);
  const escapedExecutable = executable.replaceAll("'", "''");
  const escapedMarker = marker.replaceAll("'", "''");
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$all = @(Get-CimInstance Win32_Process)",
    `$roots = @($all | Where-Object { [string]::Equals($_.ExecutablePath, '${escapedExecutable}', [System.StringComparison]::OrdinalIgnoreCase) -and $_.CommandLine -like '*${escapedMarker}*' -and $_.CommandLine -notmatch '(?:^|\\s)--type(?:=|\\s)' })`,
    "if ($roots.Count -ne 1) { throw ('Expected one exact journey root process for termination; found ' + $roots.Count) }",
    "$targetIds = [System.Collections.Generic.HashSet[int]]::new()",
    "function Add-JourneyProcessTree([int]$processId) { if (-not $targetIds.Add($processId)) { return }; foreach ($child in @($all | Where-Object { $_.ParentProcessId -eq $processId })) { Add-JourneyProcessTree ([int]$child.ProcessId) } }",
    "Add-JourneyProcessTree ([int]$roots[0].ProcessId)",
    "$targetIds | Sort-Object -Descending | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }",
    "Start-Sleep -Milliseconds 250",
    "$remaining = @(Get-CimInstance Win32_Process | Where-Object { $targetIds.Contains([int]$_.ProcessId) })",
    "if ($remaining.Count -ne 0) { throw ('Exact journey process tree did not exit: ' + ($remaining.ProcessId -join ',')) }"
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
    `$processes = @(Get-CimInstance Win32_Process | Where-Object { [string]::Equals($_.ExecutablePath, '${escapedExecutable}', [System.StringComparison]::OrdinalIgnoreCase) -and $_.CommandLine -like '*${escapedMarker}*' -and $_.CommandLine -notmatch '(?:^|\\s)--type(?:=|\\s)' })`,
    "if ($processes.Count -ne 1) { throw ('Expected one exact journey root for accessibility close; found ' + $processes.Count) }",
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

async function packagedProcessId(session: RecoveryJourneySession): Promise<number> {
  return findExactPackagedProcessId(
    path.join(workspaceRoot, "release", "windows", "win-unpacked", "Ether.exe"),
    session.profile.userData
  );
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

async function hasSQLiteSidecar(documentPath: string): Promise<boolean> {
  const sidecars = ["-journal", "-shm", "-wal"].map((suffix) => `${documentPath}${suffix}`);
  return (await Promise.all(sidecars.map(isFile))).some(Boolean);
}

async function observeSavingThenSaved(page: Page): Promise<string[]> {
  const indicator = page.locator(".document-save-state span");
  const transitions: string[] = [];
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const value = (await indicator.textContent())?.trim();
    if (value && transitions.at(-1) !== value) transitions.push(value);
    if (transitions.includes("Saving") && value === "Saved") return transitions;
    await page.waitForTimeout(25);
  }
  throw new Error(`Autosave did not visibly transition through Saving to Saved: ${transitions.join(" -> ") || "no states"}.`);
}

async function expectWritableDocument(session: RecoveryJourneySession): Promise<void> {
  await expect(session.page.getByTestId("project-header")).not.toContainText("Read-only:");
  await expect(session.page.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
  await expect(session.page.getByText("Local document", { exact: true })).toBeVisible();
}

async function assertLifecycleSpecIsSafe(): Promise<void> {
  assertAuthoringJourneySourceSafety(await readFile(thisSource, "utf8"), "document lifecycle recovery spec");
}
