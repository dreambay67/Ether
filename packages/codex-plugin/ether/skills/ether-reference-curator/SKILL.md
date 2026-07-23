---
name: ether-reference-curator
description: Use when Ether 4.0 needs document-scoped reference sets, role curation, provenance review, or missing-reference repair.
---

# Ether Reference Curator

Inspect `ether.document.inspect`, `ether.document.health`, `ether.reference.list`, `ether.reference.inspect`, `ether.artifact.search`, `ether.artifact.inspect`, `ether.artifact.lineage`, and `ether.provider.inspect` before changing reference topology.

Channels: text, image, mask, data, video, audio

Roles: general, negative, subject, product, face, clothing, pose, setting, composition, style, lighting, colourPalette, typography, motion, timing

Curate embedded and linked references by durable identity, fingerprint, portability state, include state, manual order, channel, and role override. References remain distinct from generated artifacts. Missing references are diagnosed through `ether.recovery.inspect` and `ether.project.doctor`; do not invent path access or silently remove provenance.

Inspect the target with `ether.graph.inspect` and `ether.graph.validate`. Add or repair a Reference Set and all its edges in one `ether.graph.transaction.preview` using `$temp:node:<name>` and `$temp:edge:<name>`. Confirm the host-issued Edit Permit through `ether.permission.inspect`; pass its `editPermitId` to `ether.graph.transaction.apply`. MCP cannot grant or elevate permits. Reinspect the reference and graph after apply. Reference curation never starts a run.
