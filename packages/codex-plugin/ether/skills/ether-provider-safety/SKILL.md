---
name: ether-provider-safety
description: Use when an Ether workflow touches CLI MCP API Simulation or Experimental provider modes, provider selection, run safety, channel/operation capabilities, or fallback behavior.
---

# Ether Provider Safety

Choose provider mode explicitly and keep execution local unless the user opts into another path.

## Ether 2.5 Model

- Channels: text, image, mask, data, video, audio
- Roles: general, negative, subject, product, face, clothing, pose, setting, composition, style, lighting, colourPalette, typography, motion, timing
- Prompt family: Prompt, Brainstormer, Mutator, Expander, Reinforcer
- Ether 2.5 has one Prompt family, 15 roles, and six channels.
- Use the connection role grid to describe provider inputs, then verify channel/operation capabilities.
- Assistant is not a node family in Ether 2.5.
- Multimodal media routing must be capability-gated and visible in run preview.

## Safety Rules

- Inspect the current Ether graph before editing or execution.
- Keep project-local files, prompts, asset metadata, provider logs, and run plans inside the Ether project unless the user explicitly asks for another destination.
- Do not run generation, evaluation, routing, provider calls, adapter calls, or file operations unless the user explicitly asks.
- Never make silent generation or execution runs.
- Preview graph patches before changing provider configuration.
- Preview run plans before any provider execution.
- CLI Codex is the default provider.
- No hidden API fallback.
- Do not use browser or desktop automation for provider execution.

## Provider Modes

- CLI mode: use local Codex CLI provider behavior as the default execution path. Confirm command scope, run cap, channel/operation capabilities, and expected artifacts before execution.
- MCP mode: use Ether MCP tools as the project control surface. Treat MCP as graph and project orchestration, not permission to run silently.
- API mode: use explicit API infrastructure only when the user has opted in. Name the provider, credentials source, network boundary, artifact handling, and cost or quota risk.
- API is opt-in infrastructure only; do not treat it as a default execution path.
- Simulation mode: preview graph patches, provider selection, run order, and expected outputs without calling providers or changing files.
- Experimental mode: require user opt-in, narrow run caps, visible logs, rollback notes, and clear separation from default CLI behavior.

## Capability Rules

- Text to image requires image generation capability.
- Image plus mask plus text requires edit capability that consumes image, mask, and text channels.
- Audio to text requires transcription capability.
- Video to text requires transcription or caption capability.
- Video to image requires extraction capability.
- Data outputs require review, evaluation, filter, or collection operations.
- If a provider lacks the needed channel/operation pair, stop and report the blocker.
- Do not create placeholder media outputs.

## Fallback Rules

- If CLI mode is unavailable, stop and report the blocker. Do not switch to API mode automatically.
- If MCP tools are unavailable, do not imitate the project through browser or desktop automation.
- If API mode is requested, verify that infrastructure is explicit and project-local handling is understood before any run.
- If a provider returns partial artifacts, record provider logs and route recovery through $ether-recovery.
