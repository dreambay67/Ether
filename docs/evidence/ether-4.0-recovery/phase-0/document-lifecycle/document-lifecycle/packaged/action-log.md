# document-lifecycle action log

- Mode: packaged
- Outcome: passed
- Git commit: cee52084d5e423960c60311779767586d4c167c5
- Profile: fresh-isolated; APPDATA, LOCALAPPDATA, and userData isolated
- Viewport: 1280×720; scale 1
- Started: 2026-08-11T10:39:30.340Z
- Finished: 2026-08-11T10:39:52.329Z

## Build identity

- release/windows/win-unpacked/Ether.exe: e2f8c25e63420e646c6d588ff83cc16bac2f4affd1dec7d3416370d653e747e8
- release/windows/win-unpacked/resources/app.asar: e959f707a6d36e9004cc70e66030ceb7e39d1be612462481876db37388f889d3

## Actions

| # | Input | Action | Expected | Actual | ms | Screenshot |
| --- | --- | --- | --- | --- | ---: | --- |
| 1 | left-click | Create the first graph node on the blank canvas | A Prompt node is created only through the visible authoring UI. | Left click at (108, 453). | 91 |  |
| 2 | screenshot | Capture the UI-authored graph | The first node is visibly authored from a blank document. | Captured after the documented preceding action. | 142 | screenshots/01-blank-ui-node.png |
| 3 | keyboard-command | Save the untitled UI-authored document | The native Save dialog writes one .ether document. | Pressed Control+s. | 7 |  |
| 4 | observation | Ctrl+S document save | Ctrl+S opens the native Save dialog for an untitled document. | The Ctrl+S route created the requested .ether file. | 0 |  |
| 5 | observation | Save result | The UI-created graph is stored as one .ether file. | Saved UI authored document.ether after Ctrl+S. | 0 |  |
| 6 | left-click | Inspect the manual save milestone | Document History shows the Ctrl+S manual milestone as a reviewable record. | Left click at (1079, 34). | 48 |  |
| 7 | screenshot | Capture the visible manual milestone | The document history names the manual Ctrl+S milestone. | Captured after the documented preceding action. | 170 | screenshots/manual-save-history.png |
| 8 | left-click | Close Document History | The history review returns to the document canvas. | Left click at (964, 138). | 45 |  |
| 9 | left-click | Save As to a second path | The active document switches only after the new destination is complete. | Left click at (884, 34). | 37 |  |
| 10 | left-click | Save a copy without switching | A complete copy is created while the active title remains the Save As destination. | Left click at (923, 34). | 33 |  |
| 11 | left-click | Compact the UI-authored document | Compaction reports actual before and after sizes without invalidating the document. | Left click at (962, 34). | 28 |  |
| 12 | left-click | Make the UI-authored document portable | The native confirmation completes a zero-reference portability check honestly. | Left click at (1001, 34). | 40 |  |
| 13 | screenshot | Capture completed document actions | Save As, Copy, Compact, and Portable actions have completed on the UI-authored document. | Captured after the documented preceding action. | 86 | screenshots/02-saved-compact-portable.png |
| 14 | observation | Writer lease before contender | The Save As destination retains one AppData writer lease before the competing process opens it. | Observed one lease for PID 77480 and path hash 729be1410566a9a9e8de3db29c6ce6bdab03ccc4a0c1752776395fecad6927e3. | 0 |  |
| 15 | left-click | Edit the saved document through the visible UI before a recovery restart | A second node is committed and autosaved before the deliberate process kill. | Left click at (108, 507). | 66 |  |
| 16 | observation | Visible autosave transition | The ordinary graph edit visibly transitions through Saving to Saved. | Observed Saved -> Saving -> Saved. | 0 |  |
| 17 | observation | Hard-kill after UI edit/autosave | The exact journey process exits without a clean close, leaving normal AppData recovery state for the next launch. | The journey process was terminated only after the visible two-node graph returned to Saved. | 0 |  |

## Captured errors

| Source | Message |
| --- | --- |
| none | No captured errors |
