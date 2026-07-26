# Ether 4.0 Acceptance And Release Gates

**Status:** Normative planning baseline
**Date:** 2026-07-16
**Applies to:** Windows packaged Ether 4.0 and its Codex plugin

Ether 4.0 is not complete because individual components exist. It is complete only when the packaged application passes the end-to-end gates below with real behavior, reliable recovery, and no deceptive fallback.

---

## 1. Automated Gate

- [ ] All packages typecheck without ignored renderer errors.
- [ ] Unit tests pass with no `.only`, skipped core tests, or weakened assertions.
- [ ] Integration tests pass against real temporary `.ether` documents.
- [ ] Fake-provider Playwright journeys pass at all required viewports.
- [ ] Packaged Electron journeys pass on a clean Windows user profile.
- [ ] Plugin validation passes and every skill teaches the 4.0 document/graph model.
- [ ] Production build has no unexpected dynamic-import, missing-native-module, or renderer chunk failure.
- [ ] Dependency and packaged-file audit contains no secrets, development databases, test results, user projects, or provider credentials.

Required command family:

```powershell
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm run lint
pnpm run test:unit
pnpm run test:integration
pnpm run test:smoke
pnpm run desktop:build
pnpm run desktop:package:win
pnpm run test:packaged
pnpm run test:performance
pnpm run test:conformance:codex
pnpm run test:conformance:antigravity
node packages/codex-plugin/scripts/validate-plugin.mjs packages/codex-plugin/ether
```

The implementation may introduce the missing script names, but the final release must expose one equivalent command for every gate.

---

## 2. Document Lifecycle

### 2.1 New And Save

- [ ] File > New opens an untitled usable canvas without asking for a parent directory.
- [ ] Ctrl+S opens the Windows Save dialog for an untitled document.
- [ ] Saving produces one `.ether` file and no required adjacent project directory.
- [ ] Writer leases and recovery metadata are stored in Ether AppData, not beside the document.
- [ ] A clean close leaves no rollback journal; crash recovery removes or resolves a stale journal before writable open.
- [ ] The saved file carries Ether application ID, marker, format, and schema identifiers.
- [ ] Ordinary graph edits autosave and visibly transition through Saving to Saved.
- [ ] Ctrl+S creates a manual milestone visible in document history.
- [ ] Closing after a successful autosave does not show a false unsaved-changes prompt.

### 2.2 Open And Windows Integration

- [ ] File > Open opens a valid `.ether` document.
- [ ] Explorer double-click opens the correct document in Ether.
- [ ] Dragging an `.ether` document onto Ether opens it.
- [ ] Opening an already-open document focuses its window.
- [ ] A competing process cannot acquire writable access; read-only open remains available.
- [ ] Recent Documents and Jump List entries open their target or report that it is missing.
- [ ] Unicode, spaces, long paths, removable drives, and local cloud-synced locations behave predictably.

### 2.3 Save As, Copy, Compact

- [ ] Save As produces a complete validated destination and switches only after success.
- [ ] Save As rebinds its AppData lease to the destination and leaves no persistent source-path lock.
- [ ] Save a Copy produces a complete validated destination without switching.
- [ ] Failed Save As leaves the source and pre-existing destination intact.
- [ ] Compact Document preserves graph, artifacts, lineage, runs, and hashes.
- [ ] Compact reports actual before/after size and never replaces the source with an invalid file.

### 2.4 Portability

- [ ] A document with embedded references opens fully after being moved to another supported Windows machine.
- [ ] Make Document Portable reports missing references and embeds every available linked source.
- [ ] Deleting Ether caches, provider staging, and Live Output Folder does not remove project data.

---

## 3. Crash And Recovery

- [ ] Kill during graph autosave restores the last complete transaction.
- [ ] Kill during a large embedded import exposes no partial artifact.
- [ ] Interrupted imports resume or are safely reclaimed.
- [ ] Kill after provider output but before document import reconciles or quarantines the staged output.
- [ ] Kill during Save As preserves the original and any pre-existing destination.
- [ ] Kill during Compact preserves the original.
- [ ] Recovery work is shown as a reviewable revision and is not applied invisibly.
- [ ] Deliberately corrupt metadata opens read-only recovery or a clear unsupported state.
- [ ] Deliberately corrupt indexes are rebuildable.
- [ ] Deliberately corrupt media chunks report affected artifacts distinctly from graph corruption.
- [ ] Repair writes a new `.ether` file and report; it never mutates the damaged source.

---

## 4. Graph And Canvas

### 4.1 Editing

- [ ] Node titles are editable; family and canonical subtype are not accidentally changed by title edits.
- [ ] Clicking empty canvas clears node and edge selection.
- [ ] Left-dragging empty canvas creates a selection marquee without a black-screen crash.
- [ ] Right-dragging empty canvas pans.
- [ ] Selected nodes move as a group.
- [ ] Undo/redo covers create, delete, move, resize, title, config, connection, role, group, module, and plugin transaction operations.
- [ ] Removing an edge by right-click deletes only that edge, never selected nodes.
- [ ] Removing nodes uses explicit node deletion or keyboard command and confirms only when downstream impact warrants it.

### 4.2 Channels And Roles

- [ ] Exactly six channel types appear: Text, Image, Mask, Data, Video, Audio.
- [ ] Exactly 15 roles appear and General is default.
- [ ] Only connected channel dots appear at rest.
- [ ] Available dots appear on hover, focus, or active connection drag.
- [ ] Dots remain separated at default and resized node dimensions.
- [ ] Channel identity uses shape and color.
- [ ] Non-General role badges remain visible on lanes.
- [ ] Role grid changes the selected edge role immediately and undoably.
- [ ] Sending-node Inspector displays outgoing roles and targets clearly.
- [ ] Multiple lanes with different channels, roles, or selectors may connect the same node pair.
- [ ] Exact duplicate lanes are rejected with a useful explanation.

### 4.3 Connection Effects

- [ ] Text/Subject into Generation creates a Subject prompt section.
- [ ] Two direct Text/Subject lanes create Subject and Subject 2.
- [ ] Prompt -> Mutator -> Expander -> Generation remains one Subject lineage.
- [ ] Text/Negative enters negative constraints only.
- [ ] Image/Style into Generation is packaged as a style reference.
- [ ] Image/Subject into Generation is packaged distinctly from Image/Style when provider capability allows.
- [ ] Image + Mask + Text into Image Edit controls the edit.
- [ ] Image -> Text invokes a visible vision adapter.
- [ ] Audio -> Text invokes a visible transcription adapter or is blocked before run.
- [ ] Video -> Text invokes visible transcription/interpretation adapters or is blocked before run.
- [ ] Video -> Image invokes real frame extraction.
- [ ] Unsupported Text -> Video and Text -> Audio are blocked without placeholder output.
- [ ] A generated exhaustive matrix test proves that every enabled source node/channel, target node/channel, role, and adapter tuple resolves to a named executor consequence.
- [ ] The same generated test proves that every tuple without a consequence is disabled with a stable reason code.

### 4.4 Modules

- [ ] A selection can become a module with declared inputs, outputs, and exposed parameters.
- [ ] Collapsing a module preserves its connections and execution semantics.
- [ ] Entering and leaving a module preserves parent viewport and selection.
- [ ] Plugin- and recipe-created modules remain inspectable and undoable.

---

## 5. Prompt And LLM Workers

- [ ] Authored Prompt has no misleading Run button.
- [ ] Prompt body and assembled output are editable with visible manual-override provenance.
- [ ] LLM Worker offers Generate Output and never overwrites another node’s instruction.
- [ ] Model list and reasoning efforts come from the active Codex runtime.
- [ ] Fast, Balanced, Deep, and Custom profiles resolve to inspectable settings.
- [ ] Downstream-model awareness changes compiled guidance when enabled.
- [ ] Inspect-first leaves a proposed output version for approval.
- [ ] Auto-apply advances the selected output without destroying prior versions.
- [ ] Latest, latest approved, all, and pinned edge selectors consume the correct versions.
- [ ] A mutation request returns transformed content, not change narration.
- [ ] Structured outputs are schema-validated before acceptance.
- [ ] Image input is actually inspected by a vision-capable Codex model.
- [ ] Audio/video input is interpreted only when a real capability or adapter exists.
- [ ] Cancelling an LLM Worker visibly stops or transitions to cancellation-pending according to runtime support.
- [ ] Production LLM Worker, Evaluate, and semantic-adapter controls expose Codex only; dormant API interfaces cannot be selected in 4.0.

---

## 6. Image Providers

### 6.1 Codex

- [ ] Provider Health discovers the real authenticated Codex runtime.
- [ ] Codex image generation produces a real artifact through the subscription-backed route.
- [ ] Prompt and reference inputs reach the provider as shown in Run Preview.
- [ ] Aspect ratio and resolution controls are capability-derived and steer the request.
- [ ] Warm dispatch does not pay avoidable process startup per item.
- [ ] Cancellation, timeout, malformed output, and authentication failures have distinct states.
- [ ] No paid OpenAI API call occurs unless a future API route is deliberately configured and selected.

### 6.2 Antigravity

- [ ] Provider Health discovers `agy.exe` and authenticated status.
- [ ] Nano Banana 2 generates a real imported image and is the minimum launch gate.
- [ ] Nano Banana Pro is enabled only after its conformance scenario passes.
- [ ] Nano Banana 2 Lite is enabled only after its conformance scenario passes and is restricted to verified 1K output.
- [ ] Ether records requested profile separately from any provider-reported model identity.
- [ ] Antigravity output staging is isolated per attempt and cleaned according to policy.
- [ ] No browser automation, private endpoint, or extracted session token is used.
- [ ] The Antigravity evidence record identifies CLI version, arguments, requested profile instruction, exit state, staged output hashes, dimensions, and conformance result.

### 6.3 Capability UI

- [ ] Switching providers updates aspect ratio, resolution, reference limit, output count, and operation controls.
- [ ] Unsupported settings cannot be launched.
- [ ] Provider changes explain settings that were reset or substituted.
- [ ] Run Preview identifies provider, requested profile, dimensions, reference count, output count, and warnings.

---

## 7. References And Batches

- [ ] Dropping a file on canvas creates or offers a Reference Set.
- [ ] Dropping onto a Reference Set adds rather than silently replaces.
- [ ] Add and Replace are both explicit controls.
- [ ] Multiple images appear in a stable grid on the node.
- [ ] Video and audio show real poster/waveform or honest unavailable-preview states.
- [ ] Linked versus embedded state is visible.
- [ ] Missing links remain represented and do not crash graph execution planning.
- [ ] Reference Desk supports multi-select, include/exclude, role override, and assignment to sets.
- [ ] Batch Matrix previews dimensions and exact work-item count.
- [ ] Sequential execution is default.
- [ ] Parallel execution uses one application-wide domain: 8 active calls globally, 4 shared across Codex, 4 shared across Antigravity, and 1 for an unknown provider.
- [ ] Deterministic instrumentation reaches 4 Codex plus 4 Antigravity calls simultaneously; a fifth same-provider call and ninth global call queue across independent batches.
- [ ] Prompt Worker and Image Generator exact provider/profile/model allocation lanes persist and execute under the same 4/4 family limits.
- [ ] Cancellation, retry, and interrupted-work recovery remain repeat-safe at eight-way concurrency without duplicate accepted artifacts or leaked capacity.
- [ ] Batch Matrix keeps Full batch, Provider and model allocation, and Concurrent run as separate legible control groups and reports the visible 4/4/8 limits honestly.
- [ ] Excluding a matrix cell removes only that work item.
- [ ] A 500-item fake-provider batch can stop, restart, retry failures, and finish without duplicate accepted artifacts.

---

## 8. Review And Artifacts

- [ ] Artifact Browser accepts an empty search field as an unfiltered query.
- [ ] Grid, Filmstrip, Lineage, and Collections views render real embedded artifacts.
- [ ] A 10,000-artifact fixture remains virtualized and searchable.
- [ ] Compare records human selection without hidden LLM execution.
- [ ] Evaluate uses Codex with the displayed instruction/rubric and emits structured Data.
- [ ] Filter deterministically routes associated media from visible rules.
- [ ] Each routed item explains the matching rule.
- [ ] Collection membership is many-to-many and non-destructive.
- [ ] Export Selected produces usable external files.
- [ ] Bulk Export applies naming, format, hierarchy, overwrite, and sidecar policies.
- [ ] Dragging an artifact from Ether produces a temporary file accepted by Explorer and common image editors.
- [ ] Optional Live Output Folder is disabled by default.
- [ ] Disabled Live Output creates no mirror folder and performs no external artifact writes.
- [ ] When enabled, collection moves update disposable mirrored files and remain rebuildable.
- [ ] Live Output collision, cross-volume, interrupted move, revoked grant, external deletion, reconciliation, disable, and rebuild behaviors preserve embedded originals.

---

## 9. Recipes

Each starter recipe must pass its fake-provider scenario:

- [ ] Prompt to Image
- [ ] Reference-Guided Image
- [ ] Moodboard to Variations
- [ ] Draft with Lite, Finish with Pro
- [ ] Character Consistency Sheet
- [ ] Product Campaign Set
- [ ] Infographic Builder
- [ ] Image Edit with Mask
- [ ] Reference Description to Prompt
- [ ] Batch Variations and Contact Sheet
- [ ] Evaluate and Route
- [ ] Curate, Collect, and Export

For every recipe:

- [ ] Setup sheet names required inputs and capabilities.
- [ ] Expected call range and work-item count are accurate.
- [ ] Insertion is one undoable graph transaction.
- [ ] Missing providers offer supported substitutions or block honestly.
- [ ] The inserted graph/module is laid out, titled, connected, and immediately understandable.

---

## 10. Codex Plugin And MCP

- [ ] Plugin installs and validates through the documented local process.
- [ ] Inspect permission cannot modify or execute.
- [ ] Edit Permit can apply graph transactions but cannot start providers.
- [ ] Run Permit binds to one plan ID and content hash.
- [ ] A plugin request can build a tailored graph containing prompts, LLM Workers, references, generation, review, collection, and export preparation.
- [ ] The graph is applied as one undoable revision.
- [ ] Temporary operation references permit connect-as-created transactions.
- [ ] Base-revision conflicts fail with inspectable rebase information.
- [ ] Plugin can inspect and repair the graph it created.
- [ ] Plugin skills contain exactly six channels and 15 roles.
- [ ] Plugin skills never teach legacy project folders, Assistant family, prompt-section nodes, or hidden provider fallback.

---

## 11. UI, Responsive Behavior, And Accessibility

- [ ] Top, bottom, left, and right panes resize, collapse, restore, and persist.
- [ ] Enlarging the application primarily enlarges the canvas.
- [ ] Minimap remains adjacent to, and never under, the Inspector.
- [ ] Inspector content never flows beneath its scrollbar.
- [ ] Button groups wrap into intentional rows, never vertical letters.
- [ ] Contextual help and tooltips exist for icon commands, node items, presets, execution policies, provider limitations, and advanced settings.
- [ ] Default Inspectors show only ordinary task controls; expert sections are collapsed initially.
- [ ] Provider-specific controls appear only for the selected provider/capability, and diagnostics/provenance remain outside the ordinary Inspector until expanded.
- [ ] Build, Focus, Run, and Review workspace transitions preserve document state.
- [ ] Keyboard navigation reaches primary commands, nodes, channel controls, Inspector, and Job Center.
- [ ] Channel identity remains clear without color.
- [ ] Windows scaling at 100%, 125%, 150%, and 200% produces no overlapping primary controls.
- [ ] Reduced motion removes non-essential pulsing/interpolation.
- [ ] Screenshot checks pass at 1920x1080, 1440x900, 1280x720, and representative high-DPI dimensions.

---

## 12. Performance

- [ ] Cold start reaches usable Start screen under 3 seconds on the declared baseline machine.
- [ ] Typical document opens to interactive graph under 2 seconds.
- [ ] 1,000-node graph pan/zoom remains responsive and avoids sustained tasks over 50 ms.
- [ ] 10,000-artifact indexed search returns the first result under 200 ms.
- [ ] Full image bytes are not loaded for off-screen thumbnails.
- [ ] Audio/video requests use byte ranges.
- [ ] Ordinary autosave causes no visible canvas hitch.
- [ ] Warm Codex dispatch begins under 1 second excluding provider response time.
- [ ] Provider timings distinguish compile, queue, process startup, first event, generation, validation, and import.

---

## 13. Security And Packaging

- [ ] Renderer has no Node integration or unrestricted filesystem bridge.
- [ ] IPC validates sender, command schema, document scope, and path grant.
- [ ] `ether-asset://` rejects unknown documents, artifacts, variants, and invalid ranges.
- [ ] Navigation, popup, and external URL policies are restrictive.
- [ ] MIME signature and declared media type must agree before import.
- [ ] Provider command arguments are not shell-interpolated.
- [ ] Secrets and authentication material are absent from documents, logs, packages, and Git history.
- [ ] Installer registers `.ether` association and correct icons.
- [ ] Uninstall never removes user `.ether` documents or export folders.
- [ ] Cache cleanup removes only manifest-tracked Ether AppData.
- [ ] Packaged application starts without source tree or development dependencies.

---

## 14. Documentation And Release

- [ ] User manual describes every workspace, canonical node, channel, role, Inspector control, provider, execution policy, batch tool, review tool, document action, recovery state, and plugin permission.
- [ ] Manual screenshots are captured from the release candidate and match the packaged UI.
- [ ] Architecture and plugin documentation match actual schemas and tools.
- [ ] Troubleshooting covers Codex authentication, Antigravity authentication, missing references, blocked connections, failed jobs, recovery, and repair.
- [ ] Release notes clearly state that legacy Ether folder projects are unsupported.
- [ ] Selecting, dropping, or attempting to open a legacy project directory is refused without migration/import controls and without modifying the directory.
- [ ] Git diff and packaged contents receive a secret/privacy audit.
- [ ] Release branch is pushed without force to [dreambay67/Ether](https://github.com/dreambay67/Ether) only after all preceding gates pass.

---

## 15. Immediate Release Blockers

Any one of these blocks Ether 4.0:

- A valid user action can corrupt or silently lose a document or accepted artifact.
- Legacy folder-project code remains on a primary path.
- Enabled provider controls do not steer the real provider request.
- Codex LLM Workers are deterministic placeholders rather than real model calls.
- Nano Banana 2 cannot complete the live conformance journey.
- Run Preview and execution can disagree about scope or calls.
- A worker overwrites another node’s instruction.
- Allowed connections lack a concrete effect.
- The packaged app exposes unrestricted filesystem or shell execution to the renderer.
- Primary Playwright journeys hang or render a blank/black canvas.
- The installer cannot open a `.ether` document on a clean Windows profile.
- Documentation claims behavior absent from the release candidate.
