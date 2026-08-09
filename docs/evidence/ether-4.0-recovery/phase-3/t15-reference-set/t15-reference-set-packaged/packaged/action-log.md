# t15-reference-set-packaged action log

- Mode: packaged
- Outcome: failed
- Git commit: 76d4867148b8f1b2ca845021af34a4593e3f9db4
- Profile: fresh-isolated; APPDATA, LOCALAPPDATA, and userData isolated
- Viewport: 1600×1000; scale 1
- Started: 2026-08-09T22:12:23.759Z
- Finished: 2026-08-09T22:12:41.352Z

## Build identity

- release/windows/win-unpacked/Ether.exe: 2d90842c3b03c131567522e8cd9b63b31064cb97fa52d4c1b31bb1d7e19337ec
- release/windows/win-unpacked/resources/app.asar: f1823e2bde697e2cc8fa55add7b1d71be99fb19369e3234ca7599ee6963ae875

## Actions

| # | Input | Action | Expected | Actual | ms | Screenshot |
| --- | --- | --- | --- | --- | ---: | --- |
| 1 | left-click | Add reference.set from Node Library | The blank document creates reference.set through the canonical registry. | Left click at (108, 690). | 62 |  |
| 2 | left-click | Add prompt.worker from Node Library | The blank document creates prompt.worker through the canonical registry. | Left click at (108, 633). | 63 |  |
| 3 | left-click | Select Reference Set | The blank document exposes source controls only after the Reference Set exists. | Left click at (802, 598). | 72 |  |
| 4 | left-click | Link the first local reference | The exact local source is selected through Ether's owned native file picker. | Left click at (1397, 839). | 52 |  |
| 5 | observation | Link the first local reference completed | The owned native Open dialog returned one local image path to Ether. | 01-linked-style.png | 0 |  |
| 6 | left-click | Embed the second local reference | The exact local source is selected through Ether's owned native file picker. | Left click at (1482, 839). | 33 |  |
| 7 | observation | Embed the second local reference completed | The owned native Open dialog returned one local image path to Ether. | 02-embedded-subject.png | 0 |  |
| 8 | left-click | Link the third local reference | The exact local source is selected through Ether's owned native file picker. | Left click at (1397, 839). | 47 |  |
| 9 | observation | Link the third local reference completed | The owned native Open dialog returned one local image path to Ether. | 03-linked-lighting.png | 0 |  |
| 10 | left-click | Select excluded Style reference | The Reference Desk selection carries explicit inclusion and role metadata. | Left click at (37, 241). | 46 |  |
| 11 | left-click | Add the excluded Style reference | Add updates membership explicitly and never replaces the existing source set. | Left click at (1463, 284). | 40 |  |
| 12 | left-click | Select first reference for Replace | The Reference Desk selection carries explicit inclusion and role metadata. | Left click at (37, 241). | 62 |  |
| 13 | left-click | Select embedded Subject reference for Replace | The Reference Desk selection carries explicit inclusion and role metadata. | Left click at (37, 241). | 38 |  |
| 14 | left-click | Replace with the explicit two-reference set | Replace removes the unselected third reference only after the explicit action. | Left click at (1537, 284). | 31 |  |
| 15 | left-click | Select third reference for explicit Add | The Reference Desk selection carries explicit inclusion and role metadata. | Left click at (37, 241). | 32 |  |
| 16 | left-click | Add the third reference after Replace | Add restores the third reference at the end of manual membership order. | Left click at (1463, 284). | 37 |  |
| 17 | left-click | Begin Reference Set image input to Worker | The compatible Image input handle becomes the intended receiver. | Left click at (913, 613). | 244 |  |
| 18 | left-click | Complete Reference Set image input to Worker | The Reference Set image lane persists through ordinary canvas input. | Left click at (431, 433). | 306 |  |
| 19 | left-click | Open the Reference Set lane roles | The downstream Worker receives a deliberate semantic role, separate from member-level overrides. | Left click at (672, 523). | 108 |  |
| 20 | left-click | Set the Reference Set lane role to Style | The persisted image lane visibly carries the Style role. | Left click at (592, 631). | 65 |  |
| 21 | left-click | Select Worker for provider-safe preview | The Worker receives the enabled Reference Set image members without running a provider. | Left click at (542, 419). | 62 |  |
| 22 | left-click | Save the offline Worker route | The preview is limited to the recovery-only deterministic Worker capability. | Left click at (1442, 638). | 63 |  |
| 23 | left-click | Preview the immutable Reference Set Worker input | Preview seals the currently enabled members and does not start a provider call. | Left click at (1407, 741). | 104 |  |

## Captured errors

| Source | Message |
| --- | --- |
| none | No captured errors |
