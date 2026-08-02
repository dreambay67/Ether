# visible-recovery-media-repair action log

- Mode: packaged
- Outcome: passed
- Git commit: d9fb92a62d5c6ce541025546f4fdc5c35e0999b5
- Profile: fresh-isolated; APPDATA, LOCALAPPDATA, and userData isolated
- Viewport: 1280×720; scale 1
- Started: 2026-08-02T22:45:47.676Z
- Finished: 2026-08-02T22:45:54.793Z

## Build identity

- release/windows/win-unpacked/Ether.exe: 07f6adabbb296b387899919536a0af3cd36eed84ef7bfe05973b0133259c071d
- release/windows/win-unpacked/resources/app.asar: edf009fd0d2cf03b6719c67789bf42381410d16514e5f9a306d24c69dea8b814

## Actions

| # | Input | Action | Expected | Actual | ms | Screenshot |
| --- | --- | --- | --- | --- | ---: | --- |
| 1 | left-click | Begin repair | The persistent Repair command opens native source and destination selection for the damaged copied document. | Left click at (1040, 34). | 29 |  |
| 2 | screenshot | Capture distinct repair loss classes | The strict preview names media/artifact losses separately from graph losses before any lossy output is created. | Captured after the documented preceding action. | 58 | screenshots/media-repair-preview.png |
| 3 | left-click | Confirm lossy repair | The user explicitly confirms the reviewable lossy repair. | Left click at (445, 577). | 117 |  |
| 4 | screenshot | Capture completed repair report | The completed path-free report confirms a new repaired document and an unchanged damaged source. | Captured after the documented preceding action. | 52 | screenshots/media-repair-completed.png |

## Captured errors

| Source | Message |
| --- | --- |
| none | No captured errors |
