# T17 Compare, Evaluate, and Filter slice status

Date: 2026-08-09

Status: source implementation and focused automated candidate evidence complete. The 2026-08-09 packaged checkpoint now proves the human Compare, recovery-only deterministic Evaluate, deterministic Filter, and downstream Join path; owner and real-provider evidence remains open. This is not a Phase 3 or release claim.

Current packaged checkpoint: `t16-t19-visible-packaged-status.md`. The sections below preserve the earlier 2026-08-03 source micro-boundary record.

## Exact product identity

- Compare, Evaluate, Filter, and artifact-provenance commit: `030cd64`.
- Package identity: unavailable. No installer was produced for this source slice.
- No real provider or image-generation call was made; provider-facing coverage used deterministic fakes only.
- The two owner-quarantined Explorer-association experiments remain untouched outside the candidate branch.

## Implemented product slice

- Compare checkpoints persist a versioned policy containing the exact candidate output-version IDs, selection mode, minimum selection count, and eventual decision. Malformed non-null waiting policies fail closed.
- Initial and completed selections reject duplicates and non-candidates. One-mode requires exactly one candidate; many-mode enforces its configured minimum. Durable idempotent completion preserves the original policy and decision.
- Review candidates are derived from the inputs actually resolved for the running work item. Artifact Observatory and Compare render only those candidates and use the persisted policy rather than hard-coded selection behavior.
- Compare remains a human checkpoint and does not invoke an LLM or provider.
- Evaluate binds only to a verified `evaluate` capability with Data output. It cannot silently reuse a generic Worker/LLM route, and the desktop capability catalog advertises the distinct operation.
- Evaluate emits structured `ether.evaluation.v1` Data and attaches the matching evaluation item to media passthrough outputs.
- Filter consumes evaluation objects and scored media, resolves nested rule fields, records per-rule explanations and routes, and preserves source payload/output lineage on passthrough results.
- Artifact detail resolves evaluation provenance from the evaluation Data sibling produced by the same attempt, work item, and step, even though media and Data use different output-version IDs.

## Focused automated results

- Review-focused integration: 3 files, 10/10 passed.
- Durable repository coverage proves persisted policy, malformed-policy rejection, duplicate/candidate enforcement, exact-one, minimum-many, decision preservation, idempotence, and sibling evaluation provenance.
- Application routing coverage proves Worker and Evaluate use distinct fake provider identities and capabilities.
- Review runtime coverage proves Evaluate Data and scored media both flow through deterministic Filter with visible matched routes and explanations.
- Document, execution, and application builds passed during the implementation handoff.
- `git diff --check`: passed before the product commit.
- A direct desktop build exceeded its 90-second time budget without producing a diagnostic and was terminated. Per the redirected cadence it was not repeated at this micro-boundary; renderer/package validation remains assigned to the combined visible Phase 3 slice.

## Acceptance accounting

- T17 supplies source and fake-provider breadth for the review portion of J08.
- J08 remains `PENDING`: the review workflow is implemented and focused source-tested, while T19 delivery behavior, packaged/manual evidence, and real-provider classes remain open.
- The Phase 3 gate remains open pending T18-T19, the combined visible package, and the original review task's final installed-app audit.

## Bounded remaining risk

- The focused tests validate review policy and runtime behavior below the renderer, while the direct desktop build timed out without diagnostics. The next visible package must exercise the review UI together with the completed Phase 3 slice.
- Compare candidates are intentionally bound to the resolved checkpoint inputs; compatibility behavior outside the documented Ether 4.0 scope was not invented.

## Continuation decision

The absent packaged, manual, and real-provider evidence does not block independent T18 product work. T18 proceeds with deterministic typed Variables interpolation, practical Batch coverage, and a real Join runtime before the combined Phase 3 package boundary.
