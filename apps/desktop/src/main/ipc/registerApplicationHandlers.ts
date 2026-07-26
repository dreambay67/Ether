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
  onRendererInteractive?: () => void;
}): () => void {
  const { ipcMain, mainWindow, rendererUrl, service } = options;
  const commandChannel = desktopIpcChannels.application.command;
  const queryChannel = desktopIpcChannels.application.query;
  const chooseReferenceChannel = desktopIpcChannels.references.chooseAndLink;
  const rendererInteractiveChannel = desktopIpcChannels.runtime.rendererInteractive;

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

  ipcMain.handle(chooseReferenceChannel, async (event, input) => {
    const contract = desktopIpcContracts[chooseReferenceChannel];
    try {
      assertSender(event, mainWindow, rendererUrl);
      const request = contract.request.parse(input);
      const value = await service.chooseAndLinkReference(request);
      return contract.response.parse({ ok: true, value });
    } catch (error) {
      return contract.response.parse({ ok: false, error: normalizeDesktopError(error) });
    }
  });

  ipcMain.handle(rendererInteractiveChannel, async (event, input) => {
    const contract = desktopIpcContracts[rendererInteractiveChannel];
    try {
      assertSender(event, mainWindow, rendererUrl);
      contract.request.parse(input);
      options.onRendererInteractive?.();
      return contract.response.parse({ ok: true, value: null });
    } catch (error) {
      return contract.response.parse({ ok: false, error: normalizeDesktopError(error) });
    }
  });

  const disposeEvents = service.subscribeApplication((event) => {
    if (!mainWindow.isDestroyed()) {
      const contract = desktopIpcContracts[desktopIpcChannels.application.event];
      mainWindow.webContents.send(desktopIpcChannels.application.event, contract.request.parse(event));
    }
  });

  return () => {
    ipcMain.removeHandler(commandChannel);
    ipcMain.removeHandler(queryChannel);
    ipcMain.removeHandler(chooseReferenceChannel);
    ipcMain.removeHandler(rendererInteractiveChannel);
    disposeEvents();
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
