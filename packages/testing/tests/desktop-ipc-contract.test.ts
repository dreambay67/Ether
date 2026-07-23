import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { applicationCommandNames } from "@ether/schema";

import {
  desktopIpcChannels,
  desktopIpcChannelList
} from "../../../apps/desktop/src/shared/ipc/channels";
import {
  assertDocumentScope,
  assertAuthorizedSenderFrame,
  assertTrustedIpcSender,
  desktopIpcContracts,
  normalizeDesktopError,
  type IpcSenderIdentity
} from "../../../apps/desktop/src/shared/ipc/contracts";
import {
  applicationCommandAvailableToRenderer,
  applicationCommandMutationPolicy
} from "../../../apps/desktop/src/main/services/applicationService";
import { createEtherBridge } from "../../../apps/desktop/src/preload/filePathBridge";
import { registerApplicationHandlers } from "../../../apps/desktop/src/main/ipc/registerApplicationHandlers";

const trustedSender: IpcSenderIdentity = {
  webContentsId: 7,
  senderFrameUrl: "http://127.0.0.1:5173/",
  origin: "http://127.0.0.1:5173"
};

describe("desktop IPC contract", () => {
  it("keeps every channel unique and represented by one contract", () => {
    expect(new Set(desktopIpcChannelList).size).toBe(desktopIpcChannelList.length);
    expect(Object.keys(desktopIpcContracts).sort()).toEqual([...desktopIpcChannelList].sort());
  });

  it("strictly parses representative requests and normalized responses", () => {
    const request = desktopIpcContracts[desktopIpcChannels.document.save].request.parse({
      documentId: "document-1"
    });
    const response = desktopIpcContracts[desktopIpcChannels.document.save].response.parse({
      ok: true,
      value: {
        documentId: "document-1",
        displayName: "Campaign.ether",
        named: true,
        mode: "writable",
        readOnlyReason: null,
        commands: {
          save: true,
          saveAs: true,
          saveCopy: true,
          compact: true,
          makePortable: true
        },
        saveState: "saved",
        documentRevisionId: "revision-2",
        graphId: "graph-root",
        graphRevisionId: "graph-revision-2",
        simulationEnabled: false,
        revision: 2
      }
    });

    expect(request).toEqual({ documentId: "document-1" });
    expect(response.ok).toBe(true);
    expect(() =>
      desktopIpcContracts[desktopIpcChannels.document.save].request.parse({
        documentId: "document-1",
        path: "C:\\secret.ether"
      })
    ).toThrow();
    expect(
      desktopIpcContracts[desktopIpcChannels.document.save].response.safeParse({
        ok: false,
        error: {
          code: "SAVE_FAILED",
          category: "document",
          message: "Could not save",
          retryable: true
        }
      }).success
    ).toBe(true);
  });

  it("keeps generic mutation policy exhaustive and desktop lifecycle-owned", () => {
    expect(Object.keys(applicationCommandMutationPolicy).sort()).toEqual([...applicationCommandNames].sort());
    for (const name of applicationCommandNames.filter((candidate) => candidate.startsWith("document."))) {
      expect(applicationCommandMutationPolicy[name]).toBe(false);
      expect(applicationCommandAvailableToRenderer(name)).toBe(false);
    }
    expect(applicationCommandAvailableToRenderer("graph.undo")).toBe(true);
    expect(applicationCommandMutationPolicy["run.preview"]).toBe(false);
    expect(applicationCommandMutationPolicy["graph.applyTransaction"]).toBe(true);
  });

  it("preserves safe domain metadata while redacting absolute paths from errors", () => {
    const error = Object.assign(
      new Error("ENOENT while reading C:\\Users\\person\\Private\\source.png"),
      {
        category: "reference",
        causeId: "cause-1",
        code: "REFERENCE_SOURCE_MISSING",
        retryable: true,
        userAction: "Relink C:\\Users\\person\\Private\\source.png"
      }
    );
    expect(normalizeDesktopError(error)).toEqual({
      category: "reference",
      causeId: "cause-1",
      code: "REFERENCE_SOURCE_MISSING",
      message: "ENOENT while reading the selected file",
      retryable: true,
      userAction: "Relink the selected file"
    });
    expect(normalizeDesktopError(new Error("ENOENT while reading /Users/person/Private/source.png")).message)
      .toBe("ENOENT while reading the selected file");
    expect(normalizeDesktopError(new Error("ENOENT file://server/share/private.png")).message)
      .toBe("ENOENT the selected file");
    expect(normalizeDesktopError(new Error("ENOENT //server/share/private.png")).message)
      .toBe("ENOENT the selected file");
  });

  it("validates the generic application command and query boundary end to end", async () => {
    const command = {
      kind: "command" as const,
      id: "command-1",
      correlationId: "correlation-1",
      name: "graph.undo" as const,
      documentId: "document-1",
      payload: { graphId: "graph-root" }
    };
    const query = {
      kind: "query" as const,
      id: "query-1",
      correlationId: "correlation-1",
      name: "provider.capabilities" as const,
      payload: {}
    };
    const commandResponse = {
      kind: "response" as const,
      id: "response-1",
      correlationId: command.correlationId,
      requestId: command.id,
      name: command.name,
      documentId: command.documentId,
      payload: {
        kind: "revision" as const,
        documentRevisionId: "revision-2",
        graphRevisions: [{ graphId: "graph-root", revisionId: "graph-revision-2" }]
      }
    };
    const queryResponse = {
      kind: "response" as const,
      id: "response-2",
      correlationId: query.correlationId,
      requestId: query.id,
      name: query.name,
      payload: { capabilities: [] }
    };

    expect(desktopIpcContracts[desktopIpcChannels.application.command].request.parse(command)).toEqual(command);
    expect(desktopIpcContracts[desktopIpcChannels.application.query].request.parse(query)).toEqual(query);
    expect(desktopIpcContracts[desktopIpcChannels.application.command].response.safeParse({
      ok: true,
      value: commandResponse
    }).success).toBe(true);
    expect(desktopIpcContracts[desktopIpcChannels.application.query].response.safeParse({
      ok: true,
      value: queryResponse
    }).success).toBe(true);
    expect(desktopIpcContracts[desktopIpcChannels.application.command].request.safeParse({
      ...command,
      payload: { graphId: "graph-root", path: "C:\\private\\graph.json" }
    }).success).toBe(false);

    const invocations: Array<{ channel: string; request: unknown }> = [];
    const bridge = createEtherBridge({
      invoke: async (channel, request) => {
        invocations.push({ channel, request });
        return { ok: true, value: channel === desktopIpcChannels.application.command ? commandResponse : queryResponse };
      },
      subscribe: () => () => undefined,
      openDroppedDocument: async () => ({ ok: true, value: undefined })
    });

    await expect(bridge.application.command(command)).resolves.toEqual(commandResponse);
    await expect(bridge.application.query(query)).resolves.toEqual(queryResponse);
    expect(invocations).toEqual([
      { channel: desktopIpcChannels.application.command, request: command },
      { channel: desktopIpcChannels.application.query, request: query }
    ]);
  });

  it("exposes validated application events and a path-free reference picker", async () => {
    const event = {
      kind: "event" as const,
      id: "event-1",
      correlationId: "correlation-1",
      documentId: "document-1",
      name: "job.stateChanged" as const,
      occurredAt: "2026-07-23T10:00:00.000Z",
      payload: { jobId: "job-1", state: "running" as const }
    };
    expect(desktopIpcContracts[desktopIpcChannels.application.event].request.parse(event)).toEqual(event);

    const pickerRequest = {
      documentId: "document-1",
      graphId: "graph-root",
      nodeId: "references",
      role: "subject" as const,
      storage: "link" as const
    };
    expect(desktopIpcContracts[desktopIpcChannels.references.chooseAndLink].request.parse(pickerRequest))
      .toEqual(pickerRequest);
    expect(desktopIpcContracts[desktopIpcChannels.references.chooseAndLink].request.safeParse({
      ...pickerRequest,
      path: "C:\\private\\reference.png"
    }).success).toBe(false);
    expect(desktopIpcContracts[desktopIpcChannels.references.chooseAndLink].request.parse({
      ...pickerRequest,
      droppedPath: "C:\\private\\dropped-reference.png"
    })).toMatchObject({ droppedPath: "C:\\private\\dropped-reference.png" });

    let subscription: ((payload: unknown) => void) | undefined;
    const invocations: Array<{ channel: string; request: unknown }> = [];
    const droppedImports: Array<{ name: string; input: unknown }> = [];
    const bridge = createEtherBridge({
      invoke: async (channel, request) => {
        invocations.push({ channel, request });
        return { ok: true, value: { cancelled: false, referenceId: "reference-1" } };
      },
      subscribe: (channel, listener) => {
        if (channel === desktopIpcChannels.application.event) subscription = listener;
        return () => { subscription = undefined; };
      },
      openDroppedDocument: async () => ({ ok: true, value: undefined }),
      importDroppedReference: async (file, input) => {
        droppedImports.push({ name: file.name, input });
        return { ok: true, value: { cancelled: false, referenceId: "reference-drop" } };
      }
    });
    const received: unknown[] = [];
    const dispose = bridge.application.onEvent((payload) => received.push(payload));
    subscription?.(event);
    await expect(bridge.references.chooseAndLink(pickerRequest)).resolves.toEqual({
      cancelled: false,
      referenceId: "reference-1"
    });
    await expect(bridge.references.importDropped(new File(["image"], "dropped.png"), pickerRequest)).resolves.toEqual({
      cancelled: false,
      referenceId: "reference-drop"
    });
    expect(received).toEqual([event]);
    expect(invocations).toEqual([{ channel: desktopIpcChannels.references.chooseAndLink, request: pickerRequest }]);
    expect(droppedImports).toEqual([{ name: "dropped.png", input: pickerRequest }]);
    dispose();
  });

  it("registers the desktop-owned picker and forwards only validated application events", async () => {
    const handlers = new Map<string, (event: unknown, input: unknown) => Promise<unknown>>();
    const sent: Array<{ channel: string; payload: unknown }> = [];
    const mainFrame = { url: trustedSender.senderFrameUrl };
    let applicationListener: ((event: unknown) => void) | undefined;
    let receivedPicker: unknown;
    const dispose = registerApplicationHandlers({
      ipcMain: {
        handle: (channel: string, handler: (event: unknown, input: unknown) => Promise<unknown>) => handlers.set(channel, handler),
        removeHandler: (channel: string) => handlers.delete(channel)
      } as never,
      mainWindow: {
        isDestroyed: () => false,
        webContents: {
          id: trustedSender.webContentsId,
          mainFrame,
          send: (channel: string, payload: unknown) => sent.push({ channel, payload })
        }
      } as never,
      rendererUrl: trustedSender.senderFrameUrl,
      service: {
        executeApplicationCommand: async () => { throw new Error("unused"); },
        executeApplicationQuery: async () => { throw new Error("unused"); },
        chooseAndLinkReference: async (request: unknown) => {
          receivedPicker = request;
          return { cancelled: false as const, referenceId: "reference-1" };
        },
        subscribeApplication: (listener: (event: unknown) => void) => {
          applicationListener = listener;
          return () => { applicationListener = undefined; };
        }
      } as never
    });
    const request = {
      documentId: "document-1",
      graphId: "graph-root",
      nodeId: "references",
      role: "subject",
      storage: "embed"
    };
    const result = await handlers.get(desktopIpcChannels.references.chooseAndLink)!({
      sender: { id: trustedSender.webContentsId },
      senderFrame: mainFrame
    }, request);
    expect(result).toEqual({ ok: true, value: { cancelled: false, referenceId: "reference-1" } });
    expect(receivedPicker).toEqual(request);

    const event = {
      kind: "event",
      id: "event-1",
      correlationId: "correlation-1",
      documentId: "document-1",
      name: "reference.changed",
      occurredAt: "2026-07-23T10:00:00.000Z",
      payload: { referenceId: "reference-1", state: "linked" }
    };
    applicationListener?.(event);
    expect(sent).toEqual([{ channel: desktopIpcChannels.application.event, payload: event }]);
    dispose();
    expect(handlers.has(desktopIpcChannels.references.chooseAndLink)).toBe(false);
    expect(applicationListener).toBeUndefined();
  });

  it("surfaces read-only provider health without exposing runtime process control", () => {
    const parsed = desktopIpcContracts[desktopIpcChannels.runtime.providerHealth].response.parse({
      ok: true,
      value: {
        providerId: "codex-chatgpt-image-2",
        status: "available",
        message: null,
        checkedAt: "2026-07-18T12:00:00.000Z",
        transport: "app-server",
        version: "0.144.2",
        manifestHash: "579e6d66fe30749682413b6a32289b896c314db8a3e51b11d65874214e098ee6",
        generation: 1,
        restartCount: 0,
        restartReason: null,
        fallbackReason: null,
        processPhase: "idle",
        threadId: null,
        turnId: null,
        timing: { startedAt: 1, initializedAt: 2, initializationMs: 1, lastExitAt: null }
      }
    });
    expect(parsed.ok).toBe(true);

    const bridge = createEtherBridge({
      invoke: async () => ({ ok: true, value: undefined }),
      subscribe: () => () => undefined,
      openDroppedDocument: async () => ({ ok: true, value: undefined })
    });
    expect(Object.keys(bridge.runtime).sort()).toEqual(["providerHealth", "versions"]);
    expect(JSON.stringify(Object.keys(bridge.runtime))).not.toMatch(/spawn|start|stop|interrupt|process/i);
  });

  it("parses capability-aware references and portable confirmation results", () => {
    const referenceResponse = desktopIpcContracts[desktopIpcChannels.references.list].response.safeParse({
      ok: true,
      value: [{
        id: "reference-1",
        displayName: "source.png",
        mediaType: "image/png",
        state: "missing",
        actions: ["locate", "remove"]
      }]
    });
    const portableResponse = desktopIpcContracts[desktopIpcChannels.document.makePortable].response.safeParse({
      ok: true,
      value: {
        cancelled: true,
        embeddedCount: 0,
        embeddedBytes: 0,
        expectedBytes: 8192,
        expectedCount: 2,
        missingReferences: [{ id: "reference-1", displayName: "source.png" }]
      }
    });

    expect(referenceResponse.success).toBe(true);
    expect(portableResponse.success).toBe(true);
    expect(desktopIpcContracts[desktopIpcChannels.document.event].request.safeParse({
      kind: "state",
      documentId: "document-1",
      revision: 3,
      commandResult: {
        kind: "compact",
        beforeBytes: 16384,
        afterBytes: 12288
      }
    }).success).toBe(true);
    expect(desktopIpcContracts[desktopIpcChannels.references.list].response.safeParse({
      ok: true,
      value: [{
        id: "reference-1",
        displayName: "source.png",
        mediaType: "image/png",
        state: "missing",
        originalPath: "C:\\private\\source.png",
        actions: ["locate"]
      }]
    }).success).toBe(false);
  });

  it("rejects the wrong webContents, frame URL, or origin", () => {
    expect(() =>
      assertTrustedIpcSender(trustedSender, {
        rendererUrl: "http://127.0.0.1:5173/",
        webContentsId: 7
      })
    ).not.toThrow();

    for (const candidate of [
      { ...trustedSender, webContentsId: 8 },
      { ...trustedSender, senderFrameUrl: "https://attacker.invalid/" },
      { ...trustedSender, origin: "https://attacker.invalid" }
    ]) {
      expect(() =>
        assertTrustedIpcSender(candidate, {
          rendererUrl: "http://127.0.0.1:5173/",
          webContentsId: 7
        })
      ).toThrowError(expect.objectContaining({ code: "IPC_SENDER_REJECTED" }));
    }
  });

  it("requires the exact authorized mainFrame object and rejects subframes or replaced frames", () => {
    const mainFrame = { url: "http://127.0.0.1:5173/", routingId: 1 };
    expect(() => assertAuthorizedSenderFrame(mainFrame, mainFrame)).not.toThrow();
    expect(() => assertAuthorizedSenderFrame(
      { url: mainFrame.url, routingId: mainFrame.routingId },
      mainFrame
    )).toThrowError(expect.objectContaining({ code: "IPC_SENDER_REJECTED" }));
    expect(() => assertAuthorizedSenderFrame(
      { url: "http://127.0.0.1:5173/navigated", routingId: 2 },
      mainFrame
    )).toThrowError(expect.objectContaining({ code: "IPC_SENDER_REJECTED" }));
  });

  it("enforces active document scope", () => {
    expect(() => assertDocumentScope("document-1", "document-1")).not.toThrow();
    expect(() => assertDocumentScope("document-2", "document-1")).toThrowError(
      expect.objectContaining({ code: "DOCUMENT_SCOPE_REJECTED" })
    );
  });

  it("exposes only the narrow document bridge and never a raw path or IPC primitive", () => {
    const bridge = createEtherBridge({
      invoke: async () => ({ ok: true, value: undefined }),
      subscribe: () => () => undefined,
      openDroppedDocument: async () => ({ ok: true, value: undefined })
    });

    expect(Object.keys(bridge).sort()).toEqual([
      "application",
      "artifacts",
      "document",
      "graph",
      "references",
      "runtime"
    ]);
    expect(Object.keys(bridge.document).sort()).toEqual([
      "bootstrap",
      "close",
      "compact",
      "makePortable",
      "new",
      "onEvent",
      "open",
      "openDropped",
      "save",
      "saveAs",
      "saveCopy"
    ]);
    expect(JSON.stringify(Object.keys(bridge))).not.toMatch(/filesystem|ipc|path|shellExecute/i);
  });

  it("builds desktop and Windows package before real development and packaged acceptance journeys", async () => {
    const root = path.resolve(import.meta.dirname, "../../..");
    const manifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    const acceptance = manifest.scripts["test:acceptance"] ?? "";

    expect(acceptance).toContain("desktop:package:win");
    expect(acceptance).toContain("test:smoke");
    expect(acceptance).toContain("test:desktop");
    expect(acceptance).toContain("test:packaged");
    expect(acceptance).not.toContain("test:acceptance");
  });
});
