# a02-windows-jump-list action log

- Mode: packaged
- Outcome: failed
- Git commit: 9d14f93d973db59d6a90d116b7e849ddb084b3ae
- Profile: fresh-isolated; APPDATA, LOCALAPPDATA, and userData isolated
- Viewport: 1280×720; scale 1
- Started: 2026-08-03T04:21:22.396Z
- Finished: 2026-08-03T04:21:38.235Z

## Build identity

- release/windows/win-unpacked/Ether.exe: 03db599dbaec1e6d564275cfb63d568dec0189217237efa3ea5e2e99b482580f
- release/windows/win-unpacked/resources/app.asar: 8cc07d197b636b5104da29ffc295313ed64f82082cf2907566f5cbfedafb0a4e

## Actions

| # | Input | Action | Expected | Actual | ms | Screenshot |
| --- | --- | --- | --- | --- | ---: | --- |
| 1 | observation | Open existing S1 document in approved Recent mode | The approved Jump List session opens the ordinary-recovery document and does not invoke a native Save dialog; both real and isolated S1 Recent roots contained zero matching target links. | Opened Jump List 27464a55 Žltý.ether from the same disposable profile/token; S1 matching links=0. | 0 |  |

## Captured errors

| Source | Message |
| --- | --- |
| none | No captured errors |
