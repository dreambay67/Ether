# document-lifecycle action log

- Mode: source-electron
- Outcome: passed
- Git commit: bf81dfdd25ce49e4c12f236e3ade09424e417271
- Profile: fresh-isolated; APPDATA, LOCALAPPDATA, and userData isolated
- Viewport: 1280×720; scale 1
- Started: 2026-08-03T00:38:26.320Z
- Finished: 2026-08-03T00:38:33.507Z

## Build identity

- apps/desktop/dist/index.html: bfe6e6f2e88ac676609a90fad830627cffa464b4edc8eb808d57b931659d5d96
- apps/desktop/dist-electron/main/bootstrap.js: 11fa8b92a32a8f19fd2e4e04d38eb08bdfb452266faee0c462d4b1c73fa1dc72
- apps/desktop/dist-electron/preload/preload.cjs: 55129d69d37a552ec4c4767db952fab28911ba029a38da8de75d54001e988d7b
- node_modules/electron/dist/electron.exe: 12b61e817329db7db8e74d99a42e552e1a1f68db7ba3d4c2d4fb6441a3b07d26

## Actions

| # | Input | Action | Expected | Actual | ms | Screenshot |
| --- | --- | --- | --- | --- | ---: | --- |
| 1 | left-click | Create the first graph node on the blank canvas | A Prompt node is created only through the visible authoring UI. | Left click at (91, 313). | 59 |  |
| 2 | screenshot | Capture the UI-authored graph | The first node is visibly authored from a blank document. | Captured after the documented preceding action. | 255 | screenshots/01-blank-ui-node.png |
| 3 | keyboard-command | Save the untitled UI-authored document | The native Save dialog writes one .ether document. | Pressed Control+s. | 71 |  |
| 4 | observation | Ctrl+S document save | Ctrl+S opens the native Save dialog for an untitled document. | The Ctrl+S route created the requested .ether file. | 0 |  |
| 5 | observation | Save result | The UI-created graph is stored as one .ether file. | Saved UI authored document.ether after Ctrl+S. | 0 |  |
| 6 | left-click | Inspect the manual save milestone | Document History shows the Ctrl+S manual milestone as a reviewable record. | Left click at (1079, 34). | 15 |  |
| 7 | screenshot | Capture the visible manual milestone | The document history names the manual Ctrl+S milestone. | Captured after the documented preceding action. | 107 | screenshots/manual-save-history.png |
| 8 | left-click | Close Document History | The history review returns to the document canvas. | Left click at (964, 138). | 11 |  |
| 9 | left-click | Save As to a second path | The active document switches only after the new destination is complete. | Left click at (884, 34). | 20 |  |
| 10 | left-click | Save a copy without switching | A complete copy is created while the active title remains the Save As destination. | Left click at (923, 34). | 29 |  |
| 11 | left-click | Compact the UI-authored document | Compaction reports actual before and after sizes without invalidating the document. | Left click at (962, 34). | 9 |  |
| 12 | left-click | Make the UI-authored document portable | The native confirmation completes a zero-reference portability check honestly. | Left click at (1001, 34). | 13 |  |
| 13 | screenshot | Capture completed document actions | Save As, Copy, Compact, and Portable actions have completed on the UI-authored document. | Captured after the documented preceding action. | 135 | screenshots/02-saved-compact-portable.png |
| 14 | left-click | Edit the saved document through the visible UI before a recovery restart | A second node is committed and autosaved before the deliberate process kill. | Left click at (91, 354). | 14 |  |
| 15 | observation | Visible autosave transition | The ordinary graph edit visibly transitions through Saving to Saved. | Observed Saving -> Saved. | 0 |  |
| 16 | observation | Hard-kill after UI edit/autosave | The exact journey process exits without a clean close, leaving normal AppData recovery state for the next launch. | The journey process was terminated only after the visible two-node graph returned to Saved. | 0 |  |

## Captured errors

| Source | Message |
| --- | --- |
| none | No captured errors |
