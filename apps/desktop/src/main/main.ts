import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  protocol,
  safeStorage,
  type MenuItemConstructorOptions
} from "electron";
import { FakeImageProvider, UnavailableImageProvider } from "@ether/providers";
import { RepairDocumentError, repairDocument as repairEtherDocument } from "@ether/document";
import {
  startEtherMcpApplicationBridge,
  type EtherMcpApplicationBridge,
  type EtherMcpBridgeHost
} from "@ether/mcp-server/bridge";

import { registerDocumentHandlers } from "./ipc/registerDocumentHandlers.js";
import { normalizeDesktopError } from "../shared/ipc/contracts.js";
import { registerGraphHandlers } from "./ipc/registerGraphHandlers.js";
import { registerApplicationHandlers } from "./ipc/registerApplicationHandlers.js";
import {
  createEtherAssetProtocolHandler
} from "./protocol/etherAssetProtocol.js";
import { isLocalDevelopmentRendererUrl } from "./rendererUrl.js";
import { createDesktopSettingsStore } from "./settingsStore.js";
import { createGeminiCredentialStore } from "./services/geminiCredentialStore.js";
import {
  DesktopApplicationService,
  OpenDocumentController,
  OpenDocumentCoordinator,
  createWindowsLocationCapability,
  type DesktopApplicationServiceOptions,
  type NativeDialogPort
} from "./services/applicationService.js";
import { createCodexRuntimeService } from "./services/codexRuntime.js";
import {
  createProviderService,
  startProviderServiceInBackground,
  type BackgroundProviderStartup,
  type ProviderService
} from "./services/providerService.js";
import { createDesktopMcpBridgeHost } from "./services/mcpApplicationBridge.js";
import { installRestrictedNavigationPolicy } from "./security/navigationPolicy.js";
import {
  LocalDiagnosticLogger,
  type DesktopDiagnosticSink
} from "./diagnostics/localDiagnostics.js";
import {
  createRendererInteractiveGate,
  drainLifecycleSteps,
  startContainedLifecycle
} from "./lifecycle.js";
import { resolveRecoveryShellIdentity } from "./recoveryShellIdentity.js";
import { createRecoveryAssociationDiagnostics } from "./recoveryAssociationDiagnostics.js";
import {
  createCredentialWindowOptions,
  createMainWindowOptions,
  showMainWindowMaximized
} from "./windowOptions.js";

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_RENDERER_INTERACTIVE_TIMEOUT_MS = 10_000;

export interface DesktopStartOptions {
  dialogs?: NativeDialogPort;
  initialArgv?: string[];
  rendererUrl?: string;
  simulationMode?: boolean;
  locationCapability?: DesktopApplicationServiceOptions["locationCapability"];
  autosaveOperation?: DesktopApplicationServiceOptions["autosaveOperation"];
  serviceFactory?: (options: DesktopApplicationServiceOptions) => DesktopApplicationService;
  providerService?: ProviderService;
  mcpBridgeFactory?: false | ((host: EtherMcpBridgeHost) => Promise<EtherMcpApplicationBridge>);
  diagnosticLogger?: DesktopDiagnosticSink;
  rendererInteractiveTimeoutMs?: number;
}

export async function startEtherDesktop(options: DesktopStartOptions = {}): Promise<{
  mainWindow: BrowserWindow;
  service: DesktopApplicationService;
  providerService: ProviderService | null;
  mcpBridge: EtherMcpApplicationBridge | null;
}> {
  const launchArgv = options.initialArgv ?? process.argv.slice(1);
  const credentialOnly = launchArgv.includes("--connect-gemini");
  const recoveryShell = resolveRecoveryShellIdentity({
    appData: process.env.APPDATA,
    argv: launchArgv,
    isPackaged: app.isPackaged,
    userData: app.getPath("userData")
  });
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    throw Object.assign(new Error("Another Ether instance owns the application lock."), {
      code: "SECOND_INSTANCE"
    });
  }

  await app.whenReady();
  app.setAppUserModelId(recoveryShell?.appUserModelId ?? "com.dreambay.ether");
  if (recoveryShell !== null) {
    app.setName(recoveryShell.taskbarName);
  }
  const appVersion = app.getVersion();
  const appDataRoot = path.join(app.getPath("userData"), "4.0");
  const diagnosticLogger = options.diagnosticLogger ?? new LocalDiagnosticLogger({
    appDataRoot,
    appVersion
  });
  const logDiagnostic = (record: Parameters<DesktopDiagnosticSink["log"]>[0]) => {
    try {
      diagnosticLogger.log(record);
    } catch {
      // Diagnostics must never hide the user-facing failure they are recording.
    }
  };
  const flushDiagnosticsAfterCrash = () => {
    try {
      diagnosticLogger.flushSync?.();
    } catch {
      // The original crash remains authoritative when local diagnostics cannot flush.
    }
  };
  process.on("uncaughtExceptionMonitor", flushDiagnosticsAfterCrash);

  const preloadPath = path.join(moduleDirectory, "..", "preload", "preload.cjs");
  const mainWindow = new BrowserWindow(credentialOnly
    ? createCredentialWindowOptions(preloadPath)
    : createMainWindowOptions(preloadPath));
  if (recoveryShell !== null) mainWindow.setTitle(recoveryShell.taskbarName);
  mainWindow.once("ready-to-show", () => {
    if (credentialOnly) {
      mainWindow.center();
      mainWindow.show();
    } else {
      showMainWindowMaximized(mainWindow);
    }
  });
  const rendererInteractive = createRendererInteractiveGate();
  const markRendererInteractive = () => rendererInteractive.mark();
  const rendererUrl = credentialOnly
    ? credentialRendererUrl(options.rendererUrl ?? resolveRendererUrl())
    : options.rendererUrl ?? resolveRendererUrl();
  const dialogs = options.dialogs ?? createNativeDialogPort(() => mainWindow);
  const settings = createDesktopSettingsStore(() => path.join(app.getPath("userData"), "settings.json"));
  const geminiCredentials = createGeminiCredentialStore({
    credentialPath: () => path.join(app.getPath("userData"), "gemini-api-credential.json"),
    safeStorage
  });
  const initialSettings = await settings.load();
  const providerService = options.simulationMode === true
    ? null
    : options.providerService ?? createProviderService({
        codex: createCodexRuntimeService(),
        geminiCredentials,
        antigravityCreditOveragesConfirmed:
          initialSettings.providerPolicy.antigravityCreditOveragesConfirmed
      });
  let providerStartup: BackgroundProviderStartup | null = null;
  const serviceOptions: DesktopApplicationServiceOptions = {
    appDataRoot,
    appVersion,
    dialogs,
    diagnosticSink: diagnosticLogger,
    provider: options.simulationMode === true
      ? new FakeImageProvider()
      : providerService?.codex.generation ?? new UnavailableImageProvider({
          id: "ether-provider-unavailable",
          name: "No image provider configured",
          route: "unconfigured-clean-cli-or-mcp",
          capabilities: ["image.generate"],
          notes: ["Task 9 production lifecycle does not install a generation provider."]
        }, "No production image provider is configured."),
    simulationMode: options.simulationMode === true,
    ...(providerService ? { executionProviders: {
      image: providerService.codex.generation,
      worker: providerService.codex.assistant,
      evaluation: providerService.codex.evaluation
    } } : {}),
    ...(providerService ? {
      providerCapabilities: providerService.capabilities,
      providerResolver: ({ binding }) => providerService.resolveExecutionProviders(binding)
    } : {}),
    ...(providerService ? { providerLifecycle: providerService } : {}),
    ...(options.locationCapability !== undefined
      ? { locationCapability: options.locationCapability }
      : process.platform === "win32"
        ? { locationCapability: createWindowsLocationCapability() }
        : {}),
    ...(options.autosaveOperation === undefined ? {} : { autosaveOperation: options.autosaveOperation })
  };
  const service = options.serviceFactory?.(serviceOptions) ?? new DesktopApplicationService(serviceOptions);
  let mcpBridge: EtherMcpApplicationBridge | null = null;
  let mcpBridgeStartup: Promise<EtherMcpApplicationBridge | null> | null = null;
  let rendererLoaded = false;
  let rememberAfterRendererLoad = false;

  const rememberCurrentDocument = async () => {
    const documentPath = service.activePath();
    const snapshot = service.snapshot();
    if (documentPath !== null && snapshot.named) {
      if (recoveryShell === null || recoveryShell.recentEnabled) app.addRecentDocument(documentPath);
      await settings.remember({
        documentId: snapshot.documentId,
        displayName: snapshot.displayName,
        canonicalPath: documentPath
      });
    }
  };
  const reportFailure = async (error: unknown, fallbackCorrelationId?: string) => {
    const message = error instanceof Error ? error.message : "Ether could not complete the command.";
    const candidate = error as { causeId?: unknown; correlationId?: unknown } | null;
    const correlationId = typeof candidate?.correlationId === "string"
      ? candidate.correlationId
      : fallbackCorrelationId ?? randomUUID();
    logDiagnostic({
      ...(typeof candidate?.causeId === "string" ? { causeId: candidate.causeId } : {}),
      correlationId,
      event: "desktop.command.failed",
      level: "error",
      message
    });
    await dialog.showMessageBox(mainWindow, { type: "error", title: "Ether", message });
  };
  const recoveryAssociationDiagnostics = createRecoveryAssociationDiagnostics({
    flushSync: () => diagnosticLogger.flushSync?.(),
    log: logDiagnostic,
    recoveryShell,
    window: mainWindow
  });
  const rememberWhenRendererLoaded = () => {
    if (!rendererLoaded) {
      rememberAfterRendererLoad = true;
      return;
    }
    void rememberCurrentDocument().catch(reportFailure);
  };
  const closeMcpBridge = async () => {
    const bridge = mcpBridge ?? (mcpBridgeStartup === null ? null : await mcpBridgeStartup);
    await bridge?.close();
  };
  let lifecycleDrainedForQuit = false;
  let quitDrain: Promise<void> | null = null;
  const requestQuitDrain = () => {
    if (quitDrain !== null) return;
    markRendererInteractive();
    quitDrain = (async () => {
      await drainLifecycleSteps([
        { name: "mcp", close: closeMcpBridge },
        { name: "application", close: () => service.close() },
        {
          name: "provider",
          close: () => providerStartup?.close() ?? providerService?.close() ?? Promise.resolve()
        },
        { name: "diagnostics", close: () => diagnosticLogger.flush?.() ?? Promise.resolve() }
      ], ({ error, step }) => {
        logDiagnostic({
          correlationId: randomUUID(),
          details: { step },
          event: "desktop.lifecycle.drain-failed",
          level: "error",
          message: error instanceof Error ? error.message : `Desktop ${step} lifecycle drain failed.`
        });
      });
      lifecycleDrainedForQuit = true;
      app.quit();
    })();
  };
  mainWindow.on("close", (event) => {
    if (lifecycleDrainedForQuit) return;
    event.preventDefault();
    requestQuitDrain();
  });
  app.on("before-quit", (event) => {
    if (lifecycleDrainedForQuit) return;
    event.preventDefault();
    requestQuitDrain();
  });
  app.on("window-all-closed", () => app.quit());
  const run = (operation: () => Promise<unknown>, remember = false) => {
    void operation().then(() => {
      if (remember) void rememberCurrentDocument().catch(reportFailure);
    }, reportFailure);
  };
  const coordinator = new OpenDocumentCoordinator({
    focus: () => {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    },
    open: async (documentPath) => {
      await service.openPath(documentPath);
      rememberWhenRendererLoaded();
    }
  });
  const openController = new OpenDocumentController(coordinator, () => dialogs.openDocument());
  const openDocument = async () => {
    await openController.request("picker");
    return service.snapshot();
  };
  let pendingRepair: { confirmationId: string; createdAt: number; sourcePath: string; destinationPath: string } | null = null;
  const cancelRepair = () => { pendingRepair = null; };
  const repairDocument = async (allowLossy: boolean, confirmationId?: string) => {
    if (!allowLossy) {
      cancelRepair();
      const sourcePath = await dialogs.openDocument();
      if (sourcePath === null) return { kind: "cancelled" as const };
      const destinationPath = await (dialogs.saveRepairDocument?.() ?? dialogs.saveDocument("save-as"));
      if (destinationPath === null) return { kind: "cancelled" as const };
      pendingRepair = { confirmationId: randomUUID(), createdAt: Date.now(), sourcePath, destinationPath };
    }
    if (
      pendingRepair === null ||
      (allowLossy && (confirmationId !== pendingRepair.confirmationId || Date.now() - pendingRepair.createdAt > 5 * 60_000))
    ) {
      cancelRepair();
      throw Object.assign(new Error("Start repair again to choose the damaged document and a new destination."), {
        code: "REPAIR_CONFIRMATION_EXPIRED",
        category: "document"
      });
    }
    const repairSelection = pendingRepair;
    try {
      const report = await repairEtherDocument(repairSelection.sourcePath, repairSelection.destinationPath, {
        allowLossy,
        appDataRoot
      });
      pendingRepair = null;
      return {
        kind: "completed" as const,
        report: repairReportForRenderer(report)
      };
    } catch (error) {
      if (error instanceof RepairDocumentError && error.code === "LOSSY_REPAIR_REQUIRES_OPT_IN" && error.preview !== undefined) {
        return {
          kind: "needs-confirmation" as const,
          confirmationId: repairSelection.confirmationId,
          report: repairReportForRenderer(error.preview)
        };
      }
      pendingRepair = null;
      throw error;
    }
  };
  const openPath = async (documentPath: string) => {
    await openController.request("drop", documentPath);
    return service.snapshot();
  };
  let initialDocumentStartup: Promise<void> | null = null;
  let providerPolicyUpdate: Promise<void> = Promise.resolve();

  const disposeDocumentHandlers = registerDocumentHandlers({
    appVersion,
    ipcMain,
    mainWindow,
    rendererUrl,
    service,
    providerService,
    getProviderPolicy: () => ({
      antigravityCreditOveragesConfirmed:
        providerService?.antigravityPolicy().creditOveragesConfirmed ?? false
    }),
    setProviderPolicy: providerService === null
      ? undefined
      : (confirmed) => {
          const update = providerPolicyUpdate.then(async () => {
            try {
              await providerService.setAntigravityCreditOveragesConfirmed(confirmed);
              await settings.setAntigravityCreditOveragesConfirmed(confirmed);
            } catch (error) {
              await providerService.setAntigravityCreditOveragesConfirmed(false).catch(() => undefined);
              throw error;
            }
            return {
              antigravityCreditOveragesConfirmed: confirmed
            };
          });
          providerPolicyUpdate = update.then(() => undefined, () => undefined);
          return update;
        },
    bootstrapDocument: async () => {
      if (initialDocumentStartup !== null) await initialDocumentStartup;
      else await service.bootstrap();
      return service.snapshot();
    },
    openDocument,
    repairDocument,
    cancelRepair,
    openPath
  });
  const disposeGraphHandlers = registerGraphHandlers({
    ipcMain,
    mainWindow,
    rendererUrl,
    service
  });
  const disposeApplicationHandlers = registerApplicationHandlers({
    ipcMain,
    mainWindow,
    rendererUrl,
    service,
    onRendererInteractive: markRendererInteractive
  });

  protocol.handle(
    "ether-asset",
    createEtherAssetProtocolHandler({
      authorize: async (documentId, artifactId, variant) => {
        if (variant !== "original" && variant !== "thumbnail") return null;
        let active;
        try {
          active = service.snapshot();
        } catch {
          return null;
        }
        if (active.documentId !== documentId) return null;
        try {
          const artifact = await service.artifactAssetDescriptor(documentId, artifactId, variant);
          return {
            byteLength: artifact.byteLength,
            contentHash: artifact.contentKey,
            mediaType: artifact.mediaType
          };
        } catch {
          return null;
        }
      },
      streamRange: (documentId, artifactId, variant, start, endExclusive) => {
        if (variant !== "original" && variant !== "thumbnail") {
          throw new Error("Unsupported artifact asset variant.");
        }
        return service.streamArtifactAssetRange(
          documentId,
          artifactId,
          variant,
          start,
          endExclusive
        );
      }
    })
  );

  const approveMcpEdit = async () => {
    const active = service.snapshot();
    const confirmation = await dialog.showMessageBox(mainWindow, {
      type: "question",
      title: "Allow Codex to edit?",
      message: `Allow Codex to edit ${active.displayName}?`,
      detail: "This grants a temporary Edit Permit for the active document. Codex cannot grant this permission to itself.",
      buttons: ["Grant Edit Permit", "Cancel"],
      defaultId: 1,
      cancelId: 1
    });
    if (confirmation.response !== 0) return;
    await service.grantMcpEditPermit(active.documentId, new Date(Date.now() + 15 * 60_000).toISOString());
    await dialog.showMessageBox(mainWindow, {
      type: "info",
      title: "Codex edit access granted",
      message: "Codex can now discover the Edit Permit and apply a previewed change to this document for 15 minutes."
    });
  };
  const approveMcpRun = async () => {
    const active = service.snapshot();
    const plan = service.latestMcpRunPlan(active.documentId);
    if (plan === null) {
      await dialog.showMessageBox(mainWindow, {
        type: "info",
        title: "No Codex plan to approve",
        message: "Ask Codex to preview a run plan first, then approve it here."
      });
      return;
    }
    const confirmation = await dialog.showMessageBox(mainWindow, {
      type: "question",
      title: "Approve Codex run plan?",
      message: `Approve ${plan.workItems.length.toLocaleString()} work item${plan.workItems.length === 1 ? "" : "s"} in ${active.displayName}?`,
      detail: `Plan ${plan.id}\n${plan.estimatedCalls.toLocaleString()} estimated provider call${plan.estimatedCalls === 1 ? "" : "s"}\n${plan.contentHash}`,
      buttons: ["Approve Exact Plan", "Cancel"],
      defaultId: 1,
      cancelId: 1
    });
    if (confirmation.response !== 0) return;
    await service.approveLatestMcpRunPlan(active.documentId);
    await dialog.showMessageBox(mainWindow, {
      type: "info",
      title: "Codex run plan approved",
      message: "Codex can now discover a Run Permit for this exact immutable plan."
    });
  };
  const disposeApplicationMenu = installApplicationMenu(
    service,
    openDocument,
    run,
    () => run(approveMcpEdit),
    () => run(approveMcpRun)
  );
  installRestrictedNavigationPolicy(mainWindow.webContents, rendererUrl);
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    markRendererInteractive();
    logDiagnostic({
      correlationId: randomUUID(),
      details: { reason: details.reason, exitCode: details.exitCode },
      event: "desktop.renderer.gone",
      level: "error",
      message: "The Ether renderer process exited unexpectedly."
    });
  });
  logDiagnostic({
    correlationId: randomUUID(),
    event: "desktop.lifecycle.ready",
    level: "info",
    message: "Ether desktop security and application services are ready."
  });
  const disposeRecentSubscription = service.subscribe((event) => {
    if (event.snapshot?.named === true) {
      const activePath = service.activePath();
      if (activePath !== null) coordinator.markOpen(activePath);
    } else if (event.snapshot !== undefined) {
      coordinator.clear();
    }
  });
  mainWindow.on("closed", () => {
    process.off("uncaughtExceptionMonitor", flushDiagnosticsAfterCrash);
    disposeApplicationHandlers();
    disposeGraphHandlers();
    disposeDocumentHandlers();
    disposeApplicationMenu();
    disposeRecentSubscription();
  });

  app.on("second-instance", (_event, argv) => {
    const requested = findEtherArgument(argv);
    const trace = recoveryAssociationDiagnostics?.received(argv, requested);
    if (requested === null) {
      mainWindow.focus();
      return;
    }
    void openController.request("second-instance", requested, {
      onFocusAttempt: () => trace?.focusAttempt(),
      onHandled: (handled) => trace?.handled(handled)
    }).catch((error) => {
      trace?.failed(error);
      return reportFailure(error, trace?.correlationId);
    });
  });
  app.on("open-file", (event, filePath) => {
    event.preventDefault();
    void openController.request("open-file", filePath).catch(reportFailure);
  });

  const initialDocument = findEtherArgument(launchArgv);
  initialDocumentStartup = credentialOnly
    ? Promise.resolve()
    : initialDocument !== null
      ? openController.request("argv", initialDocument).then(() => undefined)
      : service.bootstrap().then(() => undefined);
  const rendererStartup = mainWindow.loadURL(rendererUrl);
  await Promise.all([initialDocumentStartup, rendererStartup]);
  initialDocumentStartup = null;
  if (quitDrain !== null) {
    await quitDrain;
    return { mainWindow, service, providerService, mcpBridge };
  }

  const readiness = await rendererInteractive.wait(
    options.rendererInteractiveTimeoutMs ?? DEFAULT_RENDERER_INTERACTIVE_TIMEOUT_MS
  );
  if (readiness === "timeout") {
    logDiagnostic({
      correlationId: randomUUID(),
      details: { timeoutMs: options.rendererInteractiveTimeoutMs ?? DEFAULT_RENDERER_INTERACTIVE_TIMEOUT_MS },
      event: "desktop.renderer.interactive-timeout",
      level: "warning",
      message: "The renderer did not confirm interactivity before the bounded startup fallback."
    });
  }
  if (quitDrain !== null) {
    await quitDrain;
    return { mainWindow, service, providerService, mcpBridge };
  }
  rendererLoaded = true;
  if (recoveryShell !== null) mainWindow.setTitle(recoveryShell.taskbarName);
  // Recovery Recent mode exercises app.addRecentDocument only. Calling
  // setJumpList creates/reset a shell-owned custom-list tombstone in the real
  // profile, which an isolated APPDATA cannot contain.
  if (!credentialOnly && recoveryShell === null) app.setJumpList([{ type: "recent" }]);
  if (!credentialOnly && rememberAfterRendererLoad) {
    rememberWhenRendererLoaded();
  }
  if (!credentialOnly && options.mcpBridgeFactory !== false) {
    const startMcpBridge = options.mcpBridgeFactory ?? startEtherMcpApplicationBridge;
    mcpBridgeStartup = startContainedLifecycle(
      () => startMcpBridge(createDesktopMcpBridgeHost(service)),
      (error) => {
        logDiagnostic({
          correlationId: randomUUID(),
          event: "mcp.lifecycle.start-failed",
          level: "error",
          message: error instanceof Error ? error.message : "The Ether MCP bridge failed to start."
        });
      }
    ).then((bridge) => {
      mcpBridge = bridge;
      return bridge;
    });
  }
  if (!credentialOnly && providerService !== null) {
    providerStartup = startProviderServiceInBackground(providerService, (error) => {
      logDiagnostic({
        correlationId: randomUUID(),
        event: "provider.lifecycle.start-failed",
        level: "error",
        message: error instanceof Error ? error.message : "Provider lifecycle failed to start."
      });
    });
  }
  return { mainWindow, service, providerService, mcpBridge };
}

function repairReportForRenderer(report: {
  destinationPath?: string;
  losses: Array<{ entityId: string; reason: string; type: string }>;
  recovered: { artifacts: number; blobs: number; graphs: number; references: number };
  statement: "logical-row-repair-only";
}) {
  const { destinationPath: _destinationPath, ...publicReport } = report;
  return {
    ...publicReport,
    losses: report.losses.map((loss) => ({
      ...loss,
      reason: normalizeDesktopError(Object.assign(new Error(loss.reason), { category: "document" })).message
    }))
  };
}

function resolveRendererUrl(): string {
  const developmentUrl = process.env.ETHER_RENDERER_URL;
  if (isLocalDevelopmentRendererUrl(developmentUrl, !app.isPackaged)) return developmentUrl!;
  return pathToFileURL(path.join(app.getAppPath(), "dist", "index.html")).href;
}

function credentialRendererUrl(rendererUrl: string): string {
  const url = new URL(rendererUrl);
  url.searchParams.set("surface", "gemini-connect");
  return url.href;
}

function createNativeDialogPort(getWindow: () => BrowserWindow): NativeDialogPort {
  return {
    openDocument: async () => {
      const result = await dialog.showOpenDialog(getWindow(), {
        title: "Open Ether Document",
        properties: ["openFile"],
        filters: [{ name: "Ether Documents", extensions: ["ether"] }]
      });
      return result.canceled ? null : result.filePaths[0] ?? null;
    },
    saveDocument: async (kind) => {
      const result = await dialog.showSaveDialog(getWindow(), {
        title: kind === "save-copy" ? "Save a Copy" : "Save Ether Document",
        defaultPath: kind === "save-copy" ? "Untitled copy.ether" : "Untitled.ether",
        filters: [{ name: "Ether Documents", extensions: ["ether"] }]
      });
      return result.canceled ? null : result.filePath ?? null;
    },
    saveRepairDocument: async () => {
      const result = await dialog.showSaveDialog(getWindow(), {
        title: "Save Repaired Ether Document",
        defaultPath: "Recovered copy.ether",
        filters: [{ name: "Ether Documents", extensions: ["ether"] }]
      });
      return result.canceled ? null : result.filePath ?? null;
    },
    locateReference: async () => {
      const result = await dialog.showOpenDialog(getWindow(), {
        title: "Locate Reference",
        properties: ["openFile"]
      });
      return result.canceled ? null : result.filePaths[0] ?? null;
    },
    searchReferenceFolder: async () => {
      const result = await dialog.showOpenDialog(getWindow(), {
        title: "Search Folder for References",
        properties: ["openDirectory"]
      });
      return result.canceled ? null : result.filePaths[0] ?? null;
    },
    chooseOutputFolder: async (purpose) => {
      const result = await dialog.showOpenDialog(getWindow(), {
        title: purpose === "export" ? "Choose Export Folder" : "Choose Live Output Folder",
        properties: ["openDirectory", "createDirectory"]
      });
      return result.canceled ? null : result.filePaths[0] ?? null;
    },
    confirmPortable: async ({ expectedBytes, expectedCount, missingReferences }) => {
      const missingDetail = missingReferences.length === 0
        ? "All known references are available."
        : `Unavailable: ${missingReferences.map((reference) => reference.displayName).join(", ")}`;
      const result = await dialog.showMessageBox(getWindow(), {
        type: "question",
        title: "Make Document Portable",
        message: `Embed ${expectedCount} available reference${expectedCount === 1 ? "" : "s"}?`,
        detail: `${expectedBytes.toLocaleString()} bytes will be copied into this Ether document. ${missingDetail}`,
        buttons: ["Make Portable", "Cancel"],
        defaultId: 0,
        cancelId: 1
      });
      return result.response === 0;
    }
  };
}

function installApplicationMenu(
  service: DesktopApplicationService,
  openDocument: () => Promise<unknown>,
  run: (operation: () => Promise<unknown>, remember?: boolean) => void,
  grantMcpEdit: () => void,
  approveMcpRun: () => void
): () => void {
  type Command = keyof ReturnType<DesktopApplicationService["snapshot"]>["commands"];
  let commands: Record<Command, boolean> = {
    save: false,
    saveAs: false,
    saveCopy: false,
    compact: false,
    makePortable: false
  };
  const scoped = (
    command: Command,
    operation: (documentId: string) => Promise<unknown>,
    remember = false
  ) => () => {
    let snapshot;
    try {
      snapshot = service.snapshot();
    } catch {
      return;
    }
    if (!snapshot.commands[command]) return;
    run(() => operation(snapshot.documentId), remember);
  };
  const template: MenuItemConstructorOptions[] = [{
    label: "File",
    submenu: [
      { id: "file.new", label: "New", accelerator: "Ctrl+N", click: () => run(() => service.newDocument()) },
      { id: "file.open", label: "Open...", accelerator: "Ctrl+O", click: () => run(openDocument) },
      { type: "separator" },
      { id: "file.save", label: "Save", accelerator: "Ctrl+S", enabled: false, click: scoped("save", (id) => service.save(id)) },
      { id: "file.save-as", label: "Save As...", accelerator: "Ctrl+Shift+S", enabled: false, click: scoped("saveAs", (id) => service.saveAs(id), true) },
      { id: "file.save-copy", label: "Save a Copy...", enabled: false, click: scoped("saveCopy", (id) => service.saveCopy(id)) },
      { type: "separator" },
      { id: "file.compact", label: "Compact Document", enabled: false, click: scoped("compact", (id) => service.compact(id)) },
      { id: "file.make-portable", label: "Make Document Portable", enabled: false, click: scoped("makePortable", (id) => service.makePortable(id)) },
      { type: "separator" },
      { role: "quit" }
    ]
  }, { role: "editMenu" }, {
    label: "Codex",
    submenu: [
      { id: "codex.grant-edit", label: "Grant Edit Permit…", click: grantMcpEdit },
      { id: "codex.approve-run", label: "Approve Latest Run Plan…", click: approveMcpRun }
    ]
  }, { role: "viewMenu" }, { role: "windowMenu" }];
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
  const update = (next: ReturnType<DesktopApplicationService["snapshot"]>["commands"]) => {
    commands = next;
    const items: Array<[string, Command]> = [
      ["file.save", "save"],
      ["file.save-as", "saveAs"],
      ["file.save-copy", "saveCopy"],
      ["file.compact", "compact"],
      ["file.make-portable", "makePortable"]
    ];
    for (const [id, command] of items) {
      const item = menu.getMenuItemById(id);
      if (item !== null) item.enabled = commands[command];
    }
  };
  const unsubscribe = service.subscribe((event) => {
    if (event.snapshot !== undefined) update(event.snapshot.commands);
  });
  try {
    update(service.snapshot().commands);
  } catch {
    // The initial document event enables commands after bootstrap.
  }
  return unsubscribe;
}

function findEtherArgument(argv: string[]): string | null {
  const candidate = argv.find((argument) =>
    !argument.startsWith("--") && path.extname(argument).toLocaleLowerCase() === ".ether"
  );
  return candidate === undefined ? null : path.resolve(candidate);
}
