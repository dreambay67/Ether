import { app, BrowserWindow, ipcMain } from "electron";
import {
  createProject,
  loadGraph,
  openProject,
  runHealthCheck,
  saveGraph
} from "@ether/engine";
import path from "node:path";
import { isLocalDevelopmentRendererUrl } from "./rendererUrl";

const projectChannels = {
  create: "ether:project:create",
  open: "ether:project:open",
  saveGraph: "ether:project:saveGraph",
  loadGraph: "ether:project:loadGraph",
  health: "ether:project:health"
} as const;

function assertString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }

  return value;
}

function registerProjectIpc() {
  ipcMain.handle(projectChannels.create, (_event, options: unknown) => {
    if (!options || typeof options !== "object") {
      throw new Error("Project create options are required.");
    }

    const candidate = options as { parentDirectory?: unknown; name?: unknown };

    return createProject({
      parentDirectory: assertString(candidate.parentDirectory, "parentDirectory"),
      name: assertString(candidate.name, "name")
    });
  });

  ipcMain.handle(projectChannels.open, (_event, projectPath: unknown) => {
    return openProject(assertString(projectPath, "projectPath"));
  });

  ipcMain.handle(projectChannels.saveGraph, (_event, projectPath: unknown, graph: unknown) => {
    if (!graph || typeof graph !== "object") {
      throw new Error("graph must be an object.");
    }

    return saveGraph(assertString(projectPath, "projectPath"), graph as Parameters<typeof saveGraph>[1]);
  });

  ipcMain.handle(projectChannels.loadGraph, (_event, projectPath: unknown) => {
    return loadGraph(assertString(projectPath, "projectPath"));
  });

  ipcMain.handle(projectChannels.health, (_event, projectPath: unknown) => {
    return runHealthCheck(assertString(projectPath, "projectPath"));
  });
}

const createMainWindow = () => {
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1120,
    minHeight: 720,
    title: "Ether",
    backgroundColor: "#070B12",
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.js"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  const rendererUrl = process.env.ETHER_RENDERER_URL;
  const canLoadDevelopmentUrl = isLocalDevelopmentRendererUrl(rendererUrl, !app.isPackaged);

  if (rendererUrl && canLoadDevelopmentUrl) {
    void mainWindow.loadURL(rendererUrl);
  } else {
    void mainWindow.loadFile(path.join(__dirname, "../../dist/index.html"));
  }
};

registerProjectIpc();

app.whenReady().then(() => {
  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
