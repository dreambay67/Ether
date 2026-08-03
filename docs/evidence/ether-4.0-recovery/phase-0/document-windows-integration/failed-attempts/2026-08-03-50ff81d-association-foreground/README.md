# Excluded A02 association foreground attempt

This directory preserves the third failed approval-gated association attempt. Its evidence identity is source HEAD `50ff81d97599dc65b796fc6d67b4720ffa78dbae` with the reviewed interim package.

The run passed the PowerShell 5.1 path correction and the hidden-extension correction: Explorer exposed one exact Shell-derived display item, its one selected COM item resolved to the exact full `.ether` path, and UIA invoked it. The requested document then appeared in the existing Ether window and the renderer reported focus. A later, separate Win32 foreground snapshot failed because the foreground HWND belonged to PID `17048`, identified read-only after the run as the installed `ChatGPT.exe`, rather than the exact Ether PID `42512`. This evidence therefore does not prove foreground activation and is excluded.

No automatic retry was made. The diagnostic paths remain preserved:

- root: `C:\Users\deny7\AppData\Local\Temp\ether-a02-windows-integration-8CrXoA`
- profile: `C:\Users\deny7\AppData\Local\Temp\ether-recovery-journey-3Q76ZJ`

Read-only postflight found zero exact Fixer `Ether.exe` processes. The `.ether` registry tree returned to its original query digest `e28e10c3557e46a3cf3e8a0637b06dc3f758ee98a54edcfa604ce77e88aa01c4`. The durable sidecar proves exact-process absence, passed shell classification, no target-link deletion, and only an allowed in-place change to the pre-existing Windows-managed `590aee7bdd69b59b.customDestinations-ms`; that file was not restored, deleted, or overwritten.

| File | SHA-256 |
| --- | --- |
| `a02-windows-association/packaged/action-log.md` | `1cac5d51449fdc3279b9b7624a8a3c8c7be1be62e9423b63bcca16f1304b30a0` |
| `a02-windows-association/packaged/result.json` | `6c8e619d44d70614be078da8852cd531e461e817d43c58b42d20e7ef0ef1c45d` |
| `a02-windows-association/packaged/shell-finalization.json` | `022c05115f44b83118c2df63167460f7371ed2adb04c0343eed8dc0cb0458b09` |

The shared Recent snapshot remained at 208 files. Its aggregate digest changed from `e8c8c379ebc6fe210e40f9a710752c7564b73ca4e3034cda4116c3bea294c3cf` to `37622aacc40bf0ed16ffec8d4894b9fd46efbd3de7031f6b3b759c5a70892bc8`; the pre-existing `590aee7bdd69b59b.customDestinations-ms` SHA-256 became `fe79b469a978af796b24763546b3d007fabccf084f22df1a4f163f6e882fb6fb` at `2026-08-03T03:05:15.5187971Z`.
