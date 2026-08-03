# Excluded 2026-08-03 `9532736` association Marshal.SizeOf failure

Status: **failed safely and excluded from packaged evidence**. This archive
preserves the single approval-gated association attempt at exact HEAD
`95327367b94357c9888aa350c717ae959245ebaa`. The canonical
`a02-windows-association/` directory was moved intact; no route retry was made.

## Selector, approvals, and timing

- Sol PASS-to-package/list/run gate: passed.
- Exact selector: 1 test in 1 file (`document-windows-integration.spec.ts`).
- Route: `association`; one worker; `retries=0`.
- Approvals: exactly the association mutation approval and shell-UI approval.
- Runtime test duration: 22.1 s; complete command duration: 24.5 s.
- No second route, retry, UI/list rerun, or native fallback was executed.

## Failure boundary

The run failed before the first native `SendInput` call. Windows PowerShell 5.1
reported that `[Runtime.InteropServices.Marshal]::SizeOf([EtherA02Native+INPUT])`
treated the supplied `RuntimeType` as an object and could not marshal it. This
archive records that exact ABI-boundary failure only; it does not claim a
foreground, association, or product root cause. The preserved route log contains
only ready/graph/command/document activity and no association diagnostic record,
which is consistent with failing before Enter submission.

## Package identity and inventory

| Artifact | SHA-256 |
| --- | --- |
| `release/windows/win-unpacked/Ether.exe` | `329340612560c625450600616c8b5c8643b7b77063b411984d3d359f93c57cef` |
| `release/windows/win-unpacked/resources/app.asar` | `ecff49c42130b4f3f11be2c42d8665ef472fcdba0524843daecfcdb9cb7f5b97` |
| `release/windows/Ether-4.0.0-Setup.exe` | `60ba0f...0ac56` |

The installer hash above is the successful package-audit inventory value supplied
for this run; the retained route result and shell sidecar contain the two package
artifacts actually consumed by the test.

## Preserved external diagnostics

The disposable root token `QIlA0P` and profile token `JAmTNP` remain preserved for
diagnosis. They were not cleaned, altered, or retried. No registry, Recent,
opaque-destination, process, or external temporary-root cleanup was attempted by
this archive operation.

The delegated run arc also records a prior orchestrator timeout/staging `ENOENT`
as an excluded packaging incident only. It is not a product failure and is not
used to explain this route's exact `Marshal.SizeOf` exception.

## Archived files

`MANIFEST.sha256` records the SHA-256 of every archived non-empty evidence file.
The empty generated `screenshots/` directory is retained. No opaque Windows shell
file or external disposable artifact is included in this archive.

