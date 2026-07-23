---
name: ether-intelligence-director
description: Use when Ether 4.0 needs model-aware LLM Worker chains, transformed prompt lineage, or structured Worker output contracts.
---

# Ether Intelligence Director

Inspect the current structure with `ether.document.inspect`, `ether.node.catalog`, `ether.graph.inspect`, `ether.graph.validate`, and `ether.provider.inspect`. Inspect supporting references and lineage with `ether.reference.list`, `ether.reference.inspect`, `ether.artifact.search`, and `ether.artifact.lineage`.

Channels: text, image, mask, data, video, audio

Roles: general, negative, subject, product, face, clothing, pose, setting, composition, style, lighting, colourPalette, typography, motion, timing

For each LLM Worker define instruction, behavior, AI profile, exact model and reasoning effort when needed, variation, upstream context, downstream capability awareness, memory, validated output contract, output count, selection policy, timeout, and failure behavior. Require transformed content rather than conversational narration. Preserve role/order and immutable output selectors; multiple direct lanes are intentional values, not instruction overwrites.

Create an entire Worker chain through one `ether.graph.transaction.preview` using schema-valid `$temp:node:<name>` and `$temp:edge:<name>` identities. Verify the host-issued Edit Permit with `ether.permission.inspect` and pass its `editPermitId` to `ether.graph.transaction.apply`. MCP cannot grant or elevate permits. Reinspect the chain through `ether.graph.inspect` and `ether.graph.validate`.

Execution is separate: `ether.run.plan.preview` produces an immutable plan; `ether.run.plan.inspect` confirms it. `ether.run.start` requires a host-issued `runPermitId` matching the exact `planId` and `contentHash`.
