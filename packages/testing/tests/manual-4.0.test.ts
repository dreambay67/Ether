import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (relative: string) => readFile(path.join(root, relative), "utf8");

describe("Ether 4.0 release documentation", () => {
  it("covers the frozen user model and release boundary", async () => {
    const [manual, troubleshooting, notes] = await Promise.all([
      read("docs/product/ether-4.0-user-manual.md"), read("docs/product/ether-4.0-troubleshooting.md"), read("docs/product/ether-4.0-release-notes.md")
    ]);
    for (const phrase of ["Build", "Focus", "Run", "Review", "17 canonical", "Text", "Image", "Mask", "Data", "Video", "Audio", "Negative", "Timing", "Batch Matrix", "Job Center", "Artifact Observatory", "Live Output", "Nano Banana 2", "Inspect", "Edit Permit", "Run Permit", "Prompt to Image", "Curate, Collect, and Export", "Freeform edit", "Product clean-up", "Commit mask", "Save edit setup", "Brush color", "validated text fields"]) expect(manual).toContain(phrase);
    expect(manual).toContain("Node, channel, and role flow");
    expect(manual).toContain("Recovery decision flow");
    expect(manual.match(/Text alternative:/gu)).toHaveLength(2);
    expect(troubleshooting).toContain("Repair to a new document");
    expect(manual).toContain("legacy Ether folder projects");
    expect(notes.toLowerCase()).toContain("legacy ether folder projects are unsupported");
    for (const phrase of [
      "Full batch",
      "Provider and model allocation",
      "Concurrent run",
      "Codex App Server calls at 2",
      "Codex fallback calls at 1",
      "Antigravity calls at 1",
      "dimension names and values",
      "Antigravity safety",
      "AI Credit Overages",
      "Terminal jobs do not show a misleading Resume button"
    ]) expect(manual).toContain(phrase);
    expect(notes).toContain("terminal jobs do not expose Resume");
    expect(troubleshooting).toContain("unknown providers at 1");
    expect(manual).not.toContain("**Resume** schedules unfinished work");
    expect(notes).not.toContain("retry/resume semantics");
  });

  it("keeps release capture and PDF checks fail-closed", async () => {
    const [
      capture,
      nativeCapture,
      fixture,
      etherEdge,
      nodeSetup,
      projectHeader,
      providerStatus,
      settingsPanel,
      exportDialog,
      desktopMain,
      lifecycleAcceptance,
      graphRegistry,
      build,
      verify,
      rootPackage,
      readme,
    ] = await Promise.all([
      read("docs/manual/capture-release.mjs"),
      read("docs/manual/capture-native-dialog.ps1"),
      read("docs/manual/create-release-fixture.mjs"),
      read("apps/desktop/src/renderer/canvas/edges/EtherEdge.tsx"),
      read("apps/desktop/src/renderer/canvas/inspector/NodeSetup.tsx"),
      read("apps/desktop/src/renderer/project/ProjectHeader.tsx"),
      read("apps/desktop/src/renderer/project/ProviderStatusPanel.tsx"),
      read("apps/desktop/src/renderer/project/SettingsPanel.tsx"),
      read("apps/desktop/src/renderer/export/ExportDialog.tsx"),
      read("apps/desktop/src/main/main.ts"),
      read("packages/testing/tests/desktop/document-lifecycle.electron.spec.ts"),
      read("packages/graph-kernel/src/registry.ts"),
      read("docs/manual/build-pdf.mjs"),
      read("docs/manual/verify-manual.py"),
      read("package.json"),
      read("README.md")
    ]);
    expect(capture).toContain("ETHER_RELEASE_INSTALLER");
    expect(capture).toContain("Ether-4.0.0-Setup.exe");
    expect(capture).toContain("installedExecutable");
    expect(capture).toContain('source: "installed-packaged-exe"');
    expect(capture).toMatch(/for \(const key of \[[\s\S]*?"ETHER_RENDERER_URL"[\s\S]*?\]\) delete environment\[key\]/u);
    expect(capture).toContain('await execFileAsync(installer, ["/S", `/D=${installRoot}`]');
    expect(capture).toContain("await access(installedExecutable)");
    expect(capture.match(/spawn\(installedExecutable,[\s\S]*?windowsHide: false/gu))
      .toHaveLength(1);
    expect(capture.match(/secondLaunch = spawn\(installedExecutable,[\s\S]*?windowsHide: true/gu))
      .toHaveLength(1);
    expect(capture).toContain("await execFileAsync(uninstaller, [\"/S\"]");
    expect(capture).not.toContain("_?=");
    expect(capture).toContain("await waitForEmptyInstallRoot(installRoot, 30_000)");
    expect(capture).toContain("await assertInstallRootEmptyAndRemove(installRoot, 30_000)");
    expect(capture).toContain('["EBUSY", "EPERM"].includes(error?.code)');
    expect(capture).toContain("await assertNoProcessesUnder(installRoot)");
    expect(capture).toContain("DreamBay.Ether.Document\\\\shell\\\\open\\\\command");
    expect(capture).toContain("HKCU\\\\Software\\\\ad6cd9b2-3723-5b60-a3d0-3938212aac8e");
    expect(capture).toContain("HKCU\\\\Software\\\\Microsoft\\\\Windows\\\\CurrentVersion\\\\Uninstall\\\\ad6cd9b2-3723-5b60-a3d0-3938212aac8e");
    expect(capture).toContain("await assertNoExistingEtherInstallation()");
    expect(capture).toContain("await restoreRegistryTrees(registryBackups)");
    expect(capture).toContain(".filter((value) => value.length > 0)");
    expect(capture).toContain("await waitForExtensionAssociationRemoval(15_000)");
    expect(capture).toContain("extensionAssociationPointsToEther");
    expect(capture).toContain("Installer-owned registry tree was not restored exactly");
    expect(capture).toContain("locator.filter({ visible: true })");
    expect(capture).toContain("section.batch-matrix[aria-label='Batch Matrix']");
    expect(fixture).toContain('id: "manual-edge-batch-worker"');
    expect(fixture).toContain('id: "manual-edge-batch-image"');
    expect(capture).toContain('["Full batch", "Provider and model allocation", "Concurrent run"]');
    expect(capture).toContain("name: heading, exact: true");
    expect(capture).toContain('["Prompt Worker", "Image Generator"]');
    expect(capture).toContain("filter({ hasText: target })");
    expect(capture).toContain('name: "Batch execution policy"');
    expect(capture).toContain('captureExpandedScrollable(page, "batch-matrix", batchMatrix)');
    expect(capture).toContain("element.scrollHeight");
    expect(capture).toContain('current.style.gridTemplateRows = "24px auto auto 32px"');
    expect(capture).toContain('current.setAttribute("style", originalStyle)');
    expect(capture).toContain("section.job-center[aria-label='Job Center']");
    expect(capture).toContain('getByRole("button", { name: "Fit View", exact: true })');
    expect(capture).toContain('getByTestId("edge-role-chip")');
    expect(capture).toContain(
      'locator(":scope > button.ether-edge-role-chip")',
    );
    expect(capture).toContain('roleName !== "Subject"');
    expect(capture.match(/await roleButton\.click\(\)/gu)).toHaveLength(2);
    expect(capture).toContain('await roleGrid.waitFor({ state: "hidden" })');
    expect(capture).not.toContain('locator(".ether-edge-role-chip")');
    expect(fixture).toMatch(
      /id: "manual-edge-prompt-worker"[\s\S]*?role: "subject"/u,
    );
    expect(capture).toContain(
      "await waitForLocatorCount(renderedNodes, inspectorNodes.length, 15_000)",
    );
    expect(capture).toContain("await node.click()");
    expect(capture).not.toContain("new globalThis.MouseEvent");
    expect(capture).not.toContain("getByDisplayValue");
    expect(capture).toContain(
      'getByRole("textbox", { name: "Title", exact: true })',
    );
    expect(capture).toContain(
      "await waitForInputValue(inspectorTitle, expectedTitle, 10_000)",
    );
    expect(capture).toContain('locator(".resizable-pane-content")');
    expect(capture).toContain("await waitForLocatorCount(paneContent, 1, 5_000)");
    expect(capture).toContain(
      "await page.locator('[data-node-id=\"manual-canvas-drawing\"]').click()",
    );
    expect(capture).toContain(
      'await waitForInputValue(titleInput, "Drawing", 10_000)',
    );
    expect(capture).toContain("await waitForGraphNodeTitle(");
    expect(capture).toContain(
      "globalThis.window.ether.graph.snapshot(document.documentId)",
    );
    expect(capture).toContain(
      '["prompt-worker", "manual-prompt-worker", "Worker"]',
    );
    expect(capture).toContain("assertInspectorNodeMapMatchesGeneratedFixture(inspectorNodes, nodeDefinitions)");
    expect(capture).toContain("nodes.length !== definitions.length");
    expect(capture).toContain("fixtureNode.title !== expectedTitle");
    expect(capture).toContain("Inspector capture map omits generated fixture node");
    expect(fixture).toContain("nodeDefinitions.map((definition, index)");
    expect(fixture).toContain("title: definition.title");
    expect(fixture).toContain('role: "subject"');
    expect(etherEdge).toContain('data-testid="edge-role-chip"');
    expect(etherEdge).toContain('data-testid="edge-role-grid"');
    expect(nodeSetup).toContain('<input aria-label="Title"');
    expect(projectHeader).toContain('data-testid="project-header"');
    expect(projectHeader).toContain('label="Provider Health"');
    expect(projectHeader).toContain('label="Settings"');
    expect(projectHeader).toContain('state === "saving" ? "Saving" : "Saved"');
    expect(capture).toContain('getByText("Saved", { exact: true })');
    expect(capture).not.toContain('getByText("Saving", { exact: true })');
    expect(lifecycleAcceptance).toContain(
      'expect.arrayContaining(["Saving", "Saved"])',
    );
    expect(providerStatus).toContain('role="dialog"');
    expect(providerStatus).toContain('aria-labelledby="provider-health-title"');
    expect(providerStatus).toContain('aria-label="Close Provider Health"');
    expect(providerStatus).toContain("No telemetry leaves this machine.");
    expect(capture).toContain(
      "await waitForProviderHealthResolved(page, providerHealthDialog, 30_000)",
    );
    expect(capture).toContain("diagnoseProviderHealthQueries");
    expect(capture).toContain('"runtime.providerHealth"');
    expect(capture).toContain('"provider.health"');
    expect(capture).toContain('"provider.capabilities"');
    expect(capture).toContain('new Set(["Checking", "Unknown"])');
    expect(capture).toContain('new Set(["Pending"])');
    expect(settingsPanel).toContain('aria-labelledby="settings-title"');
    expect(settingsPanel).toContain('data-testid="release-recovery-status"');
    expect(settingsPanel).toContain('data-testid="about-ether"');
    expect(settingsPanel).toContain('aria-label="Close Settings"');
    expect(capture).toContain('section[aria-labelledby="provider-safety-settings"]');
    expect(capture).toContain('name: "Confirm Antigravity AI Credit Overages is Never"');
    expect(capture).toContain("if (await overageConfirmation.isChecked())");
    expect(capture).toContain(
      "Fresh release capture profile persisted an unexpected Antigravity overage confirmation."
    );
    expect(capture).toContain(
      'recoveryStatus.getByText("healthy", { exact: true })',
    );
    expect(exportDialog).toContain('aria-labelledby="export-dialog-title"');
    expect(exportDialog).toContain('aria-label="Close export"');
    for (const nativeText of [
      "Allow Codex to edit?",
      "Grant Edit Permit",
      "Codex edit access granted",
      "Approve Codex run plan?",
      "Approve Exact Plan",
      "Codex run plan approved",
    ]) {
      expect(desktopMain).toContain(nativeText);
      expect(capture).toContain(nativeText);
    }
    expect(nativeCapture).toContain("Wait-EtherWindow");
    expect(nativeCapture).toContain("Assert-OwnedVisibleWindow");
    expect(nativeCapture).toContain("Get-OwnedVisibleWindowInventory");
    expect(nativeCapture).toContain("Visible owned windows:");
    expect(nativeCapture).toContain("Get-CimInstance Win32_Process");
    expect(nativeCapture).toContain("[string]$process.ExecutablePath");
    expect(nativeCapture).toContain("$resolvedExecutablePath");
    expect(nativeCapture).toContain("$OwnerProcessIds -notcontains [int]$resolvedProcessId");
    expect(nativeCapture).toContain(
      "GetWindowThreadProcessId($Handle, [ref]$resolvedProcessId)",
    );
    expect(nativeCapture).toContain(
      "IsWindowVisible($Handle)",
    );
    expect(nativeCapture).toContain(
      "IndexOf($TitleToken, [StringComparison]::OrdinalIgnoreCase)",
    );
    expect(nativeCapture).not.toContain("-AnyTitle");
    expect(nativeCapture).toContain("Invoke-NativeButton");
    expect(nativeCapture).toContain('Invoke-NativeButton -DialogHandle $completionHandle -Name "OK"');
    expect(nativeCapture).not.toContain("MenuDowns");
    expect(nativeCapture).not.toContain("Invoke-OwnedCodexMenuCommand");
    expect(nativeCapture).not.toContain("GetMenu(");
    expect(nativeCapture).not.toContain("GetSubMenu");
    expect(nativeCapture).not.toContain("GetMenuItemID");
    expect(nativeCapture).not.toContain("GetMenuString");
    expect(nativeCapture).not.toContain("PostMessage");
    expect(nativeCapture).not.toContain("[Windows.Forms.SendKeys]::SendWait");
    expect(capture).toContain('"--inspect=127.0.0.1:0"');
    expect(capture).not.toContain("ETHER_CAPTURE_MAIN_INSPECTOR");
    expect(capture).toContain('"ELECTRON_RUN_AS_NODE"');
    expect(capture).toContain('"NODE_OPTIONS"');
    expect(capture).toContain("createMainInspectorWatcher");
    expect(capture).toContain("validateMainInspectorEndpoint");
    expect(capture).toContain('endpoint.hostname !== "127.0.0.1"');
    expect(capture).toContain("uncredentialed loopback UUID endpoint");
    expect(capture).toContain("createRedactedStderrDiagnostics");
    expect(capture).toContain("[ephemeral loopback main inspector]");
    expect(capture).toContain('id: "codex.grant-edit"');
    expect(capture).toContain('normalizedLabel: "Grant Edit Permit"');
    expect(capture).toContain('id: "codex.approve-run"');
    expect(capture).toContain('normalizedLabel: "Approve Latest Run Plan"');
    expect(capture).toContain(
      "async function invokeCaptureMenuAction(endpoint, actionName, expectedExecutable, expectedProcessId)",
    );
    expect(capture).not.toContain("invokeCaptureMenuAction(endpoint, menuId");
    expect(capture).not.toContain("invokeCaptureMenuAction(endpoint, expression");
    expect(capture).toContain('method: "Runtime.evaluate"');
    expect(capture).toContain("app.isPackaged !== true");
    expect(capture).toContain("process.pid !== expected.processId");
    expect(capture).toContain("process.execPath");
    expect(capture).toContain("item.id !== expected.id");
    expect(capture).toContain("normalizedLabel !== expected.normalizedLabel");
    expect(capture).toContain('typeof item.click !== "function"');
    expect(capture).toContain("item.enabled !== true");
    expect(capture).toContain("item.click(item, browserWindow");
    expect(capture).toContain("await closeInspectorSocket(socket, 3_000)");
    expect(capture).toContain("socket did not close before native capture");
    expect(capture.indexOf('"editPermit",')).toBeLessThan(
      capture.indexOf('title: "Allow Codex to edit?"'),
    );
    expect(capture.indexOf('"runPermit",')).toBeLessThan(
      capture.indexOf('title: "Approve Codex run plan?"'),
    );
    const manifestSource = capture.slice(
      capture.indexOf('writeFile(path.join(captureOutput, "manifest.json")'),
      capture.indexOf("captureReady = true"),
    );
    expect(manifestSource).not.toContain("mainInspector");
    expect(manifestSource).not.toContain("ws://");
    expect(capture).toContain(
      "await assertExactExecutableProcessSet(nativeProcessIds, installedExecutable)",
    );
    expect(capture).toContain("nativeProcessIds.includes(installedMainProcessId)");
    expect(capture).toContain('processIds.join(",")');
    expect(capture).toContain(
      'scope: { kind: "node", nodeId: "manual-edit-transform" }',
    );
    expect(capture).toContain(
      'assertLocalPermitPlanDefinition(nodeDefinitions, "edit.transform")',
    );
    expect(capture).toContain(
      'assertLocalPermitPlan(plan, "manual-edit-transform")',
    );
    expect(capture).toContain("plan.estimatedCalls !== 0");
    expect(capture).toContain('step.providerBinding !== null');
    expect(graphRegistry).toContain(
      '"edit.transform": { family: "edit", executor: "transform"',
    );
    expect(capture.indexOf('title: "Allow Codex to edit?"')).toBeLessThan(
      capture.indexOf('scope: { kind: "node", nodeId: "manual-edit-transform" }'),
    );
    expect(capture).toContain("assertNoAdditionalProcesses");
    expect(capture).toContain("registryKeyExists");
    expect(capture).toContain("captureReady && cleanupFailures.length === 0");
    expect(capture).toContain("publishAcceptedCaptures(captureOutput, publishedOutput)");
    expect(build).toContain("Packaged Ether release capture");
    expect(build).toContain("manifest.installer.sha256");
    expect(build).toContain('import { chromium } from "@playwright/test"');
    expect(build).toContain("tagged: true");
    expect(build).toContain("outline: true");
    expect(build).toContain("replaceFileAtomically");
    expect(build).toContain("inspector-canvas-drawing");
    expect(build).toContain("Ether_logo.png");
    expect(build).toContain("DB_logo.png");
    expect(verify).toContain("installed-packaged-exe");
    expect(verify).toContain("fitz.open");
    expect(verify).toContain("Placeholder or development screenshot");
    expect(verify).toContain("/StructTreeRoot");
    expect(verify).toContain("reader.outline");
    expect(verify).toContain('page.get("/Annots")');
    expect(verify).toContain("minimum_text_size");
    expect(verify).toContain("resolve_internal_destination_page");
    expect(verify).toContain("visual_signal");
    expect(verify).toContain("blank or near-blank");
    expect(readme).toContain("[Ether 4.0 User Manual (PDF)](docs/product/ether-4.0-user-manual.pdf)");
    const scripts = JSON.parse(rootPackage).scripts as Record<string, string>;
    expect(scripts["manual:build"]).toBe("node docs/manual/build-pdf.mjs");
    expect(scripts["manual:verify"]).toBe("python docs/manual/verify-manual.py");
  });
});
