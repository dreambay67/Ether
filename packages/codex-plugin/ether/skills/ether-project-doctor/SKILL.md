---
name: ether-project-doctor
description: Use when an Ether 4.0 document needs health inspection, revision-conflict diagnosis, reference recovery, or safe graph repair.
---

# Ether Project Doctor

Inspect evidence with `ether.document.inspect`, `ether.document.health`, `ether.project.doctor`, `ether.recovery.inspect`, `ether.permission.inspect`, `ether.node.catalog`, `ether.graph.catalog`, `ether.graph.inspect`, `ether.graph.validate`, `ether.provider.inspect`, `ether.reference.list`, `ether.reference.inspect`, `ether.artifact.search`, `ether.artifact.inspect`, `ether.artifact.lineage`, `ether.run.list`, `ether.run.inspect`, and `ether.run.plan.inspect`.

Channels: text, image, mask, data, video, audio

Roles: general, negative, subject, product, face, clothing, pose, setting, composition, style, lighting, colourPalette, typography, motion, timing

Diagnose document integrity, graph/module validation, stale revisions, unavailable providers, missing references, artifact lineage, interrupted jobs, and plan/permit mismatches. Report observed evidence separately from the proposed repair.

Propose the smallest repair through `ether.graph.transaction.preview` with schema-valid `$temp:<graph|node|edge|group|module>:<name>` identities. Host-issued permits are only observable with `ether.permission.inspect`; MCP cannot grant or elevate them. Pass an `editPermitId` to `ether.graph.transaction.apply`, or close the proposal with `ether.graph.transaction.reject`. On conflict, refresh current document/graph revisions, rebase, and preview again. Verify health and recovery after apply.

`../../examples/review-repair.transaction.json` is the tested repair template. Hydrate its `{{...}}` fields from `ether.graph.inspect`, the prior proposal's `tempIds`, and fresh apply revisions; then preview it. It applies through the real MCP handler and leaves execution untouched. A later execution requires `ether.run.plan.preview` and `ether.run.start` with a host-issued `runPermitId` bound to the exact `planId` and `contentHash`.
