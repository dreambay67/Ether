# module-authoring-recovery action log

- Mode: packaged
- Outcome: passed
- Git commit: bae08cceaf90112c3f69b3d1711793cbff74de12
- Profile: fresh-isolated; APPDATA, LOCALAPPDATA, and userData isolated
- Viewport: 1600×1000; scale 1
- Started: 2026-08-09T09:14:26.237Z
- Finished: 2026-08-09T09:14:37.930Z

## Build identity

- release/windows/win-unpacked/Ether.exe: f7a671203536844320f62777e9294d0ef09cbc2309ce0470a65ceeb87aceaea4
- release/windows/win-unpacked/resources/app.asar: 41ef1bc200b963ec648131c122e2e6bf21032e856846b9867788bcb9748a835d

## Actions

| # | Input | Action | Expected | Actual | ms | Screenshot |
| --- | --- | --- | --- | --- | ---: | --- |
| 1 | left-click | Add prompt.text from Node Library | The blank document creates prompt.text through the registry-backed factory. | Left click at (108, 498). | 159 |  |
| 2 | left-click | Add prompt.worker from Node Library | The blank document creates prompt.worker through the registry-backed factory. | Left click at (108, 633). | 136 |  |
| 3 | keyboard-command | Select the workflow for a Module | The canvas-owned select-all command selects both blank-authored nodes before organization. | Pressed Control+A. | 21 |  |
| 4 | left-click | Create Module from selection | The visible command moves the selection into one locked, durable Module through the shared graph command. | Left click at (578, 328). | 271 |  |
| 5 | observation | Locked by default | New Modules protect their contents and position until explicitly unlocked. | The new Module replaced both parent nodes and reported data-module-locked=true. | 0 |  |
| 6 | screenshot | Capture locked Module creation | A blank-authored selection is visibly represented as Ether's single locked organizational container. | Captured after the documented preceding action. | 462 | screenshots/01-locked-module-created.png |
| 7 | left-drag | Try to move the locked Module | A locked Module remains fixed on the parent canvas. | Left drag (672, 524) to (852, 614). | 101 |  |
| 8 | left-click | Select the Module | The Project lens switches to the Module inspector. | Left click at (475, 371). | 37 |  |
| 9 | keyboard-command | Focus Module rename | F2 targets the selected Module title field. | Pressed F2. | 5 |  |
| 10 | left-click | Choose the Module highlight | The Module uses a deliberate Violet accent. | Left click at (1525, 680). | 32 |  |
| 11 | left-click | Save Module details | Title, description, and accent commit together. | Left click at (1409, 765). | 199 |  |
| 12 | left-click | Explicitly unlock the Module | Parent-canvas movement and membership controls become available only after this action. | Left click at (1419, 806). | 178 |  |
| 13 | left-drag | Move the unlocked Module | The explicitly unlocked Module can be repositioned on the parent canvas. | Left drag (672, 524) to (842, 594). | 322 |  |
| 14 | left-click | Restore Module selection | The moved Module remains the current organization target. | Left click at (659, 433). | 26 |  |
| 15 | left-click | Collapse the Module | Collapse compacts presentation without deleting its internal graph. | Left click at (1504, 908). | 183 |  |
| 16 | screenshot | Capture edited collapsed Module | The Module visibly carries its title, description, Violet highlight, unlocked state, and compact presentation. | Captured after the documented preceding action. | 184 | screenshots/02-module-details-and-collapse.png |
| 17 | left-click | Expand the Module | The full Module presentation returns with its durable metadata. | Left click at (1045, 496). | 214 |  |
| 18 | left-click | Select Module for keyboard entry | Canvas focus can enter the selected Module through the primary edit shortcut. | Left click at (659, 433). | 58 |  |
| 19 | keyboard-command | Enter the Module | Enter opens the Module's independently editable internal graph. | Pressed Enter. | 175 |  |
| 20 | screenshot | Capture Module interior | Both original blank-authored members are visible inside the Module workspace. | Captured after the documented preceding action. | 186 | screenshots/03-module-interior.png |
| 21 | left-click | Select one Module member | One internal member becomes the membership change target. | Left click at (965, 746). | 34 |  |
| 22 | left-click | Move a member to the parent | Unlocked membership editing moves the selected node out without recreating it. | Left click at (1244, 426). | 54 |  |
| 23 | left-click | Leave the Module | The parent viewport and Module selection are restored. | Left click at (1247, 380). | 209 |  |
| 24 | left-click | Select the parent node | The moved member is selected for reassignment. | Left click at (965, 746). | 43 |  |
| 25 | left-click | Add the Module to the selection context | Shift-click preserves the selected parent node while opening Module membership controls. | Left click at (600, 422). | 53 |  |
| 26 | left-click | Add the selected node to the Module | The existing node returns to the Module through the explicit membership command. | Left click at (1444, 797). | 48 |  |
| 27 | observation | Durable membership | Members move across the parent/Module boundary without duplicate identities or hidden leftovers. | The internal count changed 2 -> 1 -> 2 while the parent count changed 0 -> 1 -> 0. | 0 |  |
| 28 | left-click | Relock the Module | The completed organization is protected again explicitly. | Left click at (1418, 639). | 187 |  |
| 29 | screenshot | Capture relocked membership | The two-member Module is visibly relocked after a complete membership round trip. | Captured after the documented preceding action. | 224 | screenshots/04-module-membership-relocked.png |
| 30 | left-click | Unlock before dissolution | Dissolution remains a deliberate action unavailable while locked. | Left click at (1419, 639). | 175 |  |
| 31 | left-click | Confirm Module dissolution | Dissolve restores both members to the parent in one undoable transaction. | Left click at (1427, 873). | 22 |  |
| 32 | screenshot | Capture dissolved Module | Both original members are restored to the parent canvas with no Module shell left behind. | Captured after the documented preceding action. | 138 | screenshots/05-dissolved-members.png |
| 33 | keyboard-command | Undo Module dissolution | Undo restores the Module and removes the restored parent copies atomically. | Pressed Control+Z. | 145 |  |
| 34 | left-click | Inspect the restored Module | Undo preserves the Module metadata and explicit lock state from immediately before dissolution. | Left click at (600, 422). | 29 |  |
| 35 | left-click | Relock the restored Module | The practical journey ends with the recovered organization protected. | Left click at (1418, 806). | 191 |  |
| 36 | screenshot | Capture dissolution undo | Undo visibly restores the named two-member Module, ready in its protected state. | Captured after the documented preceding action. | 176 | screenshots/06-dissolve-undone.png |

## Captured errors

| Source | Message |
| --- | --- |
| none | No captured errors |
