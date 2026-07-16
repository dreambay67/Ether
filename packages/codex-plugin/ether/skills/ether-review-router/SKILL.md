---
name: ether-review-router
description: Use when an Ether workflow needs Compare Evaluation Filter loops, Data outputs, collection destinations, manual overrides, or audit trails.
---

# Ether Review Router

Build review funnels that make decisions visible before assets move. Keep automatic routing dry until the user approves it.

## Ether 2.5 Model

- Channels: text, image, mask, data, video, audio
- Roles: general, negative, subject, product, face, clothing, pose, setting, composition, style, lighting, colourPalette, typography, motion, timing
- Prompt family: Prompt, Brainstormer, Mutator, Expander, Reinforcer
- Ether 2.5 has one Prompt family, 15 roles, and six channels.
- Use the connection role grid when review inputs need subject, product, style, composition, or other role context.
- Assistant is not a node family in Ether 2.5.
- Compare, Evaluation, and Filter communicate decisions through Data outputs.

## Safety Rules

- Inspect the current Ether graph before editing or execution.
- Keep project-local files, prompts, asset metadata, provider logs, and run plans inside the Ether project unless the user explicitly asks for another destination.
- Do not run generation, evaluation, routing, provider calls, or file operations unless the user explicitly asks.
- Never make silent generation or execution runs.
- Preview graph patches before adding review nodes or collection destinations.
- Preview run plans before evaluation, filtering, or routing.

## Routing Moves

- Use `Compare -> Evaluation -> Filter -> Collection` for most review funnels.
- Feed Compare and Evaluation with image, text, or data channels only when node contracts accept them.
- Emit score, decision, tags, explanation, threshold, and route metadata as data.
- Keep Filter in dry-run routing while tuning thresholds. Report would-route destinations before allowing physical moves.
- Label collection outputs with user-readable names such as `selects`, `needs-edit`, `rejects`, `variant-bank`, or `client-review`.
- Add manual override lanes when taste matters. Manual override should win over automatic scores and leave an audit note.
- Keep an audit trail: source artifact id, edge role, prompt id, evaluator settings, score, threshold, route, override reason, and timestamp.
- Use collection destinations as contracts. Do not invent or rename collections without showing the graph patch first.

## Loop Patterns

- First-pass filter: `Generation -> Evaluation -> Filter`.
- Pairwise choice: `Variant A + Variant B -> Compare -> Evaluation -> Collection`.
- Recovery loop: `rejects -> Prompt -> Generation -> Compare`, with data feedback into the next Prompt family node.
