# Ether manual release pipeline

This folder deliberately renders the manual only after a Windows release candidate exists. It never uses a Vite/dev renderer screenshot.

1. Build the installer with `pnpm.cmd run desktop:package:win`.
2. Set `ETHER_RELEASE_EXE` to the installed `Ether.exe` (not an unpacked development executable).
3. Run `node docs/manual/capture-release.mjs`. It starts that executable with fresh disposable `APPDATA`, `LOCALAPPDATA`, and `USERPROFILE` roots plus a loopback renderer CDP port. For the two native Codex consent images, the installed child also chooses an ephemeral loopback main-process inspector. The harness discovers that endpoint from the exact child's stderr, validates and invokes one of two fixed registered menu items, closes the socket before native capture, and never writes the endpoint to the manifest or disk.
4. Run `node docs/manual/build-pdf.mjs`; it prints the Markdown plus release capture inventory to `docs/product/ether-4.0-user-manual.pdf` through Chromium.
5. Run `pnpm.cmd run manual:verify`; it requires the PDF, all required labeled images, no placeholder images, searchable required text, PDF links, a nonzero page count, and a rendered PNG QA pass for every page.

The capture target list names every required release state. Some stateful views require the release-acceptance fixture/document to be opened with Ether before capture; the script intentionally fails instead of fabricating those states.
