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
  OpenDocumentController,
  OpenDocumentCoordinator,
  createWindowsLocationCapability,
  type DesktopApplicationServiceOptions,
  type NativeDialogPort
} from "./services/applicationService.js";
import { createMainWindowOptions } from "./windowOptions.js";

registerEtherAssetScheme(protocol);

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));

export interface DesktopStartOptions {
  dialogs?: NativeDialogPort;
  initialArgv?: string[];
  rendererUrl?: string;
  simulationMode?: boolean;
  locationCapability?: DesktopApplicationServiceOptions["locationCapability"];
  autosaveOperation?: DesktopApplicationServiceOptions["autosaveOperation"];
  serviceFactory?: (options: DesktopApplicationServiceOptions) => DesktopApplicationService;
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
  const serviceOptions: DesktopApplicationServiceOptions = {
    appDataRoot: path.join(app.getPath("userData"), "4.0"),
    appVersion: "4.0.0",
    dialogs,
    provider: new FakeImageProvider(),
    simulationMode: options.simulationMode === true,
    ...(options.locationCapability !== undefined
      ? { locationCapability: options.locationCapability }
      : process.platform === "win32"
        ? { locationCapability: createWindowsLocationCapability() }
        : {}),
    ...(options.autosaveOperation === undefined ? {} : { autosaveOperation: options.autosaveOperation })
  };
  const service = options.serviceFactory?.(serviceOptions) ?? new DesktopApplicationService(serviceOptions);
  const settings = createDesktopSettingsStore(() => path.join(app.getPath("userData"), "settings.json"));

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
  const openController = new OpenDocumentController(coordinator, () => dialogs.openDocument());
  const openDocument = async () => {
    await openController.request("picker");
    return service.snapshot();
  };
  const openPath = async (documentPath: string) => {
    await openController.request("drop", documentPath);
    return service.snapshot();
  };

  const disposeDocumentHandlers = registerDocumentHandlers({
    ipcMain,
    mainWindow,
    rendererUrl,
    service,
    openDocument,
    openPath
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
      streamRange: (documentId, artifactId, _variant, start, endExclusive) =>
        service.streamArtifactRange(documentId, artifactId, start, endExclusive)
    })
  );

  const disposeApplicationMenu = installApplicationMenu(service, openDocument, run);
  installWindowSecurity(mainWindow, rendererUrl);
  app.setJumpList([{ type: "recent" }]);

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
    void openController.request("second-instance", requested).catch(reportFailure);
  });
  app.on("open-file", (event, filePath) => {
    event.preventDefault();
    void openController.request("open-file", filePath).catch(reportFailure);
  });

  const initialDocument = findEtherArgument(options.initialArgv ?? process.argv.slice(1));
  if (initialDocument !== null) await openController.request("argv", initialDocument);
  else await service.bootstrap();

  await mainWindow.loadURL(rendererUrl);
  let lifecycleDrainedForQuit = false;
  let quitDrain: Promise<void> | null = null;
  const requestQuitDrain = () => {
    if (quitDrain !== null) return;
    quitDrain = service.close().then(() => {
      lifecycleDrainedForQuit = true;
      app.quit();
    }, async (error) => {
      quitDrain = null;
      await reportFailure(error);
    });
  };
  mainWindow.on("close", (event) => {
    if (lifecycleDrainedForQuit) return;
    event.preventDefault();
    requestQuitDrain();
  });
  mainWindow.on("closed", () => {
    disposeGraphHandlers();
    disposeDocumentHandlers();
    disposeApplicationMenu();
    disposeRecentSubscription();
  });
  app.on("before-quit", (event) => {
    if (lifecycleDrainedForQuit) return;
    event.preventDefault();
    requestQuitDrain();
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
    },
    confirmPortable: async ({ expectedBytes, expectedCount, missingReferences }) => {
      const missingDetail = missingReferences.length === 0
        ? "All known references are available."
        : `Unavailable: ${missingReferences.map((reference) => reference.displayName).join(", ")}`;
      const result = await dialog.showMessageBox(getWindow(), {
        type: "question",
        title: "Make Document Portable",
        message: `Embed ${expectedCount} available reference${expectedCount === 1 ? "" : "s"}?`,
        detail: `${expectedBytes.toLocaleString()} bytes will be copied into this Ether document. ${missingDetail}`,
        buttons: ["Make Portable", "Cancel"],
        defaultId: 0,
        cancelId: 1
      });
      return result.response === 0;
    }
  };
}

function installApplicationMenu(
  service: DesktopApplicationService,
  openDocument: () => Promise<unknown>,
  run: (operation: () => Promise<unknown>, remember?: boolean) => void
): () => void {
  type Command = keyof ReturnType<DesktopApplicationService["snapshot"]>["commands"];
  let commands: Record<Command, boolean> = {
    save: false,
    saveAs: false,
    saveCopy: false,
    compact: false,
    makePortable: false
  };
  const scoped = (
    command: Command,
    operation: (documentId: string) => Promise<unknown>,
    remember = false
  ) => () => {
    let snapshot;
    try {
      snapshot = service.snapshot();
    } catch {
      return;
    }
    if (!snapshot.commands[command]) return;
    run(() => operation(snapshot.documentId), remember);
  };
  const template: MenuItemConstructorOptions[] = [{
    label: "File",
    submenu: [
      { id: "file.new", label: "New", accelerator: "Ctrl+N", click: () => run(() => service.newDocument()) },
      { id: "file.open", label: "Open...", accelerator: "Ctrl+O", click: () => run(openDocument) },
      { type: "separator" },
      { id: "file.save", label: "Save", accelerator: "Ctrl+S", enabled: false, click: scoped("save", (id) => service.save(id)) },
      { id: "file.save-as", label: "Save As...", accelerator: "Ctrl+Shift+S", enabled: false, click: scoped("saveAs", (id) => service.saveAs(id), true) },
      { id: "file.save-copy", label: "Save a Copy...", enabled: false, click: scoped("saveCopy", (id) => service.saveCopy(id)) },
      { type: "separator" },
      { id: "file.compact", label: "Compact Document", enabled: false, click: scoped("compact", (id) => service.compact(id)) },
      { id: "file.make-portable", label: "Make Document Portable", enabled: false, click: scoped("makePortable", (id) => service.makePortable(id)) },
      { type: "separator" },
      { role: "quit" }
    ]
  }, { role: "editMenu" }, { role: "viewMenu" }, { role: "windowMenu" }];
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
  const update = (next: ReturnType<DesktopApplicationService["snapshot"]>["commands"]) => {
    commands = next;
    const items: Array<[string, Command]> = [
      ["file.save", "save"],
      ["file.save-as", "saveAs"],
      ["file.save-copy", "saveCopy"],
      ["file.compact", "compact"],
      ["file.make-portable", "makePortable"]
    ];
    for (const [id, command] of items) {
      const item = menu.getMenuItemById(id);
      if (item !== null) item.enabled = commands[command];
    }
  };
  const unsubscribe = service.subscribe((event) => {
    if (event.snapshot !== undefined) update(event.snapshot.commands);
  });
  try {
    update(service.snapshot().commands);
  } catch {
    // The initial document event enables commands after bootstrap.
  }
  return unsubscribe;
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
