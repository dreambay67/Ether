# document-lifecycle-reopen action log

- Mode: source-electron
- Outcome: passed
- Git commit: bf81dfdd25ce49e4c12f236e3ade09424e417271
- Profile: fresh-isolated; APPDATA, LOCALAPPDATA, and userData isolated
- Viewport: 1280×720; scale 1
- Started: 2026-08-03T00:38:33.821Z
- Finished: 2026-08-03T00:38:36.393Z

## Build identity

- apps/desktop/dist/index.html: bfe6e6f2e88ac676609a90fad830627cffa464b4edc8eb808d57b931659d5d96
- apps/desktop/dist-electron/main/bootstrap.js: 11fa8b92a32a8f19fd2e4e04d38eb08bdfb452266faee0c462d4b1c73fa1dc72
- apps/desktop/dist-electron/preload/preload.cjs: 55129d69d37a552ec4c4767db952fab28911ba029a38da8de75d54001e988d7b
- node_modules/electron/dist/electron.exe: 12b61e817329db7db8e74d99a42e552e1a1f68db7ba3d4c2d4fb6441a3b07d26

## Actions

| # | Input | Action | Expected | Actual | ms | Screenshot |
| --- | --- | --- | --- | --- | ---: | --- |
| 1 | observation | Hard-kill recovery reopen | The hard-killed UI-authored .ether reclaims its dead same-machine writer lease and reopens writable without a stale recovery warning. | The exact Save As destination reopened writable with both UI-authored nodes and Saved state. | 0 |  |
| 2 | screenshot | Capture the exact reopened document | The graph comes from the ordinary Save/Save As journey, not a recovery fixture. | Captured after the documented preceding action. | 237 | screenshots/03-reopened-ui-authored-document.png |
| 3 | observation | Windows accessibility close | A Windows UI Automation close action drains the Saved document without an unsaved-changes prompt. | The exact owned Ether window will be closed through its UI Automation WindowPattern. | 0 |  |

## Captured errors

| Source | Message |
| --- | --- |
| none | No captured errors |
