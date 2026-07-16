import { randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import path from "node:path";
import { app, BrowserWindow, Menu, dialog, ipcMain, shell } from "electron";
import {
  addArtifactToCollection,
  clearProviderLogs,
  clearRunArtifacts,
  createProject,
  ensureCollectionFolder,
  ensureDirectoryRoot,
  enqueueRun,
  executeQueuedRun,
  executeGraphRun,
  getGenerationProviderDiagnostics,
  getArtifactById,
  getJobById,
  previewRun,
  type ArtifactKind,
  type AssetKind,
  type EtherGraph,
  type JobStatus,
  type ExecutionPolicy,
  type ExecutionRequest,
  type ProjectOpenResult,
  linkExternalReference,
  listJobDependencies,
  listJobEvents,
  listJobItems,
  listJobs,
  listAssetMoves,
  listAssets,
  listArtifacts,
  listArtifactsByCollection,
  listLineageChildren,
  listLineageParents,
  loadGraph,
  moveAssetToCollection,
  openProject,
  rateArtifact,
  cancelRunJob,
  runHealthCheck,
  saveGeneratedAsset,
  saveMaskAsset,
  saveGraph,
  retryRunItem,
  tagArtifact,
  updateArtifactMetadata
} from "@ether/engine";
import { isLocalDevelopmentRendererUrl } from "./rendererUrl";
import { assertImageFilePathForIpc } from "./assetIpcValidation";
import { createDesktopSettingsStore } from "./settingsStore";
import { createMainWindowOptions } from "./windowOptions";

const projectChannels = {
  defaultParentDirectory: "ether:project:defaultParentDirectory",
  selectParentDirectory: "ether:project:selectParentDirectory",
  selectProjectBundle: "ether:project:selectProjectBundle",
  create: "ether:project:create",
  open: "ether:project:open",
  saveGraph: "ether:project:saveGraph",
  loadGraph: "ether:project:loadGraph",
  health: "ether:project:health",
  clearProviderLogs: "ether:project:clearProviderLogs",
  clearRunArtifacts: "ether:project:clearRunArtifacts"
} as const;

const assetChannels = {
  selectReferenceImage: "ether:asset:selectReferenceImage",
  selectStoreDirectory: "ether:asset:selectStoreDirectory",
  linkDroppedReference: "ether:asset:linkDroppedReference",
  ensureCollection: "ether:asset:ensureCollection",
  ensureDirectory: "ether:asset:ensureDirectory",
  list: "ether:asset:list",
  saveFakeGenerated: "ether:asset:saveFakeGenerated",
  saveMask: "ether:asset:saveMask",
  moveToCollection: "ether:asset:moveToCollection",
  listMoves: "ether:asset:listMoves"
} as const;

const artifactChannels = {
  list: "ether:artifacts:list",
  get: "ether:artifacts:get",
  updateMetadata: "ether:artifacts:updateMetadata",
  tag: "ether:artifacts:tag",
  rate: "ether:artifacts:rate",
  listLineageParents: "ether:artifacts:listLineageParents",
  listLineageChildren: "ether:artifacts:listLineageChildren",
  addToCollection: "ether:artifacts:addToCollection",
  listByCollection: "ether:artifacts:listByCollection",
  revealFile: "ether:artifacts:revealFile"
} as const;

const executionChannels = {
  preview: "ether:execution:preview",
  run: "ether:execution:run",
  jobsList: "ether:execution:jobs:list",
  jobsGet: "ether:execution:jobs:get",
  jobsEnqueue: "ether:execution:jobs:enqueue",
  jobsExecute: "ether:execution:jobs:execute",
  jobsCancel: "ether:execution:jobs:cancel",
  jobsRetryItem: "ether:execution:jobs:retryItem"
} as const;

const providerChannels = {
  diagnostics: "ether:provider:diagnostics",
  health: "ether:provider:health"
} as const;

const settingsChannels = {
  load: "ether:settings:load",
  save: "ether:settings:save"
} as const;

const menuChannels = {
  save: "ether:menu:save"
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
const artifactKinds = new Set<ArtifactKind>([
  "prompt",
  "negative_prompt",
  "reference",
  "image",
  "edit",
  "mask",
  "compare",
  "evaluation",
  "route",
  "collection_membership",
  "report"
]);
const settingsStore = createDesktopSettingsStore(() => path.join(app.getPath("userData"), "settings.json"));

function getDefaultProjectParentDirectory(): string {
  return path.join(app.getPath("documents"), "Ether Projects");
}

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

function assertRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }

  return value as Record<string, unknown>;
}

function optionalRecord(value: unknown, label: string): Record<string, unknown> | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  return assertRecord(value, label);
}

function optionalArtifactKind(value: unknown, label: string): ArtifactKind | undefined {
  const kind = optionalString(value, label);

  if (!kind) {
    return undefined;
  }

  if (!artifactKinds.has(kind as ArtifactKind)) {
    throw new Error(`${label} must be a known artifact kind.`);
  }

  return kind as ArtifactKind;
}

function optionalFiniteNumber(value: unknown, label: string): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number.`);
  }

  return value;
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

function optionalJobStatuses(value: unknown): JobStatus[] | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw new Error("statuses must be an array.");
  }

  const validStatuses = new Set<JobStatus>(["queued", "running", "completed", "failed", "canceled"]);
  return value.map((entry, index) => {
    const status = assertString(entry, `statuses[${index}]`);

    if (!validStatuses.has(status as JobStatus)) {
      throw new Error("Unknown job status.");
    }

    return status as JobStatus;
  });
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
  ipcMain.handle(projectChannels.defaultParentDirectory, () => getDefaultProjectParentDirectory());

  ipcMain.handle(projectChannels.selectParentDirectory, async () => {
    const result = await dialog.showOpenDialog({
      title: "Choose project parent folder",
      properties: ["openDirectory", "createDirectory"]
    });

    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0];
  });

  ipcMain.handle(projectChannels.selectProjectBundle, async () => {
    const result = await dialog.showOpenDialog({
      title: "Open .ether project bundle",
      properties: process.platform === "win32" ? ["openDirectory"] : ["openFile", "openDirectory"],
      filters: process.platform === "win32"
        ? undefined
        : [
            {
              name: "Ether Projects",
              extensions: ["ether"]
            }
          ]
    });

    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0];
  });

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

  ipcMain.handle(projectChannels.clearProviderLogs, (_event, projectId: unknown) => {
    return clearProviderLogs(getRegisteredProjectPath(projectId));
  });

  ipcMain.handle(projectChannels.clearRunArtifacts, (_event, projectId: unknown) => {
    return clearRunArtifacts(getRegisteredProjectPath(projectId));
  });
}

function registerAssetIpc() {
  ipcMain.handle(assetChannels.selectStoreDirectory, async () => {
    const result = await dialog.showOpenDialog({
      title: "Choose Store folder",
      properties: ["openDirectory", "createDirectory"]
    });

    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0];
  });

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
      nodeId: optionalString(folderOptions.nodeId, "nodeId"),
      path: optionalString(folderOptions.path, "path")
    });
  });

  ipcMain.handle(assetChannels.ensureDirectory, (_event, projectId: unknown, options: unknown) => {
    const folderOptions = assertOptions(options, "directory options");

    return ensureDirectoryRoot(getRegisteredProjectPath(projectId), {
      name: assertString(folderOptions.name, "name"),
      nodeId: optionalString(folderOptions.nodeId, "nodeId"),
      path: optionalString(folderOptions.path, "path")
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

  ipcMain.handle(assetChannels.saveMask, (_event, projectId: unknown, options: unknown) => {
    const maskOptions = assertOptions(options, "mask asset options");
    const metadata =
      maskOptions.metadata && typeof maskOptions.metadata === "object" && !Array.isArray(maskOptions.metadata)
        ? (maskOptions.metadata as Record<string, unknown>)
        : undefined;

    return saveMaskAsset(getRegisteredProjectPath(projectId), {
      editNodeId: assertString(maskOptions.editNodeId, "editNodeId"),
      sourceAssetId: optionalString(maskOptions.sourceAssetId, "sourceAssetId"),
      sourceAssetPath: optionalString(maskOptions.sourceAssetPath, "sourceAssetPath"),
      fileName: optionalString(maskOptions.fileName, "fileName"),
      content: optionalString(maskOptions.content, "content"),
      mimeType: optionalString(maskOptions.mimeType, "mimeType"),
      instruction: optionalString(maskOptions.instruction, "instruction"),
      notes: optionalString(maskOptions.notes, "notes"),
      metadata
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

function registerArtifactIpc() {
  ipcMain.handle(artifactChannels.list, (_event, projectId: unknown, query?: unknown) => {
    const artifactQuery =
      query && typeof query === "object" && !Array.isArray(query)
        ? (query as { kind?: unknown; type?: unknown; collectionId?: unknown; search?: unknown })
        : {};

    return listArtifacts(getRegisteredProjectPath(projectId), {
      kind: optionalArtifactKind(artifactQuery.kind, "kind"),
      type: optionalArtifactKind(artifactQuery.type, "type"),
      collectionId: optionalString(artifactQuery.collectionId, "collectionId"),
      search: optionalString(artifactQuery.search, "search")
    });
  });

  ipcMain.handle(artifactChannels.get, (_event, projectId: unknown, artifactId: unknown) => {
    return getArtifactById(getRegisteredProjectPath(projectId), assertString(artifactId, "artifactId"));
  });

  ipcMain.handle(artifactChannels.updateMetadata, (_event, projectId: unknown, options: unknown) => {
    const metadataOptions = assertOptions(options, "artifact metadata options");

    return updateArtifactMetadata(getRegisteredProjectPath(projectId), {
      artifactId: assertString(metadataOptions.artifactId, "artifactId"),
      metadata: assertRecord(metadataOptions.metadata, "metadata")
    });
  });

  ipcMain.handle(artifactChannels.tag, (_event, projectId: unknown, options: unknown) => {
    const tagOptions = assertOptions(options, "artifact tag options");

    return tagArtifact(getRegisteredProjectPath(projectId), {
      artifactId: assertString(tagOptions.artifactId, "artifactId"),
      tag: assertString(tagOptions.tag, "tag"),
      color: optionalString(tagOptions.color, "color"),
      metadata: optionalRecord(tagOptions.metadata, "metadata")
    });
  });

  ipcMain.handle(artifactChannels.rate, (_event, projectId: unknown, options: unknown) => {
    const ratingOptions = assertOptions(options, "artifact rating options");
    const rating = optionalFiniteNumber(ratingOptions.rating, "rating");

    if (rating === undefined) {
      throw new Error("rating is required.");
    }

    return rateArtifact(getRegisteredProjectPath(projectId), {
      artifactId: assertString(ratingOptions.artifactId, "artifactId"),
      rating,
      note: optionalString(ratingOptions.note, "note"),
      source: optionalString(ratingOptions.source, "source")
    });
  });

  ipcMain.handle(artifactChannels.listLineageParents, (_event, projectId: unknown, artifactId: unknown) => {
    return listLineageParents(getRegisteredProjectPath(projectId), assertString(artifactId, "artifactId"));
  });

  ipcMain.handle(artifactChannels.listLineageChildren, (_event, projectId: unknown, artifactId: unknown) => {
    return listLineageChildren(getRegisteredProjectPath(projectId), assertString(artifactId, "artifactId"));
  });

  ipcMain.handle(artifactChannels.addToCollection, (_event, projectId: unknown, options: unknown) => {
    const collectionOptions = assertOptions(options, "artifact collection options");

    return addArtifactToCollection(getRegisteredProjectPath(projectId), {
      artifactId: assertString(collectionOptions.artifactId, "artifactId"),
      collectionId: assertString(collectionOptions.collectionId, "collectionId"),
      position: optionalFiniteNumber(collectionOptions.position, "position"),
      metadata: optionalRecord(collectionOptions.metadata, "metadata")
    });
  });

  ipcMain.handle(artifactChannels.listByCollection, (_event, projectId: unknown, collectionId: unknown) => {
    return listArtifactsByCollection(
      getRegisteredProjectPath(projectId),
      assertString(collectionId, "collectionId")
    );
  });

  ipcMain.handle(artifactChannels.revealFile, async (_event, projectId: unknown, artifactId: unknown) => {
    const projectPath = getRegisteredProjectPath(projectId);
    const artifact = await getArtifactById(projectPath, assertString(artifactId, "artifactId"));

    if (!artifact?.path) {
      throw new Error("Artifact does not have a file path to reveal.");
    }

    shell.showItemInFolder(artifact.path);
  });
}

function registerExecutionIpc() {
  ipcMain.handle(
    executionChannels.preview,
    (_event, projectId: unknown, graph: unknown, request: unknown) => {
      if (!graph || typeof graph !== "object") {
        throw new Error("graph must be an object.");
      }

      return previewRun(
        getRegisteredProjectPath(projectId),
        graph as EtherGraph,
        assertExecutionRequest(request)
      );
    }
  );

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

  ipcMain.handle(executionChannels.jobsList, (_event, projectId: unknown, query?: unknown) => {
    const jobQuery =
      query && typeof query === "object" && !Array.isArray(query)
        ? (query as { statuses?: unknown })
        : {};

    return listJobs(getRegisteredProjectPath(projectId), {
      statuses: optionalJobStatuses(jobQuery.statuses)
    });
  });

  ipcMain.handle(executionChannels.jobsGet, async (_event, projectId: unknown, jobId: unknown) => {
    const projectPath = getRegisteredProjectPath(projectId);
    const id = assertString(jobId, "jobId");
    const job = await getJobById(projectPath, id);

    if (!job) {
      return null;
    }

    const [items, dependencies, events] = await Promise.all([
      listJobItems(projectPath, id),
      listJobDependencies(projectPath, id),
      listJobEvents(projectPath, id)
    ]);

    return {
      job,
      items,
      dependencies,
      events
    };
  });

  ipcMain.handle(
    executionChannels.jobsEnqueue,
    (_event, projectId: unknown, graph: unknown, request: unknown) => {
      if (!graph || typeof graph !== "object") {
        throw new Error("graph must be an object.");
      }

      return enqueueRun(
        getRegisteredProjectPath(projectId),
        graph as EtherGraph,
        assertExecutionRequest(request)
      );
    }
  );

  ipcMain.handle(executionChannels.jobsExecute, (_event, projectId: unknown, jobId: unknown) => {
    return executeQueuedRun(getRegisteredProjectPath(projectId), assertString(jobId, "jobId"));
  });

  ipcMain.handle(executionChannels.jobsCancel, (_event, projectId: unknown, jobId: unknown) => {
    return cancelRunJob(getRegisteredProjectPath(projectId), assertString(jobId, "jobId"));
  });

  ipcMain.handle(executionChannels.jobsRetryItem, (_event, projectId: unknown, jobItemId: unknown) => {
    return retryRunItem(getRegisteredProjectPath(projectId), assertString(jobItemId, "jobItemId"));
  });
}

function registerProviderIpc() {
  ipcMain.handle(providerChannels.diagnostics, () => getGenerationProviderDiagnostics());
  ipcMain.handle(providerChannels.health, () => getGenerationProviderDiagnostics());
}

function registerSettingsIpc() {
  ipcMain.handle(settingsChannels.load, () => settingsStore.load());
  ipcMain.handle(settingsChannels.save, (_event, settings: unknown) => {
    if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
      throw new Error("settings must be an object.");
    }

    return settingsStore.save(settings);
  });
}

function installApplicationMenu(mainWindow: BrowserWindow) {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: "File",
      submenu: [
        {
          label: "Save",
          accelerator: "CommandOrControl+S",
          click: () => mainWindow.webContents.send(menuChannels.save)
        },
        { type: "separator" },
        { role: "quit" }
      ]
    },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
    {
      label: "Help",
      submenu: [{ role: "about" }]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

const createMainWindow = () => {
  const mainWindow = new BrowserWindow(
    createMainWindowOptions(path.join(__dirname, "../preload/preload.js"))
  );

  installApplicationMenu(mainWindow);

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
registerArtifactIpc();
registerExecutionIpc();
registerProviderIpc();
registerSettingsIpc();

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
