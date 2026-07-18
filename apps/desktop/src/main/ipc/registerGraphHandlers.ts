import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from "electron";

import { desktopIpcChannels } from "../../shared/ipc/channels.js";
import {
  assertAuthorizedSenderFrame,
  assertTrustedIpcSender,
  desktopIpcContracts,
  normalizeDesktopError
} from "../../shared/ipc/contracts.js";
import type { DesktopApplicationService } from "../services/applicationService.js";

export function registerGraphHandlers(options: {
  ipcMain: IpcMain;
  mainWindow: BrowserWindow;
  rendererUrl: string;
  service: DesktopApplicationService;
}): () => void {
  const { ipcMain, mainWindow, rendererUrl, service } = options;
  const channels = [desktopIpcChannels.graph.snapshot, desktopIpcChannels.graph.applyTransaction] as const;

  ipcMain.handle(desktopIpcChannels.graph.snapshot, async (event, input) => {
    const contract = desktopIpcContracts[desktopIpcChannels.graph.snapshot];
    try {
      assertSender(event, mainWindow, rendererUrl);
      const request = contract.request.parse(input);
      const value = await service.graphSnapshot(request.documentId);
      return contract.response.parse({ ok: true, value });
    } catch (error) {
      return contract.response.parse({ ok: false, error: normalizeDesktopError(error) });
    }
  });

  ipcMain.handle(desktopIpcChannels.graph.applyTransaction, async (event, input) => {
    const contract = desktopIpcContracts[desktopIpcChannels.graph.applyTransaction];
    try {
      assertSender(event, mainWindow, rendererUrl);
      const request = contract.request.parse(input);
      const value = await service.applyGraphTransaction(request.documentId, request.transaction);
      return contract.response.parse({ ok: true, value });
    } catch (error) {
      return contract.response.parse({ ok: false, error: normalizeDesktopError(error) });
    }
  });

  return () => channels.forEach((channel) => ipcMain.removeHandler(channel));
}

function assertSender(event: IpcMainInvokeEvent, mainWindow: BrowserWindow, rendererUrl: string): void {
  assertAuthorizedSenderFrame(event.senderFrame, mainWindow.webContents.mainFrame);
  const senderFrameUrl = event.senderFrame?.url ?? "";
  let origin = "";
  try {
    const parsed = new URL(senderFrameUrl);
    origin = parsed.protocol === "file:" ? "null" : parsed.origin;
  } catch {
    // Shared validation returns the normalized security error.
  }
  assertTrustedIpcSender(
    { webContentsId: event.sender.id, senderFrameUrl, origin },
    { rendererUrl, webContentsId: mainWindow.webContents.id }
  );
}
