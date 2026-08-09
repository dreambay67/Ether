# Ether 4.0 recovery candidate-boundary status — 2026-08-09

This record consolidates the practical package boundary without making a release-readiness claim. It preserves failed and partial journeys as diagnostic evidence; none of the rows below may be promoted to verified or owner-accepted solely from this summary.

## Final candidate reconciliation — 2026-08-10

This section supersedes the package identity for the final candidate only. The historical package records and partial or failed outcomes below remain preserved as evidence of their own boundaries; they are not rewritten as final-candidate proof.

### Final package identity

- Candidate product and harness commit: `9acd1bb81b7f21f6fd36af71158041a2e8ca00f2`.
- `release/windows/win-unpacked/Ether.exe`: `041d80aff7402348bd5aeae718f4784d4aa545efc597ae2b21b56e7918997023`.
- Canonical `release/windows/win-unpacked/resources/app.asar`: `c604e44d467f7e4114bb02299bb218b48c4827fd9f394a70dead872e2d9d36bb`.
- Installer `release/windows/Ether-4.0.0-Setup.exe`: `6583d153f780da81009d1b4d3dca503becf415e980bf59b6e2589b362f205fa6`.
- Final package audit: 9/9 passed, recorded in [the final candidate package audit](phase-6/t28-final-package-audit-9acd.md).

The final installer was recorded as a package artifact for reconciliation. This record does not claim that it was launched or that the original review task's installed-app and owner-acceptance gates were completed.

### Final packaged journey reconciliation

| Journey or boundary | Final-candidate result | Scope and remaining status |
| --- | --- | --- |
| Blank GUI checkpoint | PASS | The packaged blank-document checkpoint passed. It remains evidence only for its recorded action coverage and does not itself close J02/J03 or any manual route. |
| Module authoring | PASS | The packaged Module journey passed. Manual-owner requirements remain `PRESENT-UNPROVEN`. |
| T13 run safety | PASS | The packaged fake-local run-safety slice passed; it does not substitute for a real-provider result or owner route. |
| T14 Worker review | PASS | The packaged fake-local Worker slice passed; it does not substitute for a real-provider result or owner route. |
| T16–T19 visible slice | PASS with captured infrastructure warning | The packaged fake-local visible slice completed, while its log captured one Electron network-service crash/restart with no user-visible journey failure. It is not evidence of a real provider, native folder selection, filesystem export, crash-free operation, or owner acceptance. |
| Connection Inspector | DEFERRED / `PRESENT-UNPROVEN` | The second final attempt reached the structured Batch Inspector, then hit a stale-disclosure failure. It is not recorded as a passing connection journey. |
| T15 Reference Set | `PRESENT-UNPROVEN` | The product default was fixed and the final package visibly showed Image enabled. The later attempt timed out before the lane and sealed-preview steps, so it does not establish the full Reference Set journey. |
| Document lifecycle | `PRESENT-UNPROVEN` | The packaged attempt timed out with Ether still alive and the blank document showing `Saved`; it is not a passed lifecycle/recovery journey. |

No real provider or image-generation call was launched during this final-candidate boundary. Accordingly, no `R` evidence is claimed here, and no ledger status is changed by this reconciliation.

## Package identity

- Packaged product commit recorded by the current-package journeys: `2dd2fd54e60e421386f9bba92b8d331fbd46b748`.
- `release/windows/win-unpacked/Ether.exe`: `2d90842c3b03c131567522e8cd9b63b31064cb97fa52d4c1b31bb1d7e19337ec`.
- Canonical `release/windows/win-unpacked/resources/app.asar`: `f1823e2bde697e2cc8fa55add7b1d71be99fb19369e3234ca7599ee6963ae875`.
- Provisional installer `release/windows/Ether-4.0.0-Setup.exe`: `0c64425960a92ae9508964828e0ee8095550011286aac35a7ae5377eb31954ea`.
- The installer was built but not launched. The original review task retains the final installed-app audit.

Later commits in this branch change recovery harnesses, evidence, and the fail-closed ledger validator only. They do not change the packaged production closure. The package inventory check must be rerun at handoff to bind that closure to the final integration commit.

## Practical outcomes

| Task | Outcome | Factual boundary |
| --- | --- | --- |
| Phase 1 blank GUI checkpoint | PASS on the current package | Fresh packaged blank document completed the practical authoring checkpoint, including the 17-node Library, marquee/movement, direct editing, commands, and screenshots. |
| T20 recipes | 11/12 PASS on the preceding package | Eleven blank-document recipe journeys passed. Curate, Collect, and Export reached its explicit folder action, then the owner-scoped native folder helper failed to resolve the Windows dialog on both allowed attempts. Source/fake-local Curate behavior passed. The packaged native-folder sub-proof remains PRESENT-UNPROVEN. |
| T21 plugin co-production | FAILED/PRESENT-UNPROVEN | Both allowed packaged attempts stopped before any action because Windows refused the exact Ether window foreground transition needed for the native Codex menu. No permit, MCP mutation, graph edit, provider action, or run occurred. |
| T22 shell matrix | PARTIAL/PRESENT-UNPROVEN | The 1920×1080/100% packaged point progressed through workspaces and blank authoring. Two allowed attempts then failed distinct geometry assertions (intentional resize hit band, followed by minimap inset 31 px versus the asserted 16 px). The remaining matrix points were not claimed. |
| T23 keyboard | PARTIAL/PRESENT-UNPROVEN | The product defect that suppressed native Enter activation was fixed and regression-tested. On the final package attempt both journeys used Enter to create Library nodes. J06 then lacked the expected compatible receiver state after keyboard-starting a lane; J03 inserted Quick Add but did not return focus to the canvas. No further rerun was made. |
| T24 performance | PARTIAL/PRESENT-UNPROVEN | All seven deterministic files passed (9 tests), packaged inventory rejection passed, and cold start passed with 612.64 ms median / 723.88 ms max. The 1,000-node packaged case passed document open, graph hydration, and autosave budgets, but one wall-hydration trial exceeded the strict 2,000 ms maximum on both attempts: 2,065.38 ms, then 2,081.06 ms. Medians were 1,363.09 ms and 1,510.68 ms. |
| T25 manual | PARTIAL/PRESENT-UNPROVEN | The fresh packaged GUI checkpoint passed. Manual capture produced five screenshots through direct editing, all six channel lanes and Subject role, and a locked Module. Attempt one timed out because the old script focused the title rather than the explicit body-edit control; the corrected final attempt passed that boundary and stopped on the duplicate accessible name `Reference Desk`. The locator is corrected for future review, but no third run was made. Manifest, rebuilt PDF, and PDF verification were not claimed. |

## Redirected retry accounting

The owner redirect requires a peripheral test to be recorded and deferred after two failures. T20 Curate native folder, T21 native foreground, T22 packaged geometry, T23 packaged keyboard, T24 strict maximum, and T25 manual capture each reached that limit. These are preserved as PRESENT-UNPROVEN rather than converted into passing evidence or retried through another shell/package loop.

## T26–T28 consequence

The hardened ledger validator must fail the release gate while these release blockers remain nonterminal. Candidate mode also keeps every `M` requirement nonterminal until the product owner records exact J01–J10 route evidence. T27 in this fixer task is limited to preparing an honest handoff route; it does not supersede the original review task's installed-app or owner-acceptance authority.
