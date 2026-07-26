param(
  [Parameter(Mandatory = $true)]
  [ValidateNotNullOrEmpty()]
  [string]$ProcessIds,

  [Parameter(Mandatory = $true)]
  [ValidateNotNullOrEmpty()]
  [string]$ExecutablePath,

  [Parameter(Mandatory = $true)]
  [string]$MainWindowTitle,

  [Parameter(Mandatory = $true)]
  [string]$DialogTitle,

  [Parameter(Mandatory = $true)]
  [string]$OutputPath,

  [Parameter(Mandatory = $true)]
  [string]$AcceptButton,

  [Parameter(Mandatory = $true)]
  [string]$CompletionTitle
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class EtherCaptureNative {
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential)]
    public struct Rect {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct MouseInput {
        public int X;
        public int Y;
        public uint MouseData;
        public uint Flags;
        public uint Time;
        public IntPtr ExtraInfo;
    }

    [StructLayout(LayoutKind.Explicit)]
    public struct InputUnion {
        [FieldOffset(0)]
        public MouseInput Mouse;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct Input {
        public uint Type;
        public InputUnion Data;
    }

    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool AttachThreadInput(uint sourceThreadId, uint targetThreadId, bool attach);

    [DllImport("user32.dll")]
    public static extern bool BringWindowToTop(IntPtr hWnd);

    [DllImport("kernel32.dll")]
    public static extern uint GetCurrentThreadId();

    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out Rect rect);

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool SetCursorPos(int x, int y);

    [DllImport("user32.dll")]
    public static extern IntPtr SetActiveWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern IntPtr SetFocus(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int command);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern uint SendInput(uint count, Input[] inputs, int size);

    public static bool ForceForeground(IntPtr hWnd) {
        IntPtr previousForeground = GetForegroundWindow();
        uint ignoredProcessId;
        uint currentThreadId = GetCurrentThreadId();
        uint foregroundThreadId = previousForeground == IntPtr.Zero
            ? 0
            : GetWindowThreadProcessId(previousForeground, out ignoredProcessId);
        uint targetThreadId = GetWindowThreadProcessId(hWnd, out ignoredProcessId);
        bool foregroundAttached = false;
        bool targetAttached = false;
        try {
            if (foregroundThreadId != 0 && foregroundThreadId != currentThreadId) {
                foregroundAttached = AttachThreadInput(currentThreadId, foregroundThreadId, true);
            }
            if (
                targetThreadId != 0 &&
                targetThreadId != currentThreadId &&
                targetThreadId != foregroundThreadId
            ) {
                targetAttached = AttachThreadInput(currentThreadId, targetThreadId, true);
            }
            ShowWindow(hWnd, 5);
            BringWindowToTop(hWnd);
            SetActiveWindow(hWnd);
            SetForegroundWindow(hWnd);
            SetFocus(hWnd);
        }
        finally {
            if (targetAttached) {
                AttachThreadInput(currentThreadId, targetThreadId, false);
            }
            if (foregroundAttached) {
                AttachThreadInput(currentThreadId, foregroundThreadId, false);
            }
        }
        return GetForegroundWindow() == hWnd;
    }

    public static void SendSingleLeftClick(int x, int y) {
        if (!SetCursorPos(x, y)) {
            throw new InvalidOperationException("Could not position the capture pointer.");
        }
        Input[] inputs = new Input[2];
        inputs[0].Type = 0;
        inputs[0].Data.Mouse.Flags = 0x0002;
        inputs[1].Type = 0;
        inputs[1].Data.Mouse.Flags = 0x0004;
        uint sent = SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(Input)));
        if (sent != (uint)inputs.Length) {
            throw new InvalidOperationException("Could not send the capture click.");
        }
    }
}
"@

$ownerProcessIds = @(
  $ProcessIds.Split(",") |
    ForEach-Object {
      $candidate = 0
      if (-not [int]::TryParse($_, [ref]$candidate) -or $candidate -le 0) {
        throw "Every supplied Ether process ID must be a positive integer."
      }
      $candidate
    } |
    Sort-Object -Unique
)
if ($ownerProcessIds.Count -eq 0) {
  throw "At least one exact installed Ether process ID is required."
}
$resolvedExecutablePath = [IO.Path]::GetFullPath($ExecutablePath)
foreach ($ownerProcessId in $ownerProcessIds) {
  $process = Get-CimInstance Win32_Process -Filter "ProcessId = $ownerProcessId"
  if (
    $null -eq $process -or
    -not [string]::Equals(
      [string]$process.ExecutablePath,
      $resolvedExecutablePath,
      [StringComparison]::OrdinalIgnoreCase
    )
  ) {
    throw "Process $ownerProcessId is not the live scoped installed Ether.exe."
  }
}

function Find-EtherWindow {
  param(
    [int[]]$OwnerProcessIds,
    [string]$Title
  )

  $script:foundWindow = [IntPtr]::Zero
  [EtherCaptureNative]::EnumWindows({
    param([IntPtr]$handle, [IntPtr]$state)
    if (-not [EtherCaptureNative]::IsWindowVisible($handle)) { return $true }
    [uint32]$candidateProcessId = 0
    [EtherCaptureNative]::GetWindowThreadProcessId($handle, [ref]$candidateProcessId) | Out-Null
    if ($OwnerProcessIds -notcontains [int]$candidateProcessId) { return $true }
    $text = [Text.StringBuilder]::new(512)
    [EtherCaptureNative]::GetWindowText($handle, $text, $text.Capacity) | Out-Null
    $windowTitle = $text.ToString()
    if (
      -not [string]::IsNullOrWhiteSpace($windowTitle) -and
      $windowTitle.IndexOf($Title, [StringComparison]::OrdinalIgnoreCase) -ge 0
    ) {
      $script:foundWindow = $handle
      return $false
    }
    return $true
  }, [IntPtr]::Zero) | Out-Null
  return $script:foundWindow
}

function Wait-EtherWindow {
  param(
    [int[]]$OwnerProcessIds,
    [string]$Title,
    [int]$TimeoutMilliseconds = 10000
  )

  $deadline = [DateTime]::UtcNow.AddMilliseconds($TimeoutMilliseconds)
  while ([DateTime]::UtcNow -lt $deadline) {
    $handle = Find-EtherWindow -OwnerProcessIds $OwnerProcessIds -Title $Title
    if ($handle -ne [IntPtr]::Zero) { return $handle }
    Start-Sleep -Milliseconds 100
  }
  $visibleOwnedWindows = Get-OwnedVisibleWindowInventory -OwnerProcessIds $OwnerProcessIds
  throw "Timed out waiting for native Ether dialog '$Title'. Visible owned windows: $visibleOwnedWindows"
}

function Get-OwnedVisibleWindowInventory {
  param([int[]]$OwnerProcessIds)

  $script:ownedWindowInventory = [Collections.Generic.List[string]]::new()
  [EtherCaptureNative]::EnumWindows({
    param([IntPtr]$handle, [IntPtr]$state)
    if (-not [EtherCaptureNative]::IsWindowVisible($handle)) { return $true }
    [uint32]$candidateProcessId = 0
    [EtherCaptureNative]::GetWindowThreadProcessId($handle, [ref]$candidateProcessId) | Out-Null
    if ($OwnerProcessIds -notcontains [int]$candidateProcessId) { return $true }
    $text = [Text.StringBuilder]::new(512)
    [EtherCaptureNative]::GetWindowText($handle, $text, $text.Capacity) | Out-Null
    $windowTitle = $text.ToString()
    $titleValue = if ([string]::IsNullOrWhiteSpace($windowTitle)) { "<empty>" } else { $windowTitle }
    $script:ownedWindowInventory.Add("$candidateProcessId`:$titleValue")
    return $true
  }, [IntPtr]::Zero) | Out-Null
  if ($script:ownedWindowInventory.Count -eq 0) { return "<none>" }
  return $script:ownedWindowInventory -join " | "
}

function Assert-OwnedVisibleWindow {
  param(
    [IntPtr]$Handle,
    [int[]]$OwnerProcessIds,
    [string]$TitleToken
  )

  if ($Handle -eq [IntPtr]::Zero -or -not [EtherCaptureNative]::IsWindowVisible($Handle)) {
    throw "Resolved Ether main window is missing or not visible."
  }
  [uint32]$resolvedProcessId = 0
  [EtherCaptureNative]::GetWindowThreadProcessId($Handle, [ref]$resolvedProcessId) | Out-Null
  if ($OwnerProcessIds -notcontains [int]$resolvedProcessId) {
    throw "Resolved Ether window is not owned by the supplied installed process set."
  }
  $text = [Text.StringBuilder]::new(512)
  [EtherCaptureNative]::GetWindowText($Handle, $text, $text.Capacity) | Out-Null
  $windowTitle = $text.ToString()
  if (
    [string]::IsNullOrWhiteSpace($windowTitle) -or
    $windowTitle.IndexOf($TitleToken, [StringComparison]::OrdinalIgnoreCase) -lt 0
  ) {
    throw "Resolved Ether main window title does not contain '$TitleToken'."
  }
}

function Invoke-NativeButton {
  param(
    [IntPtr]$DialogHandle,
    [string]$Name
  )

  $dialog = [Windows.Automation.AutomationElement]::FromHandle($DialogHandle)
  $condition = [Windows.Automation.PropertyCondition]::new(
    [Windows.Automation.AutomationElement]::NameProperty,
    $Name
  )
  $matchingElements = $dialog.FindAll([Windows.Automation.TreeScope]::Descendants, $condition)
  $visibleEnabledElements = [Collections.Generic.List[object]]::new()
  $candidateInventory = [Collections.Generic.List[string]]::new()
  foreach ($candidate in $matchingElements) {
    $supportedPatterns = @(
      $candidate.GetSupportedPatterns() |
        ForEach-Object { $_.ProgrammaticName } |
        Sort-Object -Unique
    )
    $supportedPatternInventory = if ($supportedPatterns.Count -eq 0) {
      "<none>"
    } else {
      $supportedPatterns -join ","
    }
    $candidateInventory.Add(
      "$($candidate.Current.ControlType.ProgrammaticName);" +
      "enabled=$($candidate.Current.IsEnabled);" +
      "offscreen=$($candidate.Current.IsOffscreen);" +
      "patterns=$supportedPatternInventory"
    )
    if (-not $candidate.Current.IsEnabled -or $candidate.Current.IsOffscreen) { continue }
    $visibleEnabledElements.Add($candidate)
  }

  if ($visibleEnabledElements.Count -ne 1) {
    $inventory = if ($candidateInventory.Count -eq 0) {
      "<none>"
    } else {
      $candidateInventory -join " | "
    }
    throw (
      "Expected exactly one visible enabled UI Automation element named '$Name'; " +
      "found $($visibleEnabledElements.Count). Candidates: $inventory"
    )
  }
  $target = $visibleEnabledElements[0]
  $pattern = $null
  if ($target.TryGetCurrentPattern([Windows.Automation.InvokePattern]::Pattern, [ref]$pattern)) {
    ([Windows.Automation.InvokePattern]$pattern).Invoke()
    return
  }

  $targetRect = $target.Current.BoundingRectangle
  $dialogRect = [EtherCaptureNative+Rect]::new()
  if (
    $targetRect.IsEmpty -or
    [double]::IsNaN($targetRect.Left) -or
    [double]::IsNaN($targetRect.Top) -or
    [double]::IsNaN($targetRect.Width) -or
    [double]::IsNaN($targetRect.Height) -or
    [double]::IsInfinity($targetRect.Left) -or
    [double]::IsInfinity($targetRect.Top) -or
    [double]::IsInfinity($targetRect.Width) -or
    [double]::IsInfinity($targetRect.Height) -or
    $targetRect.Width -le 0 -or
    $targetRect.Height -le 0 -or
    -not [EtherCaptureNative]::GetWindowRect($DialogHandle, [ref]$dialogRect) -or
    $targetRect.Left -lt $dialogRect.Left -or
    $targetRect.Top -lt $dialogRect.Top -or
    $targetRect.Right -gt $dialogRect.Right -or
    $targetRect.Bottom -gt $dialogRect.Bottom
  ) {
    throw "Exact UI Automation target '$Name' does not have safe bounds inside its owned dialog."
  }
  [EtherCaptureNative]::ForceForeground($DialogHandle) | Out-Null
  Start-Sleep -Milliseconds 100
  if ([EtherCaptureNative]::GetForegroundWindow() -ne $DialogHandle) {
    throw "Exact owned native Ether dialog did not remain foreground for '$Name'."
  }
  $centerX = [Convert]::ToInt32([Math]::Round($targetRect.Left + ($targetRect.Width / 2)))
  $centerY = [Convert]::ToInt32([Math]::Round($targetRect.Top + ($targetRect.Height / 2)))
  [EtherCaptureNative]::SendSingleLeftClick($centerX, $centerY)
}

$mainHandle = Wait-EtherWindow -OwnerProcessIds $ownerProcessIds -Title $MainWindowTitle
Assert-OwnedVisibleWindow -Handle $mainHandle -OwnerProcessIds $ownerProcessIds -TitleToken $MainWindowTitle

$dialogHandle = Wait-EtherWindow -OwnerProcessIds $ownerProcessIds -Title $DialogTitle
Assert-OwnedVisibleWindow -Handle $dialogHandle -OwnerProcessIds $ownerProcessIds -TitleToken $DialogTitle
[EtherCaptureNative]::SetForegroundWindow($dialogHandle) | Out-Null
Start-Sleep -Milliseconds 150

$rect = [EtherCaptureNative+Rect]::new()
if (-not [EtherCaptureNative]::GetWindowRect($dialogHandle, [ref]$rect)) {
  throw "Could not read native dialog bounds for '$DialogTitle'."
}
$width = $rect.Right - $rect.Left
$height = $rect.Bottom - $rect.Top
if ($width -lt 200 -or $height -lt 100) {
  throw "Native dialog '$DialogTitle' had implausible bounds ${width}x${height}."
}

$outputDirectory = [IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($OutputPath))
[IO.Directory]::CreateDirectory($outputDirectory) | Out-Null
$bitmap = [Drawing.Bitmap]::new($width, $height)
$graphics = [Drawing.Graphics]::FromImage($bitmap)
try {
  $graphics.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $bitmap.Size)
  $bitmap.Save([IO.Path]::GetFullPath($OutputPath), [Drawing.Imaging.ImageFormat]::Png)
}
finally {
  $graphics.Dispose()
  $bitmap.Dispose()
}

Invoke-NativeButton -DialogHandle $dialogHandle -Name $AcceptButton
$completionHandle = Wait-EtherWindow -OwnerProcessIds $ownerProcessIds -Title $CompletionTitle
Assert-OwnedVisibleWindow -Handle $completionHandle -OwnerProcessIds $ownerProcessIds -TitleToken $CompletionTitle
[EtherCaptureNative]::SetForegroundWindow($completionHandle) | Out-Null
Invoke-NativeButton -DialogHandle $completionHandle -Name "OK"

Write-Output "$DialogTitle captured and $AcceptButton invoked."
