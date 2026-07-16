# Ether 2.1 Product And Design Spec

**Status:** Draft for approval
**Date:** 2026-06-30
**Product:** Ether by DreamBay
**Platform:** Windows desktop, local-first
**Primary user:** A creator building advanced node-based AI image workflows with visible control, local lineage, and Codex-assisted graph construction.

---

## 1. Purpose

Ether 2.1 is a correction build. It keeps the 2.0 vision, but replaces the weakest 2.01 surfaces with real product architecture:

- a true resizable shell, not cosmetic panel resize;
- a connection system that supports scrollwheel role selection before and after edge creation;
- generation settings sourced from provider capabilities;
- clearer node colors and DreamBay-aligned visual behavior;
- real note shapes and real free drawing;
- tests that fail when the app looks broken, not only when functions return errors.

The build should make the canvas feel like a professional creative instrument. The user should be able to build, inspect, connect, resize, run, and review without fighting hidden implementation details.

---

## 2. Why 2.01 Fell Short

The previous pass treated several deep interaction changes as CSS or renderer patches. That produced partial fixes but did not change the underlying model.

### 2.1 Diagnosis

1. **Panels were not owned by a shell layout.**
   The top and bottom boxes used native CSS `resize: vertical` while the app remained a flex column. The canvas only grew or shrank by accident. Ether needs an explicit grid or pane model where the top row, canvas row, and bottom row share one layout state.

2. **Inspector buttons were fixed symptomatically.**
   The run button row was still fighting broad inspector CSS selectors. Buttons stopped overflowing but collapsed into narrow columns. The inspector needs named section classes and responsive command groups, not broad descendant styling.

3. **Connection semantics were represented as visible handles.**
   Each artifact kind became a physical port, so nodes grew clusters of overlapping dots and labels. The user asked for one visible input and one visible output at rest. Roles must become edge metadata chosen through interaction, not always-visible port text.

4. **The requested scrollwheel connection workflow was not implemented.**
   2.01 only hid role labels until hover and allowed limited post-creation cycling. It did not add active connection draft state, source-side role selection, target-side role selection before release, or whole-edge right-click deletion.

5. **Provider capabilities were too flat.**
   Providers only exposed broad strings such as `image.generate`. Generation nodes had no model profile, aspect ratio, or resolution data to render or validate. These settings must come from provider model profiles where possible and from clearly labeled static adapter profiles where discovery is not available.

6. **Note subtypes were labels, not features.**
   Cloud, Bubble, and Free Draw existed in the catalog, but all rendered as the same rectangular note. Free Draw was not a drawing surface. This broke the user's trust because the app claimed features that did not exist.

7. **Tests validated presence, not usability.**
   Current tests confirmed that UI elements existed, but not that panels stretched, buttons remained readable, ports did not overlap, right-click deletion worked, or free drawing persisted.

### Process Correction

2.1 must be built around acceptance tests and screenshot checks for the exact failures shown by the user. The work should be split into architecture slices, not small visual patches.

---

## 3. DreamBay And Ether Visual Rules

Source references:

- `C:/Users/deny7/Downloads/DreamBay-Visual-Identity-Handbook.pdf`
- `C:/Users/deny7/Downloads/Ether-Visual-Identity-Handbook.pdf`
- `packages/brand/src/tokens.ts`
- `packages/brand/src/brand.css`

Required visual rules:

- Ether is a DreamBay tool, not a separate brand system.
- The Ether mark stays in the DreamBay gradient and must not be recolored.
- Electric Blue `#1470DB` is the primary Ether tool/canvas color.
- Dark compact panels remain the default surface.
- Aqua Signal `#7EF4D7`, Cyan Signal `#37E6EA`, Violet Accent `#8A5CFF`, and neutral depth support the interface.
- Air fields, clear bubbles, pressure rings, and mask flow are operational state language, not decoration.
- Bubbles communicate selection, generation, refinement, confidence, or pass intensity.
- UI labels stay legible, precise, and calm.
- Avoid a one-note blue or purple interface. Use restrained accents by function.

---

## 4. 2.1 Experience Goals

### 4.1 Canvas First

The canvas must claim the available space. If the window grows, the canvas grows unless the user has intentionally resized a panel. Toolboxes should be helpful command surfaces, not layout bullies.

Required behavior:

- top toolbox is hideable and vertically resizable;
- bottom run trace is hideable and vertically resizable;
- left library is hideable and horizontally resizable;
- right inspector is hideable and horizontally resizable;
- minimap sits adjacent to the right inspector and moves when the inspector width changes;
- panel sizes are clamped to sane minimums and maximums;
- the layout can be reset to default.

### 4.2 Readable Inspector

The inspector must never produce vertical button labels or text pressed against a scrollbar.

Required behavior:

- run commands use readable command groups;
- primary commands are full-width or two-column depending on inspector width;
- secondary commands wrap to new rows before text breaks;
- hover help and info popovers have padding from panel edges and scrollbars;
- every major setting has a concise help tooltip.

### 4.3 Professional Node Cards

All main node families must be visually distinct at a glance.

Recommended node accents:

- Prompt: Electric Blue `#1470DB`
- Reference: Aqua Signal `#7EF4D7`
- Assistant: Violet Accent `#8A5CFF`
- Generation: Cyan Signal `#37E6EA`
- Edit: mask-flow violet/cyan blend, implemented as a solid accessible accent
- Compare and Filter: review amber
- Collection and Store: neutral mint/steel
- Note: thin white/cyan contextual accent, variant-specific shape

Node bodies must show useful content:

- prompt nodes show body preview;
- assistant nodes show instruction and latest text output summary;
- reference nodes show one or more assets in a grid;
- generation nodes show provider, model, aspect ratio, resolution, readiness, and latest output;
- edit nodes show source image, mask state, and edit goal;
- collection nodes show item count and storage target;
- compare/filter nodes show routing rules and review status;
- notes show text or strokes directly on the canvas.

---

## 5. Layout System

### 5.1 Shell Layout

Replace flex-column panel behavior with a shell grid:

- row 1: top toolbox;
- row 2: center workspace;
- row 3: bottom run trace.

The center workspace contains:

- left library pane;
- canvas;
- right inspector pane;
- minimap dock adjacent to inspector.

Panel state:

- `topHeight`
- `bottomHeight`
- `leftWidth`
- `rightWidth`
- `topVisible`
- `bottomVisible`
- `leftVisible`
- `rightVisible`

All values must be persisted per project or user profile. If persistence is deferred, it must be kept in one state object ready for persistence.

### 5.2 Splitters

Every visible toolbox needs an obvious splitter:

- top toolbox: splitter along bottom edge;
- bottom trace: splitter along top edge;
- left library: splitter on right edge;
- right inspector: splitter on left edge.

Splitters support:

- pointer drag;
- keyboard resize when focused;
- double-click reset for that pane;
- tooltip explaining hide/resize behavior.

### 5.3 Minimap Dock

The minimap must never sit under the inspector. It is anchored to the usable canvas area, not the window edge. When the inspector expands, the minimap moves left with the inspector edge.

---

## 6. Connection Model 2.1

### 6.1 Core Principle

Ether must separate physical handles from semantic routing.

At rest:

- each node shows one visible input point if it accepts incoming edges;
- each node shows one visible output point if it produces outgoing edges;
- no permanent port label cluster appears on the node.

Under the hood:

- edges store semantic channel and role;
- node contracts define what semantic channels are accepted or produced;
- renderer handles are stable physical anchors, likely `in` and `out`.

### 6.2 Simplified Data Model

Use two axes:

**Channel** describes the transported artifact:

- `prompt`
- `image`
- `mask`
- `metadata`
- `route`
- `evaluation`
- `collection`

**Role** describes how the target should use it:

- `context`
- `prompt`
- `negative`
- `subject`
- `style`
- `composition`
- `product`
- `face`
- `setting`
- `lighting`
- `colourPalette`
- `image`
- `mask`
- `result`
- `route`
- `metadata`

Visible simplifications:

- user-facing `text` and `prompt` are merged into the visible `prompt/context` family;
- user-facing `reference` and `image` are merged into the visible `image/reference` family;
- the engine may keep richer internal distinctions, but the user should not see redundant dots called `text`, `prompt`, `reference`, and `image` on the same node.

### 6.3 Edge Creation Workflow

The user requested this exact behavior and it is required for success:

1. User starts dragging from the visible source point.
2. A small wheel HUD appears near the source point.
3. Mouse wheel or arrow keys cycle the source role/channel while the drag is active.
4. If the user does not cycle, the default source role is applied.
5. When the drag reaches a target node point, a target wheel HUD appears.
6. Mouse wheel or arrow keys cycle the target role before release.
7. If the user does not cycle, the default target role is applied.
8. Releasing creates the connection with locked role metadata.
9. Hovering an existing edge or endpoint reveals the role HUD.
10. Mouse wheel or arrow keys cycle the existing edge role.
11. Right-clicking the edge or endpoint removes that connection through undoable canvas commands.

### 6.4 Edge Visibility

At rest:

- no role text is visible on edges;
- edge color communicates role family;
- selected or hovered edge shows a compact role chip;
- role chip never overlaps node text or connection dots.

Required role color families:

- prompt/context: Electric Blue;
- negative: red/pink warning accent;
- image/reference: Aqua Signal;
- style/composition/setting: Cyan Signal variants;
- mask/edit: Violet Accent;
- metadata/route/filter: amber/neutral;
- result/collection: mint/white.

### 6.5 Logical Connections To Support

The following must work if node contracts make sense:

- Prompt to Prompt: compose prompt sections.
- Prompt to Assistant: assistant uses prompt as context/instruction.
- Assistant to Prompt: assistant populates or updates downstream prompt content.
- Assistant to Generation: assistant output contributes prompt/context.
- Note to Prompt or Assistant: note text becomes context.
- Reference to Generation: image/reference guidance.
- Reference to Edit: image source or reference guidance.
- Generation to Reference: generated output can become a reusable reference.
- Edit to Reference: edited output can become a reusable reference.
- Generation or Edit to Compare: output review.
- Compare to Collection: approved or categorized outputs route to storage.
- Filter to Collection: automatic routing by rule/evaluation result.
- Collection to Generation/Edit: stored references can be reused.
- Image output to Image input wherever a node accepts image context.
- Metadata to Assistant/Filter/Collection: structured routing and tags.

If a connection is invalid, the app must explain why near the cursor and in the inspector.

### 6.6 Multi-Select

Shift-drag marquee selection must work.

Required behavior:

- shift-drag draws a translucent DreamBay cyan selection rectangle;
- nodes inside the rectangle become selected;
- the canvas must not blank or become black;
- selection works with left/right panels open or hidden;
- moving grouped nodes preserves relative positions.

---

## 7. Generation Node Capabilities

Generation nodes must expose real output settings.

### 7.1 Provider Model Profiles

Add structured provider model profiles. Each generation provider should expose:

- provider id;
- display name;
- availability;
- model id;
- model display name;
- supported generation capabilities;
- supported aspect ratios;
- supported resolutions;
- default aspect ratio;
- default resolution;
- whether custom dimensions are supported;
- source of capability data.

Capability source values:

- `cli-discovered`
- `api-discovered`
- `adapter-static`
- `simulation-static`
- `unavailable-slot`

If Codex CLI cannot expose direct image model metadata, Ether may use a conservative static adapter profile, but it must label the source honestly. The UI can still say the selected provider is Codex CLI / ChatGPT Image 2, while noting that aspect/resolution enforcement is request/prompt based unless native CLI metadata is available.

### 7.2 Generation Inspector Controls

Generation nodes must include:

- provider selector;
- model selector;
- aspect ratio selector;
- resolution selector filtered by aspect ratio;
- quality/preset selector if supported;
- unsupported option disabled state with tooltip;
- selected output settings visible on the node card;
- run preview showing provider, model, size, references, and prompt summary.

Changing provider/model/aspect/resolution after an output exists marks the node stale.

### 7.3 Run Metadata

Every generated output stores:

- requested provider;
- requested model;
- requested aspect ratio;
- requested resolution;
- requested width and height if applicable;
- actual output dimensions after file inspection;
- capability source;
- assembled prompt;
- references and roles;
- source graph snapshot;
- run id and provider run record.

---

## 8. Reference Nodes

Reference nodes must be useful from the canvas itself.

Required behavior:

- upload image directly from the reference node card;
- add image vs replace image are both available;
- multiple images in one reference node render as a grid;
- node can switch reference subtype: image, video, colour grid, moodboard;
- role selection is dropdown/picker, not free typing;
- default role is `context`;
- all 11 reference roles remain available where relevant;
- downstream edges can override how a reference is used without rewriting the reference node itself.

Reference node cards should show:

- subtype;
- role;
- linked asset count;
- thumbnails;
- missing file warning if needed.

---

## 9. Assistant To Prompt Behavior

Assistant nodes must be true executable nodes, not deterministic placeholders. The default assistant provider remains Codex CLI. API provider infrastructure may exist, but cannot silently replace CLI.

Required behavior:

- assistant nodes can receive prompt/context/image/metadata where providers support it;
- assistant nodes can output text/prompt/metadata/evaluation;
- connecting Assistant to Prompt means the assistant can populate or update the downstream prompt node;
- user can choose auto-apply or inspect-before-apply behavior;
- execution can run assistant/prompt-only branches without image generation;
- preview shows the assistant run plan before execution.

Prompt nodes are not "run" nodes in the same sense as generation nodes. A prompt run means "assemble/refresh this prompt from upstream text and assistant outputs," not generate an image.

---

## 10. Notes And Drawing

### 10.1 Note Variants

Notes must be real visual objects:

- Basic Note: rectangular compact note.
- Cloud: actual cloud silhouette with thin operational outline.
- Bubble: actual circular or oval bubble callout with clear state-token styling.
- Free Draw: actual drawing surface with persisted strokes.

### 10.2 Cloud

Cloud shape:

- visible cloud silhouette using SVG or CSS mask;
- dark translucent fill;
- cyan/aqua outline;
- optional pressure-ring halo when selected;
- text remains legible.

### 10.3 Bubble

Bubble shape:

- circular or oval, not a rounded rectangle;
- transparent/glass-like interior;
- sparse highlight;
- outline/intensity can communicate confidence, pass count, or refinement state;
- text remains legible.

### 10.4 Free Draw

Free Draw must support:

- pen;
- eraser;
- brush size;
- opacity;
- color choices constrained to Ether tokens;
- clear;
- undo/redo per stroke;
- saved stroke data in graph JSON;
- reload persistence;
- optional export/use as image context in later builds.

Free Draw may reuse extracted logic from the existing mask canvas, but it must not be implemented as another note text box.

---

## 11. Help And Hover System

Every opaque control needs hover help:

- execution policies;
- run buttons;
- provider selectors;
- model/aspect/resolution selectors;
- reference roles;
- library node types;
- note variants;
- edge role wheel;
- panel splitters;
- lock/stale/running/error states.

Help must be concise and operational. It should answer "What does this do?" and "When should I use it?"

Example:

- Whisper mutation: "Small wording drift. Keeps subject and style stable while nudging atmosphere, adjectives, and secondary details."
- Storm mutation: "High variation. Changes framing, visual emphasis, and descriptive language while preserving required constraints."

---

## 12. Suggested Additions For 2.1

These additions are recommended because they reduce confusion without expanding scope too much.

### 12.1 Graph Validation Panel

Add a lightweight validation summary:

- disconnected required inputs;
- unsupported provider selections;
- invalid legacy edges;
- missing reference files;
- nodes marked stale;
- branches ready to run.

### 12.2 Connection Legend

Add a small optional legend explaining edge colors and role families. Hidden by default, available from the toolbar.

### 12.3 Layout Presets

Add presets:

- Build Graph: left and right panels open, trace compact.
- Review Runs: inspector and trace expanded.
- Focus Canvas: all toolboxes hidden except floating controls.
- Debug: header and trace expanded.

### 12.4 Interaction Coach

The first time the user starts a connection in 2.1, show a tiny non-blocking hint:

"Scroll or use arrows before release to choose how this connection is used."

Do not repeat after dismissed.

---

## 13. Acceptance Criteria

2.1 is not accepted unless these are true:

- top toolbox can be stretched and hidden;
- bottom run trace can be stretched and hidden;
- canvas grows when the window grows;
- inspector run buttons are readable at the failing screenshot width;
- minimap never sits under inspector;
- generation node has provider, model, aspect ratio, and resolution controls;
- output settings are passed to provider input and recorded in run metadata;
- only one input and one output point are visible on a node at rest;
- scrollwheel/arrows choose connection roles during active connection creation;
- hover plus scroll changes an existing connection role;
- right-click removes a connection through undoable commands;
- shift-drag marquee selects multiple nodes without black-screen failure;
- logical image/reference flows work, including generated output to reference;
- node family borders use distinct DreamBay-aligned colors;
- Cloud note looks like a cloud;
- Bubble note looks like a bubble;
- Free Draw creates persisted strokes;
- reference node can add multiple images from the canvas card;
- hover help exists for node library entries, run policies, buttons, roles, and presets;
- old 2.0/2.01 graphs load with migrated or decorated connections.

---

## 14. Validation Plan

Required validation:

- unit tests for connection taxonomy, role defaults, role cycling, logical connection matrix, provider profiles, output selection validation, note visual defaults, and stroke serialization;
- renderer tests for panel resizing, inspector button geometry, minimap docking, edge role wheel, right-click deletion, shift marquee, generation settings persistence, reference multi-image grid, note shapes, and free draw;
- smoke screenshots for the exact failure modes supplied by the user;
- manual test using a real project:
  1. open a project;
  2. resize all four panels;
  3. create prompt, assistant, reference, generation, compare, collection, and note nodes;
  4. connect assistant to prompt and run assistant-only;
  5. connect reference to generation with role wheel;
  6. select aspect ratio/resolution;
  7. run fake generation first;
  8. route output to reference and collection;
  9. draw a free-draw note;
  10. save, reload, and confirm all state remains.

---

## 15. Non-Goals For 2.1

- No browser or desktop automation for providers.
- No hidden API fallback.
- No video generation.
- No public launch packaging polish beyond ensuring the Windows app is usable and testable.
- No full redesign of project onboarding unless needed to support panel layout.
- No custom cloud sync.

---

## 16. Build Strategy

2.1 should be implemented in phases with subagents, but with one integration owner.

Recommended subagent workstreams:

- Layout and inspector readability.
- Connection architecture and edge interaction.
- Provider capability profiles and generation settings.
- Notes, drawing, and DreamBay visual system.
- Tests and acceptance screenshots.

The integration owner must keep the graph schema, renderer state, and tests coherent. The connection work is the riskiest slice and should be integrated before cosmetic refinements.
