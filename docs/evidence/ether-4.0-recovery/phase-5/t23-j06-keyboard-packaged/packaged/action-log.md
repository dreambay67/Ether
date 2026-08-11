# t23-j06-keyboard-packaged action log

- Mode: packaged
- Outcome: passed
- Git commit: cee52084d5e423960c60311779767586d4c167c5
- Profile: fresh-isolated; APPDATA, LOCALAPPDATA, and userData isolated
- Viewport: 1440×900; scale 1
- Started: 2026-08-11T10:38:32.549Z
- Finished: 2026-08-11T10:38:53.445Z

## Build identity

- release/windows/win-unpacked/Ether.exe: e2f8c25e63420e646c6d588ff83cc16bac2f4affd1dec7d3416370d653e747e8
- release/windows/win-unpacked/resources/app.asar: e959f707a6d36e9004cc70e66030ceb7e39d1be612462481876db37388f889d3

## Actions

| # | Input | Action | Expected | Actual | ms | Screenshot |
| --- | --- | --- | --- | --- | ---: | --- |
| 1 | observation | Initial keyboard focus | The keyboard-only J06 route starts from the application's actual current focus. | body | 0 |  |
| 2 | observation | Reach the Library search | The target is reached from the actual current focus using keyboard traversal only. | Reached  with 27 Tab key events. | 0 |  |
| 3 | keyboard-command | Select the Library query | The focused Library search owns the select-all shortcut, not the canvas graph. | Pressed Control+A. | 4 |  |
| 4 | observation | Filter Library for Prompt | The Library narrows using text typed through its keyboard-reached search field. | Typed 6 characters through the active keyboard target. | 0 |  |
| 5 | observation | Add Prompt from the Library | The target is reached from the actual current focus using keyboard traversal only. | Reached Add Prompt with 1 Tab key event. | 0 |  |
| 6 | keyboard-command | Add Prompt from the Library | Enter creates the canonical node through the ordinary Library command. | Pressed Enter. | 52 |  |
| 7 | observation | Reach the Library search | The target is reached from the actual current focus using keyboard traversal only. | Reached  with 75 Tab key events. | 0 |  |
| 8 | keyboard-command | Select the Library query | The focused Library search owns the select-all shortcut, not the canvas graph. | Pressed Control+A. | 4 |  |
| 9 | observation | Filter Library for Worker | The Library narrows using text typed through its keyboard-reached search field. | Typed 6 characters through the active keyboard target. | 0 |  |
| 10 | observation | Add Worker from the Library | The target is reached from the actual current focus using keyboard traversal only. | Reached Add Worker with 2 Tab key events. | 0 |  |
| 11 | keyboard-command | Add Worker from the Library | Enter creates the canonical node through the ordinary Library command. | Pressed Enter. | 27 |  |
| 12 | observation | Reach the Library search | The target is reached from the actual current focus using keyboard traversal only. | Reached  with 93 Tab key events. | 0 |  |
| 13 | keyboard-command | Select the Library query | The focused Library search owns the select-all shortcut, not the canvas graph. | Pressed Control+A. | 3 |  |
| 14 | observation | Filter Library for Worker | The Library narrows using text typed through its keyboard-reached search field. | Typed 6 characters through the active keyboard target. | 0 |  |
| 15 | observation | Add Worker from the Library | The target is reached from the actual current focus using keyboard traversal only. | Reached Add Worker with 3 Tab key events. | 0 |  |
| 16 | keyboard-command | Add Worker from the Library | Enter creates the canonical node through the ordinary Library command. | Pressed Enter. | 49 |  |
| 17 | observation | Reach the Library search | The target is reached from the actual current focus using keyboard traversal only. | Reached  with 105 Tab key events. | 0 |  |
| 18 | keyboard-command | Select the Library query | The focused Library search owns the select-all shortcut, not the canvas graph. | Pressed Control+A. | 3 |  |
| 19 | observation | Filter Library for Image Generator | The Library narrows using text typed through its keyboard-reached search field. | Typed 15 characters through the active keyboard target. | 0 |  |
| 20 | observation | Add Image Generator from the Library | The target is reached from the actual current focus using keyboard traversal only. | Reached Add Image Generator with 3 Tab key events. | 0 |  |
| 21 | keyboard-command | Add Image Generator from the Library | Enter creates the canonical node through the ordinary Library command. | Pressed Enter. | 39 |  |
| 22 | observation | Begin Prompt to Worker A | The target is reached from the actual current focus using keyboard traversal only. | Reached Text output with 21 Tab key events. | 0 |  |
| 23 | keyboard-command | Begin Prompt to Worker A | Enter begins a keyboard-owned connection intent from the source channel. | Pressed Enter. | 5 |  |
| 24 | observation | Complete Prompt to Worker A | The target is reached from the actual current focus using keyboard traversal only. | Reached Text input with 2 Tab key events. | 0 |  |
| 25 | keyboard-command | Complete Prompt to Worker A | Space completes the compatible connection through the ordinary canvas interaction. | Pressed Space. | 45 |  |
| 26 | observation | Begin Worker A to Worker B | The target is reached from the actual current focus using keyboard traversal only. | Reached Text output with 9 Tab key events. | 0 |  |
| 27 | keyboard-command | Begin Worker A to Worker B | Enter begins a keyboard-owned connection intent from the source channel. | Pressed Enter. | 5 |  |
| 28 | observation | Complete Worker A to Worker B | The target is reached from the actual current focus using keyboard traversal only. | Reached Text input with 2 Tab key events. | 0 |  |
| 29 | keyboard-command | Complete Worker A to Worker B | Space completes the compatible connection through the ordinary canvas interaction. | Pressed Space. | 46 |  |
| 30 | observation | Begin Worker B to Image Generator | The target is reached from the actual current focus using keyboard traversal only. | Reached Text output with 9 Tab key events. | 0 |  |
| 31 | keyboard-command | Begin Worker B to Image Generator | Enter begins a keyboard-owned connection intent from the source channel. | Pressed Enter. | 5 |  |
| 32 | observation | Complete Worker B to Image Generator | The target is reached from the actual current focus using keyboard traversal only. | Reached Text input with 2 Tab key events. | 0 |  |
| 33 | keyboard-command | Complete Worker B to Image Generator | Space completes the compatible connection through the ordinary canvas interaction. | Pressed Space. | 43 |  |
| 34 | observation | Open the active lane role grid | The target is reached from the actual current focus using keyboard traversal only. | Reached General• with 72 Tab key events. | 0 |  |
| 35 | keyboard-command | Open the active lane role grid | Space opens the keyboard-reachable role grid for the newly created connection. | Pressed Space. | 5 |  |
| 36 | observation | Reach Project Lens Connection role | The target is reached from the actual current focus using keyboard traversal only. | Reached Connection role with 70 Tab key events. | 0 |  |
| 37 | observation | Choose the Subject role | The target is reached from the actual current focus using keyboard traversal only. | Reached Subject with 58 Tab key events. | 0 |  |
| 38 | keyboard-command | Choose the Subject role | Enter assigns the visible semantic Subject role without pointer input. | Pressed Enter. | 51 |  |
| 39 | observation | Keyboard role grid and Project Lens | The lane role grid and selected Edge Inspector are reached through Tab and Enter after keyboard-created connection intent. | The active Text lane now exposes Subject; Project Lens exposes source channel, target channel, connection role, and output-selection controls for the selected edge. | 0 |  |
| 40 | observation | Select Worker A | The target is reached from the actual current focus using keyboard traversal only. | Reached Worker 1 with 19 Tab key events. | 0 |  |
| 41 | keyboard-command | Select Worker A | Space selects Worker A through a tab-reached node title. | Pressed Space. | 12 |  |
| 42 | observation | Reach Worker A instruction | The target is reached from the actual current focus using keyboard traversal only. | Reached Worker instruction with 35 Tab key events. | 0 |  |
| 43 | keyboard-command | Select Worker A instruction | Ctrl+A remains inside the focused Worker instruction field. | Pressed Control+A. | 3 |  |
| 44 | observation | Type Worker A instruction | The Worker instruction is authored through the keyboard-reached Inspector textarea. | Typed 56 characters through the active keyboard target. | 0 |  |
| 45 | observation | Set Worker A result handling | The target is reached from the actual current focus using keyboard traversal only. | Reached Worker result handling with 5 Tab key events. | 0 |  |
| 46 | keyboard-command | Set Worker A result handling: first option | Home places the native select at its first available option. | Pressed Home. | 1 |  |
| 47 | keyboard-command | Set Worker A result handling: option 1 | ArrowDown advances the native select through its visible option order. | Pressed ArrowDown. | 4 |  |
| 48 | observation | Save Worker A | The target is reached from the actual current focus using keyboard traversal only. | Reached Save worker with 1 Tab key event. | 0 |  |
| 49 | keyboard-command | Save Worker A | Enter saves the Worker instruction and auto-apply policy through the ordinary Inspector control. | Pressed Enter. | 42 |  |
| 50 | observation | Select Worker B | The target is reached from the actual current focus using keyboard traversal only. | Reached Worker 2 with 98 Tab key events. | 0 |  |
| 51 | keyboard-command | Select Worker B | Space selects Worker B through a tab-reached node title. | Pressed Space. | 9 |  |
| 52 | observation | Reach Worker B instruction | The target is reached from the actual current focus using keyboard traversal only. | Reached Worker instruction with 23 Tab key events. | 0 |  |
| 53 | keyboard-command | Select Worker B instruction | Ctrl+A remains inside the focused Worker instruction field. | Pressed Control+A. | 3 |  |
| 54 | observation | Type Worker B instruction | The Worker instruction is authored through the keyboard-reached Inspector textarea. | Typed 62 characters through the active keyboard target. | 0 |  |
| 55 | observation | Set Worker B result handling | The target is reached from the actual current focus using keyboard traversal only. | Reached Worker result handling with 5 Tab key events. | 0 |  |
| 56 | keyboard-command | Set Worker B result handling: first option | Home places the native select at its first available option. | Pressed Home. | 2 |  |
| 57 | keyboard-command | Set Worker B result handling: option 1 | ArrowDown advances the native select through its visible option order. | Pressed ArrowDown. | 4 |  |
| 58 | observation | Save Worker B | The target is reached from the actual current focus using keyboard traversal only. | Reached Save worker with 1 Tab key event. | 0 |  |
| 59 | keyboard-command | Save Worker B | Enter saves the Worker instruction and auto-apply policy through the ordinary Inspector control. | Pressed Enter. | 30 |  |
| 60 | observation | Select Image Generator | The target is reached from the actual current focus using keyboard traversal only. | Reached Image Generator 1 with 107 Tab key events. | 0 |  |
| 61 | keyboard-command | Select Image Generator | Space selects the Image Generator through its keyboard-reached title. | Pressed Space. | 10 |  |
| 62 | observation | Choose recovery-only fake-local image profile | The target is reached from the actual current focus using keyboard traversal only. | Reached Provider profile with 15 Tab key events. | 0 |  |
| 63 | keyboard-command | Choose recovery-only fake-local image profile: first option | Home places the native select at its first available option. | Pressed Home. | 7 |  |
| 64 | keyboard-command | Choose recovery-only fake-local image profile: option 1 | ArrowDown advances the native select through its visible option order. | Pressed ArrowDown. | 2 |  |
| 65 | observation | Save fake-local Image profile | The target is reached from the actual current focus using keyboard traversal only. | Reached Save provider settings with 9 Tab key events. | 0 |  |
| 66 | keyboard-command | Save fake-local Image profile | Enter saves the deterministic local image binding; no real provider fallback is used. | Pressed Enter. | 33 |  |
| 67 | observation | Select Worker A for reviewed preview | The target is reached from the actual current focus using keyboard traversal only. | Reached Worker 1 with 76 Tab key events. | 0 |  |
| 68 | keyboard-command | Select Worker A for reviewed preview | Space selects Worker A through its keyboard-reached title. | Pressed Space. | 11 |  |
| 69 | observation | Select Worker A branch scope | The target is reached from the actual current focus using keyboard traversal only. | Reached Run scope with 52 Tab key events. | 0 |  |
| 70 | keyboard-command | Select Worker A branch scope: first option | Home places the native select at its first available option. | Pressed Home. | 1 |  |
| 71 | keyboard-command | Select Worker A branch scope: option 1 | ArrowDown advances the native select through its visible option order. | Pressed ArrowDown. | 4 |  |
| 72 | observation | Preview the fake-local Worker branch | The target is reached from the actual current focus using keyboard traversal only. | Reached Preview plan with 2 Tab key events. | 0 |  |
| 73 | keyboard-command | Preview the fake-local Worker branch | Enter prepares the immutable Worker-to-Image plan before it can start. | Pressed Enter. | 85 |  |
| 74 | observation | Explicitly start the reviewed fake-local plan | The target is reached from the actual current focus using keyboard traversal only. | Reached Start 3 calls with 127 Tab key events. | 0 |  |
| 75 | keyboard-command | Explicitly start the reviewed fake-local plan | Enter grants the one-use permit for the exact displayed plan; no real provider is available to this route. | Pressed Enter. | 49 |  |
| 76 | observation | Open Job Center with the keyboard | The target is reached from the actual current focus using keyboard traversal only. | Reached Run with 29 Tab key events. | 0 |  |
| 77 | keyboard-command | Open Job Center with the keyboard | Enter opens Run workspace where the durable fake-local job can be observed. | Pressed Enter. | 7 |  |
| 78 | observation | Return to Build for output lineage | The target is reached from the actual current focus using keyboard traversal only. | Reached Build with 125 Tab key events. | 0 |  |
| 79 | keyboard-command | Return to Build for output lineage | Enter returns to the authored chain without using a pointer. | Pressed Enter. | 15 |  |
| 80 | observation | Select Image Generator output | The target is reached from the actual current focus using keyboard traversal only. | Reached Image Generator 1 with 107 Tab key events. | 0 |  |
| 81 | keyboard-command | Select Image Generator output | Space selects the completed Image Generator for output inspection. | Pressed Space. | 12 |  |
| 82 | observation | Open Image Generator provenance | The target is reached from the actual current focus using keyboard traversal only. | Reached Version provenance with 30 Tab key events. | 0 |  |
| 83 | keyboard-command | Open Image Generator provenance | Space expands the output's durable selected-input lineage. | Pressed Space. | 2 |  |
| 84 | observation | Keyboard-only J06 chain | A blank Prompt to Worker to Worker to Image chain was created, configured, previewed, explicitly started, and inspected using Tab, Enter, Space, Home, Arrow keys, and typed text only. | The recovery-token-gated fake-local route completed in Job Center and the Image output exposed its selected-input lineage without a real provider request. | 0 |  |
| 85 | screenshot | Capture keyboard-only J06 output lineage | The packaged Image Generator output visibly retains deterministic fake-local provenance after a keyboard-only journey. | Captured after the documented preceding action. | 161 | screenshots/01-keyboard-j06-lineage.png |

## Captured errors

| Source | Message |
| --- | --- |
| none | No captured errors |
