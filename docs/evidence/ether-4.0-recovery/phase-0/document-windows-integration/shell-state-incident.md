# T03 Windows shell-state incident

Date: 2026-08-02 (Europe/Bratislava)

Status: historical state cannot be proven restored; both files are preserved in place.

Before the recovery harness had a real-and-isolated `Recent` tree snapshot and a disposable AUMID, two earlier diagnostic launches used shell APIs that can rewrite existing Windows Jump List data. A later read-only metadata check established that the affected files were not newly created test artifacts, so deleting either file would risk further damage.

| Relative path under `%APPDATA%\\Microsoft\\Windows\\Recent` | Created UTC | Last written UTC | Size | Current SHA-256 |
| --- | --- | --- | ---: | --- |
| `CustomDestinations\\590aee7bdd69b59b.customDestinations-ms` | 2024-08-27T09:17:06.3428997Z | 2026-08-02T22:51:50.7132963Z | 6233 | `57b6423bd9319721ff005aeefa7d8e8432bace2f371197daafaf24b46af6a756` |
| `CustomDestinations\\a7febed2ad074f25.customDestinations-ms` | 2026-07-23T10:27:00.6243930Z | 2026-08-02T23:19:19.9319449Z | 24 | `74d6d8c58d0beb0716eeecdc55366e193186924a616e057cd210f4104e5d85e9` |
| `AutomaticDestinations\\5f7b5f1e01b83767.automaticDestinations-ms` | 2024-08-27T09:17:59.536Z | 2026-08-02T23:47:54.576Z | 1463808 | `d62973a24db3f861deef26660e4818a6600b9c174444b47962d81716bcc0259c` |

The first timestamp coincides with an earlier normal A02 packaged journey against the package built from product commit `d9fb92a`; the second coincides with the first recovery-AUMID source lifecycle experiment while it still called Electron Jump List reset APIs. This timing establishes a likely causal link, but no byte-for-byte before snapshot exists. The prior contents therefore cannot be reconstructed or claimed restored.

A later source lifecycle run at candidate commit `43754c4` used the unique recovery identity but exposed a COM interop defect in its new app-scoped cleanup helper. The helper failed before `RemoveAllDestinations`; the third file above was last written eleven seconds after that journey's recorded finish time. Its creation predates Ether recovery work, so causality and prior bytes cannot be established and the file is likewise preserved. The failed run is not accepted as evidence.

Two controlled runtime probes then established that `IApplicationDestinations.RemoveAllDestinations` creates an empty automatic-destinations container for a fresh AUMID and writes it in the real Windows shell store even when the spawned process receives isolated `APPDATA`. Each probe took a complete byte-level `Recent` inventory immediately before invocation, observed exactly one new file, verified its exact path/size/hash, and moved only that new file to the Recycle Bin:

| Recovery token | Newly created relative path | Size | SHA-256 | Disposition |
| --- | --- | ---: | --- | --- |
| `d034a4e33578a56d88315c616c7eeb42` | `AutomaticDestinations\\eb5e56be0679c67e.automaticDestinations-ms` | 2560 | `0cc3f4f7d55de9eae09be7770ac27ba64be0a0b9b49d97a7ce8cede42b89e431` | Recycle Bin |
| `fc923f038b8d7bd1cdf530eb58813311` | `AutomaticDestinations\\e7d56852e695cfbd.automaticDestinations-ms` | 2560 | `e28bd3c6d97d27c0b0a389cd2fdbab435c66aaa97727388df827d31a9ca97f68` | Recycle Bin |

This invalidated COM cleanup as a general recovery-journey teardown mechanism. Ordinary recovery identities must not add Recent documents and must not invoke a destinations cleanup API. Only the separately approved Jump List route may opt into Recent behavior; its cleanup must prove the destination file was absent in the route's before snapshot and was created/emptied by that exact AUMID before removing the exact test artifact.

Corrective controls now in source:

- every source-Electron and packaged recovery launch receives a validated unique recovery AUMID and taskbar title;
- production Jump List configuration is skipped for recovery identities;
- no recovery path calls Electron's global Recent/Frequent clearing API or custom Jump List reset;
- ordinary recovery journeys neither add Recent documents nor call a destination-clearing API;
- the separately approved Jump List route uses `IApplicationDestinations.SetAppID(uniqueRecoveryAumid)` plus `RemoveAllDestinations` only inside a before/after proof that scopes cleanup to its exact new automatic-destinations file;
- approval-gated journeys snapshot both the real and isolated `Recent` trees before launch and require exact equality after scoped cleanup;
- association mutation has independent approval, pre-apply concurrency checks, default-value-only restoration, and a detached watchdog.

No deletion, overwrite, timestamp repair, or speculative restoration of either affected file was attempted after this finding. The original final-review task must treat exact pre-fixer Windows shell-state restoration as an unresolved historical evidence limitation, even if all future scoped journeys restore to their recorded before snapshots.

## 2026-08-03 controlled packaged lifecycle failure

Status: failed safely; not accepted as packaged evidence. The controlling lifecycle wrapper detected the shutdown failure and stopped the journey. No approval-gated association, Explorer, Jump List, COM, or destination-cleanup route was enabled.

The normal packaged `document-lifecycle` journey started at `2026-08-03T00:44:06.905Z` from source commit `6545bd9edc9ed2f271137dac1612c6177a6ffa10`, with these installed package artifacts:

| Artifact | SHA-256 |
| --- | --- |
| `release/windows/win-unpacked/Ether.exe` | `03db599dbaec1e6d564275cfb63d568dec0189217237efa3ea5e2e99b482580f` |
| `release/windows/win-unpacked/resources/app.asar` | `8cc07d197b636b5104da29ffc295313ed64f82082cf2907566f5cbfedafb0a4e` |

The query did not emit PID `0`. Its normal newline-terminated stdout ended with a blank line; the former parser converted that blank through `Number("")` into `0`. The driver repeatedly composed the following exact shutdown command and failed the shutdown proof closed; this record does not claim that Windows rejected PID `0`:

```text
Stop-Process -Id 41408,36540,40364,38536,0 -Force -ErrorAction SilentlyContinue
```

Read-only post-failure inspection found no exact packaged `Fixer` `Ether.exe` process remaining. The disposable journey profile is deliberately preserved for diagnosis at `C:\Users\deny7\AppData\Local\Temp\ether-recovery-journey-4QHhOI` (created `2026-08-03T00:44:06Z`); it was not deleted or altered after the failure.

The package's native Save also changed a pre-existing real shell file. Its prior bytes are not recoverable from the harness, so it is preserved in place with no restore, deletion, or overwrite attempt:

| Relative path under `%APPDATA%\Microsoft\Windows\Recent` | Size | Before SHA-256 | After SHA-256 | Last written UTC |
| --- | ---: | --- | --- | --- |
| `CustomDestinations\590aee7bdd69b59b.customDestinations-ms` | 6233 | `57b6423bd9319721ff005aeefa7d8e8432bace2f371197daafaf24b46af6a756` | `341f541efc7457b9f89e1deeb054883442238d1449183bba5d25f24c0e9a744a` | `2026-08-03T00:44:22.9170685Z` |

Corrective action: the recovery driver now rejects `0`, negative, non-numeric, mixed, and non-safe process-ID query output before it can compose a shutdown command. A fresh controlled packaged run requires separate authorization; none was performed for this correction.

## S0/S1 shell-baseline change control

The normal A02 primary journey and the approved association, Explorer drag, and Jump List journeys now distinguish an initial diagnostic `S0` from the first restorable checkpoint `S1`:

- `S0` is a byte-level real-and-isolated shell snapshot before the journey. Any `S0→S1` change caused by ordinary native UI or Save setup is recorded as an opaque OS-native setup delta; it is not deleted, overwritten, or claimed restored.
- `S1` is captured only after the ordinary UI/native-save setup is complete, then immediately rechecked before association mutation, Explorer gesture, or approved Recent mode.
- The shared `S1` classifier permits reporting-only **in-place** changes to pre-existing `AutomaticDestinations/*.automaticDestinations-ms` and `CustomDestinations/*.customDestinations-ms` files. It never restores, deletes, overwrites, or timestamp-repairs those opaque Windows-managed files. Every removal, every changed `.lnk` or other non-opaque file, and every unexpected new file fails closed. Once exact process absence is proven, scoped real-shell sanitation is still attempted; a post-`S1` journey failure vetoes only disposable profile/root deletion, not that sanitation attempt.
- Exact target-link sanitation is pathname-safe: every candidate must have been absent from the **full** `S1` snapshot at its exact real or isolated root, then is re-resolved to the exact random document immediately before deletion. A pre-existing `.lnk` retargeted after `S1` is refused and left in place for the classifier to report.
- The normal A02 primary route captures `S1` after its final native File > Open title check. Its second-instance, disposable-root, clean-close/reopen, and association dry-run work is post-`S1`; a failed session/process proof or final classifier check preserves the exact primary profile and Windows root. A launch that fails before a session is returned may run its sanitation callback only after the driver has proven the owned process set absent.
- Each primary, association, Explorer-drag, and Jump List route carries an explicit `exactProcessAbsenceProven` flag. It is reset before every launch, set only by a driver launch-failure callback after exact shutdown or by an `afterApplicationExit` hook, and is required alongside a failure-free finalization before deleting a diagnostic profile/root. A `null` session or an empty local error array is never absence proof.
- Every committed packaged journey initializes `shell-finalization.json` before launch, but only after proving a 40-hex Git commit and 64-hex SHA-256 values for both `Ether.exe` and `app.asar`. Each after-exit sanitation attempt, including no-session launch-failure and retry paths, appends a fail-closed record with route/action, process-proof context, success disposition or failure, candidate path, and all Jump COM/recycle invocation and observed-state transitions. The recorder refuses to run sanitation without exact process absence and records a durable blocked entry when process proof or S1 prerequisites are unavailable. A sidecar write failure is itself a finalization failure and preserves diagnostic artifacts.
- Before any diagnostic-root deletion, each route rewrites and verifies its full sidecar state. Sidecar durability is an explicit cleanup predicate; once a sidecar write has failed, later retries may improve the retained record but cannot reauthorize deletion in that journey.
- The Jump List route creates and saves its document in an ordinary-recovery session with Recent disabled, exits that session, records `S0→S1`, and only then starts the exact approved Recent-mode session against the existing document. After exact process absence and exact-target-link cleanup, `S1→J0` must contain exactly one new recovery AutomaticDestinations candidate plus only reportable opaque modifications. `J0` is stored as the micro-baseline: COM retries first resnapshot it (zero delta means COM was not applied; the exact 2560-byte candidate mutation means it was), and recycle retries distinguish the exact stored candidate still present from a valid `J2=J0−candidate`. Concurrent or unrelated writes fail and preserve the artifacts.

For future controlled Windows evidence, a fresh Windows VM snapshot or Windows Sandbox with a disposable user profile is the preferred isolation boundary. It avoids relying on a developer's established MRU state, but does not weaken this classifier or the exact process/link proof requirements.

## 2026-08-03 single association `9532736` Marshal.SizeOf failure

Status: **failed safely and excluded from packaged evidence**. The exact
approval-gated association selector ran one test in one file at HEAD
`95327367b94357c9888aa350c717ae959245ebaa`, with one worker, `retries=0`, the
association route, and both required approvals. The Sol PASS-to-package/list/run
gate passed. The runtime test took 22.1 s and the complete command took 24.5 s.

The attempt failed before the first native `SendInput`: Windows PowerShell 5.1
treated `[Runtime.InteropServices.Marshal]::SizeOf([EtherA02Native+INPUT])` as a
`RuntimeType` object and reported that the type could not be marshaled. No retry,
fallback, or second route was run. This records the exact `SizeOf` exception only;
it does not claim a product or foreground-transition root cause. The isolated
diagnostics contain ready, graph, command, and document records only, with no
association record, consistent with failure before Enter submission.

Package-audit inventory for the run:

| Artifact | SHA-256 |
| --- | --- |
| `release/windows/win-unpacked/Ether.exe` | `329340612560c625450600616c8b5c8643b7b77063b411984d3d359f93c57cef` |
| `release/windows/win-unpacked/resources/app.asar` | `ecff49c42130b4f3f11be2c42d8665ef472fcdba0524843daecfcdb9cb7f5b97` |
| `release/windows/Ether-4.0.0-Setup.exe` | `60ba0f6d4ffc30e0dd160e5f2894b6a894aca071b433c99d30a9d3c0f9f0ac56` |

The installer value is retained as the full package-audit SHA-256; the route's
committed result and shell sidecar identify the executable and asar hashes
consumed by the test. A prior orchestrator timeout/staging `ENOENT` is
retained only as an excluded packaging incident; it is not a product failure and
does not explain this route's exact `SizeOf` exception.

Read-only shell/process facts were:

| Check | Preflight | Postflight |
| --- | --- | --- |
| Exact packaged process count | `0` | `0` |
| Retained route PowerShell count | `0` | `0` |
| Registry UTF-8 query digest | `e28e10c3557e46a3cf3e8a0637b06dc3f758ee98a54edcfa604ce77e88aa01c4` | unchanged |
| Left/Return high-bit state | up | up |
| Exact Explorer route window | no route window | no Explorer window |
| Recent files / readable files | `209 / 209` | `209 / 209` |
| Recent aggregate SHA-256 | `32702af01e09cc1c1c0fcff920725510c98dbf8bab4de3136f74215438aa77d3` | `4b1086a54187e40ff826f3195c47045c9520af8a40f376fe6f2e2c2fdaabc4e7` |

The only observed shell delta was the allowed in-place mutation of the pre-existing
opaque file
`CustomDestinations\\590aee7bdd69b59b.customDestinations-ms`:

| Field | Preflight | Postflight |
| --- | --- | --- |
| Last written UTC | `2026-08-03T05:46:13.833Z` | `2026-08-03T06:45:02.615Z` |
| SHA-256 | `af3dc1243c5d8a3b764ab8a0bfaa08cda3ac21f7f0dbc2f525a2502feb4f725c` | `4c5ff7584b5a320fe6ba549d9a38f1d557a6c53c967db5c1f080da29c977a1f0` |

Finalization passed exact process absence and shell classification, removed zero
target links, and recorded only the permitted opaque in-place delta. The opaque
file was never restored, deleted, overwritten, or timestamp-repaired. Disposable
diagnostic roots identified by tokens `QIlA0P` and `JAmTNP` remain preserved and
must not be cleaned or treated as accepted evidence.

## 2026-08-03 second controlled packaged lifecycle failure

Status: failed safely at the writer-lock contender launch; excluded from packaged evidence. The primary packaged UI/native lifecycle completed its setup actions before the contender route reached the tightened recovery-shell resolver. No approval-gated association, Explorer, Jump List, COM, or destination-cleanup route was enabled.

The attempt started at `2026-08-03T01:05:23.181Z` and finished at `2026-08-03T01:05:38.463Z`, from HEAD `78b062ffe2d21012b5bae89cd22088a39ee23cf0` with unchanged package artifacts:

| Artifact | SHA-256 |
| --- | --- |
| `release/windows/win-unpacked/Ether.exe` | `03db599dbaec1e6d564275cfb63d568dec0189217237efa3ea5e2e99b482580f` |
| `release/windows/win-unpacked/resources/app.asar` | `8cc07d197b636b5104da29ffc295313ed64f82082cf2907566f5cbfedafb0a4e` |

The contender selected `userData=<primaryRoot>\contender-user-data`, whose basename is not `Ether-Recovery-Profile`; the tightened packaged resolver rejected that non-disposable profile shape before the contender could prove the writer lock. The harness now uses the non-colliding nested test-owned path `<primaryRoot>\contender\Ether-Recovery-Profile`, retaining its own `4.0\leases` junction to the primary lease root.

Read-only post-failure inspection found no exact packaged Fixer `Ether.exe` process. Driver cleanup removed the second attempt's disposable profile; the earlier preserved profile `C:\Users\deny7\AppData\Local\Temp\ether-recovery-journey-4QHhOI` remains unchanged.

The ordinary native Save changed the same pre-existing real shell MRU file again. It is preserved in place; no restore, deletion, overwrite, or timestamp repair was attempted:

| Relative path under `%APPDATA%\Microsoft\Windows\Recent` | Size | Before SHA-256 | After SHA-256 | Last written UTC |
| --- | ---: | --- | --- | --- |
| `CustomDestinations\590aee7bdd69b59b.customDestinations-ms` | 6233 | `341f541efc7457b9f89e1deeb054883442238d1449183bba5d25f24c0e9a744a` | `6ae9b25b15c6a7023ca3c0aacecd741133738e23bf91ffa69f95ec5749e63e35` | `2026-08-03T01:05:37.9730910Z` |

No controlled rerun was performed for this correction.

## 2026-08-03 successful packaged lifecycle evidence

Status: **passed and retained as bounded packaged evidence**. The controlled run at
HEAD `5417ce1999f04206918ef9aaf8fae1eac2ef33c8` completed the ordinary UI-authored
document lifecycle, competing-writer read-only check, hard-kill reopen, and clean
UI Automation close/reopen. No approval-gated association, Explorer drag, Jump List,
COM, or destination-cleanup route was enabled.

| Artifact | SHA-256 |
| --- | --- |
| `release/windows/win-unpacked/Ether.exe` | `03db599dbaec1e6d564275cfb63d568dec0189217237efa3ea5e2e99b482580f` |
| `release/windows/win-unpacked/resources/app.asar` | `8cc07d197b636b5104da29ffc295313ed64f82082cf2907566f5cbfedafb0a4e` |
| `release/windows/Ether-4.0.0-Setup.exe` | `cf9c66de4c055ccdac1ec7891b57c5f23356a837fff8140824ac0e9b40c01bf4` |

All four journey results record a fresh isolated profile, 1280x720 viewport at scale 1,
the exact HEAD and artifact hashes above, `outcome: passed`, and `errors: []`. Visual
inspection found the blank UI-authored node, saved/compact/portable state, manual
History milestone, writer-lock read-only state, two-node hard-kill reopen, and clean
reopen state. Read-only postcheck found no exact packaged Fixer `Ether.exe` process.
The retained records are `document-lifecycle`, `document-lifecycle-writer-lock`,
`document-lifecycle-reopen`, and `document-lifecycle-clean-reopen`.

The native Save changed the following pre-existing shell file. This is an opaque
diagnostic setup delta: no restore, deletion, overwrite, or timestamp repair was
attempted, and this run does not prove shell-state restoration:

| Relative path under `%APPDATA%\Microsoft\Windows\Recent` | Size | Before SHA-256 | After SHA-256 | Last written UTC |
| --- | ---: | --- | --- | --- |
| `CustomDestinations\590aee7bdd69b59b.customDestinations-ms` | 6233 | `6ae9b25b15c6a7023ca3c0aacecd741133738e23bf91ffa69f95ec5749e63e35` | `bac64f8ce95b79e7bcd153666f3029506b9c678ee82c480500875bbab3e78c99` | `2026-08-03T01:14:28.4121770Z` |

## 2026-08-03 successful packaged visible-recovery evidence

Status: **passed and retained as bounded packaged evidence**. The visible-recovery
suite completed six records (three UI-authored baseline records plus the provider,
unsupported-metadata, and media-repair journeys) at the same HEAD and package hashes
above. Each result records `outcome: passed`, `errors: []`, fresh isolated profile,
1280x720/scale-1 viewport, and no exact packaged Fixer process remained at postcheck.
The provider History screenshot shows `Recovered artifact - review required`; the
metadata screenshot shows the native unsupported-document error with the valid active
baseline preserved; and the media repair preview/report separate media/artifact losses
from graph losses and state that the damaged source was unchanged.

The visible suite changed the same pre-existing shell file. This is another opaque
diagnostic setup delta; no restore, deletion, overwrite, or timestamp repair was
attempted:

| Relative path under `%APPDATA%\Microsoft\Windows\Recent` | Size | Before SHA-256 | After SHA-256 | Last written UTC |
| --- | ---: | --- | --- | --- |
| `CustomDestinations\590aee7bdd69b59b.customDestinations-ms` | 6233 | `bac64f8ce95b79e7bcd153666f3029506b9c678ee82c480500875bbab3e78c99` | `73f204b9142103b29516e019c7a79056b49a4d7f490ed3d09039425a1e9d5ec7` | `2026-08-03T01:16:44.0729574Z` |

These successful packaged runs do not close association, Explorer drag, Jump List,
cross-machine portability, or owner-M requirements. The pre-existing shell file
remains preserved in place under the historical restoration limitation above.

## 2026-08-03 third controlled packaged lifecycle failure

Status: both individual journey records passed, but the combined attempt is **excluded from packaged evidence** because its shared post-`S1` Windows shell state was not accepted under the then-current control. The attempted HEAD was `bdc3d76bf3953d3e27a59c0a49926d42acee5787`.

| Journey | Started UTC | Finished UTC | Individual result |
| --- | --- | --- | --- |
| `a02-windows-primary` | `2026-08-03T01:27:52.140Z` | `2026-08-03T01:28:10.718Z` | passed; excluded with the combined attempt |
| `a02-windows-reopen-after-cleanup` | `2026-08-03T01:28:10.994Z` | `2026-08-03T01:28:16.663Z` | passed; excluded with the combined attempt |

The normal native UI changed the same pre-existing real shell MRU file. Its recorded digest changed from `73f204...d5ec7` to `333b840...e243`, with last-write time `2026-08-03T01:28:16.1461844Z`. This opaque pre-existing file remains in place: no restore, deletion, overwrite, or timestamp repair was attempted.

Read-only post-failure inspection found no exact packaged Fixer `Ether.exe` process. The failed-attempt root `C:\Users\deny7\AppData\Local\Temp\ether-a02-windows-integration-8ILUcl` and profile `C:\Users\deny7\AppData\Local\Temp\ether-recovery-journey-FMILz4` are deliberately preserved and must not be treated as accepted evidence or cleanup targets.

## 2026-08-03 fourth controlled packaged lifecycle failure

Status: **failed safely and excluded from packaged evidence**. The reviewed run at
HEAD `391dc2739886b0df941573511fff408f94ddd5f6` reached after-exit link sanitation,
where the cleanup command exceeded Windows' command-line length limit (`spawn
ENAMETOOLONG`). No Electron, shell UI, COM, registry mutation, or cleanup route was
rerun for this correction.

| Disposable root | Profile | Failure point |
| --- | --- | --- |
| `C:\Users\deny7\AppData\Local\Temp\ether-a02-windows-integration-5Npx0P` | `C:\Users\deny7\AppData\Local\Temp\ether-recovery-journey-vAkplp` | after-exit link sanitation (`spawn ENAMETOOLONG`) |

Read-only post-failure inspection found zero exact packaged Fixer `Ether.exe` processes.
The aggregate Recent snapshot remained 209 files, but its digest changed from
`21a9ba0e88d3b614fddaf98bcec4f712375e4182a20fd7529d8435075f4c4ea6` before the
attempt to `120881c26e2eb09eb37d305945b7a3097503faf783c1e612a6f16db96310f80f`
after. The preserved shell delta is diagnostic only and is not a restoration claim.

The pre-existing real MRU file below was recorded in place. Its post-run SHA-256 and
timestamp are retained for diagnosis; no restore, deletion, overwrite, or timestamp
repair was attempted:

| Relative path under `%APPDATA%\Microsoft\Windows\Recent` | Size | Post-run SHA-256 | Last written UTC |
| --- | ---: | --- | --- |
| `CustomDestinations\590aee7bdd69b59b.customDestinations-ms` | 6233 | `d739c7a9a45a883f3e3f10916623919e523f69f19ad3d95bdf7483b2385bfec2` | `2026-08-03T02:29:36.2977216Z` |

The failed evidence and both disposable paths remain diagnostic only. The follow-up
cleanup refactor removes full S1 path-set embedding from `-EncodedCommand`; it does
not authorize a rerun or close the remaining Windows shell evidence gaps.

## 2026-08-03 successful normal A02 packaged evidence

Status: **passed and retained as bounded packaged evidence**. The normal A02 route
completed at evidence identity commit `14dda6c0aa33398bfdb4424ad21580d67ffd44b1`.
The three approval-gated routes (association, Explorer drag, and Jump List) were
skipped; this record does not claim any of those routes ran or passed.

| Artifact | SHA-256 |
| --- | --- |
| `release/windows/win-unpacked/Ether.exe` | `03db599dbaec1e6d564275cfb63d568dec0189217237efa3ea5e2e99b482580f` |
| `release/windows/win-unpacked/resources/app.asar` | `8cc07d197b636b5104da29ffc295313ed64f82082cf2907566f5cbfedafb0a4e` |

The primary and reopen records use fresh isolated profiles at 1280x720/scale 1,
each reports `outcome: passed` and `errors: []`, and read-only postcheck found an
exact packaged-process count of zero. The retained normal-route records are
[`a02-windows-primary`](a02-windows-primary/packaged/) and
[`a02-windows-reopen-after-cleanup`](a02-windows-reopen-after-cleanup/packaged/).
The primary screenshot visibly shows the Unicode/spaces document title in the
installed Ether window with Saved status, the authored Prompt node, and the File >
Open result state.

The aggregate Recent snapshot contained 208 files before the route (digest
`147b2c54...94c7`) and 208 after it (digest `3c270dcb...11e8`). The only recorded
pre-existing opaque shell change was
`CustomDestinations\\590aee7bdd69b59b.customDestinations-ms`, size 6233, from
`d739c7...fec2` before the route to `0eee330...a6f` after it, last written at
`2026-08-03T02:44:29.8032683Z`. It remains preserved in place: no restore, delete,
overwrite, or timestamp repair was attempted.

The normal-route finalization sidecar records one passed attempt with exact-process
absence proof and `removed exact post-S1 target links=0`. This is diagnostic shell
evidence only; approval routes, T03 acceptance, and Phase 0 acceptance remain open.

## 2026-08-03 accidental multi-route forwarding attempt at `9d14f93`

Status: **failed safely and excluded from packaged evidence**. The intended
association-only command was `pnpm ... run ... -- --grep ...`, but the literal
`--` reached Playwright and the filter was not applied. All four tests in the
file ran: the normal primary/reopen journeys, association, Explorer drag, and
Jump List. The normal journeys individually passed but their newly generated
canonical files were overwritten by this broad run; those seven files were
copied to the forensic archive and then restored exactly from `HEAD`. The
association route failed because foreground did not transition from the exact
Explorer HWND to the exact Ether HWND/PID. Explorer drag timed out at 150 s.
Jump List failed with `0` exact visible taskbar items and no new
`AutomaticDestinations` candidate. The Jump List setup-only journey passed but
does not prove the route.

The complete archive, including unchanged encoded PowerShell diagnostics, is
`failed-attempts/2026-08-03-9d14f93-argument-forwarding-multi-route/`. Preserved
failure roots/profiles are `5tk5GI`/`MtuaJE` (association), `3Se52X`/`9Q33lk`
(Explorer drag), and `og6U3A`/`NT7K9F` (Jump List); the individually passing
normal rows do not have a separate root/profile recorded in the preserved
diagnostics. No route acceptance, shell
restoration, Phase 0, or release claim is made.

Read-only preflight/postflight recorded exact packaged process count `0` and the
same `.ether` registry digest
`e28e10c3557e46a3cf3e8a0637b06dc3f758ee98a54edcfa604ce77e88aa01c4`. Recent
remained at 209 files, with aggregate digest `bf49df40...cd62` before and
`f9d7cb46...e34f` after. The pre-existing opaque
`CustomDestinations\\590aee7bdd69b59b.customDestinations-ms` was 6233 bytes,
SHA-256 `925466e6...25edbe` at `2026-08-03T03:36:32Z`, and changed in place to
SHA-256 `5a35edef...56f69` at `2026-08-03T04:21:37Z`. It was never restored,
deleted, overwritten, or timestamp-repaired. The canonical association was
absent before the run; postflight Explorer inspection found only the existing
Desktop HWND `131474`.

After the drag timeout, a read-only safety probe found the left mouse button was
not down. Three long-lived encoded PowerShell host processes were observed, but
none contained the route markers `EtherA02Pointer`, `EtherA02Native`, or
`EtherA02JumpList`; no orphaned route-specific child remained. No process was
killed or altered. The disposable roots/profiles and all opaque shell state stay
preserved for diagnosis.

## 2026-08-03 single corrected association selector failure at `d591fb8`

Status: **failed safely and excluded from packaged evidence**. The approval-free
selector first failed at `7a13ecc` before running a test: a Playwright full-title
prefix selected zero tests. The selector was corrected at `d591fb8`; the
corrected list selected exactly one test in one file, with no approvals or test
body in the failed first attempt. The corrected run had the independent Sol
PASS-to-run gate, exact direct selector, one worker, `retries=0`, route
`association`, and only mutation plus shell approvals. No retry occurred.

Preflight at clean `d591fb84d6bf2790bea0f9408ccf6b95569b2fa4` recorded
`Ether.exe` SHA-256
`03db599dbaec1e6d564275cfb63d568dec0189217237efa3ea5e2e99b482580f`, exact
packaged Ether process count `0`, UTF-8 registry query SHA
`e28e10c3557e46a3cf3e8a0637b06dc3f758ee98a54edcfa604ce77e88aa01c4`, left
mouse-button high bit `0`, retained route PowerShell count `0`, and only Desktop
Explorer HWND `131474` / PID `16776`. Recent had 209 files with aggregate digest
`230cd9dbe77902279751b36f830469d9a23a73df20fe94bc76e764d231f12e7b`. The
pre-existing opaque 590a file was 6233 bytes, SHA `5a35edef...56f69`, last
written `2026-08-03T04:21:37.3432044Z`.

The one runtime test lasted 38.5 s and failed at
`association Enter: foreground did not transition from the exact Explorer HWND to the exact Ether HWND/PID`.
Finalization proved exact process absence and passed shell classification; the
registry returned to the preflight digest. The journey failed, so its artifacts
remain preserved and are not promoted.

Postflight recorded exact packaged Ether process count `0`, registry SHA
`e28e10c3557e46a3cf3e8a0637b06dc3f758ee98a54edcfa604ce77e88aa01c4`, left
mouse-button high bit `0`, retained route PowerShell count `0`, and only the same
Desktop HWND/PID. Recent remained at 209 files with aggregate digest
`32702af01e09cc1c0fcff920725510c98dbf8bab4de3136f74215438aa77d3`. The opaque
590a file was 6233 bytes, SHA `af3dc124...f725`, last written
`2026-08-03T05:46:13.8334113Z`; it was never restored, deleted, overwritten, or
timestamp-repaired.

The preserved root is
`C:\Users\deny7\AppData\Local\Temp\ether-a02-windows-integration-gKy8Bk` and
profile is `C:\Users\deny7\AppData\Local\Temp\ether-recovery-journey-BEeglM`.
Registry backups, the UI-authored association document, watchdog marker, and
profile diagnostics remain in place and untouched. The profile log contains
ready/save activity but no observable second-instance/open/focus event after
activation; this is diagnostic absence only, not a definitive root-cause claim.
