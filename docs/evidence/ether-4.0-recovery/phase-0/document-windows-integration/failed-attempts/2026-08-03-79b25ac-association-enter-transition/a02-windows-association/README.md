# A02 association Enter-transition failure archive

This directory preserves one failed, safely finalized packaged association
attempt. It is forensic evidence only and is not promoted as route acceptance.
No retry, provider launch, shell repair, or product claim is implied.

## Identity and dispatch

- Exact source commit: `79b25ace9a84f7fd7c46ba53f27055b41ae54cdd`
- Packaged installer SHA-256:
  `89a8e60c825d3581fddeb4c905ca21c69e1889f871dccbbdcd1330042383f77a`
- Packaged `Ether.exe` SHA-256:
  `329340612560c625450600616c8b5c8643b7b77063b411984d3d359f93c57cef`
- Packaged `app.asar` SHA-256:
  `ecff49c42130b4f3f11be2c42d8665ef472fcdba0524843daecfcdb9cb7f5b97`
- Exact selector selected one test in one file; one worker; `retries=0`.
- Both route approvals were explicitly supplied. No automatic retry occurred.
- Runtime was 38.1 seconds; command wall time was 40.4 seconds.

## Failure and diagnostic boundary

The route failed at `Enter:transition`, when foreground did not transition
from the exact Explorer window to the exact Ether window/PID. The generated
fail-closed script requires native `SendInput` insertion of exactly two inputs
and a cleared Return high bit before that transition check; this ordering is an
inference from the generated script, not captured provider output. No
association diagnostic record appeared. The retained profile log contains only
`ready`, `graph-revision`, `command`, and `document-state` events; treat this as
diagnostic absence, not a definitive root cause.

## Safety finalization

- Exact Ether process absence and retained-route process absence: proven.
- Exact target links removed: `0`.
- Only the pre-existing opaque CustomDestinations delta was allowed.
- UTF-8 `.ether` registry query restored to SHA-256
  `e28e10c3557e46a3cf3e8a0637b06dc3f758ee98a54edcfa604ce77e88aa01c4`.
- Left mouse button and Return high bits were up after finalization.
- Explorer pre/post state was identical: minimized, non-foreground Desktop
  window HWND `131474`, PID `16776`.
- Recent contained 209 files and all 209 were readable. The pre/post JSON
  snapshot digests were `42f5e74dcd9be25e3e7cfa48cdd76c936a6b03efc7ab8a8b7e058e7e2a1d1b94`
  and `5edc7490c3986a2894dccf0a623ca3b1941fb201ad137770e47928bcc2f45242`.
- The opaque file
  `%APPDATA%\\Microsoft\\Windows\\Recent\\CustomDestinations\\590aee7bdd69b59b.customDestinations-ms`
  stayed 6233 bytes. Pre-state was SHA-256
  `4c5ff7584b5a320fe6ba549d9a38f1d557a6c53c967db5c1f080da29c977a1f0` at
  `2026-08-03T06:45:02.6158853Z`; post-state was SHA-256
  `3f7830bb6aa140356493e4d0f7f227a8d13f168a43943f3eac379203d2f53ef8` at
  `2026-08-03T07:25:47.418Z`. It was never restored, deleted, touched, or
  timestamp-repaired.

The disposable roots remain preserved and untouched:

- `C:\\Users\\deny7\\AppData\\Local\\Temp\\ether-a02-windows-integration-VlQ2YE`
- `C:\\Users\\deny7\\AppData\\Local\\Temp\\ether-recovery-journey-caa2se`

See `action-log.md`, `result.json`, and `shell-finalization.json` for the
machine-readable and human-readable records captured by the journey.
