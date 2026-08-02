import { desktopIpcChannels } from "../shared/ipc/channels";
import type {
  CompactResult,
  DesktopDocumentEvent,
  DesktopIpcChannel,
  DesktopReference,
  DocumentDescriptor,
  NormalizedResult,
  PortableResult,
  RepairResult,
  ReferenceFileSelectionResult
} from "../shared/ipc/contracts";
import type { GraphTransaction } from "@ether/schema";
import type {
  ApplicationCommand,
  ApplicationCommandResponse,
  ApplicationEvent,
  ApplicationQuery,
  ApplicationQueryResponse,
  Artifact,
  EtherGraph,
  ProviderHealthResult
} from "@ether/schema";

type BridgeTransport = {
  invoke(channel: DesktopIpcChannel, request: unknown): Promise<NormalizedResult<unknown>>;
  subscribe(
    channel: typeof desktopIpcChannels.document.event | typeof desktopIpcChannels.application.event,
    listener: (event: unknown) => void
  ): () => void;
  openDroppedDocument(file: File, documentId: string): Promise<NormalizedResult<unknown>>;
  importDroppedReference?: (
    file: File,
    input: { documentId: string; graphId: string; nodeId: string; role: import("@ether/schema").ConnectionRole; storage: "link" | "embed" }
  ) => Promise<NormalizedResult<unknown>>;
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
      repair: (allowLossy = false, confirmationId?: string) => unwrap<RepairResult>(transport.invoke(
        desktopIpcChannels.document.repair,
        { allowLossy, ...(confirmationId === undefined ? {} : { confirmationId }) }
      )),
      cancelRepair: () => unwrap<null>(transport.invoke(desktopIpcChannels.document.cancelRepair, {})),
      openDropped: (file: File, documentId: string) =>
        unwrap<DocumentDescriptor>(transport.openDroppedDocument(file, documentId)),
      save: (documentId: string) => scoped<DocumentDescriptor>(desktopIpcChannels.document.save, documentId),
      saveAs: (documentId: string) => scoped<DocumentDescriptor>(desktopIpcChannels.document.saveAs, documentId),
      saveCopy: (documentId: string) => scoped<DocumentDescriptor>(desktopIpcChannels.document.saveCopy, documentId),
      compact: (documentId: string) => scoped<CompactResult>(desktopIpcChannels.document.compact, documentId),
      makePortable: (documentId: string) => scoped<PortableResult>(desktopIpcChannels.document.makePortable, documentId),
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
        scoped<Artifact[]>(desktopIpcChannels.artifacts.generateFake, documentId),
      startDrag: (documentId: string, artifactIds: string[]) =>
        unwrap<null>(transport.invoke(desktopIpcChannels.artifacts.startDrag, { documentId, artifactIds }))
    },
    references: {
      list: (documentId: string) => scoped<DesktopReference[]>(desktopIpcChannels.references.list, documentId),
      act: (documentId: string, referenceId: string, action: string) =>
        unwrap<DesktopReference[]>(transport.invoke(desktopIpcChannels.references.act, { documentId, referenceId, action })),
      chooseAndLink: (input: {
        documentId: string;
        graphId: string;
        nodeId: string;
        role: import("@ether/schema").ConnectionRole;
        storage: "link" | "embed";
      }) => unwrap<ReferenceFileSelectionResult>(
        transport.invoke(desktopIpcChannels.references.chooseAndLink, input)
      ),
      importDropped: (file: File, input: {
        documentId: string;
        graphId: string;
        nodeId: string;
        role: import("@ether/schema").ConnectionRole;
        storage: "link" | "embed";
      }) => {
        if (transport.importDroppedReference === undefined) {
          return Promise.reject(new Error("Dropped reference import is not available in this renderer."));
        }
        return unwrap<ReferenceFileSelectionResult>(transport.importDroppedReference(file, input));
      }
    },
    permissions: {
      grantFolder: (documentId: string, purpose: "export" | "live-output") =>
        unwrap<{ grantId: string; displayName: string } | null>(transport.invoke(
          desktopIpcChannels.permissions.grantFolder,
          { documentId, purpose }
        ))
    },
    application: {
      command: (command: ApplicationCommand) =>
        unwrap<ApplicationCommandResponse>(transport.invoke(desktopIpcChannels.application.command, command)),
      query: (query: ApplicationQuery) =>
        unwrap<ApplicationQueryResponse>(transport.invoke(desktopIpcChannels.application.query, query)),
      onEvent: (listener: (event: ApplicationEvent) => void) =>
        transport.subscribe(desktopIpcChannels.application.event, (event) => listener(event as ApplicationEvent))
    },
    runtime: {
      versions: () => unwrap<{ app: string; electron: string; node: string }>(transport.invoke(desktopIpcChannels.runtime.versions, {})),
      providerHealth: () => unwrap<ProviderHealthResult>(transport.invoke(desktopIpcChannels.runtime.providerHealth, {})),
      providerPolicy: () => unwrap<{ antigravityCreditOveragesConfirmed: boolean }>(
        transport.invoke(desktopIpcChannels.runtime.providerPolicy, {})
      ),
      setProviderPolicy: (antigravityCreditOveragesConfirmed: boolean) =>
        unwrap<{ antigravityCreditOveragesConfirmed: boolean }>(
          transport.invoke(desktopIpcChannels.runtime.setProviderPolicy, {
            antigravityCreditOveragesConfirmed
          })
        ),
      geminiCredentialStatus: () => unwrap<{ state: "not-configured" | "configured" | "verified" | "error" | "encryption-unavailable"; verifiedAt: string | null }>(
        transport.invoke(desktopIpcChannels.runtime.geminiCredentialStatus, {})
      ),
      connectGeminiCredential: (apiKey: string) => unwrap<{ state: "not-configured" | "configured" | "verified" | "error" | "encryption-unavailable"; verifiedAt: string | null }>(
        transport.invoke(desktopIpcChannels.runtime.connectGeminiCredential, { apiKey })
      ),
      testGeminiCredential: () => unwrap<{ state: "not-configured" | "configured" | "verified" | "error" | "encryption-unavailable"; verifiedAt: string | null }>(
        transport.invoke(desktopIpcChannels.runtime.testGeminiCredential, {})
      ),
      removeGeminiCredential: () => unwrap<{ state: "not-configured" | "configured" | "verified" | "error" | "encryption-unavailable"; verifiedAt: string | null }>(
        transport.invoke(desktopIpcChannels.runtime.removeGeminiCredential, {})
      ),
      rendererInteractive: () => unwrap<null>(transport.invoke(desktopIpcChannels.runtime.rendererInteractive, {}))
    }
  };
}
