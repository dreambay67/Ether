# document-lifecycle-writer-lock action log

- Mode: packaged
- Outcome: passed
- Git commit: cee52084d5e423960c60311779767586d4c167c5
- Profile: fresh-isolated; APPDATA, LOCALAPPDATA, and userData isolated
- Viewport: 1280×720; scale 1
- Started: 2026-08-11T10:39:44.424Z
- Finished: 2026-08-11T10:39:48.486Z

## Build identity

- release/windows/win-unpacked/Ether.exe: e2f8c25e63420e646c6d588ff83cc16bac2f4affd1dec7d3416370d653e747e8
- release/windows/win-unpacked/resources/app.asar: e959f707a6d36e9004cc70e66030ceb7e39d1be612462481876db37388f889d3

## Actions

| # | Input | Action | Expected | Actual | ms | Screenshot |
| --- | --- | --- | --- | --- | ---: | --- |
| 1 | observation | Competing writer | A second process opens the exact document read-only while the first process retains the writer lease. | The competing Ether.exe displayed the writer-active read-only explanation and disabled Save. | 0 |  |
| 2 | screenshot | Capture the competing writer lock | The second process cannot acquire writable access. | Captured after the documented preceding action. | 124 | screenshots/writer-lock-read-only.png |

## Captured errors

| Source | Message |
| --- | --- |
| main-process | [73900:0811/123947.284:ERROR:content\browser\gpu\gpu_process_host.cc:1089] GPU process exited unexpectedly: exit_code=-1 |
