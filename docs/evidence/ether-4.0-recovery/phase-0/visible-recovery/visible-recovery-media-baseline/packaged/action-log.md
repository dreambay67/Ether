# visible-recovery-media-baseline action log

- Mode: packaged
- Outcome: passed
- Git commit: 5417ce1999f04206918ef9aaf8fae1eac2ef33c8
- Profile: fresh-isolated; APPDATA, LOCALAPPDATA, and userData isolated
- Viewport: 1280×720; scale 1
- Started: 2026-08-03T01:16:26.446Z
- Finished: 2026-08-03T01:16:32.846Z

## Build identity

- release/windows/win-unpacked/Ether.exe: 03db599dbaec1e6d564275cfb63d568dec0189217237efa3ea5e2e99b482580f
- release/windows/win-unpacked/resources/app.asar: 8cc07d197b636b5104da29ffc295313ed64f82082cf2907566f5cbfedafb0a4e

## Actions

| # | Input | Action | Expected | Actual | ms | Screenshot |
| --- | --- | --- | --- | --- | ---: | --- |
| 1 | left-click | Create media baseline | The media-repair fixture begins with a packaged UI-authored graph. | Left click at (91, 313). | 54 |  |
| 2 | keyboard-command | Save media baseline | The Windows Save dialog persists the visible baseline before its copied fixture is damaged. | Pressed Control+s. | 26 |  |

## Captured errors

| Source | Message |
| --- | --- |
| none | No captured errors |
