# Phase 11 Acceptance

This checklist is the review gate for Ether V1 packaging and acceptance. It is meant to be run on Windows before considering the local build ready for deeper personal workflow testing.

## Windows Package

Build and package the unpacked desktop app:

```powershell
pnpm desktop:package:win
```

Expected result:

- `release/ether-windows-unpacked/Ether.exe` exists.
- `resources/app/dist/index.html` exists.
- `resources/app/dist-electron/main/main.js` exists.
- `resources/app/node_modules/@ether/engine/dist/index.js` exists.
- `resources/app/node_modules/@ether/providers/dist/index.js` exists.
- runtime dependencies required by the engine, including `better-sqlite3` and `zod`, are copied into `resources/app/node_modules`.

This is an unpacked package, not an installer. It is enough for Phase 11 acceptance because it proves the Windows desktop runtime can be assembled locally without Firebase, API fallback, or web deployment.

## Local Settings

Ether stores app-local convenience settings under Electron `userData`:

- parent directory,
- project name,
- last project path,
- recent project paths.

Expected behavior:

- closing and reopening the desktop app keeps those fields populated;
- corrupted settings are quarantined as `settings.json.corrupt`;
- project graph state still lives inside the `.ether` project bundle, not in the app settings file.

## Provider Failure Recovery

Provider failures must not crash the app or erase the graph.

Expected behavior:

- unavailable ChatGPT Image 2, Nano Banana Pro, Nano Banana 2, or missing provider routes return node-level errors;
- the failed node is marked `error`;
- the run trace records the failed action;
- the `Run Node` control remains available so the user can change settings, swap provider, or retry;
- no OpenAI Platform API fallback is attempted.

## Visual QA

Review the desktop app against the Ether and DreamBay handbooks:

- `C:/Users/deny7/Downloads/Ether-Visual-Identity-Handbook.pdf`
- `C:/Users/deny7/Downloads/DreamBay-Visual-Identity-Handbook.pdf`

Required visual checks:

- `ETHER by DreamBay` is the primary lockup.
- Electric Blue `#1470DB` is present as the main Ether signal.
- DreamBay gradient appears only as inherited brand signal, not as a generic full-screen wash.
- air fields, clear bubbles, pressure rings, and mask flow communicate operational state.
- canvas, node library, inspector, minimap, and run trace remain readable at desktop size.
- text does not overlap controls or panels.
- Compare, Evaluate, Filter, Assistant, Edit, Prompt, Reference, Generation, Note, Collection, and Directory nodes are visually distinguishable.

## Manual Acceptance Workflow

1. Create a new `.ether` project.
2. Add two Prompt nodes and connect both into a Generation node.
3. Drag in two reference images with different roles.
4. Run prompt assembly on the Prompt nodes.
5. Run Generation with ChatGPT Image 2 through the clean Codex/provider route.
6. Branch the output into an Edit node with mask guidance.
7. Run the edit.
8. Send variants into Compare.
9. Evaluate outputs with a custom instruction.
10. Filter results into Selected, Needs Edit, and Rejected Collections.
11. Confirm generated files physically moved into collection folders.
12. Reload the app and verify graph, history, assets, masks, metadata, and lineage are intact.
13. Use Codex to add a new workflow branch through the Ether MCP/plugin.
14. Inspect the new branch in the desktop app before running it.
15. Execute selected node from Codex on explicit command.

## Pass Criteria

Phase 11 passes when automated tests are green, `pnpm desktop:package:win` completes, the package folder contains a runnable app shape, and the manual workflow above can be completed without graph loss or hidden API fallback.
