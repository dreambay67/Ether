# document-lifecycle-clean-reopen action log

- Mode: packaged
- Outcome: passed
- Git commit: cee52084d5e423960c60311779767586d4c167c5
- Profile: fresh-isolated; APPDATA, LOCALAPPDATA, and userData isolated
- Viewport: 1280×720; scale 1
- Started: 2026-08-11T10:39:56.250Z
- Finished: 2026-08-11T10:40:00.573Z

## Build identity

- release/windows/win-unpacked/Ether.exe: e2f8c25e63420e646c6d588ff83cc16bac2f4affd1dec7d3416370d653e747e8
- release/windows/win-unpacked/resources/app.asar: e959f707a6d36e9004cc70e66030ceb7e39d1be612462481876db37388f889d3

## Actions

| # | Input | Action | Expected | Actual | ms | Screenshot |
| --- | --- | --- | --- | --- | ---: | --- |
| 1 | screenshot | Capture the clean-close reopen | The same user-saved document remains writable after an exact Windows UI Automation close. | Captured after the documented preceding action. | 107 | screenshots/04-clean-close-reopen.png |

## Captured errors

| Source | Message |
| --- | --- |
| none | No captured errors |
