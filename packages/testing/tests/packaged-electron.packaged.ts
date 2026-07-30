import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createSocket, type Socket as DatagramSocket } from "node:dgram";
import { copyFile, lstat, mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { createServer, type Server as HttpServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { chromium, expect, test, type Browser, type Page } from "@playwright/test";
import { FakeImageProvider } from "@ether/providers";

import { DesktopApplicationService } from "../../../apps/desktop/src/main/services/applicationService.js";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const installer = path.join(root, "release", "windows", "Ether-4.0.0-Setup.exe");
const installedExecutable = (installRoot: string) => path.join(installRoot, "Ether.exe");
const associationKeys = ["HKCU\\Software\\Classes\\.ether", "HKCU\\Software\\Classes\\DreamBay.Ether.Document"];
const installRegistrationKeys = [
  "HKCU\\Software\\ad6cd9b2-3723-5b60-a3d0-3938212aac8e",
  "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\ad6cd9b2-3723-5b60-a3d0-3938212aac8e"
];
const installerOwnedRegistryKeys = [...associationKeys, ...installRegistrationKeys];

test.skip(process.platform !== "win32", "Windows installer acceptance is Windows-only.");

test("NSIS installs a self-contained per-user Ether candidate and preserves user documents through uninstall", async () => {
  test.setTimeout(180_000);
  await expect(fileExists(installer)).resolves.toBe(true);
  await assertNoExistingEtherInstallation();
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "ether-installer-acceptance-"));
  const installRoot = path.join(temporaryRoot, "Ether");
  const appData = path.join(temporaryRoot, "AppData", "Roaming");
  const localAppData = path.join(temporaryRoot, "AppData", "Local");
  const userProfile = path.join(temporaryRoot, "UserProfile");
  const userDataDirectory = path.join(appData, "ether-desktop-release");
  const installedShortcutPaths = [
    path.join(userProfile, "Desktop", "Ether.lnk"),
    path.join(userProfile, "AppData", "Roaming", "Microsoft", "Windows", "Start Menu", "Programs", "Ether.lnk")
  ];
  const runDirectory = path.join(temporaryRoot, "Disposable CWD");
  const exportRoot = path.join(temporaryRoot, "User exports");
  const exportFile = path.join(exportRoot, "Keep export.txt");
  const appDataMarker = path.join(appData, "ether-desktop-release", "Keep AppData.txt");
  const userDataMarker = path.join(userDataDirectory, "Keep User Data.txt");
  const userDocument = path.join(temporaryRoot, "Keep me.ether");
  const directLaunchDocument = path.join(temporaryRoot, "Second launch.ether");
  const shellOpenDocument = path.join(temporaryRoot, "Explorer open.ether");
  const registryBackups = await backupRegistryTrees(temporaryRoot);
  const shortcutBackups = await backupShortcuts(temporaryRoot);
  let browser: Browser | null = null;
  let networkSentinel: Awaited<ReturnType<typeof startNetworkSentinel>> | null = null;
  const preexistingProcessIds = await processIdsFor(installedExecutable(installRoot));

  // Guard the only destructive operation in this test: all install and profile
  // paths must remain beneath the disposable directory created above.
  expect(isWithin(temporaryRoot, installRoot)).toBe(true);
  expect(isWithin(temporaryRoot, appData)).toBe(true);
  expect(isWithin(temporaryRoot, localAppData)).toBe(true);
  expect(isWithin(temporaryRoot, userProfile)).toBe(true);
  expect(isWithin(temporaryRoot, userDataDirectory)).toBe(true);
  expect(isWithin(temporaryRoot, runDirectory)).toBe(true);
  try {
    await Promise.all([
      mkdir(appData, { recursive: true }),
      mkdir(path.dirname(appDataMarker), { recursive: true }),
      mkdir(localAppData, { recursive: true }),
      mkdir(userProfile, { recursive: true }),
      mkdir(userDataDirectory, { recursive: true }),
      mkdir(runDirectory, { recursive: true }),
      mkdir(exportRoot, { recursive: true })
    ]);
    await Promise.all([
      writeFile(appDataMarker, "preserve application data"),
      writeFile(userDataMarker, "preserve explicit user data"),
      writeFile(exportFile, "preserve user export")
    ]);
    networkSentinel = await startNetworkSentinel();
    await createPortableFixture(temporaryRoot, userDocument);
    await createPortableFixture(temporaryRoot, directLaunchDocument);
    await createPortableFixture(temporaryRoot, shellOpenDocument);
    const environment: NodeJS.ProcessEnv = {
      ...process.env,
      APPDATA: appData,
      LOCALAPPDATA: localAppData,
      USERPROFILE: userProfile
    };
    delete environment.ETHER_RENDERER_URL;
    delete environment.INIT_CWD;
    delete environment.NODE_PATH;
    delete environment.npm_config_local_prefix;
    await execFileAsync(installer, ["/S", `/D=${installRoot}`], {
      cwd: runDirectory,
      env: environment,
      windowsHide: true,
      timeout: 90_000
    });
    await expect(fileExists(installedExecutable(installRoot))).resolves.toBe(true);

    const registry = await execFileAsync("reg.exe", ["query", "HKCU\\Software\\Classes\\.ether", "/ve"], { windowsHide: true });
    expect(registry.stdout).toMatch(/DreamBay\.Ether\.Document/i);
    const iconRegistration = await queryRegistry("HKCU\\Software\\Classes\\DreamBay.Ether.Document\\DefaultIcon");
    const openRegistration = await queryRegistry("HKCU\\Software\\Classes\\DreamBay.Ether.Document\\shell\\open\\command");
    const installRegistration = await queryRegistry(installRegistrationKeys[0]!);
    const uninstallRegistration = await queryRegistry(installRegistrationKeys[1]!);
    expect(iconRegistration).toContain(installRoot);
    expect(openRegistration).toContain(installRoot);
    expect(installRegistration).toContain(installRoot);
    expect(uninstallRegistration).toContain(installRoot);
    for (const shortcutPath of installedShortcutPaths) {
      await expect(fileExists(shortcutPath), shortcutPath).resolves.toBe(true);
    }

    // The installed executable must use a physical app payload, never a source
    // tree link. Native Sharp is intentionally unpacked beside app.asar.
    const resources = path.join(installRoot, "resources");
    expect((await lstat(path.join(resources, "app.asar"))).isSymbolicLink()).toBe(false);
    expect((await lstat(path.join(resources, "app.asar.unpacked", "node_modules", "@img", "sharp-win32-x64", "lib", "sharp-win32-x64-0.35.3.node"))).isSymbolicLink()).toBe(false);

    await rm(path.join(userDataDirectory, "DevToolsActivePort"), { force: true });
    const appProcess = spawn(installedExecutable(installRoot), [
      "--inspect=0",
      "--remote-debugging-port=0",
      "--disable-gpu",
      userDocument
    ], {
      cwd: runDirectory, env: environment, stdio: "pipe", windowsHide: true
    });
    const processOutput = captureProcessOutput(appProcess);
    const [inspectorPort, connectedBrowser] = await Promise.all([
      waitForMainProcessInspector(appProcess, processOutput),
      connectToApp(appProcess, processOutput)
    ]);
    browser = connectedBrowser;
    const page = browser.contexts()[0].pages()[0] ?? await browser.contexts()[0].waitForEvent("page");
    await expect(page.getByTestId("document-canvas")).toBeVisible({ timeout: 30_000 });
    const launchWindow = await probePackagedLaunchWindow(inspectorPort);
    expect(launchWindow).toMatchObject({
      count: 1,
      fullScreen: false,
      maximized: true,
      visible: true
    });
    expect(launchWindow.bounds.width).toBeGreaterThanOrEqual(launchWindow.workAreaSize.width - 16);
    expect(launchWindow.bounds.height).toBeGreaterThanOrEqual(launchWindow.workAreaSize.height - 16);
    const rendererSurface = await page.evaluate(() => {
      const root = document.querySelector("#root")?.getBoundingClientRect();
      const shell = document.querySelector("main.ether-shell")?.getBoundingClientRect();
      if (!root || !shell) throw new Error("Packaged renderer surface was unavailable.");
      return {
        viewport: { width: window.innerWidth, height: window.innerHeight },
        root: { x: root.x, y: root.y, width: root.width, height: root.height },
        shell: { x: shell.x, y: shell.y, width: shell.width, height: shell.height }
      };
    });
    expect(rendererSurface.viewport.width).toBeCloseTo(launchWindow.contentBounds.width, 0);
    expect(rendererSurface.viewport.height).toBeCloseTo(launchWindow.contentBounds.height, 0);
    expect(rendererSurface.root).toEqual({
      x: 0,
      y: 0,
      width: rendererSurface.viewport.width,
      height: rendererSurface.viewport.height
    });
    expect(rendererSurface.shell).toEqual(rendererSurface.root);
    await expect(probeNativeLaunchWindow(installedExecutable(installRoot))).resolves.toEqual({
      caption: true,
      maximizable: true,
      maximized: true,
      minimizable: true,
      systemMenu: true,
      thickFrame: true
    });
    await expect(page.getByTestId("project-header")).toContainText("Keep me.ether");
    await page.keyboard.press("Control+s");
    await expect(page.getByText("Saved", { exact: true })).toBeVisible({ timeout: 10_000 });
    const versions = await page.evaluate(() => window.ether.runtime.versions());
    expect(versions.app).toBe("4.0.0");
    const sqliteSecurity = await probePackagedSqliteSecurity(
      inspectorPort,
      path.join(resources, "app.asar", "node_modules", "@ether", "document", "dist", "index.js"),
      path.join(temporaryRoot, "Packaged vacuum capability.sqlite")
    );
    expect(sqliteSecurity).toEqual({
      attachDenied: true,
      capabilities: { defensiveMode: true, statementAuthorizer: true },
      loadExtensionDenied: true,
      postVacuumAttachDenied: true,
      vacuumCreated: true
    });
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(page.getByTestId("about-ether")).toContainText("4.0.0");
    await page.getByRole("button", { name: "Close Settings", exact: true }).click();
    await page.getByRole("button", { name: "Provider Health", exact: true }).click();
    const providerDialog = page.getByRole("dialog", { name: "Provider Health" });
    await expect(providerDialog).toBeVisible();
    const runtimeMetric = providerDialog.locator(".status-metric").filter({ hasText: "Runtime" }).locator("strong");
    const checkedMetric = providerDialog.locator(".status-metric").filter({ hasText: "Checked" }).locator("strong");
    await expect(runtimeMetric).not.toHaveText(/^(Checking|Unknown)$/u, { timeout: 30_000 });
    await expect(checkedMetric).not.toHaveText(/^Pending$/u, { timeout: 30_000 });
    await expect(providerDialog.getByRole("alert")).toHaveCount(0);
    await page.getByRole("button", { name: "Close Provider Health", exact: true }).click();
    await exerciseBlockedRendererEgress(page, networkSentinel);
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(networkSentinel.traffic()).toEqual({
      httpRequests: 0,
      tcpConnections: 0,
      udpDatagrams: 0,
      upgrades: 0
    });

    // Provider discovery is read-only and should work even when the optional
    // local Codex route is unavailable on a clean profile.
    const health = await page.evaluate(() => window.ether.runtime.providerHealth());
    expect(health.providerId).toMatch(/^codex-/);
    expect(["available", "degraded", "unavailable", "probing"]).toContain(health.status);
    const primaryProcessIds = await processIdsFor(installedExecutable(installRoot));
    expect(primaryProcessIds.size).toBeGreaterThan(0);

    // A direct second launch must be forwarded to the primary instance rather
    // than creating a second desktop process.
    const secondLaunch = spawn(installedExecutable(installRoot), [
      directLaunchDocument
    ], {
      cwd: runDirectory, env: environment, stdio: "pipe", windowsHide: true
    });
    await waitForExit(secondLaunch, 15_000);
    await expect(page.getByTestId("project-header")).toContainText("Second launch.ether", { timeout: 15_000 });
    expect(await processIdsFor(installedExecutable(installRoot))).toEqual(primaryProcessIds);

    // Shell execution exercises the registered .ether association in the same
    // way as Explorer's Open command. The primary instance remains singular.
    const shellDocumentPath = shellOpenDocument.replaceAll("'", "''");
    const shellWorkingDirectory = runDirectory.replaceAll("'", "''");
    await execFileAsync("powershell.exe", [
      "-NoProfile", "-NonInteractive", "-Command",
      `Start-Process -FilePath '${shellDocumentPath}' -WorkingDirectory '${shellWorkingDirectory}'`
    ], { env: environment, windowsHide: true });
    await expect(page.getByTestId("project-header")).toContainText("Explorer open.ether", { timeout: 15_000 });
    expect(await processIdsFor(installedExecutable(installRoot))).toEqual(primaryProcessIds);

    await page.getByRole("button", { name: "Artifacts", exact: true }).click();
    await expect(page.getByRole("region", { name: "Reference Desk" })).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: "Review", exact: true }).click();
    await expect(page.getByTestId("artifact-observatory")).toBeVisible({ timeout: 30_000 });
    const preview = page.locator(".artifact-embedded-preview");
    await expect(preview).toHaveCount(1, { timeout: 30_000 });
    await expect(preview).toHaveJSProperty("naturalWidth", 64, { timeout: 30_000 });
    await expect(preview).toHaveAttribute("src", /^ether-asset:\/\/.*\/thumbnail$/);

    await page.close();
    await browser.close();
    browser = null;
    await waitForNoAdditionalProcess(installedExecutable(installRoot), preexistingProcessIds, 15_000);
    await expect(fileExists(`${userDocument}-wal`)).resolves.toBe(false);

    // Reopen after a complete process exit from a disposable working directory.
    await rm(path.join(userDataDirectory, "DevToolsActivePort"), { force: true });
    const reopenProcess = spawn(installedExecutable(installRoot), [
      "--remote-debugging-port=0",
      "--disable-gpu",
      shellOpenDocument
    ], { cwd: runDirectory, env: environment, stdio: "pipe", windowsHide: true });
    const reopenOutput = captureProcessOutput(reopenProcess);
    browser = await connectToApp(reopenProcess, reopenOutput);
    const reopenedPage = browser.contexts()[0].pages()[0] ?? await browser.contexts()[0].waitForEvent("page");
    await expect(reopenedPage.getByTestId("project-header")).toContainText("Explorer open.ether", { timeout: 30_000 });
    await expect(reopenedPage.getByTestId("document-canvas")).toBeVisible();
    await reopenedPage.close();
    await browser.close();
    browser = null;
    await waitForNoAdditionalProcess(installedExecutable(installRoot), preexistingProcessIds, 15_000);
    const database = new DatabaseSync(shellOpenDocument, { readOnly: true });
    try {
      expect(database.prepare("SELECT app_version AS appVersion FROM document WHERE singleton = 1").get())
        .toEqual({ appVersion: "4.0.0" });
    } finally {
      database.close();
    }

    // Let NSIS copy the uninstaller to Temp; forcing `_?=` keeps it running
    // inside installRoot and prevents the final self-delete/directory removal.
    await execFileAsync(path.join(installRoot, "Uninstall Ether.exe"), ["/S"], {
      cwd: runDirectory,
      env: environment,
      windowsHide: true,
      timeout: 90_000
    });
    await waitForUninstalledPayload(installRoot, 15_000);
    await expect(fileExists(userDocument)).resolves.toBe(true);
    await expect(fileExists(exportFile)).resolves.toBe(true);
    await expect(fileExists(appDataMarker)).resolves.toBe(true);
    await expect(fileExists(userDataMarker)).resolves.toBe(true);
    for (const installedPayload of [
      installedExecutable(installRoot),
      path.join(installRoot, "Uninstall Ether.exe"),
      path.join(installRoot, "resources", "app.asar")
    ]) {
      await expect(fileExists(installedPayload)).resolves.toBe(false);
    }
    await waitForShellIntegrationRemoval(
      [...associationKeys.slice(1), ...installRegistrationKeys],
      installedShortcutPaths,
      15_000
    );
    await expect(extensionAssociationPointsToEther()).resolves.toBe(false);
    await expect(registryKeyExists(associationKeys[1]!)).resolves.toBe(false);
    await expect(registryKeyExists("HKCU\\Software\\Classes\\DreamBay.Ether.Document\\DefaultIcon")).resolves.toBe(false);
    await expect(registryKeyExists("HKCU\\Software\\Classes\\DreamBay.Ether.Document\\shell\\open\\command")).resolves.toBe(false);
    for (const registrationKey of installRegistrationKeys) {
      await expect(registryKeyExists(registrationKey), registrationKey).resolves.toBe(false);
    }
    for (const shortcutPath of installedShortcutPaths) {
      await expect(fileExists(shortcutPath), shortcutPath).resolves.toBe(false);
    }
  } finally {
    await browser?.close().catch(() => undefined);
    await networkSentinel?.close().catch(() => undefined);
    await stopAdditionalProcesses(installedExecutable(installRoot), preexistingProcessIds);
    await restoreInstallerOwnedUserState(temporaryRoot, registryBackups, shortcutBackups);
  }
});

async function restoreInstallerOwnedUserState(
  temporaryRoot: string,
  registryBackups: Awaited<ReturnType<typeof backupRegistryTrees>>,
  shortcutBackups: Awaited<ReturnType<typeof backupShortcuts>>
) {
  try {
    const restorations = await Promise.allSettled([
      restoreRegistryTrees(registryBackups),
      restoreShortcuts(shortcutBackups)
    ]);
    const failures = restorations
      .filter((result): result is PromiseRejectedResult => result.status === "rejected")
      .map((result) => result.reason);
    if (failures.length > 0) {
      throw new AggregateError(failures, "Failed to restore installer-owned user state.");
    }
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  }
}

async function createPortableFixture(temporaryRoot: string, documentPath: string) {
  const service = new DesktopApplicationService({
    appDataRoot: path.join(temporaryRoot, "fixture-appdata"), appVersion: "4.0.0",
    dialogs: { openDocument: async () => null, saveDocument: async () => documentPath, locateReference: async () => null, searchReferenceFolder: async () => null, confirmPortable: async () => true },
    provider: new FakeImageProvider(), simulationMode: true
  });
  const untitled = await service.bootstrap();
  await service.generateFakeArtifact(untitled.documentId);
  await service.saveAs(untitled.documentId);
  await service.close();
}

async function startNetworkSentinel() {
  let httpRequests = 0;
  let tcpConnections = 0;
  let upgrades = 0;
  let udpDatagrams = 0;
  const server: HttpServer = createServer((_request, response) => {
    httpRequests += 1;
    response.writeHead(204).end();
  });
  server.on("connection", () => {
    tcpConnections += 1;
  });
  server.on("upgrade", (_request, socket) => {
    upgrades += 1;
    socket.destroy();
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("HTTP sentinel did not bind a TCP port.");

  const udp: DatagramSocket = createSocket("udp4");
  udp.on("message", () => {
    udpDatagrams += 1;
  });
  await new Promise<void>((resolve, reject) => {
    udp.once("error", reject);
    udp.bind(0, "127.0.0.1", resolve);
  });
  const udpAddress = udp.address();
  return {
    endpoints: {
      http: `http://127.0.0.1:${address.port}/ether-egress-sentinel`,
      stun: `stun:127.0.0.1:${udpAddress.port}`,
      turn: `turn:127.0.0.1:${address.port}?transport=tcp`,
      websocket: `ws://127.0.0.1:${address.port}/ether-egress-sentinel`
    },
    traffic: () => ({ httpRequests, tcpConnections, udpDatagrams, upgrades }),
    close: async () => {
      await Promise.all([
        new Promise<void>((resolve) => server.close(() => resolve())),
        new Promise<void>((resolve) => udp.close(() => resolve()))
      ]);
    }
  };
}

async function exerciseBlockedRendererEgress(
  page: Page,
  sentinel: Awaited<ReturnType<typeof startNetworkSentinel>>
) {
  const results = await page.evaluate(async (endpoints) => {
    const settle = async (operation: () => Promise<unknown>) => {
      try {
        await Promise.race([
          operation(),
          new Promise((_resolve, reject) => setTimeout(() => reject(new Error("sentinel timeout")), 750))
        ]);
        return "resolved";
      } catch {
        return "blocked";
      }
    };
    const fetchResult = await settle(() => fetch(endpoints.http));
    const xhrResult = await settle(() => new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("GET", endpoints.http);
      xhr.onload = () => resolve();
      xhr.onerror = () => reject(new Error("xhr blocked"));
      xhr.onabort = () => reject(new Error("xhr aborted"));
      xhr.send();
    }));
    const eventSourceResult = await settle(() => new Promise<void>((resolve, reject) => {
      const source = new EventSource(endpoints.http);
      const timer = setTimeout(() => {
        source.close();
        reject(new Error("event source timeout"));
      }, 500);
      source.onopen = () => {
        clearTimeout(timer);
        source.close();
        resolve();
      };
      source.onerror = () => {
        clearTimeout(timer);
        source.close();
        reject(new Error("event source blocked"));
      };
    }));
    const webSocketResult = await settle(() => new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(endpoints.websocket);
      const timer = setTimeout(() => {
        socket.close();
        reject(new Error("websocket timeout"));
      }, 500);
      socket.onopen = () => {
        clearTimeout(timer);
        socket.close();
        resolve();
      };
      socket.onerror = () => {
        clearTimeout(timer);
        socket.close();
        reject(new Error("websocket blocked"));
      };
    }));
    const webRtcResult = await settle(async () => {
      const peer = new RTCPeerConnection({
        iceServers: [
          { urls: endpoints.stun },
          {
            credential: "ether-egress-blocked",
            urls: endpoints.turn,
            username: "ether-egress-blocked"
          }
        ]
      });
      try {
        peer.createDataChannel("ether-egress-sentinel");
        await peer.setLocalDescription(await peer.createOffer());
        await new Promise((resolve) => setTimeout(resolve, 500));
      } finally {
        peer.close();
      }
    });
    return { eventSourceResult, fetchResult, webRtcResult, webSocketResult, xhrResult };
  }, sentinel.endpoints);
  expect(results).toEqual({
    eventSourceResult: "blocked",
    fetchResult: "blocked",
    webRtcResult: "blocked",
    webSocketResult: "blocked",
    xhrResult: "blocked"
  });
}

type PackagedSqliteSecurityProbe = {
  attachDenied: boolean;
  capabilities: { defensiveMode: boolean; statementAuthorizer: boolean };
  loadExtensionDenied: boolean;
  postVacuumAttachDenied: boolean;
  vacuumCreated: boolean;
};

type PackagedLaunchWindowProbe = {
  bounds: { height: number; width: number };
  contentBounds: { height: number; width: number };
  count: number;
  fullScreen: boolean;
  maximized: boolean;
  visible: boolean;
  workAreaSize: { height: number; width: number };
};

async function probePackagedLaunchWindow(inspectorPort: number): Promise<PackagedLaunchWindowProbe> {
  const expression = `(() => {
    const { createRequire } = process.getBuiltinModule("node:module");
    const { BrowserWindow, screen } = createRequire(process.execPath)("electron");
    const windows = BrowserWindow.getAllWindows();
    const window = windows[0];
    if (window === undefined) {
      return {
        bounds: { height: 0, width: 0 },
        contentBounds: { height: 0, width: 0 },
        count: 0,
        fullScreen: false,
        maximized: false,
        visible: false,
        workAreaSize: { height: 0, width: 0 }
      };
    }
    return {
      bounds: window.getBounds(),
      contentBounds: window.getContentBounds(),
      count: windows.length,
      fullScreen: window.isFullScreen(),
      maximized: window.isMaximized(),
      visible: window.isVisible(),
      workAreaSize: screen.getDisplayMatching(window.getBounds()).workAreaSize
    };
  })()`;
  return await evaluateMainProcess(inspectorPort, expression) as PackagedLaunchWindowProbe;
}

async function probeNativeLaunchWindow(executable: string) {
  const escapedExecutable = executable.replaceAll("'", "''");
  const script = `
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class EtherWindowProbe {
  [DllImport("user32.dll")]
  [return: MarshalAs(UnmanagedType.Bool)]
  public static extern bool IsZoomed(IntPtr hWnd);

  [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")]
  public static extern IntPtr GetWindowLongPtr(IntPtr hWnd, int nIndex);
}
'@
$expectedPath = '${escapedExecutable}'
$window = Get-Process | Where-Object {
  $_.MainWindowHandle -ne 0 -and
  [string]::Equals($_.Path, $expectedPath, [System.StringComparison]::OrdinalIgnoreCase)
} | Select-Object -First 1
if ($null -eq $window) { throw "Installed Ether main window was not found." }
$style = [EtherWindowProbe]::GetWindowLongPtr($window.MainWindowHandle, -16).ToInt64()
[pscustomobject]@{
  caption = ($style -band 0x00C00000) -eq 0x00C00000
  maximizable = ($style -band 0x00010000) -ne 0
  maximized = [EtherWindowProbe]::IsZoomed($window.MainWindowHandle)
  minimizable = ($style -band 0x00020000) -ne 0
  systemMenu = ($style -band 0x00080000) -ne 0
  thickFrame = ($style -band 0x00040000) -ne 0
} | ConvertTo-Json -Compress
`;
  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    { windowsHide: true }
  );
  return JSON.parse(stdout.trim()) as {
    caption: boolean;
    maximizable: boolean;
    maximized: boolean;
    minimizable: boolean;
    systemMenu: boolean;
    thickFrame: boolean;
  };
}

async function probePackagedSqliteSecurity(
  inspectorPort: number,
  documentModulePath: string,
  vacuumPath: string
): Promise<PackagedSqliteSecurityProbe> {
  const vacuumStatement = `VACUUM INTO '${vacuumPath.replaceAll("'", "''")}'`;
  const expression = `(async () => {
    const { existsSync } = process.getBuiltinModule("node:fs");
    const { DatabaseSync } = process.getBuiltinModule("node:sqlite");
    const { createRequire } = process.getBuiltinModule("node:module");
    const security = createRequire(process.execPath)(${JSON.stringify(documentModulePath)});
    const database = new DatabaseSync(":memory:");
    const denied = (statement) => {
      try {
        database.exec(statement);
        return false;
      } catch {
        return true;
      }
    };
    try {
      database.exec("CREATE TABLE release_probe (value TEXT)");
      const capabilities = security.inspectEtherSqliteSecurityCapabilities(database);
      security.hardenEtherSqliteConnection(database);
      const attachDenied = denied("ATTACH DATABASE ':memory:' AS denied");
      const loadExtensionDenied = denied("SELECT load_extension('ether-release-probe')");
      security.withEtherVacuumCapability(database, () => database.exec(${JSON.stringify(vacuumStatement)}));
      const postVacuumAttachDenied = denied("ATTACH DATABASE ':memory:' AS denied_after_vacuum");
      return {
        attachDenied,
        capabilities,
        loadExtensionDenied,
        postVacuumAttachDenied,
        vacuumCreated: existsSync(${JSON.stringify(vacuumPath)})
      };
    } finally {
      database.close();
    }
  })()`;
  return await evaluateMainProcess(inspectorPort, expression) as PackagedSqliteSecurityProbe;
}

async function evaluateMainProcess(inspectorPort: number, expression: string): Promise<unknown> {
  const discoveryUrl = `http://127.0.0.1:${inspectorPort}/json/list`;
  const startedAt = Date.now();
  let webSocketDebuggerUrl: string | null = null;
  while (Date.now() - startedAt < 15_000) {
    try {
      const targets = await fetch(discoveryUrl).then((response) => response.json()) as Array<{
        webSocketDebuggerUrl?: unknown;
      }>;
      const candidate = targets.find((target) => typeof target.webSocketDebuggerUrl === "string");
      if (typeof candidate?.webSocketDebuggerUrl === "string") {
        webSocketDebuggerUrl = candidate.webSocketDebuggerUrl;
        break;
      }
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  if (webSocketDebuggerUrl === null) throw new Error("Packaged Electron did not expose its scoped main-process inspector.");

  const socket = new WebSocket(webSocketDebuggerUrl);
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timed out connecting to the packaged main-process inspector.")), 10_000);
      socket.addEventListener("open", () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
      socket.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new Error("Could not connect to the packaged main-process inspector."));
      }, { once: true });
    });
    const id = 1;
    type InspectorResponse = {
      id?: unknown;
      error?: { message?: unknown };
      result?: {
        exceptionDetails?: {
          exception?: { description?: unknown };
          text?: unknown;
        };
        result?: { value?: unknown };
      };
    };
    const response = await new Promise<InspectorResponse>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Packaged main-process SQLite probe timed out.")), 15_000);
      socket.addEventListener("message", (event) => {
        const message = JSON.parse(String(event.data)) as InspectorResponse;
        if (message.id !== id) return;
        clearTimeout(timer);
        resolve(message);
      });
      socket.send(JSON.stringify({
        id,
        method: "Runtime.evaluate",
        params: { awaitPromise: true, expression, returnByValue: true }
      }));
    });
    if (response.error !== undefined || response.result?.exceptionDetails !== undefined) {
      throw new Error(
        `Packaged main-process SQLite probe failed: ${String(
          response.error?.message ??
          response.result?.exceptionDetails?.exception?.description ??
          response.result?.exceptionDetails?.text ??
          "unknown inspector error"
        )}.`
      );
    }
    return response.result?.result?.value;
  } finally {
    socket.close();
  }
}

async function connectToApp(
  appProcess: ChildProcessWithoutNullStreams,
  processOutput: () => string
): Promise<Browser> {
  const startedAt = Date.now();
  let lastError: unknown = null;
  while (Date.now() - startedAt < 30_000) {
    if (appProcess.exitCode !== null) {
      throw new Error(`Installed Ether.exe exited before CDP connected (${appProcess.exitCode}): ${processOutput()}`);
    }
    try {
      const match = /DevTools listening on (ws:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):\d+\/devtools\/browser\/[^\s]+)/u
        .exec(processOutput());
      if (match === null) throw new Error("DevTools endpoint is not ready.");
      return await chromium.connectOverCDP(match[1]!);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error(`Installed Ether.exe did not expose its launch window: ${String(lastError)}\n${processOutput()}`);
}

async function waitForMainProcessInspector(
  appProcess: ChildProcessWithoutNullStreams,
  processOutput: () => string
): Promise<number> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 15_000) {
    if (appProcess.exitCode !== null) {
      throw new Error(`Installed Ether.exe exited before its main-process inspector started (${appProcess.exitCode}).`);
    }
    const match = /Debugger listening on ws:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):(\d+)\//u.exec(processOutput());
    if (match !== null) {
      const port = Number(match[1]);
      if (Number.isInteger(port) && port > 0 && port <= 65_535) return port;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Installed Ether.exe did not expose its scoped main-process inspector.\n${processOutput()}`);
}

function captureProcessOutput(appProcess: ChildProcessWithoutNullStreams): () => string {
  const chunks: Buffer[] = [];
  appProcess.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
  appProcess.stderr.on("data", (chunk: Buffer) => chunks.push(chunk));
  return () => Buffer.concat(chunks).toString("utf8");
}

async function waitForExit(child: ChildProcessWithoutNullStreams, timeout: number) {
  await Promise.race([
    new Promise<void>((resolve) => child.once("exit", () => resolve())),
    new Promise<void>((_resolve, reject) => setTimeout(() => reject(new Error("Second Ether launch did not yield to the primary instance.")), timeout))
  ]);
}

async function processIdsFor(executable: string): Promise<Set<number>> {
  const escapedPath = executable.replaceAll("'", "''");
  const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `Get-CimInstance Win32_Process | Where-Object { [string]::Equals($_.ExecutablePath, '${escapedPath}', [System.StringComparison]::OrdinalIgnoreCase) } | ForEach-Object { $_.ProcessId }`]);
  return new Set(stdout.split(/\r?\n/u).map((value) => Number(value.trim())).filter(Number.isInteger));
}

async function waitForNoAdditionalProcess(executable: string, existing: ReadonlySet<number>, timeout: number) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeout) {
    if ([...await processIdsFor(executable)].every((id) => existing.has(id))) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Installed Ether.exe did not close cleanly.");
}

async function stopAdditionalProcesses(executable: string, existing: ReadonlySet<number>) {
  const ids = [...await processIdsFor(executable)].filter((id) => !existing.has(id));
  if (ids.length) await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `Stop-Process -Id ${ids.join(",")} -Force -ErrorAction SilentlyContinue`]);
}

async function assertNoExistingEtherInstallation() {
  const existing = [];
  for (const key of installRegistrationKeys) {
    if (await registryKeyExists(key)) existing.push(key);
  }
  if (existing.length > 0) {
    throw new Error(
      "Refusing to run destructive NSIS acceptance because a real per-user Ether installation is registered: " +
      `${existing.join(", ")}. Run this test only in a disposable Windows profile.`
    );
  }
}

async function backupRegistryTrees(rootDirectory: string) {
  return Promise.all(installerOwnedRegistryKeys.map(async (key, index) => {
    const filePath = path.join(rootDirectory, `registry-${index}.reg`);
    const snapshot = await registryTreeSnapshot(key);
    if (snapshot !== null) {
      await execFileAsync("reg.exe", ["export", key, filePath, "/y"], { windowsHide: true });
    }
    return { key, filePath, snapshot };
  }));
}

async function restoreRegistryTrees(backups: Awaited<ReturnType<typeof backupRegistryTrees>>) {
  for (const backup of backups) {
    await execFileAsync("reg.exe", ["delete", backup.key, "/f"], { windowsHide: true }).catch(() => undefined);
    if (backup.snapshot !== null) {
      await execFileAsync("reg.exe", ["import", backup.filePath], { windowsHide: true });
    }
  }
  for (const backup of backups) {
    expect(await registryTreeSnapshot(backup.key), `restored registry tree ${backup.key}`)
      .toBe(backup.snapshot);
  }
}

async function registryTreeSnapshot(key: string) {
  try {
    const { stdout } = await execFileAsync("reg.exe", ["query", key, "/s"], { windowsHide: true });
    return stdout.replaceAll("\r\n", "\n").trim();
  } catch {
    return null;
  }
}

async function queryRegistry(key: string) {
  const { stdout } = await execFileAsync("reg.exe", ["query", key, "/s"], { windowsHide: true });
  return stdout;
}

async function registryKeyExists(key: string) {
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
      ["query", associationKeys[0]!, "/ve"],
      { windowsHide: true }
    );
    return /DreamBay\.Ether\.Document/iu.test(stdout);
  } catch {
    return false;
  }
}

async function backupShortcuts(temporaryRoot: string) {
  const { stdout } = await execFileAsync("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    "[Environment]::GetFolderPath('DesktopDirectory'); [Environment]::GetFolderPath('Programs')"
  ], { windowsHide: true });
  const [desktop, programs] = stdout.split(/\r?\n/u).map((value) => value.trim()).filter(Boolean);
  if (desktop === undefined || programs === undefined) throw new Error("Windows shortcut folders could not be resolved.");
  return Promise.all([
    path.join(desktop, "Ether.lnk"),
    path.join(programs, "Ether.lnk")
  ].map(async (shortcutPath, index) => {
    const backupPath = path.join(temporaryRoot, `shortcut-${index}.lnk`);
    const existed = await fileExists(shortcutPath);
    if (existed) await copyFile(shortcutPath, backupPath);
    return { backupPath, existed, path: shortcutPath };
  }));
}

async function restoreShortcuts(backups: Awaited<ReturnType<typeof backupShortcuts>>) {
  for (const backup of backups) {
    await rm(backup.path, { force: true });
    if (!backup.existed) continue;
    await mkdir(path.dirname(backup.path), { recursive: true });
    await copyFile(backup.backupPath, backup.path);
  }
}

async function waitForUninstalledPayload(target: string, timeout: number) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeout) {
    if (!await pathExists(target)) return;
    const remaining = await readdir(target, { recursive: true }).catch(() => []);
    if (remaining.length === 0) {
      // electron-builder/NSIS removes the complete payload but can leave the
      // user-selected installation directory itself briefly locked while its
      // Temp-hosted uninstaller exits. The test's scoped finalizer reclaims it.
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const remaining = await readdir(target, { recursive: true }).catch(() => []);
  throw new Error(`Timed out waiting for installed payload removal from ${target}. Remaining: ${remaining.join(", ")}.`);
}

async function waitForShellIntegrationRemoval(keys: string[], shortcuts: string[], timeout: number) {
  const startedAt = Date.now();
  let remainingKeys: string[] = [];
  let remainingShortcuts: string[] = [];
  while (Date.now() - startedAt < timeout) {
    const [extensionAssociated, keyStates, shortcutStates] = await Promise.all([
      extensionAssociationPointsToEther(),
      Promise.all(keys.map(registryKeyExists)),
      Promise.all(shortcuts.map(fileExists))
    ]);
    remainingKeys = [
      ...(extensionAssociated ? [`${associationKeys[0]} => DreamBay.Ether.Document`] : []),
      ...keys.filter((_key, index) => keyStates[index])
    ];
    remainingShortcuts = shortcuts.filter((_shortcut, index) => shortcutStates[index]);
    if (!extensionAssociated && !keyStates.some(Boolean) && !shortcutStates.some(Boolean)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(
    `Timed out waiting for NSIS shell cleanup. Registry: ${remainingKeys.join(", ") || "(none)"}; ` +
    `shortcuts: ${remainingShortcuts.join(", ") || "(none)"}.`
  );
}

function isWithin(rootDirectory: string, candidate: string) {
  const relative = path.relative(rootDirectory, candidate);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

async function fileExists(filePath: string) {
  try { return (await stat(filePath)).isFile(); } catch { return false; }
}

async function pathExists(filePath: string) {
  try { await stat(filePath); return true; } catch { return false; }
}
