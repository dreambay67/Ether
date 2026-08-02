# document-lifecycle action log

- Mode: packaged
- Outcome: passed
- Git commit: 73186a641cf418a18354104819630de47d564734
- Profile: fresh-isolated; APPDATA, LOCALAPPDATA, and userData isolated
- Viewport: 1280×720; scale 1
- Started: 2026-08-02T21:44:39.382Z
- Finished: 2026-08-02T21:44:58.346Z

## Build identity

- release/windows/win-unpacked/Ether.exe: 69091bcfc673a1cfbc92fcf9bf0e1c93c1d380131adb334f441d31bcd2dab339
- release/windows/win-unpacked/resources/app.asar: 837b2acfe5d5d4355f1c4c79d36162b68a2f07cbebfd3edcc0766b164452fa25

## Actions

| # | Input | Action | Expected | Actual | ms | Screenshot |
| --- | --- | --- | --- | --- | ---: | --- |
| 1 | left-click | Create the first graph node on the blank canvas | A Prompt node is created only through the visible authoring UI. | Left click at (91, 313). | 72 |  |
| 2 | screenshot | Capture the UI-authored graph | The first node is visibly authored from a blank document. | Captured after the documented preceding action. | 100 | screenshots/01-blank-ui-node.png |
| 3 | keyboard-command | Save the untitled UI-authored document | The native Save dialog writes one .ether document. | Pressed Control+s. | 8 |  |
| 4 | observation | Ctrl+S document save | Ctrl+S opens the native Save dialog for an untitled document. | The Ctrl+S route created the requested .ether file. | 0 |  |
| 5 | observation | Save result | The UI-created graph is stored as one .ether file. | Saved UI authored document.ether after Ctrl+S. | 0 |  |
| 6 | left-click | Inspect the manual save milestone | Document History shows the Ctrl+S manual milestone as a reviewable record. | Left click at (1079, 34). | 16 |  |
| 7 | screenshot | Capture the visible manual milestone | The document history names the manual Ctrl+S milestone. | Captured after the documented preceding action. | 103 | screenshots/manual-save-history.png |
| 8 | left-click | Close Document History | The history review returns to the document canvas. | Left click at (964, 138). | 12 |  |
| 9 | left-click | Save As to a second path | The active document switches only after the new destination is complete. | Left click at (884, 34). | 12 |  |
| 10 | left-click | Save a copy without switching | A complete copy is created while the active title remains the Save As destination. | Left click at (923, 34). | 10 |  |
| 11 | left-click | Compact the UI-authored document | Compaction reports actual before and after sizes without invalidating the document. | Left click at (962, 34). | 13 |  |
| 12 | left-click | Make the UI-authored document portable | The native confirmation completes a zero-reference portability check honestly. | Left click at (1001, 34). | 15 |  |
| 13 | screenshot | Capture completed document actions | Save As, Copy, Compact, and Portable actions have completed on the UI-authored document. | Captured after the documented preceding action. | 95 | screenshots/02-saved-compact-portable.png |
| 14 | observation | Writer lease before contender | The Save As destination retains one AppData writer lease before the competing process opens it. | Observed one lease for PID 3180 and path hash c774d03f5dfa8197b1989232f02a55e74b65095e59b6ddc2f128d9b5b2e3f239. | 0 |  |
| 15 | left-click | Edit the saved document through the visible UI before a recovery restart | A second node is committed and autosaved before the deliberate process kill. | Left click at (91, 354). | 13 |  |
| 16 | observation | Visible autosave transition | The ordinary graph edit visibly transitions through Saving to Saved. | Observed Saved -> Saving -> Saved. | 0 |  |
| 17 | observation | Hard-kill after UI edit/autosave | The exact journey process exits without a clean close, leaving normal AppData recovery state for the next launch. | The journey process was terminated only after the visible two-node graph returned to Saved. | 0 |  |

## Captured errors

| Source | Message |
| --- | --- |
| none | No captured errors |
