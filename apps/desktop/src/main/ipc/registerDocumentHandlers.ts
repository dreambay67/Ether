import { nativeImage, type BrowserWindow, type IpcMain, type IpcMainInvokeEvent } from "electron";

import { desktopIpcChannels } from "../../shared/ipc/channels.js";
import {
  assertAuthorizedSenderFrame,
  assertTrustedIpcSender,
  desktopIpcContracts,
  normalizeDesktopError,
  type DesktopIpcChannel
} from "../../shared/ipc/contracts.js";
import type { DesktopApplicationService } from "../services/applicationService.js";
import type { ProviderService } from "../services/providerService.js";

type Handler = (request: Record<string, unknown>) => Promise<unknown> | unknown;

export function registerDocumentHandlers(options: {
  appVersion: string;
  ipcMain: IpcMain;
  mainWindow: BrowserWindow;
  rendererUrl: string;
  service: DesktopApplicationService;
  providerService?: ProviderService | null;
  getProviderPolicy?: () => { antigravityCreditOveragesConfirmed: boolean };
  setProviderPolicy?: (confirmed: boolean) => Promise<{
    antigravityCreditOveragesConfirmed: boolean;
  }>;
  bootstrapDocument?: () => Promise<unknown>;
  openDocument(): Promise<unknown>;
  openPath(filePath: string): Promise<unknown>;
}): () => void {
  const { appVersion, ipcMain, mainWindow, rendererUrl, service, openDocument, openPath, providerService } = options;
  const registrations: Array<[DesktopIpcChannel, Handler]> = [
    [desktopIpcChannels.document.bootstrap, () => options.bootstrapDocument?.() ?? service.bootstrap()],
    [desktopIpcChannels.document.new, () => service.newDocument()],
    [desktopIpcChannels.document.open, () => openDocument()],
    [desktopIpcChannels.document.openDropped, (request) => {
      const dropped = request as { documentId: string; pathGrantId: string };
      return openPath(service.consumeDroppedDocumentGrant(dropped.documentId, dropped.pathGrantId));
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
    [desktopIpcChannels.artifacts.startDrag, async (request) => {
      const drag = request as { documentId: string; artifactIds: string[] };
      const paths = await service.prepareArtifactDrag(drag.documentId, drag.artifactIds);
      if (paths[0] === undefined) throw new Error("Drag export produced no files.");
      mainWindow.webContents.startDrag({ file: paths[0], icon: nativeImage.createEmpty() });
      return null;
    }],
    [desktopIpcChannels.permissions.grantFolder, (request) => {
      const grant = request as { documentId: string; purpose: "export" | "live-output" };
      return service.grantFolder(grant.documentId, grant.purpose);
    }],
    [desktopIpcChannels.permissions.grantDroppedFile, (request) => {
      const grant = request as {
        documentId: string;
        purpose: "open-document" | "reference";
        nativePath: string;
      };
      return service.grantDroppedFile(grant.documentId, grant.purpose, grant.nativePath);
    }],
    [desktopIpcChannels.references.list, (request) => service.listReferences(scopedId(request))],
    [desktopIpcChannels.references.act, (request) => {
      const action = request as { documentId: string; referenceId: string; action: string };
      return service.actOnReference(action.documentId, action.referenceId, action.action);
    }],
    [desktopIpcChannels.runtime.versions, () => ({
      app: appVersion,
      electron: process.versions.electron ?? "unknown",
      node: process.versions.node
    })],
    [desktopIpcChannels.runtime.providerHealth, () => providerService?.providerHealth() ?? ({
      providerId: "codex-chatgpt-image-2",
      status: "unavailable",
      message: "Codex runtime is disabled in simulation mode.",
      checkedAt: new Date().toISOString(),
      transport: "unavailable",
      version: null,
      manifestHash: null,
      generation: 0,
      restartCount: 0,
      restartReason: null,
      fallbackReason: null,
      processPhase: "none",
      threadId: null,
      turnId: null,
      timing: { startedAt: null, initializedAt: null, initializationMs: null, lastExitAt: null }
    })],
    [desktopIpcChannels.runtime.providerPolicy, () =>
      options.getProviderPolicy?.() ?? {
        antigravityCreditOveragesConfirmed: false
      }],
    [desktopIpcChannels.runtime.setProviderPolicy, async (request) => {
      const policy = request as { antigravityCreditOveragesConfirmed: boolean };
      if (options.setProviderPolicy === undefined) {
        throw Object.assign(
          new Error("Provider policy cannot be changed while providers are disabled."),
          { category: "provider", code: "PROVIDER_POLICY_UNAVAILABLE" }
        );
      }
      return options.setProviderPolicy(policy.antigravityCreditOveragesConfirmed);
    }],
    [desktopIpcChannels.runtime.geminiCredentialStatus, () => providerService?.geminiCredentialStatus() ?? {
      state: "encryption-unavailable" as const,
      verifiedAt: null
    }],
    [desktopIpcChannels.runtime.connectGeminiCredential, (request) => {
      if (providerService === undefined || providerService === null) throw geminiUnavailable();
      return providerService.connectGeminiCredential((request as { apiKey: string }).apiKey);
    }],
    [desktopIpcChannels.runtime.testGeminiCredential, () => {
      if (providerService === undefined || providerService === null) throw geminiUnavailable();
      return providerService.testGeminiCredential();
    }],
    [desktopIpcChannels.runtime.removeGeminiCredential, () => {
      if (providerService === undefined || providerService === null) throw geminiUnavailable();
      return providerService.removeGeminiCredential();
    }]
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

function geminiUnavailable(): Error {
  return Object.assign(new Error("Gemini credential controls are unavailable while providers are disabled."), {
    code: "GEMINI_CREDENTIAL_SERVICE_UNAVAILABLE",
    category: "provider"
  });
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
