import { contextBridge, ipcRenderer, webUtils } from "electron";
import { createDroppedFilePathReader } from "./filePathBridge";

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

const getDroppedFilePath = createDroppedFilePathReader(webUtils);

contextBridge.exposeInMainWorld("ether", {
  shell: "desktop",
  file: {
    getDroppedFilePath
  },
  project: {
    defaultParentDirectory: () => ipcRenderer.invoke(projectChannels.defaultParentDirectory),
    selectParentDirectory: () => ipcRenderer.invoke(projectChannels.selectParentDirectory),
    selectProjectBundle: () => ipcRenderer.invoke(projectChannels.selectProjectBundle),
    create: (options: { parentDirectory: string; name: string }) =>
      ipcRenderer.invoke(projectChannels.create, options),
    open: (projectPath: string) => ipcRenderer.invoke(projectChannels.open, projectPath),
    saveGraph: (projectId: string, graph: unknown) =>
      ipcRenderer.invoke(projectChannels.saveGraph, projectId, graph),
    loadGraph: (projectId: string) => ipcRenderer.invoke(projectChannels.loadGraph, projectId),
    health: (projectId: string) => ipcRenderer.invoke(projectChannels.health, projectId),
    clearProviderLogs: (projectId: string) =>
      ipcRenderer.invoke(projectChannels.clearProviderLogs, projectId),
    clearRunArtifacts: (projectId: string) =>
      ipcRenderer.invoke(projectChannels.clearRunArtifacts, projectId)
  },
  asset: {
    selectReferenceImage: (projectId: string, options?: { role?: string }) =>
      ipcRenderer.invoke(assetChannels.selectReferenceImage, projectId, options),
    selectStoreDirectory: () => ipcRenderer.invoke(assetChannels.selectStoreDirectory),
    linkDroppedReference: (projectId: string, filePath: string, options?: { role?: string }) =>
      ipcRenderer.invoke(assetChannels.linkDroppedReference, projectId, filePath, options),
    ensureCollection: (projectId: string, options: { name: string; nodeId?: string; path?: string }) =>
      ipcRenderer.invoke(assetChannels.ensureCollection, projectId, options),
    ensureDirectory: (projectId: string, options: { name: string; nodeId?: string; path?: string }) =>
      ipcRenderer.invoke(assetChannels.ensureDirectory, projectId, options),
    list: (projectId: string, query?: { kind?: string }) =>
      ipcRenderer.invoke(assetChannels.list, projectId, query),
    saveFakeGenerated: (
      projectId: string,
      options: { generationNodeId: string; fileName: string; content?: string; mimeType?: string }
    ) => ipcRenderer.invoke(assetChannels.saveFakeGenerated, projectId, options),
    saveMask: (
      projectId: string,
      options: {
        editNodeId: string;
        sourceAssetId?: string;
        sourceAssetPath?: string;
        fileName?: string;
        content?: string;
        mimeType?: string;
        instruction?: string;
        notes?: string;
        metadata?: Record<string, unknown>;
      }
    ) => ipcRenderer.invoke(assetChannels.saveMask, projectId, options),
    moveToCollection: (
      projectId: string,
      options: { assetId: string; collectionId?: string; collectionName?: string; reason?: string }
    ) => ipcRenderer.invoke(assetChannels.moveToCollection, projectId, options),
    listMoves: (projectId: string, query?: { assetId?: string }) =>
      ipcRenderer.invoke(assetChannels.listMoves, projectId, query)
  },
  artifacts: {
    list: (projectId: string, query?: { kind?: string; type?: string; collectionId?: string; search?: string }) =>
      ipcRenderer.invoke(artifactChannels.list, projectId, query),
    get: (projectId: string, artifactId: string) =>
      ipcRenderer.invoke(artifactChannels.get, projectId, artifactId),
    updateMetadata: (projectId: string, options: { artifactId: string; metadata: Record<string, unknown> }) =>
      ipcRenderer.invoke(artifactChannels.updateMetadata, projectId, options),
    tag: (projectId: string, options: { artifactId: string; tag: string; color?: string; metadata?: Record<string, unknown> }) =>
      ipcRenderer.invoke(artifactChannels.tag, projectId, options),
    rate: (projectId: string, options: { artifactId: string; rating: number; note?: string; source?: string }) =>
      ipcRenderer.invoke(artifactChannels.rate, projectId, options),
    listLineageParents: (projectId: string, artifactId: string) =>
      ipcRenderer.invoke(artifactChannels.listLineageParents, projectId, artifactId),
    listLineageChildren: (projectId: string, artifactId: string) =>
      ipcRenderer.invoke(artifactChannels.listLineageChildren, projectId, artifactId),
    addToCollection: (
      projectId: string,
      options: { artifactId: string; collectionId: string; position?: number; metadata?: Record<string, unknown> }
    ) => ipcRenderer.invoke(artifactChannels.addToCollection, projectId, options),
    listByCollection: (projectId: string, collectionId: string) =>
      ipcRenderer.invoke(artifactChannels.listByCollection, projectId, collectionId),
    revealFile: (projectId: string, artifactId: string) =>
      ipcRenderer.invoke(artifactChannels.revealFile, projectId, artifactId)
  },
  execution: {
    preview: (projectId: string, graph: unknown, request: unknown) =>
      ipcRenderer.invoke(executionChannels.preview, projectId, graph, request),
    run: (projectId: string, graph: unknown, request: unknown) =>
      ipcRenderer.invoke(executionChannels.run, projectId, graph, request),
    jobs: {
      list: (projectId: string, query?: { statuses?: string[] }) =>
        ipcRenderer.invoke(executionChannels.jobsList, projectId, query),
      get: (projectId: string, jobId: string) =>
        ipcRenderer.invoke(executionChannels.jobsGet, projectId, jobId),
      enqueue: (projectId: string, graph: unknown, request: unknown) =>
        ipcRenderer.invoke(executionChannels.jobsEnqueue, projectId, graph, request),
      execute: (projectId: string, jobId: string) =>
        ipcRenderer.invoke(executionChannels.jobsExecute, projectId, jobId),
      cancel: (projectId: string, jobId: string) =>
        ipcRenderer.invoke(executionChannels.jobsCancel, projectId, jobId),
      retryItem: (projectId: string, jobItemId: string) =>
        ipcRenderer.invoke(executionChannels.jobsRetryItem, projectId, jobItemId)
    }
  },
  provider: {
    diagnostics: () => ipcRenderer.invoke(providerChannels.diagnostics),
    health: () => ipcRenderer.invoke(providerChannels.health)
  },
  settings: {
    load: () => ipcRenderer.invoke(settingsChannels.load),
    save: (settings: unknown) => ipcRenderer.invoke(settingsChannels.save, settings)
  },
  menu: {
    onSave: (handler: () => void) => {
      const listener = () => handler();
      ipcRenderer.on(menuChannels.save, listener);

      return () => ipcRenderer.removeListener(menuChannels.save, listener);
    }
  }
});
