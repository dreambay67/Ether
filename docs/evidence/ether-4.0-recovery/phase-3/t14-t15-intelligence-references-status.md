# T14-T15 intelligence and references slice status

Date: 2026-08-09

Status: T14 now has a passing packaged blank-document fake-provider journey. T15 source behavior remains focused-verified, while its packaged Reference Set preview journey is deferred after two harness-only assertion stops. Owner and real-provider evidence remain open. This is not a Phase 3 or release claim.

## Exact product identity

- Worker runtime contract commit: `2b81583`.
- Reference Set canvas-drop commit: `4382c35`.
- Worker and Reference Set Inspector commit: `f2a3052`.
- Sealed Reference Set execution commit: `80c8d5f`.
- Packaged T14-T15 product commit: `87efa2da9cc28f60a43356c66ae0836e3f77c78a`.
- Installer: `release/windows/Ether-4.0.0-Setup.exe`; SHA-256 `33f86e20797ffa8928b4f914c858eee3c700ecc45d51ba5d930c3caf5e1ba5e9`.
- Packaged executable: `release/windows/win-unpacked/Ether.exe`; SHA-256 `3a6e5a193cb1e0e42672a3789a950b72907c87bb3b6a20bfd330de2dd9744169`.
- Packaged application archive: `release/windows/win-unpacked/resources/app.asar`; SHA-256 `6b375f8eecd9206b11ac4e5120b8eb3653c641f0903554331c296bad7579f44f`.
- No real provider or image-generation call was made.
- The two owner-quarantined Explorer-association experiments remain untouched outside the candidate branch.

## T14 implemented product slice

- Production Worker execution consumes the immutable compiled runtime contract: runtime-discovered provider/model and reasoning effort, bounded context policy, memory scope, output channel/count/schema, inspect-first or auto-apply review policy, and downstream capability context.
- Same-run dynamic selectors resolve canonical upstream versions and fail closed when their promised input is unavailable.
- Provider recovery and publication retain the actual resolved input payload IDs and selected upstream output-version IDs.
- Media inputs reach Worker providers through authorized staged paths and declared MIME types; authored downstream configuration remains unchanged.
- Output validation enforces count and structured contract, with one bounded corrective validation retry.
- Recovery simulation now exposes an opt-in deterministic Worker route only when its fresh-profile token is valid. Normal launches remain unchanged.
- Provider-backed Worker/media completions carry their actual provider identity into the scheduler, are rejected on a sealed-binding mismatch, and persist provider/profile/model capability provenance instead of being mislabeled as local work.
- Output Versions subscribes to execution/output events, so a completed run appears without reselecting or remounting the Inspector.

## T15 implemented product slice

- Blank-canvas file drop creates a durable Reference Set; dropping on an existing Reference Set adds members. `.ether` files remain document-open operations.
- The Inspector exposes explicit Link, Embed, Add, Replace, and drop-storage choices. Add never silently replaces.
- Reference Set cards show compact image/video/audio-aware preview or honest unavailable states.
- Run preview seals the exact enabled members, channel, semantic role, edge, order, linked fingerprint, and embedded content identity into plan-specific bindings.
- Dispatch revalidates linked references and rejects missing, relinked, or changed sources before provider execution.
- Linked, embedded-reference, and embedded-artifact sources materialize only inside attempt staging. Linked execution does not silently embed the source in the document.
- Logical `asset-resolution` outputs keep durable, valid input lineage without manufacturing user-visible artifacts or persisting temporary staging paths.
- Reference Set membership is not reread after permit grant; disabled members remain excluded and a later membership edit cannot alter the sealed run.
- Prepared plans show enabled Reference Set member names, order, roles, channels, and source kinds in the concise view; raw IDs and fingerprints remain deliberate expert details.

## Focused automated results

- T14 fake-provider application integration: 6/6 passed, including Prompt -> Worker -> Worker -> Image, approved lineage, authored-config isolation, inspect-first state, and top-level media path/MIME delivery.
- T14 TypeScript checks: document, execution, application, and testing passed.
- T15 canvas file-drop Playwright: 1/1 passed.
- T15 canvas-drop unit test: 1/1 passed.
- T15 sealed Reference Set application integration: 7/7 passed. The added case proves all three source forms, staged byte hashes, channel/role/order/path delivery, disabled-member exclusion, durable downstream input lineage, membership immutability, production embedding, and changed-file failure before fake Worker dispatch.
- T15 builds: schema, document, execution, and application passed.
- Current T14-T15 focused checks passed: execution and desktop TypeScript; deterministic recovery Worker simulation 3/3; execution plan and scheduler 24/24; Inspector browser route 1/1; focused lint and whitespace checks.

## Packaged practical results

- T14 packaged result: PASS, 1/1 in 10.5 seconds from a fresh isolated blank document. The 46-action journey created Prompt -> Worker A -> Worker B -> Image Generator, verified three latest-approved lanes, previewed and permitted exact plans, produced an unreviewed Worker A version, approved it, ran the downstream Worker/Image branch, and inspected durable provider and selected-version lineage.
- T14 evidence: `docs/evidence/ether-4.0-recovery/phase-3/t14-worker-review/t14-worker-review/packaged/` (action log, result, and three screenshots; no captured application errors).
- T15 packaged attempt 1 stopped after the first successful native file selection because the harness matched both the outer pane and inner Reference Desk region.
- T15 packaged attempt 2, after scoping that locator, successfully linked, embedded, and linked three local PNGs through the owned native file dialog and exercised the explicit Add action. It then stopped on stale status-copy text even though the Inspector still showed the expected three saved members. Per the two-failure cadence, the assertion was corrected to check durable membership and the journey was deferred without a third package rerun.
- T15 deferred evidence: `docs/evidence/ether-4.0-recovery/phase-3/t15-reference-set/t15-reference-set-packaged/packaged/` records the second attempt as FAILED with 11 actions and no captured application errors. It does not prove Replace, roles, sealed preview, or the screenshot, so those claims remain unproven in the packaged class.

## Acceptance accounting

- `RX-025` and `RX-026` remain `PRESENT-UNPROVEN`: the packaged fake-provider Worker chain is now strong candidate evidence, while the required owner/real-provider classes remain open.
- J06 remains `PENDING`: its blank-document packaged fake-provider route now passes, while manual/real-provider classes remain T25/T27 work.
- J07 remains `PENDING`: T15 source behavior and partial packaged native-input evidence exist, but the full packaged Reference Set preview plus batch/artifact/manual/real-provider classes remain open.

## Continuation decision

The deferred T15 assertion route does not block independent product work. Continue with the recovery-only deterministic Evaluate facet, then a combined T16-T19 blank-document packaged journey. Revisit the corrected T15 packaged preview at a later visible candidate boundary rather than rerunning this package a third time.
