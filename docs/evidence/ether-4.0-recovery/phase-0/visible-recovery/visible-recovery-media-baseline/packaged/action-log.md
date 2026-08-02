# visible-recovery-media-baseline action log

- Mode: packaged
- Outcome: passed
- Git commit: d9fb92a62d5c6ce541025546f4fdc5c35e0999b5
- Profile: fresh-isolated; APPDATA, LOCALAPPDATA, and userData isolated
- Viewport: 1280×720; scale 1
- Started: 2026-08-02T22:45:37.073Z
- Finished: 2026-08-02T22:45:43.532Z

## Build identity

- release/windows/win-unpacked/Ether.exe: 07f6adabbb296b387899919536a0af3cd36eed84ef7bfe05973b0133259c071d
- release/windows/win-unpacked/resources/app.asar: edf009fd0d2cf03b6719c67789bf42381410d16514e5f9a306d24c69dea8b814

## Actions

| # | Input | Action | Expected | Actual | ms | Screenshot |
| --- | --- | --- | --- | --- | ---: | --- |
| 1 | left-click | Create media baseline | The media-repair fixture begins with a packaged UI-authored graph. | Left click at (91, 313). | 66 |  |
| 2 | keyboard-command | Save media baseline | The Windows Save dialog persists the visible baseline before its copied fixture is damaged. | Pressed Control+s. | 33 |  |

## Captured errors

| Source | Message |
| --- | --- |
| none | No captured errors |
