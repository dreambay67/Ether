# T03 packaged document-lifecycle coverage plan

Status as of `21f1294`: **no row below has packaged P evidence yet.** The source-Electron
journey is supporting diagnostic evidence only. Every `P` row must launch the installed
`Ether.exe`, record its executable and artifact hashes, and retain screenshots/action logs.

Ordinary lifecycle (`A02-001..026` where applicable) starts with a blank document created
and saved by visible installed-app UI. It never substitutes a recovered fixture for ordinary
save/reopen. Recovery fixtures are isolated to the four visible recovery rows at the end.

| ID | Installed-product workflow and practical check | Fixture boundary / P status |
| --- | --- | --- |
| AC-A02-001 | Click New; assert the immediately usable untitled canvas and no picker window. | Planned; native/UIA observation. |
| AC-A02-002 | Send Ctrl+S to the canvas, drive the Windows Save dialog through UIA, and assert the requested `.ether` path exists. | Planned; native Save dialog, not a dialog-port stub. |
| AC-A02-003 | After Save, enumerate the selected directory and assert only the required `.ether` file is needed to reopen. | Planned; inspect only the test-owned directory. |
| AC-A02-004 | Inspect test-owned document directory and isolated AppData after save/reopen for lease/recovery placement. | Planned; no metadata is accepted beside the document except a genuine interrupted SQLite rollback journal. |
| AC-A02-005 | UIA-close a Saved document, assert no prompt, then exact-path reopen writable; separately stage an owned stale operation journal and assert resolution before writable admission. | Planned; clean and stale cases remain distinct. |
| AC-A02-006 | Read the saved test-owned `.ether` through the format inspector and record application/marker/format/schema fields. | Planned; structural companion to the installed UI save. |
| AC-A02-007 | Add a node visibly, observe Saving then Saved, hard-kill only after Saved, and exact-path reopen the two-node document. | Planned; ordinary UI-authored document. |
| AC-A02-008 | Ctrl+S the named document, open Document History, and screenshot `Manual milestone: Manual save`. | Planned; implemented in the driver but not yet P-run. |
| AC-A02-009 | After Saved, close the exact installed window with UIA `WindowPattern.Close`; assert no unsaved prompt and writable reopen. | Planned; not WM_CLOSE/Alt+F4 emulation. |
| AC-A02-010 | Use the installed File > Open command and Windows picker UIA to reopen the valid saved document. | Planned; direct argv is not this proof. |
| AC-A02-011 | Invoke the saved file through Windows shell association (Explorer/UI shell double-click equivalent), then assert the installed Ether window opens that exact title. | **Gap until association is installed and an Explorer/UIA route is implemented; direct packaged argv is explicitly insufficient.** |
| AC-A02-012 | Drag the real saved file from an Explorer/UIA source onto the installed Ether window and assert its title changes. | **Gap until a reliable installed-window OS drag route is implemented; renderer drop injection is insufficient.** |
| AC-A02-013 | With one installed window already owning the document, request the same document through a second shell/instance launch and assert the existing window is foregrounded. | Planned; use a second real process request, not an in-process coordinator call. |
| AC-A02-014 | Hold the document writer in one installed Ether process; launch a second installed process on the exact path and assert visible read-only state/disabled mutators. | Planned; competing-process/read-only P case. |
| AC-A02-015 | Exercise the native fixed-volume probe timing boundary and capture the fail-closed result. | **Gap: deterministic nine/12-second volume probe control is not available in the installed package.** |
| AC-A02-016 | Click Recent Documents and verify a valid target opens; invoke a Jump List target and missing target through Windows shell UI. | Recent planned; **Jump List/missing-target gap** until shell activation can be automated. |
| AC-A02-017 | Save/reopen a Unicode-and-spaces path via installed UI. | Planned for Unicode/spaces; **long-path/removable/cloud P cases remain gaps** pending controllable Windows fixtures. |
| AC-A02-018 | Save As via installed UIA dialog; assert destination title switches only after complete validation/reopen. | Planned; ordinary UI-authored document. |
| AC-A02-019 | After installed Save As, inspect isolated AppData lease records and verify no surviving source writer lease. | Planned; test-owned AppData only. |
| AC-A02-020 | Save a Copy via installed UIA dialog; assert the active title remains the source and copy validates/reopens. | Planned; ordinary UI-authored document. |
| AC-A02-021 | Force a Save As publication failure while preserving source/pre-existing destination, then observe installed UI result. | **Gap: no permitted installed-product fault injection seam yet.** |
| AC-A02-022 | Compact a UI-authored document seeded with graph/artifact/lineage/run/hash data, then inspect all five classes before/after. | **Gap: packaged driver currently seeds only blank-graph content, not the full preservation fixture.** |
| AC-A02-023 | Invoke Compact Document and screenshot actual before/after/reclaimed status; reopen and validate the exact file. | Planned; ordinary UI-authored document. |
| AC-A02-024 | Move a portable embedded-reference document to a second supported Windows machine/profile and open it installed. | **Gap: no second-machine P environment.** |
| AC-A02-025 | Create available and missing linked references, invoke Make Document Portable, and screenshot count/bytes/missing identity. | **Gap: packaged driver lacks linked-reference fixture/UIA picker setup.** |
| AC-A02-026 | Delete only test-owned Ether cache, provider-staging, and Live Output roots; reopen the saved document and validate project graph/artifacts remain. | **Gap: packaged deletion fixture and artifact-bearing UI document are not implemented.** |
| AC-A03-007 | First create/save the baseline document through installed UI. After close, inject only a test-owned fake-provider staged-output journal/artifact into its isolated AppData, relaunch exact `Ether.exe`, open History, and assert `Recovery revision` plus `Recovered · review required`. | Planned; separate recovery fixture, never used for ordinary reopen. |
| AC-A03-008 | First create/save baseline through installed UI, then corrupt only its metadata fixture; installed reopen must visibly enter read-only recovery or clear unsupported state without source mutation. | Planned; separate corrupt-metadata fixture. |
| AC-A03-010 | First create/save an artifact-bearing baseline through installed UI, then corrupt a media chunk; installed UI must distinguish affected artifact/media from graph corruption. | **Gap: artifact-bearing packaged fixture and distinct visible corruption assertion are not implemented.** |
| AC-A03-011 | First create/save baseline through installed UI, corrupt it in a test-owned fixture, invoke visible repair, and assert a new `.ether` plus report are produced while the damaged source hash is unchanged. | Planned; separate repair fixture. |

## Practical invocation distinctions

- **Association:** `AC-A02-011` requires Windows shell association/Explorer activation. A
  direct `Ether.exe <path>`/argv run only proves argv routing and is recorded separately.
- **Competing writer:** `AC-A02-014` uses two exact installed processes and isolated profile
  evidence; the second process must visibly show read-only mode, not merely return a typed
  service error.
- **Crash:** ordinary recovery kills only the exact package process after a visible Saved
  state, reuses its isolated profile, and reopens the exact saved path. The four recovery
  rows use their own named fixtures and screenshots; they cannot replace the ordinary case.
