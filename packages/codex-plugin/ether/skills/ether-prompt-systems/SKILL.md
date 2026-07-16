---
name: ether-prompt-systems
description: Use when an Ether workflow needs Prompt family design, connection roles, references, controls, presets, or variant strategy.
---

# Ether Prompt Systems

Build prompt systems that can be inspected, varied, reviewed, and repeated. Keep prompt intent on edges and execution behavior in provider plans.

## Ether 2.5 Model

- Channels: text, image, mask, data, video, audio
- Roles: general, negative, subject, product, face, clothing, pose, setting, composition, style, lighting, colourPalette, typography, motion, timing
- Prompt family: Prompt, Brainstormer, Mutator, Expander, Reinforcer
- Ether 2.5 has one Prompt family, 15 roles, and six channels.
- Use the connection role grid to tell the target how each text or reference payload should be assembled.
- Assistant is not a node family in Ether 2.5.
- The Prompt family is the only prompt-node family; roles on connections replace role-specific prompt node types.

## Safety Rules

- Inspect the current Ether graph before editing or execution.
- Keep project-local files, prompts, asset metadata, provider logs, and run plans inside the Ether project unless the user explicitly asks for another destination.
- Do not run generation, evaluation, routing, provider calls, or file operations unless the user explicitly asks.
- Never make silent generation or execution runs.
- Preview graph patches before adding Prompt family nodes, role-bearing edges, or preset controls.
- Preview run plans before any generation request.

## Prompt Moves

- Use a plain Prompt node for authored text. Use Brainstormer, Mutator, Expander, and Reinforcer only when their node behavior is needed.
- Put subject, product, face, clothing, pose, setting, composition, style, lighting, colourPalette, typography, motion, timing, general, and negative intent on connection roles.
- Send text/negative edges to negative prompt output.
- Repeated text roles should assemble as numbered role captions, such as subject, subject 2, and subject 3.
- Attach image references through image roles such as product, face, pose, setting, composition, style, lighting, or colourPalette.
- Expose controls as presets when the user will iterate: style pack, aspect ratio, strength, seed mode, review threshold, and collection target.
- Preserve prompt lineage. When mutating a successful prompt, keep the parent prompt id or note so later review can trace what changed.

## Strong Defaults

- Use dry preview for large role-based prompt variants.
- Limit first runs to a small cap unless the user asks for a batch.
- Prefer named presets over hidden random choices.
- Use $ether-connection-model when a channel, role, or media adapter choice is unclear.
