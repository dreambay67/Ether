# a02-windows-jump-list-setup action log

- Mode: packaged
- Outcome: passed
- Git commit: 9d14f93d973db59d6a90d116b7e849ddb084b3ae
- Profile: fresh-isolated; APPDATA, LOCALAPPDATA, and userData isolated
- Viewport: 1280×720; scale 1
- Started: 2026-08-03T04:21:10.802Z
- Finished: 2026-08-03T04:21:18.992Z

## Build identity

- release/windows/win-unpacked/Ether.exe: 03db599dbaec1e6d564275cfb63d568dec0189217237efa3ea5e2e99b482580f
- release/windows/win-unpacked/resources/app.asar: 8cc07d197b636b5104da29ffc295313ed64f82082cf2907566f5cbfedafb0a4e

## Actions

| # | Input | Action | Expected | Actual | ms | Screenshot |
| --- | --- | --- | --- | --- | ---: | --- |
| 1 | left-click | Create the ordinary-recovery Jump List document | The document is authored through the ordinary recovery UI with Recent disabled. | Left click at (91, 313). | 61 |  |
| 2 | keyboard-command | Save ordinary-recovery Jump List setup document | The native picker creates the exact test-owned document before the approved Recent-mode session starts. | Pressed Control+s. | 32 |  |
| 3 | observation | Close ordinary-recovery Jump List setup | The ordinary recovery process exits before S1 is captured and before Recent mode is admitted. | native-keyboard ownerPid=41748 shortcut=Alt+F4 | 0 |  |
| 4 | observation | Capture S1 after ordinary native-save setup | S0 is diagnostic; every S0→S1 shell delta is recorded as OS-native setup and is not restored. | S0→S1 OS-native setup delta (recorded without restoration claim): C:\Users\deny7\AppData\Roaming:CustomDestinations/590aee7bdd69b59b.customDestinations-ms | 0 |  |

## Captured errors

| Source | Message |
| --- | --- |
| none | No captured errors |
