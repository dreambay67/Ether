# Phase 0 blank-authoring baseline findings

This is rejected-candidate reproduction evidence. It is not release, acceptance, or Phase 0 gate evidence. Every screenshot was captured after the documented UI action in an isolated blank document; no graph seed, bridge command, fixture service, database operation, or initialization script created authoring state.

## Result

The two baseline commands intentionally returned non-zero after preserving their evidence because `BL-02-marquee-pointer` no longer reproduces the rejected candidate: in both modes, left marquee selected one item and Shift+marquee selected two. This is a product-behaviour divergence, not a journey-harness failure.

`BL-01`, `BL-03`, `BL-04`, and `BL-05` reproduced in both source Electron and the packaged executable. The detailed action logs, observations, result payloads, and twenty screenshots per mode are adjacent to this file.

## Material defect observed

After the Group command succeeds, attempting the Module conversion produces a visible `TRAVERSAL_INVALID: GROUP_NODE_MISSING` toast. The exact user-visible result is captured in both `source-electron/screenshots/19-module-command.png` and `packaged/screenshots/19-module-command.png`; each run recorded zero Module cards. This is a known baseline defect, not an asserted implementation outcome.

## Artifact and cleanup notes

- Source and packaged identity hashes are recorded in `summary.md` and each mode's `result.json`.
- The Windows pack command assembled the installer, unpacked executable, and application archive. The command runner timed out after 304 seconds, so this task did not treat packaging as a passed release audit; no `release-audit.json` was present at the observation point.
- Screenshot counts were verified as 20 for source Electron and 20 for packaged. The journey driver removed its isolated profile roots and left no process running from `release/windows/win-unpacked/Ether.exe`.
