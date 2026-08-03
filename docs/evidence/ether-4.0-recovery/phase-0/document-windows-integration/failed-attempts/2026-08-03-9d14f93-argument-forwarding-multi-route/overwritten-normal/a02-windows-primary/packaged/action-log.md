# a02-windows-primary action log

- Mode: packaged
- Outcome: passed
- Git commit: 9d14f93d973db59d6a90d116b7e849ddb084b3ae
- Profile: fresh-isolated; APPDATA, LOCALAPPDATA, and userData isolated
- Viewport: 1280×720; scale 1
- Started: 2026-08-03T04:17:35.408Z
- Finished: 2026-08-03T04:17:55.939Z

## Build identity

- release/windows/win-unpacked/Ether.exe: 03db599dbaec1e6d564275cfb63d568dec0189217237efa3ea5e2e99b482580f
- release/windows/win-unpacked/resources/app.asar: 8cc07d197b636b5104da29ffc295313ed64f82082cf2907566f5cbfedafb0a4e

## Actions

| # | Input | Action | Expected | Actual | ms | Screenshot |
| --- | --- | --- | --- | --- | ---: | --- |
| 1 | left-click | Create a document through visible UI | The blank canvas has one UI-authored node before native Save. | Left click at (91, 313). | 41 |  |
| 2 | keyboard-command | Save through the native Windows picker | The exact Ether-owned native Save dialog receives the Unicode/spaces path through UI Automation. | Pressed Control+s. | 69 |  |
| 3 | observation | One-file format identity | The saved document is a single valid Ether document with format/application/schema identity. | Validated Unicode Žltý priestor.ether with inspectEtherDocument. | 0 |  |
| 4 | observation | Recent shortcut snapshot | The pre-setup isolated-profile Recent links are diagnostic only; S1 becomes the first restoration checkpoint after native setup. | Found 0 pre-existing matching isolated-profile Recent shortcuts. | 0 |  |
| 5 | left-click | Save As through the native Windows picker | The UI switches only after the Unicode destination validates. | Left click at (884, 34). | 13 |  |
| 6 | observation | Save As lease rebinding | The source writer lease is released and the destination lease is active under isolated AppData, never beside the document. | Enumerated the document directory and observed active lease root after the completed Save As; recovery remains unclaimed by this clean-save journey. | 0 |  |
| 7 | left-click | Save a Copy through the native Windows picker | A complete Unicode/spaces copy is saved without switching the active Save As document. | Left click at (923, 34). | 11 |  |
| 8 | observation | Save a Copy result | Save a Copy creates a valid second .ether file while the active document remains the Save As destination. | Validated Copy Žltý priestor.ether and retained Save As Žltý priestor.ether as the active title. | 0 |  |
| 9 | observation | File > Open through native picker | A native Ctrl+O sent to the exact packaged Ether window opens its native picker. | native-keyboard ownerPid=35436 shortcut=Ctrl+O | 0 |  |
| 10 | observation | Capture S1 after native primary setup | S0 is diagnostic; every S0→S1 shell delta from native Save, Save As, Copy, and Open is recorded as OS-native setup and is not restored. | S0→S1 OS-native setup delta (recorded without restoration claim): C:\Users\deny7\AppData\Roaming:CustomDestinations/590aee7bdd69b59b.customDestinations-ms | 0 |  |
| 11 | observation | S1 exact target-link checkpoint | Both real and isolated S1 Recent roots contain zero links resolving to the exact random test documents. | S1 matching target links=0. | 0 |  |
| 12 | screenshot | Capture File > Open result | File > Open shows the original Unicode/spaces document. | Captured after the documented preceding action. | 91 | screenshots/01-native-open-unicode.png |
| 13 | observation | Second-instance focus | A separate exact Ether.exe request exits through the single-instance lock and focuses the already-attached primary window for the requested document. | Exact requester 40664 exited after routing Unicode Žltý priestor.ether to the existing primary window. | 0 |  |
| 14 | observation | Clean close after disposable-root cleanup | A native Alt+F4 sent to the exact packaged Ether window closes the Saved document without an unsaved-changes prompt before reopen validation. | native-keyboard ownerPid=35436 shortcut=Alt+F4 | 0 |  |

## Captured errors

| Source | Message |
| --- | --- |
| none | No captured errors |
