import { randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import path from "node:path";
import { app, BrowserWindow, ipcMain } from "electron";
import {
  createProject,
  type ProjectOpenResult,
  loadGraph,
  openProject,
  runHealthCheck,
  saveGraph
} from "@ether/engine";
import { isLocalDevelopmentRendererUrl } from "./rendererUrl";

const projectChannels = {
  create: "ether:project:create",
  open: "ether:project:open",
  saveGraph: "ether:project:saveGraph",
  loadGraph: "ether:project:loadGraph",
  health: "ether:project:health"
} as const;

type ProjectSession = ProjectOpenResult & {
  projectId: string;
};

const projectRegistry = new Map<string, string>();

function assertString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }

  return value;
}

async function canonicalizeProjectPath(projectPath: string): Promise<string> {
  const resolvedPath = await realpath(projectPath);

  if (path.extname(resolvedPath).toLowerCase() !== ".ether") {
    throw new Error("Project path must point to a .ether bundle.");
  }

  return resolvedPath;
}

async function registerProject(project: ProjectOpenResult): Promise<ProjectSession> {
  const canonicalPath = await canonicalizeProjectPath(project.path);
  const projectId = randomUUID();
  projectRegistry.set(projectId, canonicalPath);

  return {
    ...project,
    projectId,
    path: canonicalPath
  };
}

function getRegisteredProjectPath(projectIdValue: unknown): string {
  const projectId = assertString(projectIdValue, "projectId");
  const projectPath = projectRegistry.get(projectId);

  if (!projectPath) {
    throw new Error("Project session was not found. Open the project again.");
  }

  return projectPath;
}

function registerProjectIpc() {
  ipcMain.handle(projectChannels.create, async (_event, options: unknown) => {
    if (!options || typeof options !== "object") {
      throw new Error("Project create options are required.");
    }

    const candidate = options as { parentDirectory?: unknown; name?: unknown };

    const project = await createProject({
      parentDirectory: assertString(candidate.parentDirectory, "parentDirectory"),
      name: assertString(candidate.name, "name")
    });

    return registerProject(project);
  });

  ipcMain.handle(projectChannels.open, async (_event, projectPath: unknown) => {
    const canonicalPath = await canonicalizeProjectPath(assertString(projectPath, "projectPath"));
    const project = await openProject(canonicalPath);

    return registerProject(project);
  });

  ipcMain.handle(projectChannels.saveGraph, (_event, projectId: unknown, graph: unknown) => {
    if (!graph || typeof graph !== "object") {
      throw new Error("graph must be an object.");
    }

    return saveGraph(getRegisteredProjectPath(projectId), graph as Parameters<typeof saveGraph>[1]);
  });

  ipcMain.handle(projectChannels.loadGraph, (_event, projectId: unknown) => {
    return loadGraph(getRegisteredProjectPath(projectId));
  });

  ipcMain.handle(projectChannels.health, (_event, projectId: unknown) => {
    return runHealthCheck(getRegisteredProjectPath(projectId));
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
