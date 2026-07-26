import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  lstat,
  link,
  open,
  readFile,
  realpath,
  unlink,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export type ExportPublicationCheckpoint = "after-stage-open" | "after-stage-write";
export type ExportPublicationStatus = "existing" | "published";

export interface AtomicExportOutput {
  checkpoint?: ExportPublicationCheckpoint;
  checkpointMarkerPath?: string;
  checkpointReleasePath?: string;
  destination: string;
  expectedByteLength: number;
  expectedHash: string;
  publicationId: string;
  sourcePath: string;
}

export interface AtomicExportBundlePublication {
  beforeAcquire?: () => Promise<void> | void;
  onOutputPublished?: (
    output: AtomicExportOutput,
    index: number,
    status: ExportPublicationStatus
  ) => Promise<void> | void;
  outputs: readonly AtomicExportOutput[];
  root: string;
}

export interface AtomicExportPublication extends AtomicExportOutput {
  beforeAcquire?: () => Promise<void> | void;
  root: string;
}

interface ExportDirectoryIdentity {
  dev: string;
  ino: string;
  path: string;
}

interface ValidatedExportBundle {
  beforeAcquire?: AtomicExportBundlePublication["beforeAcquire"];
  onOutputPublished?: AtomicExportBundlePublication["onOutputPublished"];
  outputs: AtomicExportOutput[];
  root: string;
}

const WINDOWS_PUBLISHER_SOURCE = String.raw`
$ErrorActionPreference = "Stop"
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public static class EtherExportNative {
  public const uint GENERIC_READ = 0x80000000;
  public const uint FILE_SHARE_READ = 1;
  public const uint FILE_SHARE_WRITE = 2;
  public const uint OPEN_EXISTING = 3;
  public const uint FILE_ATTRIBUTE_REPARSE_POINT = 0x00000400;
  public const uint FILE_FLAG_OPEN_REPARSE_POINT = 0x00200000;
  public const uint FILE_FLAG_BACKUP_SEMANTICS = 0x02000000;
  public const uint MOVEFILE_WRITE_THROUGH = 0x00000008;
  [StructLayout(LayoutKind.Sequential)]
  public struct FILETIME { public uint Low; public uint High; }
  [StructLayout(LayoutKind.Sequential)]
  public struct BY_HANDLE_FILE_INFORMATION {
    public uint FileAttributes;
    public FILETIME CreationTime;
    public FILETIME LastAccessTime;
    public FILETIME LastWriteTime;
    public uint VolumeSerialNumber;
    public uint FileSizeHigh;
    public uint FileSizeLow;
    public uint NumberOfLinks;
    public uint FileIndexHigh;
    public uint FileIndexLow;
  }
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern SafeFileHandle CreateFileW(
    string name, uint access, uint share, IntPtr security, uint creation,
    uint flags, IntPtr template);
  [DllImport("kernel32.dll", SetLastError=true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  public static extern bool GetFileInformationByHandle(
    SafeFileHandle handle, out BY_HANDLE_FILE_INFORMATION information);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern uint GetFileAttributesW(string name);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  public static extern bool MoveFileExW(string existingName, string newName, uint flags);
}
"@

function Normalize-Directory([string]$Candidate) {
  $full = [System.IO.Path]::GetFullPath($Candidate)
  $driveRoot = [System.IO.Path]::GetPathRoot($full)
  if ($full.Equals($driveRoot, [StringComparison]::OrdinalIgnoreCase)) { return $driveRoot }
  return $full.TrimEnd("\")
}

function Assert-Not-Reparse([string]$Candidate, [string]$Label) {
  $attributes = [EtherExportNative]::GetFileAttributesW($Candidate)
  if ($attributes -eq [uint32]::MaxValue) { return }
  if (($attributes -band [EtherExportNative]::FILE_ATTRIBUTE_REPARSE_POINT) -ne 0) {
    throw "ETHER_EXPORT_REPARSE: " + $Label
  }
}

function Open-Verified-Directory($Expected) {
  $handle = [EtherExportNative]::CreateFileW(
    $Expected.path, 0,
    [EtherExportNative]::FILE_SHARE_READ -bor [EtherExportNative]::FILE_SHARE_WRITE,
    [IntPtr]::Zero, [EtherExportNative]::OPEN_EXISTING,
    [EtherExportNative]::FILE_FLAG_BACKUP_SEMANTICS -bor [EtherExportNative]::FILE_FLAG_OPEN_REPARSE_POINT,
    [IntPtr]::Zero)
  if ($handle.IsInvalid) {
    throw "ETHER_EXPORT_DIRECTORY_OPEN: Win32=" + [Runtime.InteropServices.Marshal]::GetLastWin32Error()
  }
  $information = [EtherExportNative+BY_HANDLE_FILE_INFORMATION]::new()
  if (-not [EtherExportNative]::GetFileInformationByHandle($handle, [ref]$information)) {
    $handle.Dispose()
    throw "ETHER_EXPORT_DIRECTORY_IDENTITY: Win32=" + [Runtime.InteropServices.Marshal]::GetLastWin32Error()
  }
  if (($information.FileAttributes -band [EtherExportNative]::FILE_ATTRIBUTE_REPARSE_POINT) -ne 0) {
    $handle.Dispose()
    throw "ETHER_EXPORT_REPARSE: " + $Expected.path
  }
  $fileIndex = ([System.Numerics.BigInteger]$information.FileIndexHigh -shl 32) + $information.FileIndexLow
  if (
    ([string]$information.VolumeSerialNumber) -ne ([string]$Expected.dev) -or
    ([string]$fileIndex) -ne ([string]$Expected.ino)
  ) {
    $handle.Dispose()
    throw "ETHER_EXPORT_DIRECTORY_CHANGED: " + $Expected.path
  }
  return $handle
}

function Hash-File([string]$Path) {
  $handle = [EtherExportNative]::CreateFileW(
    $Path, [EtherExportNative]::GENERIC_READ, [EtherExportNative]::FILE_SHARE_READ,
    [IntPtr]::Zero, [EtherExportNative]::OPEN_EXISTING,
    [EtherExportNative]::FILE_FLAG_OPEN_REPARSE_POINT, [IntPtr]::Zero)
  if ($handle.IsInvalid) {
    throw "ETHER_EXPORT_FILE_OPEN: Win32=" + [Runtime.InteropServices.Marshal]::GetLastWin32Error()
  }
  $information = [EtherExportNative+BY_HANDLE_FILE_INFORMATION]::new()
  if (-not [EtherExportNative]::GetFileInformationByHandle($handle, [ref]$information)) {
    $handle.Dispose()
    throw "ETHER_EXPORT_FILE_IDENTITY: Win32=" + [Runtime.InteropServices.Marshal]::GetLastWin32Error()
  }
  if (($information.FileAttributes -band [EtherExportNative]::FILE_ATTRIBUTE_REPARSE_POINT) -ne 0) {
    $handle.Dispose()
    throw "ETHER_EXPORT_REPARSE: file"
  }
  $stream = [System.IO.FileStream]::new($handle, [System.IO.FileAccess]::Read)
  try {
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
      return @{
        Hash = ([BitConverter]::ToString($sha.ComputeHash($stream))).Replace("-", "").ToLowerInvariant()
        Length = $stream.Length
      }
    }
    finally { $sha.Dispose() }
  } finally { $stream.Dispose() }
}

function Test-Verified-File([string]$Path, [long]$Length, [string]$Hash) {
  if (-not [System.IO.File]::Exists($Path)) { return $false }
  Assert-Not-Reparse $Path "verified file"
  $information = Hash-File $Path
  return $information.Length -eq $Length -and $information.Hash -eq $Hash
}

function Wait-Checkpoint($Request, $Output, [string]$Stage) {
  if ($Output.checkpoint -ne $Stage) { return }
  if ([string]::IsNullOrEmpty($Output.checkpointMarkerPath)) { throw "Checkpoint marker is required." }
  [System.IO.File]::WriteAllText($Output.checkpointMarkerPath, $Stage)
  while ($true) {
    if (-not [string]::IsNullOrEmpty($Output.checkpointReleasePath) -and [System.IO.File]::Exists($Output.checkpointReleasePath)) { return }
    try { [System.Diagnostics.Process]::GetProcessById([int]$Request.parentPid) | Out-Null }
    catch { exit 97 }
    [System.Threading.Thread]::Sleep(20)
  }
}

function Publish-Output($Request, $Output) {
  $mutex = [System.Threading.Mutex]::new($false, "Local\EtherExport-" + $Output.mutexId)
  $acquired = $false
  try {
    try { $acquired = $mutex.WaitOne(30000) }
    catch [System.Threading.AbandonedMutexException] { $acquired = $true }
    if (-not $acquired) { throw "ETHER_EXPORT_MUTEX_TIMEOUT" }
    $parent = [System.IO.Path]::GetDirectoryName([System.IO.Path]::GetFullPath($Output.destination))
    $stage = [System.IO.Path]::Combine($parent, ".ether-export-" + $Output.publicationId + ".stage")
    Assert-Not-Reparse $Output.sourcePath "durable source"
    if (-not (Test-Verified-File $Output.sourcePath ([long]$Output.expectedByteLength) $Output.expectedHash)) {
      throw "The durable export staging source failed verification."
    }
    if ([System.IO.File]::Exists($stage) -or [System.IO.Directory]::Exists($stage)) {
      Assert-Not-Reparse $stage "same-parent stage"
      if (-not (Test-Verified-File $stage ([long]$Output.expectedByteLength) $Output.expectedHash)) {
        [System.IO.File]::Delete($stage)
      }
    }
    if (-not [System.IO.File]::Exists($stage)) {
      $source = [System.IO.File]::Open($Output.sourcePath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::Read)
      try {
        $target = [System.IO.FileStream]::new(
          $stage, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write,
          [System.IO.FileShare]::Read, 65536, [System.IO.FileOptions]::WriteThrough)
        try {
          Wait-Checkpoint $Request $Output "after-stage-open"
          $source.CopyTo($target)
          $target.Flush($true)
          Wait-Checkpoint $Request $Output "after-stage-write"
        } finally { $target.Dispose() }
      } finally { $source.Dispose() }
    }
    Assert-Not-Reparse $stage "same-parent stage"
    if (-not (Test-Verified-File $stage ([long]$Output.expectedByteLength) $Output.expectedHash)) {
      throw "The same-parent export stage failed verification."
    }
    if ([System.IO.File]::Exists($Output.destination) -or [System.IO.Directory]::Exists($Output.destination)) {
      Assert-Not-Reparse $Output.destination "destination"
      if (Test-Verified-File $Output.destination ([long]$Output.expectedByteLength) $Output.expectedHash) {
        [System.IO.File]::Delete($stage)
        return "existing"
      }
      [System.IO.File]::Delete($stage)
      throw "ETHER_EXPORT_COLLISION"
    }
    if (-not [EtherExportNative]::MoveFileExW($stage, $Output.destination, [EtherExportNative]::MOVEFILE_WRITE_THROUGH)) {
      $moveError = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
      if ([System.IO.File]::Exists($Output.destination)) {
        Assert-Not-Reparse $Output.destination "destination"
        if (Test-Verified-File $Output.destination ([long]$Output.expectedByteLength) $Output.expectedHash) {
          if ([System.IO.File]::Exists($stage)) { [System.IO.File]::Delete($stage) }
          return "existing"
        }
        if ([System.IO.File]::Exists($stage)) { [System.IO.File]::Delete($stage) }
        throw "ETHER_EXPORT_COLLISION"
      }
      throw "Atomic export publication failed. Win32=" + $moveError
    }
    Assert-Not-Reparse $Output.destination "published destination"
    if (-not (Test-Verified-File $Output.destination ([long]$Output.expectedByteLength) $Output.expectedHash)) {
      throw "The published export failed verification."
    }
    return "published"
  } finally {
    if ($acquired) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
  }
}

$requestLine = [Console]::In.ReadLine()
if ([string]::IsNullOrEmpty($requestLine)) { throw "The export request is missing." }
$json = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($requestLine))
$request = $json | ConvertFrom-Json
$root = Normalize-Directory $request.root
$rootPrefix = if ($root.EndsWith("\")) { $root } else { $root + "\" }
$directoryHandles = [System.Collections.Generic.List[Microsoft.Win32.SafeHandles.SafeFileHandle]]::new()
try {
  foreach ($expected in $request.expectedDirectories) {
    $normalized = Normalize-Directory $expected.path
    if (
      $normalized -ne $root -and
      -not $normalized.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)
    ) {
      throw "The export destination chain escaped its granted root."
    }
    $directoryHandles.Add((Open-Verified-Directory $expected))
  }
  for ($index = 0; $index -lt $request.outputs.Count; $index++) {
    $status = Publish-Output $request $request.outputs[$index]
    [Console]::Out.WriteLine("__ETHER_OUTPUT__|" + $index + "|" + $status)
    [Console]::Out.Flush()
    if ([Console]::In.ReadLine() -ne "continue") { throw "ETHER_EXPORT_PARENT_ABORTED" }
  }
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  if ($_.Exception.Message -match "ETHER_EXPORT_COLLISION") { exit 42 }
  exit 1
} finally {
  for ($index = $directoryHandles.Count - 1; $index -ge 0; $index--) {
    $directoryHandles[$index].Dispose()
  }
}
`;

const WINDOWS_PUBLISHER_ENCODED = Buffer
  .from(WINDOWS_PUBLISHER_SOURCE.trimStart(), "utf16le")
  .toString("base64");

function publicationError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), {
    code,
    name: "ApplicationServiceError"
  });
}

function publicationStageName(publicationId: string): string {
  return `.ether-export-${publicationId}.stage`;
}

function validateBundle(input: AtomicExportBundlePublication): ValidatedExportBundle {
  const root = path.resolve(input.root);
  if (input.outputs.length === 0) {
    throw publicationError("EXPORT_VERIFY_FAILED", "An export bundle must contain at least one output.");
  }
  const outputs = input.outputs.map((output) => {
    const destination = path.resolve(output.destination);
    const relative = path.relative(root, destination);
    if (
      relative.length === 0 ||
      relative === ".." ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    ) {
      throw publicationError("PATH_ESCAPE", "The export destination escaped its granted root.");
    }
    if (!/^[a-f0-9]{64}$/u.test(output.expectedHash)) {
      throw publicationError("EXPORT_VERIFY_FAILED", "The export publication hash is invalid.");
    }
    if (!/^[a-f0-9]{32}$/u.test(output.publicationId)) {
      throw publicationError("EXPORT_VERIFY_FAILED", "The export publication identity is invalid.");
    }
    if (!Number.isSafeInteger(output.expectedByteLength) || output.expectedByteLength < 0) {
      throw publicationError("EXPORT_VERIFY_FAILED", "The export publication length is invalid.");
    }
    return { ...output, destination, sourcePath: path.resolve(output.sourcePath) };
  });
  return {
    ...(input.beforeAcquire === undefined ? {} : { beforeAcquire: input.beforeAcquire }),
    ...(input.onOutputPublished === undefined
      ? {}
      : { onOutputPublished: input.onOutputPublished }),
    outputs,
    root
  };
}

function samePath(left: string, right: string): boolean {
  const leftResolved = path.resolve(left);
  const rightResolved = path.resolve(right);
  return process.platform === "win32"
    ? leftResolved.toLocaleLowerCase() === rightResolved.toLocaleLowerCase()
    : leftResolved === rightResolved;
}

async function captureDirectoryIdentities(
  root: string,
  outputs: readonly AtomicExportOutput[]
): Promise<ExportDirectoryIdentity[]> {
  const directories = new Map<string, string>();
  const resolvedRoot = path.resolve(root);
  directories.set(process.platform === "win32" ? resolvedRoot.toLocaleLowerCase() : resolvedRoot, resolvedRoot);
  for (const output of outputs) {
    const parent = path.dirname(output.destination);
    const relativeParent = path.relative(resolvedRoot, parent);
    let current = resolvedRoot;
    for (const segment of relativeParent.split(path.sep).filter(Boolean)) {
      current = path.join(current, segment);
      directories.set(process.platform === "win32" ? current.toLocaleLowerCase() : current, current);
    }
  }
  const identities: ExportDirectoryIdentity[] = [];
  for (const directory of directories.values()) {
    const before = await lstat(directory, { bigint: true });
    if (!before.isDirectory() || before.isSymbolicLink()) {
      throw publicationError("PATH_ESCAPE", "The export directory chain contains a reparse point.");
    }
    const canonical = await realpath(directory);
    if (!samePath(canonical, directory)) {
      throw publicationError("PATH_ESCAPE", "The export directory chain changed during validation.");
    }
    const after = await lstat(directory, { bigint: true });
    if (
      !after.isDirectory() ||
      after.isSymbolicLink() ||
      before.dev !== after.dev ||
      before.ino !== after.ino
    ) {
      throw publicationError("PATH_GRANT_CHANGED", "The export directory chain changed during validation.");
    }
    identities.push({
      dev: after.dev.toString(),
      ino: after.ino.toString(),
      path: directory
    });
  }
  return identities;
}

async function verifyFile(
  filePath: string,
  expectedHash: string,
  expectedByteLength: number
): Promise<boolean> {
  try {
    const info = await lstat(filePath);
    if (!info.isFile() || info.isSymbolicLink() || info.size !== expectedByteLength) return false;
    return createHash("sha256").update(await readFile(filePath)).digest("hex") === expectedHash;
  } catch (error) {
    if ((error as { code?: unknown }).code === "ENOENT") return false;
    throw error;
  }
}

async function inputCheckpoint(
  output: AtomicExportOutput,
  stage: ExportPublicationCheckpoint
): Promise<void> {
  if (output.checkpoint !== stage) return;
  if (output.checkpointMarkerPath === undefined) {
    throw publicationError("EXPORT_CHECKPOINT_INVALID", "The export checkpoint marker is missing.");
  }
  await writeFile(output.checkpointMarkerPath, stage, { flag: "w" });
  while (
    output.checkpointReleasePath !== undefined &&
    !await lstat(output.checkpointReleasePath).then(() => true).catch(() => false)
  ) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function publishPortableOutput(output: AtomicExportOutput): Promise<ExportPublicationStatus> {
  const parent = path.dirname(output.destination);
  const stagePath = path.join(parent, publicationStageName(output.publicationId));
  if (!await verifyFile(output.sourcePath, output.expectedHash, output.expectedByteLength)) {
    throw publicationError("EXPORT_VERIFY_FAILED", "The durable export staging source failed verification.");
  }
  if (!await verifyFile(stagePath, output.expectedHash, output.expectedByteLength)) {
    await unlink(stagePath).catch((error: { code?: unknown }) => {
      if (error.code !== "ENOENT") throw error;
    });
    const source = await readFile(output.sourcePath);
    let descriptor: Awaited<ReturnType<typeof open>> | undefined;
    try {
      descriptor = await open(stagePath, "wx", 0o600);
      await inputCheckpoint(output, "after-stage-open");
      await descriptor.writeFile(source);
      await descriptor.sync();
      await inputCheckpoint(output, "after-stage-write");
    } catch (error) {
      if ((error as { code?: unknown }).code !== "EEXIST") throw error;
    } finally {
      await descriptor?.close();
    }
    if (!await verifyFile(stagePath, output.expectedHash, output.expectedByteLength)) {
      throw publicationError("EXPORT_VERIFY_FAILED", "The concurrent export stage failed verification.");
    }
  }
  if (await verifyFile(output.destination, output.expectedHash, output.expectedByteLength)) {
    await unlink(stagePath).catch(() => undefined);
    return "existing";
  }
  try {
    await lstat(output.destination);
    await unlink(stagePath).catch(() => undefined);
    throw publicationError("EXPORT_COLLISION", "The export destination already contains different bytes.");
  } catch (error) {
    if ((error as { code?: unknown }).code !== "ENOENT") throw error;
  }
  try {
    await link(stagePath, output.destination);
  } catch (error) {
    if ((error as { code?: unknown }).code === "EEXIST") {
      if (await verifyFile(output.destination, output.expectedHash, output.expectedByteLength)) {
        await unlink(stagePath).catch(() => undefined);
        return "existing";
      }
      await unlink(stagePath).catch(() => undefined);
      throw publicationError("EXPORT_COLLISION", "The export destination already contains different bytes.");
    }
    throw error;
  }
  await unlink(stagePath);
  if (!await verifyFile(output.destination, output.expectedHash, output.expectedByteLength)) {
    throw publicationError("EXPORT_VERIFY_FAILED", "The published export failed verification.");
  }
  return "published";
}

async function verifiedWindowsPowerShell(): Promise<{
  environment: NodeJS.ProcessEnv;
  executable: string;
}> {
  const configuredRoot = process.env.SystemRoot;
  const candidateRoot = configuredRoot !== undefined && path.isAbsolute(configuredRoot)
    ? path.resolve(configuredRoot)
    : `${path.parse(process.execPath).root}Windows`;
  const rootInfo = await lstat(candidateRoot);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
    throw publicationError("EXPORT_HELPER_UNAVAILABLE", "The Windows system root is not a real directory.");
  }
  const canonicalRoot = await realpath(candidateRoot);
  if (!samePath(canonicalRoot, candidateRoot)) {
    throw publicationError("EXPORT_HELPER_UNAVAILABLE", "The Windows system root is not canonical.");
  }
  const executable = path.join(
    canonicalRoot,
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe"
  );
  const executableInfo = await lstat(executable);
  const canonicalExecutable = await realpath(executable);
  if (
    !executableInfo.isFile() ||
    executableInfo.isSymbolicLink() ||
    !samePath(canonicalExecutable, executable)
  ) {
    throw publicationError(
      "EXPORT_HELPER_UNAVAILABLE",
      "The verified System32 Windows PowerShell executable is unavailable."
    );
  }
  const temporaryRoot = os.tmpdir();
  return {
    environment: {
      ComSpec: path.join(canonicalRoot, "System32", "cmd.exe"),
      PATHEXT: ".COM;.EXE;.BAT;.CMD",
      POWERSHELL_TELEMETRY_OPTOUT: "1",
      SystemRoot: canonicalRoot,
      TEMP: temporaryRoot,
      TMP: temporaryRoot,
      WINDIR: canonicalRoot
    },
    executable
  };
}

async function publishWindowsBundle(
  bundle: ValidatedExportBundle,
  expectedDirectories: readonly ExportDirectoryIdentity[]
): Promise<ExportPublicationStatus[]> {
  const { environment, executable } = await verifiedWindowsPowerShell();
  const request = Buffer.from(JSON.stringify({
    expectedDirectories,
    outputs: bundle.outputs.map((output) => ({
      ...output,
      mutexId: createHash("sha256")
        .update(output.destination.toLocaleLowerCase())
        .digest("hex")
    })),
    parentPid: process.pid,
    root: bundle.root
  }), "utf8").toString("base64");
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-EncodedCommand",
      WINDOWS_PUBLISHER_ENCODED
    ], {
      env: environment,
      shell: false,
      windowsHide: true
    });
    const results: ExportPublicationStatus[] = [];
    let callbackError: unknown;
    let stderr = "";
    let stdoutBuffer = "";
    let callbackChain = Promise.resolve();
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdoutBuffer += chunk;
      while (stdoutBuffer.includes("\n")) {
        const newline = stdoutBuffer.indexOf("\n");
        const line = stdoutBuffer.slice(0, newline).trim();
        stdoutBuffer = stdoutBuffer.slice(newline + 1);
        const match = /^__ETHER_OUTPUT__\|(\d+)\|(existing|published)$/u.exec(line);
        if (match === null) continue;
        const index = Number(match[1]);
        const status = match[2] as ExportPublicationStatus;
        results[index] = status;
        callbackChain = callbackChain.then(async () => {
          await bundle.onOutputPublished?.(bundle.outputs[index]!, index, status);
          child.stdin.write("continue\n");
        }).catch((error: unknown) => {
          callbackError = error;
          child.stdin.write("abort\n");
        });
      }
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.stdin.write(`${request}\n`);
    });
    child.once("close", (code) => {
      void callbackChain.finally(() => {
        if (callbackError !== undefined) return reject(callbackError);
        if (code === 0 && results.length === bundle.outputs.length) return resolve(results);
        if (code === 42 || /ETHER_EXPORT_COLLISION/u.test(stderr)) {
          return reject(publicationError(
            "EXPORT_COLLISION",
            "The export destination already contains different bytes."
          ));
        }
        const pathFailure = /ETHER_EXPORT_(?:DIRECTORY_CHANGED|REPARSE)/u.test(stderr);
        reject(publicationError(
          pathFailure ? "PATH_GRANT_CHANGED" : "EXPORT_PUBLICATION_FAILED",
          `The atomic export publisher failed${code === null ? "" : ` (${code})`}: ${stderr.trim() || "no diagnostic"}`
        ));
      });
    });
  });
}

export async function publishAtomicExportBundle(
  unvalidated: AtomicExportBundlePublication
): Promise<ExportPublicationStatus[]> {
  const bundle = validateBundle(unvalidated);
  const expectedDirectories = await captureDirectoryIdentities(bundle.root, bundle.outputs);
  await bundle.beforeAcquire?.();
  if (process.platform === "win32") {
    return publishWindowsBundle(bundle, expectedDirectories);
  }
  const results: ExportPublicationStatus[] = [];
  for (const [index, output] of bundle.outputs.entries()) {
    const status = await publishPortableOutput(output);
    results.push(status);
    await bundle.onOutputPublished?.(output, index, status);
  }
  return results;
}

/**
 * Publishes one verified, manifest-owned source through a same-parent stage.
 * Bundle callers should prefer `publishAtomicExportBundle` so one verified
 * helper holds the full directory chain for all requested sidecars.
 */
export async function publishAtomicExportFile(
  input: AtomicExportPublication
): Promise<ExportPublicationStatus> {
  const [status] = await publishAtomicExportBundle({
    ...(input.beforeAcquire === undefined ? {} : { beforeAcquire: input.beforeAcquire }),
    outputs: [input],
    root: input.root
  });
  return status!;
}

export function stableExportPublicationId(...parts: string[]): string {
  return createHash("sha256").update(parts.join("\0")).digest("hex").slice(0, 32);
}
