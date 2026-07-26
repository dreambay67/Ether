# Ether 4.0.0 Release Notes

Ether 4.0.0 is a Windows-first, local-first release centered on a single portable `.ether` document. A document holds graphs, revisions, embedded artifacts, references, runs, collections, recipes, and review state without a required adjacent folder.

## Highlights

- Four adaptive workspaces: Build, Focus, Run, and Review.
- A frozen graph model with 17 canonical nodes, six channels, and 15 explicit connection roles.
- Durable immutable run plans, Job Center cancellation and failed-work retry, automatic interrupted-work recovery, Batch Matrix, and output versions.
- Reference Desk, Artifact Observatory, Compare, Codex-backed Evaluate, deterministic Filter, collections, explicit export, and an opt-in Live Output mirror.
- Real local Codex and Antigravity capability discovery with conformance-gated controls and no hidden paid API fallback.
- Twelve executable starter recipes and a typed Codex plugin/MCP workflow guarded by Inspect, Edit, and plan-bound Run permits.
- AppData-owned recovery, read-only recovery where possible, non-destructive repair, security-scoped media/file access, and installable Windows packaging.
- Maximized-by-default launch with standard Windows minimize, restore, resize, and close controls retained.

## Important compatibility change

**Legacy Ether folder projects are unsupported.** Ether 4.0 does not open, import, migrate, or change legacy directories, including layouts containing `project.json`, `graph.json`, `ether.db`, project-local assets, logs, or collections. Select a real `.ether` file or create a new 4.0 document.

## Provider availability

Provider controls are present only after local discovery and conformance validation. Codex image behavior is version-pinned; Antigravity Nano Banana 2 is the baseline route, while Pro and Lite remain unavailable unless their individual probes pass. Lite is restricted to verified 1K output. Codex LLM work, Evaluate, and semantic adapters use Codex only in 4.0. No subscription CLI action silently falls back to a paid API.

Antigravity routes also require a persisted confirmation under **Settings > Antigravity safety** that the official Antigravity **AI Credit Overages** option is set to **Never**. An unchecked confirmation disables all Antigravity profiles. A checked confirmation does not bypass CLI, authentication, version, or profile conformance checks.

## Batch allocation and concurrency

Batch Matrix now separates **Full batch**, **Provider and model allocation**, and **Concurrent run**. You can assign exact, stable item counts to verified provider/profile/model lanes for reachable Prompt Workers and Image Generators; unassigned items retain the node default. Ether injects each item's dimension values into its effective prompt.

The scheduler uses one application-wide capacity domain across every job and batch: 8 active calls globally, 4 shared across Codex App Server and explicit executable fallback work, and 4 shared across verified Antigravity profiles. A fifth same-provider call and ninth global call wait; an unknown provider fails closed at 1. A Codex or Antigravity route that cannot meet its four-call contract is unavailable instead of becoming a hidden serial fallback. Job Center offers Cancel for eligible work and Retry for failed work. Ether recovers interrupted queued work on reopen, and terminal jobs do not expose Resume.

## Before installing

- Preserve existing legacy folders separately; this release will refuse them without migration controls.
- Keep `.ether` documents outside temporary/cache locations when they matter.
- Install with the Windows installer, which associates `.ether` files with Ether. Uninstall does not remove your `.ether` documents or export folders.
- Read the [User Manual](ether-4.0-user-manual.md) and [Troubleshooting guide](ether-4.0-troubleshooting.md) before running provider-backed work.
