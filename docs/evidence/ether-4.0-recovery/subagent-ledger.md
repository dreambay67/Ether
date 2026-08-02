# Ether 4.0 recovery subagent ledger

This ledger records delegated implementation and independent-review work. A row is not approval; the original review task owns the final product audit and release decision.

| ID | Model | Effort | Assignment | Commit | Findings | Disposition |
| --- | --- | --- | --- | --- | --- | --- |
| T01-ledger | Luna | xhigh | Build the 250-item machine-readable acceptance ledger, explicit RX baseline classification, deterministic validator, status report, and owner-route mappings. No product behavior edits. | `1e6879f..1c62613` | 250/250 source records; revised baseline counts are FAIL 19, MISSING 9, PRESENT-UNPROVEN 222; historical 14 remain PRESENT-UNPROVEN; `pnpm.cmd run evidence:validate` and `pnpm.cmd run evidence:validate:self-test` pass; candidate/gate checks enforce hashes, canonical journeys, fixture indicators, and RX reason binding. Main review’s RX triage and journey-contract findings are resolved. | Accepted by main worker after the review corrections in `1d78ef2`/`1c62613`; Phase 0 independent review remains separate and pending. |
| PH0-review | Sol | high | Independent Phase 0 reviewer: operate the relevant application/evidence workflow first, then inspect T01 ledger, validator, and baseline report. | pending | Pending independent review. | Must review before Phase 0 gate decision; cannot self-approve. |

## Contract

Each implementation row records model, effort, owned scope, exact commit, findings, and disposition. Review rows are assigned before the gate and remain pending until the reviewer reports application-first findings. Status changes must be made by the integration owner after reviewing the returned diff; this file does not replace `ledger.json` evidence.
