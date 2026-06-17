import { randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import path from "node:path";
import { app, BrowserWindow, dialog, ipcMain } from "electron";
import {
  createProject,
  ensureCollectionFolder,
  ensureDirectoryRoot,
  executeGraphRun,
  getGenerationProviderDiagnostics,
  type AssetKind,
  type EtherGraph,
  type ExecutionPolicy,
  type ExecutionRequest,
  type ProjectOpenResult,
  linkExternalReference,
  listAssetMoves,
  listAssets,
  loadGraph,
  moveAssetToCollection,
  openProject,
  runHealthCheck,
  saveGeneratedAsset,
  saveGraph
} from "@ether/engine";
import { isLocalDevelopmentRendererUrl } from "./rendererUrl";
import { assertImageFilePathForIpc } from "./assetIpcValidation";

const projectChannels = {
  create: "ether:project:create",
  open: "ether:project:open",
  saveGraph: "ether:project:saveGraph",
  loadGraph: "ether:project:loadGraph",
  health: "ether:project:health"
} as const;

const assetChannels = {
  selectReferenceImage: "ether:asset:selectReferenceImage",
  linkDroppedReference: "ether:asset:linkDroppedReference",
  ensureCollection: "ether:asset:ensureCollection",
  ensureDirectory: "ether:asset:ensureDirectory",
  list: "ether:asset:list",
  saveFakeGenerated: "ether:asset:saveFakeGenerated",
  moveToCollection: "ether:asset:moveToCollection",
  listMoves: "ether:asset:listMoves"
} as const;

const executionChannels = {
  run: "ether:execution:run"
} as const;

const providerChannels = {
  diagnostics: "ether:provider:diagnostics"
} as const;

type ProjectSession = ProjectOpenResult & {
  projectId: string;
};

const projectRegistry = new Map<string, string>();
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const executionPolicies = new Set<ExecutionPolicy>([
  "cached-inputs",
  "refresh-upstream",
  "downstream",
  "branch",
  "selected"
]);

function assertString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }

  return value;
}

function optionalString(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  return assertString(value, label);
}

function assertOptions(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }

  return value as Record<string, unknown>;
}

function assertStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array.`);
  }

  return value.map((entry, index) => assertString(entry, `${label}[${index}]`));
}

function optionalRunCountCap(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 100) {
    throw new Error("runCountCap must be an integer from 0 to 100.");
  }

  return value;
}

function assertExecutionRequest(value: unknown): Omit<ExecutionRequest, "now"> {
  const request = assertOptions(value, "execution request");
  const policy = assertString(request.policy, "policy");

  if (!executionPolicies.has(policy as ExecutionPolicy)) {
    throw new Error("Unknown execution policy.");
  }

  return {
    policy: policy as ExecutionPolicy,
    targetNodeIds: assertStringArray(request.targetNodeIds, "targetNodeIds"),
    runCountCap: optionalRunCountCap(request.runCountCap),
    parallel: request.parallel === true,
    providerId: optionalString(request.providerId, "providerId")
  };
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

  if (!uuidPattern.test(projectId)) {
    throw new Error("projectId must be a valid UUID.");
  }

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

    // TODO: Replace freeform parentDirectory with native directory grants/dialogs.
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

function registerAssetIpc() {
  ipcMain.handle(assetChannels.selectReferenceImage, async (_event, projectId: unknown, options?: unknown) => {
    const projectPath = getRegisteredProjectPath(projectId);
    const assetOptions =
      options && typeof options === "object" && !Array.isArray(options)
        ? (options as Record<string, unknown>)
        : {};
    const result = await dialog.showOpenDialog({
      title: "Link reference image",
      properties: ["openFile"],
      filters: [
        {
          name: "Images",
          extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp", "avif", "tif", "tiff"]
        }
      ]
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    assertImageFilePathForIpc(result.filePaths[0]);

    return linkExternalReference(projectPath, {
      filePath: result.filePaths[0],
      role: optionalString(assetOptions.role, "role")
    });
  });

  ipcMain.handle(assetChannels.linkDroppedReference, (_event, projectId: unknown, filePathValue: unknown, options?: unknown) => {
    const assetOptions =
      options && typeof options === "object" && !Array.isArray(options)
        ? (options as Record<string, unknown>)
        : {};
    const filePath = assertString(filePathValue, "filePath");

    assertImageFilePathForIpc(filePath);

    return linkExternalReference(getRegisteredProjectPath(projectId), {
      filePath,
      role: optionalString(assetOptions.role, "role")
    });
  });

  ipcMain.handle(assetChannels.ensureCollection, (_event, projectId: unknown, options: unknown) => {
    const folderOptions = assertOptions(options, "collection options");

    return ensureCollectionFolder(getRegisteredProjectPath(projectId), {
      name: assertString(folderOptions.name, "name"),
      nodeId: optionalString(folderOptions.nodeId, "nodeId")
    });
  });

  ipcMain.handle(assetChannels.ensureDirectory, (_event, projectId: unknown, options: unknown) => {
    const folderOptions = assertOptions(options, "directory options");

    return ensureDirectoryRoot(getRegisteredProjectPath(projectId), {
      name: assertString(folderOptions.name, "name"),
      nodeId: optionalString(folderOptions.nodeId, "nodeId")
    });
  });

  ipcMain.handle(assetChannels.list, (_event, projectId: unknown, query?: unknown) => {
    const assetQuery =
      query && typeof query === "object" && !Array.isArray(query)
        ? (query as { kind?: unknown })
        : {};

    return listAssets(getRegisteredProjectPath(projectId), {
      kind: optionalString(assetQuery.kind, "kind") as AssetKind | undefined
    });
  });

  ipcMain.handle(assetChannels.saveFakeGenerated, (_event, projectId: unknown, options: unknown) => {
    const generatedOptions = assertOptions(options, "generated asset options");

    return saveGeneratedAsset(getRegisteredProjectPath(projectId), {
      generationNodeId: assertString(generatedOptions.generationNodeId, "generationNodeId"),
      fileName: assertString(generatedOptions.fileName, "fileName"),
      content: optionalString(generatedOptions.content, "content") ?? "",
      mimeType: optionalString(generatedOptions.mimeType, "mimeType")
    });
  });

  ipcMain.handle(assetChannels.moveToCollection, (_event, projectId: unknown, options: unknown) => {
    const moveOptions = assertOptions(options, "move asset options");

    return moveAssetToCollection(getRegisteredProjectPath(projectId), {
      assetId: assertString(moveOptions.assetId, "assetId"),
      collectionId: optionalString(moveOptions.collectionId, "collectionId"),
      collectionName: optionalString(moveOptions.collectionName, "collectionName"),
      reason: optionalString(moveOptions.reason, "reason")
    });
  });

  ipcMain.handle(assetChannels.listMoves, (_event, projectId: unknown, query?: unknown) => {
    const moveQuery =
      query && typeof query === "object" && !Array.isArray(query)
        ? (query as { assetId?: unknown })
        : {};

    return listAssetMoves(getRegisteredProjectPath(projectId), {
      assetId: optionalString(moveQuery.assetId, "assetId")
    });
  });
}

function registerExecutionIpc() {
  ipcMain.handle(
    executionChannels.run,
    (_event, projectId: unknown, graph: unknown, request: unknown) => {
      if (!graph || typeof graph !== "object") {
        throw new Error("graph must be an object.");
      }

      return executeGraphRun(
        getRegisteredProjectPath(projectId),
        graph as EtherGraph,
        assertExecutionRequest(request)
      );
    }
  );
}

function registerProviderIpc() {
  ipcMain.handle(providerChannels.diagnostics, () => getGenerationProviderDiagnostics());
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
registerAssetIpc();
registerExecutionIpc();
registerProviderIpc();

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
