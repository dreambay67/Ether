# visible-recovery-metadata-baseline action log

- Mode: packaged
- Outcome: passed
- Git commit: d9fb92a62d5c6ce541025546f4fdc5c35e0999b5
- Profile: fresh-isolated; APPDATA, LOCALAPPDATA, and userData isolated
- Viewport: 1280×720; scale 1
- Started: 2026-08-02T22:45:25.722Z
- Finished: 2026-08-02T22:45:36.523Z

## Build identity

- release/windows/win-unpacked/Ether.exe: 07f6adabbb296b387899919536a0af3cd36eed84ef7bfe05973b0133259c071d
- release/windows/win-unpacked/resources/app.asar: edf009fd0d2cf03b6719c67789bf42381410d16514e5f9a306d24c69dea8b814

## Actions

| # | Input | Action | Expected | Actual | ms | Screenshot |
| --- | --- | --- | --- | --- | ---: | --- |
| 1 | left-click | Create metadata baseline | The corrupt-metadata fixture begins with a packaged UI-authored document. | Left click at (91, 313). | 56 |  |
| 2 | keyboard-command | Save metadata baseline | The Windows Save dialog persists the baseline before the copied fixture is corrupted. | Pressed Control+s. | 27 |  |
| 3 | observation | Open corrupt metadata copy | A native Ctrl+O sent to the exact packaged Ether window opens the document picker. | native-keyboard ownerPid=37720 shortcut=Ctrl+O | 0 |  |
| 4 | observation | Native unsupported metadata error | The exact packaged browser process presents a clear native unsupported-document error for the corrupt copy. | MainInstructionIcon SQLite application ID 1234 is not an Ether application ID. OK | 0 |  |
| 5 | screenshot | Capture unsupported corrupt metadata | The packaged app keeps the valid active baseline after the native unsupported-document error. | Captured after the documented preceding action. | 110 | screenshots/corrupt-metadata-unsupported.png |

## Captured errors

| Source | Message |
| --- | --- |
| none | No captured errors |
