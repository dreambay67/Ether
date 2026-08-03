# Ether manual evidence pipeline

The recovery candidate manual uses two packaged, blank-document action journeys. Both launch `release/windows/win-unpacked/Ether.exe` with isolated `APPDATA`, `LOCALAPPDATA`, and user-data roots. They use visible pointer and keyboard input and do not install Ether, mutate Windows associations, seed a graph, edit a database, or call a provider.

Run the recovery route after packaging an exact committed candidate:

1. `pnpm.cmd test:gui-checkpoint:packaged`
2. `pnpm.cmd test:manual-recovery:packaged`
3. `pnpm.cmd manual:manifest`
4. `pnpm.cmd manual:build`
5. `pnpm.cmd manual:verify`

The manifest step rejects stale package hashes, failed journeys, captured runtime errors, missing screenshot actions, substituted files, and mismatched image hashes. The PDF verifier checks tagged structure, bookmarks, links, text size, image bounds, page rendering, and blank-page signals. It renders each page to `tmp/pdfs/ether-4.0-manual` for visual review.

## Original installed-app route

`capture-release.mjs`, `capture-native-dialog.ps1`, and `create-release-fixture.mjs` belong to the original installed-app audit. They include installer, registry, native dialog, seeded-fixture, and provider-adapter work. The GUI recovery task must not run them. The original review task may use that route under its own owner authorization after the fixer hands off the exact final package.
