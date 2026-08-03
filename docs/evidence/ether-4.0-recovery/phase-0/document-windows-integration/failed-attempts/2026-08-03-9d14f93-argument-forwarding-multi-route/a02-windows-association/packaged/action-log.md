# a02-windows-association action log

- Mode: packaged
- Outcome: failed
- Git commit: 9d14f93d973db59d6a90d116b7e849ddb084b3ae
- Profile: fresh-isolated; APPDATA, LOCALAPPDATA, and userData isolated
- Viewport: 1280×720; scale 1
- Started: 2026-08-03T04:18:03.657Z
- Finished: 2026-08-03T04:18:38.685Z

## Build identity

- release/windows/win-unpacked/Ether.exe: 03db599dbaec1e6d564275cfb63d568dec0189217237efa3ea5e2e99b482580f
- release/windows/win-unpacked/resources/app.asar: 8cc07d197b636b5104da29ffc295313ed64f82082cf2907566f5cbfedafb0a4e

## Actions

| # | Input | Action | Expected | Actual | ms | Screenshot |
| --- | --- | --- | --- | --- | ---: | --- |
| 1 | left-click | Create a test-owned association document | A visible blank-UI node is saved before Explorer invokes the association. | Left click at (91, 313). | 54 |  |
| 2 | keyboard-command | Save association document through native picker | The association target is a unique test-owned .ether document. | Pressed Control+s. | 25 |  |
| 3 | observation | Capture S1 after native association setup | S0 is diagnostic; every S0→S1 shell delta is recorded as OS-native setup and is not restored. | S0→S1 OS-native setup delta (recorded without restoration claim): C:\Users\deny7\AppData\Roaming:CustomDestinations/590aee7bdd69b59b.customDestinations-ms | 0 |  |
| 4 | observation | S1 exact target-link checkpoint | Both real and isolated S1 Recent roots contain zero links resolving to the exact association document. | S1 matching target links=0. | 0 |  |
| 5 | observation | Post-S1 association shell classification | After exact process absence, only exact post-S1 target links are removed; no new files or non-opaque changes are allowed. | removed exact post-S1 target links=0; S0→final=C:\Users\deny7\AppData\Roaming:CustomDestinations/590aee7bdd69b59b.customDestinations-ms; S1→final allowed opaque=C:\Users\deny7\AppData\Roaming:CustomDestinations/590aee7bdd69b59b.customDestinations-ms | 0 |  |

## Captured errors

| Source | Message |
| --- | --- |
| none | No captured errors |
