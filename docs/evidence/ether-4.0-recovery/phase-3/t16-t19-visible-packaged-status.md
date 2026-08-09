# T16-T19 visible packaged slice status

Date: 2026-08-09

Status: PASSED on one newly packaged, fresh-profile, blank-document journey. This is a practical Phase 3 checkpoint, not a Phase 3 gate closure, installed-app audit, real-provider result, or release-readiness claim.

## Exact candidate identity

- Product and journey commit: `db4dae9bc51badbb9576def813ec6e40341b0a8f`.
- Installer: `release/windows/Ether-4.0.0-Setup.exe`.
- Installer SHA-256: `103f398bcd4efb35ca429d21d6720cc9ba1858d57bf89cdd49e98326ba53d641`.
- Packaged executable: `release/windows/win-unpacked/Ether.exe`.
- Packaged executable SHA-256: `b63768f707b0c4569fde1a50e012c779a3779de7b594316f6d34cce8028f0225`.
- `app.asar` SHA-256: `fd08883ec95025e23d03d4fd2607eb985d995623d3052c928147c7b3ab8b9788`.
- The installer was built but not launched.

## Practical packaged result

Command: `pnpm.cmd test:t16-t19-visible:packaged`

Result: PASS, 1/1 in 20.9 seconds. The journey recorded 102 ordinary visible actions from a fresh isolated blank document, captured two screenshots, and recorded no console, renderer, or main-process errors.

The journey visibly proved:

- registry creation of Variables, Prompt, Image Generator, Transform, Compare, Evaluate, Filter, Batch, Join, Collection, and Export from a blank document;
- typed Variables input and interpolation preview, direct Prompt editing, and eight ordinary channel connections;
- explicit `latest` selectors for unreviewed local/review intermediates and explicit approval before the Image Generator output crossed a `latest-approved` lane;
- one inspect-first, one-call fake Image Generator plan bound to `ether-fake-local` / `fake-image-default`;
- one inspect-first Transform branch with local Transform, a durable human Compare checkpoint, recovery-only `ether-fake-local-evaluation` / `deterministic-evaluation-v1`, deterministic Filter, and Join completion;
- visible Evaluate instruction/rubric/model configuration and deterministic Filter rule/route explanations;
- a two-cell isolated Batch grid/setup preview, sequential policy, and one durable exclusion;
- graph Collection and Export node setup, separately from a Review-workspace collection and its direct Export dialog;
- non-destructive membership of two loaded artifacts in `Campaign selects` and a disabled direct Export action until the user explicitly chooses a folder.

## Deliberate limits

- No real provider, image-generation service, native folder picker, filesystem export, registry, Explorer association, Jump List, or native drag route was invoked.
- The recovery-only fake evaluation facet is reachable only through the already token-gated recovery simulation launch. Normal application launch behavior is unchanged.
- The isolated Batch was not represented as an executable batch plan. It proves its grid, exclusion, and concurrency setup only.
- Packaged Image Edit, Drawing, Mask, Batch execution, Live Output, actual graph Collection/Export execution, and real folder publication remain unproven by this journey.
- Graph Collection/Export configuration and Review-side collection/direct Export are separate product surfaces; the evidence does not imply automatic linkage between them.
- The Review Evaluate panel retains Codex-oriented route copy. This checkpoint treats it as instruction/rubric/model configuration evidence; the prepared plan provides the visible recovery provider identity.

## Focused validation

- Execution typecheck: passed.
- Desktop typecheck and lint: passed.
- Deterministic evaluation simulation: 4/4 passed.
- Execution-plan integration: 14/14 passed.
- Source-Electron form of the exact journey: 1/1 passed after the final evidence-strengthening assertions.
- Packaged form of the exact journey: 1/1 passed on the first package attempt.
- Focused journey lint and `git diff --check`: passed.
- The broad `@ether/testing` typecheck remains red in previously recorded unrelated test typing under shell-layout, the T13 Batch hash case, review-runtime, T19 application fixtures, and variables/Join. Focused changed behavior and the packaged journey are green; this baseline does not convert those unrelated rows to passed.

## Evidence

- `docs/evidence/ether-4.0-recovery/phase-3/t16-t19-visible/t16-t19-visible-packaged/packaged/action-log.md`
- `docs/evidence/ether-4.0-recovery/phase-3/t16-t19-visible/t16-t19-visible-packaged/packaged/result.json`
- `docs/evidence/ether-4.0-recovery/phase-3/t16-t19-visible/t16-t19-visible-packaged/packaged/screenshots/01-image-transform-review-plan.png`
- `docs/evidence/ether-4.0-recovery/phase-3/t16-t19-visible/t16-t19-visible-packaged/packaged/screenshots/02-review-collections-export-gate.png`

## Continuation decision

This checkpoint is sufficient to continue to T20 without stopping for a Phase 3 or release claim. T20 must use one later package for all 12 recipe journeys and must not fabricate reference membership, provider execution, folder grants, or export completion where the ordinary product UI has not supplied them.
