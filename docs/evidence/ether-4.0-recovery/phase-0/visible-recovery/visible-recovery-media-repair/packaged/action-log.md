# visible-recovery-media-repair action log

- Mode: packaged
- Outcome: passed
- Git commit: 5417ce1999f04206918ef9aaf8fae1eac2ef33c8
- Profile: fresh-isolated; APPDATA, LOCALAPPDATA, and userData isolated
- Viewport: 1280×720; scale 1
- Started: 2026-08-03T01:16:37.038Z
- Finished: 2026-08-03T01:16:44.557Z

## Build identity

- release/windows/win-unpacked/Ether.exe: 03db599dbaec1e6d564275cfb63d568dec0189217237efa3ea5e2e99b482580f
- release/windows/win-unpacked/resources/app.asar: 8cc07d197b636b5104da29ffc295313ed64f82082cf2907566f5cbfedafb0a4e

## Actions

| # | Input | Action | Expected | Actual | ms | Screenshot |
| --- | --- | --- | --- | --- | ---: | --- |
| 1 | left-click | Begin repair | The persistent Repair command opens native source and destination selection for the damaged copied document. | Left click at (1040, 34). | 27 |  |
| 2 | screenshot | Capture distinct repair loss classes | The strict preview names media/artifact losses separately from graph losses before any lossy output is created. | Captured after the documented preceding action. | 39 | screenshots/media-repair-preview.png |
| 3 | left-click | Confirm lossy repair | The user explicitly confirms the reviewable lossy repair. | Left click at (445, 577). | 118 |  |
| 4 | screenshot | Capture completed repair report | The completed path-free report confirms a new repaired document and an unchanged damaged source. | Captured after the documented preceding action. | 46 | screenshots/media-repair-completed.png |

## Captured errors

| Source | Message |
| --- | --- |
| none | No captured errors |
