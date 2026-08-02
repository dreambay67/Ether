# Ether 4.0 Recovery Acceptance And Evidence Ledger

Status: Normative release ledger

Date: 2026-08-02

This ledger governs the recovery of the rejected Ether 4.0 release candidate. It incorporates every checkbox in `ether-4.0-acceptance.md` and adds recovery requirements discovered by the product-owner audit.

## 1. Baseline

The original acceptance document contains 220 requirements:

| Area | Verified in historical file | Open at recovery start | Total | Primary recovery owner |
| --- | ---: | ---: | ---: | --- |
| Automated gate | 0 | 8 | 8 | T26 |
| Document lifecycle | 0 | 26 | 26 | T03 |
| Crash and recovery | 0 | 11 | 11 | T03 |
| Graph editing | 0 | 8 | 8 | T06, T07, T08 |
| Channels and roles | 0 | 11 | 11 | T10 |
| Connection effects | 0 | 14 | 14 | T11 |
| Modules | 0 | 4 | 4 | T09 |
| Prompt and LLM Workers | 0 | 15 | 15 | T14 |
| Codex image provider | 0 | 7 | 7 | T04, T16 |
| Antigravity image provider | 9 | 0 | 9 | T04 |
| Provider capability UI | 0 | 4 | 4 | T16 |
| References and batches | 5 | 12 | 17 | T15, T18 |
| Review and artifacts | 0 | 15 | 15 | T17, T19 |
| Recipes | 0 | 17 | 17 | T20 |
| Codex plugin and MCP | 0 | 11 | 11 | T21 |
| UI, responsive behavior, accessibility | 0 | 14 | 14 | T22, T23 |
| Performance | 0 | 9 | 9 | T24 |
| Security and packaging | 0 | 12 | 12 | T04, T28 |
| Documentation and release | 0 | 8 | 8 | T25, T28 |
| **Total** | **14** | **206** | **220** | **T01-T28** |

The 14 historical checks are retained as prior evidence, not automatically trusted forever. T01 records their exact artifacts and T26 reruns evidence affected by recovery changes.

## 2. Status Model

Every original and recovery requirement has exactly one current status:

- `OPEN`: not triaged yet;
- `FAIL`: reproduced in source or the application;
- `MISSING`: no usable implementation exists;
- `PRESENT-UNPROVEN`: an implementation exists but qualifying evidence is absent;
- `BLOCKED`: external prerequisite prevents completion and the blocker is documented;
- `VERIFIED-AUTO`: required automated evidence passed at the recorded commit;
- `VERIFIED-PACKAGED`: required installed-application journey passed at the recorded commit;
- `OWNER-ACCEPTED`: the product owner accepted a release-critical manual journey.

`VERIFIED-AUTO`, `VERIFIED-PACKAGED`, and `OWNER-ACCEPTED` are evidence states, not opinions. A requirement may need more than one evidence class before it is complete.

## 3. Evidence Classes

| Code | Evidence | Qualifying proof |
| --- | --- | --- |
| A | Automated | Focused unit, integration, contract, or accessibility result tied to an exact commit. |
| P | Packaged journey | Installed `Ether.exe` operated with real pointer/keyboard or Windows accessibility input, starting from the stated precondition. |
| M | Manual owner | Product owner follows a concise route in the candidate build and explicitly accepts it. |
| V | Visual | Screenshot set at required window sizes/scales plus console/error review. Visual proof supplements P and never replaces it. |
| R | Runtime/provider | Real provider or approved conformance run with request ledger, exact settings, outputs, and retry state. |

Evidence is stored under `docs/evidence/ether-4.0-recovery/<requirement-id>/` and contains:

- commit SHA and package hash;
- precondition and action log;
- expected and actual result;
- test or capture command;
- screenshot/output paths where applicable;
- reviewer and date;
- failure notes or known limitations.

Fixtures may prove scale, recovery, and performance. They may not prove node discovery, creation, direct editing, selection, modules, recipes, or ordinary run flow.

## 4. Completion Rules For Original Requirements

The original checklist remains the item-level source of truth. T01 gives each checkbox a stable generated ID based on section and order, records its status in a machine-readable ledger, and validates that exactly 220 entries are represented.

Minimum evidence by area:

| Area | Minimum evidence |
| --- | --- |
| Automated gate | A |
| Document lifecycle | A+P; destructive recovery cases A |
| Crash and recovery | A+P for visible recovery, A for deterministic fault cases |
| Graph editing | A+P; primary selection journey P+M |
| Channels and roles | A+P |
| Connection effects | A+P for visible adapters, A for exhaustive matrix |
| Modules | A+P+M |
| Prompt and Workers | A+P; real vision/model behavior R where claimed |
| Image providers | A+P+R |
| References and batches | A+P; scale behavior A |
| Review and artifacts | A+P+M |
| Recipes | A+P for every recipe; representative three M |
| Plugin and MCP | A+P for graph application; permission boundaries A |
| UI and accessibility | A+P+V; primary keyboard journey M |
| Performance | A with recorded baseline; canvas responsiveness P |
| Security and packaging | A+P where installed behavior is visible |
| Documentation and release | A+P+M |

No original checkbox is marked complete until its evidence file exists and the evidence-ledger validator passes.

## 5. Recovery-Specific Requirements

These requirements close gaps that the original acceptance document failed to state precisely. They are additional release blockers.

- [ ] `RX-001` The UI and release documents identify the current candidate as unreleased until the final owner gate. Evidence: A.
- [ ] `RX-002` One visible Node Library exposes all 17 canonical node types in a blank document. Evidence: A+P+M.
- [ ] `RX-003` Clicking every library item creates the correct canonical type at a predictable position. Evidence: A+P.
- [ ] `RX-004` Dragging every library item onto the canvas creates it at the drop position. Evidence: A+P.
- [ ] `RX-005` Double-click empty canvas and `N` with canvas focus open a searchable quick-add palette at the working position; `Tab` remains focus navigation. Evidence: A+P.
- [ ] `RX-006` Every node is created from its registry default and immediately passes config validation or shows Needs setup. Evidence: A+P.
- [ ] `RX-007` Library search covers name, family, purpose, channel, and synonym; Favorites and Recent never hide the full catalog. Evidence: A+P.
- [ ] `RX-008` Every library item has specific purpose, channel, example, and hover/focus help text. Evidence: A+P.
- [ ] `RX-009` Titles and primary editable content can be edited on-canvas without accidental movement or shortcut activation. Evidence: A+P+M.
- [ ] `RX-010` Left-drag marquee works without Shift; Shift-marquee adds to the selection; neither can blank the renderer. Evidence: A+P+M.
- [ ] `RX-011` Empty-canvas click deselects; node click selects; modified click toggles; selected nodes move together exactly once. Evidence: A+P.
- [ ] `RX-012` Right drag pans smoothly and never changes selection or opens an unwanted context menu. Evidence: A+P.
- [ ] `RX-013` `Ctrl+D` and Alt-drag duplicate complete selections with stable offsets, connections, and undo. Evidence: A+P.
- [ ] `RX-014` Graph-aware copy, cut, and paste work when canvas owns focus and never steal ordinary text-editor clipboard behavior. Evidence: A+P.
- [ ] `RX-015` Delete/Backspace removes selected graph objects with impact-aware confirmation and complete undo. Evidence: A+P.
- [ ] `RX-016` Command Palette and application menus expose graph commands, current shortcuts, and disabled-state reasons. Evidence: A+P.
- [ ] `RX-017` Visual Group is removed from the ordinary UI; Module is the only organizational container. Evidence: A+P.
- [ ] `RX-018` A newly created or converted Module is locked by default and its members cannot be changed from the parent canvas. Evidence: A+P+M.
- [ ] `RX-019` Modules support rename, description, DreamBay accent color, lock, collapse, and exposed-parameter editing. Evidence: A+P.
- [ ] `RX-020` Enter, exit, membership change, conversion, and dissolution preserve graph meaning, viewport, selection, and undo. Evidence: A+P+M.
- [ ] `RX-021` Unconnected channel dots are hidden at rest; compatible dots appear only during hover, focus, or connection drag. Evidence: A+P+V.
- [ ] `RX-022` Different channel/role/selector lanes can connect the same node pair; only exact duplicates are rejected. Evidence: A+P.
- [ ] `RX-023` Non-General role badges remain visible and editable on lanes; General remains quiet; endpoint Inspectors agree. Evidence: A+P+V.
- [ ] `RX-024` Right-clicking a lane or connected dot deletes only the intended lane and never selected nodes. Evidence: A+P.
- [ ] `RX-025` Running a node writes versioned outputs and never overwrites another node's instruction or authored config. Evidence: A+P+M.
- [ ] `RX-026` Serial Prompt/Worker lineage remains one semantic role item; multiple direct same-role lanes create numbered items. Evidence: A+P.
- [ ] `RX-027` Queued/running/failed/done state is visible on the node; done remains for ten seconds and failure remains actionable. Evidence: A+P+V.
- [ ] `RX-028` Every recipe begins from a new document and reaches its advertised fake-provider output through visible setup and run controls. Evidence: A+P.
- [ ] `RX-029` Manual screenshots are produced by action scripts from a blank/relevant state, not by injecting the claimed result. Evidence: A+P.
- [ ] `RX-030` Final review begins with user journeys before source/test review, and release requires explicit product-owner acceptance. Evidence: P+M.

Recovery total: 250 requirements, comprising 220 original requirements plus 30 recovery-specific requirements.

## 6. Required Packaged Journeys

| Journey | Start state | End state | Required evidence | Owner |
| --- | --- | --- | --- | --- |
| J01 First image | New blank document | Saved generated image visible in Artifacts | P+M+R | T13, T16, T19, T27 |
| J02 Node catalog | New blank document | All 17 nodes created, configured, saved, reopened | P+M | T05, T12, T27 |
| J03 Canvas editing | New blank document | Select, marquee, move, edit, duplicate, clipboard, delete, undo/redo | P+M | T06-T08, T27 |
| J04 Connections | Representative six-channel graph | Multi-lanes, role edit, lane delete, adapter preview | P+M | T10-T11, T27 |
| J05 Module | Multi-node selection | Locked styled module, enter/edit/exit/collapse/dissolve/undo | P+M | T09, T27 |
| J06 Intelligent chain | Prompt -> Worker -> Worker -> Image | Approved transformed prompt and correct lineage | P+M+R | T13, T14, T16, T27 |
| J07 References and batch | Multiple local references | Controlled batch with visible jobs and accepted artifacts | P+M+R | T13, T15, T18, T19, T27 |
| J08 Review and delivery | Multiple artifacts | Compare, evaluate, filter, collect, export | P+M+R | T13, T17, T19, T27 |
| J09 Durability | Saved working document | Close, reopen, recover interruption, continue | P+M | T03, T27 |
| J10 Plugin co-producer | Blank document with Edit Permit | Tailored graph applied; run remains separately permitted | P+M | T21, T27 |

## 7. Real Generation Budget

Across the fixer and final review, no more than 12 real image generations may be launched without new owner authorization.

- Fixer task allocation: at most 8 launches.
- Original review task reserve: at least 4 launches.
- Conformance or ambiguous failures are not automatically retried.
- Fake-provider journeys are used for iteration and breadth.
- Every real launch is recorded before dispatch with provider, purpose, and remaining budget.

## 8. Gate Ownership

- Implementers may move items to `PRESENT-UNPROVEN` and attach candidate evidence.
- A separate reviewer validates A/P/V/R evidence and advances verified states.
- Only the product owner advances `OWNER-ACCEPTED`.
- The fixer task cannot declare release readiness.
- The original review task owns the final release recommendation after J01-J10.

Every `M` requirement must name one or more J01-J10 owner routes in `ledger.json`. Owner evidence is valid only when it records the exact installed package hash, candidate commit, route version, result, and explicit product-owner decision. The final concise owner route must cover every outstanding `M` mapping; no generic sign-off can close unperformed journeys.

## 9. Gate Validator

The recovery must add a deterministic validator that fails when:

- the original 220 requirements are not all represented;
- the 30 recovery requirements are not all represented;
- a completed requirement lacks required evidence classes;
- evidence commit/hash differs from the release candidate;
- a primary journey lacks an action log;
- any release blocker is `OPEN`, `FAIL`, `MISSING`, `BLOCKED`, or `PRESENT-UNPROVEN`;
- the manual fixture injects a state that it claims to demonstrate creating.

The final output must state counts by status. A single total test count is not an acceptable release summary.
