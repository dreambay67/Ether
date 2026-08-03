# a02-windows-association action log

- Mode: packaged
- Outcome: failed
- Git commit: 95327367b94357c9888aa350c717ae959245ebaa
- Profile: fresh-isolated; APPDATA, LOCALAPPDATA, and userData isolated
- Viewport: 1280×720; scale 1
- Started: 2026-08-03T06:44:42.222Z
- Finished: 2026-08-03T06:45:03.602Z

## Build identity

- release/windows/win-unpacked/Ether.exe: 329340612560c625450600616c8b5c8643b7b77063b411984d3d359f93c57cef
- release/windows/win-unpacked/resources/app.asar: ecff49c42130b4f3f11be2c42d8665ef472fcdba0524843daecfcdb9cb7f5b97

## Actions

| # | Input | Action | Expected | Actual | ms | Screenshot |
| --- | --- | --- | --- | --- | ---: | --- |
| 1 | left-click | Create a test-owned association document | A visible blank-UI node is saved before Explorer invokes the association. | Left click at (91, 313). | 73 |  |
| 2 | keyboard-command | Save association document through native picker | The association target is a unique test-owned .ether document. | Pressed Control+s. | 34 |  |
| 3 | observation | Capture S1 after native association setup | S0 is diagnostic; every S0→S1 shell delta is recorded as OS-native setup and is not restored. | S0→S1 OS-native setup delta (recorded without restoration claim): C:\Users\deny7\AppData\Roaming:CustomDestinations/590aee7bdd69b59b.customDestinations-ms | 0 |  |
| 4 | observation | S1 exact target-link checkpoint | Both real and isolated S1 Recent roots contain zero links resolving to the exact association document. | S1 matching target links=0. | 0 |  |
| 5 | observation | Post-S1 association shell classification | After exact process absence, only exact post-S1 target links are removed; no new files or non-opaque changes are allowed. | removed exact post-S1 target links=0; S0→final=C:\Users\deny7\AppData\Roaming:CustomDestinations/590aee7bdd69b59b.customDestinations-ms; S1→final allowed opaque=C:\Users\deny7\AppData\Roaming:CustomDestinations/590aee7bdd69b59b.customDestinations-ms | 0 |  |

## Captured errors

| Source | Message |
| --- | --- |
| none | No captured errors |
