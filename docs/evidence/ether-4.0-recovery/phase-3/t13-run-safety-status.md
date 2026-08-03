# T13 run-safety slice status

Date: 2026-08-03

Status: product implementation candidate complete for the T13 source boundary. Packaged and owner-facing run proof remains open. This is not a Phase 3 or release claim.

## Exact product identity

- Product commit: `72c175a28bfcf4484745b4e223c19480aea789d7`.
- Package identity: unavailable. No new installer was produced by this slice.
- The two quarantined Explorer-association experiments remain untouched outside the candidate branch.

## Implemented product slice

- Public execution scopes now include Node, Selected, Branch, and Downstream; the Batch Inspector deliberately previews the branch rooted at its Batch resolver.
- Downstream scope is preserved in the immutable plan instead of being rewritten to an opaque selected-node scope.
- Node and selected-run surfaces share a concise immutable preview: exact scope, boundary node IDs, steps, work items, provider calls, concurrency, providers, adapters, warnings, resolved inputs, and compiled prompt text.
- Blocking warnings disarm Start. Every Start still requires a permit matching the reviewed plan ID and content hash.
- Prepared plans are bound to the visible document, graph, node/selection, configuration, and scope. Context changes invalidate in-flight previews; malformed or failed refreshes disarm stale plans.
- Job Center reuses the same immutable preview model. Node badges refresh on plan, job, work-item, and attempt events; waiting-review is distinct from needs-attention; completed badges retain the existing ten-second expiry.

## Focused results

- Desktop renderer TypeScript: passed.
- Testing TypeScript: passed.
- Scoped ESLint: passed.
- Schema, planner, and renderer presentation suites: 3 files, 31/31 passed.
- Source canvas before the richer preview assertion: 2/2 passed.
- The enriched selected-run route visibly reached Selected scope, one step, one work item, one provider call, concurrency two, boundary ID, and provider identity. Its deliberate compiled-step summary was then clipped by an older overlay grid rule on two attempts. The isolated one-column/scroll correction is committed but was not rerun under the two-attempt rule.
- The broad Inspector fixture initially omitted typed response names and never hydrated. After that fixture correction, the single independent review run reached a later stale `Style to Image` expectation; it also observed an unrelated Reference Desk fixture error. No T13-specific Inspector assertion failure was reproduced.
- The single Windows package operation did not produce an installer. A short command wrapper left the actual package process active; a later command correctly refused the overlap. The background operation subsequently exited and cleaned its lock/staging/output. No third package launch was made.

## Acceptance accounting

- T13 source implementation is present and focused automated coverage is green.
- `RX-027` remains `PRESENT-UNPROVEN`: packaged and visual duration/actionability proof is still required.
- `RX-028` remains `MISSING`, `RX-029` remains `FAIL`, and `RX-030` remains `PRESENT-UNPROVEN`.
- J01, J06, J07, and J08 remain open. No real provider or image-generation call was made.

## Continuation decision

The absent package and deferred browser-detail proof do not block independent T14 product work. T14 must wire the existing intelligence context/profile/output contracts into production Worker execution before any J06 claim; current unit-only intelligence contracts are not sufficient evidence.
