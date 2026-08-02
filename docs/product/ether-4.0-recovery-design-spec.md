# Ether 4.0 Authoring Recovery Design Specification

Status: Normative for the Ether 4.0 recovery program

Date: 2026-08-02

Supersedes: User-interface, workflow, evidence, and release-gate clauses in the original Ether 4.0 design and implementation documents where they conflict with this specification. The original architecture remains authoritative for the `.ether` document, graph kernel, providers, execution, security, and plugin contracts unless this document says otherwise.

## 1. Release Decision

The current Ether 4.0 build is a rejected release candidate. It must not be described as release-ready, merged to `main`, tagged, or published as a GitHub Release.

The recovery is not a cosmetic fix pass. It completes the authoring product around the working 4.0 foundation and reopens every unproven acceptance requirement.

The product is complete only when a person can begin with an empty document and create, edit, organize, connect, run, review, save, reopen, and export a useful workflow through the packaged application.

## 2. Product Promise

Ether is a Windows-first, local-first visual production environment for building intelligent image workflows. The canvas is the primary working surface. An ordinary user should be able to produce a first result without understanding graph internals, while an expert can inspect channels, roles, versions, providers, and execution details without leaving the document.

The minimum credible experience is:

1. Create or open one portable `.ether` document.
2. Find any of the 17 canonical node types from one searchable library.
3. Place and edit nodes directly on the canvas.
4. Connect nodes through six understandable channels and optional semantic roles.
5. Organize selections into locked modules.
6. Preview the exact run plan before provider work begins.
7. Run only the intended node, selection, branch, or batch.
8. Follow status and inspect outputs without losing canvas context.
9. Compare, evaluate, route, collect, and export accepted artifacts.
10. Save, close, reopen, and continue without losing graph or output state.

## 3. Baseline Truth

### 3.1 Implemented foundations to preserve

These capabilities exist in the 4.0 architecture and are not rewrite targets unless practical validation exposes a defect:

- proprietary single-file `.ether` documents;
- embedded artifacts and linked references;
- revisions, autosave, compaction, portability, and recovery infrastructure;
- a registry containing 17 canonical node definitions;
- six payload channels and 15 semantic connection roles;
- graph validation, connection consequences, adapters, and execution planning;
- Codex intelligence and image-provider adapters;
- Gemini image profiles and an explicit Antigravity fallback;
- provider capability discovery and global scheduling limits;
- durable jobs, artifacts, collections, and export services;
- recipe definitions and graph transactions;
- application-service, MCP, and Codex plugin boundaries;
- Windows packaging, IPC isolation, asset delivery, and protected credentials.

Presence in source code is not acceptance evidence. Every retained capability remains open until its required user journey passes.

### 3.2 Reproduced release blockers

- The installed Build tools expose only Prompt and Image although 17 node definitions exist.
- The generic canvas creation command supplies correct configuration only for a small subset of node types.
- A previous searchable node palette was removed without equivalent replacement.
- Blank-canvas authoring was not represented by the release screenshots or primary smoke test.
- Marquee selection, pointer ownership, and ordinary canvas drag behavior are unreliable.
- Graph keyboard commands are absent or delegated to generic text-edit menu roles.
- Primary node content cannot be edited directly on the canvas.
- Groups and modules are separate, incomplete concepts without a coherent ownership, locking, or editing model.
- The release acceptance file has 206 unverified requirements while historical release documents claim completion.

### 3.3 Known incomplete or underdeveloped surfaces

- searchable registry-driven node discovery;
- favorites, recent nodes, insertion previews, and keyboard creation;
- complete default configuration for all canonical nodes;
- predictable selection, multi-selection, clipboard, duplication, deletion, and undo/redo;
- module naming, accent color, lock, membership, conversion, navigation, and dissolution;
- concise inline editing paired with progressive Inspector controls;
- practical hover help and shortcut discovery;
- full recipe usability from an empty document;
- packaged-app evidence for daily creation workflows;
- accurate manual screenshots captured by performing the documented actions.

### 3.4 Unverified does not automatically mean absent

The 206 open acceptance items include working code that was never proven, incomplete work, and missing behavior. The recovery worker must classify each item before editing:

- `FAIL`: reproduced user-visible failure;
- `MISSING`: no usable implementation exists;
- `PRESENT-UNPROVEN`: implementation exists but lacks qualifying evidence;
- `VERIFIED-AUTO`: automated evidence passes;
- `VERIFIED-PACKAGED`: the installed application journey passes;
- `OWNER-ACCEPTED`: the product owner has manually accepted a release-critical journey.

No requirement may move directly from `PRESENT-UNPROVEN` to complete based only on code review.

## 4. Design Principles

### 4.1 Canvas first

Window growth primarily enlarges the canvas. Supporting panes are resizable, collapsible, persistent, and constrained so they cannot cover one another or reduce the canvas below a usable minimum.

### 4.2 One obvious action, progressive depth

Common commands are directly visible. Advanced configuration lives in deliberate Inspector sections, contextual menus, or a command palette. The default Inspector must not expose diagnostics, provider internals, routing metadata, and expert execution policy in one undifferentiated column.

### 4.3 Direct manipulation before form editing

The canvas supports ordinary selection, marquee selection, movement, connection, resizing, renaming, content editing, duplication, deletion, and organization. The Inspector supplements the canvas; it does not replace basic canvas interaction.

### 4.4 One source of truth

The node registry supplies library metadata, icons, descriptions, family, defaults, ports, Inspector schema, executor, and recipe metadata. Renderer code must not maintain a second partial node catalog.

### 4.5 Honest behavior

Every visible command performs a durable action or clearly explains why it is unavailable. Synthetic fixtures, mocked provider bridges, and source-level assertions cannot prove a user journey.

### 4.6 User evidence over test volume

Tests protect practical workflows. A smaller packaged-app test that creates and edits a graph is more valuable than many isolated checks that never operate the product.

## 5. Application Structure

### 5.1 Persistent chrome

- Top command bar: document identity, New, Open, Save, Save As, undo/redo status, Provider Health, Settings, Artifacts, and Command Palette.
- Workspace switcher: Build, Focus, Run, Review.
- Status line: save state, current operation, errors, and recovery action.

### 5.2 Build workspace

- Left: Node Library by default; Reference Desk is a selectable tab or secondary pane.
- Center: infinite canvas and contextual canvas toolbar.
- Right: Project Lens/Inspector.
- Bottom: collapsed Run Desk by default; expands for preview, jobs, logs, and results.
- Minimap: anchored immediately beside the Inspector boundary and moves when that pane is resized.

### 5.3 Empty document

An empty document shows a restrained canvas prompt with three actions:

- Add a node;
- Start from a recipe;
- Drop references.

It must not resemble a marketing screen or place instructions in decorative cards. The actions disappear after the first node is created and remain available through the Node Library and Command Palette.

## 6. Node Library

### 6.1 Canonical contents

The library exposes all 17 registered node types:

1. Prompt
2. Worker
3. Reference Set
4. Image Generator
5. Image Edit
6. Mask
7. Transform
8. Compare
9. Evaluate
10. Filter
11. Variables
12. Batch
13. Join
14. Collection
15. Export
16. Note
17. Drawing

### 6.2 Organization

The primary list is grouped by family: Prompt, Reference, Generation, Edit, Review, Flow, Output, and Canvas. Every item includes a family accent, icon, plain-language name, one-sentence purpose, accepted inputs, and produced outputs.

Search matches name, family, purpose, input, output, and common synonym. The list supports Favorites and Recent without hiding the full catalog.

### 6.3 Insertion

- Click inserts at the viewport center or last explicit insertion point.
- Drag inserts at the drop position with a visible placement preview.
- Double-clicking empty canvas or pressing `N` while the canvas owns focus opens the searchable quick-add palette at the pointer/focus position. `Tab` remains reserved for keyboard focus navigation.
- Keyboard selection and Enter insert without requiring a mouse.
- Node creation is one undoable graph transaction.
- Creation uses the registry's validated default config and presentation dimensions.
- If a provider-dependent default cannot be resolved, the node is created in an honest Needs setup state.

### 6.4 Help

Hover or keyboard focus shows purpose, typical use, channel compatibility, and an example. Help text must be specific, not generated from the title as "X node."

## 7. Canvas Interaction Model

One state machine owns pointer intent. Node cards, React Flow callbacks, capture handlers, and overlays may not independently mutate selection for the same event.

### 7.1 Pointer behavior

- Left click node: select it and clear unrelated selection.
- Ctrl/Shift + left click node: toggle it in the selection.
- Left click empty canvas: clear node and edge selection.
- Left drag empty canvas: draw a marquee and select intersecting nodes.
- Shift + left drag: add marquee results to the current selection.
- Right drag empty canvas: pan without opening a context menu.
- Middle drag or Space + left drag: alternate pan for conventional canvas users.
- Wheel: zoom around pointer; Ctrl+wheel follows the chosen Windows convention consistently.
- Drag selected node: move the complete selection once, preserving relative positions.
- Alt + drag selection: duplicate and move as one transaction.
- Escape: cancel current connection, edit, drag, or marquee; otherwise clear selection.

### 7.2 Keyboard command map

- `Delete` or `Backspace`: delete selected graph objects.
- `Ctrl+D`: duplicate selection with a visible offset.
- `Ctrl+C`, `Ctrl+X`, `Ctrl+V`: graph-aware clipboard when canvas owns focus; ordinary text behavior when an editor owns focus.
- `Ctrl+A`: select all objects in the current graph when canvas owns focus.
- `Ctrl+Z`, `Ctrl+Y`, `Ctrl+Shift+Z`: graph undo/redo.
- `Ctrl+G`: create a module from the selection.
- `Ctrl+Shift+G`: dissolve the selected module after impact preview.
- `F2`: rename the primary selected node or module.
- `Enter`: edit the primary content of the selected editable node.
- `Ctrl+Enter`: preview/run selected according to the current execution policy.
- `Ctrl+K`: open Command Palette.
- `Home`: fit current graph or selected module.

All commands appear in menus with shortcuts and disabled-state explanations. Destructive commands confirm only when downstream or external impact warrants confirmation.

### 7.3 Undo model

Create, delete, move, resize, rename, inline content edit, config edit, connect, disconnect, role change, selector change, module creation, module dissolution, module membership, and plugin graph transactions are undoable. Text typing may coalesce into sensible editing units.

## 8. Node Cards And Direct Editing

### 8.1 Stable anatomy

Each node includes family/subtype, editable title, primary content or useful preview, runtime status, connected channel rails, and a compact contextual command affordance. Default dimensions prevent channel-dot overlap.

Families use distinct DreamBay-compatible accents while preserving neutral surfaces and readable contrast. Color never carries channel or status meaning alone.

### 8.2 Direct editing

- Titles edit by double-click, `F2`, or Inspector.
- Prompt body, Worker instruction, Note body, and relevant text fields edit directly on the card.
- Entering edit mode suppresses canvas shortcuts and movement until commit/cancel.
- Text areas grow within a bounded card and expose an explicit expand editor action.
- Manual edits create output/config provenance and never silently destroy generated versions.
- Key node-specific controls may appear inline only when they are frequent and compact; full configuration remains in Inspector.

### 8.3 Status

Nodes display queued, compiling, waiting, running, cancellation pending, failed, blocked, and done states. Running remains visible for the full operation. Done remains visible for ten seconds before returning to the quiet status. Failure remains until dismissed or superseded and links to its recovery action.

## 9. Modules: The Only Organizational Container

The separate Visual Group concept is retired from the user interface. Module is the single container model for spatial organization and reusable workflow encapsulation.

### 9.1 Creation and locking

- Create Module wraps the current selection and preserves node positions and external connections.
- A new module is locked by default.
- Locked means members cannot be selected, moved, resized, edited, connected, or deleted from the parent canvas.
- Double-click or Enter Module explicitly opens its internal graph for editing.
- Leaving a module restores parent viewport and selection.

### 9.2 Module controls

Modules support rename, DreamBay accent/highlight color, description, lock/unlock, collapse/expand, add/remove membership, expose/hide parameters, and dissolve. These commands appear in a coherent context menu and Inspector.

Collapsed modules expose declared channel ports and preserve execution semantics. Expanded parent-view modules remain locked containers, not loose visual rectangles.

### 9.3 Existing group records

Existing 4.0 visual groups are converted in one undoable document transaction to locked modules when practical. If conversion cannot preserve semantics, Ether opens the document without modifying it and presents an explicit repair preview. No silent deletion is allowed.

## 10. Channels, Roles, And Connections

### 10.1 Channels

The six channels remain Text, Image, Mask, Data, Video, and Audio. Only connected channel dots are visible at rest. Compatible dots appear on node-edge hover, keyboard focus, or connection drag.

Dots are evenly distributed according to node dimensions, remain targetable at Windows scaling levels, and use both color and shape. Multiple lanes may share one channel dot. Multiple different channel/role/selector lanes may connect the same node pair; exact duplicates are rejected with an explanation.

### 10.2 Connection interaction

- Drag from an output channel to a compatible input channel.
- Compatible targets highlight; incompatible targets explain why before drop.
- Right-clicking a lane or connected dot removes only the intended lane.
- Selecting a lane exposes role, selector, consequence, adapter, and delete controls.
- Non-General role badges remain visible on the lane; General remains quiet.
- Clicking a role badge opens the 15-role grid in place.
- Role changes are immediate, undoable, and reflected in both endpoint Inspectors.

### 10.3 Semantic consequences

Role applies to the receiving interpretation, not the identity of the source node. Repeated direct same-role lanes create numbered sections. A serial lineage of Prompt/Worker nodes remains one semantic item unless the receiving node has multiple direct lanes.

Adapters such as image-to-text, audio-to-text, video-to-text, and video-to-image are visible in Run Preview and execution status. Unsupported conversions are blocked before provider work.

## 11. Inspector And Progressive Disclosure

The Inspector shows the selected object's ordinary task controls first:

1. identity and lock state;
2. primary content/configuration;
3. connected inputs and outputs with roles;
4. concise run controls where the node is executable;
5. latest output/review state.

Advanced sections contain execution policy, selectors, provenance, diagnostics, raw metadata, and provider-specific controls. Sections start collapsed unless required for setup or error recovery.

Controls wrap into intentional rows and never overlap scrollbars. Long paths and values wrap or truncate with a full tooltip. The pane preserves width and section state per workspace.

The Inspector is schema-driven where practical but permits purpose-built editors for complex node types. Schema-driven must not mean one generic form for every workflow.

## 12. Node Behavior Completion

Every canonical node requires a real vertical slice: library entry, validated default, card preview, direct edit where relevant, Inspector, channel contract, execution or explicit non-runnable behavior, persistence, undo, error states, help, and practical tests.

- Prompt: authored text and deterministic assembly; no misleading provider Run.
- Worker: Codex model/reasoning selection, inspect-first and auto-apply, downstream awareness, versioned outputs, transformation discipline.
- Reference Set: multi-file grid, link/embed state, Add/Replace, ordering, enable/disable, drag/drop.
- Image Generator: provider capability controls, references, batch count, preview, real artifact output.
- Image Edit: source, mask, instruction, provider capability, edit preview, real output.
- Mask: drawing/selection workflow with visible raster/geometry provenance.
- Transform: deterministic resize/crop/format operations with preview.
- Compare: human review without hidden LLM use.
- Evaluate: Codex vision/text evaluation with displayed rubric and structured Data.
- Filter: deterministic rule routing with per-item explanation.
- Variables: named values, types, preview, validation, and interpolation.
- Batch: dimensions, exclusions, count, sequential default, selectable concurrency.
- Join: explicit ordering/completeness strategy and lineage preservation.
- Collection: non-destructive many-to-many membership and artifact browsing.
- Export: granted destination, naming, format, hierarchy, collision, sidecar, progress.
- Note: resizable canvas annotation with note/cloud/bubble presentations.
- Drawing: actual free drawing, selection, erase, undo, and image/mask output.

## 13. Run Experience

Authored, deterministic nodes use Assemble/Preview language. Executable nodes use Preview Run and Run. The default action is inspect-first.

Run Preview must show:

- exact nodes and graph boundary;
- compiled prompts and role sections;
- input versions and selected artifacts;
- adapters and transformations;
- provider/model/profile and capability-derived settings;
- work-item count, concurrency, and estimated provider calls;
- warnings, blocked items, and manual approvals.

Run scopes are explicit: Node, Selected, Downstream, Branch, or Batch. Running one node never writes into another node's instruction/configuration. Outputs travel as versioned payloads along lanes. A run cannot begin from an ambiguous selection.

## 14. References, Batches, Review, And Artifacts

Large image sets remain understandable through stable thumbnails, virtualization, multi-selection, inclusion state, role overrides, and visible lineage. A Reference Set node shows all members in a bounded grid rather than replacing the visible preview.

Artifact Observatory provides Grid, Filmstrip, Lineage, and Collections views from real document artifacts. Empty search means unfiltered. Review selections and routing decisions are durable and reversible. Export always preserves embedded originals.

The Run Desk and Artifact Observatory must be usable while the canvas remains visible. Panels may expand, but they cannot unexpectedly replace or obscure the user's working context.

## 15. Recipes

Recipes are executable starting points, not demonstrations. Each recipe provides:

- a plain-language outcome;
- required inputs and provider capabilities;
- expected node/module structure;
- expected call range and batch size;
- a setup sheet containing only unresolved decisions;
- one undoable insertion transaction;
- immediately legible layout and naming;
- supported substitutions or an honest block.

Recipe acceptance begins from a new document and completes through its advertised output. A pre-seeded fixture cannot satisfy recipe acceptance.

## 16. Codex Plugin And MCP

The plugin remains Ether's co-producer. Inspect, Edit Permit, and Run Permit remain separate. It must be able to create and repair every canonical node and connection supported by the UI through registry-backed operations.

Plugin-created graphs must open as ordinary editable Ether graphs. The plugin may prepare complete workflows, but provider execution requires the explicit run permission and plan binding already defined by the 4.0 architecture.

Plugin skills and examples must teach the recovered UI mental model: 17 canonical nodes, six channels, 15 roles, locked modules, inspect-first execution, and one `.ether` document.

## 17. Visual, Responsive, And Accessibility Requirements

The DreamBay/Ether visual system remains authoritative. Interfaces use neutral depth, Electric Blue, cyan/aqua signal, restrained violet accents, and family differentiation rather than one-note gradients.

- Pane sizes and visibility persist.
- The canvas keeps a usable minimum at 1280x720.
- Controls remain legible at 100%, 125%, 150%, and 200% Windows scaling.
- Text never collides with scrollbars, ports, buttons, or status overlays.
- Focus is visible and logical.
- Primary authoring and run workflows are keyboard reachable.
- Reduced motion disables non-essential interpolation and pulsing.
- Dynamic statuses and errors are announced without repeatedly stealing focus.
- Tooltips are concise and also reachable through keyboard focus.

## 18. Performance Requirements

Interaction performance is a release feature:

- pointer response begins in the same frame under ordinary graph sizes;
- marquee and selected-group movement remain smooth at 1,000 nodes;
- opening palettes and inline editors does not re-render the entire graph;
- autosave does not interrupt canvas manipulation;
- thumbnails are virtualized and decoded on demand;
- provider compilation and queue timings are separately observable.

Performance fixtures may use generated data. Primary usability evidence may not.

## 19. Evidence And Release Rules

### 19.1 Required evidence classes

- `A`: focused automated contract/component/integration evidence;
- `P`: packaged application journey using real mouse/keyboard or Windows accessibility input;
- `M`: manual product-owner acceptance.

Every requirement declares its needed classes in the recovery ledger. UI and workflow requirements always require `P`; release-critical daily journeys require `P+M`.

### 19.2 Primary journeys that block release

1. Blank document to first generated image.
2. Create and inspect all 17 node types from the library.
3. Directly edit, duplicate, copy/paste, delete, undo, and redo nodes.
4. Marquee-select, move, and organize a workflow into a locked module.
5. Create, change, and remove multi-channel/multi-role connections.
6. Prompt to Worker to Image with inspect-first approval and correct lineage.
7. Multi-reference batch generation with visible job progress.
8. Compare, evaluate, filter, collect, and export.
9. Save, close, reopen, recover, and continue.
10. Plugin creates a tailored graph, user inspects it, and execution remains separately permitted.

### 19.3 Prohibited substitutions

- A pre-populated fixture cannot prove node creation.
- A mocked renderer cannot prove Electron IPC or installed behavior.
- A screenshot cannot prove an interaction unless its action log begins from the required state.
- Test counts cannot replace acceptance coverage.
- A task checkbox cannot close a product requirement.
- A reviewer may not inherit a prior green gate without checking its evidence record.

### 19.4 Stop-the-line conditions

The recovery stops and reports rather than claiming success when:

- a primary journey cannot be completed;
- the acceptance ledger contains an open release-blocking item;
- a visible control is fake, disconnected, or misleading;
- an installed-app result differs materially from the mocked renderer;
- a document or artifact can be silently lost;
- provider ambiguity could repeat paid or quota-consuming work;
- the manual describes UI that was not captured from the release candidate.

## 20. Definition Of Done

Ether 4.0 recovery is complete only when:

- all 220 original acceptance requirements have a status and evidence record;
- all 206 previously open requirements are either verified or explicitly removed by product-owner-approved scope change;
- every primary journey passes in the packaged application;
- no synthetic fixture is used to prove daily authoring;
- the product owner completes the manual acceptance route;
- the manual is regenerated from the accepted build;
- final reviewers independently use the application before reading test totals;
- the original review task, not the fixer task, makes the release decision.
