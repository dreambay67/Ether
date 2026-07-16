---
name: ether-workflow
description: Use when an Ether project needs graph inspection, workflow editing, advanced skill routing, run-plan preview, or explicit user-approved execution.
---

# Ether Workflow

Use the `ether` MCP tools as the operating hub for local Ether 2.5 projects. Keep project files project-local, keep the graph inspectable, and treat every run as a user-approved action.

## Ether 2.5 Model

- Channels: text, image, mask, data, video, audio
- Roles: general, negative, subject, product, face, clothing, pose, setting, composition, style, lighting, colourPalette, typography, motion, timing
- Prompt family: Prompt, Brainstormer, Mutator, Expander, Reinforcer
- Ether 2.5 has one Prompt family, 15 roles, and six channels.
- Use the connection role grid to choose the edge role; use source and target channels to describe payload movement.
- Assistant is not a node family in Ether 2.5.
- Multimodal media routing is explicit: audio, video, image, mask, text, and data movement must match provider channel and operation capability.

## Universal Rules

- Inspect the current Ether graph before editing or execution.
- Always inspect the graph before execution; start with `ether_project_open`, `ether_graph_get`, `ether_node_contracts`, `ether_assets_list`, and `ether_run_status` as needed.
- Keep project-local files, prompts, asset metadata, provider logs, and run plans inside the Ether project unless the user explicitly asks for another destination.
- Create and edit workflows by default with `ether_node_create`, `ether_edge_create`, `ether_node_update`, and `ether_graph_save`.
- preview graph patches before saving meaningful topology changes. Summarize nodes, edges, contracts, channels, roles, destination collections, and file operations.
- preview run plans before execution. Name the target nodes or branch, provider mode, channel/operation capabilities, cap, expected artifacts, routing destinations, and rollback point.
- Use explicit execution only. Do not run generation, evaluation, routing, file operations, provider calls, or any execution unless the user explicitly asks.
- Never make silent generation or execution runs.
- Do not use browser or desktop automation to operate Ether or simulate drag/drop. Use MCP tools and project-local files only.
- only run nodes after the user explicitly asks to execute, generate, evaluate, filter, route, or run. Use `ether_run_node`, `ether_run_selected`, or `ether_run_branch` only for that explicit request.
- Prefer `ether_run_selected` for precise work and `ether_run_branch` only when the user wants a branch run with a cap.
- Treat generated assets and routed files as local project state. Verify with `ether_assets_list`, `ether_collections_list`, and `ether_run_status`.

## Focused Skill Router

- Use $ether-connection-model when the task needs the node role channel model, connection role grid, exact channels and roles, or multimodal media routing.
- Use $ether-graph-architect when the task is graph topology, node and edge patterns, templates, graph patch preview, or run preview.
- Use $ether-prompt-systems when the task is Prompt family design, connection roles, references, controls, presets, or variant strategy.
- Use $ether-review-router when the task is Compare, Evaluation, Filter loops, Data outputs, collection destinations, manual overrides, or audit trails.
- Use $ether-artifact-librarian when the task is six-channel asset import, link, move, copy, collections, lineage, metadata hygiene, or user-provided dropped assets.
- Use $ether-provider-safety when the task touches CLI, MCP, API, Simulation, Experimental provider modes, channel/operation capabilities, or why a run can or cannot execute.
- Use $ether-recovery when the task is health checks, 2.5 migration, missing linked files, orphan artifacts, provider logs, or recovery actions.

## Hub Workflow

1. Inspect the project and graph state.
2. Pick the focused skill if the user is asking for advanced graph, connection, prompt, review, artifact, provider, or recovery work.
3. Draft the smallest useful graph patch. Include created nodes, updated parameters, edge channels, edge roles, collection destinations, and file actions.
4. Save graph edits only after the patch is clear and local.
5. For execution requests, draft a run preview with target, cap, provider mode, expected outputs, channel/operation capability checks, and review or recovery checkpoints.
6. Run only after explicit approval for that exact execution scope.

## Common Patterns

Create a text-to-image branch:

1. Inspect contracts with `ether_node_contracts`.
2. Add Prompt and Generation nodes with `ether_node_create`.
3. Wire text to image with role `general` or a specific role from the connection role grid.
4. Preview the graph patch, then save and report what changed.
5. Wait for explicit permission before running generation.

Create a review router:

1. Add Compare, Evaluation, Filter, and Collection nodes.
2. Wire Data outputs through `Compare -> Evaluation -> Filter`.
3. Wire Filter to collection destinations with data routes such as `selects`, `needs-edit`, and `rejects`.
4. Keep Filter in dry-run until the user approves physical collection routing.

Execute on request:

1. Confirm the target node or branch, provider mode, channel/operation capabilities, and run cap.
2. Use `ether_run_selected` or `ether_run_branch`.
3. Report new run records, generated assets, moved files, and any health issues.

## Recipes

Use `skills/ether-workflow/recipes/advanced-workflows.md` for concrete node patterns covering style exploration, character consistency, product campaign variants, review funnels, role-based prompt variants, collection routing, multimodal media routing, provider safety, and recovery.
