# Final candidate package audit — 2026-08-10

This record binds the release inventory audit to the final recovery candidate. It is package evidence only; the installer was not launched and this record does not approve a release.

## Candidate identity

- Candidate commit: `9acd1bb81b7f21f6fd36af71158041a2e8ca00f2`
- `release/windows/win-unpacked/Ether.exe` SHA-256: `041d80aff7402348bd5aeae718f4784d4aa545efc597ae2b21b56e7918997023`
- Canonical `release/windows/win-unpacked/resources/app.asar` SHA-256: `c604e44d467f7e4114bb02299bb218b48c4827fd9f394a70dead872e2d9d36bb`
- `release/windows/Ether-4.0.0-Setup.exe` SHA-256: `6583d153f780da81009d1b4d3dca503becf415e980bf59b6e2589b362f205fa6`

## Audit action

- Command: `pnpm.cmd release:package:audit`
- Test: `packages/testing/tests/windows-package.test.ts`
- Result: **PASS — 9/9 tests**
- Duration reported by Vitest: `79.35s`
- Relevant checks included the explicitly required built-release audit and the staged SDK/runtime closure with an MCP-server launch.

No installed-app action, provider call, image generation, native folder selection, or owner acceptance occurred during this audit.
