# Excluded 2026-08-03 `9d14f93` argument-forwarding multi-route run

Status: **failed safely and excluded from packaged evidence**. This archive is a
forensic record of one accidentally broad Playwright run. It is not acceptance
evidence and does not authorize or prove any association, Explorer drag, Jump
List, shell-restoration, Phase 0, or release requirement.

## Scope and cause

The intended association-only invocation used `pnpm ... run ... -- --grep ...`.
The literal `--` reached Playwright, so the filter did not apply and all four
tests in the file ran: normal primary/reopen, association, Explorer drag, and
Jump List. No rerun was made to repair the scope.

The normal primary and reopen journeys individually passed but their newly
generated canonical files were overwritten during the same broad attempt. They
are preserved below as `overwritten-normal/` and the seven canonical files were
restored from `HEAD` after their hashes were verified. The association route
failed at the foreground transition, the drag route timed out, and the Jump
List route failed to produce its required candidate.

| Journey | UTC interval | Outcome / reason | Preserved disposable root / profile |
| --- | --- | --- | --- |
| `a02-windows-primary` | 04:17:35.408 - 04:17:55.939 | passed individually; excluded because the combined run was out of scope and its canonical files were overwritten | not separately recorded in the preserved failure diagnostics |
| `a02-windows-reopen-after-cleanup` | 04:17:56.483 - 04:18:03.047 | passed individually; excluded for the same reason | not separately recorded in the preserved failure diagnostics |
| `a02-windows-association` | 04:18:03.657 - 04:18:38.685 | failed: foreground did not transition from the exact Explorer HWND to the exact Ether HWND/PID | `ether-a02-windows-integration-5tk5GI` / `ether-recovery-journey-MtuaJE` |
| `a02-windows-explorer-drag` | test timeout 150 s | failed: timed out while the Explorer drag-source page remained active | `ether-a02-windows-integration-3Se52X` / `ether-recovery-journey-9Q33lk` |
| `a02-windows-jump-list-setup` | 04:21:10.802 - 04:21:18.992 | passed setup only; not a Jump List route result | `ether-a02-windows-integration-og6U3A` / `ether-recovery-journey-NT7K9F` |
| `a02-windows-jump-list` | 04:21:22.396 - 04:21:38.235 | failed: exactly one new recovery `AutomaticDestinations` candidate was required, but none was found (`0` exact visible taskbar items) | same as setup |

The association, drag, and Jump List diagnostics are retained under
`test-results/document-windows-integration/`. The copied `.last-run.json`
records the three failed test IDs; the encoded PowerShell error contexts are
unchanged.

## Shell and identity record

The worktree was clean at `HEAD`
`9d14f93d973db59d6a90d116b7e849ddb084b3ae`. The packaged identity recorded by
all journey sidecars was:

| Artifact | SHA-256 |
| --- | --- |
| `release/windows/win-unpacked/Ether.exe` | `03db599dbaec1e6d564275cfb63d568dec0189217237efa3ea5e2e99b482580f` |
| `release/windows/win-unpacked/resources/app.asar` | `8cc07d197b636b5104da29ffc295313ed64f82082cf2907566f5cbfedafb0a4e` |

Read-only preflight and postflight both found exact packaged process count `0`.
The `.ether` registry query digest was
`e28e10c3557e46a3cf3e8a0637b06dc3f758ee98a54edcfa604ce77e88aa01c4` before and
after. The aggregate Recent snapshot remained at 209 files; its recorded digest
changed from `bf49df40...cd62` to `f9d7cb46...e34f`.

Native Save changed the pre-existing opaque file
`%APPDATA%\\Microsoft\\Windows\\Recent\\CustomDestinations\\590aee7bdd69b59b.customDestinations-ms`
in place. It was 6233 bytes, SHA-256
`925466e643c27b7b451bc09a945e6884f3e2ad292192f67288e9b6bcd825edbe`, at
`2026-08-03T03:36:32Z` before the run and 6233 bytes, SHA-256
`5a35edef...56f69`, at `2026-08-03T04:21:37Z` after it. The canonical association
was absent in preflight. Postflight Explorer inspection found only the
pre-existing Desktop window HWND `131474`; no new route-owned Explorer window
was treated as evidence.

The four disposable roots/profiles above remain preserved for diagnosis. No
shell file, registry value, route artifact, root, or profile was restored,
deleted, overwritten, or timestamp-repaired. In particular, the opaque MRU file
was never touched after the run.

After the drag timeout, a read-only safety probe found the left mouse button was
**not down**. Three long-lived encoded PowerShell host processes were observed;
marker classification found none containing `EtherA02Pointer`, `EtherA02Native`,
or `EtherA02JumpList`, so no orphaned route-specific encoded PowerShell child
remained. No process was killed or altered.

## Archived files and hashes

All files below were copied or moved under this archive and verified with
SHA-256. Empty generated screenshot directories are retained where their route
directory contained no screenshot file.

```text
9321649b50e66eff2f100706cf7678bc45014246c94e79330d120e2e038704a2  a02-windows-association/packaged/action-log.md
7bfa7f053ab582beea0d6e926bd2c7e265be25860fa3d941431228d18358716b  a02-windows-association/packaged/result.json
d24ee51ca40e69ecc65b705d31df9c8d635402e4a2993aa25580d3c850f7821c  a02-windows-association/packaged/shell-finalization.json
1d922aed8dc900786e3e8d7044c914fc9489be0a9691148a0e57587c945f46ab  a02-windows-explorer-drag/packaged/shell-finalization.json
613e7c7e922bf87ea7605802bd0d9438ae981d4ad1837018889031107af22d57  a02-windows-jump-list/packaged/action-log.md
7d4183d2c0c407ca76f5cce6f2ff96154f3ede87c14413ce7d3460ab0442bfb3  a02-windows-jump-list/packaged/result.json
d8a47e89107c8e5216b4d11d7e4304d4d7445730ccbd78f0cac61787fda5070b  a02-windows-jump-list/packaged/shell-finalization.json
52dd69d92335244ff9442920dfabc3a0c39a2e72413870f015fba33ec664e19f  a02-windows-jump-list-setup/packaged/action-log.md
77ac5d69297b648cfede0b1a76d13c5c06447fee75a53affeed3dec726237501  a02-windows-jump-list-setup/packaged/result.json
4a39ed9ef081fb7bebce831ee25fb2bd628142dbcac1c915127ed593a09db01c  a02-windows-jump-list-setup/packaged/shell-finalization.json
8d28aacc3fd2b363836f8f7242572329797fc31a45307c51cc36d34f4c97c447  overwritten-normal/a02-windows-primary/packaged/action-log.md
959ea22838c88e3d06e75f41d62895ab4a81501afbe60b79757d990c18ecd490  overwritten-normal/a02-windows-primary/packaged/result.json
d8b339034914678f19fb3d14dcf6e6dc03baeaeeaa71776b969512f49d1689b5  overwritten-normal/a02-windows-primary/packaged/screenshots/01-native-open-unicode.png
39ac1f1083b2cf343d3ff7c78b7343f671bfa73c147100a2f348628217bd8cbc  overwritten-normal/a02-windows-primary/packaged/shell-finalization.json
d56bbc737c038ff54e349be3ab827c40cb82adb517147c7d7297149aa517e85c  overwritten-normal/a02-windows-reopen-after-cleanup/packaged/action-log.md
196c58c965d7e13583db5d6466298be9b5d0e70227d39808a12f88fbcdf627a9  overwritten-normal/a02-windows-reopen-after-cleanup/packaged/result.json
b6aa1b314c7eabfa6fa8cf6a05ae617d382fb79283b2dd2cdac70d2c2dbeb409  overwritten-normal/a02-windows-reopen-after-cleanup/packaged/shell-finalization.json
0379272400998d8e467d8325b33c93e931e0885f7df3b6730dce100f1a71d05e  test-results/document-windows-integration/.last-run.json
d093253eb0369879ad98f697721db3c9bf8ef1f0f19790bd2e9db9d8896000b1  test-results/document-windows-integration/recovery-document-windows--d5bc3-wn-and-missing-target-route/error-context.md
64838a2d92e701d81d1292472dc4eaeaaf088503a22bda4a2cf84465f2311ade  test-results/document-windows-integration/recovery-document-windows--eb1ec--Explorer-association-route/error-context.md
42f0bb84048b68a2098656b452c252e1d1efec1e91d4e77159e62d0307f796c5  test-results/document-windows-integration/recovery-document-windows--f8326-rer-pointer-drag-drop-route/error-context.md
```

The canonical normal primary/reopen files now exactly match `HEAD`; they are
not part of this archive and are not claimed by this excluded attempt. No
product or test-harness files were changed by the archival operation.
