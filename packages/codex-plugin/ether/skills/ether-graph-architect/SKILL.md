---
name: ether-graph-architect
description: Use when an Ether 4.0 graph or module needs atomic construction, topology repair, temporary-reference wiring, or revision-aware validation.
---

# Ether Graph Architect

Inspect `ether.node.catalog`, `ether.graph.catalog`, `ether.graph.inspect`, and `ether.graph.validate` before designing a change.

Use the registry-backed Node Library rather than inventing definition IDs. Canvas
direct editing and focus/commit behavior belong to the host UI, while plugin edits
are explicit graph transactions. Modules are locked by default: create membership
from a selected set, explicitly unlock before movement or dissolve, then relock;
rename, accent/highlight, description, collapse, and enter/exit are durable module
operations, not legacy visual groups.

Channels: text, image, mask, data, video, audio

Roles: general, negative, subject, product, face, clothing, pose, setting, composition, style, lighting, colourPalette, typography, motion, timing

A transaction names `baseDocumentRevisionId`, every affected existing graph in `baseGraphRevisions`, actor `codex`, explicit operations, and a layout policy. Create and connect entities atomically with declared identities such as `$temp:node:campaign-worker` and `$temp:edge:worker-generation`. The exact grammar is `$temp:<graph|node|edge|group|module>:<name>`; kind must match the identity field. Never use an undeclared or abbreviated temporary reference.

Use `ether.graph.transaction.preview`, inspect its resolved `tempIds`, summary, warnings, and validation, then check `ether.permission.inspect`. The host-issued Edit Permit supplies the `editPermitId`; MCP cannot grant it. Apply exactly once with `ether.graph.transaction.apply`, or close the proposal with `ether.graph.transaction.reject`. On a base conflict, refresh `ether.document.inspect` and `ether.graph.inspect`, rebase, preview again, and never overwrite current state. Confirm with `ether.graph.validate` and `ether.project.doctor`.

`../../examples/editorial-campaign.transaction.json` is the tested portable construction template. Replace every `{{...}}` value with active graph revisions and selected references learned through MCP, plus a real host-issued export `pathGrantId`; without that grant, omit the export node and its edge. `../../examples/review-repair.transaction.json` is the matching portable repair template: hydrate it only with current entities and revisions returned by `ether.graph.inspect`, the construction proposal's `tempIds`, and the construction apply result. Both pass the real MCP preview/apply handler and contain no run call.

`../../examples/blank-document.transaction.json` is the blank-safe route: hydrate
only revision and graph IDs, leave references/export absent when unavailable, and
validate the resulting graph without launching a provider.
