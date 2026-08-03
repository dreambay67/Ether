# visible-recovery-artifact-baseline action log

- Mode: packaged
- Outcome: passed
- Git commit: 5417ce1999f04206918ef9aaf8fae1eac2ef33c8
- Profile: fresh-isolated; APPDATA, LOCALAPPDATA, and userData isolated
- Viewport: 1280×720; scale 1
- Started: 2026-08-03T01:16:33.345Z
- Finished: 2026-08-03T01:16:36.763Z

## Build identity

- release/windows/win-unpacked/Ether.exe: 03db599dbaec1e6d564275cfb63d568dec0189217237efa3ea5e2e99b482580f
- release/windows/win-unpacked/resources/app.asar: 8cc07d197b636b5104da29ffc295313ed64f82082cf2907566f5cbfedafb0a4e

## Actions

| # | Input | Action | Expected | Actual | ms | Screenshot |
| --- | --- | --- | --- | --- | ---: | --- |
| 1 | left-click | Open visible artifact baseline | The packaged UI visibly opens the artifact-bearing baseline before a copied fixture is corrupted. | Left click at (1144, 34). | 29 |  |
| 2 | left-click | Open artifact review | The visible Review workspace exposes the embedded fake-provider artifact. | Left click at (228, 89). | 22 |  |
| 3 | screenshot | Capture artifact-bearing baseline | A fake-provider artifact is visibly present in the valid packaged baseline. | Captured after the documented preceding action. | 71 | screenshots/artifact-bearing-baseline.png |

## Captured errors

| Source | Message |
| --- | --- |
| none | No captured errors |
