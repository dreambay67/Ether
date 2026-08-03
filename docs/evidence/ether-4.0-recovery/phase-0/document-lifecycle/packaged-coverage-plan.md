# T03 packaged document-lifecycle coverage plan

Status as of `5417ce1999f04206918ef9aaf8fae1eac2ef33c8`: the bounded packaged
lifecycle and visible-recovery journeys below now have retained `P` evidence. This is
evidence reconciliation only; it does not promote the T01 ledger or approve Phase 0.
Rows marked **P partial** retain an explicit unproved portion. The source-Electron
journey remains supporting diagnostic evidence only. Every `P` row launches the installed
`Ether.exe`, records its executable and archive hashes, and retains screenshots/action logs.

## Current packaged run record

- HEAD: `5417ce1999f04206918ef9aaf8fae1eac2ef33c8`
- Package artifacts: `Ether.exe` SHA-256
  `03db599dbaec1e6d564275cfb63d568dec0189217237efa3ea5e2e99b482580f`; `app.asar`
  SHA-256 `8cc07d197b636b5104da29ffc295313ed64f82082cf2907566f5cbfedafb0a4e`;
  installer SHA-256
  `cf9c66de4c055ccdac1ec7891b57c5f23356a837fff8140824ac0e9b40c01bf4`.
- All retained runs use a fresh isolated profile, 1280x720 viewport, scale 1, and
  record `errors: []`. Read-only postchecks found no exact packaged Fixer `Ether.exe`
  process.
- Lifecycle evidence: [`document-lifecycle`](document-lifecycle/packaged/),
  [`document-lifecycle-writer-lock`](document-lifecycle-writer-lock/packaged/),
  [`document-lifecycle-reopen`](document-lifecycle-reopen/packaged/), and
  [`document-lifecycle-clean-reopen`](document-lifecycle-clean-reopen/packaged/).
- Visible recovery evidence: [`visible-recovery-provider`](../visible-recovery/visible-recovery-provider/packaged/),
  [`visible-recovery-metadata-baseline`](../visible-recovery/visible-recovery-metadata-baseline/packaged/),
  [`visible-recovery-media-repair`](../visible-recovery/visible-recovery-media-repair/packaged/),
  with their three UI-authored baseline records retained beside them.

## A02 normal packaged route reconciliation

The canonical normal A02 evidence was captured at exact evidence identity commit
`14dda6c0aa33398bfdb4424ad21580d67ffd44b1` with the following package identity:

- `release/windows/win-unpacked/Ether.exe` SHA-256
  `03db599dbaec1e6d564275cfb63d568dec0189217237efa3ea5e2e99b482580f`
- `release/windows/win-unpacked/resources/app.asar` SHA-256
  `8cc07d197b636b5104da29ffc295313ed64f82082cf2907566f5cbfedafb0a4e`

The one normal route passed across the retained
[`a02-windows-primary`](../document-windows-integration/a02-windows-primary/packaged/)
and
[`a02-windows-reopen-after-cleanup`](../document-windows-integration/a02-windows-reopen-after-cleanup/packaged/)
records. Both use a fresh isolated profile, 1280x720/scale 1, and `errors: []`;
read-only postflight found an exact packaged-process count of zero. The primary
record covers visible blank-canvas authoring, native Save, one-file/identity
inspection, Save As/lease rebinding, Save a Copy, native File > Open, exact
second-instance focus, and clean close. The reopen record covers removal of named
test-owned cache/staging/live-output roots, document reopen/identity validation,
and post-S1 classification. The primary screenshot was visually inspected and
shows the Unicode/spaces title, Saved status, authored Prompt node, and File > Open
state. Association, Explorer drag, and Jump List approval routes were skipped.

The aggregate Recent snapshot stayed at 208 files: preflight digest
`147b2c54...94c7`, postflight digest `3c270dcb...11e8`. The pre-existing opaque
`CustomDestinations\\590aee7bdd69b59b.customDestinations-ms` (size 6233) changed
from `d739c7...fec2` to `0eee330...a6f` at
`2026-08-03T02:44:29.8032683Z`; it remains preserved with no restore, delete,
overwrite, or timestamp repair. The finalization attempt passed with exact-process
absence proof and no links removed (`removed exact post-S1 target links=0`). This
is bounded packaged evidence only and does not close T03, Phase 0, or owner-M
acceptance.

Ordinary lifecycle (`A02-001..026` where applicable) starts with a blank document created
and saved by visible installed-app UI. It never substitutes a recovered fixture for ordinary
save/reopen. Recovery fixtures are isolated to the four visible recovery rows at the end.

| ID | Installed-product workflow and practical check | Fixture boundary / P status |
| --- | --- | --- |
| AC-A02-001 | Click New; assert the immediately usable untitled canvas and no picker window. | **P partial:** `a02-windows-primary` action 1 authors one node on the blank canvas through visible UI; a distinct New-command/no-picker assertion is not separately recorded. |
| AC-A02-002 | Send Ctrl+S to the canvas, drive the Windows Save dialog through UIA, and assert the requested `.ether` path exists. | **P evidence:** `a02-windows-primary` actions 2-3 use the native Save dialog and validate the requested Unicode/spaces `.ether` document and format identity. |
| AC-A02-003 | After Save, enumerate the selected directory and assert only the required `.ether` file is needed to reopen. | **P evidence:** `a02-windows-primary` action 3 validates one-file format identity; action 6 records document-directory enumeration and the reopen record validates the same document. |
| AC-A02-004 | Inspect test-owned document directory and isolated AppData after save/reopen for lease/recovery placement. | **P evidence:** `a02-windows-primary` action 6 observes the active Save As lease under isolated AppData and no source-path lease beside the document. |
| AC-A02-005 | UIA-close a Saved document, assert no prompt, then exact-path reopen writable; separately stage an owned stale operation journal and assert resolution before writable admission. | **P partial:** `document-lifecycle-reopen`/`document-lifecycle-clean-reopen` cover UIA clean close and writable reopen; the separately staged stale-journal case remains planned. |
| AC-A02-006 | Read the saved test-owned `.ether` through the format inspector and record application/marker/format/schema fields. | **P evidence:** `a02-windows-primary` action 3 validates the Unicode/spaces document with `inspectEtherDocument` and records format/application/schema identity. |
| AC-A02-007 | Add a node visibly, observe Saving then Saved, hard-kill only after Saved, and exact-path reopen the two-node document. | **P evidence:** `document-lifecycle` actions 15-17 and `document-lifecycle-reopen` action 1/screenshot. |
| AC-A02-008 | Ctrl+S the named document, open Document History, and screenshot `Manual milestone: Manual save`. | **P evidence:** `document-lifecycle` actions 3-7 and `manual-save-history.png`. |
| AC-A02-009 | After Saved, close the exact installed window with UIA `WindowPattern.Close`; assert no unsaved prompt and writable reopen. | **P partial:** `a02-windows-primary` action 14 sends native Alt+F4 after Saved and `a02-windows-reopen-after-cleanup` reopens/validates the document; the normal record does not retain a separate prompt screenshot. |
| AC-A02-010 | Use the installed File > Open command and Windows picker UIA to reopen the valid saved document. | **P evidence:** `a02-windows-primary` actions 9-12 send native Ctrl+O and retain a screenshot of the File > Open result showing the original Unicode/spaces document. |
| AC-A02-011 | Invoke the saved file through Windows shell association (Explorer/UI shell double-click equivalent), then assert the installed Ether window opens that exact title. | **Gap until association is installed and an Explorer/UIA route is implemented; direct packaged argv is explicitly insufficient.** |
| AC-A02-012 | Drag the real saved file from an Explorer/UIA source onto the installed Ether window and assert its title changes. | **Gap until a reliable installed-window OS drag route is implemented; renderer drop injection is insufficient.** |
| AC-A02-013 | With one installed window already owning the document, request the same document through a second shell/instance launch and assert the existing window is foregrounded. | **P evidence:** `a02-windows-primary` action 13 records the exact second `Ether.exe` requester exiting after routing the document to the existing primary window. |
| AC-A02-014 | Hold the document writer in one installed Ether process; launch a second installed process on the exact path and assert visible read-only state/disabled mutators. | **P evidence:** `document-lifecycle-writer-lock` shows the competing installed process with the writer-active explanation and disabled Save. |
| AC-A02-015 | Exercise the native fixed-volume probe timing boundary and capture the fail-closed result. | **Gap: deterministic nine/12-second volume probe control is not available in the installed package.** |
| AC-A02-016 | Click Recent Documents and verify a valid target opens; invoke a Jump List target and missing target through Windows shell UI. | Recent planned; **Jump List/missing-target gap** until shell activation can be automated. |
| AC-A02-017 | Save/reopen a Unicode-and-spaces path via installed UI. | **P partial:** `a02-windows-primary` actions 2-8 save, Save As, and copy Unicode/spaces paths; long-path/removable/cloud P cases remain gaps. |
| AC-A02-018 | Save As via installed UIA dialog; assert destination title switches only after complete validation/reopen. | **P evidence:** `a02-windows-primary` actions 5-6 complete Save As through the native picker and observe the destination lease/title only after validation. |
| AC-A02-019 | After installed Save As, inspect isolated AppData lease records and verify no surviving source writer lease. | **P evidence:** `a02-windows-primary` action 6 records source lease release and destination lease activation under isolated AppData, never beside the document. |
| AC-A02-020 | Save a Copy via installed UIA dialog; assert the active title remains the source and copy validates/reopens. | **P evidence:** `a02-windows-primary` actions 7-8 save and validate a second Unicode/spaces `.ether` while retaining the Save As title as active. |
| AC-A02-021 | Force a Save As publication failure while preserving source/pre-existing destination, then observe installed UI result. | **Gap: no permitted installed-product fault injection seam yet.** |
| AC-A02-022 | Compact a UI-authored document seeded with graph/artifact/lineage/run/hash data, then inspect all five classes before/after. | **Gap: packaged driver currently seeds only blank-graph content, not the full preservation fixture.** |
| AC-A02-023 | Invoke Compact Document and screenshot actual before/after/reclaimed status; reopen and validate the exact file. | **P partial:** `document-lifecycle` actions 11-13 and screenshot prove the installed invocation/completion; field-level before/after accounting remains automated-only. |
| AC-A02-024 | Move a portable embedded-reference document to a second supported Windows machine/profile and open it installed. | **Gap: no second-machine P environment.** |
| AC-A02-025 | Create available and missing linked references, invoke Make Document Portable, and screenshot count/bytes/missing identity. | **P partial:** `document-lifecycle` action 12 proves the installed zero-reference completion; linked/missing-reference fixture coverage remains a gap. |
| AC-A02-026 | Delete only test-owned Ether cache, provider-staging, and Live Output roots; reopen the saved document and validate project graph/artifacts remain. | **P partial:** `a02-windows-reopen-after-cleanup` removes named test-owned cache/staging/live-output sentinels and reopens/validates the graph and identity; an artifact-bearing packaged fixture remains open. |
|  |  | The four recovery rows immediately below retain their broad fixture definitions; see **Reconciled visible-recovery P evidence** for the current run's bounded packaged records and remaining boundaries. |
| AC-A03-007 | First create/save the baseline document through installed UI. After close, inject only a test-owned fake-provider staged-output journal/artifact into its isolated AppData, relaunch exact `Ether.exe`, open History, and assert `Recovery revision` plus `Recovered · review required`. | **P evidence:** `visible-recovery-provider` shows the review-required recovery revision in packaged Document History; its UI-authored baseline is retained separately. |
| AC-A03-008 | First create/save baseline through installed UI, then corrupt only its metadata fixture; installed reopen must visibly enter read-only recovery or clear unsupported state without source mutation. | **P evidence:** `visible-recovery-metadata-baseline` records native unsupported-metadata handling and preserves the valid active baseline screenshot. |
| AC-A03-010 | First create/save an artifact-bearing baseline through installed UI, then corrupt a media chunk; installed UI must distinguish affected artifact/media from graph corruption. | **P evidence:** `visible-recovery-media-repair` preview and completion screenshots separate media/artifact losses from graph losses; the artifact/media baseline is retained. |
| AC-A03-011 | First create/save baseline through installed UI, corrupt it in a test-owned fixture, invoke visible repair, and assert a new `.ether` plus report are produced while the damaged source hash is unchanged. | **P evidence:** `visible-recovery-media-repair` completion report states a new repaired document and unchanged damaged source. |

## Reconciled visible-recovery P evidence

The retained visible-recovery records add packaged evidence for the four recovery
requirements without changing the broader fixture plans above:

| Requirement | Current packaged record | Boundary still open |
| --- | --- | --- |
| AC-A03-007 | `visible-recovery-provider` shows `Recovered artifact - review required` in packaged Document History; its UI-authored baseline is retained. | Full staged-provider fixture provenance remains in the adjacent harness record. |
| AC-A03-008 | `visible-recovery-metadata-baseline` records the native unsupported-metadata error and a valid active baseline after the error. | Read-only recovery versus unsupported-state variants remain distinct cases. |
| AC-A03-010 | `visible-recovery-media-repair` preview and completion screenshots separate media/artifact losses from graph losses. | This is the packaged media-loss fixture only; other corruption classes remain open. |
| AC-A03-011 | `visible-recovery-media-repair` completion report states a new repaired document and unchanged damaged source. | Report file/hash inspection remains supporting harness evidence. |

## Practical invocation distinctions

- **Association:** `AC-A02-011` requires Windows shell association/Explorer activation. A
  direct `Ether.exe <path>`/argv run only proves argv routing and is recorded separately.
- **Competing writer:** `AC-A02-014` uses two exact installed processes and isolated profile
  evidence; the second process must visibly show read-only mode, not merely return a typed
  service error.
- **Crash:** ordinary recovery kills only the exact package process after a visible Saved
  state, reuses its isolated profile, and reopens the exact saved path. The four recovery
  rows use their own named fixtures and screenshots; they cannot replace the ordinary case.
