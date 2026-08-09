# t23-keyboard-packaged action log

- Mode: packaged
- Outcome: failed
- Git commit: 2dd2fd54e60e421386f9bba92b8d331fbd46b748
- Profile: fresh-isolated; APPDATA, LOCALAPPDATA, and userData isolated
- Viewport: 1440×900; scale 1
- Started: 2026-08-09T15:25:49.587Z
- Finished: 2026-08-09T15:26:02.908Z

## Build identity

- release/windows/win-unpacked/Ether.exe: 2d90842c3b03c131567522e8cd9b63b31064cb97fa52d4c1b31bb1d7e19337ec
- release/windows/win-unpacked/resources/app.asar: f1823e2bde697e2cc8fa55add7b1d71be99fb19369e3234ca7599ee6963ae875

## Actions

| # | Input | Action | Expected | Actual | ms | Screenshot |
| --- | --- | --- | --- | --- | ---: | --- |
| 1 | observation | Initial keyboard focus | Keyboard traversal begins from the application's actual initial active element. | body | 0 |  |
| 2 | observation | Reach the Library search | The target is reached from the actual current focus using keyboard traversal only. | Reached  with 27 Tab key events. | 0 |  |
| 3 | keyboard-command | Select the Library query | The focused Library search owns the select-all shortcut, not the canvas graph. | Pressed Control+A. | 3 |  |
| 4 | observation | Filter Library for Prompt | The Library narrows using text typed through its keyboard-reached search field. | Typed 6 characters through the active keyboard target. | 0 |  |
| 5 | observation | Add Prompt from the Library | The target is reached from the actual current focus using keyboard traversal only. | Reached Add Prompt with 1 Tab key event. | 0 |  |
| 6 | keyboard-command | Add Prompt from the Library | Enter creates the canonical node through the ordinary Library command. | Pressed Enter. | 39 |  |
| 7 | observation | Reach the authoring canvas | The target is reached from the actual current focus using keyboard traversal only. | Reached Authoring canvas with 15 Tab key events. | 0 |  |
| 8 | keyboard-command | Open canvas quick add | N opens the searchable node palette while the canvas owns focus. | Pressed N. | 16 |  |
| 9 | observation | Filter quick add for Note | Quick add filters with text typed into its product-owned autofocus field. | Typed 4 characters through the active keyboard target. | 0 |  |
| 10 | keyboard-command | Insert Note from quick add | Enter inserts the active matching canonical node and returns focus to the canvas. | Pressed Enter. | 30 |  |

## Captured errors

| Source | Message |
| --- | --- |
| none | No captured errors |
