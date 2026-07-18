import { desktopIpcChannels } from "../shared/ipc/channels";
import type {
  DesktopDocumentEvent,
  DesktopIpcChannel,
  DesktopReference,
  DocumentDescriptor,
  NormalizedResult
} from "../shared/ipc/contracts";
import type { GraphTransaction } from "@ether/schema";
import type { Artifact, EtherGraph } from "@ether/schema";

type BridgeTransport = {
  invoke(channel: DesktopIpcChannel, request: unknown): Promise<NormalizedResult<unknown>>;
  subscribe(channel: typeof desktopIpcChannels.document.event, listener: (event: unknown) => void): () => void;
  openDroppedDocument(file: File): Promise<NormalizedResult<unknown>>;
};

async function unwrap<T>(promise: Promise<NormalizedResult<unknown>>): Promise<T> {
  const result = await promise;
  if (result.ok) return result.value as T;
  throw Object.assign(new Error(result.error.message), result.error);
}

export function createEtherBridge(transport: BridgeTransport) {
  const scoped = <T>(channel: DesktopIpcChannel, documentId: string) =>
    unwrap<T>(transport.invoke(channel, { documentId }));
  return {
    document: {
      bootstrap: () => unwrap<DocumentDescriptor>(transport.invoke(desktopIpcChannels.document.bootstrap, {})),
      new: () => unwrap<DocumentDescriptor>(transport.invoke(desktopIpcChannels.document.new, {})),
      open: () => unwrap<DocumentDescriptor>(transport.invoke(desktopIpcChannels.document.open, {})),
      openDropped: (file: File) => unwrap<DocumentDescriptor>(transport.openDroppedDocument(file)),
      save: (documentId: string) => scoped<DocumentDescriptor>(desktopIpcChannels.document.save, documentId),
      saveAs: (documentId: string) => scoped<DocumentDescriptor>(desktopIpcChannels.document.saveAs, documentId),
      saveCopy: (documentId: string) => scoped<DocumentDescriptor>(desktopIpcChannels.document.saveCopy, documentId),
      compact: (documentId: string) => scoped<{ beforeBytes: number; afterBytes: number }>(desktopIpcChannels.document.compact, documentId),
      makePortable: (documentId: string) => scoped<{
        cancelled: boolean;
        embeddedCount: number;
        expectedBytes: number;
        expectedCount: number;
        missingReferenceIds: string[];
      }>(desktopIpcChannels.document.makePortable, documentId),
      close: (documentId: string) => scoped<null>(desktopIpcChannels.document.close, documentId),
      onEvent: (listener: (event: DesktopDocumentEvent) => void) =>
        transport.subscribe(desktopIpcChannels.document.event, (event) => listener(event as DesktopDocumentEvent))
    },
    graph: {
      snapshot: (documentId: string) => scoped<{ graph: EtherGraph; revision: number }>(desktopIpcChannels.graph.snapshot, documentId),
      applyTransaction: (documentId: string, transaction: GraphTransaction) =>
        unwrap<{ graph: EtherGraph; revision: number }>(transport.invoke(desktopIpcChannels.graph.applyTransaction, { documentId, transaction }))
    },
    artifacts: {
      search: (documentId: string, text = "") =>
        unwrap<Artifact[]>(transport.invoke(desktopIpcChannels.artifacts.search, { documentId, text })),
      generateFake: (documentId: string) =>
        scoped<Artifact[]>(desktopIpcChannels.artifacts.generateFake, documentId)
    },
    references: {
      list: (documentId: string) => scoped<DesktopReference[]>(desktopIpcChannels.references.list, documentId),
      act: (documentId: string, referenceId: string, action: string) =>
        unwrap<DesktopReference[]>(transport.invoke(desktopIpcChannels.references.act, { documentId, referenceId, action }))
    },
    runtime: {
      versions: () => unwrap<{ electron: string; node: string }>(transport.invoke(desktopIpcChannels.runtime.versions, {}))
    }
  };
}
