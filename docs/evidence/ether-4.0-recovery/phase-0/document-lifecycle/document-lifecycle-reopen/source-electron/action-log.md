# document-lifecycle-reopen action log

- Mode: source-electron
- Outcome: passed
- Git commit: df561277d893e3c544696f85cd0d995e306e70a4
- Profile: fresh-isolated; APPDATA, LOCALAPPDATA, and userData isolated
- Viewport: 1280×720; scale 1
- Started: 2026-08-02T19:32:37.474Z
- Finished: 2026-08-02T19:32:39.486Z

## Build identity

- apps/desktop/dist/index.html: 7f5fb899294ddbaa630fa4821f5be3474a30aa72e1a2061395656b25d71e8639
- apps/desktop/dist-electron/main/bootstrap.js: 15c36bf7beb643ea7abdb8384d179420adfa9637fb105705de014b6c5a749aa3
- apps/desktop/dist-electron/preload/preload.cjs: 2d0df031b5236237200d9b4ca168417132134b2c6263bb12af08449826d9e6bf
- node_modules/electron/dist/electron.exe: 12b61e817329db7db8e74d99a42e552e1a1f68db7ba3d4c2d4fb6441a3b07d26

## Actions

| # | Input | Action | Expected | Actual | ms | Screenshot |
| --- | --- | --- | --- | --- | ---: | --- |
| 1 | observation | Close/reopen recovery check | A cleanly closed UI-authored .ether reopens writable without a stale recovery warning. | The exact Save As destination reopened with both UI-authored nodes and Saved state. | 0 |  |
| 2 | screenshot | Capture the exact reopened document | The graph comes from the ordinary Save/Save As journey, not a recovery fixture. | Captured after the documented preceding action. | 237 | screenshots/03-reopened-ui-authored-document.png |
| 3 | observation | Clean close limitation | A real native Alt+F4 close is required before AC-A02-005/009 can receive packaged evidence. | The recovery driver has not yet proved native-window close input; session cleanup is used only to continue the non-substituting reopen check. | 0 |  |

## Captured errors

| Source | Message |
| --- | --- |
| none | No captured errors |
