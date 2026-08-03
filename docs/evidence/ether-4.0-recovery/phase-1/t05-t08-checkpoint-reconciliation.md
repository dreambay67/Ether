# T05-T08 blank-GUI checkpoint reconciliation

Date: 2026-08-03

Status: accepted intermediate checkpoint; not a Phase 1 gate decision and not a release claim.

## Exact identities

- Final product/package commit exercised by the accepted checkpoint: `38235da49e31afc5e04f1868fde4b2614d68fd40`.
- Final evidence refresh commit at the owner continuation boundary: `f96cbe6016b18c748d868d99d8420a194bdfd4d6`.
- Packaged executable: `release/windows/win-unpacked/Ether.exe`, SHA-256 `bc79aa9e6826cee71d0e2aa3e4f330766bbaf0f9e5f3561700fcd45cc333a6c2`.
- Packaged application archive: `release/windows/win-unpacked/resources/app.asar`, SHA-256 `5be5a2ee773946bd67cfd42e1f73e0b2b7a7d42a100cfe813fb4331e7fd8f24b`.
- Practical record: `phase-1/blank-gui-checkpoint/packaged/action-log.md`, `result.json`, and five screenshots.
- Product implementation arc exercised by that package: `b5070823606aca1cdc42634dc3c3f43d7202524d` through `38235da49e31afc5e04f1868fde4b2614d68fd40`.
- Post-checkpoint startup-race correction: `5f00933` removes the writable `loading-*` graph path and scopes graph hydration to the active document and its returned revision. It is intentionally not attributed to the older package above and will be included in the next visible-slice package.

## Checklist reconciliation

| Task | Demonstrated by the accepted package | Still open |
| --- | --- | --- |
| T05 | The blank document visibly exposes all 17 registry rows in canonical order. Every row is clicked and the durable canvas ends with all 17 definition IDs. Registry metadata/default projection also passes the focused application-boundary test. | Library drag insertion, double-click/`N` quick-add, Favorites/Recent/search breadth, explicit all-node config validation or Needs setup, and save/reopen are not established by this checkpoint. |
| T06 | Ordinary left marquee selects; Shift marquee adds; a blank-authored Worker moves by real pointer drag without a blank renderer. | The checkpoint does not independently cover the full interaction-state matrix, right-drag pan, alternate pan, pointer-capture recovery, modified-click toggle, or supported Windows scaling matrix. |
| T07 | `Ctrl+D`, graph copy/paste, Delete, undo, redo, select all, F2 rename, Enter edit, `Ctrl+Enter` provider-safe preview, Home fit, and `Ctrl+K` command palette operate on the blank-authored durable graph. | Cut, Alt-drag duplicate, downstream-impact confirmation, text-editor clipboard isolation, Electron menus, and every disabled-state reason remain for later journey coverage. |
| T08 | Prompt title and primary body are directly edited on-canvas with controlled commit behavior, and the resulting card remains selected and durable. | Direct-editor coverage for every appropriate node type, expand-editor parity, runtime queued/running/failed/done duration and actionability, the full scale/size visual matrix, and Inspector provenance remain open. |

## Requirement accounting

The checkpoint is qualifying packaged candidate evidence for `RX-002`, `RX-003`, and `RX-010`. Those rows receive evidence records tied to the exact product commit and executable hash. Their baseline status is not promoted to a terminal state here because the current ledger still preserves T01 baseline classification and the owner accepted this as an intermediate checkpoint, not final manual acceptance.

The checkpoint is useful but incomplete support for `RX-006`, `RX-009`, `RX-011`, and `RX-013` through `RX-016`; no full evidence class is claimed for those rows. `RX-004` and `RX-005` remain unproven. J02 remains pending because its end state requires all 17 nodes configured, saved, and reopened plus manual evidence. J03 remains pending because its full interaction/command route and manual evidence are not complete.

Compatibility-session catalog behavior is unchanged. Ether 4.0 supports its single-file 4.x document model and safe refusal/read-only recovery boundaries; it does not add legacy project catalog or migration behavior. When the typed application catalog is absent, Node Library creation remains unavailable rather than synthesizing legacy defaults.

## Focused validation after the owner continuation

- `pnpm.cmd --filter @ether/testing exec vitest run --config vitest.integration.config.ts tests/application-contract-4.0.test.ts`: 5 passed, including all 17 serializable registry defaults.
- Startup hydration regression: 1 passed. It switches between two documents that both use `graph-root`, proves creation is disabled while the second snapshot is pending, then proves the first permitted transaction targets the second document and its graph revision.
- Desktop renderer TypeScript: passed.
- Testing TypeScript: passed through direct project validation; the wrapper command separately timed out while rebuilding dependencies and did not report a TypeScript failure.
- Scoped renderer/test lint: passed.
- The broader canvas browser file reached its existing selected-run overlay and timed out because that overlay intercepted a later unrelated click. Per the owner redirect, it was not rerun into a review loop after the focused startup regression passed.
