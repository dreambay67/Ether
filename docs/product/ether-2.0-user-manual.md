# Ether 2.0 User Manual

Ether is a local graph workspace for building visual AI workflows. Use it to collect references, assemble prompts, generate or edit images, review outputs, and keep project state understandable.

This manual is source documentation for the app. It is written for artists, creative directors, prompt builders, and technical operators who need to understand how the interface behaves.

## Start Flow

The start screen is the entry point before a project is open.

- New Project creates a `.ether` project bundle in the selected parent folder.
- Open Project loads an existing `.ether` bundle.
- Try Sample is a planned starter-project shortcut and is currently unavailable when disabled.
- Check Providers reports which generation providers are configured.
- Recover Project is a planned recovery entry point and is currently unavailable when disabled.

When creating a project, choose a stable local folder with enough disk space for generated images, masks, logs, and project metadata. Ether saves graph state and project metadata into the project bundle, so moving a project should be done by moving the whole `.ether` folder.

## Canvas

The canvas is the main working surface. Nodes represent workflow steps. Edges show how artifacts and context move between those steps.

Use the node library to add nodes, the template gallery to add common graph patterns, and the canvas toolbar to save, load, connect, run, or inspect the graph. The minimap gives a small overview of larger workflows. Selecting a node or edge opens the inspector on the right.

Recommended canvas habits:

- Name or position important nodes so the workflow can be scanned later.
- Keep prompt, reference, generation, edit, and review stages visually grouped.
- Use lock controls when a node or connection should not be changed accidentally.
- Save after structural changes, especially before provider runs or bulk routing.

## Nodes

Each node has a category, subtype, typed inputs, typed outputs, a primary action, and a practical role in the workflow. The node card, ports, inspector, and section help are designed to teach this without requiring a separate modal.

### Prompt Nodes

Prompt nodes assemble text into prompt artifacts. Use them to split a large creative direction into reusable parts such as subject, pose, lighting, style, typography, colour palette, custom notes, or negative constraints. Prompt nodes can freeze an assembled prompt after running, and editing a frozen prompt marks it stale.

### Reference Nodes

Reference nodes prepare visual reference artifacts with roles. Use them for subject, style, composition, product, face, setting, lighting, colour palette, negative, reference, or general context guidance. Reference roles help downstream generation and edit nodes understand why the image matters.

### Edit Nodes

Edit nodes revise existing images. Inpaint, expand/outpaint, draw and note, and upscale flows can use image inputs, prompts, references, masks, and notes. Edit nodes store lineage so a derived image remains connected to the source.

### Store Nodes

Store nodes organize and review artifacts. Directory and Collection nodes mirror or gather outputs. Compare, Evaluate, and Filter nodes support review routing, winner selection, scoring, routing rules, and audit trails.

### Assistant Nodes

Assistant nodes produce editable text for later workflow stages. Use Brainstormer, Mutator, Expander, or Reinforcer nodes when you want a controlled co-pilot step before prompt assembly or generation.

### Generation Nodes

Generation nodes turn prompts, negative prompts, references, metadata, and assistant text into image artifacts. Image, Grid, Character Sheet, and Infographic variants share the same safety habit: preview the run before execution, then inspect provider metadata and outputs afterward.

### Note Nodes

Note nodes hold human context. Use Cloud, Bubble, or Free Draw notes for acceptance reminders, visual callouts, sketches, review observations, or local text context that should travel with the graph.

## Edges And Reference Roles

Edges connect node outputs to compatible inputs. Typed ports make the intended artifact clear: prompt, negative prompt, reference, image, mask, metadata, collection, note, compare, evaluation, rule, edited image, text, or route.

Reference edges can carry a role. Use roles to explain whether a reference is the subject, style, composition, product, face, setting, lighting, colour palette, negative example, general reference, or broader context. If a connection is rejected, read the status message; it usually explains which output and input kinds do not match.

## Prompt Mutation

Prompt mutation lets a prompt node produce controlled variation while preserving important anchors. Enable mutation in the inspector, choose a preset, set a seed when repeatability matters, and tune variation strength, novelty, drift, subject preservation, and style preservation.

Use locked terms for brand names, product names, character identity, mandatory materials, or legal copy. Use negative constraints for things the mutation should avoid. After assembling, inspect mutation lineage to confirm the before and after text.

## Assistant And Codex Co-Pilot

Assistant nodes are graph-native text helpers. They can brainstorm, mutate, expand, or reinforce instructions and pass text or prompt artifacts downstream.

The Codex co-pilot lane proposes graph patches. A patch previews added nodes and edges before it changes the canvas. Apply only when the diff matches your intent. Reject a patch when it adds the wrong structure. Applying a patch does not run the graph; execution remains explicit.

## Run Preview And Execution

Run Preview shows what Ether plans to execute before work starts. It lists the policy, target nodes, affected nodes, item count, provider call candidates, expected outputs, and blocked reasons.

Execution policies:

- Cached inputs uses the current upstream state.
- Refresh upstream reruns required upstream work.
- Downstream starts from the selected node and follows outgoing paths.
- Branch runs the selected branch.
- Selected runs the current selection.

Keep run count caps low while testing. Enable parallel execution only when provider limits, local resources, and output review capacity can handle it. If a provider run fails, the node should remain recoverable and runnable again after settings or inputs are corrected.

## Mask And Edit Workspace

The edit workspace supports mask creation and edit framing. Use brush size and opacity to describe the editable region, choose a recipe, and set frame mode for source, crop, or outpaint work. Saving a mask creates a mask artifact linked to the edit node and source image.

Before running an edit, confirm the source image, mask metadata, recipe, and frame values in the inspector. Clear and redraw masks when the overlay no longer matches the intended edit.

## Compare Evaluate Filter

Compare nodes gather candidates and record a winner, rating, tags, and notes. Evaluate nodes score outputs against review criteria and thresholds. Filter nodes route artifacts according to rules, dry-run settings, and manual overrides.

Use this chain when a workflow needs a review router: compare candidates, evaluate quality, then route selected, needs-edit, or rejected outputs into collections or directories.

## Artifact Browser

The artifact browser lists generated, edited, reference, mask, and collection assets. Use filters to narrow the list, inspect metadata, reveal lineage, rate or tag assets, and drag artifacts back to the canvas. Dragging an image can create a node route for continued editing or review.

The browser is also a verification surface: after a run, confirm that expected artifacts exist, metadata is present, and lineage points back to the graph node that produced the file.

## Providers And API Infrastructure

Ether can run in local simulation mode and can surface optional API-backed image generation providers. Provider status shows whether a provider is configured, unavailable, experimental, or ready.

Before provider runs, check provider settings and expected output count. Keep API keys outside shared project files. Provider logs may include operational metadata, so use health and privacy cleanup controls before sharing a project bundle.

## Collections

Collections group artifacts for review, delivery, or later reuse. Collection Store nodes can create or mirror folders and move pending generated assets into a collection. Use collections for campaign selects, character sheets, rejected variants, edit queues, or client-ready outputs.

When a collection move is pending, verify the source asset, destination collection, and route mode. After moving, inspect the artifact browser to confirm the asset appears in the expected collection.

## Project Health Recovery And Privacy

Project Health checks the project database, provider logs, and run artifacts. Health actions can clear provider logs or run metadata when safe. Disabled actions indicate Ether found an issue type that should not be changed by that control.

Privacy controls are important before sending a project to another person: clear provider logs, remove run artifacts when appropriate, and inspect linked external paths. The Recover Project start-screen action is planned, so use the implemented Project Health checks first when a project appears inconsistent.

## Troubleshooting

If the canvas does not show, return to the start screen and reopen the project bundle. If a node cannot connect, check both node categories and typed ports. If a run is blocked, open Run Preview and read the blocked reasons. If an edit runs against the wrong image, verify the source asset and mask metadata in the inspector. If a provider fails, check provider status, API configuration, run count caps, and retry after correcting the cause.

If a project appears inconsistent, run Project Health before editing more nodes. Avoid manual file edits unless you have a separate backup of the whole `.ether` project bundle.

## Manual Acceptance Basics

Use this checklist before accepting a build or project handoff:

- Start screen opens and can create or open a project.
- Canvas, node library, inspector, run panel, minimap, and artifact browser are visible after opening.
- Each node category can be added and selected.
- Inspector section help is visible with pointer hover and keyboard focus.
- Contract summary explains accepted inputs, produced outputs, primary action, and a practical use case.
- A prompt can assemble, freeze, become stale after editing, and rerun.
- A generation run can be previewed before execution.
- Mask creation stores source, recipe, frame, brush, and stroke metadata.
- Compare, Evaluate, and Filter controls can be edited and reviewed.
- Artifact browser shows outputs, metadata, filters, lineage, and collection membership.
- Provider status, project health, and privacy cleanup controls are reachable; planned disabled actions are labeled as unavailable.
- Troubleshooting messages are specific enough to guide the next user action.
