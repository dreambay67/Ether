# T03 Windows shell-state incident

Date: 2026-08-02 (Europe/Bratislava)

Status: historical state cannot be proven restored; both files are preserved in place.

Before the recovery harness had a real-and-isolated `Recent` tree snapshot and a disposable AUMID, two earlier diagnostic launches used shell APIs that can rewrite existing Windows Jump List data. A later read-only metadata check established that the affected files were not newly created test artifacts, so deleting either file would risk further damage.

| Relative path under `%APPDATA%\\Microsoft\\Windows\\Recent\\CustomDestinations` | Created UTC | Last written UTC | Size | Current SHA-256 |
| --- | --- | --- | ---: | --- |
| `590aee7bdd69b59b.customDestinations-ms` | 2024-08-27T09:17:06.3428997Z | 2026-08-02T22:51:50.7132963Z | 6233 | `57b6423bd9319721ff005aeefa7d8e8432bace2f371197daafaf24b46af6a756` |
| `a7febed2ad074f25.customDestinations-ms` | 2026-07-23T10:27:00.6243930Z | 2026-08-02T23:19:19.9319449Z | 24 | `74d6d8c58d0beb0716eeecdc55366e193186924a616e057cd210f4104e5d85e9` |

The first timestamp coincides with an earlier normal A02 packaged journey against the package built from product commit `d9fb92a`; the second coincides with the first recovery-AUMID source lifecycle experiment while it still called Electron Jump List reset APIs. This timing establishes a likely causal link, but no byte-for-byte before snapshot exists. The prior contents therefore cannot be reconstructed or claimed restored.

Corrective controls now in source:

- every source-Electron and packaged recovery launch receives a validated unique recovery AUMID and taskbar title;
- production Jump List configuration is skipped for recovery identities;
- no recovery path calls Electron's global Recent/Frequent clearing API or custom Jump List reset;
- cleanup uses `IApplicationDestinations.SetAppID(uniqueRecoveryAumid)` plus `RemoveAllDestinations`;
- approval-gated journeys snapshot both the real and isolated `Recent` trees before launch and require exact equality after scoped cleanup;
- association mutation has independent approval, pre-apply concurrency checks, default-value-only restoration, and a detached watchdog.

No deletion, overwrite, timestamp repair, or speculative restoration of either affected file was attempted after this finding. The original final-review task must treat exact pre-fixer Windows shell-state restoration as an unresolved historical evidence limitation, even if all future scoped journeys restore to their recorded before snapshots.
