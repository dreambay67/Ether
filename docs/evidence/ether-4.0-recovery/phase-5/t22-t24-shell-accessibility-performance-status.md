# T22-T24 shell, accessibility, and performance status

Date: 2026-08-04

Status: source behavior focused-verified; Phase 5 installed-app audit remains reserved for the original review task.

## Delivered boundary

- `4af5071` — preserves a usable adaptive workspace across the required display-size and scale matrix, including a content-sized high-scale header row.
- `e927ad0` — adds focusable contextual Help, keyboard-operable node and Module connection handles, visible keyboard focus, and shortcut isolation for nested controls.
- The current checkpoint adds mutation-aware autosave scheduling so time spent completing a successful graph transaction counts toward the 1.5-second idle-save window. It does not mark failed mutations dirty and retains the 10-second maximum save bound.

## T22 practical shell journey

The source Electron shell journey passed 5 tests. It covers 1920x1080 at 100%, 1440x900 at 125%, and 1280x720 at both 150% and 200%. It also performs real pointer pane resizing, scrolling and focus changes, node dragging, and connection-channel targeting.

Evidence:

- `docs/evidence/ether-4.0-recovery/phase-5/t22-shell-scale/action-log.md`
- `docs/evidence/ether-4.0-recovery/phase-5/t22-shell-scale/screenshots/phase5-shell-1920x1080-100-percent.png`
- `docs/evidence/ether-4.0-recovery/phase-5/t22-shell-scale/screenshots/phase5-shell-1440x900-125-percent.png`
- `docs/evidence/ether-4.0-recovery/phase-5/t22-shell-scale/screenshots/phase5-shell-1280x720-150-percent.png`
- `docs/evidence/ether-4.0-recovery/phase-5/t22-shell-scale/screenshots/phase5-shell-1280x720-200-percent.png`

## T23 keyboard and accessibility checks

The same shell suite verifies that visible interactive controls have accessible names, IDs are unique, positive tab order is absent, described-by references resolve, images have alternate text, and dialogs are named. Its keyboard-only journey selects a node with Space, opens focused Setup help, closes it with Escape, and connects the Text channel with Enter and Space.

This is a focused source invariant and keyboard-flow check. It is not a complete WCAG audit, not an installed-app keyboard audit, and not a claim that every assistive-technology combination has been tested.

## T24 performance budgets

The full deterministic Node/Vitest performance run passed 7 files and 9 tests. Representative measurements were:

- 500-work-item lifecycle: plan compile 199.82 ms; persistence 4,723.45 ms; queue-to-provider 4,783.07 ms; lifecycle 106,369.98 ms; recovery query 385.38 ms.
- Sparse 4 GB safety: bounded read 0.257 ms; rejection 1.989 ms; zero streaming invocations.
- Document inspect 7.900 ms; transaction 14.437 ms; range 0.477 ms.
- Application document open 24.410 ms; direct autosave 8.732 ms.
- Search first result over 10,000 artifacts: 4.259 ms against a 200 ms budget.
- Canvas projection for 1,000 nodes: 0.869 ms.

The production Electron browser run passed its cold-start and 1,000-node pan/zoom cases. Pan/zoom measured a 16.7 ms median frame gap, 16.8 ms maximum, and no gaps over 50 ms. Cold-start trials measured a 693.33 ms median and 768.48 ms maximum.

The 1,000-node document case initially exposed a real autosave timing defect: the 1.5-second idle timer began only after a long graph transaction completed, producing a 2,752.2 ms end-to-end save. The repair starts the logical idle window at the mutation request while still scheduling only after a successful commit. Focused lifecycle coverage passed 19 tests, desktop type-checking passed, and the repaired production case passed on its one allowed rerun:

- document wall time: 1,529.460 ms median; 1,627.877 ms maximum;
- document open: 59.6 ms maximum;
- graph hydration: 82.8 ms maximum;
- autosave: 1,509.1 ms median; 1,599.2 ms maximum;
- autosave frame gap: 10.2 ms maximum; zero long tasks.

The complete performance suite was not repeated after that focused repair because the failure was isolated and the repaired case plus its service-level regression test passed. This avoids turning a corrected peripheral measurement into a repeated package-scale loop.

## Remaining truthful limits

- The screenshots come from the source Electron application; the next visible slice will be packaged once after the manual/onboarding work is ready.
- No installer was launched and no registry, association, Explorer, Jump List, native drag, or provider route was exercised.
- The original review task retains ownership of installed-app keyboard, scale, upgrade, and final release auditing. This checkpoint does not declare release readiness.
