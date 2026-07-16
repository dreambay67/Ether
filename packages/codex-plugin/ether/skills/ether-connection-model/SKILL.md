---
name: ether-connection-model
description: Use when an Ether workflow needs the node role channel model, connection role grid, exact channel and role semantics, or multimodal media routing.
---

# Ether Connection Model

Apply the Ether 2.5 graph contract before creating or changing edges. Nodes define function; edges carry channel, role, and optional adapter meaning.

## Ether 2.5 Model

- Channels: text, image, mask, data, video, audio
- Roles: general, negative, subject, product, face, clothing, pose, setting, composition, style, lighting, colourPalette, typography, motion, timing
- Prompt family: Prompt, Brainstormer, Mutator, Expander, Reinforcer
- Ether 2.5 has one Prompt family, 15 roles, and six channels.
- Use the connection role grid as a 5-by-3 chooser for the 15 roles.
- Assistant is not a node family in Ether 2.5.
- Multimodal media routing is explicit: cross-channel edges need a real adapter or a disabled reason.

## Safety Rules

- Inspect the current Ether graph before editing or execution.
- Keep project-local files, prompts, asset metadata, provider logs, and run plans inside the Ether project unless the user explicitly asks for another destination.
- Do not run generation, evaluation, routing, provider calls, adapter calls, or file operations unless the user explicitly asks.
- Never make silent generation or execution runs.
- Preview graph patches before adding or changing channel and role semantics.
- Preview run plans before any execution request.

## Edge Contract

- Every 2.5 edge has `sourceChannel`, `targetChannel`, and `role`.
- Same-channel edges can pass payloads when both nodes accept the channel and the role changes assembly or routing.
- Text roles assemble prompt meaning. `negative` becomes negative guidance; repeated roles are numbered by assembly.
- Image roles package visual references such as product, face, pose, setting, composition, style, lighting, and colourPalette.
- Mask routes are consumed by edit operations as masks, not as ordinary images.
- Data routes feed Compare, Evaluation, Filter, Collection, and metadata decisions.
- Video and audio routes are references unless a provider has a matching operation such as transcribe, caption, extract, interpret, or transform.

## Multimodal Media Routing

- Audio to text requires a transcription provider.
- Video to text requires transcription or caption capability.
- Video to image requires frame extraction capability.
- Image to text requires visual description or OCR capability.
- Data to mask requires a polygon or rasterization schema.
- Text to audio requires an audio generation provider.
- If the capability is unavailable, disable the edge or block the run with a clear user-facing reason.
- Do not create placeholder media outputs.
- Do not fall back to another provider unless the user explicitly selected that provider mode.

## Patch Checklist

1. Inspect node contracts and existing edge data.
2. Choose source channel, target channel, and role from the canonical lists.
3. Confirm the connection has backend impact: prompt assembly, reference packaging, mask consumption, review data flow, storage, or a provider adapter.
4. Add an adapter only when provider capability is visible and explicit.
5. Preview the patch with channel, role, adapter status, and disabled reasons.
6. Save only the project-local graph patch.
