# Excluded A02 association Split-Path attempt

This directory preserves the failed approval-gated association evidence produced at source HEAD `14dda6c0aa33398bfdb4424ad21580d67ffd44b1` with the reviewed interim package.

The route failed before Explorer invoked the test document because Windows PowerShell 5.1 rejected `Split-Path -LiteralPath $document -Parent` as an ambiguous parameter set. No automatic retry was made. The exact diagnostic paths were preserved:

- root: `C:\Users\deny7\AppData\Local\Temp\ether-a02-windows-integration-HTR3jF`
- profile: `C:\Users\deny7\AppData\Local\Temp\ether-recovery-journey-lpEZ20`

Read-only postflight found zero exact Fixer `Ether.exe` processes. The `.ether` registry tree returned byte-for-byte to its preflight query digest `e28e10c3557e46a3cf3e8a0637b06dc3f758ee98a54edcfa604ce77e88aa01c4`. The durable finalization sidecar records exact-process proof, a passed shell classification, no target-link deletion, and only the allowed in-place pre-existing `590aee7bdd69b59b.customDestinations-ms` change. That opaque Windows-managed file was recorded in place and was not restored, deleted, or overwritten.

| File | SHA-256 |
| --- | --- |
| `a02-windows-association/packaged/action-log.md` | `7ad437f64b9df4b4e96ecf96920300c4f128030d230a1dc5e45be9afd3dc8f13` |
| `a02-windows-association/packaged/result.json` | `1dce6fa16c8606ae162797c427d7db410260f86cabea6f96b0ed72e7a1fc02bc` |
| `a02-windows-association/packaged/shell-finalization.json` | `e31b1b64204dd8a4641f82ed576b83bebcd6f3ad8ad94365e9794dc449c683fc` |

The shared Recent snapshot remained at 208 files. Its aggregate digest changed from `3c270dcb3c62f39ed31761edd504ec437901fb2cd70d1abd908112c376f511e8` to `dc02982e4127a061f7011797e949f6bdb6fb43a82c6bfcc0057bf0f4fbc63926`; the pre-existing `590aee7bdd69b59b.customDestinations-ms` SHA-256 became `175f5dc73a6ff1e33b2de260f883ffc38335c87402695d3b61cec8d9669963d0` at `2026-08-03T02:46:37.6325692Z`.

