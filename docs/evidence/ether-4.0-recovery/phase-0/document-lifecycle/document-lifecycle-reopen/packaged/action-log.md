# document-lifecycle-reopen action log

- Mode: packaged
- Outcome: passed
- Git commit: 5417ce1999f04206918ef9aaf8fae1eac2ef33c8
- Profile: fresh-isolated; APPDATA, LOCALAPPDATA, and userData isolated
- Viewport: 1280×720; scale 1
- Started: 2026-08-03T01:14:22.705Z
- Finished: 2026-08-03T01:14:25.334Z

## Build identity

- release/windows/win-unpacked/Ether.exe: 03db599dbaec1e6d564275cfb63d568dec0189217237efa3ea5e2e99b482580f
- release/windows/win-unpacked/resources/app.asar: 8cc07d197b636b5104da29ffc295313ed64f82082cf2907566f5cbfedafb0a4e

## Actions

| # | Input | Action | Expected | Actual | ms | Screenshot |
| --- | --- | --- | --- | --- | ---: | --- |
| 1 | observation | Hard-kill recovery reopen | The hard-killed UI-authored .ether reclaims its dead same-machine writer lease and reopens writable without a stale recovery warning. | The exact Save As destination reopened writable with both UI-authored nodes and Saved state. | 0 |  |
| 2 | screenshot | Capture the exact reopened document | The graph comes from the ordinary Save/Save As journey, not a recovery fixture. | Captured after the documented preceding action. | 95 | screenshots/03-reopened-ui-authored-document.png |
| 3 | observation | Windows accessibility close | A Windows UI Automation close action drains the Saved document without an unsaved-changes prompt. | The exact owned Ether window will be closed through its UI Automation WindowPattern. | 0 |  |

## Captured errors

| Source | Message |
| --- | --- |
| none | No captured errors |
