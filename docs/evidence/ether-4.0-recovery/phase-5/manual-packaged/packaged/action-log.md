# manual-recovery action log

- Mode: packaged
- Outcome: passed
- Git commit: 4b54a2bda0383a33f087653c271b3179eb287900
- Profile: fresh-isolated; APPDATA, LOCALAPPDATA, and userData isolated
- Viewport: 1600×1000; scale 1
- Started: 2026-08-10T15:06:02.405Z
- Finished: 2026-08-10T15:06:16.681Z

## Build identity

- release/windows/win-unpacked/Ether.exe: 461c878a999b4cf6540edbefd869a4be476985dc2246a0595c4d74fe579faa04
- release/windows/win-unpacked/resources/app.asar: a956c135460a41cbe0bf434c31f1ae16a8d6d92ef917a6bb6b47d02c4fa5f5ef

## Actions

| # | Input | Action | Expected | Actual | ms | Screenshot |
| --- | --- | --- | --- | --- | ---: | --- |
| 1 | observation | Blank first-run state | A fresh profile begins with a blank writable graph, the 17-node Library, and concise first steps. | The canvas reported zero nodes and showed the three-step guide. | 0 |  |
| 2 | screenshot | Capture first-run guidance | The packaged blank document shows the registry Library and three practical starting steps. | Captured after the documented preceding action. | 152 | screenshots/01-first-run-blank.png |
| 3 | left-click | Open the shortcut reference | The Canvas toolbar exposes commands and gestures without requiring pointer hover. | Left click at (913, 328). | 58 |  |
| 4 | screenshot | Capture the shortcut reference | Keyboard commands and pointer gestures are readable in one focused dialog. | Captured after the documented preceding action. | 185 | screenshots/02-shortcut-reference.png |
| 5 | keyboard-command | Close the shortcut reference | Escape closes the modal and returns focus to its toolbar button. | Pressed Escape. | 5 |  |
| 6 | left-click | Add prompt.text from Node Library | The registry creates prompt.text with canonical defaults. | Left click at (108, 498). | 81 |  |
| 7 | left-click | Add prompt.worker from Node Library | The registry creates prompt.worker with canonical defaults. | Left click at (108, 633). | 393 |  |
| 8 | left-click | Add review.evaluate from Node Library | The registry creates review.evaluate with canonical defaults. | Left click at (108, 669). | 68 |  |
| 9 | left-click | Add flow.batch from Node Library | The registry creates flow.batch with canonical defaults. | Left click at (108, 669). | 70 |  |
| 10 | left-click | Hide Reference Desk | The canvas gains room for the authoring action. | Left click at (1581, 151). | 42 |  |
| 11 | left-click | Hide Build tools | The canvas gains room for the authoring action. | Left click at (244, 183). | 60 |  |
| 12 | left-click | Hide Project lens | The canvas gains room for the authoring action. | Left click at (1580, 183). | 37 |  |
| 13 | keyboard-command | Fit the authored nodes | The four blank-authored cards and their channel rails fit the visible canvas. | Pressed Home. | 7 |  |
| 14 | left-click | Select Prompt for direct editing | The Prompt becomes the primary canvas selection. | Left click at (1027, 667). | 42 |  |
| 15 | keyboard-command | Rename the Prompt | F2 opens the bounded title editor. | Pressed F2. | 15 |  |
| 16 | keyboard-command | Commit the Prompt title | Enter saves the title as one graph transaction. | Pressed Enter. | 44 |  |
| 17 | left-click | Focus Prompt content | The renamed Prompt's primary content control owns keyboard focus. | Left click at (1027, 690). | 65 |  |
| 18 | keyboard-command | Edit Prompt content | Enter opens the primary content editor on the card. | Pressed Enter. | 21 |  |
| 19 | screenshot | Capture direct editing | The packaged canvas shows one controlled in-place content editor. | Captured after the documented preceding action. | 181 | screenshots/03-direct-editing.png |
| 20 | keyboard-command | Commit Prompt content | Ctrl+Enter saves the edit without starting a run. | Pressed Control+Enter. | 43 |  |
| 21 | left-click | Begin Text lane | Compatible Text inputs become visible before the lane is saved. | Left click at (789, 410). | 208 |  |
| 22 | left-click | Complete Text lane | The Text lane persists through the visible canvas interaction. | Left click at (509, 282). | 282 |  |
| 23 | left-click | Begin Image lane | Compatible Image inputs become visible before the lane is saved. | Left click at (789, 420). | 247 |  |
| 24 | left-click | Complete Image lane | The Image lane persists through the visible canvas interaction. | Left click at (509, 292). | 260 |  |
| 25 | left-click | Begin Mask lane | Compatible Mask inputs become visible before the lane is saved. | Left click at (789, 429). | 250 |  |
| 26 | left-click | Complete Mask lane | The Mask lane persists through the visible canvas interaction. | Left click at (509, 301). | 254 |  |
| 27 | left-click | Begin Data lane | Compatible Data inputs become visible before the lane is saved. | Left click at (789, 439). | 249 |  |
| 28 | left-click | Complete Data lane | The Data lane persists through the visible canvas interaction. | Left click at (509, 311). | 281 |  |
| 29 | left-click | Begin Video lane | Compatible Video inputs become visible before the lane is saved. | Left click at (789, 448). | 225 |  |
| 30 | left-click | Complete Video lane | The Video lane persists through the visible canvas interaction. | Left click at (509, 320). | 281 |  |
| 31 | left-click | Begin Audio lane | Compatible Audio inputs become visible before the lane is saved. | Left click at (789, 457). | 222 |  |
| 32 | left-click | Complete Audio lane | The Audio lane persists through the visible canvas interaction. | Left click at (509, 330). | 257 |  |
| 33 | left-click | Open semantic roles | The lane exposes the shared semantic role grid. | Left click at (649, 501). | 56 |  |
| 34 | left-click | Set the Subject role | The Text lane carries a visible Subject badge. | Left click at (696, 522). | 67 |  |
| 35 | screenshot | Capture channels and roles | All six channel lanes coexist and one lane shows its semantic Subject role. | Captured after the documented preceding action. | 224 | screenshots/04-channels-and-roles.png |
| 36 | left-click | Select Prompt for a Module | Prompt begins the Module selection. | Left click at (1027, 697). | 38 |  |
| 37 | left-click | Add Worker to the Module selection | Shift keeps Prompt selected and adds Worker. | Left click at (876, 569). | 48 |  |
| 38 | keyboard-command | Create a Module | Ctrl+G moves the two selected nodes into one locked durable Module. | Pressed Control+G. | 63 |  |
| 39 | screenshot | Capture the locked Module | The packaged canvas shows the protected Module beside the remaining workflow. | Captured after the documented preceding action. | 193 | screenshots/05-locked-module.png |
| 40 | left-click | Restore Build tools | The Library returns for the next documented setup. | Left click at (19, 183). | 39 |  |
| 41 | left-click | Restore Project lens | The Inspector returns for setup details. | Left click at (1584, 183). | 34 |  |
| 42 | left-click | Restore Reference Desk | The source desk returns above the canvas. | Left click at (20, 151). | 39 |  |
| 43 | left-click | Add reference.set from Node Library | The registry creates reference.set with canonical defaults. | Left click at (108, 749). | 61 |  |
| 44 | left-click | Select Reference Set | Reference controls and the empty source desk share the visible Build workspace. | Left click at (802, 579). | 43 |  |
| 45 | screenshot | Capture reference setup | Reference Set setup and the honest empty Reference Desk are visible without importing or injecting a source. | Captured after the documented preceding action. | 245 | screenshots/06-reference-setup.png |
| 46 | left-click | Open Run workspace | Run reveals Batch Matrix and Job Center around the same durable graph. | Left click at (169, 89). | 36 |  |
| 47 | screenshot | Capture batch planning | The Batch Matrix shows the work set, allocation boundary, and concurrency controls without starting work. | Captured after the documented preceding action. | 204 | screenshots/07-batch-run-workspace.png |
| 48 | left-click | Open Review workspace | Review exposes the Artifact Observatory for the current blank-authored document. | Left click at (232, 89). | 49 |  |
| 49 | screenshot | Capture Review | The packaged Review workspace reports its empty artifact state instead of fabricating output. | Captured after the documented preceding action. | 156 | screenshots/08-review-empty-state.png |
| 50 | left-click | Return to Build | The same authored graph returns for export setup. | Left click at (47, 89). | 51 |  |
| 51 | left-click | Add output.export from Node Library | The registry creates output.export with canonical defaults. | Left click at (108, 674). | 67 |  |
| 52 | left-click | Select Export | The Inspector exposes export setup before any folder grant or write. | Left click at (802, 579). | 41 |  |
| 53 | screenshot | Capture export setup | Export names the required scoped folder grant, template, format, collision policy, and metadata choice before writing. | Captured after the documented preceding action. | 263 | screenshots/09-export-setup.png |
| 54 | left-click | Add prompt.worker from Node Library | The registry creates prompt.worker with canonical defaults. | Left click at (108, 643). | 45 |  |
| 55 | left-click | Select an unconfigured Worker | The run preview targets one visible runnable node. | Left click at (802, 579). | 51 |  |
| 56 | keyboard-command | Preview without a provider | Preview stops at capability validation and starts no provider work. | Pressed Control+Enter. | 24 |  |
| 57 | screenshot | Capture the provider guard | The visible error explains why the plan cannot run; no provider request was sent. | Captured after the documented preceding action. | 234 | screenshots/10-provider-safe-error.png |
| 58 | left-click | Open Recipe Gallery | The versioned recipe catalog opens without applying a recipe. | Left click at (194, 913). | 62 |  |
| 59 | screenshot | Capture Recipe Gallery | All 12 recipe cards are visible before setup, mutation, or provider work. | Captured after the documented preceding action. | 232 | screenshots/11-recipe-gallery.png |
| 60 | keyboard-command | Close Recipe Gallery | Escape closes the recipe dialog without changing the graph. | Pressed Escape. | 10 |  |
| 61 | left-click | Open Settings | Settings exposes local interface, safety, recovery, and version state. | Left click at (1564, 34). | 60 |  |
| 62 | screenshot | Capture recovery and provider setup | Settings shows a healthy local recovery state and an unconfigured Gemini route without testing or connecting it. | Captured after the documented preceding action. | 287 | screenshots/12-recovery-and-provider-setup.png |
| 63 | observation | T25 manual route | Every screenshot comes from visible actions in a fresh packaged blank document. | The journey authored nodes, editing, six lanes, a locked Module, setup views, a provider-safe error, recipes, and recovery state without provider execution or injected graph state. | 0 |  |

## Captured errors

| Source | Message |
| --- | --- |
| none | No captured errors |
