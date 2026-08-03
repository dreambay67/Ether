# T09-T12 GUI recovery slice status

Date: 2026-08-03

Status: product implementation candidate complete through T12; Phase 2 gate remains open because the packaged J04/J05 interaction routes are not proven. This is not a release claim.

## Exact candidate identity

- Connection/Inspector implementation: `9d18a30e5e7736dd34f4cf50f9f42eb9ffce181e`.
- Click-to-connect compatibility correction and final packaged product commit: `399dc03d5ddcb4a1ca16121f1a0872cd7c203c32`.
- Installer SHA-256: `bbf94ee8b60027910ce1a6cbad55f2f787a0fa11b72699c27f01d25e0774da3d`.
- Packaged `Ether.exe` SHA-256: `c587338edcecaddae697bb19c44c6d54fa5b48394ec3a4f181165c70f0374b8b`.
- Packaged `app.asar` SHA-256: `06ee589f20adef6c16c704d3e3b4ad92d9ecf2bc7a73d3019b0c5590d80d69b3`.
- Release package audit: 9/9 passed, including independent packaged-byte inventory and staged runtime/MCP closure.

The earlier package at `9d18a30` was a pre-correction build and is not the named Phase 2 candidate. The hashes above identify the corrected `399dc03` package only.

## Implemented product slice

- T09: one durable Module system is locked by default and exposes creation from selection, title, description, accent, collapse, enter/exit, explicit unlock/relock, movement protection, membership transfer, dissolve, and undo.
- T10: the six-channel rails derive from the canonical registry; unconnected handles rest hidden; hover/focus/click or drag intent reveals compatible targets; exact duplicate lanes are rejected while role/selector variants remain legal; roles, endpoints, selectors, selected-lane Inspector, and edge-only context deletion share graph transactions.
- T11: canonical validation resolves named receiver consequences and local/semantic adapters; unavailable capability conversions fail before persistence/run; adapter steps appear in prepared-plan summaries; exhaustive connection-matrix and execution-plan tests cover the cheap semantic breadth.
- T12: registry metadata renders ordinary controls for every canonical Inspector field, with purpose-built Prompt/Worker/provider/drawing/edit/reference workspaces and structured rubric/rule/route/variable/dimension/exclusion controls. Channels and routes are concise; diagnostics/provenance start collapsed; no raw JSON editor is used.

## Focused automated results

- Renderer/testing TypeScript: passed.
- Scoped renderer/kernel/recovery ESLint: passed.
- Unit suite: 23 files, 294/294 passed at the implementation boundary.
- Renderer channel/Inspector model: 6/6 passed after adapter-plan presentation coverage.
- Source canvas journey: 2/2 passed, including click-to-connect compatible-target intent and durable edge creation, lane role/selector/endpoint edits, adapter consequence display, and edge-only right-click deletion preserving node selection.
- Recovery journey driver: 11/11 passed after adding a recorded real right-click action.
- Windows release package audit: 9/9 passed against the exact candidate above.

The older broad `inspectors.spec.ts` route failed twice at its pre-existing `node-status-queued` fixture expectation and was deferred without further iteration. The all-17 source spatial sweep also stopped after two panel-interception failures; exhaustive registry-field coverage remains green and J02 packaged capture stays assigned to T27.

## Practical route accounting

### J05 Module

The packaged blank-authored Module journey at product commit `065a582` lost canvas selection before Create Module (`selectedNodes: 0`, two durable nodes present). Its failed action log/result are retained under `phase-2/module-authoring/packaged/`. The source/unit Module paths pass, but J05 remains PRESENT-UNPROVEN and no Phase 2 gate claim is made.

### J04 Connections

The exact `399dc03` package exposed and captured correct compatible target intent from a blank document. The retained screenshot and action log are under `phase-2/connection-inspector-authoring/packaged/`. Two packaged attempts then failed at the same first target-completion boundary: the target handle was visibly marked compatible, but zero edge paths persisted and no console/page/main-process error was captured. Explicit handle hover did not change the outcome. Per the owner two-failure rule, the route was not rerun.

This record supplies narrow packaged/visual candidate evidence for compatible handle intent (`RX-021`). It does not claim packaged multi-lane, role, deletion, adapter, or Inspector proof. `RX-022` through `RX-024`, J04, and the Phase 2 gate remain PRESENT-UNPROVEN pending the later T27 journey/fix. Source interaction and automated semantic evidence are retained without being mislabeled as packaged success.

## Continuation decision

The two packaged harness gaps do not block independent run-safety and canonical-node work. T13 begins from the corrected package/product boundary while T27 retains final J02/J04/J05 candidate proof. No provider or image-generation call was made.
