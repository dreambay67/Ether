# a02-windows-reopen-after-cleanup action log

- Mode: packaged
- Outcome: failed
- Git commit: 391dc2739886b0df941573511fff408f94ddd5f6
- Profile: fresh-isolated; APPDATA, LOCALAPPDATA, and userData isolated
- Viewport: 1280×720; scale 1
- Started: 2026-08-03T02:29:31.165Z
- Finished: 2026-08-03T02:29:37.726Z

## Build identity

- release/windows/win-unpacked/Ether.exe: 03db599dbaec1e6d564275cfb63d568dec0189217237efa3ea5e2e99b482580f
- release/windows/win-unpacked/resources/app.asar: 8cc07d197b636b5104da29ffc295313ed64f82082cf2907566f5cbfedafb0a4e

## Actions

| # | Input | Action | Expected | Actual | ms | Screenshot |
| --- | --- | --- | --- | --- | ---: | --- |
| 1 | observation | Test-owned cache/staging/live-output deletion | Only actual named disposable roots under the isolated profile were removed; project data reopens and validates. | Created and removed test-owned cache, staging, and live-output sentinels; reopened the UI-authored .ether and validated its graph/identity. | 0 |  |
| 2 | observation | Association dry run | The exact HKCU .ether key and original ProgID state are snapshotted before any future optional mutation. | Dry-run plan uses unique Ether.Recovery.c1e75bbfb27c404bbc1bcf8ab5e5b207; this harness does not mutate the registry or invoke Explorer. | 0 |  |
| 3 | observation | Clean close through keyboard | A native Alt+F4 sent to the exact packaged Ether window closes the Saved document without an unsaved-changes prompt. | native-keyboard ownerPid=38248 shortcut=Alt+F4 | 0 |  |

## Captured errors

| Source | Message |
| --- | --- |
| none | No captured errors |
