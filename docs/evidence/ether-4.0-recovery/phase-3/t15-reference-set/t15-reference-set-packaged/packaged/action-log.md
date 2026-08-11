# t15-reference-set-packaged action log

- Mode: packaged
- Outcome: passed
- Git commit: 5fddc0a153f7b827878f219527136f9ea402bced
- Profile: fresh-isolated; APPDATA, LOCALAPPDATA, and userData isolated
- Viewport: 1600×1000; scale 1
- Started: 2026-08-11T08:13:45.664Z
- Finished: 2026-08-11T08:13:59.215Z

## Build identity

- release/windows/win-unpacked/Ether.exe: 0ec4253d0d29d12333d459052dbfa9814396e5afcc8b1570d81f4c30c1a2fc47
- release/windows/win-unpacked/resources/app.asar: bb1fe953a7c38e22e55d6ce0994d37da5ac56665f90677fa135caf91673af823

## Actions

| # | Input | Action | Expected | Actual | ms | Screenshot |
| --- | --- | --- | --- | --- | ---: | --- |
| 1 | left-click | Add reference.set from Node Library | The blank document creates reference.set through the canonical registry. | Left click at (108, 690). | 68 |  |
| 2 | left-click | Add prompt.worker from Node Library | The blank document creates prompt.worker through the canonical registry. | Left click at (108, 633). | 59 |  |
| 3 | left-click | Select Reference Set | The blank document exposes source controls only after the Reference Set exists. | Left click at (1062, 799). | 68 |  |
| 4 | left-click | Link the first local reference | The exact local source is selected through Ether's owned native file picker. | Left click at (1397, 903). | 49 |  |
| 5 | observation | Link the first local reference completed | The owned native Open dialog returned one local image path to Ether. | 01-linked-style.png | 0 |  |
| 6 | left-click | Embed the second local reference | The exact local source is selected through Ether's owned native file picker. | Left click at (1482, 903). | 27 |  |
| 7 | observation | Embed the second local reference completed | The owned native Open dialog returned one local image path to Ether. | 02-embedded-subject.png | 0 |  |
| 8 | left-click | Link the third local reference | The exact local source is selected through Ether's owned native file picker. | Left click at (1397, 903). | 42 |  |
| 9 | observation | Link the third local reference completed | The owned native Open dialog returned one local image path to Ether. | 03-linked-lighting.png | 0 |  |
| 10 | left-click | Add the excluded Style reference | Add updates membership explicitly and never replaces the existing source set. | Left click at (1463, 284). | 40 |  |
| 11 | left-click | Deselect third reference for Replace | Replace receives only the two explicitly selected references; Include remains an independent channel-use control. | Left click at (37, 241). | 31 |  |
| 12 | left-click | Replace with the explicit two-reference set | Replace removes the unselected third reference only after the explicit action. | Left click at (1537, 284). | 38 |  |
| 13 | left-click | Select third reference for explicit Add | The Reference Desk selection carries explicit inclusion and role metadata. | Left click at (37, 241). | 29 |  |
| 14 | left-click | Add the third reference after Replace | Add restores the third reference at the end of manual membership order. | Left click at (1463, 284). | 45 |  |
| 15 | left-click | Hide Reference Desk | The two-node graph gets a clear canvas for precise channel authoring. | Left click at (1581, 151). | 46 |  |
| 16 | left-click | Hide Build tools | The two-node graph gets a clear canvas for precise channel authoring. | Left click at (244, 183). | 37 |  |
| 17 | left-click | Hide Project lens | The two-node graph gets a clear canvas for precise channel authoring. | Left click at (1580, 183). | 31 |  |
| 18 | keyboard-command | Fit the Reference Set graph | Both cards and their Image handles fit in the unobstructed canvas. | Pressed Home. | 4 |  |
| 19 | left-click | Begin Reference Set image input to Worker | The compatible Image input handle becomes the intended receiver. | Left click at (1094, 604). | 225 |  |
| 20 | left-click | Complete Reference Set image input to Worker | The Reference Set image lane persists through ordinary canvas input. | Left click at (506, 336). | 252 |  |
| 21 | left-click | Open the Reference Set lane roles | The downstream Worker receives a deliberate semantic role, separate from member-level overrides. | Left click at (800, 774). | 73 |  |
| 22 | left-click | Set the Reference Set lane role to Style | The persisted image lane visibly carries the Style role. | Left click at (702, 906). | 58 |  |
| 23 | left-click | Select Worker for provider-safe preview | The Worker receives the enabled Reference Set image members without running a provider. | Left click at (641, 319). | 59 |  |
| 24 | left-click | Show Project lens for Worker | The selected Worker's concise setup and preview controls return after connection authoring. | Left click at (1584, 183). | 43 |  |
| 25 | left-click | Save the offline Worker route | The preview is limited to the recovery-only deterministic Worker capability. | Left click at (1442, 638). | 55 |  |
| 26 | left-click | Preview the immutable Reference Set Worker input | Preview seals the currently enabled members and does not start a provider call. | Left click at (1407, 741). | 73 |  |
| 27 | screenshot | Capture the sealed Reference Set preview | The ordinary preview shows two enabled members in manual order with Subject and Lighting roles; the excluded Style member and expert IDs stay out of the concise view. | Captured after the documented preceding action. | 151 | screenshots/01-sealed-reference-preview.png |
| 28 | observation | T15 provider-safe Reference Set preview | The blank-authored Worker preview contains the two enabled references only and remains unstarted. | Link, Embed, explicit Add, explicit Replace, manual order, an excluded Style member, and two enabled members were authored through UI; the concise immutable preview showed their names, order, roles, channels, and source kinds on the offline deterministic Worker route. | 0 |  |

## Captured errors

| Source | Message |
| --- | --- |
| main-process | [73716:0811/101358.201:ERROR:content\browser\gpu\gpu_process_host.cc:1089] GPU process exited unexpectedly: exit_code=-1 |
