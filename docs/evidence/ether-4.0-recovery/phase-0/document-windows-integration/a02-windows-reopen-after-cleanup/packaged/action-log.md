# a02-windows-reopen-after-cleanup action log

- Mode: packaged
- Outcome: passed
- Git commit: 14dda6c0aa33398bfdb4424ad21580d67ffd44b1
- Profile: fresh-isolated; APPDATA, LOCALAPPDATA, and userData isolated
- Viewport: 1280×720; scale 1
- Started: 2026-08-03T02:44:24.480Z
- Finished: 2026-08-03T02:44:30.873Z

## Build identity

- release/windows/win-unpacked/Ether.exe: 03db599dbaec1e6d564275cfb63d568dec0189217237efa3ea5e2e99b482580f
- release/windows/win-unpacked/resources/app.asar: 8cc07d197b636b5104da29ffc295313ed64f82082cf2907566f5cbfedafb0a4e

## Actions

| # | Input | Action | Expected | Actual | ms | Screenshot |
| --- | --- | --- | --- | --- | ---: | --- |
| 1 | observation | Test-owned cache/staging/live-output deletion | Only actual named disposable roots under the isolated profile were removed; project data reopens and validates. | Created and removed test-owned cache, staging, and live-output sentinels; reopened the UI-authored .ether and validated its graph/identity. | 0 |  |
| 2 | observation | Association dry run | The exact HKCU .ether key and original ProgID state are snapshotted before any future optional mutation. | Dry-run plan uses unique Ether.Recovery.287ed1771d3c4df7bc20933371027123; this harness does not mutate the registry or invoke Explorer. | 0 |  |
| 3 | observation | Clean close through keyboard | A native Alt+F4 sent to the exact packaged Ether window closes the Saved document without an unsaved-changes prompt. | native-keyboard ownerPid=33120 shortcut=Alt+F4 | 0 |  |
| 4 | observation | Post-S1 primary shell classification | After exact process absence, only exact post-S1 target links are removed; no new files or non-opaque changes are allowed. | removed exact post-S1 target links=0; S0→final=C:\Users\deny7\AppData\Roaming:CustomDestinations/590aee7bdd69b59b.customDestinations-ms; S1→final allowed opaque=C:\Users\deny7\AppData\Roaming:CustomDestinations/590aee7bdd69b59b.customDestinations-ms | 0 |  |

## Captured errors

| Source | Message |
| --- | --- |
| none | No captured errors |
