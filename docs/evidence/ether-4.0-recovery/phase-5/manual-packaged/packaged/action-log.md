# manual-recovery action log

- Mode: packaged
- Outcome: passed
- Git commit: 4377c567e52721f8a4a7c52b84f6815031babe44
- Profile: fresh-isolated; APPDATA, LOCALAPPDATA, and userData isolated
- Viewport: 1600×1000; scale 1
- Started: 2026-08-11T11:00:32.304Z
- Finished: 2026-08-11T11:00:47.572Z

## Build identity

- release/windows/win-unpacked/Ether.exe: a53092cd276ed4c9840885db2619ad56c2595fb053721856b95bdd0b8eca54bf
- release/windows/win-unpacked/resources/app.asar: c16491a5ef5bd38ffdeae98921a0d4e191ccfef032b5c6cf2d29f8eec97ccde8

## Actions

| # | Input | Action | Expected | Actual | ms | Screenshot |
| --- | --- | --- | --- | --- | ---: | --- |
| 1 | observation | Blank first-run state | A fresh profile begins with a blank writable graph, the 17-node Library, and concise first steps. | The canvas reported zero nodes and showed the three-step guide. | 0 |  |
| 2 | screenshot | Capture first-run guidance | The packaged blank document shows the registry Library and three practical starting steps. | Captured after the documented preceding action. | 156 | screenshots/01-first-run-blank.png |
| 3 | left-click | Open the shortcut reference | The Canvas toolbar exposes commands and gestures without requiring pointer hover. | Left click at (913, 328). | 75 |  |
| 4 | screenshot | Capture the shortcut reference | Keyboard commands and pointer gestures are readable in one focused dialog. | Captured after the documented preceding action. | 202 | screenshots/02-shortcut-reference.png |
| 5 | keyboard-command | Close the shortcut reference | Escape closes the modal and returns focus to its toolbar button. | Pressed Escape. | 6 |  |
| 6 | left-click | Add prompt.text from Node Library | The registry creates prompt.text with canonical defaults. | Left click at (108, 498). | 61 |  |
| 7 | left-click | Add prompt.worker from Node Library | The registry creates prompt.worker with canonical defaults. | Left click at (108, 633). | 64 |  |
| 8 | left-click | Add review.evaluate from Node Library | The registry creates review.evaluate with canonical defaults. | Left click at (108, 669). | 116 |  |
| 9 | left-click | Add flow.batch from Node Library | The registry creates flow.batch with canonical defaults. | Left click at (108, 669). | 74 |  |
| 10 | left-click | Hide Reference Desk | The canvas gains room for the authoring action. | Left click at (1581, 151). | 44 |  |
| 11 | left-click | Hide Build tools | The canvas gains room for the authoring action. | Left click at (244, 183). | 47 |  |
| 12 | left-click | Hide Project lens | The canvas gains room for the authoring action. | Left click at (1580, 183). | 40 |  |
| 13 | keyboard-command | Fit the authored nodes | The four blank-authored cards and their channel rails fit the visible canvas. | Pressed Home. | 7 |  |
| 14 | left-click | Select Prompt for direct editing | The Prompt becomes the primary canvas selection. | Left click at (1027, 667). | 33 |  |
| 15 | keyboard-command | Rename the Prompt | F2 opens the bounded title editor. | Pressed F2. | 15 |  |
| 16 | keyboard-command | Commit the Prompt title | Enter saves the title as one graph transaction. | Pressed Enter. | 34 |  |
| 17 | left-click | Focus Prompt content | The renamed Prompt's primary content control owns keyboard focus. | Left click at (1027, 690). | 54 |  |
| 18 | keyboard-command | Edit Prompt content | Enter opens the primary content editor on the card. | Pressed Enter. | 18 |  |
| 19 | screenshot | Capture direct editing | The packaged canvas shows one controlled in-place content editor. | Captured after the documented preceding action. | 179 | screenshots/03-direct-editing.png |
| 20 | keyboard-command | Commit Prompt content | Ctrl+Enter saves the edit without starting a run. | Pressed Control+Enter. | 37 |  |
| 21 | left-click | Begin Text lane | Compatible Text inputs become visible before the lane is saved. | Left click at (789, 410). | 218 |  |
| 22 | left-click | Complete Text lane | The Text lane persists through the visible canvas interaction. | Left click at (509, 282). | 253 |  |
| 23 | left-click | Begin Image lane | Compatible Image inputs become visible before the lane is saved. | Left click at (789, 420). | 242 |  |
| 24 | left-click | Complete Image lane | The Image lane persists through the visible canvas interaction. | Left click at (509, 292). | 261 |  |
| 25 | left-click | Begin Mask lane | Compatible Mask inputs become visible before the lane is saved. | Left click at (789, 429). | 226 |  |
| 26 | left-click | Complete Mask lane | The Mask lane persists through the visible canvas interaction. | Left click at (509, 301). | 260 |  |
| 27 | left-click | Begin Data lane | Compatible Data inputs become visible before the lane is saved. | Left click at (789, 439). | 241 |  |
| 28 | left-click | Complete Data lane | The Data lane persists through the visible canvas interaction. | Left click at (509, 311). | 278 |  |
| 29 | left-click | Begin Video lane | Compatible Video inputs become visible before the lane is saved. | Left click at (789, 448). | 237 |  |
| 30 | left-click | Complete Video lane | The Video lane persists through the visible canvas interaction. | Left click at (509, 320). | 260 |  |
| 31 | left-click | Begin Audio lane | Compatible Audio inputs become visible before the lane is saved. | Left click at (789, 457). | 225 |  |
| 32 | left-click | Complete Audio lane | The Audio lane persists through the visible canvas interaction. | Left click at (509, 330). | 247 |  |
| 33 | left-click | Open semantic roles | The active lane exposes the shared semantic role grid. | Left click at (656, 378). | 42 |  |
| 34 | left-click | Set the Subject role | The Text lane carries a visible Subject badge. | Left click at (703, 398). | 77 |  |
| 35 | screenshot | Capture channels and roles | All six channel lanes coexist and one lane shows its semantic Subject role. | Captured after the documented preceding action. | 238 | screenshots/04-channels-and-roles.png |
| 36 | left-click | Select Prompt for a Module | Prompt begins the Module selection. | Left click at (1027, 697). | 36 |  |
| 37 | left-click | Add Worker to the Module selection | Shift keeps Prompt selected and adds Worker. | Left click at (876, 569). | 46 |  |
| 38 | keyboard-command | Create a Module | Ctrl+G moves the two selected nodes into one locked durable Module. | Pressed Control+G. | 54 |  |
| 39 | screenshot | Capture the locked Module | The packaged canvas shows the protected Module beside the remaining workflow. | Captured after the documented preceding action. | 176 | screenshots/05-locked-module.png |
| 40 | left-click | Restore Build tools | The Library returns for the next documented setup. | Left click at (19, 183). | 34 |  |
| 41 | left-click | Restore Project lens | The Inspector returns for setup details. | Left click at (1584, 183). | 45 |  |
| 42 | left-click | Restore Reference Desk | The source desk returns above the canvas. | Left click at (20, 151). | 39 |  |
| 43 | left-click | Add reference.set from Node Library | The registry creates reference.set with canonical defaults. | Left click at (108, 749). | 91 |  |
| 44 | left-click | Select Reference Set | Reference controls and the empty source desk share the visible Build workspace. | Left click at (802, 579). | 57 |  |
| 45 | screenshot | Capture reference setup | Reference Set setup and the honest empty Reference Desk are visible without importing or injecting a source. | Captured after the documented preceding action. | 243 | screenshots/06-reference-setup.png |
| 46 | left-click | Open Run workspace | Run reveals Batch Matrix and Job Center around the same durable graph. | Left click at (169, 89). | 45 |  |
| 47 | screenshot | Capture batch planning | The Batch Matrix shows the work set, allocation boundary, and concurrency controls without starting work. | Captured after the documented preceding action. | 191 | screenshots/07-batch-run-workspace.png |
| 48 | left-click | Open Review workspace | Review exposes the Artifact Observatory for the current blank-authored document. | Left click at (232, 89). | 39 |  |
| 49 | screenshot | Capture Review | The packaged Review workspace reports its empty artifact state instead of fabricating output. | Captured after the documented preceding action. | 154 | screenshots/08-review-empty-state.png |
| 50 | left-click | Return to Build | The same authored graph returns for export setup. | Left click at (47, 89). | 54 |  |
| 51 | left-click | Add output.export from Node Library | The registry creates output.export with canonical defaults. | Left click at (108, 674). | 75 |  |
| 52 | left-click | Select Export | The Inspector exposes export setup before any folder grant or write. | Left click at (802, 579). | 42 |  |
| 53 | screenshot | Capture export setup | Export names the required scoped folder grant, template, format, collision policy, and metadata choice before writing. | Captured after the documented preceding action. | 255 | screenshots/09-export-setup.png |
| 54 | left-click | Add prompt.worker from Node Library | The registry creates prompt.worker with canonical defaults. | Left click at (108, 643). | 61 |  |
| 55 | left-click | Select an unconfigured Worker | The run preview targets one visible runnable node. | Left click at (802, 579). | 47 |  |
| 56 | keyboard-command | Preview without a provider | Preview stops at capability validation and starts no provider work. | Pressed Control+Enter. | 22 |  |
| 57 | screenshot | Capture the provider guard | The visible error explains why the plan cannot run; no provider request was sent. | Captured after the documented preceding action. | 255 | screenshots/10-provider-safe-error.png |
| 58 | left-click | Open Recipe Gallery | The versioned recipe catalog opens without applying a recipe. | Left click at (194, 913). | 61 |  |
| 59 | screenshot | Capture Recipe Gallery | All 12 recipe cards are visible before setup, mutation, or provider work. | Captured after the documented preceding action. | 253 | screenshots/11-recipe-gallery.png |
| 60 | keyboard-command | Close Recipe Gallery | Escape closes the recipe dialog without changing the graph. | Pressed Escape. | 8 |  |
| 61 | left-click | Open Settings | Settings exposes local interface, safety, recovery, and version state. | Left click at (1564, 34). | 70 |  |
| 62 | screenshot | Capture recovery and provider setup | Settings shows a healthy local recovery state and an unconfigured Gemini route without testing or connecting it. | Captured after the documented preceding action. | 345 | screenshots/12-recovery-and-provider-setup.png |
| 63 | observation | T25 manual route | Every screenshot comes from visible actions in a fresh packaged blank document. | The journey authored nodes, editing, six lanes, a locked Module, setup views, a provider-safe error, recipes, and recovery state without provider execution or injected graph state. | 0 |  |

## Captured errors

| Source | Message |
| --- | --- |
| none | No captured errors |
