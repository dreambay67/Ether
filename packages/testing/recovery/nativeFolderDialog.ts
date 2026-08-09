import { execFile } from "node:child_process";
import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const DIALOG_TIMEOUT_MS = 15_000;

/**
 * Chooses one existing directory through the visible Windows folder picker owned
 * by the exact packaged Ether process. This deliberately never searches for or
 * activates an arbitrary desktop dialog.
 */
export async function completeNativeFolderDialogWithUia(ownerPid: number, directoryPath: string): Promise<string> {
  if (process.platform !== "win32") throw new Error("Native folder dialog automation is available on Windows only.");
  if (!Number.isSafeInteger(ownerPid) || ownerPid <= 0) throw new Error("Native folder dialog automation requires a positive owner PID.");
  if (!path.win32.isAbsolute(directoryPath)) throw new Error("Native folder dialog automation requires an absolute directory path.");

  const resolvedDirectory = await realpath(directoryPath);
  const directoryStats = await stat(resolvedDirectory);
  if (!directoryStats.isDirectory()) throw new Error(`Native folder dialog target is not a directory: ${resolvedDirectory}`);

  return runPowerShell(buildNativeFolderDialogScript(ownerPid, resolvedDirectory));
}

function buildNativeFolderDialogScript(ownerPid: number, directoryPath: string): string {
  return [
    "$ErrorActionPreference = 'Stop'",
    "Add-Type -AssemblyName UIAutomationClient",
    "Add-Type -TypeDefinition 'using System; using System.Collections.Generic; using System.Runtime.InteropServices; using System.Threading; public static class EtherT20FolderDialog { public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam); [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public UIntPtr dwExtraInfo; } [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public UIntPtr dwExtraInfo; } [StructLayout(LayoutKind.Explicit)] public struct INPUTUNION { [FieldOffset(0)] public KEYBDINPUT ki; [FieldOffset(0)] public MOUSEINPUT mi; } [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public INPUTUNION U; } [DllImport(\"user32.dll\")] public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam); [DllImport(\"user32.dll\")] public static extern IntPtr GetWindow(IntPtr hWnd, uint command); [DllImport(\"user32.dll\")] public static extern bool IsWindow(IntPtr hWnd); [DllImport(\"user32.dll\")] public static extern bool IsWindowEnabled(IntPtr hWnd); [DllImport(\"user32.dll\")] public static extern bool SetForegroundWindow(IntPtr hWnd); [DllImport(\"user32.dll\")] public static extern IntPtr GetForegroundWindow(); [DllImport(\"user32.dll\", SetLastError = true)] public static extern uint SendInput(uint count, INPUT[] inputs, int inputSize); public static IntPtr[] OwnedWindows(IntPtr owner) { var windows = new List<IntPtr>(); EnumWindows((hWnd, lParam) => { if (hWnd != owner && GetWindow(hWnd, 4) == owner) windows.Add(hWnd); return true; }, IntPtr.Zero); return windows.ToArray(); } private static INPUT Key(ushort virtualKey, uint flags) { return new INPUT { type = 1, U = new INPUTUNION { ki = new KEYBDINPUT { wVk = virtualKey, dwFlags = flags } } }; } private static INPUT Unicode(char character, uint flags) { return new INPUT { type = 1, U = new INPUTUNION { ki = new KEYBDINPUT { wScan = character, dwFlags = 0x0004 | flags } } }; } private static void Send(INPUT input) { if (SendInput(1, new[] { input }, Marshal.SizeOf(typeof(INPUT))) != 1) throw new InvalidOperationException(\"Could not send exact folder-dialog keyboard input.\"); } private static void Press(ushort virtualKey) { Send(Key(virtualKey, 0)); Send(Key(virtualKey, 0x0002)); } public static void NavigateTo(IntPtr dialog, string directory) { if (!SetForegroundWindow(dialog) || GetForegroundWindow() != dialog) throw new InvalidOperationException(\"Exact Ether-owned folder dialog could not receive foreground input.\"); Send(Key(0x11, 0)); Press(0x4C); Send(Key(0x11, 0x0002)); Thread.Sleep(150); foreach (var character in directory) { Send(Unicode(character, 0)); Send(Unicode(character, 0x0002)); } Press(0x0D); } }' -ErrorAction SilentlyContinue",
    `$ownerPid = ${ownerPid}`,
    `$directoryPath = '${ps(directoryPath)}'`,
    "$byPid = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $ownerPid)",
    "$ownerWindows = @([System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, $byPid) | Where-Object { $_.Current.ClassName -ne '#32770' -and $_.Current.NativeWindowHandle -ne 0 })",
    "if ($ownerWindows.Count -ne 1) { throw ('Expected one exact Ether owner window; found ' + $ownerWindows.Count) }",
    "$ownerHwnd = [intptr]$ownerWindows[0].Current.NativeWindowHandle",
    "$deadline = [DateTime]::UtcNow.AddMilliseconds(" + DIALOG_TIMEOUT_MS + ")",
    "$dialog = $null",
    "while ([DateTime]::UtcNow -lt $deadline -and $null -eq $dialog) {",
    "  $matches = @([EtherT20FolderDialog]::OwnedWindows($ownerHwnd) | ForEach-Object { [System.Windows.Automation.AutomationElement]::FromHandle([intptr]$_) } | Where-Object { $descendants = $_.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition); @($descendants | Where-Object { $_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button -and $_.Current.Name -in @('Select Folder', 'Open') -and -not $_.Current.IsOffscreen -and $_.Current.IsEnabled }).Count -eq 1 })",
    "  if ($matches.Count -gt 1) { throw ('Expected at most one exact Ether-owned folder dialog; found ' + $matches.Count) }",
    "  if ($matches.Count -eq 1) { $dialog = $matches[0] } else { Start-Sleep -Milliseconds 150 }",
    "}",
    "if ($null -eq $dialog) { throw 'Exact Ether-owned native folder dialog with a visible Select Folder/Open control did not appear within 15 seconds.' }",
    "$dialogHwnd = [intptr]$dialog.Current.NativeWindowHandle",
    "if ($dialogHwnd -eq [intptr]::Zero) { throw 'Exact Ether-owned folder dialog has no HWND' }",
    "try { $dialog.SetFocus() } catch {}",
    "[EtherT20FolderDialog]::NavigateTo($dialogHwnd, $directoryPath)",
    "Start-Sleep -Milliseconds 300",
    "$descendants = $dialog.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)",
    "$confirm = @($descendants | Where-Object { $_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button -and $_.Current.Name -in @('Select Folder', 'Open') -and -not $_.Current.IsOffscreen -and $_.Current.IsEnabled })",
    "if ($confirm.Count -ne 1) { throw ('Exact Ether-owned folder dialog exposed ' + $confirm.Count + ' visible Select Folder/Open controls after navigation') }",
    "$invoke = $null",
    "try { $invoke = $confirm[0].GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern) } catch { $invoke = $null }",
    "if ($null -eq $invoke) { throw 'Visible exact folder-dialog confirmation control has no InvokePattern' }",
    "([System.Windows.Automation.InvokePattern]$invoke).Invoke()",
    "$closeDeadline = [DateTime]::UtcNow.AddMilliseconds(" + DIALOG_TIMEOUT_MS + ")",
    "while ([DateTime]::UtcNow -lt $closeDeadline -and ([EtherT20FolderDialog]::IsWindow($dialogHwnd) -or -not [EtherT20FolderDialog]::IsWindowEnabled($ownerHwnd))) { Start-Sleep -Milliseconds 100 }",
    "if ([EtherT20FolderDialog]::IsWindow($dialogHwnd) -or -not [EtherT20FolderDialog]::IsWindowEnabled($ownerHwnd)) { throw 'Exact Ether-owned folder dialog did not close and re-enable its owner within 15 seconds' }",
    "Write-Output ('uia-folder-dialog ownerPid=' + $ownerPid + ' directory=' + $directoryPath)"
  ].join("; ");
}

async function runPowerShell(script: string): Promise<string> {
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Sta", "-EncodedCommand", encoded], {
    timeout: DIALOG_TIMEOUT_MS * 2,
    windowsHide: true
  });
  return stdout.trim();
}

function ps(value: string): string {
  return value.replaceAll("'", "''");
}
