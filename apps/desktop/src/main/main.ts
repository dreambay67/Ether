import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  protocol,
  type MenuItemConstructorOptions
} from "electron";
import { FakeImageProvider } from "@ether/providers";

import { registerDocumentHandlers } from "./ipc/registerDocumentHandlers.js";
import { registerGraphHandlers } from "./ipc/registerGraphHandlers.js";
import {
  createEtherAssetProtocolHandler,
  registerEtherAssetScheme
} from "./protocol/etherAssetProtocol.js";
import { isLocalDevelopmentRendererUrl } from "./rendererUrl.js";
import { createDesktopSettingsStore } from "./settingsStore.js";
import {
  DesktopApplicationService,
  OpenDocumentCoordinator,
  type NativeDialogPort
} from "./services/applicationService.js";
import { createMainWindowOptions } from "./windowOptions.js";

registerEtherAssetScheme(protocol);

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));

export interface DesktopStartOptions {
  dialogs?: NativeDialogPort;
  initialArgv?: string[];
  rendererUrl?: string;
}

export async function startEtherDesktop(options: DesktopStartOptions = {}): Promise<{
  mainWindow: BrowserWindow;
  service: DesktopApplicationService;
}> {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    throw Object.assign(new Error("Another Ether instance owns the application lock."), {
      code: "SECOND_INSTANCE"
    });
  }

  await app.whenReady();
  app.setAppUserModelId("com.dreambay.ether");

  const preloadPath = path.join(moduleDirectory, "..", "preload", "preload.cjs");
  const mainWindow = new BrowserWindow(createMainWindowOptions(preloadPath));
  const rendererUrl = options.rendererUrl ?? resolveRendererUrl();
  const dialogs = options.dialogs ?? createNativeDialogPort(() => mainWindow);
  const service = new DesktopApplicationService({
    appDataRoot: path.join(app.getPath("userData"), "4.0"),
    appVersion: "4.0.0",
    dialogs,
    provider: new FakeImageProvider()
  });
  const settings = createDesktopSettingsStore(() => path.join(app.getPath("userData"), "settings.json"));

  const disposeDocumentHandlers = registerDocumentHandlers({
    ipcMain,
    mainWindow,
    rendererUrl,
    service
  });
  const disposeGraphHandlers = registerGraphHandlers({
    ipcMain,
    mainWindow,
    rendererUrl,
    service
  });

  protocol.handle(
    "ether-asset",
    createEtherAssetProtocolHandler({
      authorize: async (documentId, artifactId, variant) => {
        if (variant !== "original") return null;
        let active;
        try {
          active = service.snapshot();
        } catch {
          return null;
        }
        if (active.documentId !== documentId) return null;
        try {
          const artifact = await service.artifactDescriptor(documentId, artifactId);
          return {
            byteLength: artifact.byteLength,
            contentHash: artifact.contentKey,
            mediaType: artifact.mediaType
          };
        } catch {
          return null;
        }
      },
      readRange: (documentId, artifactId, _variant, start, endExclusive) =>
        service.readArtifactRange(documentId, artifactId, start, endExclusive)
    })
  );

  const rememberCurrentDocument = async () => {
    const documentPath = service.activePath();
    const snapshot = service.snapshot();
    if (documentPath !== null && snapshot.named) {
      app.addRecentDocument(documentPath);
      await settings.remember({
        documentId: snapshot.documentId,
        displayName: snapshot.displayName,
        canonicalPath: documentPath
      });
    }
  };
  const reportFailure = async (error: unknown) => {
    const message = error instanceof Error ? error.message : "Ether could not complete the command.";
    await dialog.showMessageBox(mainWindow, { type: "error", title: "Ether", message });
  };
  const run = (operation: () => Promise<unknown>, remember = false) => {
    void operation().then(() => {
      if (remember) void rememberCurrentDocument().catch(reportFailure);
    }, reportFailure);
  };

  installApplicationMenu(mainWindow, service, run);
  installWindowSecurity(mainWindow, rendererUrl);
  app.setJumpList([{ type: "recent" }]);

  const coordinator = new OpenDocumentCoordinator({
    focus: () => {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    },
    open: async (documentPath) => {
      await service.openPath(documentPath);
      await rememberCurrentDocument();
    }
  });
  const disposeRecentSubscription = service.subscribe((event) => {
    if (event.snapshot?.named === true) {
      const activePath = service.activePath();
      if (activePath !== null) coordinator.markOpen(activePath);
      void rememberCurrentDocument().catch(reportFailure);
    } else if (event.snapshot !== undefined) {
      coordinator.clear();
    }
  });

  app.on("second-instance", (_event, argv) => {
    const requested = findEtherArgument(argv);
    if (requested === null) {
      mainWindow.focus();
      return;
    }
    void coordinator.request(requested).catch(reportFailure);
  });
  app.on("open-file", (event, filePath) => {
    event.preventDefault();
    void coordinator.request(filePath).catch(reportFailure);
  });

  const initialDocument = findEtherArgument(options.initialArgv ?? process.argv.slice(1));
  if (initialDocument !== null) await coordinator.request(initialDocument);
  else await service.bootstrap();

  await mainWindow.loadURL(rendererUrl);
  mainWindow.on("closed", () => {
    disposeGraphHandlers();
    disposeDocumentHandlers();
    disposeRecentSubscription();
    void service.close();
  });
  app.on("before-quit", () => {
    void service.close();
  });
  app.on("window-all-closed", () => app.quit());

  return { mainWindow, service };
}

function resolveRendererUrl(): string {
  const developmentUrl = process.env.ETHER_RENDERER_URL;
  if (isLocalDevelopmentRendererUrl(developmentUrl, !app.isPackaged)) return developmentUrl!;
  return pathToFileURL(path.join(app.getAppPath(), "dist", "index.html")).href;
}

function createNativeDialogPort(getWindow: () => BrowserWindow): NativeDialogPort {
  return {
    openDocument: async () => {
      const result = await dialog.showOpenDialog(getWindow(), {
        title: "Open Ether Document",
        properties: ["openFile"],
        filters: [{ name: "Ether Documents", extensions: ["ether"] }]
      });
      return result.canceled ? null : result.filePaths[0] ?? null;
    },
    saveDocument: async (kind) => {
      const result = await dialog.showSaveDialog(getWindow(), {
        title: kind === "save-copy" ? "Save a Copy" : "Save Ether Document",
        defaultPath: kind === "save-copy" ? "Untitled copy.ether" : "Untitled.ether",
        filters: [{ name: "Ether Documents", extensions: ["ether"] }]
      });
      return result.canceled ? null : result.filePath ?? null;
    },
    locateReference: async () => {
      const result = await dialog.showOpenDialog(getWindow(), {
        title: "Locate Reference",
        properties: ["openFile"]
      });
      return result.canceled ? null : result.filePaths[0] ?? null;
    },
    searchReferenceFolder: async () => {
      const result = await dialog.showOpenDialog(getWindow(), {
        title: "Search Folder for References",
        properties: ["openDirectory"]
      });
      return result.canceled ? null : result.filePaths[0] ?? null;
    }
  };
}

function installApplicationMenu(
  mainWindow: BrowserWindow,
  service: DesktopApplicationService,
  run: (operation: () => Promise<unknown>, remember?: boolean) => void
): void {
  const scoped = (operation: (documentId: string) => Promise<unknown>) => () =>
    run(() => operation(service.snapshot().documentId));
  const template: MenuItemConstructorOptions[] = [{
    label: "File",
    submenu: [
      { label: "New", accelerator: "Ctrl+N", click: () => run(() => service.newDocument()) },
      { label: "Open...", accelerator: "Ctrl+O", click: () => run(() => service.open(), true) },
      { type: "separator" },
      { label: "Save", accelerator: "Ctrl+S", click: scoped((id) => service.save(id)) },
      { label: "Save As...", accelerator: "Ctrl+Shift+S", click: () => run(() => service.saveAs(service.snapshot().documentId), true) },
      { label: "Save a Copy...", click: scoped((id) => service.saveCopy(id)) },
      { type: "separator" },
      { label: "Compact Document", click: scoped((id) => service.compact(id)) },
      { label: "Make Document Portable", click: scoped((id) => service.makePortable(id)) },
      { type: "separator" },
      { role: "quit" }
    ]
  }, { role: "editMenu" }, { role: "viewMenu" }, { role: "windowMenu" }];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  void mainWindow;
}

function installWindowSecurity(mainWindow: BrowserWindow, rendererUrl: string): void {
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, targetUrl) => {
    if (targetUrl !== rendererUrl) event.preventDefault();
  });
  mainWindow.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
}

function findEtherArgument(argv: string[]): string | null {
  const candidate = argv.find((argument) =>
    !argument.startsWith("--") && path.extname(argument).toLocaleLowerCase() === ".ether"
  );
  return candidate === undefined ? null : path.resolve(candidate);
}
