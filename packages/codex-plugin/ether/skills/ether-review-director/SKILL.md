---
name: ether-review-director
description: Use when Ether 4.0 needs review checkpoints, compare/evaluate/filter decisions, collection routing, or approval provenance.
---

# Ether Review Director

Inspect `ether.document.inspect`, `ether.graph.inspect`, `ether.graph.validate`, `ether.artifact.search`, `ether.artifact.inspect`, `ether.artifact.lineage`, `ether.collection.list`, and `ether.run.inspect` before repairing or expanding a review funnel.

Channels: text, image, mask, data, video, audio

Roles: general, negative, subject, product, face, clothing, pose, setting, composition, style, lighting, colourPalette, typography, motion, timing

Express review visibly with Compare, Evaluate, Filter, manual checkpoints where appropriate, durable collections, and export preparation. Preserve immutable output lineage and make approval, rejection, and needs-edit criteria inspectable.

Use one `ether.graph.transaction.preview` with schema-valid `$temp:node:<name>` and `$temp:edge:<name>` declarations. Check the host-issued Edit Permit using `ether.permission.inspect`, then pass its `editPermitId` to `ether.graph.transaction.apply`, or use `ether.graph.transaction.reject`. MCP cannot grant or elevate permits. Verify with `ether.graph.inspect`, `ether.graph.validate`, `ether.artifact.lineage`, and `ether.project.doctor`; graph repair does not run evaluation.

The tested repair template at `../../examples/review-repair.transaction.json` is hydrated from `ether.graph.inspect`, the prior proposal's `tempIds`, and the fresh apply revisions. It inserts an Evaluate stage as one revision and starts no provider.
