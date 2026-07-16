---
name: ether-graph-architect
description: Use when an Ether project needs graph topology design, node role channel model wiring, node template selection, graph patch preview, or run preview.
---

# Ether Graph Architect

Design Ether graph structure before touching execution. Favor readable node function topology, role-bearing edges, and reversible edits.

## Ether 2.5 Model

- Channels: text, image, mask, data, video, audio
- Roles: general, negative, subject, product, face, clothing, pose, setting, composition, style, lighting, colourPalette, typography, motion, timing
- Prompt family: Prompt, Brainstormer, Mutator, Expander, Reinforcer
- Ether 2.5 has one Prompt family, 15 roles, and six channels.
- Use the connection role grid to assign edge intent after choosing source and target channels.
- Assistant is not a node family in Ether 2.5.
- Multimodal media routing belongs in the edge contract and provider capability check, not in hidden node naming.

## Safety Rules

- Inspect the current Ether graph before editing or execution.
- Keep project-local files, prompts, asset metadata, provider logs, and run plans inside the Ether project unless the user explicitly asks for another destination.
- Do not run generation, evaluation, routing, provider calls, or file operations unless the user explicitly asks.
- Never make silent generation or execution runs.
- Preview graph patches before saving meaningful topology changes.
- Preview run plans before any execution request.

## Graph Moves

- Start with `ether_graph_get` and `ether_node_contracts`; identify existing node ids, node families, branch boundaries, channels, roles, adapters, and collection exits.
- Use templates only when they reduce ambiguity. Name the template purpose, then map each template node to the user's goal.
- Keep topology legible: Prompt family spine, reference fan-in, variant fan-out, review funnel, and collection exits are usually enough.
- Wire only canonical channel and role combinations. If a cross-channel edge needs media interpretation, add an explicit adapter or disable it with a clear reason.
- Keep the graph patch lane explicit: list node creates, node updates, edge creates, edge deletes, source channels, target channels, roles, adapters, and collection changes before `ether_graph_save`.
- For run preview, name the selected node or branch, cap, upstream dependencies, channel/operation capability checks, expected artifacts, review checkpoint, and recovery point.

## Useful Patterns

- Style branch: `Prompt -> Mutator -> Generation -> Compare`, with text/style into image/general.
- Reference branch: `Image Reference -> Generation`, with image/style, image/product, image/face, or image/pose roles.
- Edit branch: `Image + Mask + Prompt -> Edit`, with image/general, mask/general, and text/composition or text/negative roles.
- Review branch: `Generation -> Compare -> Evaluation -> Filter -> Collection`, with image/data and data/data handoffs.
- Media branch: audio or video references stay disabled for text interpretation until provider capability is explicit.
