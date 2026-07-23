# Ether 4.0 Codex Plugin

Build the local typed MCP adapter, then install or refresh `packages/codex-plugin/ether` through Codex's local plugin flow:

```powershell
pnpm.cmd --filter @ether/mcp-server build
pnpm.cmd --filter @ether/codex-plugin validate
```

The plugin controls the active `.ether` document only. It starts with `ether.document.inspect` and the typed health, catalog, graph, provider, reference, artifact, and recipe tools. The Ether host issues Edit and Run Permits; the plugin can only observe them through `ether.permission.inspect`. Apply and recipe instantiation take the host-issued `editPermitId`. `ether.run.start`, `ether.run.cancel`, and `ether.run.retry` take a host-issued `runPermitId`; start additionally requires the exact previewed `planId` and `contentHash`.

The active portable document is the only lifecycle boundary. Graph replacement, automatic provider substitution, and unrequested execution are unavailable.
