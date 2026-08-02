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
