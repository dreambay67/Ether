# authoring-baseline action log

- Mode: packaged
- Outcome: failed
- Git commit: 4f78afa3a4e658e281823677ec496f2d13fdf964
- Profile: fresh-isolated; APPDATA, LOCALAPPDATA, and userData isolated
- Viewport: 1280×720; scale 1
- Started: 2026-08-02T18:57:35.859Z
- Finished: 2026-08-02T18:57:44.912Z

## Build identity

- release/windows/win-unpacked/Ether.exe: ad8489e8d5fac5ced6c0923c569d062f1c5a3a3644fefdf1464b78f69388ddff
- release/windows/win-unpacked/resources/app.asar: 9579a9f479dc16ae92fb9d994ae74e14edca71446595ad3ac4a973ff597d3dbc

## Actions

| # | Input | Action | Expected | Actual | ms | Screenshot |
| --- | --- | --- | --- | --- | ---: | --- |
| 1 | observation | BL-01 node discovery | A blank document exposes only Prompt and Image authoring tools rather than the 17-node Node Library. | Visible tool rail: Prompt, Image, Refresh, Recipes. | 0 |  |
| 2 | screenshot | Capture 01-blank-authoring-tools | Blank-document Build tools are visible after ordinary bootstrap. | Captured after the documented preceding action. | 93 | screenshots/01-blank-authoring-tools.png |
| 3 | left-click | Add Prompt from blank tool rail | A Prompt node is added through the visible UI. | Left click at (91, 313). | 51 |  |
| 4 | screenshot | Capture 02-prompt-created | Prompt creation is captured after the real click. | Captured after the documented preceding action. | 112 | screenshots/02-prompt-created.png |
| 5 | left-click | Add Image from blank tool rail | An Image node is added through the visible UI. | Left click at (91, 354). | 15 |  |
| 6 | screenshot | Capture 03-image-created | Image creation is captured after the real click. | Captured after the documented preceding action. | 114 | screenshots/03-image-created.png |
| 7 | left-drag | Separate the second node with ordinary left drag | The node moves before marquee testing. | Left drag (658, 516) to (978, 576). | 166 |  |
| 8 | screenshot | Capture 04-node-left-drag | The ordinary left drag result is captured. | Captured after the documented preceding action. | 136 | screenshots/04-node-left-drag.png |
| 9 | left-marquee | Select the first node with a left marquee | The ordinary left marquee selects its node. | Left drag (326, 280) to (878, 646). | 139 |  |
| 10 | screenshot | Capture 05-left-marquee | The left-marquee result is captured. | Captured after the documented preceding action. | 156 | screenshots/05-left-marquee.png |
| 11 | shift-marquee | Add the second node with Shift marquee | Shift marquee preserves the first selection and adds the second. | Shift+left drag (662, 372) to (1012, 646). | 117 |  |
| 12 | screenshot | Capture 06-shift-marquee | The Shift-marquee result is captured. | Captured after the documented preceding action. | 113 | screenshots/06-shift-marquee.png |
| 13 | right-drag-pan | Pan with a right drag | Canvas pans without changing the current node selection or opening a context menu. | Right drag (244, 582) to (364, 536). | 90 |  |
| 14 | screenshot | Capture 07-right-drag-pan | The right-drag pan result is captured. | Captured after the documented preceding action. | 96 | screenshots/07-right-drag-pan.png |
| 15 | observation | BL-02 marquee and pointer | Ordinary marquee/pointer ownership is unreliable; Shift marquee does not reliably add to the current selection. | Left marquee selected 1; Shift marquee selected 2. | 0 |  |
| 16 | screenshot | Capture 08-marquee-observation | The recorded marquee observation is captured. | Captured after the documented preceding action. | 92 | screenshots/08-marquee-observation.png |
| 17 | keyboard-command | Try Ctrl+D graph duplicate | A selected graph object duplicates with a visible offset. | Pressed Control+D. | 4 |  |
| 18 | screenshot | Capture 09-shortcut-duplicate | The Ctrl+D result is captured. | Captured after the documented preceding action. | 88 | screenshots/09-shortcut-duplicate.png |
| 19 | keyboard-command | Try Ctrl+C graph copy | The selected graph object enters the graph clipboard. | Pressed Control+C. | 5 |  |
| 20 | screenshot | Capture 10-shortcut-copy | The Ctrl+C result is captured. | Captured after the documented preceding action. | 94 | screenshots/10-shortcut-copy.png |
| 21 | keyboard-command | Try Ctrl+V graph paste | The graph clipboard pastes a duplicate selection. | Pressed Control+V. | 15 |  |
| 22 | screenshot | Capture 11-shortcut-paste | The Ctrl+V result is captured. | Captured after the documented preceding action. | 96 | screenshots/11-shortcut-paste.png |
| 23 | keyboard-command | Try Delete graph command | Selected graph objects are removed with graph-aware behavior. | Pressed Delete. | 3 |  |
| 24 | screenshot | Capture 12-shortcut-delete | The Delete result is captured. | Captured after the documented preceding action. | 94 | screenshots/12-shortcut-delete.png |
| 25 | keyboard-command | Try Ctrl+Z graph undo | The last graph mutation is undone. | Pressed Control+Z. | 4 |  |
| 26 | screenshot | Capture 13-shortcut-undo | The Ctrl+Z result is captured. | Captured after the documented preceding action. | 94 | screenshots/13-shortcut-undo.png |
| 27 | observation | BL-03 graph shortcuts | Ctrl+D, clipboard, Delete, and undo do not provide graph-aware commands when canvas input owns the interaction. | Node counts before/after Ctrl+D/Ctrl+V/Delete/Ctrl+Z: 2/2/2/2/2. | 0 |  |
| 28 | screenshot | Capture 14-shortcut-observation | The recorded shortcut observation is captured. | Captured after the documented preceding action. | 100 | screenshots/14-shortcut-observation.png |
| 29 | inline-text-edit | Edit primary Prompt content inline | The primary authored prompt content enters an inline editor and receives keyboard text. | No inline editor appeared after a real double click. | 13 |  |
| 30 | screenshot | Capture 15-inline-primary-content | The inline-primary-content result is captured. | Captured after the documented preceding action. | 99 | screenshots/15-inline-primary-content.png |
| 31 | observation | BL-04 direct primary-content edit | Double-clicking primary node content does not expose a direct canvas editor. | No inline editor appeared for primary content after the real double click. | 0 |  |
| 32 | screenshot | Capture 16-inline-edit-observation | The recorded inline-edit observation is captured. | Captured after the documented preceding action. | 93 | screenshots/16-inline-edit-observation.png |
| 33 | left-marquee | Select multiple nodes for organization | The two nodes are selected before creating an organizational container. | Left drag (434, 257) to (1012, 646). | 96 |  |
| 34 | screenshot | Capture 17-module-selection | The organizational selection result is captured. | Captured after the documented preceding action. | 119 | screenshots/17-module-selection.png |
| 35 | left-click | Try the visible Group command | Only the Module organization journey is exposed to users. | Left click at (437, 283). | 43 |  |
| 36 | screenshot | Capture 18-group-command | The Group command result is captured. | Captured after the documented preceding action. | 127 | screenshots/18-group-command.png |
| 37 | left-click | Try the visible Module command | A selected workflow becomes a locked Module with an organization journey. | Left click at (507, 283). | 14 |  |
| 38 | screenshot | Capture 19-module-command | The Module command result is captured. | Captured after the documented preceding action. | 105 | screenshots/19-module-command.png |
| 39 | observation | BL-05 Groups and Modules | Visual Group remains alongside Module, while the Module surface lacks a locked-by-default organization journey. | Group command visible=true; module cards created=0; visible lock controls=0. | 0 |  |
| 40 | screenshot | Capture 20-groups-modules-observation | The recorded Groups/Modules observation is captured. | Captured after the documented preceding action. | 100 | screenshots/20-groups-modules-observation.png |

## Captured errors

| Source | Message |
| --- | --- |
| none | No captured errors |
