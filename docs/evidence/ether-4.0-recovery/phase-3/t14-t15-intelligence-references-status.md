# T14-T15 intelligence and references slice status

Date: 2026-08-03

Status: source implementation and focused automated candidate evidence complete for the T14 Worker and T15 Reference Set boundaries. Packaged, owner, and real-provider evidence remains open. This is not a Phase 3 or release claim.

## Exact product identity

- Worker runtime contract commit: `2b81583`.
- Reference Set canvas-drop commit: `4382c35`.
- Worker and Reference Set Inspector commit: `f2a3052`.
- Sealed Reference Set execution commit: `80c8d5f`.
- Package identity: unavailable. No installer was produced for this source slice.
- No real provider or image-generation call was made.
- The two owner-quarantined Explorer-association experiments remain untouched outside the candidate branch.

## T14 implemented product slice

- Production Worker execution consumes the immutable compiled runtime contract: runtime-discovered provider/model and reasoning effort, bounded context policy, memory scope, output channel/count/schema, inspect-first or auto-apply review policy, and downstream capability context.
- Same-run dynamic selectors resolve canonical upstream versions and fail closed when their promised input is unavailable.
- Provider recovery and publication retain the actual resolved input payload IDs and selected upstream output-version IDs.
- Media inputs reach Worker providers through authorized staged paths and declared MIME types; authored downstream configuration remains unchanged.
- Output validation enforces count and structured contract, with one bounded corrective validation retry.

## T15 implemented product slice

- Blank-canvas file drop creates a durable Reference Set; dropping on an existing Reference Set adds members. `.ether` files remain document-open operations.
- The Inspector exposes explicit Link, Embed, Add, Replace, and drop-storage choices. Add never silently replaces.
- Reference Set cards show compact image/video/audio-aware preview or honest unavailable states.
- Run preview seals the exact enabled members, channel, semantic role, edge, order, linked fingerprint, and embedded content identity into plan-specific bindings.
- Dispatch revalidates linked references and rejects missing, relinked, or changed sources before provider execution.
- Linked, embedded-reference, and embedded-artifact sources materialize only inside attempt staging. Linked execution does not silently embed the source in the document.
- Logical `asset-resolution` outputs keep durable, valid input lineage without manufacturing user-visible artifacts or persisting temporary staging paths.
- Reference Set membership is not reread after permit grant; disabled members remain excluded and a later membership edit cannot alter the sealed run.

## Focused automated results

- T14 fake-provider application integration: 6/6 passed, including Prompt -> Worker -> Worker -> Image, approved lineage, authored-config isolation, inspect-first state, and top-level media path/MIME delivery.
- T14 TypeScript checks: document, execution, application, and testing passed.
- T15 canvas file-drop Playwright: 1/1 passed.
- T15 canvas-drop unit test: 1/1 passed.
- T15 sealed Reference Set application integration: 7/7 passed. The added case proves all three source forms, staged byte hashes, channel/role/order/path delivery, disabled-member exclusion, durable downstream input lineage, membership immutability, production embedding, and changed-file failure before fake Worker dispatch.
- T15 builds: schema, document, execution, and application passed.
- The earlier broad Inspector route remains deferred after two stale-fixture/overlay failures recorded at the T13 boundary; it was not rerun as a substitute for these focused checks.

## Acceptance accounting

- `RX-025` remains `PRESENT-UNPROVEN`: automated source evidence exists, but its required packaged and owner evidence is not yet present.
- `RX-026` remains `PRESENT-UNPROVEN`: automated serial-lineage behavior exists, but qualifying packaged evidence is not yet present.
- J06 remains `PENDING`: T14 supplies fake-provider runtime breadth, while packaged/manual/real-provider classes remain T16/T27 work.
- J07 remains `PENDING`: T15 supplies reference setup and sealed fake-provider input breadth, while batch, artifact acceptance, packaged/manual, and real-provider classes remain T18/T19/T27 work.

## Continuation decision

The absent package and owner/provider evidence do not block independent T16 product work. T16 must complete deterministic Mask/Transform output and the provider-facing image slice before the Phase 3 gate can be evaluated.
