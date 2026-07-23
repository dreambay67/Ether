import { contextBridge, ipcRenderer, webUtils } from "electron";

import type { DesktopIpcChannel, NormalizedResult } from "../shared/ipc/contracts";
import { desktopIpcChannels } from "../shared/ipc/channels";
import { createEtherBridge } from "./filePathBridge";

const bridge = createEtherBridge({
  invoke: (channel: DesktopIpcChannel, request: unknown) =>
    ipcRenderer.invoke(channel, request) as Promise<NormalizedResult<unknown>>,
  subscribe: (channel, listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: unknown) => listener(payload);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
  openDroppedDocument: (file) => ipcRenderer.invoke(
    desktopIpcChannels.document.openDropped,
    { path: webUtils.getPathForFile(file) }
  ) as Promise<NormalizedResult<unknown>>,
  importDroppedReference: (file, input) => ipcRenderer.invoke(
    desktopIpcChannels.references.chooseAndLink,
    { ...input, droppedPath: webUtils.getPathForFile(file) }
  ) as Promise<NormalizedResult<unknown>>
});

contextBridge.exposeInMainWorld("ether", bridge);
