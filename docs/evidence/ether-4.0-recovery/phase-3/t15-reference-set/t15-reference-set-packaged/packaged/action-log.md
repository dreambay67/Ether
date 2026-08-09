# t15-reference-set-packaged action log

- Mode: packaged
- Outcome: failed
- Git commit: 87efa2da9cc28f60a43356c66ae0836e3f77c78a
- Profile: fresh-isolated; APPDATA, LOCALAPPDATA, and userData isolated
- Viewport: 1600×1000; scale 1
- Started: 2026-08-09T11:15:17.799Z
- Finished: 2026-08-09T11:15:33.982Z

## Build identity

- release/windows/win-unpacked/Ether.exe: 3a6e5a193cb1e0e42672a3789a950b72907c87bb3b6a20bfd330de2dd9744169
- release/windows/win-unpacked/resources/app.asar: 6b375f8eecd9206b11ac4e5120b8eb3653c641f0903554331c296bad7579f44f

## Actions

| # | Input | Action | Expected | Actual | ms | Screenshot |
| --- | --- | --- | --- | --- | ---: | --- |
| 1 | left-click | Add reference.set from Node Library | The blank document creates reference.set through the canonical registry. | Left click at (108, 690). | 91 |  |
| 2 | left-click | Add prompt.worker from Node Library | The blank document creates prompt.worker through the canonical registry. | Left click at (108, 633). | 61 |  |
| 3 | left-click | Select Reference Set | The blank document exposes source controls only after the Reference Set exists. | Left click at (802, 598). | 50 |  |
| 4 | left-click | Link the first local reference | The exact local source is selected through Ether's owned native file picker. | Left click at (1397, 839). | 41 |  |
| 5 | observation | Link the first local reference completed | The owned native Open dialog returned one local image path to Ether. | 01-linked-style.png | 0 |  |
| 6 | left-click | Embed the second local reference | The exact local source is selected through Ether's owned native file picker. | Left click at (1482, 839). | 29 |  |
| 7 | observation | Embed the second local reference completed | The owned native Open dialog returned one local image path to Ether. | 02-embedded-subject.png | 0 |  |
| 8 | left-click | Link the third local reference | The exact local source is selected through Ether's owned native file picker. | Left click at (1397, 839). | 23 |  |
| 9 | observation | Link the third local reference completed | The owned native Open dialog returned one local image path to Ether. | 03-linked-lighting.png | 0 |  |
| 10 | left-click | Select excluded Style reference | The Reference Desk selection carries explicit inclusion and role metadata. | Left click at (37, 241). | 29 |  |
| 11 | left-click | Add the excluded Style reference | Add updates membership explicitly and never replaces the existing source set. | Left click at (1463, 284). | 77 |  |

## Captured errors

| Source | Message |
| --- | --- |
| none | No captured errors |
