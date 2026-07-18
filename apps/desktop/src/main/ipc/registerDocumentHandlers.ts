import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from "electron";

import { desktopIpcChannels } from "../../shared/ipc/channels.js";
import {
  assertAuthorizedSenderFrame,
  assertTrustedIpcSender,
  desktopIpcContracts,
  normalizeDesktopError,
  type DesktopIpcChannel
} from "../../shared/ipc/contracts.js";
import type { DesktopApplicationService } from "../services/applicationService.js";

type Handler = (
  request: Record<string, never> | { documentId: string } | { path: string }
) => Promise<unknown> | unknown;

export function registerDocumentHandlers(options: {
  ipcMain: IpcMain;
  mainWindow: BrowserWindow;
  rendererUrl: string;
  service: DesktopApplicationService;
  openDocument(): Promise<unknown>;
  openPath(filePath: string): Promise<unknown>;
}): () => void {
  const { ipcMain, mainWindow, rendererUrl, service, openDocument, openPath } = options;
  const registrations: Array<[DesktopIpcChannel, Handler]> = [
    [desktopIpcChannels.document.bootstrap, () => service.bootstrap()],
    [desktopIpcChannels.document.new, () => service.newDocument()],
    [desktopIpcChannels.document.open, () => openDocument()],
    [desktopIpcChannels.document.openDropped, (request) => {
      const dropped = request as { path: string };
      return openPath(dropped.path);
    }],
    [desktopIpcChannels.document.save, (request) => service.save(scopedId(request))],
    [desktopIpcChannels.document.saveAs, (request) => service.saveAs(scopedId(request))],
    [desktopIpcChannels.document.saveCopy, (request) => service.saveCopy(scopedId(request))],
    [desktopIpcChannels.document.compact, (request) => service.compact(scopedId(request))],
    [desktopIpcChannels.document.makePortable, (request) => service.makePortable(scopedId(request))],
    [desktopIpcChannels.document.close, async (request) => {
      if (service.snapshot().documentId !== scopedId(request)) scopeError();
      await service.closeDocument();
      return null;
    }],
    [desktopIpcChannels.artifacts.search, (request) => {
      const search = request as { documentId: string; text: string };
      return service.searchArtifacts(search.documentId, search.text);
    }],
    [desktopIpcChannels.artifacts.generateFake, (request) => service.generateFakeArtifact(scopedId(request))],
    [desktopIpcChannels.references.list, (request) => service.listReferences(scopedId(request))],
    [desktopIpcChannels.references.act, (request) => {
      const action = request as { documentId: string; referenceId: string; action: string };
      return service.actOnReference(action.documentId, action.referenceId, action.action);
    }],
    [desktopIpcChannels.runtime.versions, () => ({
      electron: process.versions.electron ?? "unknown",
      node: process.versions.node
    })]
  ];

  for (const [channel, handler] of registrations) {
    ipcMain.handle(channel, async (event, input) => {
      try {
        assertSender(event, mainWindow, rendererUrl);
        const request = desktopIpcContracts[channel].request.parse(input) as Parameters<Handler>[0];
        const value = await handler(request);
        return desktopIpcContracts[channel].response.parse({ ok: true, value });
      } catch (error) {
        return desktopIpcContracts[channel].response.parse({ ok: false, error: normalizeDesktopError(error) });
      }
    });
  }

  const unsubscribe = service.subscribe((event) => {
    if (!mainWindow.isDestroyed()) mainWindow.webContents.send(desktopIpcChannels.document.event, event);
  });
  return () => {
    unsubscribe();
    for (const [channel] of registrations) ipcMain.removeHandler(channel);
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
    {
      webContentsId: event.sender.id,
      senderFrameUrl,
      origin
    },
    { rendererUrl, webContentsId: mainWindow.webContents.id }
  );
}

function scopeError(): never {
  throw Object.assign(new Error("The request does not target the active document."), {
    code: "DOCUMENT_SCOPE_REJECTED"
  });
}

function scopedId(request: Parameters<Handler>[0]): string {
  if (!("documentId" in request) || typeof request.documentId !== "string") scopeError();
  return request.documentId;
}
