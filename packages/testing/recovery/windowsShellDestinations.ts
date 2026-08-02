import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const RECOVERY_SHELL_TOKEN = /^[a-f0-9]{32}$/u;

/**
 * Clears only the automatic destinations owned by one disposable recovery
 * AUMID. IApplicationDestinations is deliberately used instead of Electron's
 * global Recent/Frequent clearing API, which affects every application.
 */
export async function removeRecoveryShellAutomaticDestinations(token: string): Promise<void> {
  if (!RECOVERY_SHELL_TOKEN.test(token)) {
    throw new Error("Recovery shell identity token must be 32 lowercase hexadecimal characters.");
  }
  if (process.platform !== "win32") return;

  const appUserModelId = `com.dreambay.ether.recovery.${token}`;
  const source = [
    "using System;",
    "using System.Runtime.InteropServices;",
    "namespace EtherRecoveryShell {",
    "  [ComImport, Guid(\"12337d35-94c6-48a0-bce7-6a9c69d4d600\"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]",
    "  public interface IApplicationDestinations {",
    "    [PreserveSig] int SetAppID([MarshalAs(UnmanagedType.LPWStr)] string appId);",
    "    [PreserveSig] int RemoveDestination([MarshalAs(UnmanagedType.IUnknown)] object destination);",
    "    [PreserveSig] int RemoveAllDestinations();",
    "  }",
    "}"
  ].join(" ");
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `Add-Type -TypeDefinition '${escapePowerShellLiteral(source)}' -ErrorAction Stop`,
    `$appId = '${escapePowerShellLiteral(appUserModelId)}'`,
    "$classId = [Guid]'86c14003-4d6b-4ef3-a7b4-0506663b2e68'",
    "$comObject = [Activator]::CreateInstance([Type]::GetTypeFromCLSID($classId, $true))",
    "$destinations = [EtherRecoveryShell.IApplicationDestinations]$comObject",
    "try { $hr = $destinations.SetAppID($appId); [Runtime.InteropServices.Marshal]::ThrowExceptionForHR($hr); $hr = $destinations.RemoveAllDestinations(); [Runtime.InteropServices.Marshal]::ThrowExceptionForHR($hr) } finally { if ($null -ne $comObject) { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($comObject) } }"
  ].join("; ");
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Sta", "-EncodedCommand", encoded], {
    timeout: 30_000,
    windowsHide: true
  });
}

function escapePowerShellLiteral(value: string): string {
  return value.replaceAll("'", "''");
}
