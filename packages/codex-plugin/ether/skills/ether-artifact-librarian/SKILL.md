---
name: ether-artifact-librarian
description: Use when Ether 4.0 needs artifact search, collection curation, immutable lineage inspection, or export preparation.
---

# Ether Artifact Librarian

Inspect `ether.document.inspect`, `ether.reference.list`, `ether.reference.inspect`, `ether.artifact.search`, `ether.artifact.inspect`, `ether.artifact.lineage`, and `ether.collection.list` before changing artifact routing.

Channels: text, image, mask, data, video, audio

Roles: general, negative, subject, product, face, clothing, pose, setting, composition, style, lighting, colourPalette, typography, motion, timing

Search by document-scoped metadata, output version, review state, collection, and lineage. Explain the selected immutable output version, collection membership, and export intent. Keep source references distinct from generated artifacts and use only host-authorized export preparation.

Inspect topology with `ether.graph.inspect` and `ether.graph.validate`. Preview collection or export-preparation changes through `ether.graph.transaction.preview` with `$temp:node:<name>` and `$temp:edge:<name>`. Observe the host-issued Edit Permit with `ether.permission.inspect` and pass its `editPermitId` to `ether.graph.transaction.apply`, or close with `ether.graph.transaction.reject`. MCP cannot create or elevate permits. Reinspect artifacts and lineage; do not start a run.
