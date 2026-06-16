# Ether V1 Master Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Ether, a Windows-first local desktop node canvas for subscription-backed AI image generation, editing, evaluation, filtering, collection, and Codex-controlled workflow authoring.

**Architecture:** Ether is a local-first Electron desktop app backed by a shared TypeScript workflow engine, SQLite project database, physical project folders, provider adapters, and a Codex MCP/plugin control layer. The desktop app owns the visual canvas and human review; the engine owns graph contracts, execution, lineage, prompt assembly, storage, and routing. Codex can create and edit workflows, inspect state, and execute only when the user requests it.

**Tech Stack:** Electron, React, TypeScript, Vite, @xyflow/react, SQLite, Zod, Vitest, Playwright, Node MCP server, pnpm workspace, local filesystem storage, Codex CLI/provider adapter, no Firebase, no OpenAI Platform API.

---

## Locked Product Decisions

- New repository: `C:\Users\deny7\Documents\Codex\2026-05-29\ether`.
- Target platform: Windows desktop first.
- Runtime model: local-first and offline-capable except for model/provider calls.
- Cloud: Firebase is dropped for V1.
- Paid API: explicitly blocked, even if an API key exists in the environment.
- Provider rule: clean CLI/MCP only. No browser automation and no desktop UI automation.
- Provider priority: ChatGPT Image 2 first, then investigate Nano Banana Pro and Nano Banana 2 through clean CLI/MCP only.
- Codex role: create/edit/inspect workflows by default; execute only by user command.
- Storage principle: uploaded references are linked by default; generated outputs live in Ether project directories.
- Collections: mirror real local folders.
- File routing: Directory/Collection/Filter physically move generated files by default, with audit history.
- Running: both cached-input and upstream-first modes must exist.
- Batching: sequential by default; parallel selectable.
- Prompt variation: seedable plus LLM-based, controlled by sliders and presets.
- Review routing: Compare, Evaluate, and Filter remain separate nodes. Provide reusable templates that combine them.
- Previous app: discard after harvesting useful concepts only.

## Standard Practice Recommendation For Codex Plugin

Version the Codex plugin inside the Ether repo, but install it separately into Codex when needed.

Recommended structure:

```text
ether/
  apps/desktop/
  packages/engine/
  packages/mcp-server/
  packages/codex-plugin/
  packages/provider-codex/
  packages/provider-google/
  packages/ui/
  packages/brand/
```

Why this is the right standard for Ether:

- The desktop app stays usable without Codex installed.
- The plugin and MCP server stay version-aligned with the workflow engine.
- Codex skills can be updated with the app while still being explicit user-installed tooling.
- The engine can be tested once and reused by desktop UI, MCP tools, and future automation.

## Compare / Evaluate / Filter Recommendation

Keep these as three separate nodes because they do different jobs:

- **Compare**: human review surface. Manual grid, ratings, tags, notes, side-by-side inspection.
- **Evaluate**: AI/vision interpretation. Writes metadata, scores, labels, confidence, reasoning, and pass/fail decisions.
- **Filter**: deterministic routing. Reads metadata/rules and moves outputs into Collections or Directories.

Add a reusable **Review Router template** that creates all three wired together:

```text
Generation -> Compare -> Evaluate -> Filter -> Collections
```

This gives full control while avoiding a universal node that becomes impossible to reason about.

## Run Behavior Recommendation

Every runnable node should expose a run policy:

- **Use Cached Inputs**: run only this node using the latest stored upstream artifacts.
- **Refresh Upstream First**: run required upstream nodes before this node.
- **Run Downstream**: run this node and eligible downstream nodes.
- **Run Branch**: run all executable nodes in the selected branch up to a cap.
- **Run Selected**: run multiple selected nodes in dependency order.

For prompt nodes specifically, **Run Node** means “assemble and freeze a prompt artifact.” It does not generate an image.

## Prompt Randomization Recommendation

Use both local prompt-node controls and explicit Assistant nodes.

Prompt nodes should support:

- locked sections,
- seed,
- variation strength,
- novelty,
- drift,
- preserve-subject slider,
- preserve-style slider,
- negative constraints,
- custom mutation instruction,
- presets such as Whisper, Lens Shift, Costume Drift, Lighting Weather, Material Swap, Composition Nudge, Radical Concept.

Assistant Mutator nodes should support deeper pipeline behavior:

```text
Prompt -> Mutator -> Generation
Prompt -> Mutator -> Mutator -> Generation Grid
Moodboard -> Mutator -> Style Prompt -> Generation
```

Every mutation must store:

- source text,
- instruction,
- seed,
- slider settings,
- resulting text,
- lineage link.

---

## Project Bundle Format

Ether projects should be folder bundles with an `.ether` suffix so physical storage and project identity stay together.

```text
ProjectName.ether/
  project.json
  graph.json
  ether.db
  assets/
    references/
      linked-index.json
    generated/
      2026/
        06/
          generation-node-id/
    masks/
    previews/
  collections/
    Selected/
    Needs-Edit/
    Rejected/
  directories/
  runs/
    run-log.jsonl
  snapshots/
  templates/
  exports/
```

`project.json` owns project identity, app version, brand settings, provider preferences, autosave settings, and active project metadata.

`graph.json` owns canvas nodes, edges, layout, viewport, selected snapshot, node sizes, comments, and visual-only state.

`ether.db` owns searchable metadata, lineage, run records, evaluation scores, filter audit logs, and asset indexes.

Generated images are copied into `assets/generated` first. When moved into Collections, they physically move to `collections/<collection-name>/` and the database records the move.

References remain linked to the original file path by default, with optional “copy into project” available later.

---

## Node Contracts

### Prompt Nodes

Types:

- General
- Subject
- Clothing
- Pose
- Setting
- Composition
- Style
- Lighting
- Colour Palette
- Typography
- Custom
- Negative

Inputs:

- prompt artifact,
- assistant text artifact,
- moodboard text artifact.

Outputs:

- prompt artifact with section type,
- assembled text preview,
- locked terms,
- mutation settings,
- negative constraints.

Run behavior:

- assemble upstream text,
- apply section rules,
- apply mutation if enabled,
- store frozen prompt artifact.

### Reference Nodes

Types:

- Image
- Video Reference
- Colour Grid
- Moodboard

Inputs:

- local linked file,
- generated image asset,
- optional mask,
- optional steering prompt.

Outputs:

- role-labeled reference artifact,
- extracted palette,
- moodboard interpretation,
- keyframe/reference metadata.

Required roles:

- General
- Subject
- Clothing
- Pose
- Setting
- Composition
- Style
- Lighting
- Colour Palette
- Typography
- Custom
- Negative

Connection labels must be editable on the canvas.

### Edit Nodes

Types:

- Inpaint
- Expand / Outpaint
- Draw & Note
- Upscale

Inputs:

- image asset,
- prompt artifact,
- reference artifact,
- mask artifact,
- note artifact.

Outputs:

- edited image asset,
- edit lineage,
- mask lineage,
- provider metadata.

Upscale should support provider upscale when available and local open-source upscale when installed/configured.

### Store Nodes

Types:

- Directory
- Collection
- Compare
- Evaluate
- Filter

Directory:

- root physical destination for a stream.
- can contain Collections.
- can receive generated assets and moved assets.

Collection:

- physical folder mirrored in the project.
- naming conventions and metadata schema.
- can feed Reference nodes.

Compare:

- manual review grid: 2, 3, 4, 6, 8.
- rating 1-5.
- tags, notes, reject/favorite/select.
- no automatic routing by itself.

Evaluate:

- AI/vision metadata writer.
- accepts generation outputs, directories, collections, references, and prompt artifacts.
- writes scores, tags, confidence, explanation, decision.

Filter:

- deterministic routing node.
- rules read metadata, score, tags, model, source node, prompt terms, and evaluation decisions.
- auto-applies by default.
- keeps dry-run and manual override.
- writes audit logs for every move.

### Assistant Nodes

Types:

- Brainstormer
- Mutator
- Expander
- Reinforcer

Inputs:

- prompt artifact,
- moodboard artifact,
- reference metadata,
- generated output metadata,
- note text.

Outputs:

- text artifact,
- prompt section artifact,
- mutation artifact,
- decision/rationale artifact.

All Assistant outputs must remain visible and editable before downstream use.

### Generation Nodes

Types:

- Image
- Grid
- Character Sheet
- Infographic

Inputs:

- prompt artifacts,
- negative prompt artifacts,
- role-labeled references,
- style/moodboard artifacts,
- provider settings.

Outputs:

- generated image assets,
- final assembled prompt,
- provider metadata,
- lineage,
- filmstrip variants,
- run record.

Required controls:

- model selector,
- aspect ratio,
- resolution presets,
- variant count,
- seed when supported,
- run policy,
- latest image preview,
- film wheel below preview.

### Note Nodes

Types:

- Cloud
- Bubble
- Free Draw

Inputs:

- none required.

Outputs:

- visual note artifact when connected to Assistant, Prompt, or Evaluate nodes.

Notes are visual-only unless connected into a text-consuming node.

---

## Visual Design System

Ether must use the supplied handbooks as non-negotiable visual source of truth.

Brand files:

- `C:/Users/deny7/Downloads/DreamBay-Visual-Identity-Handbook.pdf`
- `C:/Users/deny7/Downloads/Ether-Visual-Identity-Handbook.pdf`
- `C:/Users/deny7/Downloads/Ether_logo.png`
- `C:/Users/deny7/Downloads/DB_logo.png`

Core rules:

- Product name: ETHER.
- Lockup: ETHER by DreamBay.
- Primary Ether color: Electric Blue `#1470DB`.
- Use DreamBay gradient as inherited brand highlight, not as a generic full-screen wash.
- Use air fields, sparse clear bubbles, pressure rings, and mask flow as operational state visuals.
- Avoid decorative bubbles; bubbles should indicate selection, generation, refinement, confidence, or pass intensity.
- Canvas should feel airy but remain precise.
- Panels should be floating, movable, collapsible, and operational.
- Avoid one-note purple/blue gradients; use contrast, neutral depth, cyan/aqua signal, violet accent, and dark command surfaces.

Primary layout:

```text
Top shell: ETHER by DreamBay, project controls, provider status, command palette
Left rail: nested draggable node library
Center: infinite graph canvas
Right rail: inspector for selected node/edge/project/run
Bottom rail: live run info, queue, logs, trace, provider messages
Minimap: visible, collapsible
```

Interaction requirements:

- smooth zoom,
- right-click canvas actions,
- keyboard shortcuts,
- undo/redo buttons,
- delete/remove nodes by mouse and keyboard,
- resizable nodes,
- drag node onto edge to insert,
- editable edge labels,
- upload by button and drag/drop,
- Ctrl-drag image to split into separate reference nodes,
- Shift-drag generated image to create Edit node,
- Shift+Ctrl-drag generated image to create multiple Edit nodes.

---

## Repository Structure

```text
ether/
  README.md
  AGENTS.md
  package.json
  pnpm-workspace.yaml
  .gitignore
  docs/
    product/
      ether-build-spec.md
      node-contracts.md
      provider-policy.md
      visual-system.md
    superpowers/
      plans/
        2026-06-16-ether-v1-master-plan.md
  apps/
    desktop/
      package.json
      src/
        main/
        preload/
        renderer/
  packages/
    brand/
    engine/
    providers/
      codex/
      google/
      fake/
    mcp-server/
    codex-plugin/
    ui/
    testing/
```

File responsibility map:

- `packages/engine`: graph schema, node contracts, execution scheduler, prompt assembly, lineage, dirty/rerun state, project persistence.
- `packages/providers/codex`: ChatGPT Image 2 provider via clean Codex CLI path.
- `packages/providers/google`: Nano Banana Pro / Nano Banana 2 provider discovery and clean CLI/MCP integration if available.
- `packages/providers/fake`: deterministic local provider for tests.
- `packages/mcp-server`: MCP tools that call the engine.
- `packages/codex-plugin`: Codex plugin manifest, skills, install notes, and MCP registration.
- `packages/brand`: Ether/DreamBay tokens, logo copies, CSS variables, visual-state primitives.
- `packages/ui`: shared React components for nodes, panels, inspectors, command palette, status chips.
- `apps/desktop`: Electron shell, React Flow canvas, IPC, windows, menus, project open/save, local settings.
- `docs/product`: human-readable product specs and acceptance criteria.

---

## Implementation Phases

### Phase 0: Repo Foundation

Definition of done:

- pnpm workspace exists.
- Electron desktop app launches on Windows.
- Unit test runner works.
- Playwright smoke test can open the app.
- Brand assets are copied into the repo with source references.
- No provider calls yet.

Validation:

- `pnpm install`
- `pnpm test`
- `pnpm desktop:dev`
- app shows branded Ether shell.

### Phase 1: Local Project System

Definition of done:

- create/open/save `.ether` folder bundle.
- SQLite database initializes.
- graph JSON saves and reloads.
- autosave every minute configurable.
- A/B/C/D snapshots work.
- project health check detects missing linked references.

Validation:

- create project,
- add test graph state,
- close/reopen,
- verify graph, DB rows, and project metadata survive.

### Phase 2: Graph Canvas And Core UI

Definition of done:

- React Flow canvas with custom Ether nodes.
- left node library with nested categories.
- right inspector edits selected node/edge.
- bottom run panel shows queue/logs.
- minimap present.
- node deletion, undo/redo, resizing, edge labels, right-click actions, keyboard shortcuts.
- drag node onto edge inserts it.

Validation:

- create every node type,
- connect valid edges,
- reject invalid edges with a clear message,
- delete nodes by button and Delete key,
- reload graph intact.

### Phase 3: Node Contracts And Prompt Assembly

Definition of done:

- all node types have explicit input/output contracts.
- prompt-to-prompt composition works.
- reference roles resolve.
- negative prompts merge as constraints.
- prompt nodes run and freeze prompt artifacts.
- edge labels affect role/meaning.

Validation:

- unit tests for prompt composition,
- unit tests for reference role resolution,
- unit tests for invalid connections,
- visual inspector shows final assembled prompt.

### Phase 4: Asset System

Definition of done:

- upload button links references.
- drag/drop image creates Reference node.
- Ctrl-drag creates separate nodes.
- generated outputs save into project-generated directory.
- Collection nodes mirror physical folders.
- Directory nodes define physical stream roots.
- file moves are audited.

Validation:

- link external reference,
- generate fake output,
- move through Filter into Collection,
- confirm file physically moved and database updated.

### Phase 5: Execution Engine

Definition of done:

- run policies implemented: cached inputs, refresh upstream first, downstream, branch, selected.
- queue is sequential by default.
- parallel mode selectable.
- run cap works.
- node locks prevent changes/reruns.
- rerun state replaces vague dirty state.

Validation:

- fake provider branch run executes exactly requested count.
- upstream-first mode refreshes required prompt artifacts.
- cached-input mode does not rerun upstream generation nodes.
- selected nodes run in dependency order.

### Phase 6: Generation Provider System

Definition of done:

- provider capability registry exists.
- fake provider works for tests.
- Codex/ChatGPT Image 2 provider uses clean local CLI/MCP route.
- OpenAI Platform API use is blocked.
- provider diagnostics surface unavailable features.
- Nano Banana Pro / Nano Banana 2 are investigated and integrated only if clean CLI/MCP exists.

Validation:

- fake generation produces deterministic image artifact.
- ChatGPT Image 2 generation produces real image artifact.
- missing/unavailable provider gives useful non-destructive error.
- setting `OPENAI_API_KEY` does not cause API fallback.

### Phase 7: Edit And Mask Workflows

Definition of done:

- Shift-drag generated image creates Edit node.
- Inpaint, Outpaint, Draw & Note, Upscale nodes execute real behavior through available providers/local tools.
- masks are visual overlays and stored artifacts.
- edits preserve lineage.
- images are zoomable/inspectable in node.

Validation:

- fake edit test produces new asset with parent lineage.
- mask artifact saves and reloads.
- upscale path works with configured provider/local tool.

### Phase 8: Assistant And Mutation System

Definition of done:

- Brainstormer, Mutator, Expander, Reinforcer nodes execute text behavior.
- prompt section randomization works with sliders and presets.
- seedable mutation works.
- LLM mutation stores before/after text and settings.
- downstream generation receives mutated prompt artifact.

Validation:

- unit tests for seed stability.
- unit tests for locked prompt terms.
- visual trace shows mutation lineage.

### Phase 9: Compare / Evaluate / Filter

Definition of done:

- Compare grid supports 2/3/4/6/8 layouts.
- ratings and tags write metadata.
- Evaluate reads assets and instructions, writes scores/tags/decision/confidence/explanation.
- Filter auto-applies by default and moves files to Collections.
- dry-run, manual override, and audit trail exist.
- Review Router template wires Compare -> Evaluate -> Filter.

Validation:

- create generation batch,
- evaluate outputs,
- filter into three collections,
- confirm files moved physically,
- confirm audit trail records rule and metadata.

### Phase 10: Codex MCP And Plugin

Definition of done:

- MCP tools can open project, save graph, inspect node contracts, create workflows, run selected nodes, run branch, list assets, import asset, and report run status.
- Codex plugin includes Ether-specific skills for workflow creation and editing.
- Codex defaults to inspect-first; execution requires explicit user command.
- plugin install instructions work locally.

Required MCP tools:

- `ether_project_open(projectPath)`
- `ether_project_create(projectPath, name)`
- `ether_graph_get(projectPath)`
- `ether_graph_save(projectPath, graph)`
- `ether_node_create(projectPath, node)`
- `ether_edge_create(projectPath, edge)`
- `ether_node_update(projectPath, nodeId, patch)`
- `ether_run_node(projectPath, nodeId, policy)`
- `ether_run_selected(projectPath, nodeIds, policy)`
- `ether_run_branch(projectPath, nodeId, runCountCap, parallel)`
- `ether_assets_list(projectPath, query)`
- `ether_asset_import(projectPath, filePath, role, linkMode)`
- `ether_collections_list(projectPath)`
- `ether_health_check(projectPath)`

Validation:

- Codex creates a workflow from a natural-language prompt.
- user inspects graph in Ether.
- Codex runs a selected node only after explicit request.
- generated artifact appears in desktop canvas.

### Phase 11: Packaging And Acceptance

Definition of done:

- Windows desktop package builds.
- local settings persist.
- app recovers from failed provider call.
- visual QA passes against handbooks.
- manual acceptance workflow passes end-to-end.

Manual acceptance workflow:

1. Create new Ether project.
2. Add two prompt nodes feeding a Generation node.
3. Drag in two references with different roles.
4. Run prompt assembly.
5. Run Generation with ChatGPT Image 2.
6. Branch output into Edit node with mask guidance.
7. Run edit.
8. Send variants into Compare.
9. Evaluate outputs with custom instruction.
10. Filter into Collections.
11. Confirm files physically moved.
12. Reload app and verify graph/history intact.
13. Use Codex to add a new workflow branch.
14. Inspect in app before execution.
15. Execute selected node from Codex on explicit command.

---

## Testing Strategy

Unit tests:

- prompt composition,
- prompt mutation,
- locked terms,
- reference role resolution,
- connection validation,
- run policy resolution,
- run cap behavior,
- local project save/load,
- physical file move audit,
- fake provider output validation,
- filter rule matching.

Integration tests:

- desktop backend creates and opens `.ether` project.
- graph saves/reloads through Electron IPC.
- MCP server creates graph and runs fake provider.
- auto queue runs exact requested count.
- collection folder mirrors node state.

Visual/browser tests:

- branded shell renders.
- canvas is nonblank.
- nodes are draggable/resizable.
- inspector edits persist.
- keyboard delete works.
- right-click menu works.
- no major overlap at common desktop sizes.

Manual tests:

- full acceptance workflow above.
- provider unavailable path.
- no API fallback path.
- project health check.

---

## Risk Register

### ChatGPT Image 2 Access

Risk: The sketch proved a working path, but the new implementation must rediscover and isolate that path cleanly.

Mitigation:

- build fake provider first,
- encapsulate Codex provider behind one adapter,
- add provider diagnostics,
- block API fallback.

### Nano Banana Pro / Nano Banana 2

Risk: clean CLI/MCP access may not exist.

Mitigation:

- investigate as a provider-discovery task,
- integrate only if clean route exists,
- expose unavailable status honestly in capability matrix.

### Physical File Moves

Risk: moving generated files can break graph references.

Mitigation:

- move through asset service only,
- update DB in same transaction,
- append audit record,
- store stable asset IDs independent of path.

### Node Scope Explosion

Risk: too many node behaviors create a fragile UI.

Mitigation:

- typed node contracts,
- shared node shell,
- reusable inspectors,
- strict input/output artifacts.

### Brand Over-Decoration

Risk: bubbles/air/rings become decoration instead of operational state.

Mitigation:

- bind each motif to state semantics,
- visual QA against Ether handbook,
- keep canvas clarity first.

---

## First Execution Slice

The first build slice should prove the spine before adding every advanced node:

```text
Electron shell
-> .ether project create/open/save
-> React Flow canvas
-> Prompt + Reference + Generation + Collection
-> fake provider
-> physical generated asset
-> save/reload
-> basic MCP graph read/write
```

This slice is not the final product, but it proves the local app, project storage, graph model, node contracts, asset handling, and Codex control surface all fit together.

After that, add the full node library and real providers.

---

## Build Completion Criteria

Ether V1 is complete only when:

- all node categories from the brief exist and execute real behavior,
- ChatGPT Image 2 generation works through clean subscription-backed local route,
- no paid OpenAI API fallback exists,
- generated assets are stored locally and routed physically,
- Evaluate and Filter can auto-apply routing,
- prompt mutation works with sliders and presets,
- Codex can create/edit workflows and execute on explicit command,
- the app can be closed/reopened without losing graph, assets, metadata, or lineage,
- visual implementation follows the Ether and DreamBay handbooks.
