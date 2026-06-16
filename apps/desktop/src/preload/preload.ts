import { contextBridge, ipcRenderer } from "electron";

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
  saveFakeGenerated: "ether:asset:saveFakeGenerated"
} as const;

contextBridge.exposeInMainWorld("ether", {
  shell: "desktop",
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
    ) => ipcRenderer.invoke(assetChannels.saveFakeGenerated, projectId, options)
  }
});
