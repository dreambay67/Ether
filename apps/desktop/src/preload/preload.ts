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
  openDroppedDocument: async (file, documentId) => {
    const grant = await grantDroppedFile(file, documentId, "open-document");
    if (!grant.ok) return grant;
    return ipcRenderer.invoke(
      desktopIpcChannels.document.openDropped,
      { documentId, pathGrantId: grant.value.grantId }
    ) as Promise<NormalizedResult<unknown>>;
  },
  importDroppedReference: async (file, input) => {
    const grant = await grantDroppedFile(file, input.documentId, "reference");
    if (!grant.ok) return grant;
    return ipcRenderer.invoke(
      desktopIpcChannels.references.chooseAndLink,
      { ...input, pathGrantId: grant.value.grantId }
    ) as Promise<NormalizedResult<unknown>>;
  }
});

contextBridge.exposeInMainWorld("ether", bridge);

function grantDroppedFile(
  file: File,
  documentId: string,
  purpose: "open-document" | "reference"
): Promise<NormalizedResult<{ grantId: string; displayName: string }>> {
  return ipcRenderer.invoke(
    desktopIpcChannels.permissions.grantDroppedFile,
    { documentId, purpose, nativePath: webUtils.getPathForFile(file) }
  ) as Promise<NormalizedResult<{ grantId: string; displayName: string }>>;
}
