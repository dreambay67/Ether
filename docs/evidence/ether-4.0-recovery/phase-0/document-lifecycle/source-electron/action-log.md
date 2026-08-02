# document-lifecycle-reopen action log

- Mode: source-electron
- Outcome: failed
- Git commit: 7e4a26b0e8268bb67008191050b5915a2e55388e
- Profile: fresh-isolated; APPDATA, LOCALAPPDATA, and userData isolated
- Viewport: 1280×720; scale 1
- Started: 2026-08-02T19:17:27.091Z
- Finished: 2026-08-02T19:17:44.734Z

## Build identity

- apps/desktop/dist/index.html: 543f0354225d211c45b3e6443c5e47b412f304909e65106ce646c0f9d002451e
- apps/desktop/dist-electron/main/bootstrap.js: 15c36bf7beb643ea7abdb8384d179420adfa9637fb105705de014b6c5a749aa3
- apps/desktop/dist-electron/preload/preload.cjs: 2d0df031b5236237200d9b4ca168417132134b2c6263bb12af08449826d9e6bf
- node_modules/electron/dist/electron.exe: 12b61e817329db7db8e74d99a42e552e1a1f68db7ba3d4c2d4fb6441a3b07d26

## Actions

| # | Input | Action | Expected | Actual | ms | Screenshot |
| --- | --- | --- | --- | --- | ---: | --- |
| 1 | observation | Close/reopen recovery check | A cleanly closed UI-authored .ether reopens writable without a stale recovery warning. | The exact Save As destination reopened with both UI-authored nodes and Saved state. | 0 |  |
| 2 | screenshot | Capture the exact reopened document | The graph comes from the ordinary Save/Save As journey, not a recovery fixture. | Captured after the documented preceding action. | 206 | screenshots/03-reopened-ui-authored-document.png |
| 3 | keyboard-command | Close the recovered document with the native window command | A clean close after Saved exits without an unsaved-changes prompt or leftover document journal. | Pressed Alt+F4. | 5 |  |

## Captured errors

| Source | Message |
| --- | --- |
| page | [<br>  {<br>    "code": "invalid_type",<br>    "expected": "object",<br>    "received": "boolean",<br>    "path": [<br>      "value"<br>    ],<br>    "message": "Expected object, received boolean"<br>  }<br>] |
