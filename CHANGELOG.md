# Changelog

All notable changes to Ether are documented here.

## 4.0.0 - 2026-07-23

### Added

- One portable `.ether` document format with durable graph, artifact, recovery, and revision services.
- Codex App Server and Antigravity CLI provider discovery with explicit capability and conformance boundaries.
- Batch Matrix controls for exact provider/model item allocation, dimension-aware prompts, and bounded concurrent execution.
- A persisted Antigravity safety confirmation that keeps every Antigravity route disabled until the official AI Credit Overages setting is confirmed as Never.
- Twelve executable starter recipes and a typed Codex plugin for inspect, edit, preview, run, and repair workflows.
- A Windows NSIS installer with a per-user installation, `.ether` file association, ASAR packaging, and DreamBay/Ether branding.

### Changed

- Ether 4.0 replaces the legacy directory-project architecture. Folder projects are unsupported and are never migrated or modified by Ether 4.0.
- Job Center offers Cancel for eligible work and Retry for failures. Ether recovers interrupted queued work on reopen and omits Resume from terminal jobs.
- Release, document writer, desktop diagnostics, and installer metadata now report version 4.0.0.

### Security

- The renderer remains sandboxed with no Node integration and uses validated, document-scoped IPC and `ether-asset://` access.
- The Windows uninstaller preserves user `.ether` documents and export folders; it does not delete Ether AppData.
