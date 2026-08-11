# t23-keyboard-packaged action log

- Mode: packaged
- Outcome: passed
- Git commit: cee52084d5e423960c60311779767586d4c167c5
- Profile: fresh-isolated; APPDATA, LOCALAPPDATA, and userData isolated
- Viewport: 1440×900; scale 1
- Started: 2026-08-11T10:38:53.869Z
- Finished: 2026-08-11T10:39:00.951Z

## Build identity

- release/windows/win-unpacked/Ether.exe: e2f8c25e63420e646c6d588ff83cc16bac2f4affd1dec7d3416370d653e747e8
- release/windows/win-unpacked/resources/app.asar: e959f707a6d36e9004cc70e66030ceb7e39d1be612462481876db37388f889d3

## Actions

| # | Input | Action | Expected | Actual | ms | Screenshot |
| --- | --- | --- | --- | --- | ---: | --- |
| 1 | observation | Initial keyboard focus | Keyboard traversal begins from the application's actual initial active element. | body | 0 |  |
| 2 | observation | Reach the Library search | The target is reached from the actual current focus using keyboard traversal only. | Reached  with 27 Tab key events. | 0 |  |
| 3 | keyboard-command | Select the Library query | The focused Library search owns the select-all shortcut, not the canvas graph. | Pressed Control+A. | 4 |  |
| 4 | observation | Filter Library for Prompt | The Library narrows using text typed through its keyboard-reached search field. | Typed 6 characters through the active keyboard target. | 0 |  |
| 5 | observation | Add Prompt from the Library | The target is reached from the actual current focus using keyboard traversal only. | Reached Add Prompt with 1 Tab key event. | 0 |  |
| 6 | keyboard-command | Add Prompt from the Library | Enter creates the canonical node through the ordinary Library command. | Pressed Enter. | 52 |  |
| 7 | observation | Reach the authoring canvas | The target is reached from the actual current focus using keyboard traversal only. | Reached Authoring canvas with 19 Tab key events. | 0 |  |
| 8 | keyboard-command | Open canvas quick add | N opens the searchable node palette while the canvas owns focus. | Pressed N. | 17 |  |
| 9 | observation | Filter quick add for Note | Quick add filters with text typed into its product-owned autofocus field. | Typed 4 characters through the active keyboard target. | 0 |  |
| 10 | keyboard-command | Insert Note from quick add | Enter inserts the active matching canonical node and returns focus to the canvas. | Pressed Enter. | 29 |  |
| 11 | observation | Select Prompt from its focused title | The target is reached from the actual current focus using keyboard traversal only. | Reached Prompt 1 with 4 Tab key events. | 0 |  |
| 12 | keyboard-command | Select Prompt from its focused title | Space selects the keyboard-reached node without using a pointer. | Pressed Space. | 9 |  |
| 13 | keyboard-command | Open the focused Prompt title editor | F2 opens one bounded title editor for the selected Prompt. | Pressed F2. | 13 |  |
| 14 | keyboard-command | Select title editor text | The inline editor keeps Ctrl+A local instead of selecting graph nodes. | Pressed Control+A. | 4 |  |
| 15 | observation | Type the Prompt title | The bounded F2 editor receives typed text while graph selection remains unchanged. | Typed 14 characters through the active keyboard target. | 0 |  |
| 16 | keyboard-command | Commit the focused title editor | Enter commits the title edit and closes the inline editor. | Pressed Enter. | 24 |  |
| 17 | observation | Return to the canvas after title editing | The target is reached from the actual current focus using keyboard traversal only. | Reached Authoring canvas with 0 Tab key events. | 0 |  |
| 18 | keyboard-command | Select both authored nodes | The canvas-owned command selects the two blank-authored nodes. | Pressed Control+A. | 16 |  |
| 19 | observation | Keyboard multi-selection | Ctrl+A is the documented keyboard route for selecting all authored canvas nodes. | The blank-authored Prompt and Note are selected together before duplicate, copy, paste, delete, undo, and redo. | 0 |  |
| 20 | keyboard-command | Duplicate the keyboard selection | Duplicate creates two offset graph nodes without opening an editor. | Pressed Control+D. | 34 |  |
| 21 | keyboard-command | Copy the duplicated selection | Copy retains the selected graph subgraph for the ordinary clipboard command. | Pressed Control+C. | 10 |  |
| 22 | keyboard-command | Paste the graph selection | Paste creates fresh graph identities through the canvas command. | Pressed Control+V. | 33 |  |
| 23 | keyboard-command | Delete the pasted selection | Delete removes only the current selection and reports the mutation through the polite canvas status. | Pressed Delete. | 25 |  |
| 24 | keyboard-command | Undo the keyboard delete | Undo restores the pasted selection. | Pressed Control+Z. | 30 |  |
| 25 | keyboard-command | Redo the keyboard delete | Redo reapplies the deletion without losing canvas focus. | Pressed Control+Y. | 34 |  |
| 26 | observation | Restore the edited Prompt selection | The target is reached from the actual current focus using keyboard traversal only. | Reached Keyboard brief with 4 Tab key events. | 0 |  |
| 27 | keyboard-command | Restore the edited Prompt selection | The renamed Prompt is selected for its keyboard-accessible Inspector help. | Pressed Space. | 8 |  |
| 28 | observation | Reach Setup help | The target is reached from the actual current focus using keyboard traversal only. | Reached Setup help with 29 Tab key events. | 0 |  |
| 29 | keyboard-command | Dismiss the focused Setup tooltip | Escape closes the focus tooltip without changing graph selection. | Pressed Escape. | 2 |  |
| 30 | observation | Open keyboard reference from its focused toolbar control | The target is reached from the actual current focus using keyboard traversal only. | Reached Keyboard and pointer reference with 62 Tab key events. | 0 |  |
| 31 | keyboard-command | Open keyboard reference from its focused toolbar control | Enter opens the keyboard-help modal and transfers focus inside it. | Pressed Enter. | 12 |  |
| 32 | keyboard-command | Close keyboard reference | Escape closes the modal and returns focus to its toolbar trigger. | Pressed Escape. | 3 |  |
| 33 | observation | Keyboard-only J03 subset | The fresh packaged document was authored, edited, multi-selected, duplicated, copied, pasted, deleted, undone, and redone using keyboard focus and real key events. | Library Tab/Enter, canvas N/Enter, F2/Enter, Ctrl+A multi-selection, graph shortcuts, a focus tooltip, reduced-motion CSS targets, and modal Escape focus return all remained available. Pointer-only marquee and move are outside this keyboard subset. | 0 |  |
| 34 | screenshot | Capture keyboard-only authoring state | The packaged blank-authored canvas visibly retains the renamed node after keyboard-only commands. | Captured after the documented preceding action. | 158 | screenshots/01-keyboard-authoring.png |

## Captured errors

| Source | Message |
| --- | --- |
| none | No captured errors |
