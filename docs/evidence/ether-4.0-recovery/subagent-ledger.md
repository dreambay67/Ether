# Ether 4.0 recovery subagent ledger

This ledger records delegated implementation and independent-review work. A row is not approval; the original review task owns the final product audit and release decision.

| ID | Model | Effort | Assignment | Commit | Findings | Disposition |
| --- | --- | --- | --- | --- | --- | --- |
| T01-ledger | Luna | high | Build the 250-item machine-readable acceptance ledger, baseline classification, deterministic validator, status report, and owner-route mappings. No product behavior edits. | pending | Pending focused validation at baseline. | Implemented in fixer worktree; main worker review required. |
| PH0-review | Sol | high | Independent Phase 0 reviewer: operate the relevant application/evidence workflow first, then inspect T01 ledger, validator, and baseline report. | pending | Pending independent review. | Must review before Phase 0 gate decision; cannot self-approve. |

## Contract

Each implementation row records model, effort, owned scope, exact commit, findings, and disposition. Review rows are assigned before the gate and remain pending until the reviewer reports application-first findings. Status changes must be made by the integration owner after reviewing the returned diff; this file does not replace `ledger.json` evidence.
