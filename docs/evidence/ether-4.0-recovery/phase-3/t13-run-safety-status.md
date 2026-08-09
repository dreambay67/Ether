# T13 run-safety slice status

Date: 2026-08-09

Status: product implementation and packaged blank-document candidate evidence complete for the T13 boundary. This is not a Phase 3 or release claim.

## Exact product and package identity

- Product commit: `2e2d71bf447f6c35f5cbe8f112965368cbff5884`.
- Windows installer: `release/windows/Ether-4.0.0-Setup.exe`.
- Installer SHA-256: `ae6a1eefef3581cdeaff794abebb0855745dd3aae6a46c021d80a594c970b72a`.
- Packaged executable SHA-256: `3b4dac9e451cabe78e44c5b328587388e383b81f72c1d67aa97dc95daaed5bc8`.
- Packaged app archive SHA-256: `2f729c84d8b16bc1b923b78819f0d99219dbbabd4e4cdc7b2ce597367ba652ae`.
- The two owner-quarantined Explorer-association experiments remain untouched outside the candidate branch.

## Implemented product slice

- Public execution scopes include Node, Selected, Branch, Downstream, and an explicit Batch scope whose downstream execution boundary retains its Batch identity in the immutable plan.
- Prepared plans show their plan ID, content hash, exact scope and node boundary, steps, work items, provider calls, concurrency, Batch expansion, providers, sanitized settings, adapters, warnings, resolved inputs, and compiled prompt text.
- Start remains disarmed until an exact plan has been reviewed and a one-use permit matching its plan ID and content hash is issued.
- Prepared plans are bound to graph revision and full run-context identity. Relevant graph or runtime-context changes invalidate an in-flight preview.
- Provider binding now selects the required operation when one provider/profile exposes multiple capabilities; generation and editing can share the same verified profile without selecting the wrong snapshot.
- The packaged recovery simulation is available only to a disposable driver-owned recovery profile with the exact matching token. It uses Ether's offline fake provider and cannot enable itself during an ordinary launch.
- Job Center retains the durable plan identity, work items, attempts, and completion record produced by the explicitly permitted run.

## Practical packaged journey

- Started from a fresh isolated blank document with zero seeded nodes.
- Created Prompt, Image Generator, Image Editor, and Batch through the Node Library; edited the Prompt on canvas; created three channel lanes; selected the offline fake profile; and saved a two-value Batch through visible controls.
- Reviewed Batch, Node, Branch, Downstream, and Selected plans. The observed call counts were 4, 2, 4, 2, and 4 respectively for the authored graph.
- Started only the final reviewed two-call Image Generator plan. Job Center completed with two accepted work items and two attempts.
- Packaged result: 1/1 passed in 12.2 seconds. The committed journey records 41 actions, four screenshots, and no captured renderer or main-process errors.
- Evidence: `phase-3/run-safety/t13-run-safety/packaged/`.

## Focused automated results

- Schema: 17/17 passed.
- Execution planner: 12/12 passed.
- Recovery simulation and Windows launch contracts: 29/29 passed.
- Renderer TypeScript and desktop build: passed.
- Canvas and Inspector focused browser coverage passed before the packaged journey; the packaged journey then exercised the real desktop IPC path.
- Full testing TypeScript remains deferred on the unchanged baseline failures in `desktop/shell-layout.spec.ts`, `review-runtime.test.ts`, `t19-application.test.ts`, and `variables-join.test.ts`.

## Acceptance accounting

- T13 has qualifying automated and packaged candidate evidence for immutable scope preview, exact permit/start, offline execution, and Job Center durability.
- `RX-027` remains `PRESENT-UNPROVEN`: this journey proves packaged completion in Job Center, but it does not provide the separate visual-duration proof that a completed node badge remains visible for ten seconds or the actionable failed-node state.
- `RX-028` remains `MISSING`, `RX-029` remains `FAIL`, and `RX-030` remains `PRESENT-UNPROVEN`; those belong to later recipe, manual-capture, and final owner-review gates.
- No real provider or image-generation call was made.

## Continuation decision

No T13 P0/P1 defect blocks independent product work. Continue directly into the provider-safe T14 Worker GUI journey, then T15 references and the remaining Phase 3 slices. The installed-app audit and release decision remain owned by the original review task.
