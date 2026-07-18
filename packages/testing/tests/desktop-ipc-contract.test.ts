import { describe, expect, it } from "vitest";

import {
  desktopIpcChannels,
  desktopIpcChannelList
} from "../../../apps/desktop/src/shared/ipc/channels";
import {
  assertDocumentScope,
  assertTrustedIpcSender,
  desktopIpcContracts,
  type IpcSenderIdentity
} from "../../../apps/desktop/src/shared/ipc/contracts";
import { createEtherBridge } from "../../../apps/desktop/src/preload/filePathBridge";

const trustedSender: IpcSenderIdentity = {
  rendererUrl: "http://127.0.0.1:5173/",
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
        saveState: "saved",
        documentRevisionId: "revision-2",
        graphId: "graph-root",
        graphRevisionId: "graph-revision-2",
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

  it("rejects the wrong webContents, frame URL, or origin", () => {
    expect(() =>
      assertTrustedIpcSender(trustedSender, {
        rendererUrl: trustedSender.rendererUrl,
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
          rendererUrl: trustedSender.rendererUrl,
          webContentsId: 7
        })
      ).toThrowError(expect.objectContaining({ code: "IPC_SENDER_REJECTED" }));
    }
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
});
