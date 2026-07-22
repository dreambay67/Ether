import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from "electron";

import { desktopIpcChannels } from "../../shared/ipc/channels.js";
import {
  assertAuthorizedSenderFrame,
  assertTrustedIpcSender,
  desktopIpcContracts,
  normalizeDesktopError
} from "../../shared/ipc/contracts.js";
import type { DesktopApplicationService } from "../services/applicationService.js";

export function registerApplicationHandlers(options: {
  ipcMain: IpcMain;
  mainWindow: BrowserWindow;
  rendererUrl: string;
  service: DesktopApplicationService;
}): () => void {
  const { ipcMain, mainWindow, rendererUrl, service } = options;
  const commandChannel = desktopIpcChannels.application.command;
  const queryChannel = desktopIpcChannels.application.query;

  ipcMain.handle(commandChannel, async (event, input) => {
    const contract = desktopIpcContracts[commandChannel];
    try {
      assertSender(event, mainWindow, rendererUrl);
      const command = contract.request.parse(input);
      const value = await service.executeApplicationCommand(command);
      return contract.response.parse({ ok: true, value });
    } catch (error) {
      return contract.response.parse({ ok: false, error: normalizeDesktopError(error) });
    }
  });

  ipcMain.handle(queryChannel, async (event, input) => {
    const contract = desktopIpcContracts[queryChannel];
    try {
      assertSender(event, mainWindow, rendererUrl);
      const query = contract.request.parse(input);
      const value = await service.executeApplicationQuery(query);
      return contract.response.parse({ ok: true, value });
    } catch (error) {
      return contract.response.parse({ ok: false, error: normalizeDesktopError(error) });
    }
  });

  return () => {
    ipcMain.removeHandler(commandChannel);
    ipcMain.removeHandler(queryChannel);
  };
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
