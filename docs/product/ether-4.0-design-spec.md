# Ether 4.0 Product And Design Specification

**Status:** Planning baseline for approval
**Date:** 2026-07-16
**Product:** Ether by DreamBay
**Platform:** Windows desktop, local-first
**Supersedes:** Ether 2.0, 2.1, and 2.5 product and graph designs
**Companion documents:** `ether-4.0-technical-spec.md`, `ether-4.0-acceptance.md`

---

## 1. Executive Summary

Ether 4.0 is a professional local creative-production environment for constructing, inspecting, executing, and reviewing multimodal AI workflows on an infinite node canvas. It combines intelligent Codex-powered LLM workers, subscription-backed image generation through Codex and Antigravity CLIs, strong reference handling, durable batch execution, and artifact review in one Windows application.

The 4.0 release is a clean break. A project is no longer a Windows directory pretending to be an `.ether` file. It is one genuine, portable `.ether` document containing its graphs, history, generated media, recipes, runs, collections, and review state. Ether 4.0 does not open or migrate legacy Ether project folders.

The product must satisfy two audiences without becoming two applications:

- A creative user can assemble or request a workflow, understand its major steps, change the obvious controls, and generate without learning execution internals.
- An expert can inspect channels, roles, adapters, provider capabilities, context compilation, batches, model settings, lineage, and graph transactions when those details matter.

Complexity is disclosed progressively. The canvas communicates the workflow. The Inspector presents ordinary decisions first. Advanced controls live in deliberate sections, not in the primary path.

---

## 2. Product Promise

Ether turns an artistic intention into a visible, editable production system.

A successful workflow should support this loop:

1. State the creative goal or ask the Codex plugin to construct a suitable graph.
2. Inspect the prompts, workers, references, generation models, and review stages.
3. Adjust only the controls that matter for this run.
4. Preview the exact run scope, provider calls, adapters, and expected work count.
5. Execute with visible progress and reliable cancellation.
6. Compare, evaluate, filter, organize, and export the results.
7. Revise one branch without rebuilding the whole workflow.

Ether is not a generic chatbot, a folder organizer with nodes, or a thin wrapper around one image model. Its core product is the graph-based creative loop and the durable relationship between intent, references, transformations, generations, decisions, and artifacts.

---

## 3. Non-Negotiable Principles

### 3.1 Real Behavior

- Every enabled control performs a real action.
- Every allowed connection produces a defined backend consequence.
- Provider availability is discovered and shown honestly.
- Missing provider capabilities disable operations with a reason.
- No simulated success, hidden paid API fallback, or decorative placeholder integration is allowed.

### 3.2 Local-First Ownership

- The authoritative project is a user-owned `.ether` document.
- Generated artifacts are embedded automatically.
- Imported references can be linked or embedded.
- Provider staging, caches, and recovery data live in Ether-owned AppData locations.
- Removing caches or optional output mirrors never damages a project.

### 3.3 Inspect Before Spend Or Run

- Authored Prompt nodes do not run.
- LLM Worker nodes expose **Generate Output**.
- Generation and Edit nodes expose **Generate** or **Apply Edit**.
- A branch or selection exposes **Preview Run** before **Run**.
- Graph editing permission and provider execution permission remain separate.

### 3.4 One Visible Mental Model

The canvas uses three concepts:

1. **Node:** what happens.
2. **Channel:** what moves.
3. **Role:** how the receiver interprets it.

Nothing else may masquerade as a channel or role.

### 3.5 Progressive Disclosure

- The default inspector is concise and task-oriented.
- Expert settings are grouped by purpose and collapsed initially.
- Provider-specific controls appear only for the selected provider/model.
- Run diagnostics live in Job Center and Run Detail, not permanently inside every inspector.

---

## 4. Supported Users And Core Jobs

### 4.1 Creative Director

Builds or commissions reusable workflows, defines visual direction, compares variants, and approves outputs. Needs rapid overview, coherent references, and strong review tools.

### 4.2 Prompt And Workflow Designer

Creates intelligent prompt chains, reusable modules, variables, batch dimensions, and model-specific instructions. Needs precise roles, output versions, context inspection, and deterministic routing.

### 4.3 High-Volume Image Producer

Runs large reference sets and batches, tracks failures, retries selected items, and exports organized deliveries. Needs predictable queueing, virtualized artifact views, and resumable execution.

### 4.4 Occasional User

Starts from a recipe or asks the Codex plugin to create a graph. Needs a readable canvas, obvious launch controls, safe defaults, contextual help, and little exposure to infrastructure.

---

## 5. Ether Document Experience

### 5.1 File Model

An Ether project is one file:

```text
Campaign.ether
```

The document contains graphs, revisions, recipes, runs, generated artifacts, embedded references, collections, reviews, and document settings. A cleanly closed project has no required adjacent directory.

Legacy directory projects are unsupported. Ether 4.0 removes their application code, fixtures, migration screens, and misleading folder terminology.

### 5.2 New, Open, Save

- **New** opens an untitled blank document immediately.
- **Open** uses the Windows file picker and accepts only supported `.ether` documents by default.
- `.ether` files open through Explorer double-click, drag-and-drop, Recent Documents, and Windows Jump Lists.
- **Save** on an untitled document opens the Windows Save dialog.
- **Save** on a named document flushes pending edits and creates a manual milestone.
- **Save As** creates, validates, and switches to a new document identity.
- **Save a Copy** creates a validated copy without switching the active document.
- **Compact Document** reclaims abandoned embedded-object pages and reports reclaimed space.

### 5.3 Autosave And Recovery

- Autosave starts after 1.5 seconds of idle time and never defers dirty work longer than ten seconds.
- The title bar shows `Saving`, `Saved`, or `Needs attention`.
- The app closes silently only when the document is durable or intentionally read-only.
- Uncommitted recovery operations and interrupted provider imports are journaled in AppData.
- Recovery opens as a reviewable revision; it is never merged invisibly.
- Corrupt documents open in a read-only recovery workspace when possible.

### 5.4 References

- Dropped image, video, audio, and supported text files become linked references by default.
- A brief action offers **Embed instead**.
- Dropping onto an existing Reference Set adds assets to that set.
- Linked references retain file identity, path, timestamps, size, fingerprint, and an embedded preview.
- Missing references stay visible and offer **Locate**, **Search Folder**, **Relink All**, **Use Embedded Preview**, **Embed Available Copy**, or **Remove**.
- **Make Document Portable** embeds all available linked references after showing the expected size increase.

### 5.5 Collections And External Files

Collections are logical, queryable groups inside the `.ether` document. Routing changes collection membership without moving the authoritative embedded artifact.

External materialization is explicit:

- **Export Selected** writes chosen artifacts to a normal folder.
- **Bulk Export** supports collection structure, naming templates, formats, metadata sidecars, lineage reports, and overwrite rules.
- A document may enable an optional **Live Output Folder** mirror.
- Live Output Folder is disabled by default.
- When enabled, collection routing moves or copies the disposable mirrored file according to the document policy.
- Deleting the mirror never removes the embedded artifact; Ether can rebuild it.

---

## 6. Application Structure

Ether has four adaptive workspaces rather than one permanently overloaded screen.

### 6.1 Build

Default graph-authoring workspace:

- Node Library on the left
- Infinite canvas in the center
- Contextual Inspector on the right
- Compact document and graph command bar above
- Collapsed Job Center strip below

The canvas receives the majority of resized window space. Top and bottom command regions remain bounded and user-resizable within sensible limits.

### 6.2 Focus

Distraction-reduced editing workspace:

- Canvas and selected node or module
- Optional Reference Desk
- Inspector hidden or narrow
- No persistent run history unless a job needs attention

### 6.3 Run

Execution workspace:

- Selected run plan and scope
- Job Center with queued, active, completed, blocked, and failed work
- Batch Matrix for dimensions and work-item status
- Live output strip without interrupting canvas manipulation

### 6.4 Review

Artifact decision workspace:

- Artifact Observatory with virtualized grid or filmstrip
- Compare Stage for synchronized inspection
- Evaluation criteria and filter explanations
- Ratings, tags, collection routing, lineage, and export

### 6.5 Layout Behavior

- Left, right, top, and bottom panes are independently hideable and resizable.
- Each pane has its own visible collapse control.
- Pane sizes persist per workspace and document.
- Minimap sits next to the Inspector and moves with it; it is never covered by a pane.
- The canvas safe viewport excludes visible panes and the minimap.
- Narrow windows replace secondary labels with icons and tooltips before compressing text vertically.
- Buttons never collapse into one-letter columns.

---

## 7. Node System

### 7.1 Families

| Family | Canonical nodes | Purpose |
|---|---|---|
| Prompt | Prompt, LLM Worker | Author or intelligently transform direction |
| Reference | Reference Set | Hold mixed creative source material |
| Generation | Image Generator | Produce images through a selected provider |
| Edit | Image Edit, Mask, Image Transform | Revise or transform image material |
| Review | Compare, Evaluate, Filter | Make human, AI, or deterministic decisions |
| Flow | Variables, Batch, Join | Control parameters and work-item pools |
| Output | Collection, Export | Organize internally or write externally |
| Canvas | Note, Drawing | Annotate and draw without pretending to execute |

Each family has a stable DreamBay-derived border color. Operational state uses a separate status layer and never changes the family identity.

### 7.2 Presets Versus Node Types

The following are LLM Worker presets: Brainstorm, Rewrite, Mutate, Expand, Reinforce, Extract, Critique, and Custom. They share one execution contract and differ through validated configuration.

The following are Reference Set views: Image Set, Moodboard, Colour Palette, Video Set, Audio Set, and Mixed Set.

The following are recipes: Character Sheet, Product Shoot, Infographic, Contact Sheet, Reference Variations, Draft-to-Final, Evaluate-and-Route, and other multi-node workflows.

Cloud and Bubble are Note presentation styles. Free Draw is a real Drawing node, not a Note label.

### 7.3 Node Card

Every node card shows:

- Family and subtype
- Editable title
- Concise primary content or output preview
- Connected channel dots only at rest
- Status layer when queued, running, blocked, failed, or recently completed
- Selection and validation state
- Compact primary action only when that action is meaningful on the canvas

Prompt cards show their text excerpt. LLM Worker cards distinguish instruction from latest output. Reference Sets show a virtualized thumbnail or media grid. Generation and Edit cards show current settings and latest artifact preview. Review cards summarize criteria and decision counts.

### 7.4 Node Status

- `Queued` appears while waiting.
- `Running` appears with progress or an indeterminate activity indicator.
- `Done` remains visible for ten seconds after successful completion.
- `Needs attention` remains until resolved.
- Status is runtime state, not persisted node configuration.

### 7.5 Modules And Groups

- A **Group** is visual organization and selection behavior only.
- A **Module** is a collapsible subgraph with declared channel inputs, outputs, parameters, and an internal graph.
- Recipes may instantiate modules.
- Users can enter a module, expose or hide parameters, and return to the parent graph.
- Plugin-generated complex workflows use modules to keep the top-level canvas legible.

---

## 8. Channels, Roles, And Connections

### 8.1 Channels

Ether exposes exactly six payload channels:

- Text
- Image
- Mask
- Data
- Video
- Audio

Channel dots use distinct color and shape, not color alone. At rest, only connected channels appear. Empty channel zones appear when the node edge is hovered, keyboard-focused, or involved in a connection drag.

### 8.2 Roles

Ether exposes exactly 15 interpretation roles:

1. General
2. Negative
3. Subject
4. Product
5. Face
6. Clothing
7. Pose
8. Setting
9. Composition
10. Style
11. Lighting
12. Colour Palette
13. Typography
14. Motion
15. Timing

General is the default. Non-General roles remain visible on the lane. Clicking the role badge opens a 5-by-3 grid. The selected edge and sending node Inspector show the role clearly.

### 8.3 Connection Rules

- A source must produce its chosen source channel.
- A target must accept its chosen target channel.
- Same-channel payloads pass directly.
- Cross-channel payloads require an available, inspectable adapter.
- The target must define a concrete consequence for the selected role.
- Exact duplicate lanes are rejected.
- Different channels, roles, or output selectors between the same two nodes are allowed.

### 8.4 Interaction

- Left-drag from a channel zone creates a connection.
- Compatible target zones are emphasized; invalid zones explain why they are unavailable.
- Right-clicking a lane or endpoint deletes only that connection.
- Right-dragging an endpoint moves it to another compatible channel.
- Clicking empty canvas clears node and edge selection.
- Left-dragging empty canvas creates a selection marquee.
- Right-dragging empty canvas pans the canvas.
- Selected nodes move together and expose **Preview Selected** and **Run Selected**.

### 8.5 Output Selection

Every executable node produces immutable output versions. An edge may consume:

- Latest approved output
- Latest output
- All output variants
- One pinned output version

An upstream worker never overwrites a downstream node instruction. A chain of prompt transformations is one lineage unless multiple direct incoming lanes intentionally create multiple values for the same role.

---

## 9. Prompt And LLM Intelligence

### 9.1 Prompt Node

Prompt is authored text and deterministic assembly. It has no provider execution button. Incoming Text and Data may be assembled by role and order. Its body and assembled preview remain editable with visible manual-override provenance.

### 9.2 LLM Worker

The LLM Worker is a first-class intelligent production node powered by Codex. Its ordinary Inspector exposes:

- Instruction
- Behavior preset
- AI Profile: Fast, Balanced, Deep, or Custom
- Variation: Faithful through Exploratory
- Output: text, structured data, or variants
- Generate Output

Advanced sections expose:

- Exact Codex model and reasoning effort
- Upstream context inclusion policy
- Downstream model awareness
- Stateless, per-node, or per-branch memory
- Structured-output schema
- Output count and selection policy
- Retry, timeout, and failure behavior
- Tools and media interpretation capabilities
- Compiled context and provenance

### 9.3 Context Compiler

The compiler runs in the background and is deterministic. It:

- Resolves selected output versions.
- Preserves edge roles and lane order.
- Distinguishes node instruction from upstream content.
- Includes relevant downstream provider/model constraints when enabled.
- Packages image, audio, and video inputs only when the chosen Codex model accepts them.
- Requests concise transformed content rather than conversational narration.
- Validates structured output before accepting it.
- Produces an inspectable context manifest without cluttering the ordinary UI.

### 9.4 Output Discipline

Rewrite and mutation workers receive an explicit transformation contract: output the resulting content, not an explanation of the change. For example, changing a watermelon to a pineapple yields the revised prompt containing `pineapple`, never `instead of a watermelon` unless contrast is explicitly requested.

Every worker run creates an immutable output version. Users may approve, reject, edit, compare, pin, or restore versions.

---

## 10. Image Providers

### 10.1 Codex Image

Codex is the default image-generation route. Ether uses the installed Codex runtime and the user’s existing authenticated subscription path. The integration must:

- Discover current models and capabilities.
- Use structured app-server events where available.
- Reuse warm runtime sessions.
- Avoid unnecessary startup and prompt-compilation work.
- Stage outputs in an isolated directory, validate them, then import them into the document.
- Support cancellation and bounded retries.

Ether does not infer image capabilities from the ordinary Codex model list. Before enabling the provider for a Codex version, a version-pinned conformance fixture must prove the exact image-generation instruction/tool contract, output-file discovery, supported dimensions, reference handling, cancellation behavior, and import path. A failed conformance probe leaves the affected control unavailable rather than guessing.

### 10.2 Antigravity Image

Antigravity CLI provides these user-facing profiles:

- Nano Banana 2
- Nano Banana Pro
- Nano Banana 2 Lite

Ether requests the profile explicitly, records the request, probes actual output behavior, and never claims an unverified provider-reported model identity. Nano Banana 2 is the minimum acceptable launch integration. Nano Banana 2, Pro, and Lite passed the 4.0 release conformance; Lite is enabled only with its verified 1K constraint. A changed CLI version or executable hash invalidates that evidence and disables affected profiles until a new probe passes.

The 4.0 release automation was verified with Antigravity CLI 1.1.7 and a recorded executable SHA-256, using the machine's persisted Antigravity session through noninteractive `--print`, explicit `--model`, workspace `--add-dir`, and bounded `--print-timeout`. Ether must not open an authentication window during an ordinary generation. Image-profile choice is an Ether-owned instruction contract until the CLI reports a distinct image-model identifier. Every detected CLI version and executable hash requires its own recorded conformance scenario covering exit state, output discovery, dimensions, staging containment, and failure behavior before a profile is enabled.

The Antigravity CLI 1.1.7 `generate_image` tool structurally exposes aspect ratio but no resolution or image-size parameter. Direct 2K and 4K probes on Nano Banana 2 and Pro returned the corresponding 1K dimensions. Ether therefore exposes the verified 1K pixel size for each conformed ratio on all three profiles and does not present decorative 2K/4K choices. A future CLI may enable additional sizes only after its tool schema and real outputs pass conformance. Nano Banana 2 Lite remains constrained to its verified 1K capability.

### 10.3 Capability-Driven Controls

- Model, aspect ratio, resolution, reference count, output count, and edit support come from the selected provider capability profile.
- Unsupported values are disabled with explanations.
- Switching providers preserves compatible settings and identifies changed settings before execution.
- Run Preview shows the provider, requested profile, dimensions, references, work count, and known limitations.

---

## 11. References And Large Batches

### 11.1 Reference Desk

Reference Desk is an optional workspace surface for organizing many inputs without expanding every node. It supports:

- Dragging files or embedded artifacts into sets
- Grid, filmstrip, waveform, and compact list views
- Per-asset role overrides
- Include/exclude selection
- Missing-link and embed state
- Quick comparison and deduplication
- Sending selected assets to a Reference Set or Batch dimension

### 11.2 Reference Set

A Reference Set may contain one or many media assets. It supports add versus replace, mixed-media validation, manual ordering, per-asset metadata, and channel-specific previews. Connecting the set emits only channels that are present and enabled.

### 11.3 Batch Matrix

Batch is explicit rather than inferred from duplicated nodes. Dimensions may include:

- Prompt variant
- Reference set or individual reference
- Provider/model
- Aspect ratio and resolution
- Seed when supported
- Repetition count
- Variables

The matrix separates three decisions:

- **Full batch** previews the Cartesian work count and permits explicit exclusions.
- **Provider and model allocation** assigns exact, stable item counts to verified provider/profile/model lanes for reachable Prompt Workers and Image Generators. Unassigned items retain the node default.
- **Concurrent run** controls throughput independently from batch size. Sequential is the default. One application-wide domain caps active provider work at 8, with 4 shared across every Codex route and 4 shared across every Antigravity route; a fifth same-family call and ninth global call wait. Unknown providers fail closed at 1. A Codex or Antigravity route that cannot support its four-call family contract is unavailable rather than exposed as a serial fallback.
- The capacity domain is shared by every job, batch, and document scheduler owned by the running application. Opening another batch never creates a second allowance, and large batches claim work only through the bounded scheduler.

Each work item carries its dimension names and values into the effective provider prompt. Excessive expansion is visibly capped rather than allowed to exhaust the application or system.

### 11.4 Durable Jobs

- Jobs survive application restart.
- Cancellation stops queued work and asks active providers to stop.
- Retry may target failed items only.
- Accepted provider outputs are hash-deduplicated.
- A resumed batch never silently duplicates accepted artifacts.
- Cancellation, retry, and interrupted-work recovery release or reacquire the same application-wide capacity permits without duplicating accepted output.
- Job Center separates queued, active, done, and attention-required items.

---

## 12. Review, Routing, And Artifacts

### 12.1 Artifact Observatory

The Artifact Observatory provides virtualized Grid, Filmstrip, Lineage, and Collection views. Search accepts an empty query and can filter by type, collection, tags, rating, provider, model, run, graph branch, and creation time.

### 12.2 Compare

Compare is a human checkpoint. It accepts media or text candidates, displays synchronized views, records selections and notes, and emits the selected payloads plus decision data. It does not call Codex unless the user explicitly adds or enables AI evaluation.

### 12.3 Evaluate

Evaluate uses Codex multimodal reasoning against a user instruction and optional structured rubric. It emits Data and Text, preserves media passthrough, and records criteria, scores, explanations, and model provenance.

### 12.4 Filter

Filter is deterministic routing over Data and associated media. Rules are visible, ordered, testable, and explain why an item entered a route. Optional LLM-produced metadata must be created upstream by Evaluate or an LLM Worker; Filter itself does not make hidden model calls.

### 12.5 Collections

Collection membership is internal, non-destructive, and many-to-many. A primary collection may be designated for display and optional Live Output mirroring. Collection routing preserves lineage, ratings, tags, and evaluation data.

---

## 13. Recipes

Recipes are executable, versioned workflow blueprints, not gallery cards with vague descriptions. Every recipe contains:

- Purpose and expected result
- Typed graph or module blueprint
- User parameters and safe defaults
- Required provider capabilities
- Supported provider substitutions
- Reference requirements
- Expected call and work-item counts
- Review checkpoints
- Layout rules
- Fake-provider acceptance scenario
- Version and compatibility metadata

The initial recipe library contains:

1. Prompt to Image
2. Reference-Guided Image
3. Moodboard to Variations
4. Draft with Lite, Finish with Pro
5. Character Consistency Sheet
6. Product Campaign Set
7. Infographic Builder
8. Image Edit with Mask
9. Reference Description to Prompt
10. Batch Variations and Contact Sheet
11. Evaluate and Route
12. Curate, Collect, and Export

Inserting a recipe opens a compact setup sheet, validates providers, creates the graph or module atomically, and focuses the next required input.

---

## 14. Codex Plugin

The Ether Codex plugin is the external co-producer. It does not become a large in-app chat surface.

### 14.1 Capabilities

The plugin can:

- Inspect document, graph, catalog, provider, artifact, and run state
- Construct tailored graphs from natural-language goals
- Configure prompts, LLM Workers, references, batches, and review stages
- Instantiate and adapt recipes
- Create modules and expose parameters
- Validate capabilities and explain blocked paths
- Preview graph changes
- Apply a complete change as one undoable transaction
- Inspect the result and repair its own layout or configuration
- Prepare a run plan without launching it
- Execute only under a separate explicit Run Permit

### 14.2 Permission Model

- **Inspect:** default, read-only.
- **Edit Permit:** allows reversible graph transactions during an active co-production loop.
- **Run Permit:** one-time approval for a specific immutable run plan.

### 14.3 Skill Suite

Primary skills:

- `ether-director`
- `ether-graph-architect`
- `ether-intelligence-director`
- `ether-reference-curator`
- `ether-run-operator`
- `ether-recipe-studio`
- `ether-review-director`
- `ether-artifact-librarian`
- `ether-project-doctor`

Existing 2.5 skill names become compatibility aliases only where necessary for plugin discovery; their instructions must point to the 4.0 grammar and must not teach legacy project folders or node families.

---

## 15. Interaction And Visual Direction

Ether follows the supplied Ether and DreamBay identity handbooks and the repo-local visual-system rules.

### 15.1 Visual Hierarchy

- The graph and current creative material dominate the viewport.
- Tool surfaces are compact, quiet, and operational.
- Electric Blue is the primary Ether signal, not the entire palette.
- Aqua, cyan, violet, amber, rose, and neutral tones encode channels, families, and state.
- DreamBay gradients are reserved for brand identity and meaningful transition states.
- Cards use tight radii and are not nested as page sections.

### 15.2 Fluid Interaction

- Hover reveals connection zones and contextual actions only where relevant.
- Selecting a node changes Inspector content without shifting the canvas.
- Starting a connection emphasizes valid targets.
- Starting a run transitions the bottom strip into Job Center without resizing the graph unexpectedly.
- Selecting many artifacts opens batch actions near the selection and in the Review toolbar.
- Dragging pane dividers updates the canvas safe viewport continuously.
- Animations communicate state changes and remain brief, interruptible, and reduced-motion aware.

### 15.3 Help

Tooltips explain every icon-only command, node library item, execution policy, provider limitation, preset, and advanced control. Context Help presents concise task guidance; the full manual remains accessible from Help.

---

## 16. Accessibility

- All canvas commands have keyboard alternatives.
- Channel identity uses shape plus color.
- Focus order follows workspace, pane, canvas selection, and Inspector context.
- Tooltips are accessible descriptions, not the only source of required information.
- Text and controls meet WCAG AA contrast targets where the brand palette allows.
- Reduced motion disables non-essential interpolation and pulsing.
- Zoom, pane size, and canvas navigation remain usable at Windows text scaling from 100% through 200%.

---

## 17. Performance Targets

- Cold start to usable Start screen: under 3 seconds on the supported baseline machine.
- Open a typical document to interactive graph: under 2 seconds.
- Pan/zoom a 1,000-node graph: perceptual 60 fps target and no sustained input blocking above 50 ms.
- Search a 10,000-artifact indexed document: first result under 200 ms.
- Display visible thumbnails without loading full originals.
- Stream audio/video through byte ranges.
- Autosave ordinary graph edits without visible canvas interruption.
- Warm Codex LLM dispatch begins within 1 second of confirmation, excluding provider response time.
- Warm image-provider dispatch minimizes process startup and reports the measured dispatch phase separately from generation time.

---

## 18. Security And Trust

- Renderer processes receive no unrestricted filesystem access.
- Document and asset operations pass through the application service and validated IPC.
- Embedded media is served through `ether-asset://` with document-scoped authorization.
- External references require document-scoped path grants.
- Provider processes run in isolated staging directories.
- Output MIME signature, size, extension, and content hash are validated before import.
- SQLite extensions, arbitrary attached databases, scripts, unsafe navigation, symlink escapes, and executable content are blocked.
- Secrets are never stored inside `.ether` documents.
- Logs redact prompt/reference paths according to the user’s privacy setting while retaining actionable diagnostics.

---

## 19. Deliberate Non-Goals For 4.0

- Opening or migrating Ether 1.x, 2.x, or 2.5 project folders
- Collaborative simultaneous document editing
- Cloud synchronization owned by Ether
- Paid OpenAI Platform API fallback by default
- Browser automation or private service endpoints
- Video or audio generation without a verified provider
- Public recipe marketplace
- Mobile or macOS packaging
- In-app general-purpose Codex chat

The architecture may reserve provider and document capabilities for future releases, but the 4.0 interface must not advertise nonfunctional features.

---

## 20. Release Definition

Ether 4.0 is launch-ready only when:

- A clean Windows install can create, save, reopen, move, and double-click a complete `.ether` document.
- Codex LLM Workers and Codex image generation perform real authenticated work.
- Nano Banana 2 performs real authenticated image generation through Antigravity CLI.
- Graph, branch, selection, and batch execution are previewable, cancellable, durable, and recoverable.
- All enabled connections have verified effects.
- The 12 starter recipes execute their fake-provider acceptance scenarios, and provider-backed recipes validate capabilities before launch.
- Large reference sets and artifact batches remain understandable and responsive.
- The Codex plugin can create a tailored ready-to-run graph through one undoable transaction.
- The packaged application passes security, recovery, performance, accessibility, and primary-journey acceptance gates.
- The packaged runtime contains only the reviewed production closure, retains dependency and native-library notices, and excludes benchmark, fixture, specification, cache, source-map, and development-configuration material.

The detailed technical contracts and measurable tests are normative in the companion specifications.
