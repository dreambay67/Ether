# document-lifecycle-clean-reopen action log

- Mode: packaged
- Outcome: passed
- Git commit: 73186a641cf418a18354104819630de47d564734
- Profile: fresh-isolated; APPDATA, LOCALAPPDATA, and userData isolated
- Viewport: 1280×720; scale 1
- Started: 2026-08-02T21:45:02.283Z
- Finished: 2026-08-02T21:45:05.093Z

## Build identity

- release/windows/win-unpacked/Ether.exe: 69091bcfc673a1cfbc92fcf9bf0e1c93c1d380131adb334f441d31bcd2dab339
- release/windows/win-unpacked/resources/app.asar: 837b2acfe5d5d4355f1c4c79d36162b68a2f07cbebfd3edcc0766b164452fa25

## Actions

| # | Input | Action | Expected | Actual | ms | Screenshot |
| --- | --- | --- | --- | --- | ---: | --- |
| 1 | screenshot | Capture the clean-close reopen | The same user-saved document remains writable after an exact Windows UI Automation close. | Captured after the documented preceding action. | 105 | screenshots/04-clean-close-reopen.png |

## Captured errors

| Source | Message |
| --- | --- |
| none | No captured errors |
