---
name: ether-artifact-librarian
description: Use when an Ether project needs six-channel asset import, link, move, copy modes, user-provided dropped assets, collections, lineage, or metadata cleanup.
---

# Ether Artifact Librarian

Organize assets without breaking local project privacy or lineage. Treat file actions as visible graph operations.

## Ether 2.5 Model

- Channels: text, image, mask, data, video, audio
- Roles: general, negative, subject, product, face, clothing, pose, setting, composition, style, lighting, colourPalette, typography, motion, timing
- Prompt family: Prompt, Brainstormer, Mutator, Expander, Reinforcer
- Ether 2.5 has one Prompt family, 15 roles, and six channels.
- Use the connection role grid to describe why an asset is connected, not to rename the asset itself.
- Assistant is not a node family in Ether 2.5.
- Six-channel assets keep channel metadata so routing, previews, providers, and recovery agree.

## Safety Rules

- Inspect the current Ether graph before editing or execution.
- Keep project-local files, prompts, asset metadata, provider logs, and run plans inside the Ether project unless the user explicitly asks for another destination.
- Do not run generation, evaluation, routing, provider calls, moves, copies, or file operations unless the user explicitly asks.
- Never make silent generation or execution runs.
- Do not use browser or desktop automation to operate Ether or simulate drag/drop. Use MCP tools and project-local files only.
- Preview graph patches before changing asset nodes, collections, or lineage links.
- Preview run plans before any routing action that can move or copy artifacts.

## Library Moves

- Choose the file mode explicitly: import, link, move, copy, or user-provided dropped assets. State whether Ether will own the file or reference it in place.
- Preserve channel metadata for text, image, mask, data, video, and audio assets.
- Use link mode for large or shared source files when the user wants zero duplication.
- Use copy mode for project-local snapshots. Preserve original path metadata.
- Use move mode only after explicit approval, because it changes the user's filesystem.
- Keep collection names stable and purposeful: references, selects, needs-edit, rejects, exports, campaign-variants, and archive.
- Maintain lineage metadata: source asset id, parent run id, Prompt family node id, edge role, provider mode, collection route, and manual notes.
- Repair metadata hygiene when assets are orphaned, duplicated, missing dimensions, missing channel metadata, or missing route history.

## Dropped Asset Intake

- For user-provided dropped assets, inspect project-local file records, infer channels conservatively, and ask before bulk collection routing.
- Audio and video files can be stored and previewed as references, but interpretation needs explicit provider capability.
- Never upload or externalize local project assets unless the user explicitly asks for an opt-in provider path.
