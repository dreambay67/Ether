# T18-T19 visible slice status

Date: 2026-08-03

Status: source behavior focused-verified; packaged blank-document checkpoint passed; Phase 3 remains open.

## Delivered boundary

- `70569b2524c81602729317df5d09e3d73eb3b518` — typed upstream-scoped variables, explicit `${name}` interpolation with `$${name}` escaping, missing/invalid variable failure, and the dedicated ordered/merge/zip Join runtime.
- `35ce5bc` — automatic durable Live Output refresh for artifact and collection events, deterministic collection paths, hierarchical safe export placeholders, and concise export guidance.
- `2ac1d37fde3d21e27f544131db8053c4f628681a` — registers the T18 variables/Join test in the normal integration suite. This is the exact packaged source commit.

## Focused validation

Command:

`pnpm.cmd --dir packages/testing exec vitest run --config vitest.integration.config.ts tests/variables-join.test.ts tests/application-contract-4.0.test.ts tests/live-output.test.ts tests/t19-application.test.ts`

Result: PASS — 4 files, 24 tests.

The package build also completed the desktop production build and its transitive schema, graph-kernel, document, provider, intelligence, execution, recipe, application, and MCP builds.

## Exact Windows package

- Source commit: `2ac1d37fde3d21e27f544131db8053c4f628681a`
- Installer: `release/windows/Ether-4.0.0-Setup.exe`
- Installer SHA-256: `70676474bbe00b5558456d1d46366a0c6b70a13fc77ed09f72a619f4eb722254`
- Packaged executable: `release/windows/win-unpacked/Ether.exe`
- Packaged executable SHA-256: `d50505a3a122a01a1cd58a15ab9c41fc5edeb450662fc895ce36b2b3f3c66646`
- `app.asar` SHA-256: `f3bbeeca22c5d40e0f13abff55f353ec566a0a255c97cf232526b33e262408f6`

No installer was launched. No registry, association, Explorer, Jump List, native drag, or provider route was exercised.

## Practical packaged journey

Command: `pnpm.cmd test:gui-checkpoint:packaged`

Final result: PASS — one Playwright journey from a fresh isolated blank document.

The journey visibly proved the registry-backed 17-node library, ordinary node movement, left-drag marquee, Shift-additive marquee, direct rename/content editing, duplicate/copy/paste/delete/select-all/undo/redo shortcuts, command palette, and the safe provider-capability guard without starting provider work.

Evidence:

- `docs/evidence/ether-4.0-recovery/phase-1/blank-gui-checkpoint/packaged/action-log.md`
- `docs/evidence/ether-4.0-recovery/phase-1/blank-gui-checkpoint/packaged/result.json`
- `docs/evidence/ether-4.0-recovery/phase-1/blank-gui-checkpoint/packaged/screenshots/01-blank-library.png`
- `docs/evidence/ether-4.0-recovery/phase-1/blank-gui-checkpoint/packaged/screenshots/02-marquee-and-movement.png`
- `docs/evidence/ether-4.0-recovery/phase-1/blank-gui-checkpoint/packaged/screenshots/03-direct-editing.png`
- `docs/evidence/ether-4.0-recovery/phase-1/blank-gui-checkpoint/packaged/screenshots/04-all-17-node-types.png`
- `docs/evidence/ether-4.0-recovery/phase-1/blank-gui-checkpoint/packaged/screenshots/05-command-palette.png`

The first packaged journey attempt stopped only because its assertion still expected the older phrase “Worker or evaluation provider capability”; the product correctly displayed the narrower Worker capability guard. The assertion was reconciled to the current product copy and the same packaged build passed on the single rerun.

## Remaining truthful limits

- This packaged journey is the required blank authoring checkpoint, not an installed-app audit and not release readiness.
- T18/T19 runtime behavior is covered by focused deterministic tests; no real provider was called.
- Live Output updates collection and membership paths automatically. The current repository has no entry-delete API, so an artifact deleted from the document can leave a stale mirror manifest entry until an explicit rebuild/reconcile. This is recorded for later recovery work rather than hidden.
- T20 and later recovery tasks remain open.
