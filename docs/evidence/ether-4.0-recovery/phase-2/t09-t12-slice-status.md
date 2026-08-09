# T09-T12 GUI recovery slice status

Date: 2026-08-09

Status: the T09-T12 product slice and its blank-document packaged J04/J05 journeys pass on one exact package. The Phase 2 gate remains open pending acceptance-ledger reconciliation and the separately owned installed-app review. This is not a release-readiness claim.

## Exact candidate identity

- Product commit: `bae08cceaf90112c3f69b3d1711793cbff74de12` (`fix(canvas): make module authoring durable`).
- Installer SHA-256: `434ce088b26465ff180d16d229163e00c238d000afb9bc8e691a8ca52cde9662`.
- Packaged `Ether.exe` SHA-256: `f7a671203536844320f62777e9294d0ef09cbc2309ce0470a65ceeb87aceaea4`.
- Packaged `app.asar` SHA-256: `41ef1bc200b963ec648131c122e2e6bf21032e856846b9867788bcb9748a835d`.
- Package command: `pnpm.cmd desktop:package:win`.

The older `399dc03`, `065a582`, and `3113bef` packages are diagnostic or intermediate boundaries, not this Phase 2 candidate.

## Implemented product slice

- T09: one durable Module system is locked by default and supports creation from selection, title, description, accent, collapse, enter/exit, explicit unlock/relock, movement protection, membership transfer, dissolve, and undo. Root-graph discovery no longer depends on revision-map order, metadata-only updates do not churn child revisions, Module navigation resists stale root synchronization, and membership counts refresh after changes.
- T10: six registry-backed channel rails support compatible click/drag intent, same-pair multi-lanes, roles, selectors, endpoint edits, selected-lane inspection, and edge-only deletion.
- T11: named connection consequences and local/semantic adapters are visible in authoring and prepared-plan summaries; unsupported conversions fail before persistence or run.
- T12: all 17 registry definitions have ordinary Inspector controls, with deliberate structured editors and collapsed expert diagnostics instead of raw JSON.

## Practical packaged evidence

### J05 Module

- Result: passed, 36 recorded actions, 0 captured errors.
- Start state: ordinary blank document; Prompt and Worker created through the Node Library.
- Demonstrated: locked creation; protected movement; F2 rename; description and Violet highlight; unlock/move; collapse/expand; Enter navigation; interior title and two members; member removal and Shift-additive reassignment; relock; dissolve; Ctrl+Z restoration.
- Evidence: `phase-2/module-authoring/packaged/`.

### J04 Connections and progressive Inspector

- Result: passed, 47 recorded actions, 0 captured errors.
- Start state: ordinary blank document; no seeded graph.
- Demonstrated: compatible six-channel intent; six same-pair lanes; Subject role; edge-only deletion; adapter consequence; collapsed diagnostics; structured Batch controls and deliberate advanced detail.
- Evidence: `phase-2/connection-inspector-authoring/packaged/`.

Both journeys identify product commit `bae08cc` and the same packaged executable hash.

## Focused validation

- Desktop Electron, preload, and renderer TypeScript: passed.
- Scoped changed-file ESLint: passed.
- Source-Electron blank-document Module journey: 1/1 passed.
- Packaged Module journey: 1/1 passed.
- Packaged connection/Inspector journey: 1/1 passed.
- Focused canvas browser regression: 2/2 passed.
- Graph-kernel Module selection: 14/14 matched tests passed.
- Desktop autosave/module metadata regression: 1/1 matched test passed; child graph revision remained unchanged and stale root metadata failed with `REVISION_CONFLICT`.

The broad testing-package TypeScript command still reports unrelated pre-existing errors in `shell-layout.spec.ts`, `review-runtime.test.ts`, `t19-application.test.ts`, and `variables-join.test.ts`. Those files were not changed by T09 and their focused runtime suites were not substituted with a false green claim.

## Continuation decision

T09-T12 packaged behavior is no longer the authoring blocker. Acceptance rows assigned to T09-T12 still require truthful candidate reconciliation, and the original review task retains installed-app gate authority. Independent product work proceeds to T13's immutable Run Preview and Job Center vertical slice. No provider, image-generation, Explorer-association, registry-mutation, or native shell route was invoked.
