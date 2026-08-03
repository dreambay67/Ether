# module-authoring-recovery action log

- Mode: packaged
- Outcome: failed
- Git commit: 065a5822e9cecfce00afc851b42b50f9aba22228
- Profile: fresh-isolated; APPDATA, LOCALAPPDATA, and userData isolated
- Viewport: 1600×1000; scale 1
- Started: 2026-08-03T16:53:29.615Z
- Finished: 2026-08-03T16:53:42.671Z

## Build identity

- release/windows/win-unpacked/Ether.exe: 45ede4a6b1968728a5fd7e941e9ab9a85696f58130ca946f128f2f57cd94abab
- release/windows/win-unpacked/resources/app.asar: cecb3704cdb51b2569ad20b8d91bc699d24e25a3ecf327e9bb03870dc22b49ae

## Actions

| # | Input | Action | Expected | Actual | ms | Screenshot |
| --- | --- | --- | --- | --- | ---: | --- |
| 1 | left-click | Add prompt.text from Node Library | The blank document creates prompt.text through the registry-backed factory. | Left click at (108, 498). | 147 |  |
| 2 | left-click | Add prompt.worker from Node Library | The blank document creates prompt.worker through the registry-backed factory. | Left click at (108, 633). | 134 |  |
| 3 | keyboard-command | Select the workflow for a Module | The canvas-owned select-all command selects both blank-authored nodes before organization. | Pressed Control+A. | 184 |  |
| 4 | left-click | Create Module from selection | The visible command moves the selection into one locked, durable Module through the shared graph command. | Left click at (578, 328). | 166 |  |

## Captured errors

| Source | Message |
| --- | --- |
| none | No captured errors |
