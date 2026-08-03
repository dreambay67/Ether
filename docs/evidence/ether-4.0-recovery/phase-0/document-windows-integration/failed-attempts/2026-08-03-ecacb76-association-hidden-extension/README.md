# Excluded A02 association hidden-extension attempt

This directory preserves the second failed approval-gated association attempt. Its evidence identity is source HEAD `ecacb76a11868b3334fece88904d9a5e82717125` with the reviewed interim package.

The PowerShell 5.1 folder-path correction worked. Explorer opened the exact new window at the exact test folder, but UI Automation looked for the full leaf `Association 8aa11012 Žltý.ether` while this Windows profile has `HideFileExt=1` and displayed `Association 8aa11012 Žltý`. A read-only Shell.Application check on the preserved file proved that `ParseName(exact leaf).Name` was the extension-hidden display name and `.Path` remained the exact full document.

No automatic retry was made. The diagnostic paths remain preserved:

- root: `C:\Users\deny7\AppData\Local\Temp\ether-a02-windows-integration-wpSLcs`
- profile: `C:\Users\deny7\AppData\Local\Temp\ether-recovery-journey-Rw3fZz`

Read-only postflight found zero exact Fixer `Ether.exe` processes. The `.ether` registry tree returned to its original query digest `e28e10c3557e46a3cf3e8a0637b06dc3f758ee98a54edcfa604ce77e88aa01c4`. The durable sidecar proves exact-process absence, passed shell classification, no target-link deletion, and only an allowed in-place change to the pre-existing Windows-managed `590aee7bdd69b59b.customDestinations-ms`; that file was not restored, deleted, or overwritten.

| File | SHA-256 |
| --- | --- |
| `a02-windows-association/packaged/action-log.md` | `eacda5930f9e402d465ba6162221503e69b32a550ab417e6be30403fd2dc45c5` |
| `a02-windows-association/packaged/result.json` | `a649dca44b39547fdda4c0ce1cf10b53341e2306da0c980a35e1ff72169d1f01` |
| `a02-windows-association/packaged/shell-finalization.json` | `0d1ab3cc434afeee3284f80bf54dbaf792f8c2f0b8af74fd02ca697a55d19481` |

The shared Recent snapshot remained at 208 files. Its aggregate digest changed from `dc02982e4127a061f7011797e949f6bdb6fb43a82c6bfcc0057bf0f4fbc63926` to `e8c8c379ebc6fe210e40f9a710752c7564b73ca4e3034cda4116c3bea294c3cf`; the pre-existing `590aee7bdd69b59b.customDestinations-ms` SHA-256 became `d9dcff46868f4aed691fd50a5faae73e977ce70bab69849182028bbd6ffaa5a6` at `2026-08-03T02:52:27.1425071Z`.
