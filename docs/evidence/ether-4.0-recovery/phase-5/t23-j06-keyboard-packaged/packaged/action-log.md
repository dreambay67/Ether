# t23-j06-keyboard-packaged action log

- Mode: packaged
- Outcome: failed
- Git commit: 2dd2fd54e60e421386f9bba92b8d331fbd46b748
- Profile: fresh-isolated; APPDATA, LOCALAPPDATA, and userData isolated
- Viewport: 1440×900; scale 1
- Started: 2026-08-09T15:25:36.032Z
- Finished: 2026-08-09T15:25:48.642Z

## Build identity

- release/windows/win-unpacked/Ether.exe: 2d90842c3b03c131567522e8cd9b63b31064cb97fa52d4c1b31bb1d7e19337ec
- release/windows/win-unpacked/resources/app.asar: f1823e2bde697e2cc8fa55add7b1d71be99fb19369e3234ca7599ee6963ae875

## Actions

| # | Input | Action | Expected | Actual | ms | Screenshot |
| --- | --- | --- | --- | --- | ---: | --- |
| 1 | observation | Initial keyboard focus | The keyboard-only J06 route starts from the application's actual current focus. | body | 0 |  |
| 2 | observation | Reach the Library search | The target is reached from the actual current focus using keyboard traversal only. | Reached  with 27 Tab key events. | 0 |  |
| 3 | keyboard-command | Select the Library query | The focused Library search owns the select-all shortcut, not the canvas graph. | Pressed Control+A. | 3 |  |
| 4 | observation | Filter Library for Prompt | The Library narrows using text typed through its keyboard-reached search field. | Typed 6 characters through the active keyboard target. | 0 |  |
| 5 | observation | Add Prompt from the Library | The target is reached from the actual current focus using keyboard traversal only. | Reached Add Prompt with 1 Tab key event. | 0 |  |
| 6 | keyboard-command | Add Prompt from the Library | Enter creates the canonical node through the ordinary Library command. | Pressed Enter. | 51 |  |
| 7 | observation | Reach the Library search | The target is reached from the actual current focus using keyboard traversal only. | Reached  with 57 Tab key events. | 0 |  |
| 8 | keyboard-command | Select the Library query | The focused Library search owns the select-all shortcut, not the canvas graph. | Pressed Control+A. | 4 |  |
| 9 | observation | Filter Library for Worker | The Library narrows using text typed through its keyboard-reached search field. | Typed 6 characters through the active keyboard target. | 0 |  |
| 10 | observation | Add Worker from the Library | The target is reached from the actual current focus using keyboard traversal only. | Reached Add Worker with 2 Tab key events. | 0 |  |
| 11 | keyboard-command | Add Worker from the Library | Enter creates the canonical node through the ordinary Library command. | Pressed Enter. | 34 |  |
| 12 | observation | Reach the Library search | The target is reached from the actual current focus using keyboard traversal only. | Reached  with 63 Tab key events. | 0 |  |
| 13 | keyboard-command | Select the Library query | The focused Library search owns the select-all shortcut, not the canvas graph. | Pressed Control+A. | 3 |  |
| 14 | observation | Filter Library for Worker | The Library narrows using text typed through its keyboard-reached search field. | Typed 6 characters through the active keyboard target. | 0 |  |
| 15 | observation | Add Worker from the Library | The target is reached from the actual current focus using keyboard traversal only. | Reached Add Worker with 3 Tab key events. | 0 |  |
| 16 | keyboard-command | Add Worker from the Library | Enter creates the canonical node through the ordinary Library command. | Pressed Enter. | 26 |  |
| 17 | observation | Reach the Library search | The target is reached from the actual current focus using keyboard traversal only. | Reached  with 75 Tab key events. | 0 |  |
| 18 | keyboard-command | Select the Library query | The focused Library search owns the select-all shortcut, not the canvas graph. | Pressed Control+A. | 4 |  |
| 19 | observation | Filter Library for Image Generator | The Library narrows using text typed through its keyboard-reached search field. | Typed 15 characters through the active keyboard target. | 0 |  |
| 20 | observation | Add Image Generator from the Library | The target is reached from the actual current focus using keyboard traversal only. | Reached Add Image Generator with 3 Tab key events. | 0 |  |
| 21 | keyboard-command | Add Image Generator from the Library | Enter creates the canonical node through the ordinary Library command. | Pressed Enter. | 27 |  |
| 22 | observation | Begin Prompt to Worker A | The target is reached from the actual current focus using keyboard traversal only. | Reached Text output with 17 Tab key events. | 0 |  |
| 23 | keyboard-command | Begin Prompt to Worker A | Enter begins a keyboard-owned connection intent from the source channel. | Pressed Enter. | 11 |  |

## Captured errors

| Source | Message |
| --- | --- |
| none | No captured errors |
