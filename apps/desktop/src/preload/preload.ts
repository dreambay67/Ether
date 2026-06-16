import { contextBridge, ipcRenderer } from "electron";

const projectChannels = {
  create: "ether:project:create",
  open: "ether:project:open",
  saveGraph: "ether:project:saveGraph",
  loadGraph: "ether:project:loadGraph",
  health: "ether:project:health"
} as const;

contextBridge.exposeInMainWorld("ether", {
  shell: "desktop",
  project: {
    create: (options: { parentDirectory: string; name: string }) =>
      ipcRenderer.invoke(projectChannels.create, options),
    open: (projectPath: string) => ipcRenderer.invoke(projectChannels.open, projectPath),
    saveGraph: (projectPath: string, graph: unknown) =>
      ipcRenderer.invoke(projectChannels.saveGraph, projectPath, graph),
    loadGraph: (projectPath: string) => ipcRenderer.invoke(projectChannels.loadGraph, projectPath),
    health: (projectPath: string) => ipcRenderer.invoke(projectChannels.health, projectPath)
  }
});
