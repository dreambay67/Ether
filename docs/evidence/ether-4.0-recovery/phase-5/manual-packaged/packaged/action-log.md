# manual-recovery action log

- Mode: packaged
- Outcome: failed
- Git commit: 2342cff76d48346d501da691e66c1b0b35c2937d
- Profile: fresh-isolated; APPDATA, LOCALAPPDATA, and userData isolated
- Viewport: 1600×1000; scale 1
- Started: 2026-08-09T21:47:07.590Z
- Finished: 2026-08-09T21:47:21.813Z

## Build identity

- release/windows/win-unpacked/Ether.exe: 2d90842c3b03c131567522e8cd9b63b31064cb97fa52d4c1b31bb1d7e19337ec
- release/windows/win-unpacked/resources/app.asar: f1823e2bde697e2cc8fa55add7b1d71be99fb19369e3234ca7599ee6963ae875

## Actions

| # | Input | Action | Expected | Actual | ms | Screenshot |
| --- | --- | --- | --- | --- | ---: | --- |
| 1 | observation | Blank first-run state | A fresh profile begins with a blank writable graph, the 17-node Library, and concise first steps. | The canvas reported zero nodes and showed the three-step guide. | 0 |  |
| 2 | screenshot | Capture first-run guidance | The packaged blank document shows the registry Library and three practical starting steps. | Captured after the documented preceding action. | 161 | screenshots/01-first-run-blank.png |
| 3 | left-click | Open the shortcut reference | The Canvas toolbar exposes commands and gestures without requiring pointer hover. | Left click at (913, 328). | 83 |  |
| 4 | screenshot | Capture the shortcut reference | Keyboard commands and pointer gestures are readable in one focused dialog. | Captured after the documented preceding action. | 188 | screenshots/02-shortcut-reference.png |
| 5 | keyboard-command | Close the shortcut reference | Escape closes the modal and returns focus to its toolbar button. | Pressed Escape. | 9 |  |
| 6 | left-click | Add prompt.text from Node Library | The registry creates prompt.text with canonical defaults. | Left click at (108, 498). | 218 |  |
| 7 | left-click | Add prompt.worker from Node Library | The registry creates prompt.worker with canonical defaults. | Left click at (108, 633). | 67 |  |
| 8 | left-click | Add review.evaluate from Node Library | The registry creates review.evaluate with canonical defaults. | Left click at (108, 669). | 77 |  |
| 9 | left-click | Add flow.batch from Node Library | The registry creates flow.batch with canonical defaults. | Left click at (108, 669). | 94 |  |
| 10 | left-click | Hide Reference Desk | The canvas gains room for the authoring action. | Left click at (1581, 151). | 111 |  |
| 11 | left-click | Hide Build tools | The canvas gains room for the authoring action. | Left click at (244, 183). | 67 |  |
| 12 | left-click | Hide Project lens | The canvas gains room for the authoring action. | Left click at (1580, 183). | 412 |  |
| 13 | keyboard-command | Fit the authored nodes | The four blank-authored cards and their channel rails fit the visible canvas. | Pressed Home. | 9 |  |
| 14 | left-click | Select Prompt for direct editing | The Prompt becomes the primary canvas selection. | Left click at (800, 644). | 51 |  |
| 15 | keyboard-command | Rename the Prompt | F2 opens the bounded title editor. | Pressed F2. | 22 |  |
| 16 | keyboard-command | Commit the Prompt title | Enter saves the title as one graph transaction. | Pressed Enter. | 34 |  |
| 17 | left-click | Focus Prompt content | The renamed Prompt's primary content control owns keyboard focus. | Left click at (800, 693). | 65 |  |
| 18 | keyboard-command | Edit Prompt content | Enter opens the primary content editor on the card. | Pressed Enter. | 19 |  |
| 19 | screenshot | Capture direct editing | The packaged canvas shows one controlled in-place content editor. | Captured after the documented preceding action. | 193 | screenshots/03-direct-editing.png |
| 20 | keyboard-command | Commit Prompt content | Ctrl+Enter saves the edit without starting a run. | Pressed Control+Enter. | 33 |  |
| 21 | left-click | Begin Text lane | Compatible Text inputs become visible before the lane is saved. | Left click at (939, 408). | 251 |  |
| 22 | left-click | Complete Text lane | The Text lane persists through the visible canvas interaction. | Left click at (986, 408). | 277 |  |
| 23 | left-click | Begin Image lane | Compatible Image inputs become visible before the lane is saved. | Left click at (939, 437). | 231 |  |
| 24 | left-click | Complete Image lane | The Image lane persists through the visible canvas interaction. | Left click at (986, 437). | 297 |  |
| 25 | left-click | Begin Mask lane | Compatible Mask inputs become visible before the lane is saved. | Left click at (939, 465). | 247 |  |
| 26 | left-click | Complete Mask lane | The Mask lane persists through the visible canvas interaction. | Left click at (986, 465). | 283 |  |
| 27 | left-click | Begin Data lane | Compatible Data inputs become visible before the lane is saved. | Left click at (939, 494). | 247 |  |
| 28 | left-click | Complete Data lane | The Data lane persists through the visible canvas interaction. | Left click at (986, 494). | 287 |  |
| 29 | left-click | Begin Video lane | Compatible Video inputs become visible before the lane is saved. | Left click at (939, 523). | 244 |  |
| 30 | left-click | Complete Video lane | The Video lane persists through the visible canvas interaction. | Left click at (986, 523). | 282 |  |
| 31 | left-click | Begin Audio lane | Compatible Audio inputs become visible before the lane is saved. | Left click at (939, 551). | 243 |  |
| 32 | left-click | Complete Audio lane | The Audio lane persists through the visible canvas interaction. | Left click at (986, 551). | 175 |  |
| 33 | left-click | Open semantic roles | The lane exposes the shared semantic role grid. | Left click at (962, 408). | 52 |  |
| 34 | left-click | Set the Subject role | The Text lane carries a visible Subject badge. | Left click at (1063, 453). | 87 |  |
| 35 | screenshot | Capture channels and roles | All six channel lanes coexist and one lane shows its semantic Subject role. | Captured after the documented preceding action. | 214 | screenshots/04-channels-and-roles.png |
| 36 | left-click | Select Prompt for a Module | Prompt begins the Module selection. | Left click at (800, 682). | 45 |  |
| 37 | left-click | Add Worker to the Module selection | Shift keeps Prompt selected and adds Worker. | Left click at (475, 457). | 58 |  |
| 38 | keyboard-command | Create a Module | Ctrl+G moves the two selected nodes into one locked durable Module. | Pressed Control+G. | 55 |  |
| 39 | screenshot | Capture the locked Module | The packaged canvas shows the protected Module beside the remaining workflow. | Captured after the documented preceding action. | 189 | screenshots/05-locked-module.png |
| 40 | left-click | Restore Build tools | The Library returns for the next documented setup. | Left click at (19, 183). | 45 |  |
| 41 | left-click | Restore Project lens | The Inspector returns for setup details. | Left click at (1584, 183). | 51 |  |
| 42 | left-click | Restore Reference Desk | The source desk returns above the canvas. | Left click at (20, 151). | 64 |  |
| 43 | left-click | Add reference.set from Node Library | The registry creates reference.set with canonical defaults. | Left click at (108, 749). | 61 |  |
| 44 | left-click | Select Reference Set | Reference controls and the empty source desk share the visible Build workspace. | Left click at (1127, 819). | 61 |  |

## Captured errors

| Source | Message |
| --- | --- |
| none | No captured errors |
