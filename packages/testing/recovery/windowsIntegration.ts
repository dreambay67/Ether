import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, mkdir, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const WINDOWS_INTEGRATION_MODE = "ETHER_WINDOWS_INTEGRATION_MODE";
export const ASSOCIATION_APPROVAL = "ETHER_A02_ASSOCIATION_MUTATION";
export const ASSOCIATION_APPROVAL_VALUE = "approved-by-main";
export const SHELL_UI_APPROVAL = "ETHER_A02_SHELL_UI_APPROVAL";
export const SHELL_UI_APPROVAL_VALUE = "approved-by-main";
export const TEST_ROOT_PREFIX = "ether-a02-windows-integration-";
export const ASSOCIATION_ROOT = "HKCU\\Software\\Classes";
export const ETHER_EXTENSION_KEY = `${ASSOCIATION_ROOT}\\.ether`;

/**
 * This is deliberately a declared slice, not a claim of completed evidence.
 * Existing focused A tests cover the exhaustive deterministic cases; this
 * packaged journey covers the visible Windows integration representatives.
 */
export const A02_WINDOWS_INTEGRATION_COVERAGE = Object.freeze({
  packagedRepresentatives: [
    "AC-A02-002", // Ctrl+S/native Save dialog
    "AC-A02-003", // one .ether file boundary
    "AC-A02-004", // AppData lease/recovery placement
    "AC-A02-009", // clean close
    "AC-A02-010", // File > Open/native picker
    "AC-A02-011", // Explorer association (approval-gated)
    "AC-A02-013", // already-open document focus
    "AC-A02-017", // Unicode/spaces path
    "AC-A02-018", // Save As completion/switch
    "AC-A02-019", // Save As lease rebinding
    "AC-A02-020", // Save a Copy
    "AC-A02-026" // cache/staging/live-output deletion and reopen
  ],
  focusedAutomation: [
    "AC-A02-001", "AC-A02-005", "AC-A02-006", "AC-A02-007", "AC-A02-008",
    "AC-A02-012", "AC-A02-014", "AC-A02-015", "AC-A02-016", "AC-A02-021",
    "AC-A02-022", "AC-A02-023", "AC-A02-024", "AC-A02-025"
  ],
  knownPackagedGaps: [
    "AC-A02-012 Explorer drag/drop is not automated: safely targeting the exact Ether window while avoiding the user's Explorer session remains unresolved.",
    "AC-A02-016 Jump List needs a stable clean-profile Windows shell route; this harness does not claim it.",
    "AC-A02-017 removable-drive and cloud-sync variants require controlled host fixtures; Unicode/spaces are the representative packaged route."
  ]
});

export type AssociationSnapshot = {
  root: string;
  extensionExisted: boolean;
  extensionBackup: string | null;
  originalProgId: string | null;
  originalProgIdExisted: boolean;
  originalProgIdBackup: string | null;
};

export type ReversibleAssociationPlan = {
  executablePath: string;
  documentPath: string;
  root: string;
  testProgId: string;
  extensionKey: string;
  testProgIdKey: string;
  snapshot: AssociationSnapshot;
};

export function isAssociationMutationApproved(environment: NodeJS.ProcessEnv = process.env): boolean {
  return environment[ASSOCIATION_APPROVAL] === ASSOCIATION_APPROVAL_VALUE;
}

export function requireAssociationMutationApproval(environment: NodeJS.ProcessEnv = process.env): void {
  if (!isAssociationMutationApproved(environment)) {
    throw new Error(
      `Association mutation is dry-run only. Main must explicitly set ${ASSOCIATION_APPROVAL}=${ASSOCIATION_APPROVAL_VALUE}.`
    );
  }
}

export function requireShellUiApproval(environment: NodeJS.ProcessEnv = process.env): void {
  if (environment[SHELL_UI_APPROVAL] !== SHELL_UI_APPROVAL_VALUE) {
    throw new Error(`Windows shell interaction is disabled. Main must explicitly set ${SHELL_UI_APPROVAL}=${SHELL_UI_APPROVAL_VALUE}.`);
  }
}

export async function createWindowsIntegrationRoot(): Promise<string> {
  return mkdtempInTemp(TEST_ROOT_PREFIX);
}

export async function cleanupWindowsIntegrationRoot(root: string): Promise<void> {
  const [tempRoot, resolvedRoot] = await Promise.all([realpath(os.tmpdir()), realpath(root)]);
  const relative = path.relative(tempRoot, resolvedRoot);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative) || !path.basename(resolvedRoot).startsWith(TEST_ROOT_PREFIX)) {
    throw new Error(`Refusing to remove a non-test-owned Windows integration root: ${root}`);
  }
  await rm(resolvedRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
}

/** Delete only explicitly named disposable roots below this test's own root. */
export async function removeTestOwnedDisposableRoots(root: string, candidates: readonly string[]): Promise<void> {
  const resolvedRoot = await realpath(root);
  for (const candidate of candidates) {
    const resolvedCandidate = await realpath(candidate).catch(() => path.resolve(candidate));
    const relative = path.relative(resolvedRoot, resolvedCandidate);
    if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error(`Refusing to remove a path outside the test-owned root: ${candidate}`);
    }
    const base = path.basename(resolvedCandidate).toLocaleLowerCase("en-US");
    if (!new Set(["cache", "staging", "provider-staging", "live-output"]).has(base)) {
      throw new Error(`Refusing to remove non-disposable test path: ${candidate}`);
    }
    await rm(resolvedCandidate, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  }
}

export async function assertExactPackagedEtherExecutable(executablePath: string, workspaceRoot: string): Promise<string> {
  const expected = path.join(workspaceRoot, "release", "windows", "win-unpacked", "Ether.exe");
  const [resolvedExpected, resolvedExecutable] = await Promise.all([realpath(expected), realpath(executablePath)]);
  if (!sameWindowsPath(resolvedExpected, resolvedExecutable)) {
    throw new Error(`Windows integration refuses a non-review packaged executable: ${executablePath}`);
  }
  await access(resolvedExecutable);
  return resolvedExecutable;
}

export async function createAssociationDryRunPlan(input: {
  executablePath: string;
  documentPath: string;
  root: string;
  nonce?: string;
}): Promise<ReversibleAssociationPlan> {
  await assertTestOwnedPath(input.root, input.documentPath);
  const nonce = (input.nonce ?? randomUUID()).replaceAll(/[^a-zA-Z0-9]/gu, "");
  const testProgId = `Ether.Recovery.${nonce}`;
  const registryRoot = path.join(input.root, "registry");
  await mkdir(registryRoot, { recursive: true });
  const extensionBackup = path.join(registryRoot, "extension-before.reg");
  const originalProgId = await readRegistryDefault(ETHER_EXTENSION_KEY);
  const originalProgIdBackup = originalProgId === null ? null : path.join(registryRoot, "original-progid-before.reg");
  const extensionExisted = await registryKeyExists(ETHER_EXTENSION_KEY);
  const originalProgIdKey = originalProgId === null ? null : `${ASSOCIATION_ROOT}\\${originalProgId}`;
  const originalProgIdExisted = originalProgIdKey === null ? false : await registryKeyExists(originalProgIdKey);
  if (extensionExisted) await exportRegistryKey(ETHER_EXTENSION_KEY, extensionBackup);
  if (originalProgIdKey !== null && originalProgIdExisted && originalProgIdBackup !== null) await exportRegistryKey(originalProgIdKey, originalProgIdBackup);
  return {
    executablePath: path.resolve(input.executablePath),
    documentPath: path.resolve(input.documentPath),
    root: path.resolve(input.root),
    testProgId,
    extensionKey: ETHER_EXTENSION_KEY,
    testProgIdKey: `${ASSOCIATION_ROOT}\\${testProgId}`,
    snapshot: { root: registryRoot, extensionExisted, extensionBackup: extensionExisted ? extensionBackup : null, originalProgId, originalProgIdExisted, originalProgIdBackup }
  };
}

/**
 * The only registry deletions are the exact .ether value tree temporarily
 * changed by this journey and the unique test ProgID tree created by it.
 * Restoration runs in finally at the call site even if UI Automation fails.
 */
export async function applyReversibleAssociation(plan: ReversibleAssociationPlan): Promise<void> {
  requireAssociationMutationApproval();
  await execReg(["add", plan.testProgIdKey, "/ve", "/d", "Ether recovery test document", "/f"]);
  await execReg(["add", `${plan.testProgIdKey}\\DefaultIcon`, "/ve", "/d", `${plan.executablePath},0`, "/f"]);
  await execReg(["add", `${plan.testProgIdKey}\\shell\\open\\command`, "/ve", "/d", `"${plan.executablePath}" "%1"`, "/f"]);
  await execReg(["add", plan.extensionKey, "/ve", "/d", plan.testProgId, "/f"]);
}

export async function restoreReversibleAssociation(plan: ReversibleAssociationPlan): Promise<void> {
  // Do not require approval here: cleanup must be available after a partial failure.
  await deleteRegistryTree(plan.extensionKey);
  if (plan.snapshot.extensionExisted && plan.snapshot.extensionBackup !== null) await importRegistryFile(plan.snapshot.extensionBackup);
  await deleteRegistryTree(plan.testProgIdKey);
  // The original ProgID is snapshotted for auditability only. It is never
  // mutated by this journey, so importing it could overwrite a user change.
}

/** Uses Windows Explorer plus UI Automation InvokePattern; it never shells the document directly. */
export async function invokeDocumentFromExplorerWithUia(documentPath: string): Promise<string> {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "Add-Type -AssemblyName UIAutomationClient",
    `$document = '${ps(documentPath)}'`,
    "$folder = Split-Path -LiteralPath $document -Parent",
    "$itemName = [System.IO.Path]::GetFileName($document)",
    "Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class EtherA02Native { [DllImport(\"user32.dll\")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId); }' -ErrorAction SilentlyContinue",
    "Start-Process explorer.exe -ArgumentList $folder | Out-Null",
    "$deadline = [DateTime]::UtcNow.AddSeconds(15)",
    "$shell = New-Object -ComObject Shell.Application",
    "$explorerPid = $null",
    "$matchedWindow = $null",
    "$item = $null",
    "while ([DateTime]::UtcNow -lt $deadline -and $null -eq $item) {",
    "  foreach ($window in @($shell.Windows())) { try { if ([string]::Equals(([uri]$window.LocationURL).LocalPath.TrimEnd('\\'), $folder.TrimEnd('\\'), [System.StringComparison]::OrdinalIgnoreCase)) { [uint32]$nativePid = 0; [EtherA02Native]::GetWindowThreadProcessId([intptr]$window.HWND, [ref]$nativePid) | Out-Null; $explorerPid = [int]$nativePid; $matchedWindow = $window; break } } catch {} }",
    "  if ($null -eq $explorerPid) { Start-Sleep -Milliseconds 150; continue }",
    "  $condition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, $itemName)",
    "  $candidates = [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)",
    "  foreach ($candidate in $candidates) { if ($candidate.Current.ProcessId -eq $explorerPid) { $item = $candidate; break } }",
    "  if ($null -eq $item) { Start-Sleep -Milliseconds 150 }",
    "}",
    "if ($null -eq $item) { throw ('Explorer UIA did not expose exact test-owned item ' + $itemName) }",
    "$pattern = $item.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)",
    "if ($null -eq $pattern) { throw 'Explorer item has no UI Automation InvokePattern' }",
    "try { ([System.Windows.Automation.InvokePattern]$pattern).Invoke(); Write-Output ('uia-invoked explorerPid=' + $explorerPid + ' folder=' + $folder + ' item=' + $itemName) } finally { if ($null -ne $matchedWindow) { $matchedWindow.Quit() } }"
  ].join("; ");
  return runPowerShell(script);
}

export type NativeScreenPoint = { x: number; y: number };

/**
 * Sends a real OS pointer drag from the uniquely named Explorer item to a
 * caller-supplied point inside one exact packaged Ether window. No renderer
 * DataTransfer, bridge, or synthetic DOM drop is involved.
 */
export async function dragDocumentFromExplorerWithNativePointer(input: {
  documentPath: string;
  etherPid: number;
  target: NativeScreenPoint;
}): Promise<string> {
  requireShellUiApproval();
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "Add-Type -AssemblyName UIAutomationClient",
    "Add-Type -AssemblyName PresentationFramework",
    "Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class EtherA02Pointer { [DllImport(\"user32.dll\")] public static extern bool SetCursorPos(int X, int Y); [DllImport(\"user32.dll\")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra); [DllImport(\"user32.dll\")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId); [DllImport(\"user32.dll\")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr insertAfter, int X, int Y, int cx, int cy, uint flags); }'",
    `$document = '${ps(input.documentPath)}'`,
    "$folder = Split-Path -LiteralPath $document -Parent",
    "$itemName = [System.IO.Path]::GetFileName($document)",
    `$etherPid = ${input.etherPid}`,
    `$targetX = ${Math.round(input.target.x)}`,
    `$targetY = ${Math.round(input.target.y)}`,
    "Start-Process explorer.exe -ArgumentList $folder | Out-Null",
    "$deadline = [DateTime]::UtcNow.AddSeconds(15)",
    "$shell = New-Object -ComObject Shell.Application; $matchedWindow = $null; $explorerPid = $null; $item = $null",
    "while ([DateTime]::UtcNow -lt $deadline -and $null -eq $item) {",
    "  foreach ($window in @($shell.Windows())) { try { if ([string]::Equals(([uri]$window.LocationURL).LocalPath.TrimEnd('\\'), $folder.TrimEnd('\\'), [System.StringComparison]::OrdinalIgnoreCase)) { [uint32]$pid = 0; [EtherA02Pointer]::GetWindowThreadProcessId([intptr]$window.HWND, [ref]$pid) | Out-Null; $explorerPid = [int]$pid; $matchedWindow = $window; break } } catch {} }",
    "  if ($null -eq $explorerPid) { Start-Sleep -Milliseconds 150; continue }",
    "  $condition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, $itemName)",
    "  foreach ($candidate in [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)) { if ($candidate.Current.ProcessId -eq $explorerPid) { $item = $candidate; break } }",
    "  if ($null -eq $item) { Start-Sleep -Milliseconds 150 }",
    "}",
    "if ($null -eq $item) { if ($null -ne $matchedWindow) { $matchedWindow.Quit() }; throw ('Explorer UIA did not expose exact drag source ' + $itemName) }",
    "$down = $false",
    "try { $etherCondition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $etherPid); $etherWindows = [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, $etherCondition); if ($etherWindows.Count -ne 1) { throw ('Expected one exact Ether drag target window; found ' + $etherWindows.Count) }; $targetWindow = $etherWindows[0].Current.BoundingRectangle; if ($targetX -lt $targetWindow.Left -or $targetX -gt $targetWindow.Right -or $targetY -lt $targetWindow.Top -or $targetY -gt $targetWindow.Bottom) { throw 'Requested drop point is outside the exact Ether window' }; $moveX = if ($targetX -gt 520) { 0 } else { [int]([System.Windows.SystemParameters]::PrimaryScreenWidth - 460) }; [EtherA02Pointer]::SetWindowPos([intptr]$matchedWindow.HWND, [intptr]::Zero, $moveX, 0, 440, 520, 0x0040) | Out-Null; Start-Sleep -Milliseconds 300; $explorerBounds = [System.Windows.Automation.AutomationElement]::FromHandle([intptr]$matchedWindow.HWND).Current.BoundingRectangle; if ($targetX -ge $explorerBounds.Left -and $targetX -le $explorerBounds.Right -and $targetY -ge $explorerBounds.Top -and $targetY -le $explorerBounds.Bottom) { throw 'Exact Explorer window still covers the requested Ether drop target' }; $item = $null; $deadline = [DateTime]::UtcNow.AddSeconds(10); while ([DateTime]::UtcNow -lt $deadline -and $null -eq $item) { $condition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, $itemName); foreach ($candidate in [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)) { if ($candidate.Current.ProcessId -eq $explorerPid) { $item = $candidate; break } }; if ($null -eq $item) { Start-Sleep -Milliseconds 150 } }; if ($null -eq $item) { throw 'Exact Explorer source disappeared after arranging its matched window' }; $source = $item.Current.BoundingRectangle; if ($source.Width -le 0 -or $source.Height -le 0) { throw 'Exact Explorer source has no usable screen bounds after arranging window' }; if ($targetX -ge $source.Left -and $targetX -le $source.Right -and $targetY -ge $source.Top -and $targetY -le $source.Bottom) { throw 'Explorer source and Ether target rectangles overlap' }; $sourceX = [int][Math]::Round($source.Left + ($source.Width / 2)); $sourceY = [int][Math]::Round($source.Top + ($source.Height / 2)); [EtherA02Pointer]::SetCursorPos($sourceX, $sourceY) | Out-Null; Start-Sleep -Milliseconds 100; [EtherA02Pointer]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero); $down = $true; for ($step = 1; $step -le 12; $step++) { [EtherA02Pointer]::SetCursorPos([int]($sourceX + (($targetX - $sourceX) * $step / 12)), [int]($sourceY + (($targetY - $sourceY) * $step / 12))) | Out-Null; Start-Sleep -Milliseconds 25 }; [EtherA02Pointer]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero); $down = $false; Write-Output ('native-explorer-drag explorerPid=' + $explorerPid + ' etherPid=' + $etherPid + ' source=(' + $sourceX + ',' + $sourceY + ') target=(' + $targetX + ',' + $targetY + ')') } finally { if ($down) { [EtherA02Pointer]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero) }; if ($null -ne $matchedWindow) { $matchedWindow.Quit() } }"
  ].join("; ");
  return runPowerShell(script);
}

/**
 * Uses the actual taskbar/Jumplist surface only when a unique Ether taskbar
 * entry and unique recent document item are exposed to UI Automation. Any
 * ambiguity fails with diagnostics instead of guessing or using argv.
 */
export async function invokeJumpListRecentDocumentWithUia(input: {
  documentPath: string;
  etherPid: number;
  taskbarAppName?: string;
}): Promise<string> {
  requireShellUiApproval();
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "Add-Type -AssemblyName UIAutomationClient",
    "Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class EtherA02JumpList { [DllImport(\"user32.dll\")] public static extern bool SetCursorPos(int X, int Y); [DllImport(\"user32.dll\")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra); [DllImport(\"user32.dll\")] public static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra); }'",
    `$itemName = '${ps(path.basename(input.documentPath))}'`,
    `$etherPid = ${input.etherPid}`,
    `$appName = '${ps(input.taskbarAppName ?? "Ether")}'`,
    "$root = [System.Windows.Automation.AutomationElement]::RootElement; $nameCondition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, $appName)",
    "$taskbarCandidates = @($root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $nameCondition) | Where-Object { $_.Current.BoundingRectangle.Width -gt 0 -and $_.Current.BoundingRectangle.Height -gt 0 })",
    "if ($taskbarCandidates.Count -ne 1) { throw ('JUMP_LIST_UNAVAILABLE: expected one exact visible taskbar item named ' + $appName + '; found ' + $taskbarCandidates.Count + '. Refusing ambiguous shell interaction.') }",
    "$taskbar = $taskbarCandidates[0]; $bounds = $taskbar.Current.BoundingRectangle; $x = [int][Math]::Round($bounds.Left + ($bounds.Width / 2)); $y = [int][Math]::Round($bounds.Top + ($bounds.Height / 2))",
    "[EtherA02JumpList]::SetCursorPos($x, $y) | Out-Null; [EtherA02JumpList]::mouse_event(0x0008, 0, 0, 0, [UIntPtr]::Zero); [EtherA02JumpList]::mouse_event(0x0010, 0, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 500",
    "try { $itemCondition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, $itemName); $recentItems = @($root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $itemCondition) | Where-Object { $_.Current.BoundingRectangle.Width -gt 0 -and $_.Current.BoundingRectangle.Height -gt 0 }); if ($recentItems.Count -ne 1) { throw ('JUMP_LIST_UNAVAILABLE: expected one exact visible recent item ' + $itemName + '; found ' + $recentItems.Count + '. The host did not expose a safe exact Jump List target.') }; $invoke = $recentItems[0].GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern); if ($null -eq $invoke) { throw 'JUMP_LIST_UNAVAILABLE: exact recent item has no InvokePattern' }; ([System.Windows.Automation.InvokePattern]$invoke).Invoke(); Write-Output ('uia-jumplist-invoked etherPid=' + $etherPid + ' item=' + $itemName + ' taskbar=(' + $x + ',' + $y + ')') } finally { [EtherA02JumpList]::keybd_event(0x1B, 0, 0, [UIntPtr]::Zero); [EtherA02JumpList]::keybd_event(0x1B, 0, 2, [UIntPtr]::Zero) }"
  ].join("; ");
  return runPowerShell(script);
}

/** Reads and closes only the exact Ether-owned native failure dialog. */
export async function readAndCloseExactNativeErrorDialog(ownerPid: number, expectedPath: string): Promise<string> {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "Add-Type -AssemblyName UIAutomationClient",
    `$ownerPid = ${ownerPid}`,
    `$expectedName = '${ps(path.basename(expectedPath))}'`,
    "$deadline = [DateTime]::UtcNow.AddSeconds(15); $dialog = $null",
    "while ([DateTime]::UtcNow -lt $deadline -and $null -eq $dialog) { $condition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $ownerPid); foreach ($window in [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, $condition)) { if ($window.Current.ClassName -eq '#32770') { $dialog = $window; break } }; if ($null -eq $dialog) { Start-Sleep -Milliseconds 150 } }",
    "if ($null -eq $dialog) { throw 'JUMP_LIST_MISSING_TARGET_UNPROVEN: no exact Ether native error dialog appeared' }",
    "$texts = @($dialog.FindAll([System.Windows.Automation.TreeScope]::Descendants, (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Text))) | ForEach-Object { $_.Current.Name }) -join ' '",
    "if ($texts -notlike ('*' + $expectedName + '*')) { throw ('JUMP_LIST_MISSING_TARGET_UNPROVEN: exact Ether dialog did not name the missing target. Dialog=' + $texts) }",
    "$buttons = $dialog.FindAll([System.Windows.Automation.TreeScope]::Descendants, (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button))); $ok = @($buttons | Where-Object { $_.Current.Name -in @('OK', 'Close') }) | Select-Object -First 1; if ($null -eq $ok) { throw 'Exact Ether error dialog has no safe close button' }; ([System.Windows.Automation.InvokePattern]$ok.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)).Invoke(); Write-Output ('native-error etherPid=' + $ownerPid + ' text=' + $texts)"
  ].join("; ");
  return runPowerShell(script);
}

/** Snapshot only Recent shortcuts that resolve to these exact test-owned targets. */
export async function snapshotTestOwnedRecentShortcuts(input: {
  appData: string;
  root: string;
  documentPaths: readonly string[];
}): Promise<string[]> {
  await Promise.all(input.documentPaths.map((candidate) => assertTestOwnedPath(input.root, candidate)));
  const output = await runPowerShell(recentShortcutScript(input, false));
  return output.length === 0 ? [] : output.split(/\r?\n/u).filter(Boolean);
}

/**
 * Removes only `.lnk` records that both resolve to one of the exact test
 * documents and live under the isolated profile's Recent directory. It never
 * clears the shell's whole Recent list or touches an unrelated target.
 */
export async function cleanupTestOwnedRecentShortcuts(input: {
  appData: string;
  root: string;
  documentPaths: readonly string[];
}): Promise<string[]> {
  await Promise.all(input.documentPaths.map((candidate) => assertTestOwnedPath(input.root, candidate)));
  const output = await runPowerShell(recentShortcutScript(input, true));
  return output.length === 0 ? [] : output.split(/\r?\n/u).filter(Boolean);
}

function recentShortcutScript(input: { appData: string; root: string; documentPaths: readonly string[] }, remove: boolean): string {
  const targets = input.documentPaths.map((candidate) => path.resolve(candidate));
  const removal = remove ? "Remove-Item -LiteralPath $_.FullName -Force; " : "";
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `$appData = '${ps(input.appData)}'`,
    `$root = '${ps(input.root)}'`,
    `$targets = @(${targets.map((target) => `'${ps(target)}'`).join(",")})`,
    "$recent = Join-Path $appData 'Microsoft\\Windows\\Recent'",
    "if (-not (Test-Path -LiteralPath $recent)) { return }",
    "$shell = New-Object -ComObject WScript.Shell",
    `Get-ChildItem -LiteralPath $recent -Filter '*.lnk' -File | ForEach-Object { $shortcut = $shell.CreateShortcut($_.FullName); $target = [System.IO.Path]::GetFullPath($shortcut.TargetPath); $match = @($targets | Where-Object { [string]::Equals($_, $target, [System.StringComparison]::OrdinalIgnoreCase) }).Count -eq 1; $underRoot = $target.StartsWith($root.TrimEnd('\\') + '\\', [System.StringComparison]::OrdinalIgnoreCase); if ($match -and $underRoot) { ${removal}Write-Output $_.FullName } }`
  ].join("; ");
  return script;
}

export async function assertExactPackagedProcess(executablePath: string, expectedPid: number): Promise<void> {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `$expectedPath = '${ps(executablePath)}'`,
    `$expectedPid = ${expectedPid}`,
    "$process = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + $expectedPid)",
    "if ($null -eq $process) { throw ('Exact Ether process was not found: ' + $expectedPid) }",
    "if (-not [string]::Equals($process.ExecutablePath, $expectedPath, [System.StringComparison]::OrdinalIgnoreCase)) { throw ('PID/executable mismatch: ' + $process.ExecutablePath) }"
  ].join("; ");
  await runPowerShell(script);
}

/** Deliberately minimizes only the exact test-owned Ether window before a second-instance focus check. */
export async function minimizeExactWindowWithUia(expectedPid: number): Promise<void> {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "Add-Type -AssemblyName UIAutomationClient",
    `$expectedPid = ${expectedPid}`,
    "$condition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $expectedPid)",
    "$windows = [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, $condition)",
    "if ($windows.Count -ne 1) { throw ('Expected one exact Ether window to minimize; found ' + $windows.Count) }",
    "$pattern = $windows[0].GetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern)",
    "if ($null -eq $pattern) { throw 'Exact Ether window has no UI Automation WindowPattern' }",
    "([System.Windows.Automation.WindowPattern]$pattern).SetWindowVisualState([System.Windows.Automation.WindowVisualState]::Minimized)",
    "Write-Output ('uia-minimized etherPid=' + $expectedPid)"
  ].join("; ");
  await runPowerShell(script);
}

/** Verifies foreground activation belongs to the exact packaged primary process. */
export async function assertExactWindowForegroundWithUia(expectedPid: number): Promise<void> {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class EtherA02Foreground { [DllImport(\"user32.dll\")] public static extern IntPtr GetForegroundWindow(); [DllImport(\"user32.dll\")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId); }'",
    `$expectedPid = ${expectedPid}`,
    "[uint32]$foregroundPid = 0",
    "$foreground = [EtherA02Foreground]::GetForegroundWindow()",
    "[EtherA02Foreground]::GetWindowThreadProcessId($foreground, [ref]$foregroundPid) | Out-Null",
    "if ([int]$foregroundPid -ne $expectedPid) { throw ('Exact Ether process did not regain foreground activation; observed PID ' + $foregroundPid) }",
    "Write-Output ('win32-foreground etherPid=' + $expectedPid)"
  ].join("; ");
  await runPowerShell(script);
}

/** Finds one non-renderer root whose command line carries this driver-owned profile marker. */
export async function findExactPackagedProcessId(executablePath: string, profileMarker: string): Promise<number> {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `$expectedPath = '${ps(executablePath)}'`,
    `$marker = '${ps(profileMarker)}'`,
    "$matches = @(Get-CimInstance Win32_Process | Where-Object { [string]::Equals($_.ExecutablePath, $expectedPath, [System.StringComparison]::OrdinalIgnoreCase) -and $_.CommandLine -like ('*' + $marker + '*') -and $_.CommandLine -notmatch '(?:^|\\s)--type(?:=|\\s)' })",
    "if ($matches.Count -ne 1) { throw ('Expected one exact packaged journey root; found ' + $matches.Count) }",
    "Write-Output $matches[0].ProcessId"
  ].join("; ");
  const result = Number(await runPowerShell(script));
  if (!Number.isSafeInteger(result) || result <= 0) throw new Error("Exact packaged journey process query did not return a PID.");
  return result;
}

export async function completeNativeFileDialogWithUia(ownerPid: number, filePath: string): Promise<string> {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "Add-Type -AssemblyName UIAutomationClient",
    `$ownerPid = ${ownerPid}`,
    `$filePath = '${ps(filePath)}'`,
    "$deadline = [DateTime]::UtcNow.AddSeconds(15)",
    "$dialog = $null",
    "while ([DateTime]::UtcNow -lt $deadline -and $null -eq $dialog) {",
    "  $condition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $ownerPid)",
    "  $windows = [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, $condition)",
    "  foreach ($window in $windows) { if ($window.Current.ClassName -eq '#32770') { $dialog = $window; break } }",
    "  if ($null -eq $dialog) { Start-Sleep -Milliseconds 150 }",
    "}",
    "if ($null -eq $dialog) { throw 'Exact Ether-owned native file dialog was not found' }",
    "$edits = $dialog.FindAll([System.Windows.Automation.TreeScope]::Descendants, (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Edit)))",
    "if ($edits.Count -eq 0) { throw 'Native file dialog exposed no UI Automation edit control' }",
    "$valuePattern = $edits[$edits.Count - 1].GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)",
    "if ($null -eq $valuePattern) { throw 'Native file dialog edit control has no ValuePattern' }",
    "([System.Windows.Automation.ValuePattern]$valuePattern).SetValue($filePath)",
    "$buttons = $dialog.FindAll([System.Windows.Automation.TreeScope]::Descendants, (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button)))",
    "$confirm = @($buttons | Where-Object { $_.Current.Name -in @('Open', 'Save') }) | Select-Object -First 1",
    "if ($null -eq $confirm) { throw 'Native file dialog exposed no Open/Save UIA button' }",
    "$invoke = $confirm.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)",
    "if ($null -eq $invoke) { throw 'Native file dialog confirmation button has no InvokePattern' }",
    "([System.Windows.Automation.InvokePattern]$invoke).Invoke()",
    "Write-Output ('uia-file-dialog ownerPid=' + $ownerPid + ' path=' + $filePath)"
  ].join("; ");
  return runPowerShell(script);
}

async function assertTestOwnedPath(root: string, candidate: string): Promise<void> {
  const [resolvedRoot, absoluteCandidate] = await Promise.all([realpath(root), Promise.resolve(path.resolve(candidate))]);
  const relative = path.relative(resolvedRoot, absoluteCandidate);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`Expected a test-owned path below ${root}: ${candidate}`);
}

async function mkdtempInTemp(prefix: string): Promise<string> {
  const { mkdtemp } = await import("node:fs/promises");
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

async function registryKeyExists(key: string): Promise<boolean> {
  try { await execReg(["query", key]); return true; } catch { return false; }
}

async function readRegistryDefault(key: string): Promise<string | null> {
  try {
    const { stdout } = await execReg(["query", key, "/ve"]);
    const match = stdout.match(/REG_\w+\s+(.+)\s*$/mu);
    return match?.[1]?.trim() || null;
  } catch { return null; }
}

async function exportRegistryKey(key: string, destination: string): Promise<void> {
  await execReg(["export", key, destination, "/y"]);
}

async function importRegistryFile(filePath: string): Promise<void> {
  await execReg(["import", filePath]);
}

async function deleteRegistryTree(key: string): Promise<void> {
  await execReg(["delete", key, "/f"]).catch(() => undefined);
}

async function execReg(args: string[]): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync("reg.exe", args, { windowsHide: true });
}

async function runPowerShell(script: string): Promise<string> {
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Sta", "-EncodedCommand", encoded], { windowsHide: true });
  return stdout.trim();
}

function sameWindowsPath(left: string, right: string): boolean {
  return path.win32.normalize(left).toLocaleLowerCase("en-US") === path.win32.normalize(right).toLocaleLowerCase("en-US");
}

function ps(value: string): string {
  return value.replaceAll("'", "''");
}
