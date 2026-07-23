---
name: ether-recipe-studio
description: Use when a creative brief needs an executable Ether 4.0 recipe preview, parameterized instantiation, or recipe-derived graph repair.
---

# Ether Recipe Studio

Inspect `ether.document.inspect`, `ether.node.catalog`, `ether.graph.inspect`, `ether.graph.validate`, `ether.provider.inspect`, and `ether.recipe.list` before choosing a recipe.

Channels: text, image, mask, data, video, audio

Roles: general, negative, subject, product, face, clothing, pose, setting, composition, style, lighting, colourPalette, typography, motion, timing

Use `ether.recipe.setup` to inspect the exact versioned parameter schema. Use `ether.recipe.preview` to inspect the generated atomic transaction, nodes, layout, parameters, references, provider needs, review stages, collection, export preparation, and warnings. A recipe preview is never a run.

Inspect the host-issued Edit Permit through `ether.permission.inspect` and pass its `editPermitId` to `ether.recipe.instantiate`. MCP cannot create or elevate permits. After instantiation, use `ether.graph.inspect`, `ether.graph.validate`, and `ether.project.doctor` to verify the one-revision result. For custom recipe-derived edits, use `ether.graph.transaction.preview`, schema-valid `$temp:<kind>:<name>` identities, `ether.graph.transaction.apply`, or `ether.graph.transaction.reject`.

Execution remains separate through `ether.run.plan.preview`; only a later host-issued Run Permit can authorize `ether.run.start` for the exact plan identity and hash.
