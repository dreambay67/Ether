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

Ordinary lifecycle (`A02-001..026` where applicable) starts with a blank document created
and saved by visible installed-app UI. It never substitutes a recovered fixture for ordinary
save/reopen. Recovery fixtures are isolated to the four visible recovery rows at the end.

| ID | Installed-product workflow and practical check | Fixture boundary / P status |
| --- | --- | --- |
| AC-A02-001 | Click New; assert the immediately usable untitled canvas and no picker window. | **P partial:** fresh packaged launch authored directly on the untitled canvas; no picker was observed, but a distinct New-command click is not recorded. |
| AC-A02-002 | Send Ctrl+S to the canvas, drive the Windows Save dialog through UIA, and assert the requested `.ether` path exists. | **P evidence:** `document-lifecycle` actions 3-4 use the native Save dialog and record the requested `.ether` creation. |
| AC-A02-003 | After Save, enumerate the selected directory and assert only the required `.ether` file is needed to reopen. | **P evidence:** `document-lifecycle` action 5 records one `.ether` document and the exact-path reopen passes. |
| AC-A02-004 | Inspect test-owned document directory and isolated AppData after save/reopen for lease/recovery placement. | **P partial:** `document-lifecycle` action 14 records one AppData writer lease; a full packaged directory inventory is not retained. |
| AC-A02-005 | UIA-close a Saved document, assert no prompt, then exact-path reopen writable; separately stage an owned stale operation journal and assert resolution before writable admission. | **P partial:** `document-lifecycle-reopen`/`document-lifecycle-clean-reopen` cover UIA clean close and writable reopen; the separately staged stale-journal case remains planned. |
| AC-A02-006 | Read the saved test-owned `.ether` through the format inspector and record application/marker/format/schema fields. | Planned; structural companion to the installed UI save. |
| AC-A02-007 | Add a node visibly, observe Saving then Saved, hard-kill only after Saved, and exact-path reopen the two-node document. | **P evidence:** `document-lifecycle` actions 15-17 and `document-lifecycle-reopen` action 1/screenshot. |
| AC-A02-008 | Ctrl+S the named document, open Document History, and screenshot `Manual milestone: Manual save`. | **P evidence:** `document-lifecycle` actions 3-7 and `manual-save-history.png`. |
| AC-A02-009 | After Saved, close the exact installed window with UIA `WindowPattern.Close`; assert no unsaved prompt and writable reopen. | **P evidence:** exact UI Automation close is recorded in `document-lifecycle-reopen` action 3; `document-lifecycle-clean-reopen` retains the writable post-close screenshot. |
| AC-A02-010 | Use the installed File > Open command and Windows picker UIA to reopen the valid saved document. | Planned; direct argv is not this proof. |
| AC-A02-011 | Invoke the saved file through Windows shell association (Explorer/UI shell double-click equivalent), then assert the installed Ether window opens that exact title. | **Gap until association is installed and an Explorer/UIA route is implemented; direct packaged argv is explicitly insufficient.** |
| AC-A02-012 | Drag the real saved file from an Explorer/UIA source onto the installed Ether window and assert its title changes. | **Gap until a reliable installed-window OS drag route is implemented; renderer drop injection is insufficient.** |
| AC-A02-013 | With one installed window already owning the document, request the same document through a second shell/instance launch and assert the existing window is foregrounded. | Planned; use a second real process request, not an in-process coordinator call. |
| AC-A02-014 | Hold the document writer in one installed Ether process; launch a second installed process on the exact path and assert visible read-only state/disabled mutators. | **P evidence:** `document-lifecycle-writer-lock` shows the competing installed process with the writer-active explanation and disabled Save. |
| AC-A02-015 | Exercise the native fixed-volume probe timing boundary and capture the fail-closed result. | **Gap: deterministic nine/12-second volume probe control is not available in the installed package.** |
| AC-A02-016 | Click Recent Documents and verify a valid target opens; invoke a Jump List target and missing target through Windows shell UI. | Recent planned; **Jump List/missing-target gap** until shell activation can be automated. |
| AC-A02-017 | Save/reopen a Unicode-and-spaces path via installed UI. | Planned for Unicode/spaces; **long-path/removable/cloud P cases remain gaps** pending controllable Windows fixtures. |
| AC-A02-018 | Save As via installed UIA dialog; assert destination title switches only after complete validation/reopen. | **P evidence:** `document-lifecycle` action 9 and the subsequent writable exact-path reopen. |
| AC-A02-019 | After installed Save As, inspect isolated AppData lease records and verify no surviving source writer lease. | **P partial:** destination lease is recorded in `document-lifecycle` action 14; a dedicated source-lease absence inventory is not retained. |
| AC-A02-020 | Save a Copy via installed UIA dialog; assert the active title remains the source and copy validates/reopens. | **P evidence:** `document-lifecycle` action 10 and the completed destination workflow screenshot. |
| AC-A02-021 | Force a Save As publication failure while preserving source/pre-existing destination, then observe installed UI result. | **Gap: no permitted installed-product fault injection seam yet.** |
| AC-A02-022 | Compact a UI-authored document seeded with graph/artifact/lineage/run/hash data, then inspect all five classes before/after. | **Gap: packaged driver currently seeds only blank-graph content, not the full preservation fixture.** |
| AC-A02-023 | Invoke Compact Document and screenshot actual before/after/reclaimed status; reopen and validate the exact file. | **P partial:** `document-lifecycle` actions 11-13 and screenshot prove the installed invocation/completion; field-level before/after accounting remains automated-only. |
| AC-A02-024 | Move a portable embedded-reference document to a second supported Windows machine/profile and open it installed. | **Gap: no second-machine P environment.** |
| AC-A02-025 | Create available and missing linked references, invoke Make Document Portable, and screenshot count/bytes/missing identity. | **P partial:** `document-lifecycle` action 12 proves the installed zero-reference completion; linked/missing-reference fixture coverage remains a gap. |
| AC-A02-026 | Delete only test-owned Ether cache, provider-staging, and Live Output roots; reopen the saved document and validate project graph/artifacts remain. | **Gap: packaged deletion fixture and artifact-bearing UI document are not implemented.** |
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
