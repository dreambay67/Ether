import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  RECOVERY_SHELL_IDENTITY_ARGUMENT,
  RECOVERY_SHELL_JOURNEY_ARGUMENT,
  RECOVERY_SHELL_JUMP_LIST_JOURNEY,
  RECOVERY_SHELL_RECENT_ARGUMENT,
  resolveRecoveryShellIdentity
} from "../../../apps/desktop/src/main/recoveryShellIdentity.js";
import { assertPackagedJourneyArgs, assertRecoveryShellRecentAdmission, packagedJourneyConfig } from "../recovery/journeyDriver.js";
import { removeRecoveryShellAutomaticDestinations } from "../recovery/windowsShellDestinations.js";

import {
  A02_WINDOWS_INTEGRATION_COVERAGE,
  A02_APPROVED_ROUTE,
  A02_APPROVED_ROUTES,
  A02_ROUTE_TITLES,
  ASSOCIATION_APPROVAL,
  ASSOCIATION_APPROVAL_VALUE,
  associationArtifactsMayBeCleaned,
  assertWindowsShellDeletionCandidatesAbsentAtS1,
  assertWindowsShellClassificationClean,
  assertWindowsShellCheckpointStable,
  assertWindowsShellMicroBaselineAfterRecycle,
  classifyWindowsShellStateChanges,
  classifyJumpListComProgress,
  classifyJumpListRecycleProgress,
  compareWindowsShellState,
  buildNativeExplorerDragScript,
  buildExplorerAssociationInvokeScript,
  a02ApprovalFreeListCommand,
  deriveWindowsShellDeletionCandidate,
  describeWindowsShellSetupDelta,
  ETHER_EXTENSION_KEY,
  SHELL_UI_APPROVAL,
  SHELL_UI_APPROVAL_VALUE,
  createWindowsIntegrationRoot,
  encodedPowerShellCommandLength,
  isAssociationMutationApproved,
  removeTestOwnedDisposableRoots,
  recoveryArtifactsMayBeCleanedAfterShellCheckpoint,
  requireNoTestOwnedRecentShortcuts,
  requireAssociationMutationApproval,
  requireAssociationRouteApproval,
  requireExplorerDragRouteApproval,
  requireJumpListRouteApproval,
  requireShellUiApproval,
  runAllDragRecoverySteps
} from "../recovery/windowsIntegration.js";

describe("A02 Windows integration harness contracts", () => {
  it("attempts every post-GO drag recovery proof after earlier failures", async () => {
    const attempts: string[] = [];
    const rejected = (name: string) => async () => {
      attempts.push(name);
      throw new Error(name);
    };
    const failures = await runAllDragRecoverySteps({
      awaitRetainedChildExit: rejected("child-exit"),
      drainStageWrites: rejected("stage-drain"),
      goPublished: true,
      independentRelease: rejected("independent-release"),
      latchTerminal: () => { attempts.push("terminal-latch"); throw new Error("terminal-latch"); },
      persistAbortRequested: rejected("abort-requested"),
      releaseWatchdog: rejected("watchdog-release-result"),
      terminateRetainedChild: rejected("child-termination")
    });
    expect(attempts).toEqual([
      "terminal-latch", "stage-drain", "abort-requested", "child-termination", "independent-release", "child-exit", "watchdog-release-result"
    ]);
    expect(failures).toHaveLength(7);
  });

  it("uses pre-GO watchdog cancellation but never invokes independent SendInput recovery", async () => {
    const attempts: string[] = [];
    const resolved = (name: string) => async () => { attempts.push(name); };
    await runAllDragRecoverySteps({
      awaitRetainedChildExit: resolved("child-exit"),
      cancelPreGoWatchdog: resolved("watchdog-cancel-exit-result"),
      drainStageWrites: resolved("stage-drain"),
      goPublished: false,
      independentRelease: resolved("independent-release"),
      latchTerminal: () => { attempts.push("terminal-latch"); },
      persistAbortRequested: resolved("abort-requested"),
      terminateRetainedChild: resolved("child-termination")
    });
    expect(attempts).toEqual([
      "terminal-latch", "stage-drain", "abort-requested", "child-termination", "child-exit", "watchdog-cancel-exit-result"
    ]);
  });

  it("keeps normal recovery journeys out of Recent and custom Jump List APIs", async () => {
    const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
    const [bootstrap, main, cleanup, driver, integrationSpec] = await Promise.all([
      readFile(path.join(repositoryRoot, "apps/desktop/src/main/bootstrap.ts"), "utf8"),
      readFile(path.join(repositoryRoot, "apps/desktop/src/main/main.ts"), "utf8"),
      readFile(path.join(repositoryRoot, "packages/testing/recovery/windowsShellDestinations.ts"), "utf8"),
      readFile(path.join(repositoryRoot, "packages/testing/recovery/journeyDriver.ts"), "utf8"),
      readFile(path.join(repositoryRoot, "packages/testing/tests/recovery/document-windows-integration.spec.ts"), "utf8")
    ]);
    expect(bootstrap).not.toMatch(/setJumpList|clearRecentDocuments/u);
    expect(main).toContain('if (recoveryShell === null || recoveryShell.recentEnabled) app.addRecentDocument(documentPath);');
    expect(main).toContain('if (!credentialOnly && recoveryShell === null) app.setJumpList([{ type: "recent" }]);');
    expect(main).not.toContain("clearRecentDocuments");
    expect(cleanup).toMatch(/12337d35-94c6-48a0-bce7-6a9c69d4d600/iu);
    expect(cleanup).toMatch(/86c14003-4d6b-4ef3-a7b4-0506663b2e68/iu);
    expect(cleanup).toMatch(/SetAppID\(appId\).*RemoveAllDestinations/su);
    expect(cleanup).not.toMatch(/SHAddToRecentDocs|setJumpList/u);
    const windowsIntegration = await readFile(path.join(repositoryRoot, "packages/testing/recovery/windowsIntegration.ts"), "utf8");
    expect(windowsIntegration).toContain("Refusing to delete an S1-pre-existing shortcut pathname");
    expect(windowsIntegration).toContain("Shortcut bytes or target changed before deletion");
    expect(windowsIntegration).toContain("Get-FileHash -LiteralPath $candidatePath -Algorithm SHA256");
    expect(windowsIntegration).toContain("recentShortcutDeletionScript");
    expect(windowsIntegration).toContain("assertWindowsShellDeletionCandidatesAbsentAtS1(input.s1");
    expect(windowsIntegration).toContain("Duplicate Recent deletion candidate was discovered");
    expect(windowsIntegration).toContain("Number.isSafeInteger(candidateSize)");
    expect(windowsIntegration).toContain("/^[a-f0-9]{64}$/iu");
    expect(windowsIntegration).not.toContain("$s1Paths");
    expect(windowsIntegration).not.toContain("s1Root.files.map((file) => file.path)");
    const powershell51SafeDocumentFolder = "$folder = [System.IO.Path]::GetDirectoryName($documentFullPath)";
    expect(windowsIntegration).not.toContain("Split-Path -LiteralPath $document -Parent");
    expect(windowsIntegration.split(powershell51SafeDocumentFolder)).toHaveLength(3);
    expect(driver).toContain("afterLaunchFailureApplicationExit");
    expect(integrationSpec).toContain("let exactProcessAbsenceProven = false");
    expect(integrationSpec.match(/afterLaunchFailureApplicationExit/g)?.length).toBeGreaterThanOrEqual(5);
    expect(integrationSpec).toContain("shell-finalization.json");
    expect(integrationSpec).toContain("assertExactPackagedBuildIdentity(identity)");
    expect(integrationSpec).toContain("recordShellFinalizationAttempt");
    expect(integrationSpec).toContain("recordShellFinalizationBlocked");
    expect(integrationSpec).toContain("Refusing shell sanitation without exact process-absence proof");
    expect(integrationSpec).toContain("ensureShellFinalizationSidecarDurable");
    expect(integrationSpec).toContain("durabilityFailureObserved");
    expect(integrationSpec).toContain("Shell finalization sidecar durability was not proven for this journey.");
    expect(integrationSpec).toContain("jumpTransitions");
    expect(integrationSpec).toContain("COM invocation #");
    expect(integrationSpec).toContain("Recycle invocation #");
    expect(integrationSpec).toContain("Shell sanitation and durable finalization evidence both failed");
  });

  it("uses Shell-derived Explorer display identity and exact selected-item paths", async () => {
    const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
    const windowsIntegration = await readFile(path.join(repositoryRoot, "packages/testing/recovery/windowsIntegration.ts"), "utf8");
    const explorerHelpers = windowsIntegration.slice(
      windowsIntegration.indexOf("export async function invokeDocumentFromExplorerWithUia"),
      windowsIntegration.indexOf("export async function invokeJumpListRecentDocumentWithUia")
    );
    const shellDisplayName = "$displayName = [string]$parsedDocument.Name; if ([string]::IsNullOrWhiteSpace($displayName))";
    const shellParsedPath = "$parsedPath = [string]$parsedDocument.Path; if (-not [string]::Equals($parsedPath, $documentFullPath, [System.StringComparison]::OrdinalIgnoreCase))";
    expect(explorerHelpers).not.toContain("NameProperty, $itemName");
    expect(explorerHelpers.split("$folderNamespace = $shell.NameSpace($folder)")).toHaveLength(3);
    expect(explorerHelpers.split("$parsedDocument = $folderNamespace.ParseName($documentLeaf)")).toHaveLength(3);
    expect(explorerHelpers.split(shellParsedPath)).toHaveLength(3);
    expect(explorerHelpers.split(shellDisplayName)).toHaveLength(3);
    expect(explorerHelpers).toContain("exactExplorerSelectionFunctionsScript()");
    expect(explorerHelpers).toContain("exactExplorerSelectedDocumentScript(\"Immediately before association Invoke\")");
    expect(explorerHelpers).toContain("exactExplorerSelectedDocumentScript(\"Before arranging drag window\")");
    expect(explorerHelpers).toContain("exactExplorerSelectedDocumentScript(\"After arranging drag window\")");
    expect(explorerHelpers).not.toContain("@($matchedWindow.Document.SelectedItems())");
    expect(explorerHelpers).toContain("$s = $matchedWindow.Document.SelectedItems()");
    expect(explorerHelpers).toContain("$s.Item(0).Path");
    expect(explorerHelpers).toContain("$selectionMatches = T");
    expect(explorerHelpers).toContain("return $null -ne $s -and $s.Count -eq 1");
    expect(explorerHelpers).toContain("Exact Explorer selected-item path mismatch");
    expect(windowsIntegration).toContain("const MAX_ENCODED_POWERSHELL_COMMAND_LENGTH = 30_000");
    expect(windowsIntegration).toContain("Buffer.byteLength(script, \"utf16le\")");
    expect(windowsIntegration).toContain("assertPowerShellEncodedCommandLength(script)");
  });

  it("keeps long recovery-path Explorer commands below the encoded-command margin", () => {
    const documentPath = "C:\\Users\\deny7\\AppData\\Local\\Temp\\ether-a02-windows-integration-123456\\Association 12345678 Žltý.ether";
    const associationScript = buildExplorerAssociationInvokeScript({ documentPath, etherPid: 1234 });
    const dragScript = buildNativeExplorerDragScript({
      documentPath,
      etherPid: 1234,
      target: { x: 960, y: 540 }
    });
    expect(encodedPowerShellCommandLength(associationScript)).toBeLessThanOrEqual(29_500);
    expect(encodedPowerShellCommandLength(dragScript)).toBeLessThanOrEqual(29_500);
    expect(dragScript).toContain("SetWindowPos($xh, [intptr]::Zero, $moveX, 0, 440, 520, 0x0054)");
    expect(dragScript).not.toContain("0x0040");
    const diagnosticDragScript = buildNativeExplorerDragScript({
      diagnostic: { armPath: "C:\\Temp\\drag.arm", deadlineEpochMs: Date.now() + 50_000, parentPid: process.pid, sidecarPath: "C:\\Temp\\drag.json", token: "0123456789abcdef0123456789abcdef" },
      documentPath,
      etherPid: 1234,
      target: { x: 960, y: 540 }
    });
    expect(encodedPowerShellCommandLength(diagnosticDragScript)).toBeLessThanOrEqual(30_000);
    for (const stage of ["m", "f", "h", "t", "u", "r", "v"]) {
      expect(diagnosticDragScript).toContain(`A02D|${stage}|`);
    }
    expect(diagnosticDragScript.indexOf("W; [EtherA02Pointer]::mouse_event(0x0002")).toBeGreaterThan(diagnosticDragScript.indexOf("Drag source actual cursor"));
    expect(diagnosticDragScript).toContain("Drag watchdog was not armed before native mouse-down");
  });

  it("keeps user-realistic Explorer focus proofs adjacent to native Enter and drag", () => {
    const associationScript = buildExplorerAssociationInvokeScript({
      documentPath: "C:\\Ether Recovery\\Association Žltý.ether",
      etherPid: 1234
    });
    const chromeClick = associationScript.indexOf("[EtherA02Native]::mouse_event(0x0002");
    const associationForeground = associationScript.indexOf("After association chrome click: exact Explorer HWND was not foreground", chromeClick);
    const associationSelection = associationScript.indexOf("A 'Immediately before association Enter'", associationForeground);
    const associationActionable = associationScript.indexOf("$pattern = $item.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)", associationSelection);
    const associationSetFocus = associationScript.indexOf("$item.SetFocus()", associationActionable);
    const associationMinimized = associationScript.indexOf("if (-not [EtherA02Native]::IsIconic($th))", associationSetFocus);
    const associationFinalForeground = associationScript.indexOf("Immediately before association Enter: exact Explorer HWND was not foreground", associationMinimized);
    const associationFinalKeyboardFocus = associationScript.indexOf("$item.Current.HasKeyboardFocus", associationFinalForeground);
    const associationFinalFocusedElement = associationScript.indexOf("[System.Windows.Automation.AutomationElement]::FocusedElement", associationFinalKeyboardFocus);
    const associationStarted = associationScript.indexOf("$as = [DateTime]::UtcNow", associationFinalFocusedElement);
    const associationEnter = associationScript.indexOf("[EtherA02Native]::keybd_event(0x0D,0,0", associationStarted);
    expect(chromeClick).toBeGreaterThanOrEqual(0);
    expect(associationForeground).toBeGreaterThan(chromeClick);
    expect(associationSelection).toBeGreaterThan(associationForeground);
    expect(associationActionable).toBeGreaterThan(associationSelection);
    expect(associationSetFocus).toBeGreaterThan(associationActionable);
    expect(associationMinimized).toBeGreaterThan(associationSelection);
    expect(associationFinalForeground).toBeGreaterThan(associationMinimized);
    expect(associationFinalKeyboardFocus).toBeGreaterThan(associationFinalForeground);
    expect(associationFinalFocusedElement).toBeGreaterThan(associationFinalKeyboardFocus);
    expect(associationStarted).toBeGreaterThan(associationFinalForeground);
    expect(associationEnter).toBeGreaterThan(associationStarted);
    expect(associationScript).toContain("$item.SetFocus()");
    expect(associationScript).toContain("$item.Current.HasKeyboardFocus");
    expect(associationScript).toContain("[System.Windows.Automation.AutomationElement]::FocusedElement");
    expect(associationScript).toContain("GetRuntimeId()");
    expect(associationScript).not.toContain("InvokePattern]$pattern).Invoke()");
    expect(associationScript).toContain("if ($rd) { [EtherA02Native]::keybd_event(0x0D,0,2");
    expect(associationScript).toContain("ClientToScreen($xh,[ref]$co)");
    expect(associationScript).toContain("$cx -ge $co.X");
    expect(associationScript).toContain("Association chrome: click is not non-client frame");
    expect(associationScript).toContain("$eb.Left + 2");
    expect(associationScript).toContain("GetCursorPos([ref]$cu)");
    expect(associationScript).toContain("if (-not [EtherA02Native]::SetCursorPos($cx,$cy))");
    expect(associationScript).toContain("if($cu.X -ne $cx -or $cu.Y -ne $cy){throw 'Association chrome: cursor readback mismatch'}");
    expect(associationScript).toContain("Association chrome actual cursor: WindowFromPoint root was not the exact expected HWND");
    expect(associationScript).toContain("SendMessage($xh,0x84");
    expect(associationScript).toContain("$hit -in 1,3,8,9,20");
    expect(associationScript).toContain("$hit -notin 10,11,12,13,14,15,16,17");

    const dragScript = buildNativeExplorerDragScript({
      documentPath: "C:\\Ether Recovery\\Explorer drag Žltý.ether",
      etherPid: 1234,
      target: { x: 960, y: 540 }
    });
    const cursorPositioned = dragScript.indexOf("[EtherA02Pointer]::SetCursorPos($sx,$sy)");
    const cursorSettled = dragScript.indexOf("Start-Sleep -Milliseconds 100", cursorPositioned);
    const sourceHit = dragScript.indexOf("Drag source: WindowFromPoint root was not the exact expected HWND", cursorSettled);
    const actualSourceHit = dragScript.indexOf("P $cursor.X $cursor.Y $sx $sy $xh 'Drag source actual cursor'", sourceHit);
    const dragStarted = dragScript.indexOf("$as = [DateTime]::UtcNow", actualSourceHit);
    const mouseDown = dragScript.indexOf("[EtherA02Pointer]::mouse_event(0x0002", dragStarted);
    const foregroundWhileHeld = dragScript.indexOf("Drag source foreground mismatch", mouseDown);
    const dragThreshold = dragScript.indexOf("MinimumHorizontalDragDistance + 1", foregroundWhileHeld);
    const thresholdMove = dragScript.indexOf("[EtherA02Pointer]::SetCursorPos(($sx + $dd),$sy)", dragThreshold);
    const targetHit = dragScript.indexOf("Drag target: WindowFromPoint root was not the exact expected HWND", thresholdMove);
    const actualThresholdHit = dragScript.indexOf("P $cursor.X $cursor.Y ($sx+$dd) $sy $xh 'Drag threshold actual cursor'", thresholdMove);
    const actualTargetHit = dragScript.indexOf("P $cursor.X $cursor.Y $tx $ty $th 'Drag target actual cursor'", targetHit);
    const mouseUp = dragScript.indexOf("[EtherA02Pointer]::mouse_event(0x0004", actualTargetHit);
    expect(cursorPositioned).toBeGreaterThanOrEqual(0);
    expect(cursorSettled).toBeGreaterThan(cursorPositioned);
    expect(sourceHit).toBeGreaterThan(cursorSettled);
    expect(actualSourceHit).toBeGreaterThan(sourceHit);
    expect(dragStarted).toBeGreaterThan(actualSourceHit);
    expect(mouseDown).toBeGreaterThan(dragStarted);
    expect(foregroundWhileHeld).toBeGreaterThan(mouseDown);
    expect(dragThreshold).toBeGreaterThan(foregroundWhileHeld);
    expect(thresholdMove).toBeGreaterThan(dragThreshold);
    expect(actualThresholdHit).toBeGreaterThan(thresholdMove);
    expect(targetHit).toBeGreaterThan(thresholdMove);
    expect(actualTargetHit).toBeGreaterThan(targetHit);
    expect(mouseUp).toBeGreaterThan(actualTargetHit);
    expect(dragScript).toContain("P $cursor.X $cursor.Y ($sx+$dd) $sy $xh 'Drag threshold actual cursor'");
    expect(dragScript).toContain("P $cursor.X $cursor.Y $tx $ty $th 'Drag target actual cursor'");
    expect(dragScript).toContain("function P($x,$y,$ex,$ey,$h,$g){if($x-ne$ex-or$y-ne$ey)");
    expect(dragScript).toContain("if (-not [EtherA02Pointer]::SetCursorPos($sx,$sy))");
    expect(dragScript).toContain("GetCursorPos([ref]$cursor)");
    expect(dragScript).toContain("Drag progression: cursor placement failed");
    expect(`${associationScript}\n${dragScript}`).not.toContain("SetForegroundWindow");
  });

  it("proves association and drag focus transitions inside their exact Explorer interactions", async () => {
    const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
    const [windowsIntegration, integrationSpec] = await Promise.all([
      readFile(path.join(repositoryRoot, "packages/testing/recovery/windowsIntegration.ts"), "utf8"),
      readFile(path.join(repositoryRoot, "packages/testing/tests/recovery/document-windows-integration.spec.ts"), "utf8")
    ]);
    const associationRoute = integrationSpec.slice(
      integrationSpec.indexOf("test(A02_ROUTE_TITLES.association"),
      integrationSpec.indexOf('test(A02_ROUTE_TITLES["explorer-drag"]')
    );
    const dragRoute = integrationSpec.slice(
      integrationSpec.indexOf('test(A02_ROUTE_TITLES["explorer-drag"]'),
      integrationSpec.indexOf('test(A02_ROUTE_TITLES["jump-list"]')
    );
    expect(windowsIntegration).toContain("exactEtherTopLevelWindowScript");
    expect(windowsIntegration).toContain("Enter:minimized");
    const explorerInteractions = windowsIntegration.slice(
      windowsIntegration.indexOf("export async function invokeDocumentFromExplorerWithUia"),
      windowsIntegration.indexOf("export async function invokeJumpListRecentDocumentWithUia")
    );
    expect(explorerInteractions).toContain("WindowFromPoint");
    expect(explorerInteractions).toContain("GetAncestor($hitHwnd, 2)");
    expect(explorerInteractions).not.toContain("SetForegroundWindow");
    expect(windowsIntegration).toContain("SWP_NOZORDER | SWP_NOACTIVATE | SWP_SHOWWINDOW");
    expect(windowsIntegration).toContain("exactEtherForegroundTransitionScript");
    expect(windowsIntegration).toContain("foreground did not transition from the exact Explorer HWND to the exact Ether HWND/PID");
    expect(windowsIntegration).toContain("sourceHwnd=");
    expect(windowsIntegration).toContain("targetHwnd=");
    expect(windowsIntegration).toContain("latencyMs=");
    expect(windowsIntegration).toContain("Exact Explorer HWND PID was zero");
    expect(windowsIntegration).not.toContain("GetWindowThreadProcessId([intptr]$window.HWND, [ref]$nativePid)");
    expect(windowsIntegration.split("$explorerPid = [int64]$nativePid")).toHaveLength(3);
    expect(windowsIntegration.split("if ($nativePid -eq 0) { throw 'Exact Explorer HWND PID was zero' }")).toHaveLength(3);
    expect(windowsIntegration).toContain("$foregroundExplorerPid = 0");
    expect(windowsIntegration).toContain("Explorer HWND PID mismatch immediately before action");
    expect(windowsIntegration).toContain("requireAssociationRouteApproval();");
    const dragRunner = windowsIntegration.slice(
      windowsIntegration.indexOf("async function runTrackedNativeExplorerDrag"),
      windowsIntegration.indexOf("type DragWatchdog")
    );
    const recoverySeam = windowsIntegration.slice(
      windowsIntegration.indexOf("export async function runAllDragRecoverySteps"),
      windowsIntegration.indexOf("function withDragRecoveryFailures")
    );
    const streamTracking = dragRunner.indexOf('child.stdout?.on("data"');
    const stderrTracking = dragRunner.indexOf('child.stderr?.on("data"');
    const exitTracking = dragRunner.indexOf("const exited = onceChildExit(child)");
    const prepared = dragRunner.indexOf('writeDragDiagnosticStage(input.diagnostic, "prepared"');
    const watchdogReady = windowsIntegration.indexOf("await assertWatchdogReady(watchdog)");
    const releaseArmed = windowsIntegration.indexOf('writeDragDiagnosticStage(input.diagnostic, "release-armed"', watchdogReady);
    const go = windowsIntegration.indexOf("writeTokenBoundDurableFile(input.diagnostic.armPath", releaseArmed);
    const terminalLatch = recoverySeam.indexOf("operations.latchTerminal()");
    const stageDrain = recoverySeam.indexOf('await attempt("stage drain"', terminalLatch);
    const abortPersisted = recoverySeam.indexOf('await attempt("durable abort-requested"', stageDrain);
    const retainedChildTermination = recoverySeam.indexOf('await attempt("retained child termination"', abortPersisted);
    const independentRelease = recoverySeam.indexOf('await attempt("independent release"', retainedChildTermination);
    const childExit = recoverySeam.indexOf('await attempt("retained child exit"', independentRelease);
    const watchdogProof = recoverySeam.indexOf('await attempt("watchdog release/result proof"', childExit);
    const preGoWatchdogProof = recoverySeam.indexOf('await attempt("pre-GO watchdog cancel/exit/result proof"', childExit);
    expect(streamTracking).toBeGreaterThanOrEqual(0);
    expect(stderrTracking).toBeGreaterThanOrEqual(0);
    expect(exitTracking).toBeGreaterThanOrEqual(0);
    expect(prepared).toBeGreaterThan(exitTracking);
    expect(prepared).toBeGreaterThan(streamTracking);
    expect(prepared).toBeGreaterThan(stderrTracking);
    expect(watchdogReady).toBeGreaterThanOrEqual(0);
    expect(releaseArmed).toBeGreaterThan(watchdogReady);
    expect(go).toBeGreaterThan(releaseArmed);
    expect(terminalLatch).toBeGreaterThanOrEqual(0);
    expect(stageDrain).toBeGreaterThan(terminalLatch);
    expect(abortPersisted).toBeGreaterThan(stageDrain);
    expect(retainedChildTermination).toBeGreaterThan(abortPersisted);
    expect(independentRelease).toBeGreaterThan(retainedChildTermination);
    expect(childExit).toBeGreaterThan(independentRelease);
    expect(watchdogProof).toBeGreaterThan(childExit);
    expect(preGoWatchdogProof).toBeGreaterThan(childExit);
    expect(recoverySeam).toContain("if (operations.goPublished) await attempt(\"independent release\"");
    expect(windowsIntegration).toContain("cancelled-pre-go");
    expect(windowsIntegration).toContain("child-dead-pre-go");
    expect(windowsIntegration).toContain("deadline-pre-go");
    expect(windowsIntegration).toContain('V $disarm \'cancel\'');
    expect(windowsIntegration).toContain("assertExactDragReleaseProof");
    expect(windowsIntegration).toContain("count !== 1");
    expect(windowsIntegration).toContain("(state & 0x8000) !== 0");
    expect(windowsIntegration).toContain("Drag watchdog GO token mismatch");
    expect(windowsIntegration).toContain("ConvertTo-Json -Compress");
    expect(windowsIntegration).toContain("deadlineEpochMs: sidecar.deadlineEpochMs");
    expect(associationRoute).toContain("invokeDocumentFromExplorerWithUia({ documentPath, etherPid: primaryPid })");
    expect(associationRoute).toContain('!routeIsExactly("association")');
    expect(dragRoute).toContain('!routeIsExactly("explorer-drag")');
    expect(dragRoute).toContain("dragDiagnosticsProven");
    expect(dragRoute.indexOf("const dragDiagnostic")).toBeGreaterThan(dragRoute.indexOf("const target = await nativeScreenPointForCanvas(session)"));
    expect(associationRoute).not.toContain("document.hasFocus()");
    expect(associationRoute).not.toContain("assertExactWindowForegroundWithUia(primaryPid)");
    expect(dragRoute).not.toContain("document.hasFocus()");
    expect(dragRoute).not.toContain("assertExactWindowForegroundWithUia(primaryPid)");
  });

  it("declares only representative packaged coverage and names the remaining Windows gaps", () => {
    expect(A02_WINDOWS_INTEGRATION_COVERAGE.packagedRepresentatives).toEqual(expect.arrayContaining([
      "AC-A02-010", "AC-A02-011", "AC-A02-013", "AC-A02-017", "AC-A02-019", "AC-A02-020", "AC-A02-026"
    ]));
    expect(A02_WINDOWS_INTEGRATION_COVERAGE.focusedAutomation).toHaveLength(14);
    expect(A02_WINDOWS_INTEGRATION_COVERAGE.knownPackagedGaps.join("\n")).toMatch(/drag\/drop|Jump List|removable-drive/iu);
    expect(ETHER_EXTENSION_KEY).toBe("HKCU\\Software\\Classes\\.ether");
  });

  it("requires explicit main-worker approval before any association mutation", () => {
    expect(isAssociationMutationApproved({})).toBe(false);
    expect(() => requireAssociationMutationApproval({})).toThrow(/dry-run only/u);
    expect(isAssociationMutationApproved({ [ASSOCIATION_APPROVAL]: ASSOCIATION_APPROVAL_VALUE })).toBe(true);
    expect(() => requireAssociationMutationApproval({ [ASSOCIATION_APPROVAL]: ASSOCIATION_APPROVAL_VALUE })).not.toThrow();
  });

  it("requires one exact case-sensitive route in addition to each route's approvals", () => {
    expect(A02_APPROVED_ROUTES).toEqual(["normal", "association", "explorer-drag", "jump-list"]);
    const allApprovals = {
      [ASSOCIATION_APPROVAL]: ASSOCIATION_APPROVAL_VALUE,
      [SHELL_UI_APPROVAL]: SHELL_UI_APPROVAL_VALUE
    };
    expect(() => requireAssociationRouteApproval(allApprovals)).toThrow(A02_APPROVED_ROUTE);
    expect(() => requireAssociationRouteApproval({ ...allApprovals, [A02_APPROVED_ROUTE]: "Association" })).toThrow(A02_APPROVED_ROUTE);
    expect(() => requireAssociationRouteApproval({ ...allApprovals, [A02_APPROVED_ROUTE]: "association" })).not.toThrow();
    expect(() => requireExplorerDragRouteApproval({ [A02_APPROVED_ROUTE]: "explorer-drag", [SHELL_UI_APPROVAL]: SHELL_UI_APPROVAL_VALUE })).not.toThrow();
    expect(() => requireExplorerDragRouteApproval({ ...allApprovals, [A02_APPROVED_ROUTE]: "association" })).toThrow(A02_APPROVED_ROUTE);
    expect(() => requireJumpListRouteApproval({ ...allApprovals, [A02_APPROVED_ROUTE]: "jump-list" })).not.toThrow();
  });

  it("publishes an approval-free, exact one-worker Playwright list command for every route", () => {
    for (const route of A02_APPROVED_ROUTES) {
      const command = a02ApprovalFreeListCommand(route);
      expect(command).toContain(`ETHER_A02_APPROVED_ROUTE=${route}`);
      expect(command).toContain(`--grep "^${A02_ROUTE_TITLES[route].replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}$"`);
      expect(command).toContain("--list --workers=1");
      expect(command).not.toContain(ASSOCIATION_APPROVAL);
      expect(command).not.toContain(SHELL_UI_APPROVAL);
    }
  });

  it("preserves association recovery artifacts unless no mutation was armed or restoration is proven", () => {
    expect(associationArtifactsMayBeCleaned({ mutationAttempted: false, watchdogActive: false, restorationProven: false })).toBe(true);
    expect(associationArtifactsMayBeCleaned({ mutationAttempted: false, watchdogActive: true, restorationProven: false })).toBe(false);
    expect(associationArtifactsMayBeCleaned({ mutationAttempted: true, watchdogActive: false, restorationProven: false })).toBe(false);
    expect(associationArtifactsMayBeCleaned({ mutationAttempted: true, watchdogActive: true, restorationProven: true })).toBe(true);
  });

  it("records S0 setup deltas but rejects every post-S1 shell change", () => {
    const s0 = { roots: [{ appData: "C:\\real", files: [] }] };
    const s1 = { roots: [{ appData: "C:\\real", files: [{ path: "CustomDestinations/setup.customDestinations-ms", sha256: "a".repeat(64), size: 12 }] }] };
    const postS1 = { roots: [{ appData: "C:\\real", files: [{ path: "CustomDestinations/setup.customDestinations-ms", sha256: "b".repeat(64), size: 12 }] }] };
    expect(compareWindowsShellState(s0, s1)).toHaveLength(1);
    expect(describeWindowsShellSetupDelta(s0, s1)).toMatch(/S0→S1 OS-native setup delta.*without restoration claim/u);
    expect(() => assertWindowsShellCheckpointStable(s1, s1)).not.toThrow();
    expect(() => assertWindowsShellCheckpointStable(s1, postS1)).toThrow(/S1 checkpoint changed after setup/u);
  });

  it("allows only in-place opaque destination modifications and a declared new recovery automatic destination", () => {
    const s1 = { roots: [{ appData: "C:\\real", files: [
      { path: "CustomDestinations/existing.customDestinations-ms", sha256: "a".repeat(64), size: 12 },
      { path: "Recent\\unsafe.lnk", sha256: "b".repeat(64), size: 4 }
    ] }] };
    const j0 = { roots: [{ appData: "C:\\real", files: [
      { path: "CustomDestinations/existing.customDestinations-ms", sha256: "c".repeat(64), size: 12 },
      { path: "Recent\\unsafe.lnk", sha256: "d".repeat(64), size: 4 },
      { path: "AutomaticDestinations/recovery.automaticDestinations-ms", sha256: "e".repeat(64), size: 64 }
    ] }] };
    const classification = classifyWindowsShellStateChanges(s1, j0, { allowNewRecoveryAutomaticDestination: true });
    expect(classification.allowedOpaqueModifications).toHaveLength(1);
    expect(classification.newRecoveryAutomaticDestinations).toHaveLength(1);
    expect(classification.violations).toHaveLength(1);
    expect(() => assertWindowsShellClassificationClean(classification, "S1→J0")).toThrow(/unsafe Windows shell changes/u);
  });

  it("requires J2 to be exactly J0 without the recycled candidate", () => {
    const j0 = { roots: [{ appData: "C:\\real", files: [
      { path: "AutomaticDestinations/recovery.automaticDestinations-ms", sha256: "a".repeat(64), size: 2560 },
      { path: "CustomDestinations/existing.customDestinations-ms", sha256: "b".repeat(64), size: 12 }
    ] }] };
    const j2 = { roots: [{ appData: "C:\\real", files: [{ path: "CustomDestinations/existing.customDestinations-ms", sha256: "b".repeat(64), size: 12 }] }] };
    expect(() => assertWindowsShellMicroBaselineAfterRecycle(j0, j2, { appData: "C:\\real", relativePath: "AutomaticDestinations/recovery.automaticDestinations-ms" })).not.toThrow();
    const concurrentWrite = { roots: [{ appData: "C:\\real", files: [{ path: "CustomDestinations/existing.customDestinations-ms", sha256: "c".repeat(64), size: 12 }] }] };
    expect(() => assertWindowsShellMicroBaselineAfterRecycle(j0, concurrentWrite, { appData: "C:\\real", relativePath: "AutomaticDestinations/recovery.automaticDestinations-ms" })).toThrow(/J2 did not equal J0/u);
    expect(classifyJumpListRecycleProgress({ candidate: { appData: "C:\\real", relativePath: "AutomaticDestinations/recovery.automaticDestinations-ms" }, j0, j1: j0, current: j0 })).toBe("candidate-present");
    expect(classifyJumpListRecycleProgress({ candidate: { appData: "C:\\real", relativePath: "AutomaticDestinations/recovery.automaticDestinations-ms" }, j0, j1: j0, current: j2 })).toBe("candidate-recycled");
    expect(() => classifyJumpListRecycleProgress({ candidate: { appData: "C:\\real", relativePath: "AutomaticDestinations/recovery.automaticDestinations-ms" }, j0, j1: j0, current: concurrentWrite })).toThrow(/J2 did not equal J0/u);
    const j1 = { roots: [{ appData: "C:\\real", files: [
      { path: "AutomaticDestinations/recovery.automaticDestinations-ms", sha256: "d".repeat(64), size: 2560 },
      { path: "CustomDestinations/existing.customDestinations-ms", sha256: "b".repeat(64), size: 12 }
    ] }] };
    expect(classifyJumpListComProgress({ candidate: { appData: "C:\\real", relativePath: "AutomaticDestinations/recovery.automaticDestinations-ms" }, current: j0, j0 })).toBe("com-not-applied");
    expect(classifyJumpListComProgress({ candidate: { appData: "C:\\real", relativePath: "AutomaticDestinations/recovery.automaticDestinations-ms" }, current: j1, j0 })).toBe("com-applied");
    expect(() => classifyJumpListComProgress({ candidate: { appData: "C:\\real", relativePath: "AutomaticDestinations/recovery.automaticDestinations-ms" }, current: concurrentWrite, j0 })).toThrow(/COM retry state changed/u);
  });

  it("refuses deletion of a shortcut pathname that existed in the full S1 root", () => {
    const s1 = { roots: [
      { appData: "C:\\real", files: [{ path: "retargeted.lnk", sha256: "a".repeat(64), size: 4 }] },
      { appData: "C:\\isolated", files: [] }
    ] };
    expect(() => assertWindowsShellDeletionCandidatesAbsentAtS1(s1, [{ appData: "C:\\real", relativePath: "retargeted.lnk" }])).toThrow(/S1-pre-existing shortcut/u);
    expect(() => assertWindowsShellDeletionCandidatesAbsentAtS1(s1, [{ appData: "C:\\isolated", relativePath: "new-target.lnk" }])).not.toThrow();
    expect(() => assertWindowsShellDeletionCandidatesAbsentAtS1(s1, [{ appData: "C:\\missing", relativePath: "new-target.lnk" }])).toThrow(/No S1 shell root/u);
    expect(() => assertWindowsShellDeletionCandidatesAbsentAtS1(s1, [{ appData: "C:\\isolated", relativePath: "not-a-link.txt" }])).toThrow(/non-shortcut/u);
  });

  it("derives only exact top-level Recent candidates and rejects traversal", () => {
    const recentRoot = "C:\\owned\\Recent";
    expect(deriveWindowsShellDeletionCandidate({ appData: "C:\\owned", recentRoot, candidatePath: "C:\\owned\\Recent\\new-target.lnk" })).toEqual({ appData: "C:\\owned", relativePath: "new-target.lnk" });
    expect(() => deriveWindowsShellDeletionCandidate({ appData: "C:\\owned", recentRoot, candidatePath: "C:\\owned\\Recent\\..\\outside.lnk" })).toThrow(/outside its exact root|path traversal/u);
    expect(() => deriveWindowsShellDeletionCandidate({ appData: "C:\\owned", recentRoot, candidatePath: "C:\\owned\\Recent\\nested\\new-target.lnk" })).toThrow(/outside its exact root/u);
    expect(() => deriveWindowsShellDeletionCandidate({ appData: "C:\\owned", recentRoot, candidatePath: "C:\\owned\\Recent\\not-a-link.txt" })).toThrow(/non-shortcut/u);
  });

  it("fails every removal and new or changed non-opaque shell file", () => {
    const before = { roots: [{ appData: "C:\\real", files: [
      { path: "CustomDestinations/existing.customDestinations-ms", sha256: "a".repeat(64), size: 12 },
      { path: "exact-target.lnk", sha256: "b".repeat(64), size: 4 }
    ] }] };
    const after = { roots: [{ appData: "C:\\real", files: [
      { path: "exact-target.lnk", sha256: "c".repeat(64), size: 4 },
      { path: "unexpected.txt", sha256: "d".repeat(64), size: 1 },
      { path: "CustomDestinations/new.customDestinations-ms", sha256: "e".repeat(64), size: 12 }
    ] }] };
    const classification = classifyWindowsShellStateChanges(before, after, { allowNewRecoveryAutomaticDestination: true });
    expect(classification.allowedOpaqueModifications).toHaveLength(0);
    expect(classification.newRecoveryAutomaticDestinations).toHaveLength(0);
    expect(classification.violations).toHaveLength(4);
    expect(() => assertWindowsShellClassificationClean(classification, "removal/new/non-opaque")).toThrow(/unsafe Windows shell changes/u);
  });

  it("requires an empty exact-target Recent-link baseline before Recent mode", () => {
    expect(() => requireNoTestOwnedRecentShortcuts([])).not.toThrow();
    expect(() => requireNoTestOwnedRecentShortcuts(["C:\\real\\Recent\\Jump List.lnk"])).toThrow(/S1 contains matching test-owned Recent shortcuts/u);
  });

  it("requires explicit exact-process proof, failure-free finalization, and S1 cleanup before deletion", () => {
    const base = { checkpointCaptured: true, exactProcessAbsenceProven: true, finalizationFailuresAbsent: true, journeyFailedAfterCheckpoint: false, shellCheckpointRestored: true, sidecarDurabilityProven: true };
    expect(recoveryArtifactsMayBeCleanedAfterShellCheckpoint({ ...base, exactProcessAbsenceProven: false })).toBe(false);
    expect(recoveryArtifactsMayBeCleanedAfterShellCheckpoint({ ...base, finalizationFailuresAbsent: false })).toBe(false);
    expect(recoveryArtifactsMayBeCleanedAfterShellCheckpoint({ ...base, shellCheckpointRestored: false })).toBe(false);
    expect(recoveryArtifactsMayBeCleanedAfterShellCheckpoint({ ...base, journeyFailedAfterCheckpoint: true })).toBe(false);
    expect(recoveryArtifactsMayBeCleanedAfterShellCheckpoint({ ...base, sidecarDurabilityProven: false })).toBe(false);
    expect(recoveryArtifactsMayBeCleanedAfterShellCheckpoint(base)).toBe(true);
    expect(recoveryArtifactsMayBeCleanedAfterShellCheckpoint({ ...base, checkpointCaptured: false, shellCheckpointRestored: false })).toBe(true);
  });

  it("requires a separate explicit approval before pointer/taskbar shell interaction", () => {
    expect(() => requireShellUiApproval({})).toThrow(/shell interaction is disabled/u);
    expect(() => requireShellUiApproval({ [SHELL_UI_APPROVAL]: SHELL_UI_APPROVAL_VALUE })).not.toThrow();
  });

  it("refuses app-scoped COM destination cleanup before any COM work without both approvals", async () => {
    await expect(removeRecoveryShellAutomaticDestinations("0123456789abcdef0123456789abcdef", {})).rejects.toThrow(/requires both explicit/u);
  });

  it("accepts recovery shell identity only for the disposable journey profile shape", () => {
    const token = "0123456789abcdef0123456789abcdef";
    const root = path.join(os.tmpdir(), "ether-recovery-journey-contract");
    const appData = path.join(root, "AppData", "Roaming");
    const userData = path.join(root, "AppData", "Local", "Ether-Recovery-Profile");
    expect(resolveRecoveryShellIdentity({ appData, argv: [`${RECOVERY_SHELL_IDENTITY_ARGUMENT}${token}`], platform: "win32", tempRoot: os.tmpdir(), userData })).toEqual({
      appUserModelId: `com.dreambay.ether.recovery.${token}`,
      recentEnabled: false,
      taskbarName: "Ether Recovery 01234567",
      token
    });
    const approvals = {
      [SHELL_UI_APPROVAL]: SHELL_UI_APPROVAL_VALUE,
      [ASSOCIATION_APPROVAL]: ASSOCIATION_APPROVAL_VALUE
    };
    const recentArgv = [`${RECOVERY_SHELL_RECENT_ARGUMENT}${token}`, `${RECOVERY_SHELL_JOURNEY_ARGUMENT}${RECOVERY_SHELL_JUMP_LIST_JOURNEY}`];
    expect(resolveRecoveryShellIdentity({ appData, argv: recentArgv, environment: approvals, isPackaged: true, platform: "win32", tempRoot: os.tmpdir(), userData })?.recentEnabled).toBe(true);
    expect(() => resolveRecoveryShellIdentity({ appData, argv: recentArgv, environment: {}, isPackaged: true, platform: "win32", tempRoot: os.tmpdir(), userData })).toThrow(/requires the packaged approved/u);
    expect(() => resolveRecoveryShellIdentity({ appData, argv: [`${RECOVERY_SHELL_RECENT_ARGUMENT}${token}`], environment: approvals, isPackaged: true, platform: "win32", tempRoot: os.tmpdir(), userData })).toThrow(/requires the packaged approved/u);
    expect(() => resolveRecoveryShellIdentity({ appData, argv: [`${RECOVERY_SHELL_RECENT_ARGUMENT}${token}`, `${RECOVERY_SHELL_JOURNEY_ARGUMENT}wrong`], environment: approvals, isPackaged: true, platform: "win32", tempRoot: os.tmpdir(), userData })).toThrow(/requires the packaged approved/u);
    expect(() => resolveRecoveryShellIdentity({ appData, argv: recentArgv, environment: approvals, isPackaged: false, platform: "win32", tempRoot: os.tmpdir(), userData })).toThrow(/requires the packaged approved/u);
    expect(() => resolveRecoveryShellIdentity({ appData: process.env.APPDATA, argv: [`${RECOVERY_SHELL_IDENTITY_ARGUMENT}${token}`], platform: "win32", tempRoot: os.tmpdir(), userData: path.join(os.tmpdir(), "Ether") })).toThrow(/non-disposable profile/u);
    expect(() => assertPackagedJourneyArgs([`${RECOVERY_SHELL_IDENTITY_ARGUMENT}${token}`])).toThrow(/driver-owned isolation/u);
    expect(() => assertPackagedJourneyArgs([`${RECOVERY_SHELL_RECENT_ARGUMENT}${token}`])).toThrow(/driver-owned isolation/u);
    expect(() => assertPackagedJourneyArgs([`${RECOVERY_SHELL_JOURNEY_ARGUMENT}${RECOVERY_SHELL_JUMP_LIST_JOURNEY}`])).toThrow(/driver-owned isolation/u);

    const profile = { root, appData, localAppData: path.join(root, "AppData", "Local"), userData, kind: "fresh-isolated" as const };
    const contenderUserData = path.join(root, "contender", "Ether-Recovery-Profile");
    expect(resolveRecoveryShellIdentity({ appData, argv: [`${RECOVERY_SHELL_IDENTITY_ARGUMENT}${token}`], platform: "win32", tempRoot: os.tmpdir(), userData: contenderUserData })?.token).toBe(token);
    expect(() => resolveRecoveryShellIdentity({ appData, argv: [`${RECOVERY_SHELL_IDENTITY_ARGUMENT}${token}`], platform: "win32", tempRoot: os.tmpdir(), userData: path.join(root, "contender-user-data") })).toThrow(/non-disposable profile/u);
    const permitted = { ...packagedJourneyConfig("C:\\repo", "a02-windows-jump-list"), profile, cleanupProfile: false, recoveryShellRecent: true };
    expect(() => assertRecoveryShellRecentAdmission(permitted, approvals)).not.toThrow();
    expect(() => assertRecoveryShellRecentAdmission({ ...permitted, journeyId: "other" }, approvals)).toThrow(/restricted/u);
    expect(() => assertRecoveryShellRecentAdmission({ ...permitted, mode: "source-electron" }, approvals)).toThrow(/restricted/u);
    expect(() => assertRecoveryShellRecentAdmission({ ...permitted, cleanupProfile: true }, approvals)).toThrow(/restricted/u);
    expect(() => assertRecoveryShellRecentAdmission(permitted, {})).toThrow(/restricted/u);
  });

  it("deletes only named disposable roots below a driver-created test root", async () => {
    const root = await createWindowsIntegrationRoot();
    const outside = await mkdtemp(path.join(os.tmpdir(), "ether-a02-outside-"));
    try {
      const cache = path.join(root, "profile", "cache");
      const staging = path.join(root, "profile", "provider-staging");
      const liveOutput = path.join(root, "profile", "live-output");
      await Promise.all([mkdir(cache, { recursive: true }), mkdir(staging, { recursive: true }), mkdir(liveOutput, { recursive: true })]);
      await removeTestOwnedDisposableRoots(root, [cache, staging, liveOutput]);
      await expect(removeTestOwnedDisposableRoots(root, [outside])).rejects.toThrow(/outside the test-owned root/u);
      await expect(removeTestOwnedDisposableRoots(root, [path.join(root, "profile", "documents")])).rejects.toThrow(/non-disposable/u);
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });
});
