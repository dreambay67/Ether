# blank-gui-checkpoint action log

- Mode: packaged
- Outcome: passed
- Git commit: 4377c567e52721f8a4a7c52b84f6815031babe44
- Profile: fresh-isolated; APPDATA, LOCALAPPDATA, and userData isolated
- Viewport: 1600×1000; scale 1
- Started: 2026-08-11T11:07:53.111Z
- Finished: 2026-08-11T11:08:04.446Z

## Build identity

- release/windows/win-unpacked/Ether.exe: a53092cd276ed4c9840885db2619ad56c2595fb053721856b95bdd0b8eca54bf
- release/windows/win-unpacked/resources/app.asar: c16491a5ef5bd38ffdeae98921a0d4e191ccfef032b5c6cf2d29f8eec97ccde8

## Actions

| # | Input | Action | Expected | Actual | ms | Screenshot |
| --- | --- | --- | --- | --- | ---: | --- |
| 1 | observation | Registry-backed blank library | All 17 canonical node types are discoverable before graph mutation. | Found 17 registry rows in canonical order. | 0 |  |
| 2 | screenshot | Capture the blank registry-backed library | A fresh blank document visibly exposes the searchable Node Library. | Captured after the documented preceding action. | 153 | screenshots/01-blank-library.png |
| 3 | left-click | Add prompt.text from Node Library | The registry factory creates prompt.text with canonical defaults. | Left click at (108, 498). | 82 |  |
| 4 | left-click | Add prompt.worker from Node Library | The registry factory creates prompt.worker with canonical defaults. | Left click at (108, 633). | 57 |  |
| 5 | left-drag | Move Worker with ordinary left drag | The Worker moves once and preserves its graph identity. | Left drag (802, 614) to (802, 424). | 150 |  |
| 6 | keyboard-command | Fit the moved nodes | The two authored nodes return to a clear marquee workspace without changing their saved positions. | Pressed Home. | 8 |  |
| 7 | left-marquee | Marquee-select Prompt | A left-drag marquee selects the intersected Prompt. | Left drag (797, 608) to (973, 758). | 120 |  |
| 8 | shift-marquee | Add Worker with Shift marquee | Shift marquee preserves Prompt and adds Worker. | Shift+left drag (631, 362) to (807, 512). | 396 |  |
| 9 | right-drag-pan | Pan with ordinary right drag | The canvas viewport moves while the two-node selection remains unchanged. | Right drag (996, 819) to (886, 774). | 95 |  |
| 10 | screenshot | Capture movement and additive marquee | The separated nodes show one reliable movement and two-node additive selection state. | Captured after the documented preceding action. | 166 | screenshots/02-marquee-and-movement.png |
| 11 | keyboard-command | Duplicate selected nodes | Ctrl+D duplicates the two selected nodes with a visible offset. | Pressed Control+D. | 39 |  |
| 12 | keyboard-command | Copy graph selection | Ctrl+C records the selected graph subgraph. | Pressed Control+C. | 13 |  |
| 13 | keyboard-command | Paste graph selection | Ctrl+V pastes the selected subgraph with fresh graph identities. | Pressed Control+V. | 41 |  |
| 14 | keyboard-command | Delete pasted graph selection | Delete removes the current graph selection. | Pressed Delete. | 27 |  |
| 15 | keyboard-command | Undo graph delete | Ctrl+Z restores the deleted graph selection. | Pressed Control+Z. | 23 |  |
| 16 | keyboard-command | Redo graph delete | Ctrl+Y reapplies the graph deletion. | Pressed Control+Y. | 30 |  |
| 17 | keyboard-command | Select every current node | Ctrl+A selects every node when the canvas owns focus. | Pressed Control+A. | 12 |  |
| 18 | observation | Primary graph shortcuts | Duplicate, clipboard, delete, undo, redo, and select-all change the durable graph. | Node counts: 2 -> 4 -> 6 -> 4 -> 6 -> 4; four selected. | 0 |  |
| 19 | keyboard-command | Rename the primary selected node | F2 opens one controlled title editor. | Pressed F2. | 20 |  |
| 20 | keyboard-command | Commit the direct title edit | Enter commits the renamed title as one graph transaction. | Pressed Enter. | 37 |  |
| 21 | left-click | Restore canvas-owned node focus | The renamed Prompt is the primary selected graph object. | Left click at (775, 615). | 39 |  |
| 22 | keyboard-command | Open primary content editing | Enter edits the selected Prompt primary content rather than moving the node. | Pressed Enter. | 16 |  |
| 23 | screenshot | Capture controlled direct editing | The selected Prompt visibly owns the only bounded on-canvas editor. | Captured after the documented preceding action. | 217 | screenshots/03-direct-editing.png |
| 24 | keyboard-command | Commit primary content edit | Ctrl+Enter commits text while the editor owns focus. | Pressed Control+Enter. | 49 |  |
| 25 | keyboard-command | Refit before Worker editing | The edited cards return to a clear direct-editing workspace. | Pressed Home. | 4 |  |
| 26 | left-double-click | Edit Worker instruction on canvas | Double-click opens the visible Worker's primary instruction directly on its card. | Left double-click at (737, 460). | 68 |  |
| 27 | keyboard-command | Commit Worker instruction edit | Ctrl+Enter saves the Worker's instruction as one graph transaction. | Pressed Control+Enter. | 47 |  |
| 28 | left-click | Restore Prompt command focus | The directly edited Prompt remains the primary graph selection. | Left click at (867, 642). | 58 |  |
| 29 | keyboard-command | Select the preview graph scope | The preview scope includes the blank-authored Workers without starting provider work. | Pressed Control+A. | 18 |  |
| 30 | keyboard-command | Preview the selected run | Ctrl+Enter reaches provider capability validation without starting provider work. | Pressed Control+Enter. | 19 |  |
| 31 | observation | Provider-free run preview | The shortcut is wired while an unconfigured blank profile remains provider-safe. | Preview stopped at the visible capability guard; no provider work started. | 0 |  |
| 32 | left-click | Add reference.set from Node Library | The registry factory creates reference.set with canonical defaults. | Left click at (108, 749). | 75 |  |
| 33 | left-click | Add generation.image from Node Library | The registry factory creates generation.image with canonical defaults. | Left click at (108, 814). | 74 |  |
| 34 | left-click | Add edit.image from Node Library | The registry factory creates edit.image with canonical defaults. | Left click at (108, 674). | 76 |  |
| 35 | left-click | Add edit.mask from Node Library | The registry factory creates edit.mask with canonical defaults. | Left click at (108, 750). | 79 |  |
| 36 | left-click | Add edit.transform from Node Library | The registry factory creates edit.transform with canonical defaults. | Left click at (108, 814). | 69 |  |
| 37 | left-click | Add review.compare from Node Library | The registry factory creates review.compare with canonical defaults. | Left click at (108, 674). | 83 |  |
| 38 | left-click | Add review.evaluate from Node Library | The registry factory creates review.evaluate with canonical defaults. | Left click at (108, 750). | 80 |  |
| 39 | left-click | Add review.filter from Node Library | The registry factory creates review.filter with canonical defaults. | Left click at (108, 814). | 67 |  |
| 40 | left-click | Add flow.variables from Node Library | The registry factory creates flow.variables with canonical defaults. | Left click at (108, 674). | 75 |  |
| 41 | left-click | Add flow.batch from Node Library | The registry factory creates flow.batch with canonical defaults. | Left click at (108, 750). | 80 |  |
| 42 | left-click | Add flow.join from Node Library | The registry factory creates flow.join with canonical defaults. | Left click at (108, 814). | 79 |  |
| 43 | left-click | Add output.collection from Node Library | The registry factory creates output.collection with canonical defaults. | Left click at (108, 674). | 81 |  |
| 44 | left-click | Add output.export from Node Library | The registry factory creates output.export with canonical defaults. | Left click at (108, 750). | 78 |  |
| 45 | left-click | Add canvas.note from Node Library | The registry factory creates canvas.note with canonical defaults. | Left click at (108, 814). | 82 |  |
| 46 | left-click | Add canvas.drawing from Node Library | The registry factory creates canvas.drawing with canonical defaults. | Left click at (108, 774). | 88 |  |
| 47 | left-click | Hide Reference Desk | The ordinary panel control clears more room for the authored graph. | Left click at (1581, 151). | 84 |  |
| 48 | left-click | Hide Build tools | The ordinary panel control clears more room for the authored graph. | Left click at (244, 183). | 58 |  |
| 49 | left-click | Hide Project lens | The ordinary panel control clears more room for the authored graph. | Left click at (1580, 183). | 51 |  |
| 50 | left-click | Return focus to the canvas | Canvas focus owns the final fit command. | Left click at (800, 906). | 21 |  |
| 51 | keyboard-command | Fit the authored graph | Home fits all authored node types into the viewport. | Pressed Home. | 4 |  |
| 52 | observation | All canonical cards authored | Every canonical type can be created from the blank document without a graph fixture. | 17 distinct node definitions are visible on the durable canvas. | 0 |  |
| 53 | screenshot | Capture all canonical node types | The fitted blank-authored graph visibly contains all 17 canonical node types. | Captured after the documented preceding action. | 145 | screenshots/04-all-17-node-types.png |
| 54 | keyboard-command | Open the canvas command palette | Ctrl+K exposes the same graph command registry used by shortcuts and toolbar. | Pressed Control+K. | 22 |  |
| 55 | screenshot | Capture the unified command surface | The palette visibly lists graph commands, shortcuts, availability, and disabled reasons. | Captured after the documented preceding action. | 201 | screenshots/05-command-palette.png |

## Captured errors

| Source | Message |
| --- | --- |
| none | No captured errors |
