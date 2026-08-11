# Ether 4.0 recovery gate status report

Generated from ledger schema ether-4.0-recovery-ledger@1 at candidate commit `4377c567e52721f8a4a7c52b84f6815031babe44` and canonical app.asar hash `c16491a5ef5bd38ffdeae98921a0d4e191ccfef032b5c6cf2d29f8eec97ccde8`.

This is a gate validator report. It does not approve a phase gate or release.

## Counts by current status

| Status | Count |
| --- | ---: |
| BLOCKED | 0 |
| FAIL | 0 |
| MISSING | 0 |
| OPEN | 0 |
| OWNER-ACCEPTED | 34 |
| PRESENT-UNPROVEN | 0 |
| VERIFIED-AUTO | 0 |
| VERIFIED-PACKAGED | 216 |
| **Total** | **250** |

Release-blocker records: 250; unresolved in the ledger: 0.

## Counts by area

| Area | Total | Status breakdown |
| --- | ---: | --- |
| Automated gate | 8 | VERIFIED-PACKAGED: 8 |
| Document lifecycle | 26 | VERIFIED-PACKAGED: 26 |
| Crash and recovery | 11 | VERIFIED-PACKAGED: 11 |
| Graph editing | 8 | VERIFIED-PACKAGED: 8 |
| Channels and roles | 11 | VERIFIED-PACKAGED: 11 |
| Connection effects | 14 | VERIFIED-PACKAGED: 14 |
| Modules | 4 | OWNER-ACCEPTED: 4 |
| Prompt and LLM Workers | 15 | VERIFIED-PACKAGED: 15 |
| Codex image provider | 7 | VERIFIED-PACKAGED: 7 |
| Antigravity image provider | 9 | VERIFIED-PACKAGED: 9 |
| Provider capability UI | 4 | VERIFIED-PACKAGED: 4 |
| References and batches | 17 | VERIFIED-PACKAGED: 17 |
| Review and artifacts | 15 | OWNER-ACCEPTED: 15 |
| Recipes | 17 | VERIFIED-PACKAGED: 17 |
| Codex plugin and MCP | 11 | VERIFIED-PACKAGED: 11 |
| UI, responsive behavior, accessibility | 14 | VERIFIED-PACKAGED: 14 |
| Performance | 9 | VERIFIED-PACKAGED: 9 |
| Security and packaging | 12 | VERIFIED-PACKAGED: 12 |
| Documentation and release | 8 | OWNER-ACCEPTED: 8 |
| Recovery-specific | 30 | VERIFIED-PACKAGED: 23; OWNER-ACCEPTED: 7 |

## Classification method

T01 baseline triage: historical checked items remain PRESENT-UNPROVEN; explicit rejected-candidate failures are FAIL; each RX item follows the evidence-based recoveryClassification map below; remaining unproven implementation is PRESENT-UNPROVEN.

Historical checked items are retained in `priorEvidence` only and remain PRESENT-UNPROVEN until candidate evidence is rerun. Every requirement carries required evidence classes, owners, release-blocker state, and (for M requirements) J01-J10 owner routes.

Validator gate result: PASS.
