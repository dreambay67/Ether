import { execFile, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  access,
  cp,
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  rmdir,
  stat,
  writeFile
} from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { promisify } from "node:util";

import { chromium } from "@playwright/test";

import { nodeDefinitions } from "../../packages/graph-kernel/dist/index.js";
import {
  applicationCommand,
  createLocalBridgeApplicationAdapter
} from "../../packages/mcp-server/dist/index.js";
import { resolveCodexCliPath } from "../../packages/providers/dist/index.js";

const execFileAsync = promisify(execFile);
const root = path.resolve(import.meta.dirname, "..", "..");
const publishedOutput = path.join(root, "docs", "product", "assets", "ether-4.0");
const scratchParent = path.join(root, "tmp", "manual-release-capture");
const installer = path.resolve(
  process.env.ETHER_RELEASE_INSTALLER ??
  path.join(root, "release", "windows", "Ether-4.0.0-Setup.exe")
);
const nativeDialogHelper = path.join(root, "docs", "manual", "capture-native-dialog.ps1");
const associationKeys = [
  "HKCU\\Software\\Classes\\.ether",
  "HKCU\\Software\\Classes\\DreamBay.Ether.Document"
];
const installRegistrationKeys = [
  "HKCU\\Software\\ad6cd9b2-3723-5b60-a3d0-3938212aac8e",
  "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\ad6cd9b2-3723-5b60-a3d0-3938212aac8e"
];
const installerOwnedRegistryKeys = [...associationKeys, ...installRegistrationKeys];
const associationResidueKeys = [
  associationKeys[1],
  "HKCU\\Software\\Classes\\DreamBay.Ether.Document\\DefaultIcon",
  "HKCU\\Software\\Classes\\DreamBay.Ether.Document\\shell\\open\\command"
];
const captureMenuActions = Object.freeze({
  editPermit: Object.freeze({
    id: "codex.grant-edit",
    normalizedLabel: "Grant Edit Permit"
  }),
  runPermit: Object.freeze({
    id: "codex.approve-run",
    normalizedLabel: "Approve Latest Run Plan"
  })
});

const inspectorNodes = [
  ["prompt-text", "manual-prompt-text", "Prompt"],
  ["prompt-worker", "manual-prompt-worker", "Worker"],
  ["reference-set", "manual-reference-set", "Reference Set"],
  ["generation-image", "manual-generation-image", "Image Generator"],
  ["edit-image", "manual-edit-image", "Image Edit"],
  ["edit-mask", "manual-edit-mask", "Mask"],
  ["edit-transform", "manual-edit-transform", "Transform"],
  ["review-compare", "manual-review-compare", "Compare"],
  ["review-evaluate", "manual-review-evaluate", "Evaluate"],
  ["review-filter", "manual-review-filter", "Filter"],
  ["flow-variables", "manual-flow-variables", "Variables"],
  ["flow-batch", "manual-flow-batch", "Batch"],
  ["flow-join", "manual-flow-join", "Join"],
  ["output-collection", "manual-output-collection", "Collection"],
  ["output-export", "manual-output-export", "Export"],
  ["canvas-note", "manual-canvas-note", "Note"],
  ["canvas-drawing", "manual-canvas-drawing", "Drawing"]
];
assertInspectorNodeMapMatchesGeneratedFixture(inspectorNodes, nodeDefinitions);
assertLocalPermitPlanDefinition(nodeDefinitions, "edit.transform");
const surfaceLabels = [
  "start",
  "build",
  "focus",
  "run",
  "review",
  "reference-desk",
  "batch-matrix",
  "job-center",
  "artifact-observatory",
  "recipes",
  "channels-roles",
  "inspector-catalog",
  "provider-health",
  "settings",
  "recovery",
  "saving",
  "export",
  "plugin-edit-permit",
  "plugin-run-permit"
];
const labels = [
  ...surfaceLabels,
  ...inspectorNodes.map(([slug]) => `inspector-${slug}`)
];

function assertInspectorNodeMapMatchesGeneratedFixture(nodes, definitions) {
  if (nodes.length !== definitions.length) {
    throw new Error(
      `Inspector capture map has ${nodes.length} nodes; generated fixture has ${definitions.length}.`
    );
  }
  const fixtureNodes = new Map(
    definitions.map((definition) => {
      const slug = definition.id.replaceAll(".", "-");
      return [
        `manual-${slug}`,
        { slug, title: definition.title }
      ];
    })
  );
  const seenNodeIds = new Set();
  for (const [slug, nodeId, expectedTitle] of nodes) {
    if (seenNodeIds.has(nodeId)) {
      throw new Error(`Inspector capture map repeats generated fixture node ${nodeId}.`);
    }
    seenNodeIds.add(nodeId);
    const fixtureNode = fixtureNodes.get(nodeId);
    if (fixtureNode === undefined) {
      throw new Error(`Inspector capture map references non-fixture node ${nodeId}.`);
    }
    if (fixtureNode.slug !== slug || fixtureNode.title !== expectedTitle) {
      throw new Error(
        `Inspector capture ${slug}/${nodeId}/${expectedTitle} does not match generated fixture ` +
        `${fixtureNode.slug}/${nodeId}/${fixtureNode.title}.`
      );
    }
  }
  for (const nodeId of fixtureNodes.keys()) {
    if (!seenNodeIds.has(nodeId)) {
      throw new Error(`Inspector capture map omits generated fixture node ${nodeId}.`);
    }
  }
}

function assertLocalPermitPlanDefinition(definitions, definitionId) {
  const definition = definitions.find((candidate) => candidate.id === definitionId);
  if (definition === undefined) {
    throw new Error(`Local permit-plan definition ${definitionId} is missing.`);
  }
  const config = definition.defaultConfig();
  if (definition.executor !== "transform" || Object.hasOwn(config, "providerId")) {
    throw new Error(
      `Permit-plan definition ${definitionId} must remain a local transform without provider configuration.`
    );
  }
}

await Promise.all([access(installer), access(nativeDialogHelper)]);
if (path.basename(installer).toLowerCase() !== "ether-4.0.0-setup.exe") {
  throw new Error("Release capture requires the reviewed Ether-4.0.0-Setup.exe NSIS candidate.");
}
await mkdir(scratchParent, { recursive: true });
const scratch = await mkdtemp(path.join(scratchParent, "run-"));
const captureOutput = path.join(scratch, "captures");
const installRoot = path.join(scratch, "Installed Ether");
const profileRoot = path.join(scratch, "Profile");
const appData = path.join(profileRoot, "AppData", "Roaming");
const localAppData = path.join(profileRoot, "AppData", "Local");
const runDirectory = path.join(scratch, "Run");
const fixturePath = path.join(scratch, "Ether 4.0 Release Atlas.ether");
const fixtureAppData = path.join(scratch, "Fixture AppData");
const descriptorPath = path.join(localAppData, "DreamBay", "Ether", "mcp-session.json");
const installedExecutable = path.join(installRoot, "Ether.exe");
const shortcutPaths = [
  path.join(profileRoot, "Desktop", "Ether.lnk"),
  path.join(
    profileRoot,
    "AppData",
    "Roaming",
    "Microsoft",
    "Windows",
    "Start Menu",
    "Programs",
    "Ether.lnk"
  )
];
const environment = {
  ...process.env,
  APPDATA: appData,
  LOCALAPPDATA: localAppData,
  USERPROFILE: profileRoot,
  CODEX_CLI_PATH: process.env.CODEX_CLI_PATH ?? resolveCodexCliPath(process.env)
};
for (const key of [
  "ETHER_RENDERER_URL",
  "ETHER_RELEASE_EXE",
  "ELECTRON_RUN_AS_NODE",
  "INIT_CWD",
  "NODE_OPTIONS",
  "NODE_PATH",
  "npm_config_local_prefix"
]) delete environment[key];

assertScoped(scratch, installRoot);
assertScoped(scratch, profileRoot);
assertScoped(scratch, runDirectory);
assertScoped(scratch, fixturePath);

await assertNoExistingEtherInstallation();
const registryBackups = await backupRegistryTrees(scratch);
const shortcutBackups = await backupShortcuts(scratch, shortcutPaths);
const existingProcessIds = await processIdsFor(installedExecutable);
let browser = null;
let appProcess = null;
let appDiagnostics = { stderr: "", stdout: "" };
const mainInspectorWatcher = createMainInspectorWatcher();
const stderrDiagnostics = createRedactedStderrDiagnostics();
let captureReady = false;
let installationAttempted = false;
let installerCompleted = false;

try {
  await Promise.all([
    mkdir(appData, { recursive: true }),
    mkdir(localAppData, { recursive: true }),
    mkdir(runDirectory, { recursive: true }),
    mkdir(captureOutput, { recursive: true })
  ]);

  await runChecked(process.execPath, [
    path.join(root, "docs", "manual", "create-release-fixture.mjs"),
    fixturePath,
    fixtureAppData
  ], {
    cwd: root,
    env: environment,
    timeout: 60_000
  });

  installationAttempted = true;
  await execFileAsync(installer, ["/S", `/D=${installRoot}`], {
    cwd: runDirectory,
    env: environment,
    windowsHide: true,
    timeout: 90_000
  });
  installerCompleted = true;
  await access(installedExecutable);

  const port = process.env.ETHER_CAPTURE_CDP_PORT === undefined
    ? await availableLoopbackPort()
    : Number(process.env.ETHER_CAPTURE_CDP_PORT);
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65_535) {
    throw new Error("ETHER_CAPTURE_CDP_PORT must be an unprivileged TCP port.");
  }
  appProcess = spawn(installedExecutable, [
    "--inspect=127.0.0.1:0",
    `--remote-debugging-port=${port}`,
    "--remote-debugging-address=127.0.0.1",
    "--disable-gpu"
  ], {
    cwd: runDirectory,
    env: environment,
    stdio: "pipe",
    windowsHide: false
  });
  appProcess.stdout?.on("data", (chunk) => {
    appDiagnostics.stdout = appendDiagnostic(appDiagnostics.stdout, chunk);
  });
  appProcess.stderr?.on("data", (chunk) => {
    mainInspectorWatcher.accept(chunk);
    stderrDiagnostics.accept(chunk);
    appDiagnostics.stderr = stderrDiagnostics.snapshot();
  });
  browser = await connectToApp(port, appProcess, appDiagnostics);
  const mainInspectorEndpoint = await waitForMainInspectorEndpoint(
    mainInspectorWatcher,
    appProcess,
    15_000
  );
  const context = browser.contexts()[0];
  if (context === undefined) throw new Error("The installed Ether candidate did not create a browser context.");
  const page = context.pages()[0] ?? await context.waitForEvent("page");
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.getByTestId("document-canvas").waitFor({ state: "visible", timeout: 30_000 });
  await page.getByTestId("project-header").getByText("Untitled", { exact: true })
    .waitFor({ state: "visible", timeout: 30_000 });
  assertPackagedRenderer(page.url());
  await settle(page);
  await capture(page, "start", page.locator("body"));

  const secondLaunch = spawn(installedExecutable, [fixturePath], {
    cwd: runDirectory,
    env: environment,
    stdio: "pipe",
    windowsHide: true
  });
  await waitForExit(secondLaunch, 15_000);
  await page.getByTestId("project-header").waitFor({ state: "visible", timeout: 30_000 });
  await page.getByTestId("project-header").getByText("Ether 4.0 Release Atlas.ether", { exact: true })
    .waitFor({ state: "visible", timeout: 30_000 });
  await page.getByTestId("document-canvas").waitFor({ state: "visible", timeout: 30_000 });
  const versions = await page.evaluate(() => globalThis.window.ether.runtime.versions());
  if (versions.app !== "4.0.0") {
    throw new Error(`Installed candidate reported Ether ${versions.app}, expected 4.0.0.`);
  }
  await settle(page);
  await capture(page, "build", page.locator("body"));
  await capture(page, "reference-desk", page.getByTestId("pane-artifacts"));

  await page.getByRole("button", { name: "Focus", exact: true }).click();
  await page.locator(".adaptive-workspace[data-workspace='focus']").waitFor();
  await capture(page, "focus", page.locator("body"));

  await page.getByRole("button", { name: "Run", exact: true }).click();
  await page.locator(".adaptive-workspace[data-workspace='run']").waitFor();
  const batchMatrix = page.locator("section.batch-matrix[aria-label='Batch Matrix']");
  const jobCenter = page.locator("section.job-center[aria-label='Job Center']");
  await batchMatrix.waitFor({ state: "visible" });
  await jobCenter.waitFor({ state: "visible" });
  for (const heading of ["Full batch", "Provider and model allocation", "Concurrent run"]) {
    await batchMatrix.getByRole("heading", { name: heading, exact: true }).waitFor({ state: "visible" });
  }
  for (const target of ["Prompt Worker", "Image Generator"]) {
    await batchMatrix.locator(".batch-target").filter({ hasText: target }).waitFor({ state: "visible" });
  }
  await batchMatrix.getByRole("combobox", { name: "Batch execution policy" }).waitFor({ state: "visible" });
  await capture(page, "run", page.locator("body"));
  await captureExpandedScrollable(page, "batch-matrix", batchMatrix);
  await capture(page, "job-center", jobCenter);

  await page.getByRole("button", { name: "Review", exact: true }).click();
  await page.locator(".adaptive-workspace[data-workspace='review']").waitFor();
  await page.getByTestId("artifact-observatory").waitFor({ state: "visible", timeout: 30_000 });
  await page.getByTestId("artifact-card").first().waitFor({ state: "visible", timeout: 30_000 });
  await capture(page, "review", page.locator("body"));
  await capture(page, "artifact-observatory", page.getByTestId("artifact-observatory"));
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const exportDialog = page.getByRole("dialog", { name: "Export artifacts" });
  await exportDialog.waitFor({ state: "visible" });
  await capture(page, "export", exportDialog);
  await page.getByRole("button", { name: "Close export" }).click();

  await page.getByRole("button", { name: "Build", exact: true }).click();
  await page.locator(".adaptive-workspace[data-workspace='build']").waitFor();
  await page.getByRole("button", { name: "Recipes", exact: true }).click();
  await page.getByTestId("recipe-gallery").waitFor({ state: "visible" });
  await capture(page, "recipes", page.getByRole("dialog", { name: "Recipe Gallery" }));
  await page.getByRole("button", { name: "Close Recipe Gallery", exact: true }).click();

  const projectLensResizer = page.getByRole("separator", { name: "Resize Project lens", exact: true });
  for (let index = 0; index < 3; index += 1) {
    await projectLensResizer.press("Shift+ArrowLeft");
  }
  await settle(page);
  if (await projectLensResizer.getAttribute("aria-valuenow") !== "400") {
    throw new Error("Release capture could not widen the Inspector atlas to the supported Project lens maximum.");
  }
  const documentCanvas = page.getByTestId("document-canvas");
  const renderedNodes = documentCanvas.locator("[data-node-id]");
  await waitForGraphNodeCount(page, inspectorNodes.length, 15_000);
  await documentCanvas.getByRole("button", { name: "Fit View", exact: true }).click();
  await settle(page);
  await waitForLocatorCount(renderedNodes, inspectorNodes.length, 15_000);
  await capture(page, "inspector-catalog", documentCanvas);
  const firstFixtureEdge = page.getByTestId("edge-role-chip").first();
  const roleButton = firstFixtureEdge.locator(":scope > button.ether-edge-role-chip");
  await roleButton.waitFor({ state: "visible" });
  const roleName = (await roleButton.textContent())?.trim();
  if (roleName !== "Subject") {
    throw new Error(`First generated fixture edge exposed role ${roleName}, expected Subject.`);
  }
  await roleButton.click();
  const roleGrid = firstFixtureEdge.getByTestId("edge-role-grid");
  await roleGrid.waitFor({ state: "visible" });
  await capture(page, "channels-roles", page.locator("body"));
  await roleButton.click();
  await roleGrid.waitFor({ state: "hidden" });

  for (const [slug, nodeId, expectedTitle] of inspectorNodes) {
    const node = page.locator(`[data-node-id="${nodeId}"]`);
    await node.click();
    const inspector = page.getByTestId("node-inspector");
    await inspector.waitFor({ state: "visible" });
    const inspectorTitle = page
      .getByTestId("pane-inspector")
      .getByRole("textbox", { name: "Title", exact: true });
    await inspectorTitle.waitFor({ state: "visible" });
    await waitForInputValue(inspectorTitle, expectedTitle, 10_000);
    const paneContent = page
      .getByTestId("pane-inspector")
      .locator(".resizable-pane-content");
    await waitForLocatorCount(paneContent, 1, 5_000);
    await paneContent.evaluate((element) => {
      element.scrollTop = 0;
    });
    await capture(page, `inspector-${slug}`, page.getByTestId("pane-inspector"));
  }

  await page.locator('[data-node-id="manual-canvas-drawing"]').click();
  const titleInput = page
    .getByTestId("pane-inspector")
    .getByRole("textbox", { name: "Title", exact: true });
  await waitForInputValue(titleInput, "Drawing", 10_000);
  await titleInput.fill("Drawing - release verified");
  await titleInput.press("Enter");
  await waitForGraphNodeTitle(
    page,
    "manual-canvas-drawing",
    "Drawing - release verified",
    15_000
  );
  await page.getByTestId("project-header").getByText("Saved", { exact: true })
    .waitFor({ state: "visible", timeout: 15_000 });
  await capture(page, "saving", page.locator("body"));

  await page.getByRole("button", { name: "Provider Health", exact: true }).click();
  const providerHealthDialog = page.getByRole("dialog", { name: "Provider Health" });
  await providerHealthDialog.waitFor({ state: "visible" });
  await waitForProviderHealthResolved(page, providerHealthDialog, 30_000);
  await capture(page, "provider-health", providerHealthDialog);
  await page.getByRole("button", { name: "Close Provider Health" }).click();

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const settingsDialog = page.getByRole("dialog", { name: "Settings" });
  await settingsDialog.waitFor({ state: "visible" });
  await page.getByTestId("about-ether").getByText("4.0.0", { exact: true })
    .waitFor({ state: "visible", timeout: 10_000 });
  const recoveryStatus = page.getByTestId("release-recovery-status");
  await recoveryStatus.getByText("healthy", { exact: true })
    .waitFor({ state: "visible", timeout: 20_000 });
  const antigravitySafety = settingsDialog.locator(
    'section[aria-labelledby="provider-safety-settings"]'
  );
  const overageConfirmation = antigravitySafety.getByRole("checkbox", {
    name: "Confirm Antigravity AI Credit Overages is Never",
    exact: true
  });
  await antigravitySafety.getByText(
    "All Antigravity profiles are disabled. Codex remains available independently.",
    { exact: true }
  ).waitFor({ state: "visible", timeout: 20_000 });
  if (await overageConfirmation.isChecked()) {
    throw new Error("Fresh release capture profile persisted an unexpected Antigravity overage confirmation.");
  }
  const geminiSettings = settingsDialog.getByTestId("gemini-api-settings");
  await geminiSettings.getByText("Primary Nano Banana route — paid Google Gemini Developer API.", { exact: true })
    .waitFor({ state: "visible", timeout: 20_000 });
  await geminiSettings.getByRole("button", { name: "Connect", exact: true }).waitFor({ state: "visible" });
  await geminiSettings.scrollIntoViewIfNeeded();
  await capture(page, "settings", settingsDialog);
  await capture(page, "recovery", recoveryStatus);
  await page.getByRole("button", { name: "Close Settings" }).click();

  const adapter = createLocalBridgeApplicationAdapter({ descriptorPath });
  const nativeProcessIds = [...await processIdsFor(installedExecutable)].sort((left, right) => left - right);
  await assertExactExecutableProcessSet(nativeProcessIds, installedExecutable);
  const installedMainProcessId = appProcess.pid;
  if (
    !Number.isInteger(installedMainProcessId) ||
    installedMainProcessId <= 0 ||
    !nativeProcessIds.includes(installedMainProcessId)
  ) {
    throw new Error("The captured main-process inspector is not owned by the exact installed Ether.exe set.");
  }
  await invokeCaptureMenuAction(
    mainInspectorEndpoint,
    "editPermit",
    installedExecutable,
    installedMainProcessId
  );
  await captureNativeDialog({
    processIds: nativeProcessIds,
    title: "Allow Codex to edit?",
    label: "plugin-edit-permit",
    acceptButton: "Grant Edit Permit",
    completionTitle: "Codex edit access granted"
  });
  const editPermits = await adapter.inspectPermits();
  if (!editPermits.some((permit) => permit.permission === "edit" && permit.state === "active")) {
    throw new Error("The native Edit Permit dialog did not produce an active desktop permit.");
  }
  const preview = await applicationCommand(adapter, "run.preview", {
    graphId: "manual-release-graph",
    scope: { kind: "node", nodeId: "manual-edit-transform" }
  });
  const plan = requireRecord(preview.plan, "MCP run preview plan");
  const planId = requireString(plan.id, "MCP run preview plan ID");
  const contentHash = requireString(plan.contentHash, "MCP run preview content hash");
  assertLocalPermitPlan(plan, "manual-edit-transform");
  await invokeCaptureMenuAction(
    mainInspectorEndpoint,
    "runPermit",
    installedExecutable,
    installedMainProcessId
  );
  await captureNativeDialog({
    processIds: nativeProcessIds,
    title: "Approve Codex run plan?",
    label: "plugin-run-permit",
    acceptButton: "Approve Exact Plan",
    completionTitle: "Codex run plan approved"
  });
  const permits = await adapter.inspectPermits();
  if (!permits.some((permit) => permit.permission === "edit" && permit.state === "active")) {
    throw new Error("The active desktop Edit Permit disappeared before release evidence completed.");
  }
  if (!permits.some((permit) =>
    permit.permission === "run" &&
    permit.state === "active" &&
    permit.planId === planId &&
    permit.contentHash === contentHash
  )) {
    throw new Error("The native Run Permit dialog did not bind a permit to the exact previewed plan.");
  }
  const permitEvidence = {
    editPermit: "active",
    runPermit: "active-exact-plan",
    planId,
    contentHash
  };

  for (const label of labels) await access(path.join(captureOutput, `${label}.png`));
  const captures = [];
  for (const label of labels) {
    const bytes = await readFile(path.join(captureOutput, `${label}.png`));
    const dimensions = pngDimensions(bytes);
    if (dimensions.width < 300 || dimensions.height < 100) {
      throw new Error(`Capture ${label} is implausibly small at ${dimensions.width}x${dimensions.height}.`);
    }
    captures.push({
      label,
      ...dimensions,
      sha256: sha256(bytes)
    });
  }
  const [installerBytes, executableBytes, fixtureBytes] = await Promise.all([
    readFile(installer),
    readFile(installedExecutable),
    readFile(fixturePath)
  ]);
  await writeFile(path.join(captureOutput, "manifest.json"), `${JSON.stringify({
    version: "4.0.0",
    source: "installed-packaged-exe",
    sourceProfile: "disposable-scoped-profile",
    installer: {
      fileName: path.basename(installer),
      sha256: sha256(installerBytes)
    },
    executable: {
      fileName: path.basename(installedExecutable),
      sha256: sha256(executableBytes)
    },
    fixture: {
      fileName: path.basename(fixturePath),
      graphId: "manual-release-graph",
      nodeCount: 17,
      referenceCount: 1,
      sha256: sha256(fixtureBytes)
    },
    permitEvidence,
    capturedAt: new Date().toISOString(),
    labels,
    captures
  }, null, 2)}\n`);
  captureReady = true;
} finally {
  await finalizeCaptureCleanup();
}

process.stdout.write(
  `Captured ${labels.length} installed Ether 4.0.0 release views to ${path.relative(root, publishedOutput)}.\n`
);

async function finalizeCaptureCleanup() {
  const cleanupFailures = [];
  try {
    await browser?.close();
  } catch (error) {
    cleanupFailures.push(error);
  }
  try {
    if (appProcess?.pid) await stopProcessTree(appProcess.pid);
    await stopAdditionalProcesses(installedExecutable, existingProcessIds);
    await waitForNoAdditionalProcesses(installedExecutable, existingProcessIds, 15_000);
    await assertNoAdditionalProcesses(installedExecutable, existingProcessIds);
    await stopProcessesUnder(installRoot);
    await waitForNoProcessesUnder(installRoot, 15_000);
    await assertNoProcessesUnder(installRoot);
  } catch (error) {
    cleanupFailures.push(error);
  }
  try {
    const uninstaller = path.join(installRoot, "Uninstall Ether.exe");
    const uninstallerPresent = await fileExists(uninstaller);
    if (uninstallerPresent) {
      await execFileAsync(uninstaller, ["/S"], {
        cwd: runDirectory,
        env: environment,
        windowsHide: true,
        timeout: 90_000
      });
      await waitForNoProcessesUnder(installRoot, 15_000);
      await waitForEmptyInstallRoot(installRoot, 30_000);
      await assertInstallRootEmptyAndRemove(installRoot, 30_000);
    }
    if ((installerCompleted || uninstallerPresent) && await pathExists(installRoot)) {
      throw new Error("Ether uninstall left residual installed payload in the disposable install root.");
    }
    if (installerCompleted || uninstallerPresent) {
      await waitForExtensionAssociationRemoval(15_000);
      await waitForRegistryKeysMissing(
        [...associationResidueKeys, ...installRegistrationKeys],
        15_000
      );
      if (await extensionAssociationPointsToEther()) {
        throw new Error("Ether uninstall left the .ether extension associated with DreamBay Ether.");
      }
      for (const key of [...associationResidueKeys, ...installRegistrationKeys]) {
        if (await registryKeyExists(key)) {
          throw new Error(`Ether uninstall left residual registry key ${key}.`);
        }
      }
      for (const shortcut of shortcutBackups) {
        await waitForMissing(shortcut.path, 10_000);
      }
    }
    if (installationAttempted && !uninstallerPresent && await pathExists(installRoot)) {
      throw new Error("The interrupted Ether installer left payload without a standard uninstaller.");
    }
  } catch (error) {
    cleanupFailures.push(error);
  }
  try {
    await restoreRegistryTrees(registryBackups);
    await restoreShortcuts(shortcutBackups);
  } catch (error) {
    cleanupFailures.push(error);
  }
  if (captureReady && cleanupFailures.length === 0) {
    try {
      await publishAcceptedCaptures(captureOutput, publishedOutput);
    } catch (error) {
      cleanupFailures.push(error);
    }
  }
  try {
    assertScoped(scratchParent, scratch);
    await rm(scratch, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  } catch (error) {
    cleanupFailures.push(error);
  }
  if (cleanupFailures.length > 0) {
    throw new AggregateError(cleanupFailures, "Installed release capture cleanup did not complete safely.");
  }
}

async function capture(page, label, locator) {
  const visibleLocator = locator.filter({ visible: true });
  if (await visibleLocator.count() !== 1) {
    throw new Error(`Installed release surface '${label}' must resolve to exactly one visible target.`);
  }
  await visibleLocator.waitFor({ state: "visible", timeout: 20_000 });
  await settle(page);
  await visibleLocator.screenshot({
    path: path.join(captureOutput, `${label}.png`),
    animations: "disabled"
  });
}

async function captureExpandedScrollable(page, label, locator) {
  const visibleLocator = locator.filter({ visible: true });
  if (await visibleLocator.count() !== 1) {
    throw new Error(`Installed release surface '${label}' must resolve to exactly one visible target.`);
  }
  await visibleLocator.waitFor({ state: "visible", timeout: 20_000 });
  await settle(page);
  const originalStyles = await visibleLocator.evaluate((element) => {
    if (!(element instanceof globalThis.HTMLElement)) {
      throw new Error("Expanded release capture target is not an HTML element.");
    }
    const styles = [];
    let current = element;
    while (current instanceof globalThis.HTMLElement) {
      styles.push(current.getAttribute("style"));
      current.style.overflow = "visible";
      current.style.maxHeight = "none";
      if (
        current === element ||
        current.classList.contains("resizable-pane-content") ||
        current.classList.contains("resizable-pane") ||
        current.classList.contains("adaptive-workspace") ||
        current.classList.contains("ether-shell") ||
        current === globalThis.document.body ||
        current === globalThis.document.documentElement
      ) {
        current.style.height = "auto";
      }
      if (current.classList.contains("adaptive-workspace")) {
        current.style.gridTemplateRows = "24px auto auto 32px";
      }
      current = current.parentElement;
    }
    element.style.height = `${element.scrollHeight}px`;
    return styles;
  });
  try {
    await settle(page);
    const dimensions = await visibleLocator.evaluate((element) => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight
    }));
    if (
      dimensions.clientHeight < 300 ||
      dimensions.clientHeight < dimensions.scrollHeight
    ) {
      throw new Error(
        `Installed release surface '${label}' did not expand to its full scroll content ` +
        `(${dimensions.clientHeight}/${dimensions.scrollHeight}).`
      );
    }
    await visibleLocator.screenshot({
      path: path.join(captureOutput, `${label}.png`),
      animations: "disabled"
    });
  } finally {
    await visibleLocator.evaluate((element, styles) => {
      let current = element;
      let index = 0;
      while (current instanceof globalThis.HTMLElement && index < styles.length) {
        const originalStyle = styles[index];
        if (originalStyle === null) current.removeAttribute("style");
        else current.setAttribute("style", originalStyle);
        current = current.parentElement;
        index += 1;
      }
      if (index !== styles.length) {
        throw new Error("Expanded release capture could not restore its exact style scope.");
      }
    }, originalStyles);
  }
}

async function publishAcceptedCaptures(source, destination) {
  const parent = path.dirname(destination);
  const token = randomUUID();
  const staging = path.join(parent, `.ether-4.0-publish-${token}`);
  const backup = path.join(parent, `.ether-4.0-backup-${token}`);
  await mkdir(parent, { recursive: true });
  await cp(source, staging, { recursive: true });
  let previousMoved = false;
  try {
    if (await pathExists(destination)) {
      await rename(destination, backup);
      previousMoved = true;
    }
    await rename(staging, destination);
  } catch (error) {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined);
    if (previousMoved && !await pathExists(destination)) {
      await rename(backup, destination);
    }
    throw error;
  }
  if (previousMoved) {
    await rm(backup, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function captureNativeDialog({
  processIds,
  title,
  label,
  acceptButton,
  completionTitle
}) {
  if (
    !Array.isArray(processIds) ||
    processIds.length === 0 ||
    processIds.some((processId) => !Number.isInteger(processId) || processId <= 0) ||
    new Set(processIds).size !== processIds.length
  ) {
    throw new Error("Installed Ether process inventory is unavailable or invalid.");
  }
  await execFileAsync("powershell.exe", [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    nativeDialogHelper,
    "-ProcessIds",
    processIds.join(","),
    "-ExecutablePath",
    installedExecutable,
    "-MainWindowTitle",
    "Ether",
    "-DialogTitle",
    title,
    "-OutputPath",
    path.join(captureOutput, `${label}.png`),
    "-AcceptButton",
    acceptButton,
    "-CompletionTitle",
    completionTitle
  ], {
    cwd: runDirectory,
    env: environment,
    windowsHide: true,
    timeout: 30_000
  });
}

async function settle(page) {
  await page.evaluate(() => globalThis.document.fonts.ready);
  await page.waitForTimeout(250);
}

async function waitForLocatorCount(locator, expectedCount, timeout) {
  const startedAt = Date.now();
  let actualCount = -1;
  while (Date.now() - startedAt < timeout) {
    actualCount = await locator.count();
    if (actualCount === expectedCount) return;
    await delay(50);
  }
  throw new Error(`Expected ${expectedCount} matching release elements, found ${actualCount}.`);
}

async function waitForInputValue(locator, expectedValue, timeout) {
  const startedAt = Date.now();
  let actualValue = "";
  while (Date.now() - startedAt < timeout) {
    actualValue = await locator.inputValue().catch(() => "");
    if (actualValue === expectedValue) return;
    await delay(50);
  }
  throw new Error(`Expected Inspector title ${expectedValue}, found ${actualValue}.`);
}

async function waitForGraphNodeTitle(page, nodeId, expectedTitle, timeout) {
  const startedAt = Date.now();
  let actualTitle = "";
  while (Date.now() - startedAt < timeout) {
    actualTitle = await page.evaluate(async ({ id }) => {
      const document = await globalThis.window.ether.document.bootstrap();
      const snapshot = await globalThis.window.ether.graph.snapshot(document.documentId);
      return snapshot.graph.nodes.find((node) => node.id === id)?.title ?? "";
    }, { id: nodeId });
    if (actualTitle === expectedTitle) return;
    await delay(50);
  }
  throw new Error(
    `Installed graph kept node ${nodeId} title ${actualTitle}, expected ${expectedTitle}.`
  );
}

async function waitForGraphNodeCount(page, expectedCount, timeout) {
  const startedAt = Date.now();
  let actualCount = 0;
  while (Date.now() - startedAt < timeout) {
    actualCount = await page.evaluate(async () => {
      const document = await globalThis.window.ether.document.bootstrap();
      const snapshot = await globalThis.window.ether.graph.snapshot(document.documentId);
      return snapshot.graph.nodes.length;
    });
    if (actualCount === expectedCount) return;
    await delay(50);
  }
  throw new Error(
    `Installed graph contained ${actualCount} nodes, expected ${expectedCount}.`
  );
}

async function waitForProviderHealthResolved(page, dialog, timeout) {
  await dialog.getByRole("button", { name: "Check again", exact: true })
    .waitFor({ state: "visible", timeout });
  const alert = dialog.getByRole("alert");
  if (await alert.isVisible().catch(() => false)) {
    const alertText = (await alert.textContent())?.trim() ?? "<empty alert>";
    const probeResults = await diagnoseProviderHealthQueries(page);
    const failures = probeResults
      .filter((result) => !result.ok)
      .map((result) => `${result.name}: ${result.error}`)
      .join("; ");
    throw new Error(
      `Provider Health resolved to alert "${alertText}". ` +
      (failures || "All three direct read-only probes succeeded after the UI failure.")
    );
  }
  const metrics = dialog.locator(".provider-health-summary .status-metric");
  const runtime = metrics.filter({ hasText: "Runtime" }).locator("strong");
  const transport = metrics.filter({ hasText: "Transport" }).locator("strong");
  const verifiedProfiles = metrics.filter({ hasText: "Verified profiles" }).locator("strong");
  const checked = metrics.filter({ hasText: "Checked" }).locator("strong");
  await Promise.all([
    waitForLocatorTextOutside(runtime, new Set(["Checking", "Unknown"]), timeout),
    waitForLocatorTextOutside(checked, new Set(["Pending"]), timeout),
    dialog.getByText("No telemetry leaves this machine.", { exact: false })
      .waitFor({ state: "visible", timeout })
  ]);
  const resolved = {
    runtime: (await runtime.textContent())?.trim() ?? "",
    transport: (await transport.textContent())?.trim() ?? "",
    verifiedProfiles: (await verifiedProfiles.textContent())?.trim() ?? ""
  };
  if (
    !["Available", "Degraded", "Unavailable"].includes(resolved.runtime) ||
    !resolved.transport ||
    !/^\d+$/u.test(resolved.verifiedProfiles)
  ) {
    throw new Error(
      "Installed Provider Health did not resolve to a truthful local provider state: " +
      JSON.stringify(resolved)
    );
  }
}

async function diagnoseProviderHealthQueries(page) {
  return page.evaluate(async () => {
    const document = await globalThis.window.ether.document.bootstrap();
    const query = (name) => globalThis.window.ether.application.query({
      kind: "query",
      id: globalThis.crypto.randomUUID(),
      correlationId: globalThis.crypto.randomUUID(),
      documentId: document.documentId,
      name,
      payload: {}
    });
    const probes = [
      ["runtime.providerHealth", () => globalThis.window.ether.runtime.providerHealth()],
      ["provider.health", () => query("provider.health")],
      ["provider.capabilities", () => query("provider.capabilities")]
    ];
    const results = [];
    for (const [name, probe] of probes) {
      try {
        await probe();
        results.push({ name, ok: true, error: null });
      } catch (error) {
        results.push({
          name,
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
    return results;
  });
}

async function waitForLocatorTextOutside(locator, rejectedValues, timeout) {
  const startedAt = Date.now();
  let actualValue = "";
  while (Date.now() - startedAt < timeout) {
    actualValue = (await locator.textContent().catch(() => ""))?.trim() ?? "";
    if (actualValue.length > 0 && !rejectedValues.has(actualValue)) return;
    await delay(50);
  }
  throw new Error(`Release evidence remained unresolved at ${actualValue || "<empty>"}.`);
}

function assertLocalPermitPlan(plan, nodeId) {
  if (plan.estimatedCalls !== 0) {
    throw new Error(`Local permit plan estimated ${String(plan.estimatedCalls)} provider calls.`);
  }
  if (!Array.isArray(plan.steps)) {
    throw new Error("Local permit plan did not expose validated steps.");
  }
  const step = plan.steps
    .map((candidate, index) => requireRecord(candidate, `MCP run preview step ${index}`))
    .find((candidate) => candidate.nodeId === nodeId);
  if (step === undefined || step.executor !== "transform" || step.providerBinding !== null) {
    throw new Error(`Local permit plan did not bind provider-free Transform node ${nodeId}.`);
  }
}

function assertPackagedRenderer(url) {
  if (!url.startsWith("file://")) {
    throw new Error(`Capture refused non-packaged renderer URL: ${url}`);
  }
  if (/localhost|127\.0\.0\.1|vite/iu.test(url)) {
    throw new Error(`Capture refused development renderer URL: ${url}`);
  }
}

function assertScoped(parent, candidate) {
  const relative = path.relative(parent, candidate);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Release capture path is outside its disposable root: ${candidate}`);
  }
}

function createMainInspectorWatcher() {
  let pending = "";
  let endpoint = null;
  let failure = null;
  const inspectLine = (line) => {
    if (!line.includes("Debugger listening on")) return;
    const match = /^Debugger listening on (ws:\/\/\S+)\s*$/u.exec(line.trim());
    if (match === null) {
      failure = new Error("Installed Ether emitted a malformed main-process inspector endpoint.");
      return;
    }
    try {
      const candidate = validateMainInspectorEndpoint(match[1]);
      if (endpoint !== null && endpoint !== candidate) {
        failure = new Error("Installed Ether emitted more than one main-process inspector endpoint.");
        return;
      }
      endpoint = candidate;
    } catch (error) {
      failure = error;
    }
  };
  return {
    accept(chunk) {
      if (failure !== null) return;
      pending += chunk.toString();
      if (pending.length > 16_384) {
        failure = new Error("Installed Ether inspector diagnostics exceeded the bounded line buffer.");
        return;
      }
      const lines = pending.split(/\r?\n/u);
      pending = lines.pop() ?? "";
      for (const line of lines) inspectLine(line);
    },
    state() {
      return { endpoint, failure };
    }
  };
}

function validateMainInspectorEndpoint(value) {
  let endpoint;
  try {
    endpoint = new URL(value);
  } catch (error) {
    throw new Error("Installed Ether emitted an invalid main-process inspector URL.", { cause: error });
  }
  if (
    endpoint.protocol !== "ws:" ||
    endpoint.hostname !== "127.0.0.1" ||
    endpoint.username !== "" ||
    endpoint.password !== "" ||
    endpoint.search !== "" ||
    endpoint.hash !== "" ||
    !/^\/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu.test(endpoint.pathname)
  ) {
    throw new Error("Installed Ether main-process inspector must use an uncredentialed loopback UUID endpoint.");
  }
  const port = Number(endpoint.port);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error("Installed Ether main-process inspector emitted an invalid ephemeral port.");
  }
  return endpoint.href;
}

async function waitForMainInspectorEndpoint(watcher, child, timeout) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const { endpoint, failure } = watcher.state();
    if (failure !== null) throw failure;
    if (endpoint !== null) return endpoint;
    if (child.exitCode !== null) {
      throw new Error(
        `Installed Ether exited before exposing its loopback main-process inspector (${child.exitCode}).`
      );
    }
    await delay(25);
  }
  throw new Error("Installed Ether did not expose its ephemeral loopback main-process inspector.");
}

function createRedactedStderrDiagnostics() {
  let committed = "";
  let pending = "";
  const redact = (line) => {
    if (line.includes("Debugger listening on")) {
      return "Debugger listening on [ephemeral loopback main inspector]";
    }
    return line.replace(/\bws:\/\/\S+/gu, "[redacted WebSocket endpoint]");
  };
  return {
    accept(chunk) {
      pending += chunk.toString();
      const lines = pending.split(/\r?\n/u);
      pending = lines.pop() ?? "";
      for (const line of lines) {
        committed = appendDiagnostic(committed, `${redact(line)}\n`);
      }
      if (pending.length > 16_384) pending = pending.slice(-16_384);
    },
    snapshot() {
      return appendDiagnostic(committed, redact(pending));
    }
  };
}

async function invokeCaptureMenuAction(endpoint, actionName, expectedExecutable, expectedProcessId) {
  if (!Object.hasOwn(captureMenuActions, actionName)) {
    throw new Error("Release capture requested an unsupported fixed menu action.");
  }
  if (!Number.isInteger(expectedProcessId) || expectedProcessId <= 0) {
    throw new Error("Release capture requires the exact installed main-process ID.");
  }
  const action = captureMenuActions[actionName];
  const inspectorEndpoint = validateMainInspectorEndpoint(endpoint);
  if (typeof globalThis.WebSocket !== "function") {
    throw new Error("The release capture runtime does not provide a WebSocket client.");
  }
  const socket = new globalThis.WebSocket(inspectorEndpoint);
  let evidence;
  try {
    await waitForInspectorSocketOpen(socket, 5_000);
    const response = await sendInspectorRequest(socket, {
      id: 1,
      method: "Runtime.evaluate",
      params: {
        expression: fixedMenuInvocationExpression(
          action,
          expectedExecutable,
          expectedProcessId
        ),
        awaitPromise: true,
        includeCommandLineAPI: true,
        returnByValue: true
      }
    }, 10_000);
    if (response.error !== undefined) {
      throw new Error(`Main-process inspector refused the fixed menu action: ${response.error.message}.`);
    }
    if (response.result?.exceptionDetails !== undefined) {
      const description = response.result.exceptionDetails.exception?.description ??
        response.result.exceptionDetails.text ??
        "unknown main-process exception";
      throw new Error(`Fixed packaged menu action failed: ${description}.`);
    }
    evidence = response.result?.result?.value;
    if (
      evidence?.id !== action.id ||
      evidence?.normalizedLabel !== action.normalizedLabel ||
      evidence?.enabled !== true ||
      evidence?.clickHandler !== true ||
      evidence?.isPackaged !== true ||
      evidence?.processId !== expectedProcessId ||
      !sameWindowsPath(evidence?.executablePath, expectedExecutable)
    ) {
      throw new Error("Fixed packaged menu action returned mismatched validation evidence.");
    }
  } finally {
    await closeInspectorSocket(socket, 3_000);
  }
  return evidence;
}

function fixedMenuInvocationExpression(action, expectedExecutable, expectedProcessId) {
  const expected = JSON.stringify({
    executablePath: path.win32.normalize(expectedExecutable),
    id: action.id,
    normalizedLabel: action.normalizedLabel,
    processId: expectedProcessId
  });
  return `(() => {
    const { createRequire } = process.getBuiltinModule("node:module");
    const { app, BrowserWindow, Menu } = createRequire(process.execPath)("electron");
    const nodePath = process.getBuiltinModule("node:path");
    const expected = ${expected};
    const normalizePath = (value) =>
      nodePath.win32.normalize(String(value)).toLocaleLowerCase("en-US");
    if (app.isPackaged !== true) throw new Error("Capture menu action refused a non-packaged app.");
    if (process.pid !== expected.processId) {
      throw new Error("Capture menu action refused a different main process.");
    }
    if (normalizePath(process.execPath) !== normalizePath(expected.executablePath)) {
      throw new Error("Capture menu action refused a different executable path.");
    }
    const menu = Menu.getApplicationMenu();
    const item = menu?.getMenuItemById(expected.id);
    if (item === undefined || item.id !== expected.id) {
      throw new Error("Capture menu action could not resolve the exact registered item.");
    }
    const normalizedLabel = String(item.label)
      .replaceAll("&", "")
      .replace(/(?:\\u2026|\\.{3})$/u, "")
      .trim();
    if (normalizedLabel !== expected.normalizedLabel) {
      throw new Error("Capture menu action refused a changed item label.");
    }
    if (item.enabled !== true || typeof item.click !== "function") {
      throw new Error("Capture menu action refused a disabled or non-clickable item.");
    }
    const browserWindow = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    item.click(item, browserWindow, { triggeredByAccelerator: false });
    return {
      clickHandler: true,
      enabled: item.enabled,
      executablePath: process.execPath,
      id: item.id,
      isPackaged: app.isPackaged,
      normalizedLabel,
      processId: process.pid
    };
  })()`;
}

function sameWindowsPath(left, right) {
  return typeof left === "string" &&
    path.win32.normalize(left).toLocaleLowerCase("en-US") ===
      path.win32.normalize(right).toLocaleLowerCase("en-US");
}

function waitForInspectorSocketOpen(socket, timeout) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error("Timed out opening the main-process inspector socket.")), timeout);
    const onOpen = () => finish();
    const onError = () => finish(new Error("Could not open the main-process inspector socket."));
    const onClose = () => finish(new Error("Main-process inspector closed before the fixed action."));
    const finish = (error) => {
      clearTimeout(timer);
      socket.removeEventListener("open", onOpen);
      socket.removeEventListener("error", onError);
      socket.removeEventListener("close", onClose);
      if (error === undefined) resolve();
      else reject(error);
    };
    socket.addEventListener("open", onOpen);
    socket.addEventListener("error", onError);
    socket.addEventListener("close", onClose);
  });
}

function sendInspectorRequest(socket, request, timeout) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => finish(new Error("Timed out waiting for the fixed main-process menu action.")),
      timeout
    );
    const onMessage = (event) => {
      if (typeof event.data !== "string") {
        finish(new Error("Main-process inspector returned a non-text response."));
        return;
      }
      let message;
      try {
        message = JSON.parse(event.data);
      } catch (error) {
        finish(new Error("Main-process inspector returned invalid JSON.", { cause: error }));
        return;
      }
      if (message.id === request.id) finish(undefined, message);
    };
    const onError = () => finish(new Error("Main-process inspector failed during the fixed action."));
    const onClose = () => finish(new Error("Main-process inspector closed during the fixed action."));
    const finish = (error, value) => {
      clearTimeout(timer);
      socket.removeEventListener("message", onMessage);
      socket.removeEventListener("error", onError);
      socket.removeEventListener("close", onClose);
      if (error === undefined) resolve(value);
      else reject(error);
    };
    socket.addEventListener("message", onMessage);
    socket.addEventListener("error", onError);
    socket.addEventListener("close", onClose);
    socket.send(JSON.stringify(request));
  });
}

function closeInspectorSocket(socket, timeout) {
  if (socket.readyState === 3) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => finish(new Error("Main-process inspector socket did not close before native capture.")),
      timeout
    );
    const onClose = () => finish();
    const onError = () => finish(new Error("Main-process inspector socket failed while closing."));
    const finish = (error) => {
      clearTimeout(timer);
      socket.removeEventListener("close", onClose);
      socket.removeEventListener("error", onError);
      if (error === undefined) resolve();
      else reject(error);
    };
    socket.addEventListener("close", onClose);
    socket.addEventListener("error", onError);
    if (socket.readyState === 0 || socket.readyState === 1) socket.close(1000, "fixed capture action complete");
  });
}

async function connectToApp(port, child, diagnostics) {
  const endpoint = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(
        `Installed Ether exited before capture (${child.exitCode}). ` +
        `stderr: ${diagnostics.stderr || "(empty)"}; stdout: ${diagnostics.stdout || "(empty)"}`
      );
    }
    try {
      await getJson(`${endpoint}/json/version`);
      return await chromium.connectOverCDP(endpoint);
    } catch {
      await delay(250);
    }
  }
  throw new Error(
    `Installed Ether did not expose its packaged window over scoped CDP port ${port}. ` +
    `stderr: ${diagnostics.stderr || "(empty)"}; stdout: ${diagnostics.stdout || "(empty)"}`
  );
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => {
        if (response.statusCode === 200) {
          try { resolve(JSON.parse(body)); } catch (error) { reject(error); }
        } else {
          reject(new Error(`CDP returned ${response.statusCode ?? "no status"}.`));
        }
      });
    });
    request.once("error", reject);
    request.setTimeout(1_000, () => request.destroy(new Error("CDP request timed out.")));
  });
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function appendDiagnostic(current, chunk) {
  return `${current}${chunk.toString()}`.slice(-8_192).trim();
}

function availableLoopbackPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close(() => reject(new Error("Could not reserve a loopback CDP port.")));
        return;
      }
      const port = address.port;
      server.close((error) => error === undefined ? resolve(port) : reject(error));
    });
  });
}

async function waitForExit(child, timeout) {
  await Promise.race([
    new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", () => resolve());
    }),
    new Promise((_resolve, reject) => {
      setTimeout(() => reject(new Error("A second Ether launch did not forward to the primary instance.")), timeout);
    })
  ]);
}

async function runChecked(command, args, options) {
  const result = await execFileAsync(command, args, {
    ...options,
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024
  });
  return result.stdout;
}

function requireRecord(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} is missing from the installed desktop bridge response.`);
  }
  return value;
}

function requireString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} is missing from the installed desktop bridge response.`);
  }
  return value;
}

function pngDimensions(bytes) {
  if (bytes.length < 24 || bytes.subarray(1, 4).toString("ascii") !== "PNG") {
    throw new Error("Capture output is not a valid PNG.");
  }
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20)
  };
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function processIdsFor(executable) {
  const escaped = executable.replaceAll("'", "''");
  const { stdout } = await execFileAsync("powershell.exe", [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    `Get-CimInstance Win32_Process | Where-Object { [string]::Equals($_.ExecutablePath, '${escaped}', [System.StringComparison]::OrdinalIgnoreCase) } | ForEach-Object { $_.ProcessId }`
  ], { windowsHide: true });
  return parseProcessIds(stdout);
}

async function assertExactExecutableProcessSet(processIds, executable) {
  const liveProcessIds = await processIdsFor(executable);
  if (
    processIds.length === 0 ||
    processIds.some((processId) => processId <= 0 || !liveProcessIds.has(processId)) ||
    liveProcessIds.size !== processIds.length
  ) {
    throw new Error("Native capture process inventory is not the complete live installed Ether.exe set.");
  }
}

async function stopProcessTree(processId) {
  await execFileAsync("taskkill.exe", ["/PID", String(processId), "/T", "/F"], {
    windowsHide: true
  }).catch(() => undefined);
}

async function stopAdditionalProcesses(executable, existing) {
  const ids = [...await processIdsFor(executable)].filter((id) => !existing.has(id));
  for (const id of ids) await stopProcessTree(id);
}

async function assertNoAdditionalProcesses(executable, existing) {
  const residual = [...await processIdsFor(executable)].filter((id) => !existing.has(id));
  if (residual.length > 0) {
    throw new Error(`Installed Ether left residual process IDs: ${residual.join(", ")}.`);
  }
}

async function waitForNoAdditionalProcesses(executable, existing, timeout) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const residual = [...await processIdsFor(executable)].filter((id) => !existing.has(id));
    if (residual.length === 0) return;
    for (const id of residual) await stopProcessTree(id);
    await delay(100);
  }
  await assertNoAdditionalProcesses(executable, existing);
}

async function processIdsUnder(directory) {
  const escaped = directory.replaceAll("'", "''");
  const { stdout } = await execFileAsync("powershell.exe", [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    `$root = '${escaped}'.TrimEnd('\\') + '\\'; Get-CimInstance Win32_Process | Where-Object { $path = [string]$_.ExecutablePath; $path.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase) } | ForEach-Object { $_.ProcessId }`
  ], { windowsHide: true });
  return parseProcessIds(stdout);
}

function parseProcessIds(stdout) {
  return new Set(
    stdout
      .split(/\r?\n/u)
      .map((value) => value.trim())
      .filter((value) => value.length > 0)
      .map(Number)
      .filter((value) => Number.isInteger(value) && value > 0)
  );
}

async function stopProcessesUnder(directory) {
  for (const id of await processIdsUnder(directory)) await stopProcessTree(id);
}

async function assertNoProcessesUnder(directory) {
  const residual = [...await processIdsUnder(directory)];
  if (residual.length > 0) {
    throw new Error(`Ether left scoped child process IDs: ${residual.join(", ")}.`);
  }
}

async function waitForNoProcessesUnder(directory, timeout) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const residual = [...await processIdsUnder(directory)];
    if (residual.length === 0) return;
    for (const id of residual) await stopProcessTree(id);
    await delay(100);
  }
  await assertNoProcessesUnder(directory);
}

async function installRootInventory(directory) {
  if (!await pathExists(directory)) return [];
  return (await readdir(directory, { recursive: true }))
    .map((entry) => String(entry))
    .sort((left, right) => left.localeCompare(right));
}

async function waitForEmptyInstallRoot(directory, timeout) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if ((await installRootInventory(directory)).length === 0) return;
    await delay(100);
  }
  const residual = await installRootInventory(directory);
  throw new Error(
    `Ether uninstall left residual installed payload: ${residual.slice(0, 20).join(", ")}.`
  );
}

async function assertInstallRootEmptyAndRemove(directory, timeout) {
  const deadline = Date.now() + timeout;
  let lastError = null;
  while (Date.now() < deadline) {
    if (!await pathExists(directory)) return;
    const residual = await installRootInventory(directory);
    if (residual.length > 0) {
      throw new Error(
        `Ether uninstall left residual installed payload: ${residual.slice(0, 20).join(", ")}.`
      );
    }
    try {
      await rmdir(directory);
      return;
    } catch (error) {
      if (!["EBUSY", "EPERM"].includes(error?.code)) throw error;
      lastError = error;
      await delay(100);
    }
  }
  const residual = await installRootInventory(directory);
  if (residual.length > 0) {
    throw new Error(
      `Ether uninstall left residual installed payload: ${residual.slice(0, 20).join(", ")}.`
    );
  }
  throw lastError ?? new Error(`Timed out removing verified empty install root: ${directory}.`);
}

async function assertNoExistingEtherInstallation() {
  const existing = [];
  for (const key of installRegistrationKeys) {
    if (await registryKeyExists(key)) existing.push(key);
  }
  if (existing.length > 0) {
    throw new Error(
      "Refusing installed-release capture because a real per-user Ether installation is registered: " +
      `${existing.join(", ")}.`
    );
  }
}

async function backupRegistryTrees(directory) {
  return Promise.all(installerOwnedRegistryKeys.map(async (key, index) => {
    const filePath = path.join(directory, `registry-${index}.reg`);
    const snapshot = await registryTreeSnapshot(key);
    if (snapshot !== null) {
      await execFileAsync("reg.exe", ["export", key, filePath, "/y"], { windowsHide: true });
    }
    return { key, filePath, snapshot };
  }));
}

async function restoreRegistryTrees(backups) {
  for (const backup of backups) {
    await execFileAsync("reg.exe", ["delete", backup.key, "/f"], { windowsHide: true })
      .catch(() => undefined);
    if (backup.snapshot !== null) {
      await execFileAsync("reg.exe", ["import", backup.filePath], { windowsHide: true });
    }
  }
  for (const backup of backups) {
    const restored = await registryTreeSnapshot(backup.key);
    if (restored !== backup.snapshot) {
      throw new Error(`Installer-owned registry tree was not restored exactly: ${backup.key}.`);
    }
  }
}

async function registryTreeSnapshot(key) {
  try {
    const { stdout } = await execFileAsync("reg.exe", ["query", key, "/s"], {
      windowsHide: true
    });
    return stdout.replaceAll("\r\n", "\n").trim();
  } catch {
    return null;
  }
}

async function registryKeyExists(key) {
  try {
    await execFileAsync("reg.exe", ["query", key], { windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

async function extensionAssociationPointsToEther() {
  try {
    const { stdout } = await execFileAsync(
      "reg.exe",
      ["query", associationKeys[0], "/ve"],
      { windowsHide: true }
    );
    return /DreamBay\.Ether\.Document/iu.test(stdout);
  } catch {
    return false;
  }
}

async function waitForExtensionAssociationRemoval(timeout) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (!await extensionAssociationPointsToEther()) return;
    await delay(100);
  }
  throw new Error("Ether uninstall left the .ether extension associated with DreamBay Ether.");
}

async function waitForRegistryKeysMissing(keys, timeout) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const states = await Promise.all(keys.map(registryKeyExists));
    if (!states.some(Boolean)) return;
    await delay(100);
  }
  const states = await Promise.all(keys.map(registryKeyExists));
  const residual = keys.filter((_key, index) => states[index]);
  throw new Error(`Ether uninstall left residual registry keys: ${residual.join(", ")}.`);
}

async function backupShortcuts(directory, paths) {
  return Promise.all(paths.map(async (shortcutPath, index) => {
    const backupPath = path.join(directory, `shortcut-${index}.lnk`);
    const existed = await fileExists(shortcutPath);
    if (existed) await copyFile(shortcutPath, backupPath);
    return { backupPath, existed, path: shortcutPath };
  }));
}

async function restoreShortcuts(backups) {
  for (const backup of backups) {
    await rm(backup.path, { force: true });
    if (!backup.existed) continue;
    await mkdir(path.dirname(backup.path), { recursive: true });
    await copyFile(backup.backupPath, backup.path);
  }
}

async function fileExists(filePath) {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

async function pathExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function waitForMissing(target, timeout) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (!await pathExists(target)) return;
    await delay(100);
  }
  throw new Error(`Timed out waiting for uninstall cleanup: ${target}`);
}
