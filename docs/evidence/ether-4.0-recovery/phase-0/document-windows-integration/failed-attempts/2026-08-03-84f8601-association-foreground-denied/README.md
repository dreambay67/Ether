# Excluded A02 association foreground-denied attempt

This directory preserves the fourth failed approval-gated association attempt. Its evidence identity is source HEAD `84f86011c4657e4a24a0e1aa0608d56cbf840b58` with the reviewed interim package.

The exact document path, Shell-derived display name, one selected COM item, Explorer HWND/PID, minimized Ether HWND/PID, and action-boundary ordering all passed. Before UIA Invoke, Windows denied `SetForegroundWindow` for the exact Explorer HWND because the PowerShell automation process was not foreground-eligible. The document was not invoked. This is an excluded harness-environment result, not association acceptance.

No automatic retry was made. The diagnostic paths remain preserved:

- root: `C:\Users\deny7\AppData\Local\Temp\ether-a02-windows-integration-8OFQY7`
- profile: `C:\Users\deny7\AppData\Local\Temp\ether-recovery-journey-4EYyFc`

Read-only postflight found zero exact Fixer `Ether.exe` processes. The `.ether` registry tree returned to its original query digest `e28e10c3557e46a3cf3e8a0637b06dc3f758ee98a54edcfa604ce77e88aa01c4`. The durable sidecar proves exact-process absence, passed shell classification, no target-link deletion, and only an allowed in-place change to the pre-existing Windows-managed `590aee7bdd69b59b.customDestinations-ms`; that file was not restored, deleted, or overwritten.

| File | SHA-256 |
| --- | --- |
| `a02-windows-association/packaged/action-log.md` | `d5f414cddea532a65a4f255606664404061f5221e755619be1ecbcc9a3064e87` |
| `a02-windows-association/packaged/result.json` | `3ca22bafab5ec5a80d7014440b32d50c827f9c4d0e4e32fbcc528ef6b80bc354` |
| `a02-windows-association/packaged/shell-finalization.json` | `b3fe5ca1e3d6fc0b9dff42f5726a5e74e37c71accf9febd2ff08260b39a672c0` |

The shared Recent snapshot remained at 208 files. Its aggregate digest changed from `37622aacc40bf0ed16ffec8d4894b9fd46efbd3de7031f6b3b759c5a70892bc8` to `c8634f719323539164a15b409d90c33d25fbd5a2aaa185d259c7ad15e39beff7`; the pre-existing `590aee7bdd69b59b.customDestinations-ms` SHA-256 became `925466e643c27b7b451bc09a945e6884f3e2ad292192f67288e9b6bcd825edbe` at `2026-08-03T03:36:32.1104866Z`.
