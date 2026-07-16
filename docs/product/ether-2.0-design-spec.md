# Ether 2.0 Product And Design Spec

**Status:** Draft for approval
**Date:** 2026-06-26
**Product:** Ether by DreamBay
**Platform:** Windows desktop, local-first
**Primary user:** A creator building serious AI image workflows with visual control, reusable graph logic, local files, and explicit Codex assistance.

---

## 1. Product Promise

Ether 2.0 is a local-first AI creative graph canvas where prompts, references, edits, assistant reasoning, review, filtering, collections, and generated images become visible, reusable production systems.

The app should feel closer to a serious creative instrument than a prototype:

- The canvas is the primary surface.
- Nodes explain what they need, what they produce, and what happens when they run.
- Every output is saved locally with lineage.
- Codex can help author and inspect workflows, but execution remains explicitly user-controlled.
- CLI Codex remains the default provider route.
- API provider infrastructure may exist for future optional generation and assistant providers, but no API route may silently replace the subscription-backed Codex route.
- Provider routing must use clean CLI/MCP/API adapter surfaces, not browser or desktop automation.

Launch-language version:

> Ether is the local Higgsfield-style canvas for serious AI image production: build visual pipelines, generate and edit through subscription-backed tools, compare and route variants, and keep the whole creative history on your machine.

---

## 2. Design Principles

1. **Canvas first, plumbing second.** Project paths, graph internals, and health diagnostics should not dominate first-run use.
2. **Inspect before execution.** The user should always be able to inspect assembled prompts, references, run plans, and file moves before heavy actions.
3. **Nodes should teach themselves.** A user should understand a node from its card, ports, inspector sections, and hover help.
4. **AI assistance is powerful but reviewable.** Codex may propose branches, mutate prompts, evaluate images, and route outputs, but graph edits and execution are visible and gated.
5. **Local artifacts are sacred.** Generated outputs, masks, evaluations, collection moves, and lineage must survive restarts and crashes.
6. **Provider honesty beats smooth illusion.** Fake, unavailable, experimental, and real providers must be visibly distinct.
7. **Workflow reuse is a core feature.** Templates, branches, snapshots, collections, and recipes are product surfaces, not hidden files.

---

## 3. The 14 Required 2.0 Pillars

### 3.1 Creator-Grade Project Start

Replace raw path-first setup with a start experience:

- New Project
- Open Project
- Recent Projects
- Try Sample Project
- Check Providers
- Recover Project

The default new project flow uses native Windows dialogs for parent folder selection. The app should suggest `Documents\Ether Projects` but never require the user to type a path.

The start surface should show:

- Project name
- Last opened date
- Provider health summary
- Last run status
- Local storage location

Advanced graph commands such as Load Graph, Save Graph, and Health move into an Advanced or Project Health drawer.

### 3.2 Canvas-First UX

The empty canvas should offer three visible actions:

- Drop a prompt
- Drop an image
- Choose a workflow template

Node creation must support:

- Searchable Add Node command
- Left node shelf with descriptions and favorites
- Right-click canvas quick add
- Drag image onto canvas to create a Reference node
- Drag generated output into downstream node creation
- Template insertion
- Command palette

Canvas controls should be direct and named. Developer/test-harness commands such as "connect first valid pair" should not be primary UI.

### 3.3 Professional Node Cards

Every node card should show:

- Node kind and subtype
- Short body preview or asset preview
- Input readiness
- Output state
- Provider/model when relevant
- Missing inputs
- Stale/running/complete/error status
- Variant count when relevant
- Primary next action

Generated image previews should have visible actions:

- Branch
- Edit
- Compare
- Evaluate
- Save to Collection
- Use as Reference

Prompt nodes should show prompt body preview. Titles remain system-owned. User notes appear as optional attached note panels.

### 3.4 Typed Connections

Connections must become self-explanatory:

- Typed input and output ports
- Live valid-target highlighting while dragging
- Invalid connection reason near cursor
- Role chips on reference edges
- Edge inspector for role, weight, note, and routing label
- Role labels rendered on canvas

Reference roles are selected, not typed. Default role is `context`.

The canonical role set for 2.0:

- context
- subject
- style
- composition
- product
- face
- setting
- lighting
- color
- typography
- negative

### 3.5 Modular Inspector

The inspector becomes node-specific and sectioned:

- Setup
- Inputs
- Run
- Output
- Review
- Advanced

The top of the inspector always shows the node's primary action:

- Prompt: Assemble
- Assistant: Run Assistant
- Generation: Generate
- Edit: Edit Image
- Compare: Compare
- Evaluate: Evaluate
- Filter: Route
- Collection: Open Collection
- Directory: Mirror Folder
- Note: Edit Note

Each section should include hover help generated from node contracts and field metadata.

### 3.6 Durable Run Coordinator

Desktop and MCP must submit work through one shared engine coordinator.

The coordinator owns:

- Job creation
- Dependency graph
- Sequential/parallel mode
- Queue state
- Attempts and retries
- Cancellation
- Progress events
- Provider calls
- Result commits
- Failure recovery

This removes desktop/MCP behavior drift and makes runs recoverable after restart.

### 3.7 Revisioned Graph Saves

Graph saves use revisions:

- Every graph edit increments or prepares a revision.
- Saves carry a `baseRevision`.
- Runs execute against a frozen graph snapshot.
- Run outputs commit graph patches through the coordinator.
- Stale saves are rejected with a recoverable conflict message.

`graph.json` remains human-readable, but SQLite becomes canonical for revisions, jobs, artifacts, and lineage.

### 3.8 First-Class Artifact System

Artifacts are records, not loose node fields.

Artifact types:

- prompt
- negative_prompt
- reference
- image
- edit
- mask
- evaluation
- route
- collection_membership
- report

Each artifact stores:

- Stable id
- Type
- File path when applicable
- Content hash
- MIME type
- Dimensions
- Source node id
- Source run item id
- Provider id
- Parent artifact ids
- Prompt snapshot
- Reference roles
- Metadata
- Tags
- Rating
- Created timestamp

### 3.9 Provider Control 2.0

Provider behavior must be explicit.

Required surfaces:

- Provider selector
- Provider health check
- Capability matrix
- Real/simulation/experimental badges
- Per-node model/provider settings
- Timeout/retry controls
- Reasoning effort for assistant and evaluation nodes
- Strict provider policy display
- Optional API credential status when an API provider is intentionally enabled
- Per-provider data disclosure summary

Provider priorities:

1. ChatGPT Image 2 through clean Codex/subscription route
2. Codex vision assistant for prompt/graph/image reasoning
3. Fake provider only as explicit Simulation Mode
4. Optional API-backed generation and assistant providers through explicit adapters
5. Nano Banana Pro and Nano Banana 2 as experimental capability slots until a clean non-browser route exists

Provider architecture must support:

- CLI providers
- MCP providers
- API providers
- Simulation providers
- Experimental unavailable providers

API providers must be opt-in, visibly labeled, and never used as fallback for Codex/subscription routes. Credential checks must be separated from execution so the app can show readiness without sending a generation request.

### 3.10 Real Vision Evaluation

Compare, Evaluate, and Filter stay separate nodes.

Compare:

- Manual side-by-side review
- Zoom view
- Select winner
- Rating and notes
- Send selected assets downstream

Evaluate:

- Codex vision-backed scoring
- Tags
- Pass/fail
- Confidence
- Explanation
- Detected issues
- Suggested next edit

Filter:

- Rule-based and AI-assisted routing
- Dry-run preview
- Collection destination selection
- Metadata edits
- Move/copy/link mode
- Move audit

### 3.11 Artifact Browser

Add a professional asset browser:

- Filmstrip
- Grid
- Search
- Tags
- Ratings
- Collections
- Lineage view
- Used-by view
- Provider/run filter
- Drag artifact to canvas
- Drag artifact to collection
- Open file location

The browser is the user's working memory for large workflows.

### 3.12 Codex Co-Pilot Lane

Codex should help with workflow authoring through a reviewable lane:

- Propose branch
- Rewrite selected prompt
- Add review router
- Build template from selected nodes
- Explain graph
- Find missing inputs
- Suggest next node
- Produce graph diff
- Apply or discard
- Build advanced graph recipes from natural language
- Create reusable templates from selected nodes
- Diagnose why a workflow is not producing the expected visual result
- Suggest reference roles, edge weights, and filter rules
- Design prompt mutation systems with controlled randomness
- Create review rubrics for Evaluate and Filter nodes

Codex cannot silently run image generation. Execution requires explicit user action.

The Ether Codex plugin should feel like a specialist creative workflow operator, not a thin MCP wrapper. It should include skill guidance for graph architecture, prompt systems, review routing, artifact organization, provider safety, and recovery.

### 3.13 Mask/Edit Workspace

Edit nodes need a dedicated editing surface:

- Brush
- Eraser
- Opacity
- Brush size
- Mask preview
- Before/after
- Crop frame
- Outpaint frame
- Saved mask artifact
- Edit recipe presets

Masks are guidance artifacts. The app should not claim pixel-perfect native inpainting unless the active provider contract supports it.

### 3.14 Launch Hardening

2.0 should move toward public-grade reliability:

- Autosave
- Snapshot restore
- Project migrations
- Project locks
- Crash recovery
- Provider diagnostics
- Local privacy controls
- Clear provider logs
- Security pass on IPC/MCP inputs
- Installer/versioning
- Release notes
- Manual acceptance workflow using a real provider

---

## 4. Core Screens

### 4.1 Start Screen

Purpose: get the user into a project without path literacy.

Primary actions:

- New Project
- Open Project
- Try Sample
- Check Providers

Secondary actions:

- Recover Project
- Open Recent
- Project Health

### 4.2 Main Canvas

Layout:

- Top thin command bar: project name, save state, provider state, run controls, command palette.
- Left collapsible shelf: search, node library, templates.
- Center infinite canvas.
- Right collapsible inspector: selected node/edge/artifact.
- Bottom collapsible production rail: queue, run timeline, artifact browser, logs.

The canvas should expand with window size. Toolbars remain stable and thin.

### 4.3 Run Plan Preview

Before running a branch, show:

- Nodes that will run
- Nodes that are already current
- Dirty inputs
- Provider calls
- Estimated output count
- File destinations
- Sequential/parallel mode
- Cancel before start

### 4.4 Artifact Browser

Views:

- Filmstrip
- Grid
- Compare
- Lineage
- Collection

Actions:

- Rate
- Tag
- Compare
- Evaluate
- Route
- Use as Reference
- Edit
- Reveal in Explorer

### 4.5 Project Health

Shows:

- Provider readiness
- Missing linked files
- Orphan assets
- Failed moves
- Stale graph mirror
- Migration status
- Recovery actions

---

## 5. Node System 2.0

### 5.1 Node Categories

Prompt:

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

Reference:

- Image
- Video
- Colour Grid
- Moodboard

Assistant:

- Brainstormer
- Mutator
- Expander
- Reinforcer
- Vision Analyst
- Prompt Critic

Generation:

- Image
- Grid
- Character Sheet
- Infographic

Edit:

- Inpaint
- Outpaint
- Variation
- Refine

Review:

- Compare
- Evaluate
- Filter

Store:

- Collection
- Directory

Utility:

- Note
- Group
- Template Anchor

### 5.2 Node Data Separation

Each node separates:

- Visual state
- Config
- Runtime state
- Artifacts
- Notes
- Validation

This avoids placing generated outputs, settings, prompt text, and UI-only fields into one loose data object.

### 5.3 Contracts

Each node contract declares:

- Accepted input artifact types
- Produced output artifact types
- Required inputs
- Optional inputs
- Multiplicity
- Provider requirements
- Run action
- Dirty-state rules
- Inspector sections
- Help text

---

## 6. Data And Storage

Project bundle remains `.ether`.

Required internal structure:

- `project.json`
- `graph.json`
- `ether.db`
- `assets/references`
- `assets/generated`
- `assets/masks`
- `collections`
- `runs`
- `snapshots`
- `templates`
- `exports`

SQLite owns:

- graph revisions
- jobs
- job items
- job dependencies
- job events
- artifacts
- artifact versions
- lineage edges
- asset operations
- tags
- collection membership
- provider runs
- project events

`graph.json` is a readable mirror and export format.

---

## 7. MCP And Codex Behavior

MCP remains inspect-first.

Core MCP tools for 2.0:

- project open/create
- graph inspect
- graph propose patch
- graph apply patch
- run preview
- run selected
- run branch
- job status
- cancel job
- list artifacts
- import asset
- route artifacts
- project health

Codex can:

- Create nodes
- Edit prompts
- Connect graph branches
- Build templates
- Analyze graph health
- Run assistant/evaluation jobs when explicitly asked
- Generate graph patch proposals from high-level creative goals
- Create production workflows such as style exploration, character consistency, product campaign variants, review funnels, and collection routing
- Explain the consequences of a run plan before execution
- Repair broken references, stale branches, and missing graph inputs when the user approves the patch

Codex cannot:

- Auto-run image generation after graph changes
- Hide provider identity
- Use API providers as hidden fallback
- Use browser/desktop automation routes

---

## 8. Codex Skillset 2.0

The bundled Codex plugin should ship multiple focused skills rather than one small generic skill.

Required skills:

- `ether-workflow`: inspect, create, edit, and explicitly run Ether graph workflows.
- `ether-graph-architect`: design advanced node pipelines, branch structures, and reusable templates.
- `ether-prompt-systems`: build layered prompts, prompt composition, mutation systems, negative prompts, and controlled randomization.
- `ether-review-router`: create Compare/Evaluate/Filter review funnels and collection routing systems.
- `ether-artifact-librarian`: organize generated assets, metadata, tags, collections, lineage, and exports.
- `ether-provider-safety`: explain provider modes, API-vs-CLI routing, data disclosure, and no-silent-fallback rules.
- `ether-recovery`: diagnose project health, stale revisions, failed jobs, missing files, and recovery options.

Skill rules:

- Inspect graph before edits.
- Preview patches before applying.
- Preview run plans before execution.
- Never run generation unless the user explicitly asks.
- Prefer branch proposals over destructive edits.
- Use collection routing dry-run before physical file moves.
- Treat provider identity and data disclosure as part of every run explanation.
- When designing complex workflows, include node purpose, edge role, run order, and expected artifacts.

---

## 9. Key Branched Decisions

These decisions should be confirmed before implementation starts.

### Decision 1: Canonical Persistence

Recommendation: SQLite becomes canonical for graph revisions, jobs, artifacts, and lineage. `graph.json` stays as a readable mirror.

Alternative: Keep `graph.json` canonical and use SQLite for metadata only.

Impact: SQLite-canonical is more work now, but it is the correct professional-grade route for recovery, jobs, and MCP/desktop parity.

### Decision 2: 2.0 Build Priority

Recommendation: Build durable foundation first, then shell/artifact browser.

Alternative: Build visible UX first and harden execution afterward.

Impact: Foundation-first prevents rework and data drift. UX-first feels better faster but risks building on unstable run semantics.

### Decision 3: Simulation Mode

Recommendation: Keep fake provider as explicit Simulation Mode, never as quiet fallback.

Alternative: Remove fake provider from packaged builds.

Impact: Simulation Mode is useful for offline workflow design and testing, but it must be unmistakably labeled.

### Decision 4: Nano Scope

Recommendation: Add Nano Banana Pro and Nano Banana 2 as provider capability slots only until a clean CLI/MCP route is proven.

Alternative: Delay all Nano UI until integration is real.

Impact: Capability slots make the architecture ready without pretending functionality exists.

### Decision 5: Public Launch Target

Recommendation: 2.0 should be public-grade in architecture and private-beta in distribution.

Alternative: Full public release package with signing, updater, license, privacy docs, and support material.

Impact: Private-beta target keeps momentum while still forcing professional reliability.

### Decision 6: Codex Authority

Recommendation: Codex may propose and apply graph edits after review, but image generation stays gated by explicit user run commands.

Alternative: Allow opt-in autorun for selected branches.

Impact: Explicit run gates best match the original full-control requirement. Autorun can remain a future advanced mode.

### Decision 7: Video Scope

Recommendation: Video references remain supported as reference artifacts only. Video generation is out of 2.0.

Alternative: Add video generation nodes in 2.0.

Impact: Keeping 2.0 image-first protects quality and avoids provider-route uncertainty.

### Decision 8: API Provider Infrastructure

Recommendation: Add API-provider infrastructure for generation and assistant nodes, but keep CLI Codex as default and prevent hidden API fallback.

Alternative: Keep API provider support entirely out of 2.0.

Impact: Adding infrastructure now makes future provider expansion cleaner, but it requires careful UI labeling, credential handling, and provider-policy tests.

---

## 10. Acceptance Criteria

Ether 2.0 is successful when:

1. A new user can create a project, add prompt/reference/generation nodes, connect them, and run one generation within five minutes.
2. The same workflow survives app restart with graph, assets, run history, and lineage intact.
3. Desktop and MCP runs use the same coordinator and produce the same durable project state.
4. The user can inspect a run plan before running.
5. The user can cancel, retry, and recover jobs.
6. Generated outputs appear in the artifact browser with metadata, lineage, and file location.
7. Compare, Evaluate, and Filter can review and route assets into collections with a visible audit trail.
8. Codex can propose a graph branch, show a diff, apply it after approval, and wait for explicit user execution.
9. Simulation Mode is clearly labeled and never confused with real provider execution.
10. API-backed providers are available only through explicit opt-in infrastructure and are never used as hidden fallback.
11. The bundled Codex plugin contains advanced Ether workflow skills and passes plugin validation.
12. The app passes unit, integration, smoke, migration, plugin, and packaged Windows acceptance tests.
