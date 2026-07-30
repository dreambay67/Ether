# Ether 4.0 User Manual

**Version 4.0.0 | Windows | DreamBay**

Ether is a local-first creative production canvas. An Ether project is one portable `.ether` document containing its graphs, revisions, embedded media, runs, collections, and review decisions. It is designed around a simple visible model: a **node** does work, a **channel** carries a kind of payload, and a **role** tells the receiving node how to use it.

> Release-candidate images are inserted only by `docs/manual/capture-release.mjs`, which launches the installed Ether executable under a disposable Windows profile. This source manual deliberately contains no substitute development-renderer captures.

## Contents

1. [Start safely](#start-safely)
2. [Workspaces](#workspaces)
3. [Documents, references, and recovery](#documents-references-and-recovery)
4. [Canvas, nodes, connections, and Inspector](#canvas-nodes-connections-and-inspector)
5. [Run plans, batches, and Job Center](#run-plans-batches-and-job-center)
6. [Review, collections, and export](#review-collections-and-export)
7. [Providers and intelligent work](#providers-and-intelligent-work)
8. [Recipes and Codex plugin](#recipes-and-codex-plugin)
9. [Settings, accessibility, and privacy](#settings-accessibility-and-privacy)
10. [Examples](#examples)
11. [Reference index](#reference-index)

## Start safely

Choose **New document** to start an untitled usable canvas, or **Open document** to select one supported `.ether` file. Press `Ctrl+S` to name a new document. After a name exists, Save flushes pending work and creates a manual milestone; it does not create a project folder.

Ether opens maximized so the canvas and its supporting panes use the available desktop. The standard Windows title-bar controls remain available to minimize, restore, resize, or close the app.

Ether 4.0 does **not** open, import, or migrate legacy Ether folder projects. A directory containing `project.json`, `graph.json`, or `ether.db` is refused unchanged. Create a new `.ether` document and bring in only the source media you need.

The installed runtime retains its dependency license files and a `THIRD-PARTY-NOTICES.txt` native-library notice. It does not ship benchmark, fixture, specification, source-map, cache, or development-configuration material.

The title bar reports **Saving**, **Saved**, or **Needs attention**. Idle edits autosave after 1.5 seconds and are not deferred longer than ten seconds. `File > Save As` validates a new destination and switches to it only after success. `Save a Copy` validates a copy but leaves the original active. `Compact Document` reclaims abandoned embedded-object pages and reports the actual before/after size.

## Workspaces

| Workspace | Use it for | Primary surfaces |
|---|---|---|
| **Build** | Constructing and wiring workflows | Node Library, canvas, Inspector, compact Job Center |
| **Focus** | Editing one selection with less visual noise | canvas, selected node/module, optional Reference Desk |
| **Run** | Previewing scope and operating durable work | immutable plan, Job Center, Batch Matrix, live output strip |
| **Review** | Choosing and delivering results | Artifact Observatory, Compare, Evaluate, Filter, collections, export |

Use the workspace switcher at the top. Left, right, top, and bottom panes have their own collapse and resize controls; their layout is retained per workspace and document. The canvas receives spare window space. The minimap remains adjacent to the Inspector rather than behind it. At narrow widths, labels give way to icon buttons with tooltips instead of vertical text.

## Documents, references, and recovery

### References

Drop supported image, video, audio, or text material onto the document and organize it in **Reference Desk**. Drops are linked by default; choose **Embed dropped files** when portability matters. Dropping onto a Reference Set adds assets rather than silently replacing them. In the Reference Set Inspector, enter reference IDs and choose **Add references** or **Replace set** explicitly. Reference Desk supports grid, comparison, role overrides, include/exclude selection, assignment to sets, and a target Batch dimension.

Linked items retain their identity, path, timestamps, size, fingerprint, and an embedded preview. If a link goes missing, it remains visible. Use **Locate**, **Search Folder**, **Relink All**, **Use Embedded Preview**, **Embed Available Copy**, or **Remove**; do not assume a preview is a recovered original. **Make Document Portable** shows the expected size change, missing items, and embeds every available linked source after confirmation.

### Read-only, recovery, and repair

Only one process may hold a writable lease. If another writer or an unsuitable cloud/network location has the document, open it read-only where supported. Read-only mode disables changes but preserves inspection and export paths that are safe for the document state.

Interrupted imports and provider staging are recorded in Ether-owned AppData, never beside the document. On the next open, recovery is shown as a reviewable revision rather than silently merged. Damaged metadata may open in read-only recovery. Repair writes a **new** `.ether` file and a report; it never mutates the damaged source. See [Troubleshooting](ether-4.0-troubleshooting.md) for the recovery decision tree.

**Recovery decision flow.** Text alternative: Start with the open result. A healthy document continues in writable mode. A writer or location restriction opens read-only. Interrupted work goes to recovery review. Damaged metadata stays unchanged while Repair writes a new document.

```text
Open .ether
    |
    +-- Healthy --------------------------> Writable document
    |
    +-- Writer/location restriction ------> Read-only -> close writer or save a safe copy
    |
    +-- Interrupted work -----------------> Recovery review -> keep or dismiss revision
    |
    +-- Damaged metadata -----------------> Read-only recovery -> Repair to a new .ether
```

| Open result | -> Review | -> Safe action |
|---|---|---|
| Healthy document | Saved state and document header | Continue in writable mode |
| Writer active or location restricted | Read-only reason | Close the other writer or save a copy to a safe local drive |
| Interrupted import, save, or provider staging | Recovery revision and reconciliation report | Keep or dismiss the recovered revision after inspection |
| Damaged metadata | Read-only recovery and repair report | Repair to a new `.ether` file; preserve the source |

## Canvas, nodes, connections, and Inspector

Select a node or lane to open the contextual Inspector. Empty-canvas click clears selection; left-drag selects, right-drag pans, and selected nodes move as a group. Undo/redo applies graph transactions, including changes from recipes and the plugin. A Group is visual organization only; a Module is a collapsible subgraph with declared inputs, outputs, and exposed parameters.

Each node has an editable **Title**, but its canonical kind is fixed. The card shows connected ports at rest, status when queued/running/blocked/failed/recently done, and one primary action only if the node can actually perform one. **Advanced** disclosures hold diagnostics, provenance, and expert controls. A Prompt deliberately has no Run button.

### Channels and roles

Channels use both a shape and color. A valid lane carries one channel and one role. Ether rejects an exact duplicate lane but permits distinct lanes between the same pair when channel, role, or selector differs.

**Node, channel, and role flow.** Text alternative: Prompt sends Text with the Subject role to Worker. Worker sends approved Text with the Composition role to Image Generator. Reference Set sends Image with the Style role to the same Image Generator. The generator stores an immutable Image output for Review.

```text
Prompt -------- Text / Subject --------> LLM Worker
LLM Worker -- Text / Composition ------> Image Generator ---- Image ----> Review
Reference Set --- Image / Style -------/
```

| Producer node | -> Channel | -> Role at receiver | -> Receiver node | -> Result |
|---|---|---|---|---|
| Prompt | Text | Subject | LLM Worker | A versioned refined prompt |
| LLM Worker | Text, Latest approved | Composition | Image Generator | Positive generation direction |
| Reference Set | Image, All variants | Style | Image Generator | Ordered visual references |
| Image Generator | Image | General | Review | Immutable artifact with lineage |

| Channel | Payload | Typical use |
|---|---|---|
| Text | authored or generated text | prompts, constraints, instructions |
| Image | still media | source, style, subject, generated art |
| Mask | editable selection geometry/raster | Image Edit guidance |
| Data | structured values | variables, scores, metadata, routes |
| Video | moving media | references, captioning, frame extraction |
| Audio | sound media | references, transcription |

| Role | Receiving meaning | Role | Receiving meaning | Role | Receiving meaning |
|---|---|---|---|---|---|
| General | default context | Negative | excluded constraint | Subject | main subject |
| Product | item/product | Face | face identity | Clothing | wardrobe |
| Pose | body/action | Setting | environment | Composition | framing/layout |
| Style | visual treatment | Lighting | light direction/quality | Colour Palette | color guidance |
| Typography | type treatment | Motion | movement | Timing | time/rhythm |

Click a lane role badge or select the lane. The Inspector offers **Role** and **Output selection**: **Latest approved**, **Latest output**, or **All variants**. Once an output exists you can also pin a specific version to an outgoing lane. Two direct Subject lanes become Subject and Subject 2; a Prompt -> Worker -> Worker chain remains one Subject lineage. Text/Negative enters negative constraints, not the positive prompt.

Allowed cross-channel work is always visible: Image -> Text uses Codex vision; Audio/Video -> Text requires a verified transcription or interpretation capability; Video -> Image extracts a real frame; Media -> Data yields technical metadata (semantic metadata needs Codex); Text/Data and Mask/Data have explicit parsing/serialization adapters. Unsupported connections are blocked with an explanation. Text -> Image belongs on Image Generator, not a hidden edge adapter.

### Canonical nodes and controls

All 17 canonical nodes appear in Node Library. The **Setup** section (Title, canonical kind, Save title) is shared. Registry settings save only when valid. The following table lists ordinary controls, then Advanced controls where implemented; provider choices are populated only by verified capabilities.

| Node | Ordinary Inspector controls | Advanced / action |
|---|---|---|
| **Prompt** (`prompt.text`) | Authored text or Manual override text; Assembly: Append incoming context / Manual override; Use assembled text as manual override; Save prompt; assembled read-only text and provenance | no provider action; Diagnostics & provenance |
| **LLM Worker** (`prompt.worker`) | Instruction; Behavior: brainstorm, rewrite, mutate, expand, reinforce, extract, critique, custom; AI profile: fast, balanced, deep, custom; Save worker | Model, Reasoning effort, Variation; **Generate Output** / Preview plan; immutable output tools |
| **Reference Set** (`reference.set`) | reference IDs; **Add references**; **Replace set**; member count and the current order readout | Diagnostics. Reference Desk supplies Grid, Filmstrip, Waveform, and List views plus **Compare selected**; the Inspector does not expose channel or ordering editors in 4.0 |
| **Image Generator** (`generation.image`) | Model profile; capability-derived Aspect ratio, Resolution, Output count; Reset profile defaults; Save provider settings | capability provenance/limitations; **Generate Image** / Preview plan |
| **Image Edit** (`edit.image`) | Model profile, Output count, source image; recipe selector: Freeform edit, Product clean-up, Object removal, Outpaint scene; frame mode and X/Y/Width/Height; mask **Brush**, **Eraser**, **Undo**, **Redo**, **Clear**, Size, Opacity, and **Commit mask**; **Save edit setup** and Save provider settings | capability provenance/limitations; local saved mask precedence; **Generate Edit** / Preview plan |
| **Mask** (`edit.mask`) | validated Mode text, Feather number, Save mask | **Run Mask** / Preview plan |
| **Image Transform** (`edit.transform`) | validated Operation text, Preserve aspect ratio; Width and Height appear only when those optional values already exist; Save transform | **Run Transform** / Preview plan |
| **Compare** (`review.compare`) | validated Selection mode text, Minimum selections; Save compare | human checkpoint; no hidden AI call |
| **Evaluate** (`review.evaluate`) | Instruction, configured-rubric count, AI profile text, Model; Save evaluate | **Evaluate Outputs** / Preview plan; Diagnostics. No separate reasoning control is exposed in this Inspector |
| **Filter** (`review.filter`) | validated Match text plus configured-rule and route counts; Save filter | **Run Filter** / Preview plan |
| **Variables** (`flow.variables`) | configured-variable count; Save variables | **Run Node** / Preview plan |
| **Batch** (`flow.batch`) | configured-dimension and exclusion counts, Parallelism; Save batch | **Build Batch** / Preview plan |
| **Join** (`flow.join`) | validated Strategy text, Require complete; Save join | **Run Join** / Preview plan |
| **Collection** (`output.collection`) | Collection ID, validated Membership mode text, Make primary; Save collection | **Update Collection** / Preview plan |
| **Export** (`output.export`) | Path grant ID, Naming template, validated Format and Collision policy text, Include metadata; Save export | **Export Outputs** / Preview plan |
| **Note** (`canvas.note`) | Body, validated Style text; Save note | non-runnable; use for annotations |
| **Drawing** (`canvas.drawing`) | Width, Height, Background, configured-stroke count; canvas **Brush**, **Eraser**, **Undo**, **Redo**, Brush color, Brush size, and Brush opacity; saved drawing gestures; **Publish drawing** | produces an immutable Image artifact; Diagnostics |

Runnable node Inspectors show **Preview plan** beside their available primary action. Non-runnable Prompt and Note nodes do not. Output versions remain immutable: **Approve**, **Reject**, **Edit** (creates a manual descendant), **Compare**, and **Restore** never overwrite the original. When a manual descendant or outgoing lane is available, its corresponding editor or **Pin** lane control appears conditionally. The shared Advanced **Diagnostics & provenance** section shows node ID, definition ID, and graph ID.

The generic 4.0 Inspector renders booleans as checkboxes, numbers as number fields, strings as validated text fields, and arrays as configured-item counts. A field named “mode,” “strategy,” “format,” or “style” is therefore not necessarily a preset dropdown. Prompt assembly, Worker behavior/profile, provider profile/ratio/resolution/output count, and Image Edit recipes are true selectors. Worker **Variation** is intentionally kept with Model and Reasoning effort in the collapsed Advanced section in the shipped 4.0 UI; this differs from one “ordinary controls” sentence in the design prose but not from the release acceptance contract.

## Run plans, batches, and Job Center

**Preview plan** compiles the exact immutable plan that Run will use. Read provider, requested profile, dimensions, reference count, work-item count, estimated calls, adapters, warnings, and selected output versions before confirmation. Ether refuses execution if the plan content hash changes.

Execution policies are precise:

- **Generate Output** runs one LLM Worker from selected/cached upstream versions.
- **Generate Image / Generate Edit** runs one selected provider node from selected/cached inputs.
- **Run Selected** runs selected runnable nodes in dependency order; outside dependencies stay pinned unless Preview says otherwise.
- **Run Branch** runs the downstream scope from a node or module.
- **Refresh Upstream** deliberately re-runs stale dependencies before a target.
- **Run Recipe** follows its declared scope and checkpoints.

Job Center groups queued, active, completed, blocked, and failed jobs. Open a job for its timeline, work items, attempts, correlation/provenance details, and error action. **Cancel** marks queued work cancelled and asks an active provider to interrupt when supported. **Retry** creates a new attempt for failed work under the same work item and preserves the failed attempt. Ether recovers interrupted queued work when you reopen the document. Terminal jobs do not show a misleading Resume button.

**Batch Matrix** separates planning into three sections:

- **Full batch** lists dimensions, exclusions, exact work-item count, and estimated provider calls. Select a cell to exclude that item.
- **Provider and model allocation** finds reachable Prompt Workers and Image Generators. For a batch with `M` work items, each lane assigns an exact `N` items to a verified provider, profile, and model. Ether keeps those ordinal assignments stable; unassigned items use the target node's current default.
- **Concurrent run** controls simultaneous work independently from batch size. Sequential (`1`) remains the default. Ether uses one shared limit across the running application: 8 active calls globally, 4 Codex calls across App Server and explicit executable fallback work, 4 Gemini Developer API image calls across all documents/jobs/batches, and a separate 4 only for explicitly selected Antigravity fallback work. A fifth same-family call and ninth global call wait. Unknown providers remain at 1. If a route cannot support four active calls, Ether reports it unavailable instead of silently selecting a serial route.

Ether adds each batch item's dimension names and values to the effective Prompt Worker or Image Generator prompt. Exact allocation lanes retain their selected provider, profile, model, and count; Ether does not substitute another image provider. Preview the plan to inspect requested and effective concurrency before you run it. Independent batches share the same limits, and cancellation, retry, or recovery does not create extra capacity.

## Review, collections, and export

In Review, **Artifact Observatory** provides virtualized **Grid**, **Filmstrip**, **Lineage**, and **Collections** views. Empty search means all document artifacts. Filters cover channels, collections, tags, rating, provider, model, run, graph, output version, and dates. Select artifacts for batch actions or open details for provenance, tags, ratings, and recorded evaluation.

**Compare** is a human checkpoint: choose candidates, add notes, and complete the decision. It does not call Codex. **Evaluate** sends the visible instruction and rubric to Codex, previews the compiled request, and stores structured criteria, scores, explanations, and model provenance. **Filter** deterministically routes items using visible rules; every result explains the matching or nonmatching rule.

Collections are many-to-many and non-destructive. Create one, route selected artifacts, or mark a collection primary; membership never moves the authoritative embedded artifact. **Export Selected** and **Bulk Export** use an explicit folder grant. Set naming, output format, hierarchy, collision handling, metadata sidecars, and lineage reports in the export dialog.

**Live Output** is an optional disposable mirror and starts **Disabled**. Select a mirror folder, choose naming (artifact title, node title, or stored template), transfer (copy/move), and collision behavior before enabling it. While enabled, use **Reconcile**, **Rebuild mirror**, **Disable**, or **Remove mirror files**. Removing a mirror never removes embedded originals.

## Providers and intelligent work

The Provider section of Image Generator and Image Edit is populated only from discovered, verified capabilities. If none is available, the Inspector says that Ether will not guess settings and leaves the operation unavailable. A released Provider Health surface must report the detected runtime/authentication state and its capability evidence; if that surface or a profile is unavailable, do not infer that the provider can run. Enabled controls never guess a ratio, resolution, output count, reference limit, edit mode, or cancellation feature. A version or executable-hash change invalidates stale evidence until a new conformance probe passes.

| Route | What Ether uses | Honest unavailable state |
|---|---|---|
| **Codex LLM** | Codex App Server where available; visible `codex exec` fallback when App Server cannot initialize | Worker, Evaluate, and semantic adapters remain unavailable if no authenticated supported Codex runtime exists |
| **Codex Image** | installed authenticated Codex subscription route with version-pinned image conformance | no inferred image capability and no hidden paid API fallback |
| **Gemini API (primary Nano Banana)** | paid Gemini Developer API, Windows-protected key in Electron main, isolated staged import | unavailable until Connect/Test and protected storage are valid; no provider substitution |
| **Antigravity fallback** | official `agy.exe`, isolated per-attempt staging, explicitly selected verified requested profile | disabled until executable/authentication/conformance and the Antigravity safety confirmation are valid |

For Nano Banana, select the **Gemini API** profile unless you deliberately need a document’s retained Antigravity fallback binding. In **Settings > Gemini API**, paste a key only into the protected password field and choose **Connect**. Ether immediately clears the field, stores the credential with Windows protection in the main process, and never shows it again. **Test** checks account access without generating an image; **Replace** changes the protected credential; **Remove** removes it. The renderer receives only Not configured, Configured, Verified, Needs replacement, or Protected storage unavailable state.

You can connect without opening a workspace. Close any running Ether window, then launch `Ether.exe --connect-gemini`. Ether opens only the bounded **Connect Gemini to Ether** window, using the same protected main-process store and Connect/Test/Replace/Remove controls as Settings. Enter the key in that window only; never place the key after the option, in a command, environment variable, file, prompt, or log.

Gemini API maps **Nano Banana 2** to `gemini-3.1-flash-image` (0.5K, 1K, 2K, 4K), **Nano Banana Pro** to `gemini-3-pro-image` (1K, 2K, 4K), and **Nano Banana 2 Lite** to `gemini-3.1-flash-lite-image` (1K only). The Image Generator shows the exact structural dimensions for the selected documented ratio, model-specific reference limit, and live-conformed JPEG output format. Google's current guide contains some PNG examples, but the Interactions output-format schema and the paid live service accept JPEG only for this route; the generic PNG image-content entries also apply to image inputs. Ether therefore does not disguise a JPEG as PNG or perform an undisclosed conversion. Ether validates the requested and returned pixels/MIME/hash before import. Google documents SynthID on generated images. Google Search and Google Image Search grounding are off: Ether sends no tool request, so it cannot add grounding charges invisibly. Price guidance is an estimate, not Google billing truth.

Antigravity profiles are **Nano Banana 2**, **Nano Banana Pro**, and **Nano Banana 2 Lite** only as an explicit legacy fallback. Existing `google-nano-banana-*` documents keep that exact selection, but a Gemini API authentication, billing, quota, safety, network, server, timeout, cancellation, or malformed-output error never switches to it. Its CLI image tool accepts aspect ratio but has no resolution parameter, so fallback controls remain only the exact conformed 1K pixels. It never labels that output 2K or 4K. A changed CLI version or executable hash disables stale fallback capabilities until a new probe passes.

Open **Settings > Antigravity safety** after you set the official Antigravity **AI Credit Overages** option to **Never**. Check **I confirmed AI Credit Overages is set to Never in Antigravity** to save that confirmation. Ether disables every Antigravity route while the box is unchecked. Checking it permits only CLI profiles that also pass the installed runtime, authentication, version, and conformance checks. Ether cannot change the Google billing setting for you.

For a Worker, ordinary controls are instruction, behavior, and AI profile. Fast, Balanced, Deep, and Custom resolve to inspectable settings. Advanced contains the actual model, reasoning effort, and variation. Worker output is a new output version; it never rewrites a Prompt or another worker's instruction. Image/audio/video context is sent only if the selected Codex model and adapter capability support it.

## Recipes and Codex plugin

Recipes are versioned, executable blueprints. Insert one from the recipe gallery, complete its setup sheet, inspect required capabilities, expected calls/work items, substitutions, and checkpoints, then apply the preview. Insertion is one undoable graph transaction. The 12 included recipes are:

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

If a required provider is unavailable, the setup sheet offers only a declared supported substitution or blocks honestly. The resulting graph/module remains titled, connected, inspectable, and undoable.

The Ether Codex plugin is an external co-producer, not a second in-app chat. It can inspect document health, catalog and capabilities; inspect/validate a graph; preview/apply a transaction; list/instantiate recipes; inspect artifacts, references, and runs; preview immutable plans; start/cancel/retry only with permission; and inspect recovery.

| Permit | Allows | Never allows |
|---|---|---|
| **Inspect** | read document/graph/capabilities/health | mutate graph or execute providers |
| **Edit Permit** | apply a previewed graph transaction within its temporary document scope | start a provider or grant itself Run permission |
| **Run Permit** | start one exact immutable plan ID and content hash after desktop approval | a changed plan, broad execution, or self-approval |

Use the desktop menu to grant an Edit Permit or approve the exact latest Codex plan. A base-revision conflict returns rebaseable information. The plugin can create prompts, workers, references, generation, review, collections, and export preparation in one transaction, then inspect and repair the graph it created.

## Settings, accessibility, and privacy

Settings and Provider Health expose capability, diagnostics, recent-document, local layout, protected Gemini connection state, and the persisted Antigravity overage confirmation without granting the renderer unrestricted file or shell access. The optional `--connect-gemini` launch opens only the credential connector and does not start a document workspace or provider background discovery. Gemini credentials are main-process-only Windows-protected values, never document or preference data. Folder choices create scoped grants. Media is delivered through authorized `ether-asset://` document/artifact URLs; arbitrary local paths are not rendered.

Keyboard users can reach document commands, workspace switcher, canvas selection, node/channel controls, Inspector, and Job Center in normal focus order. Use the canvas toolbar for Quick prompt, Quick image, Group, Module, Undo, and Redo. Channel shape is never color-only. Tooltips explain icon commands, nodes, provider limits, policies, presets, and advanced controls. The workspace fills the live Windows content area and smoothly follows maximize, restore, resize, and full-screen changes. Respect Windows scaling at 100%, 125%, 150%, and 200%; reduced-motion settings remove nonessential pulsing/interpolation.

Ether is local-first. Documents, generated artifacts, embedded references, and run evidence stay on the machine. AppData holds only Ether-managed recovery, staging, cache, temporary drag-export, and log material. Logs are bounded/redacted; no telemetry leaves the computer in 4.0. Deleting caches or a Live Output mirror cannot delete document contents.

## Examples

### Create a reference-guided campaign image

1. Create or open a document; add a Reference Set and Image Generator, or insert **Reference-Guided Image**.
2. Drop source images in Reference Desk, set each relevant role (for example Subject, Style, Colour Palette), and Add them to the set.
3. Connect Text/Subject and Image/Style or Image/Subject lanes to Image Generator. Select the output policy on each lane.
4. In Image Generator, select a verified profile, then only its offered ratio, resolution, and output count.
5. Preview plan. Check provider, references, estimated calls, warnings, and scope. Run in Run workspace.
6. Compare results, approve the chosen output, route it to a Collection, then Export Selected.

### Turn a brief into a controlled prompt

1. Add Prompt and LLM Worker. Write the source brief in Prompt.
2. Connect Prompt Text to Worker with Subject. Set Worker behavior to Rewrite, Expand, or Custom and select an AI profile.
3. Preview plan and choose Generate Output. Inspect the immutable version, then Approve, Edit (to create a descendant), or Pin it to a downstream lane.
4. Connect that output to Image Generator. A Negative Text lane remains a negative constraint, never merged into the positive body.

### Batch, evaluate, and deliver

1. Insert **Batch Variations and Contact Sheet** or add Batch and Image Generator. Define dimensions and check the exact work count in **Full batch**.
2. In **Provider and model allocation**, assign exact item counts to reachable Worker or Image Generator lanes. Leave the remainder on each node's default provider and model.
3. In **Concurrent run**, keep sequential execution or select up to eight total calls. Ether applies the lower Codex, Gemini API, explicit Antigravity fallback, or unknown-provider cap and injects each item's dimension values into its effective prompt.
4. Use Job Center to cancel eligible work or retry failed items without accepting duplicates. Ether recovers interrupted queued work when the document reopens; terminal jobs have no Resume action.
5. In Review, use Evaluate with a visible rubric, Filter with rules that explain every route, then add accepted artifacts to a collection and bulk export.

## Reference index

**A**: Advanced controls; Antigravity; Artifact Observatory; autosave.\
**B**: Batch Matrix; Build; Bulk Export.\
**C**: channels; collections; Compare; Compact Document; connections; Codex; corruption.\
**D**: Data channel; document; Drawing.\
**E**: Edit; Embed; Ether document; Evaluate; execution policies; Export.\
**F**: Filter; Focus.\
**G**: Generate; graph; Group.\
**I**: Image; Inspector; immutable output.\
**J**: Job Center.\
**L**: legacy folder projects; Live Output.\
**M**: Make Document Portable; Mask; modules.\
**N**: Note.\
**O**: output selectors.\
**P**: permits; plugin; Prompt; provider health.\
**R**: read-only; recovery; Reference Desk; roles; Run.\
**S**: Save As; Save a Copy; selectors; settings.\
**T**: troubleshooting.\
**V**: Video; variables.\
**W**: Worker; workspaces.

For errors and recovery steps, read [Ether 4.0 Troubleshooting](ether-4.0-troubleshooting.md). For release scope and known capability conditions, read [Ether 4.0 Release Notes](ether-4.0-release-notes.md).
