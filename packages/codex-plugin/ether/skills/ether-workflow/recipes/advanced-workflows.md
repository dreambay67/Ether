# Advanced Ether Workflow Recipes

Use these recipes after inspecting the current graph. Treat every recipe as a graph patch preview first, then a run preview only when the user explicitly asks to execute.

## Ether 2.5 Model

- Channels: text, image, mask, data, video, audio
- Roles: general, negative, subject, product, face, clothing, pose, setting, composition, style, lighting, colourPalette, typography, motion, timing
- Prompt family: Prompt, Brainstormer, Mutator, Expander, Reinforcer
- Ether 2.5 has one Prompt family, 15 roles, and six channels.
- Use the connection role grid for edge intent and use channel pairs for payload movement.

## Style Exploration

Pattern: `Prompt -> Mutator -> Generation -> Compare -> Evaluation -> Filter -> Collection`.

- Keep the style exploration matrix small on the first pass: 3 styles, 2 seeds, 1 subject.
- Put style intent on text/style or image/style edges.
- Route selects to a `style-selects` collection and alternates to `style-bank`.

## Character Consistency

Pattern: `Image Reference Collection -> Generation -> Compare -> Evaluation -> Filter`.

- Use image/face, image/clothing, and image/pose roles when references are available.
- Add a consistency score in Evaluation and send failures to `needs-character-repair`.
- Keep the parent character reference linked so recovery can find missing linked files.

## Product Campaign Variants

Pattern: `Product Reference -> Prompt -> Mutator -> Generation -> Review Funnel -> Collection Routing`.

- Split campaign variants by output intent: hero, social square, product detail, and ad crop.
- Keep product constraints locked with product and typography roles while mutating setting, style, lighting, copy angle, and composition.
- Route outputs into `campaign-selects`, `campaign-tests`, and `campaign-rejects`.

## Review Funnels

Pattern: `Generation -> Compare -> Evaluation -> Filter -> Collection`.

- Use Compare for pairwise taste or reference similarity.
- Use Evaluation for scoring rules such as product visibility, style match, prompt adherence, or character consistency.
- Keep Filter in dry-run routing until thresholds are reviewed.
- Store audit fields for artifact id, prompt id, edge role, score, threshold, route, and manual override.

## Role-Based Prompt Variants

Pattern: `Prompt -> Mutator -> Preset Fanout -> Generation`.

- Attach subject, style, composition, negative, typography, motion, and timing intent through connection roles.
- Give variation controls names: seed mode, weighted list, locked phrases, role weights, and mutation strength.
- Preview the assembled prompt table before creating a large run plan.

## Collection Routing And Artifact Librarian

Pattern: `User-Provided Dropped Assets -> Reference Nodes -> Generation -> Artifact Librarian -> Collection Routing`.

- Choose import, link, copy, or move mode explicitly before file operations.
- Use MCP/project-local files for user-provided dropped assets; do not operate the Ether UI or simulate drag/drop.
- Preserve channel metadata, lineage, parent run id, Prompt family node id, provider mode, and source path metadata.
- Keep collection routing visible with named exits such as `selects`, `needs-edit`, `rejects`, and `exports`.

## Multimodal Media Routing

Pattern: `Audio or Video Reference -> Adapter -> Prompt or Review Node`.

- Store audio and video as project-local reference assets with channel metadata.
- Enable audio to text only with transcription capability.
- Enable video to text only with transcription or caption capability.
- Enable video to image only with extraction capability.
- If capability is missing, leave the route disabled with a visible reason.

## Graph Patch Preview And Run Preview

Pattern: `Inspect -> Draft Patch -> Review Patch -> Save Graph -> Draft Run Preview -> Explicit Execute`.

- A graph patch preview lists node creates, node updates, edge creates, edge deletes, source channels, target channels, roles, adapters, collection changes, and file actions.
- A run preview lists target node or branch, cap, provider mode, channel/operation capability checks, expected artifacts, route destinations, and rollback point.
- Do not run the graph while preparing either preview.

## Provider Safety And Recovery

Pattern: `Provider Safety Check -> Simulation Mode -> CLI Mode Run -> Health Check -> Recovery`.

- Use provider safety before switching from CLI mode to MCP, API, Simulation, or Experimental modes.
- Keep API mode opt-in only and never use hidden API fallback.
- Use recovery after failed runs, missing linked files, orphan artifacts, bad routes, provider log errors, or 2.5 migration issues.
- Prefer a graph revision patch or relink action before destructive cleanup.
