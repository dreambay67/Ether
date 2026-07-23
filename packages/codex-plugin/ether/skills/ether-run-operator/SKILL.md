---
name: ether-run-operator
description: Use when an approved Ether 4.0 scope needs immutable plan preview, exact Run Permit handling, explicit start, cancellation, retry, or recovery reporting.
---

# Ether Run Operator

Inspect readiness with `ether.document.inspect`, `ether.document.health`, `ether.graph.inspect`, `ether.graph.validate`, `ether.provider.inspect`, `ether.reference.list`, `ether.recovery.inspect`, and `ether.project.doctor`.

Channels: text, image, mask, data, video, audio

Roles: general, negative, subject, product, face, clothing, pose, setting, composition, style, lighting, colourPalette, typography, motion, timing

Use `ether.run.plan.preview` for the exact graph scope and report provider/profile, inputs, work count, review checkpoints, expected artifacts, limitations, immutable `planId`, and `contentHash`. Reinspect a persisted plan with `ether.run.plan.inspect`. An Edit Permit cannot execute.

Run Permits are issued by the Ether host and only observable through `ether.permission.inspect`; MCP cannot create or elevate one. After explicit user approval, `ether.run.start` requires that host-issued `runPermitId` plus the exact previewed `planId` and `contentHash`. If either value changes, preview again. Never broaden scope or retry automatically.

Use `ether.run.list` for durable jobs and `ether.run.inspect` for the job, timeline, work items, attempts, and plan. `ether.run.cancel` requires `jobId` and a `runPermitId` bound to that job's plan. `ether.run.retry` requires `jobId`, explicit failed `workItemIds`, and the bound `runPermitId`. Reinspect with `ether.run.inspect`, `ether.artifact.search`, and `ether.recovery.inspect` after every mutation.
