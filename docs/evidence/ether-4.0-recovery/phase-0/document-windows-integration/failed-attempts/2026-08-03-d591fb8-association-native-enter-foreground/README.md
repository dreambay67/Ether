# Excluded 2026-08-03 `d591fb8` association native-enter failure

Status: **failed safely and excluded from packaged evidence**. This archive
contains the single corrected association selector run at exact commit
`d591fb84d6bf2790bea0f9408ccf6b95569b2fa4`. It is diagnostic evidence only and
does not prove AC-A02 association success, T03, shell restoration, Phase 0, or
release acceptance.

## Selector scope and authorization

The first approval-free selector at `7a13ecc` failed safely before executing any
test: Playwright received a full-title prefix and selected zero tests. The
selector was corrected at `d591fb8`; the corrected list selected exactly one
test in exactly one file, with no approval tokens or test-body execution in the
failed first attempt.

The corrected run had the independent Sol PASS-to-run gate, one worker, exact
direct selector, `retries=0`, `route=association`, and only the mutation and
shell approvals. No retry was made. No Explorer/association route was run
outside that single selected test.

## Identity and shell observations

The preflight worktree was clean at `d591fb84d6bf2790bea0f9408ccf6b95569b2fa4`.
The packaged executable identity was:

| Artifact | SHA-256 |
| --- | --- |
| `release/windows/win-unpacked/Ether.exe` | `03db599dbaec1e6d564275cfb63d568dec0189217237efa3ea5e2e99b482580f` |
| `release/windows/win-unpacked/resources/app.asar` | `8cc07d197b636b5104da29ffc295313ed64f82082cf2907566f5cbfedafb0a4e` |

Read-only preflight recorded exact packaged Ether process count `0`, UTF-8
registry query SHA-256
`e28e10c3557e46a3cf3e8a0637b06dc3f758ee98a54edcfa604ce77e88aa01c4`, left
mouse-button high bit `0`, and retained route PowerShell process count `0`.
Explorer showed only the pre-existing Desktop window HWND `131474` / PID
`16776`. The Recent snapshot contained 209 files with aggregate digest
`230cd9dbe77902279751b36f830469d9a23a73df20fe94bc76e764d231f12e7b`. The
pre-existing opaque
`%APPDATA%\\Microsoft\\Windows\\Recent\\CustomDestinations\\590aee7bdd69b59b.customDestinations-ms`
was 6233 bytes, SHA-256 `5a35edef...56f69`, last written
`2026-08-03T04:21:37.3432044Z`.

The single runtime test started at `2026-08-03T05:45:36.999Z`, finished at
`2026-08-03T05:46:14.707Z` (38.5 s), and failed exactly at:

`association Enter: foreground did not transition from the exact Explorer HWND to the exact Ether HWND/PID`

Finalization then proved exact process absence and passed shell classification;
the registry was restored to the preflight digest. Because the journey itself
failed, all route artifacts remain preserved and are not promoted as evidence.

Postflight again found exact packaged Ether process count `0`, registry SHA
`e28e10c3557e46a3cf3e8a0637b06dc3f758ee98a54edcfa604ce77e88aa01c4`, left
mouse-button high bit `0`, retained route PowerShell process count `0`, and only
the same Desktop HWND `131474` / PID `16776`. Recent remained at 209 files with
aggregate digest
`32702af01e09cc1c0fcff920725510c98dbf8bab4de3136f74215438aa77d3`. The opaque
590a file was 6233 bytes, SHA-256 `af3dc124...f725`, last written
`2026-08-03T05:46:13.8334113Z`. It was never restored, deleted, overwritten,
or timestamp-repaired.

## Preserved diagnostics

The exact disposable paths remain untouched for diagnosis:

- Root: `C:\Users\deny7\AppData\Local\Temp\ether-a02-windows-integration-gKy8Bk`
- Profile: `C:\Users\deny7\AppData\Local\Temp\ether-recovery-journey-BEeglM`

Critical root artifacts are the UI-authored
`Association f2c8f37d Žltý.ether`, `association-watchdog.disarm`, and registry
backups `registry/extension-before.reg`, `registry/extension-before-apply.reg`,
`registry/extension-after.reg`, `registry/original-progid-before.reg`, and
`registry/original-progid-after.reg`. Critical profile diagnostics are
`AppData/Local/Ether-Recovery-Profile/4.0/diagnostics/manifest.json`,
`AppData/Local/Ether-Recovery-Profile/4.0/diagnostics/logs/ether-current.jsonl`,
`AppData/Local/Ether-Recovery-Profile/4.0/reference-grants.json`, and the
`4.0/untitled/` document plus lease files. None of these external artifacts
were copied, cleaned, altered, or deleted.

The preserved diagnostics contain ready, graph revision, command-completed, and
document-state activity only. There is no observable second-instance, open, or
focus event after activation. This is a diagnostic absence, not a definitive
root-cause claim for the foreground-transition failure.

## Archived files

The generated canonical association directory was moved intact to
`a02-windows-association/`. `MANIFEST.sha256` records SHA-256 for every archived
file. Empty generated directories, if present, are retained; no opaque Windows
shell file or external disposable artifact is included in this archive.
