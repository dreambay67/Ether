# Ether 4.0 final product-owner audit

Date: 2026-08-11

Product commit: `4377c567e52721f8a4a7c52b84f6815031babe44`

Canonical package: `release/windows/win-unpacked/resources/app.asar`

Canonical package SHA-256: `C16491A5EF5BD38FFDEAE98921A0D4E191CCFEF032B5C6CF2D29F8EEC97CCDE8`

Installer SHA-256: `3466278A77ED14B65B69B0599761489BEFF616F826BFAD27D129D250EAE86706`

## Scope

This audit is the final hands-on release review requested by the Ether product owner. It binds the complete automated suite, packaged Windows journeys, provider conformance, manual visual review, release manual, and package audit to the exact product and package above. Ether windows used by the review were launched offscreen and did not take input focus.

## Release evidence

- Workspace typechecks, lint, unit tests, integration tests, Chromium smoke tests, performance checks, desktop build, packaging, package audit, security checks, recovery journeys, plugin validation, and manual verification completed successfully across the Phase 6 gate and the final fixer pass.
- Final counts retained from the broad gate: 237 unit tests, 463 integration tests, 21 Chromium smoke tests, 38 focused security checks, and 15 destructive recovery journeys.
- The exact final package passed the 17-node blank-document checkpoint, keyboard graph authoring, document save/close/reopen, connection-role authoring, module authoring, run safety, worker review, references, recipes, plugin co-production, export, and recovery journeys recorded under this evidence tree.
- The packaged keyboard journey authored `Prompt -> Worker -> Worker -> Image` from a blank document and completed 2/2 cases.
- The packaged document lifecycle journey persisted and reopened an authored `.ether` document exactly.
- The final connection journey verified six-channel authoring, durable new-lane selection, channel compatibility, attached role chips, role editing, and lane removal.
- The final GUI checkpoint exposed all 17 canonical node types in the Library and created all 17 on a blank durable canvas.
- The final manual contains 25 tagged A4 pages, 13 packaged captures, 15 unique images, and 11 internal links; rendered pages were visually reviewed for clipping and legibility.
- The release package audit passed 9/9 checks.
- Codex CLI conformance passed 2/2 with the reviewed CLI version 0.144.2, including discovery, text, vision, cancellation, and a 1254x1254 reference-guided image. The current unreviewed user alpha correctly fails closed.
- Gemini launch evidence from the Phase 6 release gate remains valid for the provider contract; no additional paid Google generation was required in this final UI audit.
- Image use during this final audit: 1 of the product-owner limit of 12.

## Product-owner journeys

- `J01 First image`: generation planning, provider execution, artifact persistence, and visible artifact review passed.
- `J02 Node catalog`: all 17 node types were created, configured, saved, and reopened from a blank document.
- `J03 Canvas editing`: selection, marquee, movement, direct editing, duplicate, clipboard, delete, and undo/redo passed in the packaged UI.
- `J04 Connections`: multi-lane channels, role editing, lane deletion, compatibility, and adapter consequences passed.
- `J05 Module`: create, lock, style, enter, edit, exit, collapse, dissolve, and undo passed.
- `J06 Intelligent chain`: Prompt-to-Worker-to-Worker-to-Image authoring, separate worker instructions, reviewed output, and lineage passed.
- `J07 References and batch`: multiple references, reference-set controls, batch policy, progress, jobs, and artifacts passed.
- `J08 Review and delivery`: compare, evaluate, filter, collection, export gating, and output inspection passed.
- `J09 Durability`: save, close, exact reopen, writer lock, interruption recovery, and continuation passed.
- `J10 Plugin co-producer`: plugin validation, permitted graph editing, tailored graph creation, and separately permitted execution passed.

## Visual and workflow decision

The final packaged application is accepted for release. The first-run blank state, node discovery, canvas editing, connection authoring, modules, inspector layout, minimap, job center, references, recipes, artifact review, export, settings, recovery, and manual were inspected as user workflows. No release-blocking UI overflow, inaccessible primary action, hidden canonical node type, or broken first-run route remains.

Known release disclosures are unchanged: the Windows installer is unsigned and may show SmartScreen; protected credentials remain Windows-user-bound; the reviewed Codex CLI version is the supported conformance target; Antigravity remains an explicit fallback outside the default Google API launch gate.

Owner decision: **ACCEPTED**.
