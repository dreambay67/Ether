---
name: ether-recovery
description: Use when an Ether project needs health checks, 2.5 migration, missing linked file repair, orphan artifact cleanup, provider log review, or recovery actions.
---

# Ether Recovery

Recover Ether projects by preserving evidence first, then applying the smallest reversible fix.

## Ether 2.5 Model

- Channels: text, image, mask, data, video, audio
- Roles: general, negative, subject, product, face, clothing, pose, setting, composition, style, lighting, colourPalette, typography, motion, timing
- Prompt family: Prompt, Brainstormer, Mutator, Expander, Reinforcer
- Ether 2.5 has one Prompt family, 15 roles, and six channels.
- Use the connection role grid to repair edge intent during migration or recovery.
- Assistant is not a node family in Ether 2.5.
- Recovery must preserve migrated source data and explain disabled media routes.

## Safety Rules

- Inspect the current Ether graph before editing or execution.
- Keep project-local files, prompts, asset metadata, provider logs, and run plans inside the Ether project unless the user explicitly asks for another destination.
- Do not run generation, evaluation, routing, provider calls, recovery actions, or file operations unless the user explicitly asks.
- Never make silent generation or execution runs.
- Preview graph patches before changing revisions, links, routes, collections, channel metadata, roles, or migrated data.
- Preview run plans before rerunning failed nodes.

## Recovery Moves

- Start with health checks: project open state, graph load, graph version, node contracts, run status, asset list, collection list, and provider logs.
- Compare graph revisions before editing. Name the revision, reason to restore or patch, and what data would change.
- During 2.5 migration, preserve legacy labels, handles, node text, assets, roles, layout, and edges under migration metadata where available.
- If an edge cannot be mapped to one of the six channels or 15 roles, keep it disabled with a clear reason rather than inventing behavior.
- For missing linked files, verify the recorded path, search project-local alternatives, and offer relink, copy-in, skip, or mark-missing actions.
- For orphan artifacts, inspect lineage, channel metadata, and collection metadata before deleting or moving anything.
- For provider failures, read logs, identify the provider mode and channel/operation pair, capture the failed node id, and decide whether to retry, simulate, switch mode with opt-in, or patch the graph.
- Keep recovery actions reversible where possible. Prefer notes, relinks, and metadata repair before destructive cleanup.

## Report Format

- State the symptom and affected nodes or artifacts.
- List evidence from health checks and logs.
- Preview the recovery action.
- Ask for explicit approval before file movement, reruns, revision restore, or cleanup.
