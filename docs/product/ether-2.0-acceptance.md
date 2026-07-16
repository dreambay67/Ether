# Ether 2.0 Acceptance

This is the public-grade Windows acceptance checklist for Ether 2.0. It supersedes the V1/Phase 11 manual path and keeps the relevant Windows package checks from `docs/product/phase-11-acceptance.md`.

Run this on Windows from a clean working tree or a reviewed local build. Do not use private one-off files, hidden API routes, or unreproducible manual fixes as acceptance evidence.

## Automated Gate

Run:

```powershell
pnpm test
pnpm desktop:build
pnpm desktop:package:win
pnpm acceptance:smoke
```

Expected result:

- unit, integration, package-shape, and Playwright smoke checks complete without failures;
- the desktop build produces `apps/desktop/dist/index.html`;
- the Electron main build produces `apps/desktop/dist-electron/main/main.js`;
- the Windows package is rebuilt at `release/ether-windows-unpacked`;
- `release/ether-windows-unpacked/Ether.exe` exists;
- the packaged Electron UI smoke launches `Ether.exe`, renders the real window, creates a project through preload/IPC, and reaches the canvas.

## Package Shape

The unpacked package is the acceptance artifact. It is not an installer.

Required package shape:

- `release/ether-windows-unpacked/Ether.exe`;
- `release/ether-windows-unpacked/resources/app/package.json`;
- `release/ether-windows-unpacked/resources/app/dist/index.html`;
- `release/ether-windows-unpacked/resources/app/dist-electron/main/main.js`;
- `release/ether-windows-unpacked/resources/app/node_modules/@ether/engine/dist/index.js`;
- `release/ether-windows-unpacked/resources/app/node_modules/@ether/providers/dist/index.js`;
- runtime dependencies required by the packaged app are copied as real directories, not unresolved workspace links.

The package-shape tests verify the files above. The packaged Electron UI smoke verifies that the packaged `BrowserWindow`, `loadFile`, preload bridge, IPC handlers, and React start flow work together.

## Provider And Privacy Gate

Acceptance requires these provider and privacy constraints:

- Codex CLI default: real image generation, assistant, and evaluation routes use the local Codex CLI route by default.
- API providers opt-in only: API generation and assistant slots must remain explicit, disabled unless selected, and never silently chosen.
- no hidden API fallback: missing Codex CLI, unavailable experimental providers, or failed provider runs must return visible node/job errors instead of using OpenAI Platform API keys, SDK calls, curl calls, or browser automation.
- Project Health/privacy cleanup: Project Health must expose cleanup for provider logs, run artifacts, and stale/private generated traces without deleting the graph.
- provider health must show Simulation Mode, Codex CLI routes, optional API slots, and unavailable experimental provider slots clearly.

## Manual Source

Use this document as the acceptance source and use `docs/product/ether-2.0-user-manual.md` as the manual source for expected user-facing workflow language. If behavior and the manual diverge, update the product docs or file a follow-up before marking public acceptance complete.

## Manual Workflow

Complete each item in one packaged or freshly built Windows desktop session.

1. create project: create a new `.ether` project in a normal Windows user folder and confirm the project header, project path, and empty canvas appear.
2. check providers: open the provider capability matrix, run a health check, and confirm Codex CLI routes are the real-provider default while API providers are opt-in only.
3. add prompt/reference/generation: add at least one Prompt node, one Reference image, and one Generation node; connect the prompt and reference into the generation.
4. preview run: use Run Node to open the run preview and confirm provider-call count, output count, target node, and blocked reasons before execution.
5. generate real asset when provider is available: when Codex CLI is available, run the Generation node and confirm a generated asset lands in the project. When it is not available, record the visible recoverable error instead of accepting a simulated result as real output.
6. branch to edit: branch the generated asset into an Edit node.
7. draw mask: open the edit workspace, draw a mask, save it, and confirm mask metadata appears on the node/inspector.
8. compare: send at least two variants into Compare and confirm the compare artifact records the selected or winning asset.
9. evaluate: run or inspect Evaluate with a custom instruction and confirm evaluation notes are stored with the relevant output.
10. filter to collection: route outputs into Selected, Needs Edit, or Rejected collections and confirm files move or copy into the expected collection folder.
11. reopen project: close and reopen the same `.ether` project; graph, assets, masks, collections, revisions, run history, and settings must rehydrate.
12. recover failed job: force or use an unavailable provider, confirm the failed job stays visible, then retry or recover after changing the provider/settings without losing graph state.
13. inspect lineage: open artifact lineage for a generated or edited asset and confirm prompt, reference, generation, edit, compare, evaluate, and collection context is visible where applicable.
14. Codex propose branch and apply diff: use the Codex command lane to propose a new workflow branch, inspect the diff, reject once, propose again, apply the diff, and confirm the branch is added but not run until explicitly commanded.

## Pass Criteria

Ether 2.0 public-grade Windows acceptance passes when:

- all automated gate commands pass or have documented blocking reasons with narrower green evidence;
- the package shape above is verified by tests and the unpacked package path is recorded;
- the manual workflow is completed using the manual source;
- Project Health/privacy cleanup is verified;
- no hidden API fallback is observed;
- Codex CLI remains the default real-provider route;
- API providers remain opt-in only.
