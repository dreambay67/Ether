# document-lifecycle-reopen action log

- Mode: source-electron
- Outcome: passed
- Git commit: 21f1294a9d15a278f2339449fafdbb53403131b9
- Profile: fresh-isolated; APPDATA, LOCALAPPDATA, and userData isolated
- Viewport: 1280×720; scale 1
- Started: 2026-08-02T19:53:28.502Z
- Finished: 2026-08-02T19:53:31.053Z

## Build identity

- apps/desktop/dist/index.html: 2e576efa0c60ca5da7e764498b319a165358c392a4f1a70cf18b5733f0a72d9f
- apps/desktop/dist-electron/main/bootstrap.js: 15c36bf7beb643ea7abdb8384d179420adfa9637fb105705de014b6c5a749aa3
- apps/desktop/dist-electron/preload/preload.cjs: 2d0df031b5236237200d9b4ca168417132134b2c6263bb12af08449826d9e6bf
- node_modules/electron/dist/electron.exe: 12b61e817329db7db8e74d99a42e552e1a1f68db7ba3d4c2d4fb6441a3b07d26

## Actions

| # | Input | Action | Expected | Actual | ms | Screenshot |
| --- | --- | --- | --- | --- | ---: | --- |
| 1 | observation | Close/reopen recovery check | A cleanly closed UI-authored .ether reopens writable without a stale recovery warning. | The exact Save As destination reopened with both UI-authored nodes and Saved state. | 0 |  |
| 2 | screenshot | Capture the exact reopened document | The graph comes from the ordinary Save/Save As journey, not a recovery fixture. | Captured after the documented preceding action. | 275 | screenshots/03-reopened-ui-authored-document.png |
| 3 | observation | Windows accessibility close | A Windows UI Automation close action drains the Saved document without an unsaved-changes prompt. | The exact owned Ether window will be closed through its UI Automation WindowPattern. | 0 |  |

## Captured errors

| Source | Message |
| --- | --- |
| none | No captured errors |
