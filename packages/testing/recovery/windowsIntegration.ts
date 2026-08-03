import { execFile, spawn, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, open, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MAX_ENCODED_POWERSHELL_COMMAND_LENGTH = 30_000;
const ASSOCIATION_NATIVE_TYPE_DEFINITION = 'using System;using System.Runtime.InteropServices;public static class EtherA02Native{[StructLayout((LayoutKind)0)]public struct POINT{public int X,Y;}[StructLayout((LayoutKind)0)]public struct KEYBDINPUT{public ushort a,b;public uint c,d;public UIntPtr e;}[StructLayout((LayoutKind)0)]public struct MOUSEINPUT{public int a,b;public uint c,d,e;public UIntPtr f;}[StructLayout((LayoutKind)2)]public struct INPUTUNION{[FieldOffset(0)]public KEYBDINPUT k;[FieldOffset(0)]public MOUSEINPUT m;}[StructLayout((LayoutKind)0)]public struct INPUT{public uint type;public INPUTUNION U;}public static int InputSize(){return Marshal.SizeOf(typeof(INPUT));}[DllImport("user32.dll")]public static extern uint GetWindowThreadProcessId(IntPtr h,out uint p);[DllImport("user32.dll")]public static extern bool IsIconic(IntPtr h);[DllImport("user32.dll")]public static extern IntPtr GetForegroundWindow();[DllImport("user32.dll")]public static extern bool SetWindowPos(IntPtr h,IntPtr a,int x,int y,int w,int z,uint f);[DllImport("user32.dll")]public static extern bool SetCursorPos(int x,int y);[DllImport("user32.dll")]public static extern bool GetCursorPos(out POINT p);[DllImport("user32.dll")]public static extern void mouse_event(uint f,uint x,uint y,uint d,UIntPtr e);[DllImport("user32.dll",SetLastError=true)]public static extern uint SendInput(uint n,INPUT[] p,int cb);[DllImport("user32.dll")]public static extern short GetAsyncKeyState(int v);[DllImport("user32.dll")]public static extern IntPtr WindowFromPoint(POINT p);[DllImport("user32.dll")]public static extern IntPtr GetAncestor(IntPtr h,uint f);[DllImport("user32.dll")]public static extern bool ClientToScreen(IntPtr h,ref POINT p);[DllImport("user32.dll")]public static extern IntPtr SendMessage(IntPtr h,uint m,IntPtr w,IntPtr l);static INPUT I(uint f){return new INPUT{type=1,U=new INPUTUNION{k=new KEYBDINPUT{a=0x0D,c=f}}};}public static INPUT[] EnterPair(){return new[]{I(0),I(2)};}public static INPUT[] EnterRelease(){return new[]{I(2)};}public static bool ReturnReleased(){var e=DateTime.UtcNow.AddSeconds(2);while(DateTime.UtcNow<e){if((GetAsyncKeyState(0x0D)&0x8000)==0)return true;System.Threading.Thread.Sleep(25);}return false;}}';

export const WINDOWS_INTEGRATION_MODE = "ETHER_WINDOWS_INTEGRATION_MODE";
export const A02_APPROVED_ROUTE = "ETHER_A02_APPROVED_ROUTE";
export const A02_APPROVED_ROUTES = ["normal", "association", "explorer-drag", "jump-list"] as const;
export type A02ApprovedRoute = (typeof A02_APPROVED_ROUTES)[number];
export const A02_ROUTE_TITLES: Readonly<Record<A02ApprovedRoute, string>> = Object.freeze({
  normal: "records the scoped A02 packaged native-picker, identity, lease, and association dry-run journey",
  association: "runs the separately approved reversible Explorer association route",
  "explorer-drag": "runs the separately approved Explorer pointer drag/drop route",
  "jump-list": "runs the separately approved Windows Jump List known-and-missing target route"
});

/** Discovery only: this command has no mutation/shell approvals and Playwright --list never executes a test body. */
export function a02ApprovalFreeListCommand(route: A02ApprovedRoute): string {
  const title = A02_ROUTE_TITLES[route].replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return `pnpm.cmd -C packages/testing exec cross-env ETHER_WINDOWS_INTEGRATION_MODE=packaged ${A02_APPROVED_ROUTE}=${route} playwright test tests/recovery/document-windows-integration.spec.ts --config playwright.document-windows-integration.config.ts --grep "${title}$" --list --workers=1`;
}

/** Runtime-only ABI contract: compiles the exact generated native type without invoking any native API. */
export function buildAssociationInputSizeRuntimeContractScript(): string {
  return [
    "$ErrorActionPreference = 'Stop'",
    "if ($PSVersionTable.PSVersion.Major -ne 5) { throw ('Expected Windows PowerShell 5.1, received ' + $PSVersionTable.PSVersion) }",
    `Add-Type -TypeDefinition '${ASSOCIATION_NATIVE_TYPE_DEFINITION}'`,
    "$inputSize = [EtherA02Native]::InputSize()",
    "$expectedInputSize = if ([IntPtr]::Size -eq 8) { 40 } elseif ([IntPtr]::Size -eq 4) { 28 } else { throw ('Unsupported pointer size ' + [IntPtr]::Size) }",
    "if ($inputSize -ne $expectedInputSize) { throw ('INPUT ABI size ' + $inputSize + '; expected ' + $expectedInputSize) }",
    "Write-Output ($inputSize.ToString() + ':' + $expectedInputSize.ToString() + ':' + [IntPtr]::Size.ToString())"
  ].join("; ");
}
export const ASSOCIATION_APPROVAL = "ETHER_A02_ASSOCIATION_MUTATION";
export const ASSOCIATION_APPROVAL_VALUE = "approved-by-main";
export const SHELL_UI_APPROVAL = "ETHER_A02_SHELL_UI_APPROVAL";
export const SHELL_UI_APPROVAL_VALUE = "approved-by-main";
export const TEST_ROOT_PREFIX = "ether-a02-windows-integration-";
export const ASSOCIATION_ROOT = "HKCU\\Software\\Classes";
export const ETHER_EXTENSION_KEY = `${ASSOCIATION_ROOT}\\.ether`;
export const RECOVERY_SHELL_IDENTITY_ARGUMENT = "--ether-recovery-shell-identity=";
export const RECOVERY_SHELL_RECENT_ARGUMENT = "--ether-recovery-shell-recent=";

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
    "AC-A02-012 Explorer drag/drop remains unproven until the approval-gated exact-new-HWND packaged route passes.",
    "AC-A02-016 Jump List remains unproven until the approval-gated unique-AUMID packaged route passes and restores shell state.",
    "AC-A02-017 removable-drive and cloud-sync variants require controlled host fixtures; Unicode/spaces are the representative packaged route."
  ]
});

export type AssociationSnapshot = {
  root: string;
  extensionExisted: boolean;
  extensionBackup: string | null;
  extensionDefault: RegistryDefaultSnapshot;
  originalProgId: string | null;
  originalProgIdExisted: boolean;
  originalProgIdBackup: string | null;
  effectiveOpenCommand: string | null;
};

export type RegistryDefaultSnapshot = {
  exists: boolean;
  kind: "String" | "ExpandString" | null;
  rawValue: string | null;
};

export type ReversibleAssociationPlan = {
  executablePath: string;
  documentPath: string;
  root: string;
  testProgId: string;
  extensionKey: string;
  testProgIdKey: string;
  testOpenCommand: string;
  snapshot: AssociationSnapshot;
};

export type WindowsShellStateSnapshot = {
  roots: Array<{ appData: string; files: Array<{ path: string; sha256: string; size: number }> }>;
};

export type WindowsShellStateChange = {
  after: { path: string; sha256: string; size: number } | null;
  appData: string;
  before: { path: string; sha256: string; size: number } | null;
};

export type WindowsShellStateClassification = {
  allowedOpaqueModifications: WindowsShellStateChange[];
  newRecoveryAutomaticDestinations: WindowsShellStateChange[];
  violations: WindowsShellStateChange[];
};

export type WindowsShellDeletionCandidate = {
  appData: string;
  relativePath: string;
};

export type DragDiagnosticSidecar = {
  armPath: string;
  deadlineEpochMs: number;
  parentPid: number;
  sidecarPath: string;
  token: string;
};

type DragDiagnosticStage = "prepared" | "release-armed" | "mouse-down-sent" | "source-foreground-proven" | "threshold-crossed" | "target-proven" | "release-attempted" | "released" | "transition-proven" | "abort-requested";

const OPAQUE_SHELL_DESTINATION = /^(?:AutomaticDestinations\/[^/]+\.automaticDestinations-ms|CustomDestinations\/[^/]+\.customDestinations-ms)$/iu;
const RECOVERY_AUTOMATIC_DESTINATION = /^AutomaticDestinations\/[^/]+\.automaticDestinations-ms$/iu;

/** Classifies byte-level shell deltas without ever repairing opaque Windows-managed destination files. */
export function classifyWindowsShellStateChanges(
  before: WindowsShellStateSnapshot,
  after: WindowsShellStateSnapshot,
  options: { allowNewRecoveryAutomaticDestination?: boolean } = {}
): WindowsShellStateClassification {
  const classification: WindowsShellStateClassification = {
    allowedOpaqueModifications: [],
    newRecoveryAutomaticDestinations: [],
    violations: []
  };
  for (const change of compareWindowsShellState(before, after)) {
    const relativePath = change.after?.path ?? change.before?.path ?? "";
    if (change.before !== null && change.after !== null && OPAQUE_SHELL_DESTINATION.test(relativePath)) {
      classification.allowedOpaqueModifications.push(change);
    } else if (
      options.allowNewRecoveryAutomaticDestination === true &&
      change.before === null &&
      change.after !== null &&
      RECOVERY_AUTOMATIC_DESTINATION.test(relativePath)
    ) {
      classification.newRecoveryAutomaticDestinations.push(change);
    } else {
      classification.violations.push(change);
    }
  }
  return classification;
}

export function assertWindowsShellClassificationClean(classification: WindowsShellStateClassification, label: string): void {
  if (classification.violations.length > 0) {
    throw new Error(`${label} introduced unsafe Windows shell changes: ${formatWindowsShellStateChanges(classification.violations)}`);
  }
}

/** After recycling the candidate, J2 must equal J0 except for that exact removed file. */
export function assertWindowsShellMicroBaselineAfterRecycle(
  j0: WindowsShellStateSnapshot,
  j2: WindowsShellStateSnapshot,
  candidate: { appData: string; relativePath: string }
): void {
  const changes = compareWindowsShellState(j0, j2);
  if (
    changes.length !== 1 ||
    changes[0]?.appData !== candidate.appData ||
    changes[0]?.before?.path !== candidate.relativePath ||
    changes[0]?.after !== null
  ) {
    throw new Error(`J2 did not equal J0 minus the exact recycled recovery destination: ${formatWindowsShellStateChanges(changes)}`);
  }
}

/** Determines whether a retried recycle step still needs work or was already completed. */
export function classifyJumpListRecycleProgress(input: {
  candidate: { appData: string; relativePath: string };
  j0: WindowsShellStateSnapshot;
  j1: WindowsShellStateSnapshot;
  current: WindowsShellStateSnapshot;
}): "candidate-present" | "candidate-recycled" {
  if (compareWindowsShellState(input.j1, input.current).length === 0) return "candidate-present";
  assertWindowsShellMicroBaselineAfterRecycle(input.j0, input.current, input.candidate);
  return "candidate-recycled";
}

/** Distinguishes an unapplied COM cleanup from its exact, empty-candidate result on retry. */
export function classifyJumpListComProgress(input: {
  candidate: { appData: string; relativePath: string };
  current: WindowsShellStateSnapshot;
  j0: WindowsShellStateSnapshot;
}): "com-not-applied" | "com-applied" {
  const changes = compareWindowsShellState(input.j0, input.current);
  if (changes.length === 0) return "com-not-applied";
  if (
    changes.length !== 1 || changes[0]?.appData !== input.candidate.appData ||
    changes[0]?.before?.path !== input.candidate.relativePath || changes[0]?.after?.path !== input.candidate.relativePath ||
    changes[0].after.size !== 2560
  ) {
    throw new Error(`COM retry state changed anything other than the exact 2560-byte J0 recovery candidate: ${formatWindowsShellStateChanges(changes) || "(none)"}.`);
  }
  return "com-applied";
}

/** A target-link cleanup candidate is safe only when its exact pathname did not exist at S1. */
export function assertWindowsShellDeletionCandidatesAbsentAtS1(
  s1: WindowsShellStateSnapshot,
  candidates: readonly WindowsShellDeletionCandidate[]
): void {
  for (const candidate of candidates) {
    const root = s1.roots.find((snapshotRoot) => sameWindowsPath(snapshotRoot.appData, candidate.appData));
    if (root === undefined) throw new Error(`No S1 shell root exists for deletion candidate ${candidate.appData}:${candidate.relativePath}.`);
    if (!candidate.relativePath.toLowerCase().endsWith(".lnk")) {
      throw new Error(`Refusing a non-shortcut shell deletion candidate: ${candidate.appData}:${candidate.relativePath}.`);
    }
    if (root.files.some((file) => file.path.toLocaleLowerCase("en-US") === candidate.relativePath.toLocaleLowerCase("en-US"))) {
      throw new Error(`Refusing to delete an S1-pre-existing shortcut pathname: ${candidate.appData}:${candidate.relativePath}.`);
    }
  }
}

/** The S0 diagnostic delta is recorded, never treated as a restoration obligation. */
export function describeWindowsShellSetupDelta(s0: WindowsShellStateSnapshot, s1: WindowsShellStateSnapshot): string {
  const changes = compareWindowsShellState(s0, s1);
  return changes.length === 0
    ? "S0→S1 had no shell-file delta."
    : `S0→S1 OS-native setup delta (recorded without restoration claim): ${formatWindowsShellStateChanges(changes)}`;
}

/** Any delta from the S1 checkpoint is an unproven post-setup shell mutation and fails closed. */
export function assertWindowsShellCheckpointStable(
  s1: WindowsShellStateSnapshot,
  current: WindowsShellStateSnapshot,
  label = "S1"
): void {
  const changes = compareWindowsShellState(s1, current);
  if (changes.length > 0) {
    throw new Error(`Windows shell ${label} checkpoint changed after setup: ${formatWindowsShellStateChanges(changes)}`);
  }
}

/** S1 must not already contain a matching target link before Recent mode is admitted. */
export function requireNoTestOwnedRecentShortcuts(paths: readonly string[], label = "S1"): void {
  if (paths.length > 0) {
    throw new Error(`${label} contains matching test-owned Recent shortcuts: ${paths.join(", ")}`);
  }
}

/** Exact process absence and failure-free finalization are both mandatory before deleting diagnostic artifacts. */
export function recoveryArtifactsMayBeCleanedAfterShellCheckpoint(input: {
  checkpointCaptured: boolean;
  exactProcessAbsenceProven: boolean;
  finalizationFailuresAbsent: boolean;
  journeyFailedAfterCheckpoint: boolean;
  sidecarDurabilityProven: boolean;
  shellCheckpointRestored: boolean;
}): boolean {
  return input.exactProcessAbsenceProven && input.finalizationFailuresAbsent && input.sidecarDurabilityProven && !input.journeyFailedAfterCheckpoint && (!input.checkpointCaptured || input.shellCheckpointRestored);
}

export type AssociationRestorationWatchdog = {
  child: ChildProcess;
  completePath: string;
  disarmPath: string;
  failurePath: string;
  triggerPath: string;
};

/** A test root can be removed only after an association was never armed or restoration/disarm was proven. */
export function associationArtifactsMayBeCleaned(input: {
  mutationAttempted: boolean;
  restorationProven: boolean;
  watchdogActive: boolean;
}): boolean {
  return input.restorationProven || (!input.mutationAttempted && !input.watchdogActive);
}

export function isAssociationMutationApproved(environment: NodeJS.ProcessEnv = process.env): boolean {
  return environment[ASSOCIATION_APPROVAL] === ASSOCIATION_APPROVAL_VALUE;
}

/** Route selection is deliberately exact and case-sensitive: stale approvals cannot select a route. */
export function isA02ApprovedRoute(route: A02ApprovedRoute, environment: NodeJS.ProcessEnv = process.env): boolean {
  return environment[A02_APPROVED_ROUTE] === route;
}

export function requireA02ApprovedRoute(route: A02ApprovedRoute, environment: NodeJS.ProcessEnv = process.env): void {
  if (!isA02ApprovedRoute(route, environment)) {
    throw new Error(`Windows route ${route} is disabled. Main must explicitly set ${A02_APPROVED_ROUTE}=${route}.`);
  }
}

export function requireAssociationRouteApproval(environment: NodeJS.ProcessEnv = process.env): void {
  requireA02ApprovedRoute("association", environment);
  requireAssociationMutationApproval(environment);
  requireShellUiApproval(environment);
}

export function requireExplorerDragRouteApproval(environment: NodeJS.ProcessEnv = process.env): void {
  requireA02ApprovedRoute("explorer-drag", environment);
  requireShellUiApproval(environment);
}

export function requireJumpListRouteApproval(environment: NodeJS.ProcessEnv = process.env): void {
  requireA02ApprovedRoute("jump-list", environment);
  requireAssociationMutationApproval(environment);
  requireShellUiApproval(environment);
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

export function createRecoveryShellToken(): string {
  return randomUUID().replaceAll("-", "");
}

export function recoveryShellIdentityArgument(token: string): string {
  assertRecoveryShellToken(token);
  return `${RECOVERY_SHELL_IDENTITY_ARGUMENT}${token}`;
}

export function recoveryShellTaskbarName(token: string): string {
  assertRecoveryShellToken(token);
  return `Ether Recovery ${token.slice(0, 8)}`;
}

/** Snapshot real and isolated Windows Recent/Jump List files without mutating either root. */
export async function snapshotWindowsShellState(isolatedAppData: string): Promise<WindowsShellStateSnapshot> {
  const actualAppData = process.env.APPDATA;
  if (actualAppData === undefined) throw new Error("Windows shell-state verification requires the real APPDATA path.");
  const roots = [...new Set([path.resolve(actualAppData), path.resolve(isolatedAppData)].map((candidate) => candidate.toLocaleLowerCase("en-US")))]
    .map((normalized) => normalized === path.resolve(actualAppData).toLocaleLowerCase("en-US") ? path.resolve(actualAppData) : path.resolve(isolatedAppData));
  return {
    roots: await Promise.all(roots.map(async (appData) => ({
      appData,
      files: await snapshotTree(path.join(appData, "Microsoft", "Windows", "Recent"))
    })))
  };
}

export async function assertWindowsShellStateRestored(before: WindowsShellStateSnapshot): Promise<void> {
  const after = await resnapshotWindowsShellState(before);
  assertWindowsShellCheckpointStable(before, after, "restoration");
}

export async function resnapshotWindowsShellState(before: WindowsShellStateSnapshot): Promise<WindowsShellStateSnapshot> {
  return {
    roots: await Promise.all(before.roots.map(async ({ appData }) => ({
      appData,
      files: await snapshotTree(path.join(appData, "Microsoft", "Windows", "Recent"))
    })))
  };
}

/** Returns every added, removed, or byte-changed file across the exact prior roots. */
export function compareWindowsShellState(before: WindowsShellStateSnapshot, after: WindowsShellStateSnapshot): WindowsShellStateChange[] {
  if (before.roots.length !== after.roots.length || before.roots.some((root, index) => root.appData !== after.roots[index]?.appData)) {
    throw new Error("Windows shell snapshots do not describe the same roots.");
  }
  return before.roots.flatMap((root, index) => {
    const next = after.roots[index]!;
    const prior = new Map(root.files.map((file) => [file.path, file]));
    const current = new Map(next.files.map((file) => [file.path, file]));
    return [...new Set([...prior.keys(), ...current.keys()])]
      .sort((left, right) => left.localeCompare(right))
      .flatMap((file) => {
        const beforeFile = prior.get(file) ?? null;
        const afterFile = current.get(file) ?? null;
        return beforeFile?.size === afterFile?.size && beforeFile?.sha256 === afterFile?.sha256
          ? []
          : [{ appData: root.appData, before: beforeFile, after: afterFile }];
      });
  });
}

export function formatWindowsShellStateChanges(changes: readonly WindowsShellStateChange[]): string {
  return changes.map((change) => `${change.appData}:${change.after?.path ?? change.before?.path ?? "(unknown)"}`).join(", ");
}

/** Recycles one post-cleanup AutomaticDestinations file only after byte identity is proven. */
export async function recycleProvenRecoveryAutomaticDestination(input: {
  appData: string;
  file: { path: string; sha256: string; size: number };
}): Promise<string> {
  const root = path.resolve(input.appData, "Microsoft", "Windows", "Recent", "AutomaticDestinations");
  const target = path.resolve(input.appData, "Microsoft", "Windows", "Recent", input.file.path);
  const relative = path.relative(root, target);
  if (
    relative === "" || relative.startsWith("..") || path.isAbsolute(relative) ||
    !/^[a-f0-9]+\.automaticDestinations-ms$/iu.test(path.basename(target))
  ) {
    throw new Error("Refusing to delete a shell artifact outside AutomaticDestinations.");
  }
  const actual = await snapshotExactFile(target);
  if (actual === null || actual.size !== input.file.size || actual.sha256 !== input.file.sha256) {
    throw new Error("Refusing to delete an AutomaticDestinations artifact whose byte identity changed after proof.");
  }
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `$path = '${ps(target)}'`,
    `$expectedSize = ${input.file.size}`,
    `$expectedSha256 = '${input.file.sha256}'`,
    "$item = Get-Item -LiteralPath $path -Force",
    "if ($item.Length -ne $expectedSize) { throw 'AutomaticDestinations byte length changed before recycle.' }",
    "$actualSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $path).Hash.ToLowerInvariant()",
    "if ($actualSha256 -ne $expectedSha256) { throw 'AutomaticDestinations hash changed before recycle.' }",
    "Add-Type -AssemblyName Microsoft.VisualBasic",
    "[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($path, [Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs, [Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin)",
    "if (Test-Path -LiteralPath $path) { throw 'The proven AutomaticDestinations artifact remained after recycle.' }"
  ].join("; ");
  await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Sta", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], {
    timeout: 30_000,
    windowsHide: true
  });
  if (await snapshotExactFile(target) !== null) throw new Error("The proven AutomaticDestinations artifact remained after recycle.");
  return `Sent ${path.basename(target)} to Recycle Bin after exact byte recheck.`;
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
  recoveryShellToken?: string;
  userData?: string;
}): Promise<ReversibleAssociationPlan> {
  await assertTestOwnedPath(input.root, input.documentPath);
  const nonce = (input.nonce ?? randomUUID()).replaceAll(/[^a-zA-Z0-9]/gu, "");
  const testProgId = `Ether.Recovery.${nonce}`;
  const registryRoot = path.join(input.root, "registry");
  await mkdir(registryRoot, { recursive: true });
  const extensionBackup = path.join(registryRoot, "extension-before.reg");
  const extensionExisted = await registryKeyExists(ETHER_EXTENSION_KEY);
  const extensionDefault = await readRegistryDefaultSnapshot(ETHER_EXTENSION_KEY);
  const originalProgId = extensionDefault.exists && extensionDefault.rawValue !== "" ? extensionDefault.rawValue : null;
  const originalProgIdBackup = originalProgId === null ? null : path.join(registryRoot, "original-progid-before.reg");
  const originalProgIdKey = originalProgId === null ? null : `${ASSOCIATION_ROOT}\\${originalProgId}`;
  const originalProgIdExisted = originalProgIdKey === null ? false : await registryKeyExists(originalProgIdKey);
  const effectiveOpenCommand = await readEffectiveAssociationCommand();
  if (extensionExisted) await exportRegistryKey(ETHER_EXTENSION_KEY, extensionBackup);
  if (originalProgIdKey !== null && originalProgIdExisted && originalProgIdBackup !== null) await exportRegistryKey(originalProgIdKey, originalProgIdBackup);
  if ((input.recoveryShellToken === undefined) !== (input.userData === undefined)) {
    throw new Error("A mutable association plan requires both the recovery shell token and isolated userData path.");
  }
  const launchArguments = input.recoveryShellToken === undefined
    ? []
    : [
        `--user-data-dir=${path.resolve(input.userData!)}`,
        recoveryShellIdentityArgument(input.recoveryShellToken)
      ];
  const testOpenCommand = [quoteWindowsArgument(path.resolve(input.executablePath)), ...launchArguments.map(quoteWindowsArgument), '"%1"'].join(" ");
  return {
    executablePath: path.resolve(input.executablePath),
    documentPath: path.resolve(input.documentPath),
    root: path.resolve(input.root),
    testProgId,
    extensionKey: ETHER_EXTENSION_KEY,
    testProgIdKey: `${ASSOCIATION_ROOT}\\${testProgId}`,
    testOpenCommand,
    snapshot: { root: registryRoot, extensionExisted, extensionBackup: extensionExisted ? extensionBackup : null, extensionDefault, originalProgId, originalProgIdExisted, originalProgIdBackup, effectiveOpenCommand }
  };
}

/**
 * The only registry deletions are the exact .ether value tree temporarily
 * changed by this journey and the unique test ProgID tree created by it.
 * Restoration runs in finally at the call site even if UI Automation fails.
 */
export async function applyReversibleAssociation(plan: ReversibleAssociationPlan): Promise<void> {
  requireAssociationRouteApproval();
  await applyReversibleAssociationWithApprovedRoute(plan);
}

/** Jump List setup has its own exact route; it never inherits association approval. */
export async function applyReversibleAssociationForJumpList(plan: ReversibleAssociationPlan): Promise<void> {
  requireJumpListRouteApproval();
  await applyReversibleAssociationWithApprovedRoute(plan);
}

async function applyReversibleAssociationWithApprovedRoute(plan: ReversibleAssociationPlan): Promise<void> {
  if (!plan.testOpenCommand.includes(RECOVERY_SHELL_IDENTITY_ARGUMENT) || !plan.testOpenCommand.includes("--user-data-dir=")) {
    throw new Error("Refusing association mutation without an isolated recovery shell command.");
  }
  await assertAssociationStillOriginal(plan);
  await execReg(["add", plan.testProgIdKey, "/ve", "/d", "Ether recovery test document", "/f"]);
  await execReg(["add", `${plan.testProgIdKey}\\DefaultIcon`, "/ve", "/d", `${plan.executablePath},0`, "/f"]);
  await execReg(["add", `${plan.testProgIdKey}\\shell\\open\\command`, "/ve", "/d", plan.testOpenCommand, "/f"]);
  await execReg(["add", plan.extensionKey, "/ve", "/d", plan.testProgId, "/f"]);
  await notifyAssociationChanged();
  await expectEffectiveAssociationCommand(plan.testOpenCommand);
}

export async function restoreReversibleAssociation(plan: ReversibleAssociationPlan): Promise<void> {
  // Do not require approval here: cleanup must be available after a partial failure.
  const extensionState = await classifyCurrentAssociationState(plan);
  if (extensionState === "applied") {
    await restoreRegistryDefaultValue(plan.extensionKey, plan.snapshot.extensionDefault);
    if (!plan.snapshot.extensionExisted) await deleteRegistryTreeIfEmpty(plan.extensionKey);
  }
  await deleteRegistryTree(plan.testProgIdKey);
  // The original ProgID is snapshotted for auditability only. It is never
  // mutated by this journey, so importing it could overwrite a user change.
  await notifyAssociationChanged();
  await assertAssociationSnapshotRestored(plan);
}

/**
 * A detached watchdog retains the exported registry backup and restores it if
 * the Playwright worker disappears before it can complete its own finally.
 */
export async function startAssociationRestorationWatchdog(plan: ReversibleAssociationPlan): Promise<AssociationRestorationWatchdog> {
  const disarmPath = path.join(plan.root, "association-watchdog.disarm");
  const triggerPath = path.join(plan.root, "association-watchdog.restore-now");
  const completePath = path.join(plan.root, "association-watchdog.restored");
  const failurePath = path.join(plan.root, "association-watchdog.failed");
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `$parentPid = ${process.pid}`,
    `$disarm = '${ps(disarmPath)}'`,
    `$trigger = '${ps(triggerPath)}'`,
    `$complete = '${ps(completePath)}'`,
    `$failure = '${ps(failurePath)}'`,
    `$extensionKey = '${ps(plan.extensionKey)}'`,
    `$extensionPath = 'Registry::HKEY_CURRENT_USER\\Software\\Classes\\.ether'`,
    `$testProgIdKey = '${ps(plan.testProgIdKey)}'`,
    `$testProgId = '${ps(plan.testProgId)}'`,
    `$extensionExisted = ${plan.snapshot.extensionExisted ? "$true" : "$false"}`,
    `$originalHadDefault = ${plan.snapshot.extensionDefault.exists ? "$true" : "$false"}`,
    `$originalDefaultKind = '${ps(plan.snapshot.extensionDefault.kind ?? "String")}'`,
    `$originalDefault = '${ps(plan.snapshot.extensionDefault.rawValue ?? "")}'`,
    "while ((Get-Process -Id $parentPid -ErrorAction SilentlyContinue) -and -not (Test-Path -LiteralPath $disarm) -and -not (Test-Path -LiteralPath $trigger)) { Start-Sleep -Milliseconds 200 }",
    "if (Test-Path -LiteralPath $disarm) { exit 0 }",
    "try { $currentExists = Test-Path -LiteralPath $extensionPath; $currentItem = if ($currentExists) { Get-Item -LiteralPath $extensionPath } else { $null }; $currentHasDefault = $null -ne $currentItem -and $currentItem.GetValueNames() -contains ''; $currentDefault = if ($currentHasDefault) { $currentItem.GetValue('', $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames) } else { $null }; $currentKind = if ($currentHasDefault) { [string]$currentItem.GetValueKind('') } else { $null }; $isApplied = $currentHasDefault -and $currentKind -eq 'String' -and [string]::Equals([string]$currentDefault, $testProgId, [System.StringComparison]::Ordinal); $isOriginal = if ($originalHadDefault) { $currentHasDefault -and $currentKind -eq $originalDefaultKind -and [string]::Equals([string]$currentDefault, $originalDefault, [System.StringComparison]::Ordinal) } else { -not $currentHasDefault }; if ($isApplied) { if ($originalHadDefault) { $key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Software\\Classes\\.ether'); try { $kind = [Microsoft.Win32.RegistryValueKind]$originalDefaultKind; $key.SetValue('', $originalDefault, $kind) } finally { $key.Close() } } else { reg.exe delete $extensionKey /ve /f | Out-Null; if ($LASTEXITCODE -ne 0) { throw 'Watchdog could not remove the temporary extension default.' } } } elseif (-not $isOriginal) { throw 'Watchdog refused to overwrite a concurrently changed extension default.' }; if (-not $extensionExisted -and (Test-Path -LiteralPath $extensionPath)) { $item = Get-Item -LiteralPath $extensionPath; if ($item.GetValueNames().Count -eq 0 -and $item.GetSubKeyNames().Count -eq 0) { Remove-Item -LiteralPath $extensionPath -Force } }; reg.exe query $testProgIdKey *> $null; if ($LASTEXITCODE -eq 0) { reg.exe delete $testProgIdKey /f | Out-Null; if ($LASTEXITCODE -ne 0) { throw 'Watchdog could not delete the temporary ProgID tree.' } }; Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class EtherA02AssociationWatchdog { [DllImport(\"shell32.dll\")] public static extern void SHChangeNotify(uint eventId, uint flags, IntPtr item1, IntPtr item2); }' -ErrorAction SilentlyContinue; [EtherA02AssociationWatchdog]::SHChangeNotify(0x08000000, 0, [IntPtr]::Zero, [IntPtr]::Zero); Set-Content -LiteralPath $complete -Value 'restored' -Encoding Ascii } catch { Set-Content -LiteralPath $failure -Value $_.Exception.Message -Encoding UTF8; exit 1 }"
  ].join("; ");
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Sta", "-EncodedCommand", encoded], {
    detached: true,
    stdio: "ignore",
    windowsHide: true
  });
  child.unref();
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    child.once("error", onError);
    child.once("spawn", () => { child.off("error", onError); resolve(); });
  });
  return { child, completePath, disarmPath, failurePath, triggerPath };
}

export async function disarmAssociationRestorationWatchdog(watchdog: AssociationRestorationWatchdog): Promise<void> {
  await writeFile(watchdog.disarmPath, "verified\n", "utf8");
  await waitForChildExit(watchdog.child, 15_000);
  if (await isFile(watchdog.failurePath)) throw new Error(`Association watchdog failed: ${await readFile(watchdog.failurePath, "utf8")}`);
}

export async function triggerAssociationRestorationWatchdog(watchdog: AssociationRestorationWatchdog): Promise<void> {
  await writeFile(watchdog.triggerPath, "restore\n", "utf8");
  await waitForChildExit(watchdog.child, 30_000);
  if (await isFile(watchdog.failurePath)) throw new Error(`Association watchdog failed: ${await readFile(watchdog.failurePath, "utf8")}`);
  if (!await isFile(watchdog.completePath)) throw new Error("Association watchdog exited without recording restoration.");
}

/** Uses Explorer UIA only to prove the exact focused item, then native Enter; it never shells the document directly. */
export async function invokeDocumentFromExplorerWithUia(input: { documentPath: string; etherPid: number }): Promise<string> {
  requireAssociationRouteApproval();
  return runPowerShell(buildExplorerAssociationInvokeScript(input));
}

/** Pure construction exposes the association interaction ordering to static contracts. */
export function buildExplorerAssociationInvokeScript(input: { documentPath: string; etherPid: number }): string {
  if (!Number.isSafeInteger(input.etherPid) || input.etherPid <= 0) throw new Error("Explorer association requires an exact positive Ether PID.");
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "Add-Type -AssemblyName UIAutomationClient",
    `Add-Type -TypeDefinition '${ASSOCIATION_NATIVE_TYPE_DEFINITION}' -ErrorAction SilentlyContinue`,
    `$document = '${ps(input.documentPath)}'`,
    `$etherPid = ${input.etherPid}`,
    "$documentFullPath = [System.IO.Path]::GetFullPath($document)",
    "$folder = [System.IO.Path]::GetDirectoryName($documentFullPath)",
    "$documentLeaf = [System.IO.Path]::GetFileName($documentFullPath)",
    exactEtherTopLevelWindowScript("EtherA02Native"),
    "$shell = New-Object -ComObject Shell.Application",
    exactExplorerSelectionFunctionsScript(),
    "$folderNamespace = $shell.NameSpace($folder); if ($null -eq $folderNamespace) { throw ('Shell namespace unavailable for exact document folder ' + $folder) }",
    "$parsedDocument = $folderNamespace.ParseName($documentLeaf); if ($null -eq $parsedDocument) { throw ('Shell namespace did not expose exact document leaf ' + $documentLeaf) }",
    "$parsedPath = [string]$parsedDocument.Path; if (-not [string]::Equals($parsedPath, $documentFullPath, [System.StringComparison]::OrdinalIgnoreCase)) { throw ('Shell ParseName path mismatch. Expected ' + $documentFullPath + '; observed ' + $parsedPath) }",
    "$displayName = [string]$parsedDocument.Name; if ([string]::IsNullOrWhiteSpace($displayName)) { throw 'Shell ParseName returned an empty Explorer display name' }",
    "$existingHwnd = @{}; foreach ($window in @($shell.Windows())) { try { $existingHwnd[[string]$window.HWND] = $true } catch {} }",
    "Start-Process explorer.exe -ArgumentList ('/n,/select,\"' + $documentFullPath + '\"') | Out-Null",
    "$deadline = [DateTime]::UtcNow.AddSeconds(15)",
    "$explorerPid = $null",
    "$matchedWindow = $null",
    "$item = $null",
    "while ([DateTime]::UtcNow -lt $deadline -and $null -eq $item) {",
    "  if ($null -eq $matchedWindow) { foreach ($window in @($shell.Windows())) { try { if (-not $existingHwnd.ContainsKey([string]$window.HWND) -and [string]::Equals(([uri]$window.LocationURL).LocalPath.TrimEnd('\\'), $folder.TrimEnd('\\'), [System.StringComparison]::OrdinalIgnoreCase)) { $matchedWindow = $window; break } } catch {} } }",
    "  if ($null -eq $matchedWindow) { Start-Sleep -Milliseconds 150; continue }",
    "  [uint32]$nativePid = 0; [EtherA02Native]::GetWindowThreadProcessId([intptr]$matchedWindow.HWND, [ref]$nativePid) | Out-Null; if ($nativePid -eq 0) { throw 'Exact Explorer HWND PID was zero' }; $explorerPid = [int64]$nativePid",
    "  $condition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, $displayName)",
    "  $windowRoot = [System.Windows.Automation.AutomationElement]::FromHandle([intptr]$matchedWindow.HWND)",
    "  $candidates = $windowRoot.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)",
    "  if ($candidates.Count -gt 1) { throw ('Exact new Explorer window exposed multiple items named ' + $displayName) }",
    `  if ($candidates.Count -eq 1) { ${exactExplorerSelectedDocumentMatchesScript()}; if ($selectionMatches) { $item = $candidates[0] } }`,
    "  if ($null -eq $item) { Start-Sleep -Milliseconds 150 }",
    "}",
    "if ($null -eq $item) { if ($null -ne $matchedWindow) { $matchedWindow.Quit() }; throw ('A newly created Explorer HWND did not expose exact test-owned display item ' + $displayName) }",
    "$buttonDown = $false",
    `try { $explorerHwnd = [intptr]$matchedWindow.HWND; if ($explorerHwnd -eq [intptr]::Zero) { throw 'Association chrome: exact Explorer HWND is zero' }; if (-not [EtherA02Native]::SetWindowPos($explorerHwnd, [intptr]::Zero, 40, 40, 0, 0, 0x0015)) { throw 'Association chrome: could not arrange exact Explorer HWND without activation' }; Start-Sleep -Milliseconds 150; $windowRoot = [System.Windows.Automation.AutomationElement]::FromHandle($explorerHwnd); $explorerBounds = $windowRoot.Current.BoundingRectangle; if ($explorerBounds.Left -lt 0 -or $explorerBounds.Top -lt 0 -or $explorerBounds.Width -le 4 -or $explorerBounds.Height -le 4) { throw 'Association chrome: exact Explorer frame has no positive safe bounds' }; $clickX = [int]($explorerBounds.Left + 2); $clickY = [int]($explorerBounds.Top + 2); $clientOrigin = New-Object EtherA02Native+POINT; if (-not [EtherA02Native]::ClientToScreen($explorerHwnd,[ref]$clientOrigin) -or $clickY -ge $clientOrigin.Y) { throw 'Association chrome: click is not non-client frame' }; ${exactWindowRootAtPointScript("EtherA02Native", "$clickX", "$clickY", "$explorerHwnd", "Association chrome")}; [EtherA02Native]::SetCursorPos($clickX, $clickY) | Out-Null; [EtherA02Native]::mouse_event(0x0002,0,0,0,[UIntPtr]::Zero); $buttonDown = $true; [EtherA02Native]::mouse_event(0x0004,0,0,0,[UIntPtr]::Zero); $buttonDown = $false; ${exactExplorerForegroundIdentityScript("EtherA02Native", "After association chrome click")}; $condition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, $displayName); $candidates = $windowRoot.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition); if ($candidates.Count -ne 1) { throw 'Association Invoke: exact Explorer HWND no longer exposes one display item' }; $item = $candidates[0]; ${exactExplorerSelectedDocumentScript("Immediately before association Invoke")}; $pattern = $item.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern); if ($null -eq $pattern) { throw 'Explorer item has no UI Automation InvokePattern after chrome click' }; if (-not [EtherA02Native]::IsIconic($etherHwnd)) { throw 'Exact Ether target did not remain minimized before association Invoke' }; ${exactExplorerForegroundIdentityScript("EtherA02Native", "Immediately before association Invoke")}; $activationStartedAt = [DateTime]::UtcNow; ([System.Windows.Automation.InvokePattern]$pattern).Invoke(); ${exactEtherForegroundTransitionScript("EtherA02Native", "association Invoke")}; Write-Output ('uia-invoked click=(' + $clickX + ',' + $clickY + ') sourceHwnd=' + $explorerHwnd + ' sourcePid=' + $explorerPid + ' targetHwnd=' + $etherHwnd + ' targetPid=' + $etherPid + ' latencyMs=' + $transitionLatencyMs + ' inserted=' + $inserted + ' returnReleased=' + $returnReleased + ' samples=' + $stabilitySample + ' folder=' + $folder + ' displayName=' + $displayName) } finally { if ($buttonDown) { [EtherA02Native]::mouse_event(0x0004,0,0,0,[UIntPtr]::Zero) }; if ($null -ne $matchedWindow) { $matchedWindow.Quit() } }`
  ].join("; ");
  return compactAssociationScript(hardenAssociationPointerScript(script));
}

function hardenAssociationPointerScript(script: string): string {
  const actualPointCheck = exactWindowRootAtPointScript("EtherA02Native", "$cursor.X", "$cursor.Y", "$explorerHwnd", "Association chrome actual cursor");
  const invokeActivation = [
    "$item = $candidates[0]",
    "A 'Immediately before association Invoke'",
    "$pattern = $item.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)",
    "if ($null -eq $pattern) { throw 'Explorer item has no UI Automation InvokePattern after chrome click' }",
    "if (-not [EtherA02Native]::IsIconic($etherHwnd)) { throw 'Exact Ether target did not remain minimized before association Invoke' }",
    exactExplorerForegroundIdentityScript("EtherA02Native", "Immediately before association Invoke"),
    "$activationStartedAt = [DateTime]::UtcNow",
    "([System.Windows.Automation.InvokePattern]$pattern).Invoke()",
    exactEtherForegroundTransitionScript("EtherA02Native", "association Invoke")
  ].join("; ");
  const nativeEnterActivation = [
    "$item = $candidates[0]",
    "A 'Enter'",
    "$itemRuntimeId = [string]::Join(',', @($item.GetRuntimeId()))",
    "try { $item.SetFocus() } catch { throw 'Enter:focus' }",
    "$stabilitySample = 0",
    "for($stabilitySample=0;$stabilitySample -lt 2;$stabilitySample++){",
    "$stableCandidates=$windowRoot.FindAll([System.Windows.Automation.TreeScope]::Descendants,$condition)",
    "if($stableCandidates.Count -ne 1){throw 'Enter:stability'}",
    "$stableItem=$stableCandidates[0]",
    "A 'E'",
    "if([string]::Join(',',@($stableItem.GetRuntimeId())) -ne $itemRuntimeId){throw 'Enter:stability'}",
    "if(-not $stableItem.Current.IsEnabled -or $stableItem.Current.IsOffscreen -or -not $stableItem.Current.IsKeyboardFocusable -or -not $stableItem.Current.HasKeyboardFocus){throw 'Enter:state'}",
    "$focused=[System.Windows.Automation.AutomationElement]::FocusedElement",
    "if($null -eq $focused -or [string]::Join(',',@($focused.GetRuntimeId())) -ne $itemRuntimeId){throw 'Enter:stability'}",
    compactExplorerForegroundIdentityScript("EtherA02Native"),
    "if(-not [EtherA02Native]::IsIconic($etherHwnd)){throw 'Enter:minimized'}",
    "[uint32]$stableEtherPid=0;[EtherA02Native]::GetWindowThreadProcessId($etherHwnd,[ref]$stableEtherPid)|Out-Null;if($stableEtherPid -eq 0 -or [int64]$stableEtherPid -ne $etherPid){throw 'Enter:stability'}",
    "if($stabilitySample -eq 0){Start-Sleep -Milliseconds 50}",
    "}",
    "$inputSize = [EtherA02Native]::InputSize(); if (([IntPtr]::Size -eq 8 -and $inputSize -ne 40) -or ([IntPtr]::Size -eq 4 -and $inputSize -ne 28)) { throw ('Enter:INPUT ABI size ' + $inputSize) }",
    "$returnDown = $false",
    "try { $activationStartedAt = [DateTime]::UtcNow; $returnDown = $true; $enterInputs = [EtherA02Native]::EnterPair(); $inserted = [EtherA02Native]::SendInput(2,$enterInputs,$inputSize); if ($inserted -lt 1) { $returnDown = $false }; if ($inserted -ne 2) { $insertError = [Runtime.InteropServices.Marshal]::GetLastWin32Error(); throw ('Enter:SendInput inserted ' + $inserted + '/2; lastError=' + $insertError) }; $returnDown = $false; $returnReleased = [EtherA02Native]::ReturnReleased(); if (-not $returnReleased) { throw 'Enter:key-state VK_RETURN high bit did not clear' }",
    compactEtherForegroundTransitionScript("EtherA02Native"),
    "} finally { if ($returnDown) { $releaseInputs = [EtherA02Native]::EnterRelease(); $releaseInserted = [EtherA02Native]::SendInput(1,$releaseInputs,$inputSize); if ($releaseInserted -ne 1) { $releaseError = [Runtime.InteropServices.Marshal]::GetLastWin32Error(); throw ('Enter:cleanup SendInput inserted ' + $releaseInserted + '/1; lastError=' + $releaseError) } } }"
  ].join("; ");
  return script
    .replace("$clickX = [int]($explorerBounds.Left + 2); $clickY = [int]($explorerBounds.Top + 2)", "$clickX = [int]($explorerBounds.Left + 2); $clickY = [int][Math]::Round($explorerBounds.Top + ($explorerBounds.Height / 2))")
    .replace("$clickY -ge $clientOrigin.Y", "$clickX -ge $clientOrigin.X")
    .replace(invokeActivation, nativeEnterActivation)
    .replace("uia-invoked", "native-enter")
    .replace(
      "[EtherA02Native]::SetCursorPos($clickX, $clickY) | Out-Null",
      `if (-not [EtherA02Native]::SetCursorPos($clickX,$clickY)) { throw 'Association chrome: cursor placement failed' }; $cursor = New-Object EtherA02Native+POINT; if (-not [EtherA02Native]::GetCursorPos([ref]$cursor)) { throw 'Association chrome: cursor read failed' }; if($cursor.X -ne $clickX -or $cursor.Y -ne $clickY){throw 'Association chrome: cursor readback mismatch'}; ${actualPointCheck}; $lParam = [intptr](($cursor.Y -shl 16) -bor ($cursor.X -band 0xffff)); $hit = [int][EtherA02Native]::SendMessage($explorerHwnd,0x84,[intptr]::Zero,$lParam); if ($hit -in 1,3,8,9,20) { throw 'Association chrome: interactive hit test rejected' }; if ($hit -notin 10,11,12,13,14,15,16,17) { throw 'Association chrome: non-inert hit test rejected' }`
    );
}

function compactAssociationScript(script: string): string {
  return script
    .replaceAll("$documentFullPath", "$d")
    .replaceAll("$documentLeaf", "$l")
    .replaceAll("$folderNamespace", "$ns")
    .replaceAll("$document", "$doc")
    .replaceAll("$folder", "$f")
    .replaceAll("$parsedDocument", "$pd")
    .replaceAll("$parsedPath", "$pp")
    .replaceAll("$displayName", "$n")
    .replaceAll("$shell", "$sh")
    .replaceAll("$existingHwnd", "$eh")
    .replaceAll("$matchedWindow", "$mw")
    .replaceAll("$windowRoot", "$wr")
    .replaceAll("$explorerBounds", "$eb")
    .replaceAll("$explorerPid", "$ep")
    .replaceAll("$condition", "$c")
    .replaceAll("$root", "$rt")
    .replaceAll("$deadline", "$dl")
    .replaceAll("$nativePid", "$np")
    .replaceAll("$selectionMatches", "$sm")
    .replaceAll("$buttonDown", "$bd")
    .replaceAll("$candidates", "$cs")
    .replaceAll("$clientOrigin", "$co")
    .replaceAll("$clickX", "$cx")
    .replaceAll("$clickY", "$cy")
    .replaceAll("$cursor", "$cu")
    .replaceAll("$resolvedEtherPid", "$rp")
    .replaceAll("$etherCondition", "$ec")
    .replaceAll("$etherWindows", "$ew")
    .replaceAll("$activationDeadline", "$ad")
    .replaceAll("$foregroundTransitioned", "$ft")
    .replaceAll("$foregroundHwnd", "$fh")
    .replaceAll("$foregroundExplorerPid", "$fp")
    .replaceAll("$foregroundPid", "$fpid")
    .replaceAll("$itemRuntimeId", "$ir")
    .replaceAll("$focused", "$fo")
    .replaceAll("$stabilitySample", "$ss")
    .replaceAll("$stableCandidates", "$sc")
    .replaceAll("$stableItem", "$si")
    .replaceAll("$stableRuntimeId", "$sr")
    .replaceAll("$stableEtherPid", "$sp")
    .replaceAll("$returnDown", "$rd")
    .replaceAll("$activationStartedAt", "$as")
    .replaceAll("$enterInputs", "$ei")
    .replaceAll("$inserted", "$in")
    .replaceAll("$insertError", "$ie")
    .replaceAll("$vkReturn", "$vk")
    .replaceAll("$returnReleased", "$rr")
    .replaceAll("$returnDeadline", "$rl")
    .replaceAll("$releaseInputs", "$ri")
    .replaceAll("$releaseInserted", "$rn")
    .replaceAll("$releaseError", "$re")
    .replaceAll("$inputSize", "$iz")
    .replaceAll("$explorerHwnd", "$xh")
    .replaceAll("$etherHwnd", "$th")
    .replaceAll("$etherPid", "$tp")
    .replaceAll("$transitionLatencyMs", "$lm")
    .replaceAll("Exact Explorer selected-item path mismatch", "A02E:selection-path")
    .replaceAll("Shell ParseName returned an empty Explorer display name", "A02E:display-name")
    .replaceAll("Exact Explorer HWND PID was zero", "A02E:explorer-pid-zero")
    .replaceAll("Association chrome: exact Explorer HWND is zero", "A02E:chrome-hwnd-zero")
    .replaceAll("Association chrome: could not arrange exact Explorer HWND without activation", "A02E:chrome-arrange")
    .replaceAll("Association chrome: exact Explorer frame has no positive safe bounds", "A02E:chrome-bounds")
    .replaceAll("Association chrome: click is not non-client frame", "A02E:chrome-frame")
    .replaceAll("Association chrome: no hit", "A02E:chrome-no-hit")
    .replaceAll("Association chrome: WindowFromPoint root was not the exact expected HWND", "A02E:chrome-hit-root")
    .replaceAll("Association chrome: cursor placement failed", "A02E:cursor-place")
    .replaceAll("Association chrome: cursor read failed", "A02E:cursor-read")
    .replaceAll("Association chrome: cursor readback mismatch", "A02E:cursor-mismatch")
    .replaceAll("Association chrome actual cursor: no hit", "A02E:cursor-no-hit")
    .replaceAll("Association chrome actual cursor: WindowFromPoint root was not the exact expected HWND", "A02E:cursor-hit-root")
    .replaceAll("Association chrome: interactive hit test rejected", "A02E:chrome-interactive")
    .replaceAll("Association chrome: non-inert hit test rejected", "A02E:chrome-non-inert")
    .replaceAll("After association chrome click: exact Explorer HWND is zero", "A02E:after-hwnd-zero")
    .replaceAll("After association chrome click: exact Explorer HWND was not foreground", "A02E:after-foreground")
    .replaceAll("After association chrome click: Explorer HWND PID mismatch immediately before action", "A02E:after-pid")
    .replaceAll("Association Invoke: exact Explorer HWND no longer exposes one display item", "A02E:item-missing")
    .replaceAll("Expected one exact nonzero top-level Ether HWND for PID ", "A02E:ether-hwnd ")
    .replaceAll("Exact Ether HWND PID mismatch. Expected ", "A02E:ether-pid ")
    .replaceAll("A newly created Explorer HWND did not expose exact test-owned display item ", "A02E:explorer-item ")
    .replaceAll("Shell namespace unavailable for exact document folder ", "A02E:shell-folder ")
    .replaceAll("Shell namespace did not expose exact document leaf ", "A02E:shell-leaf ")
    .replaceAll("Shell ParseName path mismatch. Expected ", "A02E:parse-path ")
    .replaceAll("Exact new Explorer window exposed multiple items named ", "A02E:duplicate-item ")
    .replaceAll("Enter:key-state VK_RETURN high bit did not clear", "A02E:return-state")
    .replaceAll("; ", ";");
}

export type NativeScreenPoint = { x: number; y: number };

function exactExplorerSelectedDocumentScript(stage: string): string {
  return `A '${stage}'`;
}

function exactExplorerSelectedDocumentMatchesScript(): string {
  return "$selectionMatches = T";
}

function exactExplorerSelectionFunctionsScript(): string {
  return [
    "function T { try { $s = $matchedWindow.Document.SelectedItems(); return $null -ne $s -and $s.Count -eq 1 -and [string]::Equals([string]$s.Item(0).Path,$documentFullPath,[System.StringComparison]::OrdinalIgnoreCase) } catch { return $false } }",
    "function A($g) { $s = $matchedWindow.Document.SelectedItems(); if ($null -eq $s -or $s.Count -ne 1) { throw ($g + ': one selected item required') }; $p = [string]$s.Item(0).Path; if (-not [string]::Equals($p,$documentFullPath,[System.StringComparison]::OrdinalIgnoreCase)) { throw 'Exact Explorer selected-item path mismatch' } }"
  ].join("; ");
}

function exactEtherTopLevelWindowScript(nativeType: string): string {
  return [
    "$root = [System.Windows.Automation.AutomationElement]::RootElement",
    "$etherCondition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $etherPid)",
    "$etherWindows = @($root.FindAll([System.Windows.Automation.TreeScope]::Children, $etherCondition) | Where-Object { $_.Current.NativeWindowHandle -ne 0 })",
    "if ($etherWindows.Count -ne 1) { throw ('Expected one exact nonzero top-level Ether HWND for PID ' + $etherPid + '; found ' + $etherWindows.Count) }",
    "$etherHwnd = [intptr]$etherWindows[0].Current.NativeWindowHandle",
    `[uint32]$resolvedEtherPid = 0; [${nativeType}]::GetWindowThreadProcessId($etherHwnd, [ref]$resolvedEtherPid) | Out-Null; if ([int]$resolvedEtherPid -ne $etherPid) { throw ('Exact Ether HWND PID mismatch. Expected ' + $etherPid + '; observed ' + $resolvedEtherPid) }`
  ].join("; ");
}

function exactExplorerForegroundIdentityScript(nativeType: string, stage: string): string {
  return [
    "$explorerHwnd = [intptr]$matchedWindow.HWND",
    `if ($explorerHwnd -eq [intptr]::Zero) { throw '${stage}: exact Explorer HWND is zero' }`,
    `if ([${nativeType}]::GetForegroundWindow() -ne $explorerHwnd) { throw '${stage}: exact Explorer HWND was not foreground' }`,
    `[uint32]$foregroundExplorerPid = 0; [${nativeType}]::GetWindowThreadProcessId($explorerHwnd, [ref]$foregroundExplorerPid) | Out-Null; if ($foregroundExplorerPid -eq 0 -or [int64]$foregroundExplorerPid -ne $explorerPid) { throw '${stage}: Explorer HWND PID mismatch immediately before action' }`
  ].join("; ");
}

function compactExplorerForegroundIdentityScript(nativeType: string): string {
  return [
    "$explorerHwnd=[intptr]$matchedWindow.HWND",
    "if($explorerHwnd -eq [intptr]::Zero){throw 'Enter:explorer-hwnd'}",
    `if([${nativeType}]::GetForegroundWindow() -ne $explorerHwnd){throw 'Enter:explorer-foreground'}`,
    `[uint32]$foregroundExplorerPid=0;[${nativeType}]::GetWindowThreadProcessId($explorerHwnd,[ref]$foregroundExplorerPid)|Out-Null;if($foregroundExplorerPid -eq 0 -or [int64]$foregroundExplorerPid -ne $explorerPid){throw 'Enter:explorer-pid'}`
  ].join(";");
}

function exactWindowRootAtPointScript(nativeType: string, x: string, y: string, expectedHwnd: string, stage: string): string {
  return [
    `$hitPoint = New-Object ${nativeType}+POINT; $hitPoint.X = [int]${x}; $hitPoint.Y = [int]${y}`,
    `$hitHwnd = [${nativeType}]::WindowFromPoint($hitPoint); if ($hitHwnd -eq [intptr]::Zero) { throw '${stage}: no hit' }`,
    `$hitRoot = [${nativeType}]::GetAncestor($hitHwnd, 2); if ($hitRoot -ne ${expectedHwnd}) { throw '${stage}: WindowFromPoint root was not the exact expected HWND' }`
  ].join("; ");
}

function exactEtherForegroundTransitionScript(nativeType: string, stage: string): string {
  return [
    "$activationDeadline = [DateTime]::UtcNow.AddSeconds(15)",
    "$foregroundTransitioned = $false",
    "while ([DateTime]::UtcNow -lt $activationDeadline -and -not $foregroundTransitioned) {",
    `  $foregroundHwnd = [${nativeType}]::GetForegroundWindow(); if ($foregroundHwnd -eq $etherHwnd) { [uint32]$foregroundPid = 0; [${nativeType}]::GetWindowThreadProcessId($foregroundHwnd, [ref]$foregroundPid) | Out-Null; if ([int]$foregroundPid -eq $etherPid) { $foregroundTransitioned = $true; break } }; Start-Sleep -Milliseconds 50`,
    "}",
    `if (-not $foregroundTransitioned) { throw '${stage}: foreground did not transition from the exact Explorer HWND to the exact Ether HWND/PID' }`,
    "$transitionLatencyMs = [int]([DateTime]::UtcNow - $activationStartedAt).TotalMilliseconds"
  ].join("; ");
}

function compactEtherForegroundTransitionScript(nativeType: string): string {
  return [
    "$activationDeadline=[DateTime]::UtcNow.AddSeconds(15)",
    "$foregroundTransitioned=$false",
    `while([DateTime]::UtcNow -lt $activationDeadline -and -not $foregroundTransitioned){$foregroundHwnd=[${nativeType}]::GetForegroundWindow();if($foregroundHwnd -eq $etherHwnd){[uint32]$foregroundPid=0;[${nativeType}]::GetWindowThreadProcessId($foregroundHwnd,[ref]$foregroundPid)|Out-Null;if([int]$foregroundPid -eq $etherPid){$foregroundTransitioned=$true;break}};Start-Sleep -Milliseconds 50}`,
    "if(-not $foregroundTransitioned){throw 'Enter:transition'}",
    "$transitionLatencyMs=[int]([DateTime]::UtcNow-$activationStartedAt).TotalMilliseconds"
  ].join(";");
}

/**
 * Sends a real OS pointer drag from the uniquely named Explorer item to a
 * caller-supplied point inside one exact packaged Ether window. No renderer
 * DataTransfer, bridge, or synthetic DOM drop is involved.
 */
export async function dragDocumentFromExplorerWithNativePointer(input: {
  diagnostic: DragDiagnosticSidecar;
  documentPath: string;
  etherPid: number;
  target: NativeScreenPoint;
}): Promise<string> {
  requireExplorerDragRouteApproval();
  assertDragDiagnosticSidecar(input.diagnostic);
  return runTrackedNativeExplorerDrag(input, buildNativeExplorerDragScript(input));
}

async function runTrackedNativeExplorerDrag(input: { diagnostic: DragDiagnosticSidecar }, script: string): Promise<string> {
  assertPowerShellEncodedCommandLength(script);
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  const stageNames: Record<string, DragDiagnosticStage> = { f: "source-foreground-proven", h: "threshold-crossed", m: "mouse-down-sent", r: "released", t: "target-proven", u: "release-attempted", v: "transition-proven" };
  const observedStages = new Set<DragDiagnosticStage>();
  let partialLine = "";
  let stageWrites = Promise.resolve();
  let terminal = false;
  let watchdog: DragWatchdog | undefined;
  let goPublished = false;
  let timeoutHandle: NodeJS.Timeout | undefined;
  const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Sta", "-EncodedCommand", encoded], {
    env: {
      ...process.env,
      ETHER_A02_DRAG_ARM_PATH: input.diagnostic.armPath,
      ETHER_A02_DRAG_DEADLINE: String(input.diagnostic.deadlineEpochMs),
      ETHER_A02_DRAG_PARENT_PID: String(input.diagnostic.parentPid),
      ETHER_A02_DRAG_SIDECAR_PATH: input.diagnostic.sidecarPath,
      ETHER_A02_DRAG_TOKEN: input.diagnostic.token
    },
    stdio: ["ignore", "pipe", "pipe"], windowsHide: true
  });
  const childProcessError = collectChildProcessError(child, "Explorer drag child");
  try {
    // Containment starts immediately after spawn, before any diagnostic or watchdog await.
    const childPid = child.pid;
    const exited = onceChildExit(child);
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout.push(chunk);
      const observedChildPid = child.pid;
      if (terminal || observedChildPid === undefined || observedChildPid <= 0) return;
      const lines = `${partialLine}${chunk.toString("utf8")}`.split(/\r?\n/u);
      partialLine = lines.pop() ?? "";
      for (const line of lines) {
        const [, code, down, releaseAttempted] = /^A02D\|([apmfhturv])\|([01])\|([01])$/u.exec(line) ?? [];
        const stage = code === undefined ? undefined : stageNames[code];
        if (stage !== undefined) {
          observedStages.add(stage);
          stageWrites = stageWrites.then(() => writeDragDiagnosticStage(input.diagnostic, stage, { childPid: observedChildPid, down: down === "1", releaseAttempted: releaseAttempted === "1" }));
        }
      }
    });
    child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));
    if (childPid === undefined || childPid <= 0) throw new Error("Explorer drag did not create a retained PowerShell child PID.");
    await writeDragDiagnosticStage(input.diagnostic, "prepared", { childPid, down: false, releaseAttempted: false });
    watchdog = await startDragReleaseWatchdog({ ...input.diagnostic, childPid });
    await assertWatchdogReady(watchdog);
    if (Date.now() >= input.diagnostic.deadlineEpochMs) throw new Error("Explorer drag watchdog setup exceeded its internal deadline before GO.");
    await writeDragDiagnosticStage(input.diagnostic, "release-armed", { childPid, down: false, releaseAttempted: false });
    await writeTokenBoundDurableFile(input.diagnostic.armPath, dragControlToken(input.diagnostic, childPid, "go"));
    goPublished = true;
    const timeout = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => reject(new Error("Explorer drag exceeded its internal deadline.")), Math.max(1, input.diagnostic.deadlineEpochMs - Date.now()));
    });
    const exit = await Promise.race([exited, timeout]);
    if (exit.code !== 0 || exit.signal !== null) {
      throw new Error(`Explorer drag child failed code=${exit.code ?? "none"} signal=${exit.signal ?? "none"}: ${Buffer.concat(stderr).toString("utf8").trim()}`);
    }
    await stageWrites;
    await reportRecordedChildProcessError(childProcessError, childPid === undefined);
    if (!observedStages.has("transition-proven")) {
      throw new Error("Explorer drag child did not persist exact release/transition proof.");
    }
    await writeDragDiagnosticStage(input.diagnostic, "transition-proven", { childPid, down: false, releaseAttempted: true });
    return Buffer.concat(stdout).toString("utf8").trim();
  } catch (error) {
    const retainedChildPid = child.pid;
    const recoveryFailures = await runAllDragRecoverySteps({
      awaitRetainedChildExit: () => assertRetainedChildExit(child, retainedChildPid),
      cancelPreGoWatchdog: watchdog === undefined ? undefined : () => cancelPreGoDragReleaseWatchdog(watchdog!),
      drainStageWrites: () => stageWrites,
      goPublished,
      independentRelease: async () => {
        if (retainedChildPid === undefined) throw new Error("Explorer drag had no exact child PID for independent release.");
        await independentDragLeftUp(input.diagnostic, retainedChildPid);
      },
      latchTerminal: () => { terminal = true; },
      persistAbortRequested: () => writeDragDiagnosticStage(input.diagnostic, "abort-requested", { childPid: retainedChildPid ?? 0, down: true, releaseAttempted: false }),
      reportRecordedProcessError: () => reportRecordedChildProcessError(childProcessError, retainedChildPid === undefined),
      releaseWatchdog: watchdog === undefined ? undefined : () => assertWatchdogReleased(watchdog!),
      terminateRetainedChild: () => terminateRetainedChild(child, retainedChildPid)
    });
    throw withDragRecoveryFailures(error, recoveryFailures);
  } finally {
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
    if (!terminal && watchdog !== undefined) await disarmDragReleaseWatchdog(watchdog);
  }
}

export type DragRecoveryOperations = {
  awaitRetainedChildExit: () => Promise<void>;
  cancelPreGoWatchdog?: () => Promise<void>;
  drainStageWrites: () => Promise<void>;
  goPublished: boolean;
  independentRelease: () => Promise<void>;
  latchTerminal: () => void;
  persistAbortRequested: () => Promise<void>;
  reportRecordedProcessError?: () => Promise<void>;
  releaseWatchdog?: () => Promise<void>;
  terminateRetainedChild: () => Promise<void>;
};

/** Pure recovery seam: every applicable teardown proof is attempted even when an earlier one fails. */
export async function runAllDragRecoverySteps(operations: DragRecoveryOperations): Promise<Error[]> {
  const failures: Error[] = [];
  const attempt = async (name: string, action: () => Promise<void>): Promise<void> => {
    try { await action(); } catch (error) { failures.push(new Error(`Explorer drag recovery ${name} failed.`, { cause: error })); }
  };
  try { operations.latchTerminal(); } catch (error) { failures.push(new Error("Explorer drag recovery terminal latch failed.", { cause: error })); }
  await attempt("stage drain", operations.drainStageWrites);
  await attempt("durable abort-requested", operations.persistAbortRequested);
  await attempt("retained child termination", operations.terminateRetainedChild);
  if (operations.goPublished) await attempt("independent release", operations.independentRelease);
  await attempt("retained child exit", operations.awaitRetainedChildExit);
  if (operations.goPublished) {
    if (operations.releaseWatchdog !== undefined) await attempt("watchdog release/result proof", operations.releaseWatchdog);
  } else if (operations.cancelPreGoWatchdog !== undefined) {
    await attempt("pre-GO watchdog cancel/exit/result proof", operations.cancelPreGoWatchdog);
  }
  if (operations.reportRecordedProcessError !== undefined) await attempt("recorded process error", operations.reportRecordedProcessError);
  return failures;
}

function withDragRecoveryFailures(original: unknown, recoveryFailures: Error[]): unknown {
  return recoveryFailures.length === 0
    ? original
    : new AggregateError([original, ...recoveryFailures], "Explorer drag failed and recovery was incomplete.", { cause: original });
}

async function terminateRetainedChild(child: ChildProcess, childPid: number | undefined): Promise<void> {
  if (childPid === undefined || childPid <= 0) return;
  if (child.pid !== childPid) throw new Error("Explorer drag retained child PID changed before termination.");
  if (!hasChildExited(child) && !child.kill()) throw new Error("Explorer drag retained child could not be terminated.");
}

async function assertRetainedChildExit(child: ChildProcess, childPid: number | undefined): Promise<void> {
  if (childPid === undefined || childPid <= 0) return;
  if (child.pid !== childPid) throw new Error("Explorer drag retained child PID changed before exit proof.");
  await Promise.race([onceChildExit(child), delay(5_000)]);
  if (!hasChildExited(child)) throw new Error("Explorer drag retained child did not exit after the bounded abort request.");
}

type ChildProcessErrorCollector = { get: () => Error | undefined; waitForOutcome: () => Promise<void> };

function collectChildProcessError(child: ChildProcess, label: string): ChildProcessErrorCollector {
  let recorded: Error | undefined;
  let settleOutcome: (() => void) | undefined;
  const outcome = new Promise<void>((resolve) => { settleOutcome = resolve; });
  const settle = () => { settleOutcome?.(); settleOutcome = undefined; };
  child.on("error", (error) => {
    recorded ??= error instanceof Error ? error : new Error(`${label} emitted a non-Error process failure.`, { cause: error });
    settle();
  });
  child.once("spawn", settle);
  child.once("exit", settle);
  return { get: () => recorded, waitForOutcome: () => outcome };
}

async function reportRecordedChildProcessError(collector: ChildProcessErrorCollector, awaitOutcome: boolean): Promise<void> {
  if (awaitOutcome) await Promise.race([collector.waitForOutcome(), delay(250)]);
  const error = collector.get();
  if (error !== undefined) throw new Error("Explorer drag retained process emitted an error event.", { cause: error });
}

function hasChildExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

type DragWatchdog = DragDiagnosticSidecar & { child: ChildProcess; childPid: number; disarmPath: string; failurePath: string; processError: ChildProcessErrorCollector; readyPath: string; resultPath: string };

async function startDragReleaseWatchdog(input: DragDiagnosticSidecar & { childPid: number }): Promise<DragWatchdog> {
  const disarmPath = `${input.sidecarPath}.watchdog-disarm`;
  const failurePath = `${input.sidecarPath}.watchdog-failure`;
  const readyPath = `${input.sidecarPath}.watchdog-ready`;
  const resultPath = `${input.sidecarPath}.watchdog-result`;
  const script = [
    "$ErrorActionPreference='Stop'",
    `$token='${ps(input.token)}'; $arm='${ps(input.armPath)}'; $disarm='${ps(disarmPath)}'; $failure='${ps(failurePath)}'; $ready='${ps(readyPath)}'; $result='${ps(resultPath)}'; $childPid=${input.childPid}; $parentPid=${input.parentPid}; $deadlineMs=${input.deadlineEpochMs}`,
    "Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class EtherA02DragWatchdog { [DllImport(\"user32.dll\")] public static extern uint SendInput(uint n, INPUT[] i, int s); [DllImport(\"user32.dll\")] public static extern short GetAsyncKeyState(int v); [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public MOUSEINPUT mi; } [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT { public int dx,dy; public uint data,flags,time; public IntPtr extra; } public static uint Up() { var i=new INPUT[]{new INPUT{type=0,mi=new MOUSEINPUT{flags=0x0004}}}; return SendInput(1,i,Marshal.SizeOf(typeof(INPUT))); } }' -ErrorAction SilentlyContinue",
    "function F($p,$v){$q=$p+'.tmp';$b=[Text.Encoding]::UTF8.GetBytes($v);$s=[IO.File]::Open($q,[IO.FileMode]::Create,[IO.FileAccess]::Write,[IO.FileShare]::None);try{$s.Write($b,0,$b.Length);$s.Flush($true)}finally{$s.Dispose()};Move-Item -LiteralPath $q -Destination $p -Force}",
    "function R($k,$c,$s){F $result (([pscustomobject]@{token=$token;childPid=$childPid;parentPid=$parentPid;deadlineEpochMs=$deadlineMs;kind=$k;eventCount=$c;asyncKeyState=$s}|ConvertTo-Json -Compress))}",
    "function V($p,$kind){if(-not(Test-Path -LiteralPath $p)){return $false};return ((Get-Content -LiteralPath $p -Raw).Trim() -eq ($token+'|'+$childPid+'|'+$parentPid+'|'+$deadlineMs+'|'+$kind))}",
    "try { F $ready ($token+'|'+$childPid+'|'+$parentPid+'|'+$deadlineMs+'|ready'); $go=$false; while([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() -lt $deadlineMs -and -not $go){if(V $arm 'go'){$go=$true;break};if(V $disarm 'cancel' -or V $disarm 'disarm'){R 'cancelled-pre-go' 0 0;exit 0};if(-not(Get-Process -Id $parentPid -ErrorAction SilentlyContinue)){R 'parent-dead-pre-go' 0 0;exit 0};if(-not(Get-Process -Id $childPid -ErrorAction SilentlyContinue)){R 'child-dead-pre-go' 0 0;exit 0};Start-Sleep -Milliseconds 25};if(-not $go){R 'deadline-pre-go' 0 0;exit 0};while([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() -lt $deadlineMs){if(V $disarm 'disarm'){R 'disarmed' 0 0;exit 0};if(-not(Get-Process -Id $parentPid -ErrorAction SilentlyContinue) -or -not(Get-Process -Id $childPid -ErrorAction SilentlyContinue)){break};Start-Sleep -Milliseconds 50};$count=[EtherA02DragWatchdog]::Up();$state=[EtherA02DragWatchdog]::GetAsyncKeyState(1);R 'released' $count $state}catch{F $failure $_.Exception.Message;exit 2}"
  ].join("; ");
  assertPowerShellEncodedCommandLength(script);
  const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Sta", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], { detached: true, stdio: "ignore", windowsHide: true });
  const processError = collectChildProcessError(child, "Explorer drag watchdog");
  if (child.pid === undefined || child.pid <= 0) {
    await reportRecordedChildProcessError(processError, true);
    throw new Error("Explorer drag watchdog did not create a retained PID.");
  }
  return { ...input, child, disarmPath, failurePath, processError, readyPath, resultPath };
}

async function disarmDragReleaseWatchdog(watchdog: DragWatchdog): Promise<void> {
  const failures: unknown[] = [];
  try { await writeTokenBoundDurableFile(watchdog.disarmPath, dragControlToken(watchdog, watchdog.childPid, "disarm")); } catch (error) { failures.push(error); }
  try { await assertWatchdogTerminal(watchdog, ["disarmed", "released"]); } catch (error) { failures.push(error); }
  if (failures.length > 0) throw new AggregateError(failures, "Explorer drag watchdog finalization was incomplete.");
}

async function assertWatchdogReady(watchdog: DragWatchdog): Promise<void> {
  await waitForExactTokenFile(watchdog.readyPath, dragControlToken(watchdog, watchdog.childPid, "ready"), 5_000);
  if (await isFile(watchdog.failurePath)) throw new Error(`Explorer drag watchdog failed before GO: ${await readFile(watchdog.failurePath, "utf8")}`);
}

async function assertWatchdogReleased(watchdog: DragWatchdog): Promise<void> {
  await assertWatchdogTerminal(watchdog, ["released"]);
}

async function cancelPreGoDragReleaseWatchdog(watchdog: DragWatchdog): Promise<void> {
  const failures: unknown[] = [];
  try { await writeTokenBoundDurableFile(watchdog.disarmPath, dragControlToken(watchdog, watchdog.childPid, "cancel")); } catch (error) { failures.push(error); }
  try { await assertWatchdogTerminal(watchdog, ["cancelled-pre-go", "child-dead-pre-go", "parent-dead-pre-go", "deadline-pre-go"]); } catch (error) { failures.push(error); }
  if (failures.length > 0) throw new AggregateError(failures, "Explorer drag pre-GO watchdog cancellation was incomplete.");
}

async function assertWatchdogTerminal(watchdog: DragWatchdog, expectedKinds: readonly string[]): Promise<void> {
  const failures: unknown[] = [];
  try {
    await Promise.race([onceChildExit(watchdog.child), delay(5_000)]);
    if (!hasChildExited(watchdog.child)) throw new Error("Explorer drag release watchdog did not exit within its bounded proof window.");
  } catch (error) { failures.push(error); }
  try {
    if (await isFile(watchdog.failurePath)) throw new Error(`Explorer drag release watchdog failed: ${await readFile(watchdog.failurePath, "utf8")}`);
  } catch (error) { failures.push(error); }
  try {
    const result = await readWatchdogResult(watchdog);
    if (!expectedKinds.includes(result.kind)) throw new Error("Explorer drag watchdog result had an unexpected terminal state.");
    if (result.kind === "released") assertExactDragReleaseProof(result.eventCount, result.asyncKeyState, "watchdog");
  } catch (error) { failures.push(error); }
  try { await reportRecordedChildProcessError(watchdog.processError, false); } catch (error) { failures.push(error); }
  if (failures.length > 0) throw new AggregateError(failures, "Explorer drag watchdog terminal proof was incomplete.");
}

async function readWatchdogResult(watchdog: DragWatchdog): Promise<{ asyncKeyState: string | undefined; eventCount: string | undefined; kind: string }> {
  const result = JSON.parse(await readFile(watchdog.resultPath, "utf8").catch(() => "{}")) as Partial<{ asyncKeyState: number; childPid: number; deadlineEpochMs: number; eventCount: number; kind: string; parentPid: number; token: string }>;
  if (result.token !== watchdog.token || result.childPid !== watchdog.childPid || result.parentPid !== watchdog.parentPid || result.deadlineEpochMs !== watchdog.deadlineEpochMs || typeof result.kind !== "string") throw new Error("Explorer drag watchdog result was ambiguous.");
  return { asyncKeyState: result.asyncKeyState === undefined ? undefined : String(result.asyncKeyState), eventCount: result.eventCount === undefined ? undefined : String(result.eventCount), kind: result.kind };
}

async function independentDragLeftUp(diagnostic: DragDiagnosticSidecar, childPid: number): Promise<boolean> {
  const script = [
    "$ErrorActionPreference='Stop'",
    "Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class EtherA02DragRelease { [DllImport(\"user32.dll\")] public static extern uint SendInput(uint n, INPUT[] i, int s); [DllImport(\"user32.dll\")] public static extern short GetAsyncKeyState(int v); [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public MOUSEINPUT mi; } [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT { public int dx,dy; public uint data,flags,time; public IntPtr extra; } public static uint Up() { var i=new INPUT[]{new INPUT{type=0,mi=new MOUSEINPUT{flags=0x0004}}}; return SendInput(1,i,Marshal.SizeOf(typeof(INPUT))); } }' -ErrorAction SilentlyContinue",
    `$count=[EtherA02DragRelease]::Up(); $state=[EtherA02DragRelease]::GetAsyncKeyState(1); Write-Output ('${ps(diagnostic.token)}|${childPid}|${diagnostic.parentPid}|${diagnostic.deadlineEpochMs}|released|' + $count + '|' + $state)`
  ].join("; ");
  const proof = (await runPowerShell(script, 5_000)).trim().split("|");
  if (proof.length !== 7 || proof[0] !== diagnostic.token || proof[1] !== String(childPid) || proof[2] !== String(diagnostic.parentPid) || proof[3] !== String(diagnostic.deadlineEpochMs) || proof[4] !== "released") throw new Error("Explorer drag independent release result was ambiguous.");
  assertExactDragReleaseProof(proof[5], proof[6], "independent");
  await writeDragDiagnosticResult(diagnostic, { asyncKeyState: Number(proof[6]), childPid, eventCount: Number(proof[5]), kind: "independent-release", parentPid: diagnostic.parentPid, token: diagnostic.token });
  return true;
}

function dragControlToken(input: DragDiagnosticSidecar, childPid: number, kind: "ready" | "go" | "disarm" | "cancel"): string {
  return `${input.token}|${childPid}|${input.parentPid}|${input.deadlineEpochMs}|${kind}`;
}

async function writeTokenBoundDurableFile(destination: string, contents: string): Promise<void> {
  const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`;
  const handle = await open(temporary, "w");
  try { await handle.writeFile(`${contents}\n`, "utf8"); await handle.sync(); } finally { await handle.close(); }
  await rename(temporary, destination);
}

async function waitForExactTokenFile(destination: string, expected: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const actual = await readFile(destination, "utf8").catch(() => "");
    if (actual.trim() === expected) return;
    await delay(25);
  }
  throw new Error(`Timed out awaiting exact durable drag watchdog control proof: ${path.basename(destination)}.`);
}

function assertExactDragReleaseProof(eventCount: string | undefined, asyncKeyState: string | undefined, source: string): void {
  const count = Number(eventCount);
  const state = Number(asyncKeyState);
  if (!Number.isSafeInteger(count) || count !== 1 || !Number.isSafeInteger(state) || (state & 0x8000) !== 0) {
    throw new Error(`Explorer drag ${source} release proof was not exact: eventCount=${eventCount ?? "missing"}; asyncKeyState=${asyncKeyState ?? "missing"}.`);
  }
}

async function writeDragDiagnosticResult(diagnostic: DragDiagnosticSidecar, result: { asyncKeyState: number; childPid: number; eventCount: number; kind: string; parentPid: number; token: string }): Promise<void> {
  const destination = `${diagnostic.sidecarPath}.${result.kind}.json`;
  const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`;
  const handle = await open(temporary, "w");
  try { await handle.writeFile(JSON.stringify({ ...result, deadlineEpochMs: diagnostic.deadlineEpochMs, timestamp: new Date().toISOString() }), "utf8"); await handle.sync(); } finally { await handle.close(); }
  await rename(temporary, destination);
}

function assertDragDiagnosticSidecar(sidecar: DragDiagnosticSidecar): void {
  if (!/^[a-f0-9]{32}$/u.test(sidecar.token) || sidecar.parentPid !== process.pid || !Number.isSafeInteger(sidecar.deadlineEpochMs) || sidecar.deadlineEpochMs <= Date.now()) {
    throw new Error("Explorer drag requires an exact fresh diagnostic token, parent PID, and future deadline.");
  }
}

async function writeDragDiagnosticStage(sidecar: DragDiagnosticSidecar, stage: DragDiagnosticStage, extra: { childPid: number; down: boolean; releaseAttempted: boolean }): Promise<void> {
  const payload = JSON.stringify({ ...extra, deadlineEpochMs: sidecar.deadlineEpochMs, parentPid: sidecar.parentPid, stage, timestamp: new Date().toISOString(), token: sidecar.token });
  const temporary = `${sidecar.sidecarPath}.${process.pid}.${randomUUID()}.tmp`;
  const handle = await open(temporary, "w");
  try { await handle.writeFile(payload, "utf8"); await handle.sync(); } finally { await handle.close(); }
  await rename(temporary, sidecar.sidecarPath);
}

function onceChildExit(child: ChildProcess): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  return new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })));
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/** Pure script construction keeps the encoded command bounded without launching Explorer or PowerShell. */
export function buildNativeExplorerDragScript(input: {
  diagnostic?: DragDiagnosticSidecar;
  documentPath: string;
  etherPid: number;
  target: NativeScreenPoint;
}): string {
  if (!Number.isSafeInteger(input.etherPid) || input.etherPid <= 0) throw new Error("Explorer drag requires an exact positive Ether PID.");
  const diagnostic = input.diagnostic === undefined ? [] : ["function W{$e=$env:ETHER_A02_DRAG_TOKEN+'|'+$PID+'|'+$env:ETHER_A02_DRAG_PARENT_PID+'|'+$env:ETHER_A02_DRAG_DEADLINE+'|go';while(-not(Test-Path -LiteralPath $env:ETHER_A02_DRAG_ARM_PATH)){if([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() -ge [int64]$env:ETHER_A02_DRAG_DEADLINE){throw 'Drag watchdog was not armed before native mouse-down'};Start-Sleep -Milliseconds 25};if((Get-Content -LiteralPath $env:ETHER_A02_DRAG_ARM_PATH -Raw).Trim() -ne $e){throw 'Drag watchdog GO token mismatch'}}"];
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "Add-Type -AssemblyName UIAutomationClient",
    "Add-Type -AssemblyName PresentationFramework",
    "Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class EtherA02Pointer { [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X,Y; } [DllImport(\"user32.dll\")] public static extern bool SetCursorPos(int x,int y); [DllImport(\"user32.dll\")] public static extern bool GetCursorPos(out POINT p); [DllImport(\"user32.dll\")] public static extern void mouse_event(uint f,uint x,uint y,uint d,UIntPtr e); [DllImport(\"user32.dll\")] public static extern uint GetWindowThreadProcessId(IntPtr h,out uint p); [DllImport(\"user32.dll\")] public static extern bool SetWindowPos(IntPtr h,IntPtr a,int x,int y,int w,int hgt,uint f); [DllImport(\"user32.dll\")] public static extern IntPtr GetForegroundWindow(); [DllImport(\"user32.dll\")] public static extern IntPtr WindowFromPoint(POINT p); [DllImport(\"user32.dll\")] public static extern IntPtr GetAncestor(IntPtr h,uint f); }'",
    `$document = '${ps(input.documentPath)}'`,
    "$documentFullPath = [System.IO.Path]::GetFullPath($document)",
    "$folder = [System.IO.Path]::GetDirectoryName($documentFullPath)",
    "$documentLeaf = [System.IO.Path]::GetFileName($documentFullPath)",
    `$etherPid = ${input.etherPid}`,
    `$targetX = ${Math.round(input.target.x)}`,
    `$targetY = ${Math.round(input.target.y)}`,
    ...diagnostic,
    exactEtherTopLevelWindowScript("EtherA02Pointer"),
    "$shell = New-Object -ComObject Shell.Application",
    exactExplorerSelectionFunctionsScript(),
    "$folderNamespace = $shell.NameSpace($folder); if ($null -eq $folderNamespace) { throw ('Shell namespace unavailable for exact document folder ' + $folder) }",
    "$parsedDocument = $folderNamespace.ParseName($documentLeaf); if ($null -eq $parsedDocument) { throw ('Shell namespace did not expose exact document leaf ' + $documentLeaf) }",
    "$parsedPath = [string]$parsedDocument.Path; if (-not [string]::Equals($parsedPath, $documentFullPath, [System.StringComparison]::OrdinalIgnoreCase)) { throw ('Shell ParseName path mismatch. Expected ' + $documentFullPath + '; observed ' + $parsedPath) }",
    "$displayName = [string]$parsedDocument.Name; if ([string]::IsNullOrWhiteSpace($displayName)) { throw 'Shell ParseName returned an empty Explorer display name' }",
    "$existingHwnd = @{}; foreach ($window in @($shell.Windows())) { try { $existingHwnd[[string]$window.HWND] = $true } catch {} }",
    "Start-Process explorer.exe -ArgumentList ('/n,/select,\"' + $documentFullPath + '\"') | Out-Null",
    "$deadline = [DateTime]::UtcNow.AddSeconds(15)",
    "$matchedWindow = $null; $explorerPid = $null; $item = $null",
    "while ([DateTime]::UtcNow -lt $deadline -and $null -eq $item) {",
    "  if ($null -eq $matchedWindow) { foreach ($window in @($shell.Windows())) { try { if (-not $existingHwnd.ContainsKey([string]$window.HWND) -and [string]::Equals(([uri]$window.LocationURL).LocalPath.TrimEnd('\\'), $folder.TrimEnd('\\'), [System.StringComparison]::OrdinalIgnoreCase)) { $matchedWindow = $window; break } } catch {} } }",
    "  if ($null -eq $matchedWindow) { Start-Sleep -Milliseconds 150; continue }",
    "  [uint32]$nativePid = 0; [EtherA02Pointer]::GetWindowThreadProcessId([intptr]$matchedWindow.HWND, [ref]$nativePid) | Out-Null; if ($nativePid -eq 0) { throw 'Exact Explorer HWND PID was zero' }; $explorerPid = [int64]$nativePid",
    "  $condition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, $displayName)",
    `  $windowRoot = [System.Windows.Automation.AutomationElement]::FromHandle([intptr]$matchedWindow.HWND); $candidates = $windowRoot.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition); if ($candidates.Count -gt 1) { throw ('Exact new Explorer window exposed multiple drag sources named ' + $displayName) }; if ($candidates.Count -eq 1) { ${exactExplorerSelectedDocumentMatchesScript()}; if ($selectionMatches) { $item = $candidates[0] } }`,
    "  if ($null -eq $item) { Start-Sleep -Milliseconds 150 }",
    "}",
    "if ($null -eq $item) { if ($null -ne $matchedWindow) { $matchedWindow.Quit() }; throw ('Explorer UIA did not expose exact drag display source ' + $displayName) }",
    exactExplorerSelectedDocumentScript("Before arranging drag window"),
    "$down = $false",
    `try { $explorerHwnd = [intptr]$matchedWindow.HWND; $targetWindow = [System.Windows.Automation.AutomationElement]::FromHandle($etherHwnd).Current.BoundingRectangle; if ($targetX -lt $targetWindow.Left -or $targetX -gt $targetWindow.Right -or $targetY -lt $targetWindow.Top -or $targetY -gt $targetWindow.Bottom) { throw 'Drop outside Ether' }; $moveX = if ($targetX -gt 520) { 0 } else { [int]([System.Windows.SystemParameters]::PrimaryScreenWidth - 460) }; [EtherA02Pointer]::SetWindowPos($explorerHwnd, [intptr]::Zero, $moveX, 0, 440, 520, 0x0040) | Out-Null; Start-Sleep -Milliseconds 300; $explorerRoot = [System.Windows.Automation.AutomationElement]::FromHandle($explorerHwnd); $explorerBounds = $explorerRoot.Current.BoundingRectangle; if ($targetX -ge $explorerBounds.Left -and $targetX -le $explorerBounds.Right -and $targetY -ge $explorerBounds.Top -and $targetY -le $explorerBounds.Bottom) { throw 'Explorer covers drop target' }; $item = $null; $deadline = [DateTime]::UtcNow.AddSeconds(10); while ([DateTime]::UtcNow -lt $deadline -and $null -eq $item) { $condition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, $displayName); $candidates = $explorerRoot.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition); if ($candidates.Count -gt 1) { throw ('Exact Explorer HWND exposed multiple drag sources named ' + $displayName) }; if ($candidates.Count -eq 1) { ${exactExplorerSelectedDocumentMatchesScript()}; if ($selectionMatches) { $item = $candidates[0] } }; if ($null -eq $item) { Start-Sleep -Milliseconds 150 } }; if ($null -eq $item) { throw 'Explorer source disappeared' }; ${exactExplorerSelectedDocumentScript("After arranging drag window")}; $source = $item.Current.BoundingRectangle; if ($source.Width -le 0 -or $source.Height -le 0) { throw 'Exact Explorer source has no usable screen bounds after arranging window' }; if ($targetX -ge $source.Left -and $targetX -le $source.Right -and $targetY -ge $source.Top -and $targetY -le $source.Bottom) { throw 'Explorer source and Ether target rectangles overlap' }; $sourceX = [int][Math]::Round($source.Left + ($source.Width / 2)); $sourceY = [int][Math]::Round($source.Top + ($source.Height / 2)); [EtherA02Pointer]::SetCursorPos($sourceX, $sourceY) | Out-Null; Start-Sleep -Milliseconds 100; ${exactWindowRootAtPointScript("EtherA02Pointer", "$sourceX", "$sourceY", "$explorerHwnd", "Drag source")}; $activationStartedAt = [DateTime]::UtcNow; [EtherA02Pointer]::mouse_event(0x0002,0,0,0,[UIntPtr]::Zero); $down = $true; $dragFocusDeadline = [DateTime]::UtcNow.AddSeconds(2); $dragFocused = $false; while ([DateTime]::UtcNow -lt $dragFocusDeadline -and -not $dragFocused) { if ([EtherA02Pointer]::GetForegroundWindow() -eq $explorerHwnd) { [uint32]$foregroundExplorerPid = 0; [EtherA02Pointer]::GetWindowThreadProcessId($explorerHwnd, [ref]$foregroundExplorerPid) | Out-Null; if ($foregroundExplorerPid -ne 0 -and [int64]$foregroundExplorerPid -eq $explorerPid) { $dragFocused = $true; break } }; Start-Sleep -Milliseconds 25 }; if (-not $dragFocused) { throw 'Drag source foreground mismatch' }; $dragDistance = [int][Math]::Ceiling([System.Windows.SystemParameters]::MinimumHorizontalDragDistance + 1); [EtherA02Pointer]::SetCursorPos(($sourceX + $dragDistance),$sourceY) | Out-Null; Start-Sleep -Milliseconds 25; for ($step = 1; $step -le 12; $step++) { [EtherA02Pointer]::SetCursorPos([int]($sourceX + (($targetX - $sourceX) * $step / 12)),[int]($sourceY + (($targetY - $sourceY) * $step / 12))) | Out-Null; Start-Sleep -Milliseconds 25 }; ${exactWindowRootAtPointScript("EtherA02Pointer", "$targetX", "$targetY", "$etherHwnd", "Drag target")}; [EtherA02Pointer]::mouse_event(0x0004,0,0,0,[UIntPtr]::Zero); $down = $false; ${exactEtherForegroundTransitionScript("EtherA02Pointer", "native Explorer drag")}; Write-Output ('native-explorer-drag sourceHwnd=' + $explorerHwnd + ' sourcePid=' + $explorerPid + ' targetHwnd=' + $etherHwnd + ' targetPid=' + $etherPid + ' latencyMs=' + $transitionLatencyMs + ' source=(' + $sourceX + ',' + $sourceY + ') target=(' + $targetX + ',' + $targetY + ')') } finally { if ($down) { [EtherA02Pointer]::mouse_event(0x0004,0,0,0,[UIntPtr]::Zero) }; if ($null -ne $matchedWindow) { $matchedWindow.Quit() } }`
  ].join("; ");
  return compactNativeExplorerDragScript(script, input.diagnostic !== undefined);
}

/** Keeps the approval-gated native drag below Windows' encoded-command limit. */
function compactNativeExplorerDragScript(script: string, diagnostic: boolean): string {
  const readCursor = (stage: string) => `$cursor = New-Object EtherA02Pointer+POINT; if (-not [EtherA02Pointer]::GetCursorPos([ref]$cursor)) { throw '${stage}: cursor read failed' }`;
  const actualRoot = "function P($x,$y,$ex,$ey,$h,$g){if($x-ne$ex-or$y-ne$ey){throw($g+': cursor readback mismatch')};$q=New-Object EtherA02Pointer+POINT;$q.X=$x;$q.Y=$y;$w=[EtherA02Pointer]::WindowFromPoint($q);if($w -eq [intptr]::Zero -or [EtherA02Pointer]::GetAncestor($w,2)-ne $h){throw($g+': WindowFromPoint root was not the exact expected HWND')}}";
  const stage = (code: string, down: 0 | 1, releaseAttempted: 0 | 1) => diagnostic ? `Write-Output 'A02D|${code}|${down}|${releaseAttempted}'` : "";
  return script
    // SWP_NOZORDER | SWP_NOACTIVATE | SWP_SHOWWINDOW: preserve size/position and show it without activation.
    .replace("0x0040", "0x0054")
    .replace("$down = $false", `${actualRoot}; $down = $false`)
    .replace("[EtherA02Pointer]::SetCursorPos($sourceX, $sourceY) | Out-Null", "if (-not [EtherA02Pointer]::SetCursorPos($sourceX,$sourceY)) { throw 'Drag source: cursor placement failed' }")
    .replace("; $activationStartedAt =", `; ${readCursor("Drag source")}; P $cursor.X $cursor.Y $sourceX $sourceY $explorerHwnd 'Drag source actual cursor'; $activationStartedAt =`)
    .replace("; [EtherA02Pointer]::mouse_event(0x0002", `; ${diagnostic ? "W; " : ""}[EtherA02Pointer]::mouse_event(0x0002`)
    .replace("$down = $true; $dragFocusDeadline", `$down = $true; ${diagnostic ? `${stage("m", 1, 0)}; ` : ""}$dragFocusDeadline`)
    .replace("$dragFocused = $true; break", `$dragFocused = $true; ${diagnostic ? `${stage("f", 1, 0)}; ` : ""}break`)
    .replace("[EtherA02Pointer]::SetCursorPos(($sourceX + $dragDistance),$sourceY) | Out-Null", `if (-not [EtherA02Pointer]::SetCursorPos(($sourceX + $dragDistance),$sourceY)) { throw 'Drag threshold: cursor placement failed' }; ${readCursor("Drag threshold")}; P $cursor.X $cursor.Y ($sourceX+$dragDistance) $sourceY $explorerHwnd 'Drag threshold actual cursor'; ${diagnostic ? stage("h", 1, 0) : ""}`)
    .replace("[EtherA02Pointer]::SetCursorPos([int]($sourceX + (($targetX - $sourceX) * $step / 12)),[int]($sourceY + (($targetY - $sourceY) * $step / 12))) | Out-Null", "if (-not [EtherA02Pointer]::SetCursorPos([int]($sourceX + (($targetX - $sourceX) * $step / 12)),[int]($sourceY + (($targetY - $sourceY) * $step / 12)))) { throw 'Drag progression: cursor placement failed' }")
    .replace("; [EtherA02Pointer]::mouse_event(0x0004", `; ${readCursor("Drag target")}; P $cursor.X $cursor.Y $targetX $targetY $etherHwnd 'Drag target actual cursor'; ${diagnostic ? `${stage("t", 1, 0)}; ${stage("u", 1, 1)}; ` : ""}[EtherA02Pointer]::mouse_event(0x0004`)
    .replace("$down = $false; $activationDeadline", `$down = $false; ${diagnostic ? `${stage("r", 0, 1)}; ` : ""}$activationDeadline`)
    .replace("$transitionLatencyMs = [int]", `${diagnostic ? `${stage("v", 0, 1)}; ` : ""}$transitionLatencyMs = [int]`)
    .replace("finally { if ($down) { [EtherA02Pointer]::mouse_event(0x0004,0,0,0,[UIntPtr]::Zero) }", `finally { if ($down) { ${diagnostic ? `${stage("u", 1, 1)}; ` : ""}[EtherA02Pointer]::mouse_event(0x0004,0,0,0,[UIntPtr]::Zero); $down = $false; ${diagnostic ? `${stage("r", 0, 1)}; ` : ""} }`)
    .replaceAll("$documentFullPath", "$d")
    .replaceAll("$documentLeaf", "$l")
    .replaceAll("$folderNamespace", "$ns")
    .replaceAll("$parsedDocument", "$pd")
    .replaceAll("$parsedPath", "$pp")
    .replaceAll("$displayName", "$n")
    .replaceAll("$existingHwnd", "$eh")
    .replaceAll("$matchedWindow", "$mw")
    .replaceAll("$windowRoot", "$wr")
    .replaceAll("$explorerPid", "$ep")
    .replaceAll("$condition", "$c")
    .replaceAll("$candidates", "$cs")
    .replaceAll("$resolvedEtherPid", "$rp")
    .replaceAll("$etherCondition", "$ec")
    .replaceAll("$etherWindows", "$ew")
    .replaceAll("$nativePid", "$np")
    .replaceAll("$deadline", "$dl")
    .replaceAll("$sourceX", "$sx")
    .replaceAll("$sourceY", "$sy")
    .replaceAll("$targetX", "$tx")
    .replaceAll("$targetY", "$ty")
    .replaceAll("$dragDistance", "$dd")
    .replaceAll("$targetWindow", "$tw")
    .replaceAll("$explorerBounds", "$eb")
    .replaceAll("$explorerRoot", "$er")
    .replaceAll("$dragFocusDeadline", "$fd")
    .replaceAll("$dragFocused", "$df")
    .replaceAll("$foregroundExplorerPid", "$fp")
    .replaceAll("$activationDeadline", "$ad")
    .replaceAll("$foregroundTransitioned", "$ft")
    .replaceAll("$foregroundHwnd", "$fh")
    .replaceAll("$foregroundPid", "$fpid")
    .replaceAll("$transitionLatencyMs", "$lm")
    .replaceAll("$activationStartedAt", "$as")
    .replaceAll("$explorerHwnd", "$xh")
    .replaceAll("$etherHwnd", "$th")
    .replaceAll("$explorerPid", "$ep")
    .replaceAll("$etherPid", "$tp")
    .replaceAll("$item", "$it")
    .replaceAll("$source", "$so");
}

/**
 * Uses the actual taskbar/Jumplist surface only when a unique Ether taskbar
 * entry and unique recent document item are exposed to UI Automation. Any
 * ambiguity fails with diagnostics instead of guessing or using argv.
 */
export async function invokeJumpListRecentDocumentWithUia(input: {
  documentPath: string;
  etherPid: number;
  taskbarAppName: string;
}): Promise<string> {
  requireJumpListRouteApproval();
  if (!/^Ether Recovery [a-f0-9]{8}$/u.test(input.taskbarAppName)) {
    throw new Error("Jump List interaction requires a unique recovery taskbar identity.");
  }
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "Add-Type -AssemblyName UIAutomationClient",
    "Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class EtherA02JumpList { [DllImport(\"user32.dll\")] public static extern bool SetCursorPos(int X, int Y); [DllImport(\"user32.dll\")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra); [DllImport(\"user32.dll\")] public static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra); }'",
    `$itemName = '${ps(path.basename(input.documentPath))}'`,
    `$etherPid = ${input.etherPid}`,
    `$appName = '${ps(input.taskbarAppName)}'`,
    "$root = [System.Windows.Automation.AutomationElement]::RootElement; $nameCondition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, $appName)",
    "$pidCondition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $etherPid); $etherWindows = @($root.FindAll([System.Windows.Automation.TreeScope]::Children, $pidCondition) | Where-Object { $_.Current.NativeWindowHandle -ne 0 }); if ($etherWindows.Count -ne 1 -or $etherWindows[0].Current.Name -ne $appName) { throw ('JUMP_LIST_UNAVAILABLE: exact recovery Ether window/title mismatch for PID ' + $etherPid) }",
    "$taskbarCandidates = @($root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $nameCondition) | Where-Object { $_.Current.ProcessId -ne $etherPid -and $_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button -and $_.Current.BoundingRectangle.Width -gt 0 -and $_.Current.BoundingRectangle.Height -gt 0 })",
    "if ($taskbarCandidates.Count -ne 1) { throw ('JUMP_LIST_UNAVAILABLE: expected one exact visible taskbar item named ' + $appName + '; found ' + $taskbarCandidates.Count + '. Refusing ambiguous shell interaction.') }",
    "$itemCondition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, $itemName); $priorItems = @($root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $itemCondition) | Where-Object { $_.Current.ProcessId -ne $etherPid -and $_.Current.BoundingRectangle.Width -gt 0 -and $_.Current.BoundingRectangle.Height -gt 0 }); if ($priorItems.Count -ne 0) { throw ('JUMP_LIST_UNAVAILABLE: unique recent item was already visible in the shell before opening the exact recovery taskbar item: ' + $itemName) }",
    "$taskbar = $taskbarCandidates[0]; $bounds = $taskbar.Current.BoundingRectangle; $x = [int][Math]::Round($bounds.Left + ($bounds.Width / 2)); $y = [int][Math]::Round($bounds.Top + ($bounds.Height / 2))",
    "[EtherA02JumpList]::SetCursorPos($x, $y) | Out-Null; [EtherA02JumpList]::mouse_event(0x0008, 0, 0, 0, [UIntPtr]::Zero); [EtherA02JumpList]::mouse_event(0x0010, 0, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 500",
    "try { $recentItems = @($root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $itemCondition) | Where-Object { $_.Current.ProcessId -ne $etherPid -and $_.Current.BoundingRectangle.Width -gt 0 -and $_.Current.BoundingRectangle.Height -gt 0 }); if ($recentItems.Count -ne 1) { throw ('JUMP_LIST_UNAVAILABLE: expected one exact newly visible recent item ' + $itemName + '; found ' + $recentItems.Count + '. The host did not expose a safe exact Jump List target.') }; $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker; $popup = $recentItems[0]; $parent = $walker.GetParent($popup); while ($null -ne $parent -and $parent.Current.NativeWindowHandle -eq 0) { $popup = $parent; $parent = $walker.GetParent($popup) }; if ($popup.Current.ProcessId -eq $etherPid) { throw 'JUMP_LIST_UNAVAILABLE: recent target resolved inside Ether rather than the Windows shell popup' }; $invoke = $recentItems[0].GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern); if ($null -eq $invoke) { throw 'JUMP_LIST_UNAVAILABLE: exact recent item has no InvokePattern' }; ([System.Windows.Automation.InvokePattern]$invoke).Invoke(); Write-Output ('uia-jumplist-invoked etherPid=' + $etherPid + ' item=' + $itemName + ' taskbar=(' + $x + ',' + $y + ') popupHwnd=' + $popup.Current.NativeWindowHandle) } finally { [EtherA02JumpList]::keybd_event(0x1B, 0, 0, [UIntPtr]::Zero); [EtherA02JumpList]::keybd_event(0x1B, 0, 2, [UIntPtr]::Zero) }"
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
  const output = await runPowerShell(recentShortcutScript(input));
  return output.length === 0 ? [] : output.split(/\r?\n/u).filter(Boolean);
}

/** Derives a root-relative candidate only from an absolute top-level Recent file. */
export function deriveWindowsShellDeletionCandidate(input: {
  appData: string;
  recentRoot: string;
  candidatePath: string;
}): WindowsShellDeletionCandidate {
  const root = path.win32.normalize(path.win32.resolve(input.recentRoot));
  const candidate = path.win32.normalize(path.win32.resolve(input.candidatePath));
  if (!sameWindowsPath(path.win32.dirname(candidate), root)) {
    throw new Error(`Refusing a Recent deletion candidate outside its exact root: ${input.candidatePath}.`);
  }
  const relativePath = path.win32.relative(root, candidate).replaceAll("\\", "/");
  if (relativePath.length === 0 || relativePath === ".." || relativePath.startsWith("../") || path.posix.isAbsolute(relativePath)) {
    throw new Error(`Refusing a Recent deletion candidate with path traversal: ${input.candidatePath}.`);
  }
  if (!relativePath.toLowerCase().endsWith(".lnk")) {
    throw new Error(`Refusing a non-shortcut Recent deletion candidate: ${input.candidatePath}.`);
  }
  return { appData: input.appData, relativePath };
}

/**
 * Removes only `.lnk` records that both resolve to one of the exact test
 * documents and live under an explicitly snapshotted real or isolated Recent
 * directory. A pathname present at S1 is never deleted, even if Windows later
 * retargets it to a test document.
 */
export async function cleanupTestOwnedRecentShortcuts(input: {
  appData: string;
  additionalAppData?: readonly string[];
  root: string;
  documentPaths: readonly string[];
  s1: WindowsShellStateSnapshot;
}): Promise<string[]> {
  await Promise.all(input.documentPaths.map((candidate) => assertTestOwnedPath(input.root, candidate)));
  const appDataRoots = [...new Set([input.appData, ...(input.additionalAppData ?? [])].map((candidate) => path.resolve(candidate).toLocaleLowerCase("en-US")))];
  const discovered: Array<{ candidatePath: string; candidate: WindowsShellDeletionCandidate }> = [];
  for (const normalized of appDataRoots) {
    const appData = [input.appData, ...(input.additionalAppData ?? [])].find((candidate) => path.resolve(candidate).toLocaleLowerCase("en-US") === normalized)!;
    const recentRoot = path.win32.join(appData, "Microsoft", "Windows", "Recent");
    const output = await runPowerShell(recentShortcutScript({ ...input, appData }));
    for (const candidatePath of output.length === 0 ? [] : output.split(/\r?\n/u).filter(Boolean)) {
      if (discovered.some(({ candidatePath: priorPath }) => sameWindowsPath(priorPath, candidatePath))) {
        throw new Error(`Duplicate Recent deletion candidate was discovered: ${candidatePath}.`);
      }
      discovered.push({ candidatePath, candidate: deriveWindowsShellDeletionCandidate({ appData, recentRoot, candidatePath }) });
    }
  }
  assertWindowsShellDeletionCandidatesAbsentAtS1(input.s1, discovered.map(({ candidate }) => candidate));

  const removed: string[] = [];
  for (const { candidatePath, candidate } of discovered) {
    const output = await runPowerShell(recentShortcutDeletionScript({ appData: candidate.appData, candidatePath, root: input.root, documentPaths: input.documentPaths }));
    const fields = output.split("\t");
    if (fields.length !== 4 || !sameWindowsPath(fields[0] ?? "", candidatePath)) {
      throw new Error(`Recent deletion proof did not return the exact candidate metadata: ${output || "(empty)"}.`);
    }
    const candidateSize = Number(fields[1]);
    if (fields[1] === undefined || fields[2] === undefined || fields[3] === undefined || !Number.isSafeInteger(candidateSize) || candidateSize <= 0 || !/^[a-f0-9]{64}$/iu.test(fields[2]) || fields[3].length === 0) {
      throw new Error(`Recent deletion proof returned incomplete candidate metadata for ${candidate.appData}:${candidate.relativePath}.`);
    }
    removed.push(candidatePath);
  }
  return removed;
}

function recentShortcutScript(input: { appData: string; root: string; documentPaths: readonly string[] }): string {
  const targets = input.documentPaths.map((candidate) => path.resolve(candidate));
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `$appData = '${ps(input.appData)}'`,
    `$root = '${ps(input.root)}'`,
    `$targets = @(${targets.map((target) => `'${ps(target)}'`).join(",")})`,
    "$recent = Join-Path $appData 'Microsoft\\Windows\\Recent'",
    "if (-not (Test-Path -LiteralPath $recent)) { return }",
    "$shell = New-Object -ComObject WScript.Shell",
    `Get-ChildItem -LiteralPath $recent -Filter '*.lnk' -File | ForEach-Object { $shortcut = $null; try { $shortcut = $shell.CreateShortcut($_.FullName); $target = [System.IO.Path]::GetFullPath($shortcut.TargetPath) } catch {}; if ($null -ne $shortcut) { $match = @($targets | Where-Object { [string]::Equals($_, $target, [System.StringComparison]::OrdinalIgnoreCase) }).Count -eq 1; $underRoot = $target.StartsWith($root.TrimEnd('\\') + '\\', [System.StringComparison]::OrdinalIgnoreCase); if ($match -and $underRoot) { Write-Output $_.FullName } } }`
  ].join("; ");
  return script;
}

function recentShortcutDeletionScript(input: { appData: string; candidatePath: string; root: string; documentPaths: readonly string[] }): string {
  const targets = input.documentPaths.map((candidate) => path.resolve(candidate));
  return [
    "$ErrorActionPreference = 'Stop'",
    `$appData = '${ps(input.appData)}'`,
    `$candidatePath = '${ps(input.candidatePath)}'`,
    `$root = '${ps(input.root)}'`,
    `$targets = @(${targets.map((target) => `'${ps(target)}'`).join(",")})`,
    "$recent = [System.IO.Path]::GetFullPath((Join-Path $appData 'Microsoft\\Windows\\Recent'))",
    "if ($null -eq $recent -or -not [string]::Equals([System.IO.Path]::GetDirectoryName([System.IO.Path]::GetFullPath($candidatePath)), [System.IO.Path]::GetFullPath($recent), [System.StringComparison]::OrdinalIgnoreCase)) { throw ('Recent candidate escaped its exact root: ' + $candidatePath) }",
    "if (-not $candidatePath.EndsWith('.lnk', [System.StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath $candidatePath -PathType Leaf)) { throw ('Recent candidate is not an existing shortcut file: ' + $candidatePath) }",
    "$shell = New-Object -ComObject WScript.Shell",
    "$beforeInfo = Get-Item -LiteralPath $candidatePath -Force; $beforeHash = (Get-FileHash -LiteralPath $candidatePath -Algorithm SHA256).Hash; $beforeShortcut = $shell.CreateShortcut($candidatePath); $beforeTarget = [System.IO.Path]::GetFullPath($beforeShortcut.TargetPath); $beforeMatch = @($targets | Where-Object { [string]::Equals($_, $beforeTarget, [System.StringComparison]::OrdinalIgnoreCase) }).Count -eq 1; $beforeUnderRoot = $beforeTarget.StartsWith($root.TrimEnd('\\') + '\\', [System.StringComparison]::OrdinalIgnoreCase); if (-not ($beforeMatch -and $beforeUnderRoot)) { throw ('Shortcut target is not an exact random-root target: ' + $candidatePath) }",
    "$afterInfo = Get-Item -LiteralPath $candidatePath -Force; $afterHash = (Get-FileHash -LiteralPath $candidatePath -Algorithm SHA256).Hash; $afterShortcut = $shell.CreateShortcut($candidatePath); $afterTarget = [System.IO.Path]::GetFullPath($afterShortcut.TargetPath); $afterMatch = @($targets | Where-Object { [string]::Equals($_, $afterTarget, [System.StringComparison]::OrdinalIgnoreCase) }).Count -eq 1; $afterUnderRoot = $afterTarget.StartsWith($root.TrimEnd('\\') + '\\', [System.StringComparison]::OrdinalIgnoreCase); if ($afterInfo.Length -ne $beforeInfo.Length -or -not [string]::Equals($afterHash, $beforeHash, [System.StringComparison]::OrdinalIgnoreCase) -or -not [string]::Equals($afterTarget, $beforeTarget, [System.StringComparison]::OrdinalIgnoreCase) -or -not ($afterMatch -and $afterUnderRoot)) { throw ('Shortcut bytes or target changed before deletion: ' + $candidatePath) }",
    "Remove-Item -LiteralPath $candidatePath -Force; if (Test-Path -LiteralPath $candidatePath -PathType Leaf) { throw ('Shortcut survived deletion: ' + $candidatePath) }; Write-Output (@($candidatePath, [string]$beforeInfo.Length, $beforeHash, $beforeTarget) -join \"`t\")"
  ].join("; ");
}

export async function assertExactPackagedProcess(executablePath: string, expectedPid: number): Promise<void> {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `$expectedPath = '${ps(executablePath)}'`,
    `$expectedPid = ${expectedPid}`,
    "$process = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + $expectedPid)",
    "if ($null -eq $process) { throw ('Exact Ether process was not found: ' + $expectedPid) }",
    "if (-not [string]::Equals($process.ExecutablePath, $expectedPath, [System.StringComparison]::OrdinalIgnoreCase)) { throw ('PID/executable mismatch: ' + $process.ExecutablePath) }",
    "$roots = @(Get-CimInstance Win32_Process | Where-Object { [string]::Equals($_.ExecutablePath, $expectedPath, [System.StringComparison]::OrdinalIgnoreCase) -and $_.CommandLine -notmatch '(?:^|\\s)--type(?:=|\\s)' })",
    "if ($roots.Count -ne 1 -or [int]$roots[0].ProcessId -ne $expectedPid) { throw ('Expected only exact packaged root PID ' + $expectedPid + '; found ' + (($roots | ForEach-Object ProcessId) -join ',')) }"
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

/** Sends Ctrl+O to the exact foregrounded Ether window through native keyboard input. */
export async function openExactWindowWithNativeKeyboard(ownerPid: number): Promise<string> {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "Add-Type -AssemblyName UIAutomationClient",
    "Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class EtherA02RendererKeyboard { [DllImport(\"user32.dll\")] public static extern bool SetForegroundWindow(IntPtr hWnd); [DllImport(\"user32.dll\")] public static extern IntPtr GetForegroundWindow(); [DllImport(\"user32.dll\")] public static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra); }' -ErrorAction SilentlyContinue",
    `$ownerPid = ${ownerPid}`,
    "$byPid = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $ownerPid)",
    "$ownerWindows = @([System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, $byPid) | Where-Object { $_.Current.ClassName -ne '#32770' -and $_.Current.NativeWindowHandle -ne 0 })",
    "if ($ownerWindows.Count -ne 1) { throw ('Expected one exact Ether owner window; found ' + $ownerWindows.Count) }",
    "$ownerHwnd = [intptr]$ownerWindows[0].Current.NativeWindowHandle",
    "[EtherA02RendererKeyboard]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero); [EtherA02RendererKeyboard]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero); try { $ownerWindows[0].SetFocus() } catch {}; [EtherA02RendererKeyboard]::SetForegroundWindow($ownerHwnd) | Out-Null; Start-Sleep -Milliseconds 150",
    "if ([EtherA02RendererKeyboard]::GetForegroundWindow() -ne $ownerHwnd) { throw 'Exact Ether window is not foreground for Ctrl+O' }",
    "[EtherA02RendererKeyboard]::keybd_event(0x11, 0, 0, [UIntPtr]::Zero); [EtherA02RendererKeyboard]::keybd_event(0x4F, 0, 0, [UIntPtr]::Zero); [EtherA02RendererKeyboard]::keybd_event(0x4F, 0, 2, [UIntPtr]::Zero); [EtherA02RendererKeyboard]::keybd_event(0x11, 0, 2, [UIntPtr]::Zero)",
    "Write-Output ('native-keyboard ownerPid=' + $ownerPid + ' shortcut=Ctrl+O')"
  ].join("; ");
  return runPowerShell(script);
}

/** Sends Alt+F4 to the exact foregrounded Ether window through native keyboard input. */
export async function closeExactWindowWithNativeKeyboard(ownerPid: number): Promise<string> {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "Add-Type -AssemblyName UIAutomationClient",
    "Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class EtherA02CloseKeyboard { [DllImport(\"user32.dll\")] public static extern bool SetForegroundWindow(IntPtr hWnd); [DllImport(\"user32.dll\")] public static extern IntPtr GetForegroundWindow(); [DllImport(\"user32.dll\")] public static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra); }' -ErrorAction SilentlyContinue",
    `$ownerPid = ${ownerPid}`,
    "$byPid = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $ownerPid)",
    "$ownerWindows = @([System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, $byPid) | Where-Object { $_.Current.ClassName -ne '#32770' -and $_.Current.NativeWindowHandle -ne 0 })",
    "if ($ownerWindows.Count -ne 1) { throw ('Expected one exact Ether owner window; found ' + $ownerWindows.Count) }",
    "$ownerHwnd = [intptr]$ownerWindows[0].Current.NativeWindowHandle",
    "[EtherA02CloseKeyboard]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero); [EtherA02CloseKeyboard]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero); try { $ownerWindows[0].SetFocus() } catch {}; [EtherA02CloseKeyboard]::SetForegroundWindow($ownerHwnd) | Out-Null; Start-Sleep -Milliseconds 150",
    "if ([EtherA02CloseKeyboard]::GetForegroundWindow() -ne $ownerHwnd) { throw 'Exact Ether window is not foreground for Alt+F4' }",
    "[EtherA02CloseKeyboard]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero); [EtherA02CloseKeyboard]::keybd_event(0x73, 0, 0, [UIntPtr]::Zero); [EtherA02CloseKeyboard]::keybd_event(0x73, 0, 2, [UIntPtr]::Zero); [EtherA02CloseKeyboard]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)",
    "Write-Output ('native-keyboard ownerPid=' + $ownerPid + ' shortcut=Alt+F4')"
  ].join("; ");
  return runPowerShell(script);
}

export async function completeNativeFileDialogWithUia(ownerPid: number, filePath: string): Promise<string> {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "Add-Type -AssemblyName UIAutomationClient",
    "Add-Type -TypeDefinition 'using System; using System.Collections.Generic; using System.Runtime.InteropServices; public static class EtherA02DialogOwner { public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam); [DllImport(\"user32.dll\")] public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam); [DllImport(\"user32.dll\")] public static extern IntPtr GetWindow(IntPtr hWnd, uint command); [DllImport(\"user32.dll\")] public static extern bool IsWindowEnabled(IntPtr hWnd); [DllImport(\"user32.dll\", CharSet = CharSet.Unicode)] private static extern IntPtr SendMessage(IntPtr hWnd, uint message, IntPtr wParam, IntPtr lParam); [DllImport(\"user32.dll\")] private static extern bool PostMessage(IntPtr hWnd, uint message, IntPtr wParam, IntPtr lParam); public static IntPtr[] OwnedWindows(IntPtr owner) { var windows = new List<IntPtr>(); EnumWindows((hWnd, lParam) => { if (hWnd != owner && GetWindow(hWnd, 4) == owner) windows.Add(hWnd); return true; }, IntPtr.Zero); return windows.ToArray(); } public static void TypeExact(IntPtr edit, string text) { SendMessage(edit, 0x00B1, IntPtr.Zero, new IntPtr(-1)); foreach (var character in text) SendMessage(edit, 0x0102, new IntPtr(character), IntPtr.Zero); } public static void ClickExact(IntPtr button) { if (!PostMessage(button, 0x00F5, IntPtr.Zero, IntPtr.Zero)) throw new InvalidOperationException(\"Could not post exact native file-dialog click.\"); } }' -ErrorAction SilentlyContinue",
    `$ownerPid = ${ownerPid}`,
    `$filePath = '${ps(filePath)}'`,
    "$byPid = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $ownerPid)",
    "$ownerWindows = @([System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, $byPid) | Where-Object { $_.Current.ClassName -ne '#32770' -and $_.Current.NativeWindowHandle -ne 0 })",
    "if ($ownerWindows.Count -ne 1) { throw ('Expected one exact Ether owner window; found ' + $ownerWindows.Count) }",
    "$ownerHwnd = [intptr]$ownerWindows[0].Current.NativeWindowHandle",
    "$fileNameClassCondition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ClassNameProperty, 'Edit')",
    "$dialogButtonCondition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ClassNameProperty, 'Button')",
    "$deadline = [DateTime]::UtcNow.AddSeconds(15)",
    "$dialog = $null",
    "while ([DateTime]::UtcNow -lt $deadline -and $null -eq $dialog) {",
    "  $topWindows = [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)",
    "  $candidateHandles = @(@($topWindows | Where-Object { $hwnd = [intptr]$_.Current.NativeWindowHandle; $hwnd -ne $ownerHwnd -and ($_.Current.ProcessId -eq $ownerPid -or [EtherA02DialogOwner]::GetWindow($hwnd, 4) -eq $ownerHwnd) } | ForEach-Object { [intptr]$_.Current.NativeWindowHandle }) + @([EtherA02DialogOwner]::OwnedWindows($ownerHwnd)) | Select-Object -Unique)",
    "  $matches = @($candidateHandles | ForEach-Object { $element = [System.Windows.Automation.AutomationElement]::FromHandle([intptr]$_); $fileNameCandidates = @($element.FindAll([System.Windows.Automation.TreeScope]::Descendants, $fileNameClassCondition) | Where-Object { $_.Current.AutomationId -in @('1001', '1148') }); $hasConfirm = @($element.FindAll([System.Windows.Automation.TreeScope]::Descendants, $dialogButtonCondition) | Where-Object { $_.Current.Name -in @('Open', 'Save') }).Count -gt 0; if ($fileNameCandidates.Count -eq 1 -and $hasConfirm) { $element } })",
    "  if ($matches.Count -gt 1) { throw ('Expected at most one exact Ether-owned file dialog; found ' + $matches.Count) }",
    "  if ($matches.Count -eq 1) { $dialog = $matches[0] }",
    "  if ($null -eq $dialog) { Start-Sleep -Milliseconds 150 }",
    "}",
    "if ($null -eq $dialog) { $rawElements = @([EtherA02DialogOwner]::OwnedWindows($ownerHwnd) | ForEach-Object { [System.Windows.Automation.AutomationElement]::FromHandle([intptr]$_) }); $rawOwned = @($rawElements | ForEach-Object { 'name=' + $_.Current.Name + ',class=' + $_.Current.ClassName + ',pid=' + $_.Current.ProcessId + ',hwnd=' + $_.Current.NativeWindowHandle }) -join '; '; $rawDescendants = @($rawElements | Where-Object { $_.Current.ClassName -eq '#32770' } | ForEach-Object { $_.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition) } | Where-Object { $_.Current.ClassName -in @('Edit', 'Button') } | ForEach-Object { 'name=' + $_.Current.Name + ',class=' + $_.Current.ClassName + ',id=' + $_.Current.AutomationId }) -join '; '; if ([string]::IsNullOrWhiteSpace($rawOwned)) { $rawOwned = '(none)' }; if ([string]::IsNullOrWhiteSpace($rawDescendants)) { $rawDescendants = '(none)' }; throw ('Exact Ether-owned native file dialog was not found. Owner enabled=' + [EtherA02DialogOwner]::IsWindowEnabled($ownerHwnd) + '. Raw owned windows: ' + $rawOwned + '. Relevant descendants: ' + $rawDescendants) }",
    "$fileNames = @($dialog.FindAll([System.Windows.Automation.TreeScope]::Descendants, $fileNameClassCondition) | Where-Object { $_.Current.AutomationId -in @('1001', '1148') })",
    "if ($fileNames.Count -ne 1) { throw ('Native file dialog exposed ' + $fileNames.Count + ' exact File name controls') }",
    "$fileName = $fileNames[0]",
    "$fileNameHwnd = [intptr]$fileName.Current.NativeWindowHandle",
    "if ($fileNameHwnd -eq [intptr]::Zero) { throw 'Native file dialog File name control has no native handle' }",
    "[EtherA02DialogOwner]::TypeExact($fileNameHwnd, $filePath)",
    "$buttons = $dialog.FindAll([System.Windows.Automation.TreeScope]::Descendants, $dialogButtonCondition)",
    "$confirm = @($buttons | Where-Object { $_.Current.Name -in @('Open', 'Save') }) | Select-Object -First 1",
    "if ($null -eq $confirm) { throw 'Native file dialog exposed no Open/Save UIA button' }",
    "$confirmHwnd = [intptr]$confirm.Current.NativeWindowHandle",
    "if ($confirmHwnd -eq [intptr]::Zero) { throw 'Native file dialog confirmation button has no native handle' }",
    "[EtherA02DialogOwner]::ClickExact($confirmHwnd)",
    "Write-Output ('uia-file-dialog ownerPid=' + $ownerPid + ' path=' + $filePath)"
  ].join("; ");
  return runPowerShell(script);
}

/** Reads and closes one native modal owned by the exact Ether window. */
export async function readAndCloseExactOwnedNativeDialogWithUia(ownerPid: number): Promise<string> {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "Add-Type -AssemblyName UIAutomationClient",
    "Add-Type -TypeDefinition 'using System; using System.Collections.Generic; using System.Runtime.InteropServices; public static class EtherA02OwnedDialog { public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam); [DllImport(\"user32.dll\")] public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam); [DllImport(\"user32.dll\")] public static extern IntPtr GetWindow(IntPtr hWnd, uint command); [DllImport(\"user32.dll\")] public static extern bool IsWindow(IntPtr hWnd); [DllImport(\"user32.dll\")] public static extern bool IsWindowEnabled(IntPtr hWnd); [DllImport(\"user32.dll\")] private static extern bool PostMessage(IntPtr hWnd, uint message, IntPtr wParam, IntPtr lParam); public static IntPtr[] OwnedWindows(IntPtr owner) { var windows = new List<IntPtr>(); EnumWindows((hWnd, lParam) => { if (hWnd != owner && GetWindow(hWnd, 4) == owner) windows.Add(hWnd); return true; }, IntPtr.Zero); return windows.ToArray(); } public static void ClickExact(IntPtr button) { if (!PostMessage(button, 0x00F5, IntPtr.Zero, IntPtr.Zero)) throw new InvalidOperationException(\"Could not post exact native dialog click.\"); } }' -ErrorAction SilentlyContinue",
    `$ownerPid = ${ownerPid}`,
    "$byPid = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $ownerPid)",
    "$ownerWindows = @([System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, $byPid) | Where-Object { $_.Current.ClassName -ne '#32770' -and $_.Current.NativeWindowHandle -ne 0 })",
    "if ($ownerWindows.Count -ne 1) { throw ('Expected one exact Ether owner window; found ' + $ownerWindows.Count) }",
    "$ownerHwnd = [intptr]$ownerWindows[0].Current.NativeWindowHandle",
    "$deadline = [DateTime]::UtcNow.AddSeconds(15)",
    "$dialog = $null",
    "while ([DateTime]::UtcNow -lt $deadline -and $null -eq $dialog) { $matches = @([EtherA02OwnedDialog]::OwnedWindows($ownerHwnd) | ForEach-Object { [System.Windows.Automation.AutomationElement]::FromHandle([intptr]$_) } | Where-Object { $_.Current.ClassName -eq '#32770' }); if ($matches.Count -gt 1) { throw ('Expected at most one exact Ether-owned native dialog; found ' + $matches.Count) }; if ($matches.Count -eq 1) { $dialog = $matches[0] } else { Start-Sleep -Milliseconds 150 } }",
    "if ($null -eq $dialog) { throw 'Exact Ether-owned native dialog did not appear within 15 seconds.' }",
    "$dialogHwnd = [intptr]$dialog.Current.NativeWindowHandle",
    "if ($dialogHwnd -eq [intptr]::Zero) { throw 'Exact Ether-owned native dialog has no HWND' }",
    "$text = @($dialog.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition) | ForEach-Object { $_.Current.Name } | Where-Object { $_ }) -join ' '",
    "$dialogDescendants = $dialog.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)",
    "$buttons = @($dialogDescendants | Where-Object { $_.Current.ClassName -in @('Button', 'CCPushButton') -and $_.Current.Name -in @('OK', 'Close') })",
    "if ($buttons.Count -ne 1) { $rawControls = @($dialogDescendants | ForEach-Object { 'name=' + $_.Current.Name + ',class=' + $_.Current.ClassName + ',id=' + $_.Current.AutomationId + ',type=' + $_.Current.ControlType.ProgrammaticName }) -join '; '; throw ('Exact Ether-owned native dialog exposed ' + $buttons.Count + ' safe close buttons. Controls: ' + $rawControls) }",
    "$buttonHwnd = [intptr]$buttons[0].Current.NativeWindowHandle",
    "if ($buttonHwnd -eq [intptr]::Zero) { throw 'Exact native dialog button has no HWND' }",
    "[EtherA02OwnedDialog]::ClickExact($buttonHwnd)",
    "$closeDeadline = [DateTime]::UtcNow.AddSeconds(15)",
    "while ([DateTime]::UtcNow -lt $closeDeadline -and ([EtherA02OwnedDialog]::IsWindow($dialogHwnd) -or -not [EtherA02OwnedDialog]::IsWindowEnabled($ownerHwnd))) { Start-Sleep -Milliseconds 100 }",
    "if ([EtherA02OwnedDialog]::IsWindow($dialogHwnd) -or -not [EtherA02OwnedDialog]::IsWindowEnabled($ownerHwnd)) { throw 'Exact Ether-owned native dialog did not close and re-enable its owner within 15 seconds' }",
    "Write-Output $text"
  ].join("; ");
  return runPowerShell(script);
}

/** Invokes one named button in a native modal owned by the exact Ether window. */
export async function invokeExactOwnedNativeButtonWithUia(ownerPid: number, buttonName: string): Promise<string> {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "Add-Type -AssemblyName UIAutomationClient",
    "Add-Type -TypeDefinition 'using System; using System.Collections.Generic; using System.Runtime.InteropServices; public static class EtherA02NativeButtonOwner { public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam); [DllImport(\"user32.dll\")] public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam); [DllImport(\"user32.dll\")] public static extern IntPtr GetWindow(IntPtr hWnd, uint command); [DllImport(\"user32.dll\")] private static extern IntPtr SendMessage(IntPtr hWnd, uint message, IntPtr wParam, IntPtr lParam); public static IntPtr[] OwnedWindows(IntPtr owner) { var windows = new List<IntPtr>(); EnumWindows((hWnd, lParam) => { if (hWnd != owner && GetWindow(hWnd, 4) == owner) windows.Add(hWnd); return true; }, IntPtr.Zero); return windows.ToArray(); } public static void ClickExact(IntPtr button) { SendMessage(button, 0x00F5, IntPtr.Zero, IntPtr.Zero); } }' -ErrorAction SilentlyContinue",
    `$ownerPid = ${ownerPid}`,
    `$buttonName = '${ps(buttonName)}'`,
    "$byPid = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $ownerPid)",
    "$ownerWindows = @([System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, $byPid) | Where-Object { $_.Current.ClassName -ne '#32770' -and $_.Current.NativeWindowHandle -ne 0 })",
    "if ($ownerWindows.Count -ne 1) { throw ('Expected one exact Ether owner window; found ' + $ownerWindows.Count) }",
    "$ownerHwnd = [intptr]$ownerWindows[0].Current.NativeWindowHandle",
    "$buttonCondition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, $buttonName)",
    "$deadline = [DateTime]::UtcNow.AddSeconds(15)",
    "$button = $null",
    "while ([DateTime]::UtcNow -lt $deadline -and $null -eq $button) {",
    "  $matches = @([EtherA02NativeButtonOwner]::OwnedWindows($ownerHwnd) | ForEach-Object { [System.Windows.Automation.AutomationElement]::FromHandle([intptr]$_) } | ForEach-Object { $_.FindAll([System.Windows.Automation.TreeScope]::Descendants, $buttonCondition) })",
    "  if ($matches.Count -gt 1) { throw ('Expected at most one exact owned native button named ' + $buttonName + '; found ' + $matches.Count) }",
    "  if ($matches.Count -eq 1) { $button = $matches[0] } else { Start-Sleep -Milliseconds 150 }",
    "}",
    "if ($null -eq $button) { throw ('Exact Ether-owned native button was not found: ' + $buttonName) }",
    "$invoke = $null",
    "try { $invoke = $button.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern) } catch { $invoke = $null }",
    "if ($null -ne $invoke) { ([System.Windows.Automation.InvokePattern]$invoke).Invoke() } else { $buttonHwnd = [intptr]$button.Current.NativeWindowHandle; if ($buttonHwnd -eq [intptr]::Zero) { throw ('Exact native button has neither InvokePattern nor HWND: ' + $buttonName) }; [EtherA02NativeButtonOwner]::ClickExact($buttonHwnd) }",
    "Write-Output ('uia-native-button ownerPid=' + $ownerPid + ' name=' + $buttonName)"
  ].join("; ");
  return runPowerShell(script);
}

async function assertTestOwnedPath(root: string, candidate: string): Promise<void> {
  const [resolvedRoot, absoluteCandidate] = await Promise.all([realpath(root), Promise.resolve(path.resolve(candidate))]);
  const relative = path.relative(resolvedRoot, absoluteCandidate);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`Expected a test-owned path below ${root}: ${candidate}`);
}

async function snapshotTree(root: string): Promise<Array<{ path: string; sha256: string; size: number }>> {
  if (!await isDirectory(root)) return [];
  const files: Array<{ path: string; sha256: string; size: number }> = [];
  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile()) {
        const bytes = await readFile(absolute);
        files.push({
          path: path.relative(root, absolute).replaceAll("\\", "/"),
          sha256: createHash("sha256").update(bytes).digest("hex"),
          size: bytes.length
        });
      }
    }
  };
  await visit(root);
  return files.sort((left, right) => left.path.localeCompare(right.path, "en-US"));
}

async function snapshotExactFile(filePath: string): Promise<{ sha256: string; size: number } | null> {
  try {
    const [information, bytes] = await Promise.all([stat(filePath), readFile(filePath)]);
    if (!information.isFile()) return null;
    return { sha256: createHash("sha256").update(bytes).digest("hex"), size: bytes.length };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function assertAssociationStillOriginal(plan: ReversibleAssociationPlan): Promise<void> {
  if (await registryKeyExists(plan.testProgIdKey)) throw new Error("The unique recovery ProgID unexpectedly existed before mutation.");
  if (!plan.snapshot.extensionExisted) {
    if (await registryKeyExists(plan.extensionKey)) throw new Error("The .ether association appeared after planning; refusing to overwrite a concurrent change.");
  } else {
    if (plan.snapshot.extensionBackup === null || !await registryKeyExists(plan.extensionKey)) {
      throw new Error("The original .ether association disappeared after planning; refusing mutation.");
    }
    const current = path.join(plan.snapshot.root, "extension-before-apply.reg");
    await exportRegistryKey(plan.extensionKey, current);
    await assertFilesEqual(plan.snapshot.extensionBackup, current, "pre-apply .ether association tree");
  }
  await expectEffectiveAssociationCommand(plan.snapshot.effectiveOpenCommand);
}

async function classifyCurrentAssociationState(plan: ReversibleAssociationPlan): Promise<"applied" | "original"> {
  const currentDefault = await readRegistryDefaultSnapshot(plan.extensionKey);
  if (currentDefault.exists && currentDefault.kind === "String" && currentDefault.rawValue === plan.testProgId) return "applied";
  if (sameRegistryDefaultSnapshot(currentDefault, plan.snapshot.extensionDefault)) return "original";
  throw new Error("Refusing to overwrite a concurrently changed .ether association default value.");
}

async function assertAssociationSnapshotRestored(plan: ReversibleAssociationPlan): Promise<void> {
  if (await registryKeyExists(plan.testProgIdKey)) throw new Error("Temporary Ether recovery ProgID remained after restoration.");
  if (plan.snapshot.extensionExisted) {
    if (plan.snapshot.extensionBackup === null || !await registryKeyExists(plan.extensionKey)) {
      throw new Error("Original .ether association tree was not restored.");
    }
    const after = path.join(plan.snapshot.root, "extension-after.reg");
    await exportRegistryKey(plan.extensionKey, after);
    await assertFilesEqual(plan.snapshot.extensionBackup, after, ".ether association tree");
  } else if (await registryKeyExists(plan.extensionKey)) {
    throw new Error("A previously absent .ether association tree remained after restoration.");
  }
  if (plan.snapshot.originalProgId !== null && plan.snapshot.originalProgIdExisted) {
    if (plan.snapshot.originalProgIdBackup === null) throw new Error("Original ProgID backup metadata is incomplete.");
    const originalKey = `${ASSOCIATION_ROOT}\\${plan.snapshot.originalProgId}`;
    if (!await registryKeyExists(originalKey)) throw new Error("Original ProgID disappeared during association restoration.");
    const after = path.join(plan.snapshot.root, "original-progid-after.reg");
    await exportRegistryKey(originalKey, after);
    await assertFilesEqual(plan.snapshot.originalProgIdBackup, after, "original ProgID tree");
  }
  await expectEffectiveAssociationCommand(plan.snapshot.effectiveOpenCommand);
}

async function assertFilesEqual(expectedPath: string, actualPath: string, label: string): Promise<void> {
  const [expected, actual] = await Promise.all([readFile(expectedPath), readFile(actualPath)]);
  if (!expected.equals(actual)) throw new Error(`${label} did not restore byte-for-byte from its exported registry snapshot.`);
}

async function notifyAssociationChanged(): Promise<void> {
  await runPowerShell([
    "$ErrorActionPreference = 'Stop'",
    "Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class EtherA02AssociationChange { [DllImport(\"shell32.dll\")] public static extern void SHChangeNotify(uint eventId, uint flags, IntPtr item1, IntPtr item2); }' -ErrorAction SilentlyContinue",
    "[EtherA02AssociationChange]::SHChangeNotify(0x08000000, 0, [IntPtr]::Zero, [IntPtr]::Zero)"
  ].join("; "));
}

async function readEffectiveAssociationCommand(): Promise<string | null> {
  try {
    const result = await runPowerShell([
      "$ErrorActionPreference = 'Stop'",
      "Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; using System.Text; public static class EtherA02AssocQuery { [DllImport(\"Shlwapi.dll\", CharSet=CharSet.Unicode)] public static extern uint AssocQueryString(uint flags, uint query, string association, string extra, StringBuilder output, ref uint length); }' -ErrorAction SilentlyContinue",
      "[uint32]$length = 0",
      "[EtherA02AssocQuery]::AssocQueryString(0, 1, '.ether', 'open', $null, [ref]$length) | Out-Null",
      "if ($length -eq 0) { exit 2 }",
      "$builder = New-Object System.Text.StringBuilder([int]$length)",
      "$status = [EtherA02AssocQuery]::AssocQueryString(0, 1, '.ether', 'open', $builder, [ref]$length)",
      "if ($status -ne 0) { throw ('AssocQueryString failed with status ' + $status) }",
      "Write-Output $builder.ToString()"
    ].join("; "));
    return result.length === 0 ? null : result;
  } catch {
    return null;
  }
}

async function expectEffectiveAssociationCommand(expected: string | null): Promise<void> {
  const deadline = Date.now() + 10_000;
  let actual = await readEffectiveAssociationCommand();
  do {
    if (normalizeAssociationCommand(actual) === normalizeAssociationCommand(expected)) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
    actual = await readEffectiveAssociationCommand();
  } while (Date.now() < deadline);
  throw new Error(`Effective .ether handler mismatch. Expected ${expected ?? "<none>"}; observed ${actual ?? "<none>"}.`);
}

function normalizeAssociationCommand(command: string | null): string | null {
  return command?.trim().replaceAll(/\s+/gu, " ").toLocaleLowerCase("en-US") ?? null;
}

function quoteWindowsArgument(argument: string): string {
  if (/["\r\n]/u.test(argument)) throw new Error("Recovery association arguments cannot contain quotes or line breaks.");
  return `"${argument}"`;
}

function assertRecoveryShellToken(token: string): void {
  if (!/^[a-f0-9]{32}$/u.test(token)) throw new Error("Recovery shell token must be 32 lowercase hexadecimal characters.");
}

async function waitForChildExit(child: ChildProcess, timeoutMs: number): Promise<void> {
  if (child.exitCode !== null) {
    if (child.exitCode !== 0) throw new Error(`Association watchdog exited with code ${child.exitCode}.`);
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Association watchdog did not exit within ${timeoutMs}ms.`));
    }, timeoutMs);
    const onExit = (code: number | null) => {
      cleanup();
      if (code === 0) resolve();
      else reject(new Error(`Association watchdog exited with code ${code ?? "unknown"}.`));
    };
    const onError = (error: Error) => { cleanup(); reject(error); };
    const cleanup = () => {
      clearTimeout(timer);
      child.off("exit", onExit);
      child.off("error", onError);
    };
    child.once("exit", onExit);
    child.once("error", onError);
  });
}

async function isFile(candidate: string): Promise<boolean> {
  try { return (await stat(candidate)).isFile(); } catch { return false; }
}

async function isDirectory(candidate: string): Promise<boolean> {
  try { return (await stat(candidate)).isDirectory(); } catch { return false; }
}

async function mkdtempInTemp(prefix: string): Promise<string> {
  const { mkdtemp } = await import("node:fs/promises");
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

async function registryKeyExists(key: string): Promise<boolean> {
  try { await execReg(["query", key]); return true; } catch { return false; }
}

async function readRegistryDefaultSnapshot(key: string): Promise<RegistryDefaultSnapshot> {
  const relativeKey = key.replace(/^HKCU\\/u, "");
  const serialized = await runPowerShell([
    "$ErrorActionPreference = 'Stop'",
    `$relativeKey = '${ps(relativeKey)}'`,
    "$key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($relativeKey)",
    "if ($null -eq $key) { Write-Output '{\"exists\":false,\"kind\":null,\"rawValue\":null}'; return }",
    "try { $exists = $key.GetValueNames() -contains ''; if (-not $exists) { Write-Output '{\"exists\":false,\"kind\":null,\"rawValue\":null}'; return }; $kind = [string]$key.GetValueKind(''); if ($kind -notin @('String', 'ExpandString')) { throw ('Unsupported .ether default registry kind: ' + $kind) }; $raw = $key.GetValue('', $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames); if ($raw -isnot [string]) { throw 'The .ether default registry value is not a string.' }; [pscustomobject]@{ exists = $true; kind = $kind; rawValue = [string]$raw } | ConvertTo-Json -Compress } finally { $key.Close() }"
  ].join("; "));
  return JSON.parse(serialized) as RegistryDefaultSnapshot;
}

async function exportRegistryKey(key: string, destination: string): Promise<void> {
  await execReg(["export", key, destination, "/y"]);
}

async function deleteRegistryTree(key: string): Promise<void> {
  if (!await registryKeyExists(key)) return;
  await execReg(["delete", key, "/f"]);
  if (await registryKeyExists(key)) throw new Error(`Registry tree remained after exact delete: ${key}`);
}

async function deleteRegistryDefaultValue(key: string): Promise<void> {
  await execReg(["delete", key, "/ve", "/f"]);
  if ((await readRegistryDefaultSnapshot(key)).exists) throw new Error(`Registry default value remained after exact delete: ${key}`);
}

async function restoreRegistryDefaultValue(key: string, snapshot: RegistryDefaultSnapshot): Promise<void> {
  if (!snapshot.exists) {
    await deleteRegistryDefaultValue(key);
    return;
  }
  if (snapshot.kind === null || snapshot.rawValue === null) throw new Error("Original registry default metadata is incomplete.");
  const relativeKey = key.replace(/^HKCU\\/u, "");
  await runPowerShell([
    "$ErrorActionPreference = 'Stop'",
    `$relativeKey = '${ps(relativeKey)}'`,
    `$kindName = '${ps(snapshot.kind)}'`,
    `$rawValue = '${ps(snapshot.rawValue)}'`,
    "$key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($relativeKey)",
    "try { $kind = [Microsoft.Win32.RegistryValueKind]$kindName; $key.SetValue('', $rawValue, $kind) } finally { $key.Close() }"
  ].join("; "));
  const restored = await readRegistryDefaultSnapshot(key);
  if (!sameRegistryDefaultSnapshot(restored, snapshot)) throw new Error(`Registry default value did not restore exactly: ${key}`);
}

function sameRegistryDefaultSnapshot(left: RegistryDefaultSnapshot, right: RegistryDefaultSnapshot): boolean {
  return left.exists === right.exists && left.kind === right.kind && left.rawValue === right.rawValue;
}

async function deleteRegistryTreeIfEmpty(key: string): Promise<void> {
  const providerPath = key.replace(/^HKCU\\/u, "Registry::HKEY_CURRENT_USER\\");
  await runPowerShell([
    "$ErrorActionPreference = 'Stop'",
    `$key = '${ps(providerPath)}'`,
    "if (-not (Test-Path -LiteralPath $key)) { return }",
    "$item = Get-Item -LiteralPath $key",
    "if ($item.GetValueNames().Count -ne 0 -or $item.GetSubKeyNames().Count -ne 0) { throw 'Refusing to delete a non-empty registry tree created concurrently.' }",
    "Remove-Item -LiteralPath $key -Force",
    "if (Test-Path -LiteralPath $key) { throw 'Empty registry tree remained after exact delete.' }"
  ].join("; "));
}

async function execReg(args: string[]): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync("reg.exe", args, { windowsHide: true });
}

async function runPowerShell(script: string, timeout?: number): Promise<string> {
  assertPowerShellEncodedCommandLength(script);
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Sta", "-EncodedCommand", encoded], { timeout, windowsHide: true });
  return stdout.trim();
}

/** Reserve command-line headroom because -EncodedCommand expands UTF-16 script bytes as Base64. */
function assertPowerShellEncodedCommandLength(script: string): void {
  const encodedLength = encodedPowerShellCommandLength(script);
  if (encodedLength > MAX_ENCODED_POWERSHELL_COMMAND_LENGTH) {
    throw new Error(`Refusing PowerShell script with an encoded command length of ${encodedLength}; limit is ${MAX_ENCODED_POWERSHELL_COMMAND_LENGTH}.`);
  }
}

export function encodedPowerShellCommandLength(script: string): number {
  return 4 * Math.ceil(Buffer.byteLength(script, "utf16le") / 3);
}

function sameWindowsPath(left: string, right: string): boolean {
  return path.win32.normalize(left).toLocaleLowerCase("en-US") === path.win32.normalize(right).toLocaleLowerCase("en-US");
}

function ps(value: string): string {
  return value.replaceAll("'", "''");
}
