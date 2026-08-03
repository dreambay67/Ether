# blank-gui-checkpoint action log

- Mode: packaged
- Outcome: passed
- Git commit: 51ec96680e7453519fbb0643bfe5e6c2c2312375
- Profile: fresh-isolated; APPDATA, LOCALAPPDATA, and userData isolated
- Viewport: 1600×1000; scale 1
- Started: 2026-08-03T11:31:57.365Z
- Finished: 2026-08-03T11:32:07.163Z

## Build identity

- release/windows/win-unpacked/Ether.exe: 94f64e57236b36013c1ba5abbcfa1c129941590a0ca98c169c6f565e36e6476a
- release/windows/win-unpacked/resources/app.asar: a2d1ef9bdc9943e94fda49702a4c65bdfc7ca4cc3af2cfa737aafc1a7f05850e

## Actions

| # | Input | Action | Expected | Actual | ms | Screenshot |
| --- | --- | --- | --- | --- | ---: | --- |
| 1 | observation | Registry-backed blank library | All 17 canonical node types are discoverable before graph mutation. | Found 17 registry rows in canonical order. | 0 |  |
| 2 | screenshot | Capture the blank registry-backed library | A fresh blank document visibly exposes the searchable Node Library. | Captured after the documented preceding action. | 128 | screenshots/01-blank-library.png |
| 3 | left-click | Add prompt.text from Node Library | The registry factory creates prompt.text with canonical defaults. | Left click at (108, 498). | 37 |  |
| 4 | left-click | Add prompt.worker from Node Library | The registry factory creates prompt.worker with canonical defaults. | Left click at (108, 633). | 34 |  |
| 5 | left-drag | Move Worker with ordinary left drag | The Worker moves once and preserves its graph identity. | Left drag (542, 434) to (542, 824). | 273 |  |
| 6 | left-marquee | Marquee-select Prompt | A left-drag marquee selects the intersected Prompt. | Left drag (674, 526) to (930, 702). | 154 |  |
| 7 | shift-marquee | Add Worker with Shift marquee | Shift marquee preserves Prompt and adds Worker. | Shift+left drag (414, 688) to (670, 864). | 103 |  |
| 8 | screenshot | Capture movement and additive marquee | The separated nodes show one reliable movement and two-node additive selection state. | Captured after the documented preceding action. | 175 | screenshots/02-marquee-and-movement.png |
| 9 | keyboard-command | Duplicate selected nodes | Ctrl+D duplicates the two selected nodes with a visible offset. | Pressed Control+D. | 38 |  |
| 10 | keyboard-command | Copy graph selection | Ctrl+C records the selected graph subgraph. | Pressed Control+C. | 6 |  |
| 11 | keyboard-command | Paste graph selection | Ctrl+V pastes the selected subgraph with fresh graph identities. | Pressed Control+V. | 36 |  |
| 12 | keyboard-command | Delete pasted graph selection | Delete removes the current graph selection. | Pressed Delete. | 30 |  |
| 13 | keyboard-command | Undo graph delete | Ctrl+Z restores the deleted graph selection. | Pressed Control+Z. | 26 |  |
| 14 | keyboard-command | Redo graph delete | Ctrl+Y reapplies the graph deletion. | Pressed Control+Y. | 38 |  |
| 15 | keyboard-command | Select every current node | Ctrl+A selects every node when the canvas owns focus. | Pressed Control+A. | 12 |  |
| 16 | observation | Primary graph shortcuts | Duplicate, clipboard, delete, undo, redo, and select-all change the durable graph. | Node counts: 2 -> 4 -> 6 -> 4 -> 6 -> 4; four selected. | 0 |  |
| 17 | keyboard-command | Rename the primary selected node | F2 opens one controlled title editor. | Pressed F2. | 16 |  |
| 18 | keyboard-command | Commit the direct title edit | Enter commits the renamed title as one graph transaction. | Pressed Enter. | 27 |  |
| 19 | left-click | Restore canvas-owned node focus | The renamed Prompt is the primary selected graph object. | Left click at (802, 599). | 130 |  |
| 20 | keyboard-command | Open primary content editing | Enter edits the selected Prompt primary content rather than moving the node. | Pressed Enter. | 26 |  |
| 21 | screenshot | Capture controlled direct editing | The selected Prompt visibly owns the only bounded on-canvas editor. | Captured after the documented preceding action. | 196 | screenshots/03-direct-editing.png |
| 22 | keyboard-command | Commit primary content edit | Ctrl+Enter commits text while the editor owns focus. | Pressed Control+Enter. | 29 |  |
| 23 | left-click | Restore Prompt command focus | The directly edited Prompt remains the primary graph selection. | Left click at (802, 599). | 16 |  |
| 24 | keyboard-command | Select the preview graph scope | The preview scope includes the blank-authored Workers without starting provider work. | Pressed Control+A. | 10 |  |
| 25 | keyboard-command | Preview the selected run | Ctrl+Enter reaches provider capability validation without starting provider work. | Pressed Control+Enter. | 10 |  |
| 26 | observation | Provider-free run preview | The shortcut is wired while an unconfigured blank profile remains provider-safe. | Preview stopped at the visible capability guard; no provider work started. | 0 |  |
| 27 | left-click | Add reference.set from Node Library | The registry factory creates reference.set with canonical defaults. | Left click at (108, 749). | 37 |  |
| 28 | left-click | Add generation.image from Node Library | The registry factory creates generation.image with canonical defaults. | Left click at (108, 814). | 38 |  |
| 29 | left-click | Add edit.image from Node Library | The registry factory creates edit.image with canonical defaults. | Left click at (108, 674). | 52 |  |
| 30 | left-click | Add edit.mask from Node Library | The registry factory creates edit.mask with canonical defaults. | Left click at (108, 750). | 37 |  |
| 31 | left-click | Add edit.transform from Node Library | The registry factory creates edit.transform with canonical defaults. | Left click at (108, 814). | 39 |  |
| 32 | left-click | Add review.compare from Node Library | The registry factory creates review.compare with canonical defaults. | Left click at (108, 674). | 38 |  |
| 33 | left-click | Add review.evaluate from Node Library | The registry factory creates review.evaluate with canonical defaults. | Left click at (108, 750). | 40 |  |
| 34 | left-click | Add review.filter from Node Library | The registry factory creates review.filter with canonical defaults. | Left click at (108, 814). | 44 |  |
| 35 | left-click | Add flow.variables from Node Library | The registry factory creates flow.variables with canonical defaults. | Left click at (108, 674). | 56 |  |
| 36 | left-click | Add flow.batch from Node Library | The registry factory creates flow.batch with canonical defaults. | Left click at (108, 750). | 40 |  |
| 37 | left-click | Add flow.join from Node Library | The registry factory creates flow.join with canonical defaults. | Left click at (108, 814). | 124 |  |
| 38 | left-click | Add output.collection from Node Library | The registry factory creates output.collection with canonical defaults. | Left click at (108, 674). | 45 |  |
| 39 | left-click | Add output.export from Node Library | The registry factory creates output.export with canonical defaults. | Left click at (108, 750). | 44 |  |
| 40 | left-click | Add canvas.note from Node Library | The registry factory creates canvas.note with canonical defaults. | Left click at (108, 814). | 38 |  |
| 41 | left-click | Add canvas.drawing from Node Library | The registry factory creates canvas.drawing with canonical defaults. | Left click at (108, 774). | 48 |  |
| 42 | left-click | Return focus to the canvas | Canvas focus owns the final fit command. | Left click at (802, 906). | 29 |  |
| 43 | keyboard-command | Fit the authored graph | Home fits all authored node types into the viewport. | Pressed Home. | 5 |  |
| 44 | observation | All canonical cards authored | Every canonical type can be created from the blank document without a graph fixture. | 17 distinct node definitions are visible on the durable canvas. | 0 |  |
| 45 | screenshot | Capture all canonical node types | The fitted blank-authored graph visibly contains all 17 canonical node types. | Captured after the documented preceding action. | 208 | screenshots/04-all-17-node-types.png |
| 46 | keyboard-command | Open the canvas command palette | Ctrl+K exposes the same graph command registry used by shortcuts and toolbar. | Pressed Control+K. | 37 |  |
| 47 | screenshot | Capture the unified command surface | The palette visibly lists graph commands, shortcuts, availability, and disabled reasons. | Captured after the documented preceding action. | 284 | screenshots/05-command-palette.png |

## Captured errors

| Source | Message |
| --- | --- |
| none | No captured errors |
