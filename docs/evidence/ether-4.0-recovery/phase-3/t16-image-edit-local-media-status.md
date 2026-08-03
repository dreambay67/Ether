# T16 image, edit, drawing, and local-media slice status

Date: 2026-08-03

Status: source implementation and focused automated candidate evidence complete for the T16 boundary. Packaged, owner, and real-provider evidence remains open. This is not a Phase 3 or release claim.

## Exact product identity

- Deterministic Mask and Transform runtime commit: `2cf66b4`.
- Image routes, Image Edit request, and Drawing completion commit: `345e46c`.
- Package identity: unavailable. No installer was produced for this source slice.
- No real provider or image-generation call was made; provider-facing coverage used deterministic fakes only.
- The two owner-quarantined Explorer-association experiments remain untouched outside the candidate branch.

## Implemented product slice

- Mask and Transform execute through an application-owned Sharp facet, including resize, crop, rotate, upscale, persisted mask geometry, optional incoming Mask input, and feathering. No remote-provider fallback is selected.
- Scheduler-owned input and output paths are contained, canonicalized, regular-file checked, and read eagerly before Sharp processing. This closes the Windows lazy-path failure and the post-authorization path replacement window.
- Staged local outputs are imported through the durable completion boundary as immutable PNG Image or Mask artifacts with local producer identity, exact input payloads, selected upstream versions, and ordinary artifact lineage.
- Provider-resolver use cannot remove the built-in local-media facet. Logical Reference Set payloads with an authorized staged asset path are accepted without being rewritten as artifacts; escape paths fail closed.
- Provider-mode Mask is rejected during planning with an explicit diagnostic instead of being silently reinterpreted as a local or compatibility route.
- Fresh canonical `codex` Image Generator and Image Edit defaults resolve to the concrete `codex-chatgpt-image-2` runtime identity in planning, main-process routing, and browser-safe Inspector capability matching.
- Image Edit provider requests retain the persisted edit recipe and frame, deriving inpaint or outpaint from the visible workspace instead of always defaulting to inpaint.
- Drawing now supports Brush, Eraser, Select, undo/redo, persistent stroke selection state, and explicit publication as either an Image or a white-selected Mask. Mask publication carries both editable Drawing strokes and derived mask geometry through the validated local-output boundary.

## Focused automated results

- Deterministic local-media integration: 2/2 passed. It proves resized PNG bytes and dimensions, nontrivial brush/eraser mask pixels, local artifact lineage, missing-source failure, provider-resolver preservation, logical Reference Set staged input, and escape-path rejection.
- T16 application/planner/publication integration: 3 files, 19/19 passed. The added cases prove a fresh logical Codex node reaches one deterministic fake-provider request, Image Edit recipe/frame/operation reaches the request, and Drawing Mask publication preserves the validated local artifact contract.
- Drawing browser journey: 1/1 passed through the smoke Playwright configuration. It selects a stroke and publishes both Mask and Image outputs.
- TypeScript: testing, desktop Electron, preload, and renderer checks passed. Schema, providers, graph-kernel, execution, and application builds also passed during the implementation handoff.
- `git diff --check`: passed before both product commits.
- An attempted Drawing invocation through `playwright.desktop.config.ts` reported no matching test because Drawing belongs to the smoke suite. The correct smoke-config run passed; this was a command/configuration mismatch, not a product failure.

## Acceptance accounting

- T16 supplies source and fake-provider breadth for Image Generator, Image Edit, Drawing, Mask, and Transform.
- J01 remains `PENDING`: the source/fake request and immutable-artifact classes are present, while the required packaged/manual/real-provider classes remain open.
- J06 remains `PENDING`: T14 and T16 now supply fake-provider chain and image-route breadth, while packaged/manual/real-provider classes remain open.
- The Phase 3 gate remains open pending T17-T19, fake-provider J07/J08 breadth, the next visible packaged slice, and the original review task's final installed-app audit.

## Bounded remaining risk

- Resize and persisted-geometry Mask have focused end-to-end byte assertions. Crop, rotate, upscale, and stored incoming-Mask branches share the same authorized facet and parameter validation but are not separately exercised by this focused integration file.
- No package was built at this micro-boundary. The next package remains assigned to the combined T16-T19 visible slice rather than a single correction.

## Continuation decision

The absent package, real-provider, and owner evidence does not block independent T17 work. T17 must enforce durable human Compare policy, bind Evaluate to the distinct evaluation capability, and make structured Evaluate data consumable by deterministic Filter before J08 review evidence can advance.
