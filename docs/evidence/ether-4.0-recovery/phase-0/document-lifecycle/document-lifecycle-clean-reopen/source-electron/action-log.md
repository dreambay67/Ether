# document-lifecycle-clean-reopen action log

- Mode: source-electron
- Outcome: passed
- Git commit: bf81dfdd25ce49e4c12f236e3ade09424e417271
- Profile: fresh-isolated; APPDATA, LOCALAPPDATA, and userData isolated
- Viewport: 1280×720; scale 1
- Started: 2026-08-03T00:38:36.661Z
- Finished: 2026-08-03T00:38:38.499Z

## Build identity

- apps/desktop/dist/index.html: bfe6e6f2e88ac676609a90fad830627cffa464b4edc8eb808d57b931659d5d96
- apps/desktop/dist-electron/main/bootstrap.js: 11fa8b92a32a8f19fd2e4e04d38eb08bdfb452266faee0c462d4b1c73fa1dc72
- apps/desktop/dist-electron/preload/preload.cjs: 55129d69d37a552ec4c4767db952fab28911ba029a38da8de75d54001e988d7b
- node_modules/electron/dist/electron.exe: 12b61e817329db7db8e74d99a42e552e1a1f68db7ba3d4c2d4fb6441a3b07d26

## Actions

| # | Input | Action | Expected | Actual | ms | Screenshot |
| --- | --- | --- | --- | --- | ---: | --- |
| 1 | screenshot | Capture the clean-close reopen | The same user-saved document remains writable after an exact Windows UI Automation close. | Captured after the documented preceding action. | 178 | screenshots/04-clean-close-reopen.png |

## Captured errors

| Source | Message |
| --- | --- |
| none | No captured errors |
