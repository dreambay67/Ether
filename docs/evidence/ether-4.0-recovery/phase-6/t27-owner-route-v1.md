# T27 owner route v1 — prepared, not executed

This route is a handoff artifact for the original review task. The fixer did not install the provisional installer, perform the final installed-app audit, spend the reserved real-generation budget, or record any `OWNER-ACCEPTED` decision.

## Exact provisional package

- Product candidate commit: `2dd2fd54e60e421386f9bba92b8d331fbd46b748`.
- Integration/evidence head at route preparation: `fd636bc0d609658633d1072e428481553001363c`.
- `Ether.exe`: `2d90842c3b03c131567522e8cd9b63b31064cb97fa52d4c1b31bb1d7e19337ec`.
- Canonical `app.asar`: `f1823e2bde697e2cc8fa55add7b1d71be99fb19369e3234ca7599ee6963ae875`.
- Installer: `0c64425960a92ae9508964828e0ee8095550011286aac35a7ae5377eb31954ea`.

The package audit passed 9/9. Full typecheck, full lint, and Codex plugin validation passed. These static/package results do not replace the failed practical gate recorded in `status-report.md`.

## Required owner journeys

Every mapped route must be executed from the installed application against this exact package identity. Each owner record must include the route ID, a nonempty route version, `result: "PASS"`, `ownerDecision: "ACCEPTED"`, the installer hash, and the matching action log. No partial route or generic sign-off closes the mappings below.

| Requirement | Required route(s) | Current status |
| --- | --- | --- |
| `AC-A07-001` | `J05` | `PRESENT-UNPROVEN` |
| `AC-A07-002` | `J05` | `PRESENT-UNPROVEN` |
| `AC-A07-003` | `J05` | `PRESENT-UNPROVEN` |
| `AC-A07-004` | `J05` | `PRESENT-UNPROVEN` |
| `AC-A13-001` | `J08` | `FAIL` |
| `AC-A13-002` | `J08` | `PRESENT-UNPROVEN` |
| `AC-A13-003` | `J08` | `PRESENT-UNPROVEN` |
| `AC-A13-004` | `J08` | `PRESENT-UNPROVEN` |
| `AC-A13-005` | `J08` | `PRESENT-UNPROVEN` |
| `AC-A13-006` | `J08` | `PRESENT-UNPROVEN` |
| `AC-A13-007` | `J08` | `PRESENT-UNPROVEN` |
| `AC-A13-008` | `J08` | `PRESENT-UNPROVEN` |
| `AC-A13-009` | `J08` | `PRESENT-UNPROVEN` |
| `AC-A13-010` | `J08` | `PRESENT-UNPROVEN` |
| `AC-A13-011` | `J08` | `PRESENT-UNPROVEN` |
| `AC-A13-012` | `J08` | `PRESENT-UNPROVEN` |
| `AC-A13-013` | `J08` | `PRESENT-UNPROVEN` |
| `AC-A13-014` | `J08` | `PRESENT-UNPROVEN` |
| `AC-A13-015` | `J08` | `PRESENT-UNPROVEN` |
| `AC-A19-001` | `J01`, `J09` | `PRESENT-UNPROVEN` |
| `AC-A19-002` | `J01`, `J09` | `PRESENT-UNPROVEN` |
| `AC-A19-003` | `J01`, `J09` | `PRESENT-UNPROVEN` |
| `AC-A19-004` | `J01`, `J09` | `PRESENT-UNPROVEN` |
| `AC-A19-005` | `J01`, `J09` | `PRESENT-UNPROVEN` |
| `AC-A19-006` | `J01`, `J09` | `PRESENT-UNPROVEN` |
| `AC-A19-007` | `J01`, `J09` | `PRESENT-UNPROVEN` |
| `AC-A19-008` | `J01`, `J09` | `PRESENT-UNPROVEN` |
| `RX-002` | `J02` | `FAIL` |
| `RX-009` | `J03` | `FAIL` |
| `RX-010` | `J03` | `FAIL` |
| `RX-018` | `J05` | `FAIL` |
| `RX-020` | `J05` | `FAIL` |
| `RX-025` | `J01`, `J06` | `PRESENT-UNPROVEN` |
| `RX-030` | `J01`, `J09` | `PRESENT-UNPROVEN` |

## Practical blockers to resolve before owner acceptance

- T20 Curate native folder selection is packaged-present but unproven after two Windows dialog-discovery failures.
- T21 J10 has no performed action because the native Codex menu foreground transition failed twice.
- T22 has no passing required shell/scale matrix.
- T23 J03/J06 keyboard journeys remain partial after their final package attempt.
- T24 exceeded the strict 2,000 ms maximum 1,000-node wall-hydration budget twice.
- T25 has no passing 12-screen manual capture, manifest, rebuilt PDF, or PDF verification.
- The 250-item gate currently reports `FAIL=19`, `MISSING=9`, `PRESENT-UNPROVEN=222`, and zero verified/owner-accepted rows.

The original review task should resolve these blockers, rebuild if any shipped code changes, rerun affected routes, and only then request the product owner's explicit decisions.
