# visible-recovery-metadata-baseline action log

- Mode: packaged
- Outcome: passed
- Git commit: 5417ce1999f04206918ef9aaf8fae1eac2ef33c8
- Profile: fresh-isolated; APPDATA, LOCALAPPDATA, and userData isolated
- Viewport: 1280×720; scale 1
- Started: 2026-08-03T01:16:14.740Z
- Finished: 2026-08-03T01:16:26.151Z

## Build identity

- release/windows/win-unpacked/Ether.exe: 03db599dbaec1e6d564275cfb63d568dec0189217237efa3ea5e2e99b482580f
- release/windows/win-unpacked/resources/app.asar: 8cc07d197b636b5104da29ffc295313ed64f82082cf2907566f5cbfedafb0a4e

## Actions

| # | Input | Action | Expected | Actual | ms | Screenshot |
| --- | --- | --- | --- | --- | ---: | --- |
| 1 | left-click | Create metadata baseline | The corrupt-metadata fixture begins with a packaged UI-authored document. | Left click at (91, 313). | 51 |  |
| 2 | keyboard-command | Save metadata baseline | The Windows Save dialog persists the baseline before the copied fixture is corrupted. | Pressed Control+s. | 26 |  |
| 3 | observation | Open corrupt metadata copy | A native Ctrl+O sent to the exact packaged Ether window opens the document picker. | native-keyboard ownerPid=9804 shortcut=Ctrl+O | 0 |  |
| 4 | observation | Native unsupported metadata error | The exact packaged browser process presents a clear native unsupported-document error for the corrupt copy. | MainInstructionIcon SQLite application ID 1234 is not an Ether application ID. OK | 0 |  |
| 5 | screenshot | Capture unsupported corrupt metadata | The packaged app keeps the valid active baseline after the native unsupported-document error. | Captured after the documented preceding action. | 84 | screenshots/corrupt-metadata-unsupported.png |

## Captured errors

| Source | Message |
| --- | --- |
| none | No captured errors |
