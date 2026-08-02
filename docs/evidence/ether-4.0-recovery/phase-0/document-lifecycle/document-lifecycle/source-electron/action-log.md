# document-lifecycle action log

- Mode: source-electron
- Outcome: passed
- Git commit: df561277d893e3c544696f85cd0d995e306e70a4
- Profile: fresh-isolated; APPDATA, LOCALAPPDATA, and userData isolated
- Viewport: 1280×720; scale 1
- Started: 2026-08-02T19:32:30.376Z
- Finished: 2026-08-02T19:32:37.160Z

## Build identity

- apps/desktop/dist/index.html: 7f5fb899294ddbaa630fa4821f5be3474a30aa72e1a2061395656b25d71e8639
- apps/desktop/dist-electron/main/bootstrap.js: 15c36bf7beb643ea7abdb8384d179420adfa9637fb105705de014b6c5a749aa3
- apps/desktop/dist-electron/preload/preload.cjs: 2d0df031b5236237200d9b4ca168417132134b2c6263bb12af08449826d9e6bf
- node_modules/electron/dist/electron.exe: 12b61e817329db7db8e74d99a42e552e1a1f68db7ba3d4c2d4fb6441a3b07d26

## Actions

| # | Input | Action | Expected | Actual | ms | Screenshot |
| --- | --- | --- | --- | --- | ---: | --- |
| 1 | left-click | Create the first graph node on the blank canvas | A Prompt node is created only through the visible authoring UI. | Left click at (91, 313). | 54 |  |
| 2 | screenshot | Capture the UI-authored graph | The first node is visibly authored from a blank document. | Captured after the documented preceding action. | 150 | screenshots/01-blank-ui-node.png |
| 3 | keyboard-command | Save the untitled UI-authored document | The native Save dialog writes one .ether document. | Pressed Control+S. | 14 |  |
| 4 | observation | Ctrl+S document save | Ctrl+S opens the native Save dialog for an untitled document. | The Ctrl+S route created the requested .ether file. | 0 |  |
| 5 | observation | Save result | The UI-created graph is stored as one .ether file. | Saved UI authored document.ether after Ctrl+S. | 0 |  |
| 6 | left-click | Save As to a second path | The active document switches only after the new destination is complete. | Left click at (962, 34). | 11 |  |
| 7 | left-click | Save a copy without switching | A complete copy is created while the active title remains the Save As destination. | Left click at (1001, 34). | 13 |  |
| 8 | left-click | Compact the UI-authored document | Compaction reports actual before and after sizes without invalidating the document. | Left click at (1040, 34). | 14 |  |
| 9 | left-click | Make the UI-authored document portable | The native confirmation completes a zero-reference portability check honestly. | Left click at (1079, 34). | 25 |  |
| 10 | screenshot | Capture completed document actions | Save As, Copy, Compact, and Portable actions have completed on the UI-authored document. | Captured after the documented preceding action. | 105 | screenshots/02-saved-compact-portable.png |
| 11 | left-click | Edit the saved document through the visible UI before a recovery restart | A second node is committed and autosaved before the deliberate process kill. | Left click at (91, 354). | 18 |  |
| 12 | observation | Hard-kill after UI edit/autosave | The exact journey process exits without a clean close, leaving normal AppData recovery state for the next launch. | The journey process was terminated only after the visible two-node graph returned to Saved. | 0 |  |

## Captured errors

| Source | Message |
| --- | --- |
| none | No captured errors |
