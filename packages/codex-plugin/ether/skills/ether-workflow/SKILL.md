---
name: ether-workflow
description: Create, inspect, edit, and explicitly run local Ether node-canvas image workflows through the Ether MCP server. Use when working with Ether project bundles, graph nodes, prompt/reference/generation/edit/review-routing workflows, or Codex-authored Ether canvas branches.
---

# Ether Workflow

Use the `ether` MCP tools as the control surface for local Ether projects.

## Operating Rules

- Always inspect the graph before execution.
- Create and edit freely, but only run nodes after the user explicitly asks.
- Inspect the graph before execution. Start with `ether_project_open`, `ether_graph_get`, `ether_node_contracts`, `ether_assets_list`, and `ether_run_status` as needed.
- Create and edit workflows by default. Use `ether_node_create`, `ether_edge_create`, `ether_node_update`, and `ether_graph_save` without running anything.
- Only run nodes after the user explicitly asks to execute, generate, evaluate, filter, route, or run. Use `ether_run_node`, `ether_run_selected`, or `ether_run_branch` only for that explicit request.
- Prefer `ether_run_selected` for precise work and `ether_run_branch` only when the user wants a branch run with a cap.
- Treat generated assets and routed files as local project state. Verify with `ether_assets_list`, `ether_collections_list`, and `ether_run_status`.

## Common Patterns

Create a prompt-to-generation branch:

1. Inspect contracts with `ether_node_contracts`.
2. Add Prompt and Generation nodes with `ether_node_create`.
3. Wire Prompt to Generation with `ether_edge_create`.
4. Save and report what changed.
5. Wait for explicit permission before running generation.

Create a review router:

1. Add Compare, Evaluate, Filter, and Collection nodes.
2. Wire `Compare -> Evaluate -> Filter`.
3. Wire Filter to collection destinations with labels such as `pass`, `needs-edit`, and `fail`.
4. Keep Filter in dry-run if the user wants to inspect routing before physical moves.

Execute on request:

1. Confirm the target node or branch and the run cap.
2. Use `ether_run_selected` or `ether_run_branch`.
3. Report new run records, generated assets, moved files, and any health issues.
