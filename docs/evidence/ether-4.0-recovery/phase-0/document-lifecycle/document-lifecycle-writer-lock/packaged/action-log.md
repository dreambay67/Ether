# document-lifecycle-writer-lock action log

- Mode: packaged
- Outcome: passed
- Git commit: 5417ce1999f04206918ef9aaf8fae1eac2ef33c8
- Profile: fresh-isolated; APPDATA, LOCALAPPDATA, and userData isolated
- Viewport: 1280×720; scale 1
- Started: 2026-08-03T01:14:16.098Z
- Finished: 2026-08-03T01:14:19.276Z

## Build identity

- release/windows/win-unpacked/Ether.exe: 03db599dbaec1e6d564275cfb63d568dec0189217237efa3ea5e2e99b482580f
- release/windows/win-unpacked/resources/app.asar: 8cc07d197b636b5104da29ffc295313ed64f82082cf2907566f5cbfedafb0a4e

## Actions

| # | Input | Action | Expected | Actual | ms | Screenshot |
| --- | --- | --- | --- | --- | ---: | --- |
| 1 | observation | Competing writer | A second process opens the exact document read-only while the first process retains the writer lease. | The competing Ether.exe displayed the writer-active read-only explanation and disabled Save. | 0 |  |
| 2 | screenshot | Capture the competing writer lock | The second process cannot acquire writable access. | Captured after the documented preceding action. | 93 | screenshots/writer-lock-read-only.png |

## Captured errors

| Source | Message |
| --- | --- |
| none | No captured errors |
