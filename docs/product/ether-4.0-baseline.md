# Ether 4.0 Baseline

Captured on 2026-07-16 before the Ether 4.0 implementation branch was created.

## Repository State

- Repository: `C:\Users\deny7\Documents\Codex\2026-05-29\ether`
- Starting branch: `feature/ether-v1`
- Starting commit: `2dc39cac268cd592624b7069a25f2ebe53419b07`
- Remote: none configured
- Worktree: normal checkout, not a linked worktree or submodule
- Source delta: 52 tracked files modified, with 21,621 insertions and 5,515 deletions before untracked source files are counted
- Ignored generated roots: `node_modules/`, `release/`, and `test-results/`

This checkpoint intentionally preserves the complete Ether 2.5 source state. Generated dependencies, release output, Playwright output, local project documents, and user data are not included.

## Command Environment

PowerShell blocks the `pnpm.ps1` shim under the current execution policy. Baseline commands therefore use the equivalent Windows executable, `pnpm.cmd`. This is an environment detail, not an Ether failure.

## Baseline Results

### Unit tests

Command: `pnpm.cmd run test:unit`

- Exit code: 0
- Result: 31 test files passed
- Result: 358 tests passed
- Vitest duration: 12.59 seconds

### Desktop build

Command: `pnpm.cmd run desktop:build`

- Exit code: 0
- Result: Electron TypeScript build and Vite renderer build passed
- Renderer modules transformed: 1,977
- Main renderer JavaScript: 644.10 kB minified, 191.02 kB gzip
- Known warning: Vite reports a renderer chunk larger than 500 kB

### Browser smoke journeys

Command: `pnpm.cmd run test:smoke`

- Exit code: 1
- Result: 76 passed, 7 failed, 83 total
- Duration: 3.3 minutes
- Failures:
  - inspector section help control is absent or unreachable
  - edge role editor is absent or unreachable
  - selected-node state is lost before edge-only right-click deletion
  - Shift-drag marquee does not select the expected nodes
  - plain left-drag marquee does not select the expected nodes
  - the canvas-basics journey cannot find the delete-selection control
  - the mask workspace does not record the expected stroke

These are preserved baseline failures. They are not hidden or reclassified.

### Packaged application smoke

Command: `pnpm.cmd --filter @ether/testing test:packaged`

- Exit code: 1
- Result: 0 passed, 1 failed
- Cause: the baseline package executable is absent at `release/ether-windows-unpacked/Ether.exe`
- Required prerequisite reported by the test: run `pnpm desktop:package:win`

No package was built merely to make this baseline look green. Windows packaging is an explicit Ether 4.0 release task.

### Strict renderer typecheck

Command: standalone strict TypeScript compilation over every renderer `.ts` and `.tsx` file

- Exit code: 1
- Diagnostics: 34
- Main categories: nullable DOM targets, React Flow event and collection typing, missing graph-version serialization, unknown IPC run results, inspector value narrowing, and static image module resolution

The existing desktop `tsconfig.json` compiles only Electron main and preload sources, so these renderer diagnostics were not part of the successful desktop build above. Ether 4.0 Task 2 makes renderer checking mandatory and resolves the diagnostics without weakening strictness.

## Security And Privacy Scan

The reviewed checkpoint allowlist is:

` .gitignore AGENTS.md README.md package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json apps packages docs scripts `

Findings:

- No private keys, Google credentials, GitHub tokens, real OpenAI keys, auth cookies, environment files, databases, logs, or credential containers were found.
- `packages/testing/tests/api-provider-infrastructure.test.ts` and `packages/testing/tests/provider-registry.test.ts` contain deliberately fake `sk-...` values used to verify that secrets are not persisted and that platform API access is not enabled. These are test fixtures, not credentials.
- The archived V1 master plan contains the local repository path as historical planning context. It does not name user media or contain a credential.
- No generated `.ether` project, user reference asset, screenshot, or test database is included in the checkpoint source allowlist.

## Baseline Interpretation

Ether 2.5 has a substantial working core and strong unit coverage, but the professional release path is not yet trustworthy: renderer strictness is bypassed, seven interaction journeys fail, packaged acceptance has no executable to test, and the renderer ships as one large chunk. Ether 4.0 begins from this exact state rather than rewriting history.
