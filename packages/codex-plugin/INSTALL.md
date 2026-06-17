# Ether Codex Plugin Install

Build the local MCP server before installing or refreshing the plugin:

```powershell
pnpm --filter @ether/mcp-server build
```

The installable plugin root is:

```text
packages/codex-plugin/ether
```

Install or refresh that folder through Codex's local plugin flow. The plugin registers the `ether` MCP server and the `$ether-workflow` skill. Use Codex to inspect and edit Ether graphs by default; run tools only after an explicit execution request.
