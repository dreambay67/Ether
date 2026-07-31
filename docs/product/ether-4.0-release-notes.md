# Ether 4.0.0 Release Notes

Ether 4.0.0 is a Windows-first, local-first release centered on a single portable `.ether` document. A document holds graphs, revisions, embedded artifacts, references, runs, collections, recipes, and review state without a required adjacent folder.

## Highlights

- Four adaptive workspaces: Build, Focus, Run, and Review.
- A frozen graph model with 17 canonical nodes, six channels, and 15 explicit connection roles.
- Durable immutable run plans, Job Center cancellation and failed-work retry, automatic interrupted-work recovery, Batch Matrix, and output versions.
- Reference Desk, Artifact Observatory, Compare, Codex-backed Evaluate, deterministic Filter, collections, explicit export, and an opt-in Live Output mirror.
- Real local Codex capability discovery plus a paid Gemini Developer API Nano Banana route with no hidden provider substitution; retained Antigravity CLI is explicit fallback only.
- Twelve executable starter recipes and a typed Codex plugin/MCP workflow guarded by Inspect, Edit, and plan-bound Run permits.
- AppData-owned recovery, read-only recovery where possible, non-destructive repair, security-scoped media/file access, and installable Windows packaging.
- Cold native Windows location classification remains fail-closed but allows up to 12 seconds for a fixed-volume probe before writable admission is refused.
- Maximized-by-default launch with standard Windows minimize, restore, resize, full-screen, and close controls retained; the workspace continuously fills the live window content area.
- A dedicated `Ether.exe --connect-gemini` launch opens only the protected Gemini credential connector, so a key can be connected or tested without opening a workspace or putting credential material in a command.

## Important compatibility change

**Legacy Ether folder projects are unsupported.** Ether 4.0 does not open, import, migrate, or change legacy directories, including layouts containing `project.json`, `graph.json`, `ether.db`, project-local assets, logs, or collections. Select a real `.ether` file or create a new 4.0 document.

## Provider availability

Provider controls are present only after their required local/runtime checks. Nano Banana now normally uses the paid Gemini Developer API through the documented `v1beta` Interactions API. Settings accepts the API key once through a protected field and Electron main stores it with Windows-backed encryption; the renderer can see only configured/verified/error state. Nano Banana 2 maps to `gemini-3.1-flash-image` (0.5K/1K/2K/4K), Pro to `gemini-3-pro-image` (1K/2K/4K), and Lite to `gemini-3.1-flash-lite-image` (1K). Ether requests documented structural ratio/size and the live-conformed JPEG output format, allows slow high-resolution calls up to a bounded five-minute deadline, validates returned MIME/dimensions/hash before import, uses no Google Search/Image Search grounding, and records only redacted provenance. A timeout or other ambiguous completion is never retried automatically. Google's guide currently contains conflicting PNG examples, but its output-format schema and the paid service accept JPEG only on this route; Ether does not convert or relabel it. The initial protected representative matrix passed all eight planned calls; together with two earlier format probes, the migration session generated 10 images. Each repeatable release-gate invocation is independently capped at eight images with a conservative maximum estimate of $1.129. The visible cost figures are estimates rather than billing truth. Codex LLM work, Evaluate, and semantic adapters use Codex only in 4.0.

Antigravity is retained as a visibly labelled **legacy fallback / explicit-only** route. Existing documents bound to `google-nano-banana-*` preserve that choice; no Gemini authentication, billing, quota, safety, network, server, timeout, cancellation, or malformed-output failure switches providers. Antigravity routes require the existing persisted **Settings > Antigravity safety** confirmation and matching CLI conformance; its old 1K-only constraint remains honest for that fallback.

## Batch allocation and concurrency

Batch Matrix now separates **Full batch**, **Provider and model allocation**, and **Concurrent run**. You can assign exact, stable item counts to verified provider/profile/model lanes for reachable Prompt Workers and Image Generators; unassigned items retain the node default. Ether injects each item's dimension values into its effective prompt.

The scheduler uses one application-wide capacity domain across every job and batch: 8 active calls globally, 4 shared across Codex App Server and explicit executable fallback work, 4 shared across Gemini Developer API image profiles, and 4 retained for explicitly selected Antigravity fallback profiles. A fifth same-family call and ninth global call wait; an unknown provider fails closed at 1. A route that cannot meet its four-call contract is unavailable instead of becoming a hidden serial fallback. Job Center offers Cancel for eligible work and Retry for failed work. Ether recovers interrupted queued work on reopen, and terminal jobs do not expose Resume.

## Before installing

- Preserve existing legacy folders separately; this release will refuse them without migration controls.
- Keep `.ether` documents outside temporary/cache locations when they matter.
- Install with the Windows installer, which associates `.ether` files with Ether. Uninstall does not remove your `.ether` documents or export folders.
- The installed runtime retains dependency license files and a `THIRD-PARTY-NOTICES.txt` native-runtime notice; benchmark, fixture, specification, and development-configuration files are not shipped.
- Read the [User Manual](ether-4.0-user-manual.md) and [Troubleshooting guide](ether-4.0-troubleshooting.md) before running provider-backed work.
