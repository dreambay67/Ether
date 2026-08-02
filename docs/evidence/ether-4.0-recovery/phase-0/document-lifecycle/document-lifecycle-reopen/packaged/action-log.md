# document-lifecycle-reopen action log

- Mode: packaged
- Outcome: passed
- Git commit: 73186a641cf418a18354104819630de47d564734
- Profile: fresh-isolated; APPDATA, LOCALAPPDATA, and userData isolated
- Viewport: 1280×720; scale 1
- Started: 2026-08-02T21:44:58.617Z
- Finished: 2026-08-02T21:45:02.008Z

## Build identity

- release/windows/win-unpacked/Ether.exe: 69091bcfc673a1cfbc92fcf9bf0e1c93c1d380131adb334f441d31bcd2dab339
- release/windows/win-unpacked/resources/app.asar: 837b2acfe5d5d4355f1c4c79d36162b68a2f07cbebfd3edcc0766b164452fa25

## Actions

| # | Input | Action | Expected | Actual | ms | Screenshot |
| --- | --- | --- | --- | --- | ---: | --- |
| 1 | observation | Hard-kill recovery reopen | The hard-killed UI-authored .ether reclaims its dead same-machine writer lease and reopens writable without a stale recovery warning. | The exact Save As destination reopened writable with both UI-authored nodes and Saved state. | 0 |  |
| 2 | screenshot | Capture the exact reopened document | The graph comes from the ordinary Save/Save As journey, not a recovery fixture. | Captured after the documented preceding action. | 100 | screenshots/03-reopened-ui-authored-document.png |
| 3 | observation | Windows accessibility close | A Windows UI Automation close action drains the Saved document without an unsaved-changes prompt. | The exact owned Ether window will be closed through its UI Automation WindowPattern. | 0 |  |

## Captured errors

| Source | Message |
| --- | --- |
| none | No captured errors |
