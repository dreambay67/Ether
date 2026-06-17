import { contextBridge, ipcRenderer, webUtils } from "electron";
import { createDroppedFilePathReader } from "./filePathBridge";

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
  saveMask: "ether:asset:saveMask",
  moveToCollection: "ether:asset:moveToCollection",
  listMoves: "ether:asset:listMoves"
} as const;

const executionChannels = {
  run: "ether:execution:run"
} as const;

const providerChannels = {
  diagnostics: "ether:provider:diagnostics"
} as const;

const settingsChannels = {
  load: "ether:settings:load",
  save: "ether:settings:save"
} as const;

const getDroppedFilePath = createDroppedFilePathReader(webUtils);

contextBridge.exposeInMainWorld("ether", {
  shell: "desktop",
  file: {
    getDroppedFilePath
  },
  project: {
    create: (options: { parentDirectory: string; name: string }) =>
      ipcRenderer.invoke(projectChannels.create, options),
    open: (projectPath: string) => ipcRenderer.invoke(projectChannels.open, projectPath),
    saveGraph: (projectId: string, graph: unknown) =>
      ipcRenderer.invoke(projectChannels.saveGraph, projectId, graph),
    loadGraph: (projectId: string) => ipcRenderer.invoke(projectChannels.loadGraph, projectId),
    health: (projectId: string) => ipcRenderer.invoke(projectChannels.health, projectId)
  },
  asset: {
    selectReferenceImage: (projectId: string, options?: { role?: string }) =>
      ipcRenderer.invoke(assetChannels.selectReferenceImage, projectId, options),
    linkDroppedReference: (projectId: string, filePath: string, options?: { role?: string }) =>
      ipcRenderer.invoke(assetChannels.linkDroppedReference, projectId, filePath, options),
    ensureCollection: (projectId: string, options: { name: string; nodeId?: string }) =>
      ipcRenderer.invoke(assetChannels.ensureCollection, projectId, options),
    ensureDirectory: (projectId: string, options: { name: string; nodeId?: string }) =>
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
  execution: {
    run: (projectId: string, graph: unknown, request: unknown) =>
      ipcRenderer.invoke(executionChannels.run, projectId, graph, request)
  },
  provider: {
    diagnostics: () => ipcRenderer.invoke(providerChannels.diagnostics)
  },
  settings: {
    load: () => ipcRenderer.invoke(settingsChannels.load),
    save: (settings: unknown) => ipcRenderer.invoke(settingsChannels.save, settings)
  }
});
