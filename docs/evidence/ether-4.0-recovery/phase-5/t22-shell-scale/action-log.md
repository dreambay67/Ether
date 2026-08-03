# T22 adaptive-shell action log

Date: 2026-08-04

Status: PASS in the source Electron application.

Command:

`ETHER_SHELL_EVIDENCE_DIR=../../docs/evidence/ether-4.0-recovery/phase-5/t22-shell-scale/screenshots pnpm.cmd --dir packages/testing exec playwright test --config playwright.config.ts tests/desktop/shell-layout.spec.ts`

Result: 5 tests passed.

## Practical actions

| Display | Actions and visible result | Screenshot |
| --- | --- | --- |
| 1920x1080 at 100% | Opened the blank workspace, verified the main controls stayed inside the window, resized a pane with the pointer, and confirmed the canvas and minimap remained usable. | `screenshots/phase5-shell-1920x1080-100-percent.png` |
| 1440x900 at 125% | Verified the three-pane shell, workspace labels, focus action, canvas, and minimap remained legible without overlap. | `screenshots/phase5-shell-1440x900-125-percent.png` |
| 1280x720 at 150% | Verified the responsive header and collapsed panes, moved a node, selected it, and targeted a connection channel. | `screenshots/phase5-shell-1280x720-150-percent.png` |
| 1280x720 at 200% | Verified workspace tabs did not overlap, kept a useful canvas area, and completed keyboard targeting of the Text channel lane. | `screenshots/phase5-shell-1280x720-200-percent.png` |

The 200% capture begins below the document-command header after the test scrolls the node into view. The same test separately measures every primary header control and proves it remains inside the viewport without overlap.

No installer, registry, shell association, native drag, or provider route was used.
