# Ether 4.0 recovery baseline status report

Generated from ledger schema ether-4.0-recovery-ledger@1 at source baseline commit `03beeadad2ce494ca6b972791ce554a8a3b7e552` (recovery-plan baseline `537607ebc2ad4bdec476fbb987a38fadf268b125`).

This is a Phase 0 triage report. It does not approve a phase gate or release.

## Counts by current status

| Status | Count |
| --- | ---: |
| BLOCKED | 0 |
| FAIL | 9 |
| MISSING | 30 |
| OPEN | 0 |
| OWNER-ACCEPTED | 0 |
| PRESENT-UNPROVEN | 211 |
| VERIFIED-AUTO | 0 |
| VERIFIED-PACKAGED | 0 |
| **Total** | **250** |

## Counts by area

| Area | Total | Status breakdown |
| --- | ---: | --- |
| Automated gate | 8 | PRESENT-UNPROVEN: 8 |
| Document lifecycle | 26 | PRESENT-UNPROVEN: 26 |
| Crash and recovery | 11 | PRESENT-UNPROVEN: 11 |
| Graph editing | 8 | FAIL: 6; PRESENT-UNPROVEN: 2 |
| Channels and roles | 11 | PRESENT-UNPROVEN: 9; FAIL: 2 |
| Connection effects | 14 | PRESENT-UNPROVEN: 14 |
| Modules | 4 | PRESENT-UNPROVEN: 4 |
| Prompt and LLM Workers | 15 | PRESENT-UNPROVEN: 15 |
| Codex image provider | 7 | PRESENT-UNPROVEN: 7 |
| Antigravity image provider | 9 | PRESENT-UNPROVEN: 9 |
| Provider capability UI | 4 | PRESENT-UNPROVEN: 4 |
| References and batches | 17 | PRESENT-UNPROVEN: 17 |
| Review and artifacts | 15 | FAIL: 1; PRESENT-UNPROVEN: 14 |
| Recipes | 17 | PRESENT-UNPROVEN: 17 |
| Codex plugin and MCP | 11 | PRESENT-UNPROVEN: 11 |
| UI, responsive behavior, accessibility | 14 | PRESENT-UNPROVEN: 14 |
| Performance | 9 | PRESENT-UNPROVEN: 9 |
| Security and packaging | 12 | PRESENT-UNPROVEN: 12 |
| Documentation and release | 8 | PRESENT-UNPROVEN: 8 |
| Recovery-specific | 30 | MISSING: 30 |

## Classification method

T01 baseline triage: historical checked items remain PRESENT-UNPROVEN; explicit rejected-candidate interaction failures are FAIL; recovery additions are MISSING; all other unproven implementation is PRESENT-UNPROVEN.

Historical checked items are retained in `priorEvidence` only and remain PRESENT-UNPROVEN until candidate evidence is rerun. Every requirement carries required evidence classes, owners, release-blocker state, and (for M requirements) J01-J10 owner routes.

Validator baseline result: PASS (schema/coverage only).
