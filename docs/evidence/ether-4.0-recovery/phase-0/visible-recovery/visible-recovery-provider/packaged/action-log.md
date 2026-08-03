# visible-recovery-provider action log

- Mode: packaged
- Outcome: passed
- Git commit: 5417ce1999f04206918ef9aaf8fae1eac2ef33c8
- Profile: fresh-isolated; APPDATA, LOCALAPPDATA, and userData isolated
- Viewport: 1280×720; scale 1
- Started: 2026-08-03T01:16:11.251Z
- Finished: 2026-08-03T01:16:14.465Z

## Build identity

- release/windows/win-unpacked/Ether.exe: 03db599dbaec1e6d564275cfb63d568dec0189217237efa3ea5e2e99b482580f
- release/windows/win-unpacked/resources/app.asar: 8cc07d197b636b5104da29ffc295313ed64f82082cf2907566f5cbfedafb0a4e

## Actions

| # | Input | Action | Expected | Actual | ms | Screenshot |
| --- | --- | --- | --- | --- | ---: | --- |
| 1 | left-click | Inspect recovered revision | Recovery is visibly reviewable rather than silently applied. | Left click at (1079, 34). | 35 |  |
| 2 | screenshot | Capture visible provider recovery | Document History identifies the staged provider output as recovery work requiring review. | Captured after the documented preceding action. | 133 | screenshots/recovery-revision-review-required.png |

## Captured errors

| Source | Message |
| --- | --- |
| none | No captured errors |
