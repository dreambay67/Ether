# document-lifecycle-clean-reopen action log

- Mode: source-electron
- Outcome: passed
- Git commit: df561277d893e3c544696f85cd0d995e306e70a4
- Profile: fresh-isolated; APPDATA, LOCALAPPDATA, and userData isolated
- Viewport: 1280×720; scale 1
- Started: 2026-08-02T19:32:39.747Z
- Finished: 2026-08-02T19:32:41.579Z

## Build identity

- apps/desktop/dist/index.html: 7f5fb899294ddbaa630fa4821f5be3474a30aa72e1a2061395656b25d71e8639
- apps/desktop/dist-electron/main/bootstrap.js: 15c36bf7beb643ea7abdb8384d179420adfa9637fb105705de014b6c5a749aa3
- apps/desktop/dist-electron/preload/preload.cjs: 2d0df031b5236237200d9b4ca168417132134b2c6263bb12af08449826d9e6bf
- node_modules/electron/dist/electron.exe: 12b61e817329db7db8e74d99a42e552e1a1f68db7ba3d4c2d4fb6441a3b07d26

## Actions

| # | Input | Action | Expected | Actual | ms | Screenshot |
| --- | --- | --- | --- | --- | ---: | --- |
| 1 | screenshot | Capture the clean-close reopen | The same user-saved document remains writable after a real Alt+F4 close. | Captured after the documented preceding action. | 234 | screenshots/04-clean-close-reopen.png |

## Captured errors

| Source | Message |
| --- | --- |
| none | No captured errors |
