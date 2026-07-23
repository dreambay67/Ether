---
name: ether-director
description: Use when a creative brief needs a tailored Ether 4.0 document workflow, coordinated inspection, construction, or repair route.
---

# Ether Director

Operate on the one active `.ether` document. Inspect with `ether.document.inspect`, `ether.document.health`, `ether.recovery.inspect`, `ether.permission.inspect`, `ether.node.catalog`, `ether.graph.catalog`, `ether.graph.inspect`, `ether.graph.validate`, and `ether.provider.inspect`. Inspect relevant inputs through `ether.reference.list`, `ether.reference.inspect`, `ether.artifact.search`, `ether.artifact.inspect`, `ether.artifact.lineage`, and `ether.collection.list`. Discover reusable structures with `ether.recipe.list` and `ether.recipe.setup`.

Channels: text, image, mask, data, video, audio

Roles: general, negative, subject, product, face, clothing, pose, setting, composition, style, lighting, colourPalette, typography, motion, timing

Translate the brief into Prompt, model-aware LLM Worker, Reference Set, generation/edit, review, collection, and export-preparation stages only when each serves the deliverable. Preserve immutable output selectors and keep node instructions separate from incoming content.

Preview one atomic change with `ether.graph.transaction.preview`; apply with `ether.graph.transaction.apply` or instantiate an approved recipe with `ether.recipe.preview` and `ether.recipe.instantiate`. Use `$temp:node:<name>`, `$temp:edge:<name>`, `$temp:group:<name>`, `$temp:module:<name>`, or `$temp:graph:<name>` only where that identity kind is declared. Reinspect and validate after apply; reject an unwanted proposal with `ether.graph.transaction.reject`.

Permits are issued by the Ether host and are only observable through `ether.permission.inspect`; MCP cannot create or elevate them. Transaction apply and recipe instantiate require an `editPermitId`. Leave execution untouched under Edit Permit. For an explicit later run, use `ether.run.plan.preview`, then `ether.run.start` with a host-issued `runPermitId` bound to the exact `planId` and `contentHash`. Inspect durable work through `ether.run.list`, `ether.run.inspect`, and `ether.run.plan.inspect`.

The tested natural-language construction template is `../../examples/editorial-campaign.transaction.json`. Hydrate every `{{...}}` value from the active document, graph, and selected references returned by MCP; `pathGrantId` must come from a real host-issued export grant. If no export grant is available, omit the export node and its incoming edge before preview. The hydrated transaction builds the campaign graph as one revision and starts no provider.
