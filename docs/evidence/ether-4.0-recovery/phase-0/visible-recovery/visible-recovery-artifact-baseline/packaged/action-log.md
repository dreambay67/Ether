# visible-recovery-artifact-baseline action log

- Mode: packaged
- Outcome: passed
- Git commit: d9fb92a62d5c6ce541025546f4fdc5c35e0999b5
- Profile: fresh-isolated; APPDATA, LOCALAPPDATA, and userData isolated
- Viewport: 1280×720; scale 1
- Started: 2026-08-02T22:45:44.015Z
- Finished: 2026-08-02T22:45:47.402Z

## Build identity

- release/windows/win-unpacked/Ether.exe: 07f6adabbb296b387899919536a0af3cd36eed84ef7bfe05973b0133259c071d
- release/windows/win-unpacked/resources/app.asar: edf009fd0d2cf03b6719c67789bf42381410d16514e5f9a306d24c69dea8b814

## Actions

| # | Input | Action | Expected | Actual | ms | Screenshot |
| --- | --- | --- | --- | --- | ---: | --- |
| 1 | left-click | Open visible artifact baseline | The packaged UI visibly opens the artifact-bearing baseline before a copied fixture is corrupted. | Left click at (1144, 34). | 43 |  |
| 2 | left-click | Open artifact review | The visible Review workspace exposes the embedded fake-provider artifact. | Left click at (228, 89). | 36 |  |
| 3 | screenshot | Capture artifact-bearing baseline | A fake-provider artifact is visibly present in the valid packaged baseline. | Captured after the documented preceding action. | 151 | screenshots/artifact-bearing-baseline.png |

## Captured errors

| Source | Message |
| --- | --- |
| none | No captured errors |
