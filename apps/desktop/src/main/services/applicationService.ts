import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { lstat, mkdir, opendir, realpath } from "node:fs/promises";
import path from "node:path";

import { EtherApplication } from "@ether/application";
import type {
  ReferenceGrantAuthority,
  ReferenceGrantFingerprintRequest,
  ReferenceGrantPathRequest,
  DocumentStoreEnvironment,
  WritableLocationCapabilityAdapter,
  WritableLocationKind
} from "@ether/document";
import type { GenerationProvider } from "@ether/providers";
import {
  ApplicationCommandResponseSchema,
  ApplicationCommandSchema,
  ApplicationEventSchema,
  ApplicationQueryResponseSchema,
  ApplicationQuerySchema,
  ExecutionPlanSchema,
  type ApplicationCommand,
  type ApplicationCommandResponse,
  type ApplicationEvent,
  type ApplicationQuery,
  type ApplicationQueryResponse,
  type EtherError,
  type EtherGraph,
  type ExecutionPlan,
  type GraphTransaction,
  type LinkedReference
} from "@ether/schema";

import type {
  DesktopDocumentEvent,
  DesktopReference,
  ReferenceAction,
  CompactResult,
  DocumentCommandResult,
  DocumentDescriptor,
  PortableResult
} from "../../shared/ipc/contracts.js";

export interface NativeDialogPort {
  openDocument(): Promise<string | null>;
  saveDocument(kind?: "save-as" | "save-copy"): Promise<string | null>;
  locateReference(referenceId: string): Promise<string | null>;
  searchReferenceFolder(referenceId: string): Promise<string | null>;
  chooseOutputFolder?(purpose: "export" | "live-output"): Promise<string | null>;
  confirmPortable(input: {
    expectedBytes: number;
    expectedCount: number;
    missingReferences: PortableResult["missingReferences"];
  }): Promise<boolean>;
}

type SaveState = DocumentDescriptor["saveState"];

function blankGraph(): EtherGraph {
  const timestamp = new Date().toISOString();
  return {
    id: "graph-root",
    title: "Untitled Graph",
    kind: "root",
    createdAt: timestamp,
    updatedAt: timestamp,
    nodes: [],
    edges: [],
    groups: [],
    modules: [],
    viewState: {
      viewport: { x: 0, y: 0, zoom: 1 },
      selectedNodeIds: [],
      selectedEdgeIds: [],
      inspectorTarget: null
    }
  };
}

export class AutosaveCoordinator {
  private dirty = false;
  private generation = 0;
  private firstDirtyAt: number | null = null;
  private lastDirtyAt: number | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private maximumTimer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<void> | null = null;
  private lastError: unknown;
  private disposed = false;
  private saveState: SaveState = "saved";

  constructor(
    private readonly save: () => Promise<void>,
    private readonly onState: (state: { dirty: boolean; saveState: SaveState; error?: unknown }) => void = () => undefined
  ) {}

  markDirty(): void {
    if (this.disposed) return;
    this.dirty = true;
    this.generation += 1;
    const now = Date.now();
    this.lastDirtyAt = now;
    if (this.firstDirtyAt === null) {
      this.firstDirtyAt = now;
      this.maximumTimer = setTimeout(() => void this.flush(), 10_000);
    }
    if (this.idleTimer !== null) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => void this.flush(), 1_500);
    this.onState(this.state());
  }

  async flush(): Promise<void> {
    if (this.inFlight !== null) return this.inFlight;
    if (!this.dirty) return;
    this.clearTimers();
    const savingGeneration = this.generation;
    this.saveState = "saving";
    this.onState(this.state());
    const attempt = (async () => {
      try {
        await this.save();
        this.lastError = undefined;
        if (this.generation === savingGeneration) {
          this.dirty = false;
          this.firstDirtyAt = null;
          this.lastDirtyAt = null;
          this.saveState = "saved";
          this.onState(this.state());
        } else {
          this.dirty = true;
          this.firstDirtyAt = this.lastDirtyAt ?? Date.now();
        }
      } catch (error) {
        this.lastError = error;
        this.dirty = true;
        this.saveState = "needs-attention";
        this.onState({ ...this.state(), error });
      } finally {
        this.inFlight = null;
        if (this.dirty && this.lastError === undefined && !this.disposed) {
          void this.flush();
        }
      }
    })();
    this.inFlight = attempt;
    return attempt;
  }

  state(): { dirty: boolean; saveState: SaveState } {
    return { dirty: this.dirty, saveState: this.saveState };
  }

  async flushAndDispose(): Promise<void> {
    this.clearTimers();
    while (this.dirty || this.inFlight !== null) {
      if (this.inFlight !== null) await this.inFlight;
      else await this.flush();
      if (this.lastError !== undefined) throw this.lastError;
    }
    this.disposed = true;
  }

  dispose(): void {
    this.disposed = true;
    this.clearTimers();
  }

  private clearTimers(): void {
    if (this.idleTimer !== null) clearTimeout(this.idleTimer);
    if (this.maximumTimer !== null) clearTimeout(this.maximumTimer);
    this.idleTimer = null;
    this.maximumTimer = null;
  }
}

export class OpenDocumentCoordinator {
  private activeIdentity: string | null = null;

  constructor(private readonly port: { focus(): void; open(canonicalPath: string): Promise<void> }) {}

  async request(filePath: string): Promise<void> {
    const canonicalPath = await realpath(filePath);
    const identity = process.platform === "win32" ? canonicalPath.toLocaleLowerCase() : canonicalPath;
    if (this.activeIdentity === identity) {
      this.port.focus();
      return;
    }
    await this.port.open(canonicalPath);
    this.activeIdentity = identity;
  }

  markOpen(canonicalPath: string): void {
    this.activeIdentity = process.platform === "win32"
      ? path.resolve(canonicalPath).toLocaleLowerCase()
      : path.resolve(canonicalPath);
  }

  clear(): void {
    this.activeIdentity = null;
  }
}

export type OpenDocumentSource = "picker" | "drop" | "argv" | "second-instance" | "open-file";

export class OpenDocumentController {
  constructor(
    private readonly coordinator: OpenDocumentCoordinator,
    private readonly selectDocument: () => Promise<string | null>
  ) {}

  async request(source: OpenDocumentSource, filePath?: string): Promise<boolean> {
    const requestedPath = source === "picker" ? await this.selectDocument() : filePath;
    if (requestedPath === null) return false;
    if (requestedPath === undefined) {
      throw codedError("INVALID_DOCUMENT_PATH", `The ${source} open request has no document path.`);
    }
    await this.coordinator.request(requestedPath);
    return true;
  }
}

type DesktopGrantOperation = ReferenceGrantPathRequest["operation"] | "export" | "live-output";

interface GrantBinding {
  documentId: string;
  documentPath: string;
  grantId: string;
  operation: DesktopGrantOperation;
  path: string;
  fingerprint?: string;
}

interface PendingGrantRebind {
  destinationDocumentPath: string;
  id: string;
  retainSource: boolean;
  sourceDocumentId: string;
  sourceDocumentPath: string;
  switchActive: boolean;
  version: 1;
}

interface PendingGrantRevocation {
  documentId: string;
  grantId: string;
  version: 1;
}

type GrantPersistenceScope = "grants" | "rebinds" | "revocations";

export class DesktopPathGrantAuthority implements ReferenceGrantAuthority {
  private grants = new Map<string, GrantBinding>();
  private pendingRebinds = new Map<string, PendingGrantRebind>();
  private pendingRevocations = new Map<string, PendingGrantRevocation>();
  private readonly activeDocuments = new Map<string, string>();

  constructor(private readonly options: {
    storagePath?: string;
    persistenceCheckpoint?: (
      stage: "write" | "fsync" | "rename",
      scope: GrantPersistenceScope
    ) => void;
  } = {}) {
    this.load();
    this.loadPendingRebinds();
    this.loadPendingRevocations();
  }

  activateDocument(documentId: string, documentPath: string): void {
    const canonicalPath = canonicalGrantPath(documentPath);
    this.activeDocuments.set(documentId, canonicalPath);
    for (const pending of [...this.pendingRebinds.values()]) {
      if (pending.destinationDocumentPath === canonicalPath) {
        this.completeRebind(pending.id, documentId);
      }
    }
  }

  deactivateDocument(documentId: string): void {
    this.activeDocuments.delete(documentId);
  }

  grant(documentId: string, operation: DesktopGrantOperation, filePath: string): string {
    const documentPath = this.activeDocuments.get(documentId) ?? this.memoryDocumentPath(documentId);
    const grantId = randomUUID();
    const next = new Map(this.grants);
    next.set(grantKey(grantId, documentId), {
      documentId,
      documentPath,
      grantId,
      operation,
      path: canonicalGrantPath(filePath)
    });
    this.commit(next);
    return grantId;
  }

  authorizePath(request: ReferenceGrantPathRequest): boolean {
    const key = grantKey(request.grantId, request.documentId);
    if (this.pendingRevocations.has(key)) return false;
    const grant = this.grants.get(key);
    return grant !== undefined &&
      grant.documentPath === this.activeDocuments.get(request.documentId) &&
      grant.operation === request.operation &&
      grant.path === tryCanonicalGrantPath(request.path);
  }

  validateFingerprint(request: ReferenceGrantFingerprintRequest): boolean {
    const key = grantKey(request.grantId, request.documentId);
    if (this.pendingRevocations.has(key)) return false;
    const grant = this.grants.get(key);
    if (
      grant === undefined ||
      grant.documentPath !== this.activeDocuments.get(request.documentId) ||
      grant.operation !== request.operation ||
      grant.path !== tryCanonicalGrantPath(request.path)
    ) return false;
    const fingerprint = `${request.fingerprint.byteLength}:${request.fingerprint.sampleSha256}`;
    if (grant.fingerprint !== undefined && grant.fingerprint !== fingerprint) return false;
    if (grant.fingerprint === fingerprint) return true;
    const next = new Map(this.grants);
    next.set(grantKey(request.grantId, request.documentId), { ...grant, fingerprint });
    this.commit(next);
    return true;
  }

  allowResolve(grantId: string, documentId: string): void {
    const grant = this.grants.get(grantKey(grantId, documentId));
    if (grant !== undefined) {
      const next = new Map(this.grants);
      next.set(grantKey(grantId, documentId), { ...grant, operation: "resolve" });
      this.commit(next);
    }
  }

  /** Resolves an opaque desktop grant without exposing its path to the renderer. */
  resolveApplicationPathGrant(input: {
    documentId: string;
    pathGrantId: string;
    purpose: "live-output" | "export" | "reference";
  }): { displayName: string; kind: "directory" | "file"; path: string } {
    const key = grantKey(input.pathGrantId, input.documentId);
    const grant = this.grants.get(key);
    if (
      grant === undefined ||
      this.pendingRevocations.has(key) ||
      grant.documentPath !== this.activeDocuments.get(input.documentId) ||
      (input.purpose === "reference"
        ? grant.operation !== "link" && grant.operation !== "relink"
        : grant.operation !== input.purpose)
    ) {
      throw codedError("PATH_PERMISSION_REQUIRED", "The selected reference is no longer authorized for this document.");
    }
    return { displayName: path.basename(grant.path), kind: input.purpose === "reference" ? "file" : "directory", path: grant.path };
  }

  prepareRevocation(grantId: string, documentId: string): void {
    const key = grantKey(grantId, documentId);
    if (!this.grants.has(key) || this.pendingRevocations.has(key)) return;
    const next = new Map(this.pendingRevocations);
    next.set(key, { documentId, grantId, version: 1 });
    this.persistPendingRevocations(next);
    this.pendingRevocations = next;
  }

  cancelRevocation(grantId: string, documentId: string): "pending" | "revoked" {
    const key = grantKey(grantId, documentId);
    if (!this.pendingRevocations.has(key)) return "revoked";
    const next = new Map(this.pendingRevocations);
    next.delete(key);
    try {
      this.persistPendingRevocations(next);
      this.pendingRevocations = next;
      return "revoked";
    } catch {
      return "pending";
    }
  }

  revoke(grantId: string, documentId: string): "pending" | "revoked" {
    const key = grantKey(grantId, documentId);
    if (!this.pendingRevocations.has(key)) this.prepareRevocation(grantId, documentId);
    if (!this.pendingRevocations.has(key)) return "revoked";
    const nextGrants = new Map(this.grants);
    nextGrants.delete(key);
    try {
      this.persist(nextGrants);
      this.grants = nextGrants;
    } catch {
      return "pending";
    }
    const nextRevocations = new Map(this.pendingRevocations);
    nextRevocations.delete(key);
    try {
      this.persistPendingRevocations(nextRevocations);
      this.pendingRevocations = nextRevocations;
      return "revoked";
    } catch {
      return "pending";
    }
  }

  reconcileRevocations(
    documentId: string,
    activeGrantIds: readonly string[]
  ): "pending" | "revoked" {
    const active = new Set(activeGrantIds);
    let pending = false;
    for (const revocation of [...this.pendingRevocations.values()]) {
      if (revocation.documentId !== documentId) continue;
      const status = active.has(revocation.grantId)
        ? this.cancelRevocation(revocation.grantId, documentId)
        : this.revoke(revocation.grantId, documentId);
      if (status === "pending") pending = true;
    }
    return pending ? "pending" : "revoked";
  }

  revokeDocument(documentId: string): void {
    const next = new Map(this.grants);
    for (const [key, grant] of next) {
      if (grant.documentId === documentId) next.delete(key);
    }
    if (next.size !== this.grants.size) this.commit(next);
    this.activeDocuments.delete(documentId);
  }

  rebindDocument(input: {
    sourceDocumentId: string;
    sourceDocumentPath: string;
    destinationDocumentId: string;
    destinationDocumentPath: string;
    retainSource: boolean;
    switchActive?: boolean;
  }): void {
    const sourcePath = canonicalGrantPath(input.sourceDocumentPath);
    const destinationPath = canonicalGrantPath(input.destinationDocumentPath);
    if (this.activeDocuments.get(input.sourceDocumentId) !== sourcePath) {
      throw codedError("DOCUMENT_SCOPE_REJECTED", "Reference grants are not active for the source document identity.");
    }
    const bindings = [...this.grants.values()].filter((grant) =>
      grant.documentId === input.sourceDocumentId &&
      grant.documentPath === sourcePath &&
      !this.pendingRevocations.has(grantKey(grant.grantId, grant.documentId))
    );
    const next = new Map(this.grants);
    for (const binding of bindings) {
      next.set(grantKey(binding.grantId, input.destinationDocumentId), {
        ...binding,
        documentId: input.destinationDocumentId,
        documentPath: destinationPath
      });
      if (!input.retainSource) {
        next.delete(grantKey(binding.grantId, input.sourceDocumentId));
      }
    }
    if (bindings.length > 0) this.commit(next);
    if (input.switchActive === true) {
      this.activeDocuments.delete(input.sourceDocumentId);
      this.activeDocuments.set(input.destinationDocumentId, destinationPath);
    }
  }

  beginRebind(input: {
    sourceDocumentId: string;
    sourceDocumentPath: string;
    destinationDocumentPath: string;
    retainSource: boolean;
    switchActive: boolean;
  }): string {
    const sourcePath = canonicalGrantPath(input.sourceDocumentPath);
    if (this.activeDocuments.get(input.sourceDocumentId) !== sourcePath) {
      throw codedError("DOCUMENT_SCOPE_REJECTED", "Reference grants are not active for the source document identity.");
    }
    const pending: PendingGrantRebind = {
      destinationDocumentPath: canonicalGrantDestinationPath(input.destinationDocumentPath),
      id: randomUUID(),
      retainSource: input.retainSource,
      sourceDocumentId: input.sourceDocumentId,
      sourceDocumentPath: sourcePath,
      switchActive: input.switchActive,
      version: 1
    };
    const next = new Map(this.pendingRebinds);
    next.set(pending.id, pending);
    this.persistPendingRebinds(next);
    this.pendingRebinds = next;
    return pending.id;
  }

  completeRebind(id: string, destinationDocumentId: string): void {
    const pending = this.pendingRebinds.get(id);
    if (pending === undefined) return;
    this.applyRebind({
      sourceDocumentId: pending.sourceDocumentId,
      sourceDocumentPath: pending.sourceDocumentPath,
      destinationDocumentId,
      destinationDocumentPath: pending.destinationDocumentPath,
      retainSource: pending.retainSource
    });
    const remaining = new Map(this.pendingRebinds);
    remaining.delete(id);
    this.persistPendingRebinds(remaining);
    this.pendingRebinds = remaining;
    this.activatePublishedRebind(id, destinationDocumentId, pending);
  }

  cancelRebind(id: string): void {
    if (!this.pendingRebinds.has(id)) return;
    const remaining = new Map(this.pendingRebinds);
    remaining.delete(id);
    this.persistPendingRebinds(remaining);
    this.pendingRebinds = remaining;
  }

  activatePublishedRebind(
    id: string,
    destinationDocumentId: string,
    knownPending?: PendingGrantRebind
  ): void {
    const pending = knownPending ?? this.pendingRebinds.get(id);
    if (pending?.switchActive !== true) return;
    this.activeDocuments.delete(pending.sourceDocumentId);
    this.activeDocuments.set(destinationDocumentId, pending.destinationDocumentPath);
  }

  private memoryDocumentPath(documentId: string): string {
    if (this.options.storagePath !== undefined) {
      throw codedError("DOCUMENT_SCOPE_REJECTED", "Reference grants require an active document identity.");
    }
    const identity = `memory:${documentId}`;
    this.activeDocuments.set(documentId, identity);
    return identity;
  }

  private load(): void {
    if (this.options.storagePath === undefined) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(this.options.storagePath, "utf8"));
    } catch {
      return;
    }
    if (!Array.isArray(parsed)) return;
    for (const candidate of parsed) {
      if (!isGrantBinding(candidate)) continue;
      this.grants.set(grantKey(candidate.grantId, candidate.documentId), candidate);
    }
  }

  private loadPendingRebinds(): void {
    const pendingPath = this.pendingStoragePath();
    if (pendingPath === undefined) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(pendingPath, "utf8"));
    } catch {
      return;
    }
    if (!Array.isArray(parsed)) return;
    for (const candidate of parsed) {
      if (isPendingGrantRebind(candidate)) this.pendingRebinds.set(candidate.id, candidate);
    }
  }

  private loadPendingRevocations(): void {
    const storagePath = this.revocationStoragePath();
    if (storagePath === undefined) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(storagePath, "utf8"));
    } catch {
      return;
    }
    if (!Array.isArray(parsed)) return;
    for (const candidate of parsed) {
      if (!isPendingGrantRevocation(candidate)) continue;
      this.pendingRevocations.set(
        grantKey(candidate.grantId, candidate.documentId),
        candidate
      );
    }
  }

  private applyRebind(input: {
    sourceDocumentId: string;
    sourceDocumentPath: string;
    destinationDocumentId: string;
    destinationDocumentPath: string;
    retainSource: boolean;
  }): void {
    const next = new Map(this.grants);
    for (const binding of this.grants.values()) {
      if (
        binding.documentId !== input.sourceDocumentId ||
        binding.documentPath !== input.sourceDocumentPath ||
        this.pendingRevocations.has(grantKey(binding.grantId, binding.documentId))
      ) continue;
      next.set(grantKey(binding.grantId, input.destinationDocumentId), {
        ...binding,
        documentId: input.destinationDocumentId,
        documentPath: input.destinationDocumentPath
      });
      if (!input.retainSource) next.delete(grantKey(binding.grantId, input.sourceDocumentId));
    }
    this.commit(next);
  }

  private commit(next: Map<string, GrantBinding>): void {
    const publishable = new Map([...next].filter(([key]) => !this.pendingRevocations.has(key)));
    this.persist(publishable);
    this.grants = publishable;
  }

  private persist(grants: typeof this.grants): void {
    const storagePath = this.options.storagePath;
    if (storagePath === undefined) return;
    mkdirSync(path.dirname(storagePath), { recursive: true });
    const temporaryPath = `${storagePath}.${randomUUID()}.tmp`;
    let descriptor: number | undefined;
    try {
      descriptor = openSync(temporaryPath, "wx", 0o600);
      this.options.persistenceCheckpoint?.("write", "grants");
      writeFileSync(descriptor, `${JSON.stringify([...grants.values()], null, 2)}\n`, "utf8");
      this.options.persistenceCheckpoint?.("fsync", "grants");
      fsyncSync(descriptor);
      closeSync(descriptor);
      descriptor = undefined;
      this.options.persistenceCheckpoint?.("rename", "grants");
      renameSync(temporaryPath, storagePath);
    } finally {
      if (descriptor !== undefined) closeSync(descriptor);
      try {
        unlinkSync(temporaryPath);
      } catch {
        // The owned temporary was published or is already absent.
      }
    }
  }

  private pendingStoragePath(): string | undefined {
    const storagePath = this.options.storagePath;
    return storagePath === undefined
      ? undefined
      : path.join(path.dirname(storagePath), "reference-grants.pending.json");
  }

  private revocationStoragePath(): string | undefined {
    const storagePath = this.options.storagePath;
    return storagePath === undefined
      ? undefined
      : path.join(path.dirname(storagePath), "reference-grants.revocations.json");
  }

  private persistPendingRebinds(pending: Map<string, PendingGrantRebind>): void {
    const storagePath = this.pendingStoragePath();
    if (storagePath === undefined) return;
    this.persistJson(storagePath, [...pending.values()], "rebinds");
    if (pending.size === 0) {
      try {
        unlinkSync(storagePath);
      } catch (error) {
        if ((error as { code?: unknown } | null)?.code !== "ENOENT") throw error;
      }
    }
  }

  private persistPendingRevocations(pending: Map<string, PendingGrantRevocation>): void {
    const storagePath = this.revocationStoragePath();
    if (storagePath === undefined) return;
    this.persistJson(storagePath, [...pending.values()], "revocations");
    if (pending.size === 0) {
      try {
        unlinkSync(storagePath);
      } catch (error) {
        if ((error as { code?: unknown } | null)?.code !== "ENOENT") throw error;
      }
    }
  }

  private persistJson(storagePath: string, value: unknown, scope: GrantPersistenceScope): void {
    mkdirSync(path.dirname(storagePath), { recursive: true });
    const temporaryPath = `${storagePath}.${randomUUID()}.tmp`;
    let descriptor: number | undefined;
    try {
      descriptor = openSync(temporaryPath, "wx", 0o600);
      this.options.persistenceCheckpoint?.("write", scope);
      writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, "utf8");
      this.options.persistenceCheckpoint?.("fsync", scope);
      fsyncSync(descriptor);
      closeSync(descriptor);
      descriptor = undefined;
      this.options.persistenceCheckpoint?.("rename", scope);
      renameSync(temporaryPath, storagePath);
    } finally {
      if (descriptor !== undefined) closeSync(descriptor);
      try {
        unlinkSync(temporaryPath);
      } catch {
        // The owned temporary was published or is already absent.
      }
    }
  }
}

export interface DesktopApplicationServiceOptions {
  appDataRoot: string;
  appVersion: string;
  dialogs: NativeDialogPort;
  provider: GenerationProvider;
  executionProviders?: ConstructorParameters<typeof EtherApplication>[0]["executionProviders"];
  providerLifecycle?: {
    clearDocument(documentId: string): void;
  };
  locationCapability?: WritableLocationCapabilityAdapter;
  documentEnvironment?: Omit<
    DocumentStoreEnvironment,
    "leaseRoot" | "recoveryRoot" | "referenceGrantAuthority" | "locationCapability"
  >;
  simulationMode?: boolean;
  dispatchMode?: ConstructorParameters<typeof EtherApplication>[0]["dispatchMode"];
  autosaveOperation?: (application: EtherApplication) => Promise<void>;
  pathGrantPersistenceCheckpoint?: (
    stage: "write" | "fsync" | "rename",
    scope: GrantPersistenceScope
  ) => void;
  bootstrapOperation?: () => Promise<void>;
  referenceCandidateCheckpoint?: (
    candidatePath: string,
    stage: "before-grant" | "after-grant"
  ) => Promise<void> | void;
  mutationOperationCheckpoint?: (operation: "graph" | "reference" | "portable") => Promise<void> | void;
}

export class DesktopApplicationService {
  private application: EtherApplication | null = null;
  private current: DocumentDescriptor | null = null;
  private currentPath: string | null = null;
  private untitled = false;
  private revision = 0;
  private readonly listeners = new Set<(event: DesktopDocumentEvent) => void>();
  private readonly applicationListeners = new Set<(event: ApplicationEvent) => void>();
  private autosaveCoordinator: AutosaveCoordinator | null = null;
  private readonly pathGrants: DesktopPathGrantAuthority;
  private refreshTail: Promise<void> = Promise.resolve();
  private lifecycleTail: Promise<void> = Promise.resolve();
  private lifecycleAccepting = true;
  private closePromise: Promise<void> | null = null;
  private referenceSearchController: AbortController | null = null;
  private latestMcpPlanPreview: { documentId: string; plan: ExecutionPlan } | null = null;

  constructor(private readonly options: DesktopApplicationServiceOptions) {
    this.pathGrants = new DesktopPathGrantAuthority({
      storagePath: path.join(options.appDataRoot, "reference-grants.json"),
      persistenceCheckpoint: options.pathGrantPersistenceCheckpoint
    });
  }

  subscribe(listener: (event: DesktopDocumentEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async bootstrap(): Promise<DocumentDescriptor> {
    return this.enqueueLifecycle(async () => {
      await this.options.bootstrapOperation?.();
      return this.current ?? this.newDocumentNow();
    });
  }

  async newDocument(): Promise<DocumentDescriptor> {
    return this.enqueueLifecycle(() => this.newDocumentNow());
  }

  private async newDocumentNow(): Promise<DocumentDescriptor> {
    const directory = path.join(this.options.appDataRoot, "untitled");
    await mkdir(directory, { recursive: true });
    const filePath = path.join(directory, `${randomUUID()}.ether`);
    const application = this.createApplication();
    try {
      const created = await application.createDocument({ path: filePath, title: "Untitled", initialGraph: blankGraph() });
      await this.closeActiveDocument();
      this.activateApplication(application, created.documentId, filePath, true);
      return this.refresh("snapshot");
    } catch (error) {
      if (this.application !== application) await closeCandidate(application);
      throw error;
    }
  }

  async open(): Promise<DocumentDescriptor> {
    const selected = await this.options.dialogs.openDocument();
    if (selected === null) return this.requireSnapshot();
    return this.openPath(selected);
  }

  async openPath(filePath: string): Promise<DocumentDescriptor> {
    return this.enqueueLifecycle(() => this.openPathNow(filePath));
  }

  private async openPathNow(filePath: string): Promise<DocumentDescriptor> {
    const entry = await lstat(filePath);
    if (entry.isDirectory()) {
      throw codedError(
        "LEGACY_DIRECTORY_UNSUPPORTED",
        "Ether 4.0 opens single .ether files. Legacy Ether directories are not supported."
      );
    }
    if (!entry.isFile() || path.extname(filePath).toLocaleLowerCase() !== ".ether") {
      throw codedError("INVALID_DOCUMENT_PATH", "Choose a single Ether 4.0 .ether document.");
    }
    const canonicalPath = await realpath(filePath);
    if (this.currentPath !== null && sameCanonicalPath(this.currentPath, canonicalPath)) {
      return this.requireSnapshot();
    }
    const application = this.createApplication();
    try {
      const inspected = await application.inspectDocument({ path: canonicalPath, access: "prefer-write" });
      await application.queryDocumentHeader();
      await this.closeActiveDocument();
      const opened = await application.activateInspectedDocument();
      if (opened.documentId !== inspected.documentId) {
        throw codedError("DOCUMENT_SCOPE_REJECTED", "The inspected document identity changed during activation.");
      }
      this.activateApplication(application, opened.documentId, canonicalPath, false);
      return this.refresh("snapshot");
    } catch (error) {
      if (this.application !== application) await closeCandidate(application);
      throw error;
    }
  }

  async save(documentId: string): Promise<DocumentDescriptor> {
    return this.enqueueLifecycle(() => this.saveNow(documentId));
  }

  private async saveNow(documentId: string): Promise<DocumentDescriptor> {
    this.assertScope(documentId);
    if (this.untitled) {
      const saved = await this.saveAsNow(documentId);
      await this.requireApplication().saveDocument({ commandId: randomUUID() });
      return this.refresh("state", "saved", saved.displayName);
    }
    await this.requireApplication().saveDocument({ commandId: randomUUID() });
    return this.refresh("state", "saved");
  }

  async autosave(documentId: string): Promise<DocumentDescriptor> {
    return this.enqueueLifecycle(() => this.autosaveNow(documentId));
  }

  private async autosaveNow(documentId: string): Promise<DocumentDescriptor> {
    this.assertScope(documentId);
    if (this.untitled) return this.refresh("state", "saved");
    await this.requireApplication().saveDocument({ commandId: randomUUID() });
    return this.refresh("state", "saved");
  }

  async saveAs(documentId: string): Promise<DocumentDescriptor> {
    return this.enqueueLifecycle(() => this.saveAsNow(documentId));
  }

  private async saveAsNow(documentId: string): Promise<DocumentDescriptor> {
    this.assertScope(documentId);
    const destination = await this.options.dialogs.saveDocument("save-as");
    if (destination === null) return this.requireSnapshot();
    validateDestination(destination);
    const sourcePath = this.currentPath;
    if (sourcePath === null) throw codedError("DOCUMENT_NOT_OPEN", "No active document path is available.");
    const pendingRebindId = this.pathGrants.beginRebind({
      sourceDocumentId: documentId,
      sourceDocumentPath: sourcePath,
      destinationDocumentPath: destination,
      retainSource: true,
      switchActive: true
    });
    let saved;
    try {
      saved = await this.requireApplication().saveAsDocument({ path: destination });
    } catch (error) {
      try {
        this.pathGrants.cancelRebind(pendingRebindId);
      } catch {
        // The unpublished intent is harmless and remains available for deterministic cleanup.
      }
      throw error;
    }
    const destinationPath = await realpath(destination);
    this.currentPath = destinationPath;
    this.untitled = false;
    let rebindError: unknown;
    try {
      this.pathGrants.completeRebind(pendingRebindId, saved.documentId);
    } catch (error) {
      rebindError = error;
      try {
        this.pathGrants.completeRebind(pendingRebindId, saved.documentId);
      } catch {
        this.pathGrants.activatePublishedRebind(pendingRebindId, saved.documentId);
        await this.refresh("snapshot", "needs-attention");
        this.emitAttention(rebindError);
        await this.refreshTail;
        return this.requireSnapshot();
      }
    }
    return this.refresh("snapshot", "saved");
  }

  async saveCopy(documentId: string): Promise<DocumentDescriptor> {
    return this.enqueueLifecycle(() => this.saveCopyNow(documentId));
  }

  private async saveCopyNow(documentId: string): Promise<DocumentDescriptor> {
    this.assertScope(documentId);
    const destination = await this.options.dialogs.saveDocument("save-copy");
    if (destination === null) return this.requireSnapshot();
    validateDestination(destination);
    const sourcePath = this.currentPath;
    if (sourcePath === null) throw codedError("DOCUMENT_NOT_OPEN", "No active document path is available.");
    const pendingRebindId = this.pathGrants.beginRebind({
      sourceDocumentId: documentId,
      sourceDocumentPath: sourcePath,
      destinationDocumentPath: destination,
      retainSource: true,
      switchActive: false
    });
    let copied;
    try {
      copied = await this.requireApplication().saveCopyDocument({ path: destination });
    } catch (error) {
      try {
        this.pathGrants.cancelRebind(pendingRebindId);
      } catch {
        // The unpublished intent is harmless and remains available for deterministic cleanup.
      }
      throw error;
    }
    let rebindError: unknown;
    try {
      this.pathGrants.completeRebind(pendingRebindId, copied.documentId);
    } catch (error) {
      rebindError = error;
      try {
        this.pathGrants.completeRebind(pendingRebindId, copied.documentId);
      } catch {
        this.emitAttention(rebindError);
        await this.refreshTail;
        return this.refresh("state", "needs-attention");
      }
    }
    return this.refresh("state", "saved");
  }

  async compact(documentId: string): Promise<CompactResult> {
    return this.enqueueLifecycle(() => this.compactNow(documentId));
  }

  private async compactNow(documentId: string): Promise<CompactResult> {
    this.assertScope(documentId);
    const result = await this.requireApplication().compactDocument();
    await this.refresh("state", "saved");
    await this.emitCommandResult({ kind: "compact", ...result });
    return result;
  }

  async makePortable(documentId: string): Promise<PortableResult> {
    return this.enqueueLifecycle(() => this.makePortableNow(documentId));
  }

  private async makePortableNow(documentId: string): Promise<PortableResult> {
    this.assertScope(documentId);
    await this.options.mutationOperationCheckpoint?.("portable");
    const application = this.requireApplication();
    const references = await application.queryReferences();
    const preflight = await application.preflightDocumentPortable();
    const preflightMissing = identifyReferences(preflight.missingReferenceIds, references);
    if (!await this.options.dialogs.confirmPortable({
      expectedBytes: preflight.expectedBytes,
      expectedCount: preflight.expectedCount,
      missingReferences: preflightMissing
    })) {
      const cancelled: PortableResult = {
        cancelled: true,
        embeddedCount: 0,
        embeddedBytes: 0,
        expectedBytes: preflight.expectedBytes,
        expectedCount: preflight.expectedCount,
        missingReferences: preflightMissing
      };
      await this.emitCommandResult({ kind: "portable", ...cancelled });
      return cancelled;
    }
    const result = await application.makeDocumentPortable();
    const revocationAttention = result.grantRevocationPending
      ? grantRevocationAttentionError()
      : undefined;
    await this.refresh("references", revocationAttention === undefined ? "saving" : "needs-attention");
    const completed: PortableResult = {
      cancelled: false,
      embeddedCount: result.embeddedCount,
      embeddedBytes: result.embeddedBytes,
      expectedBytes: preflight.expectedBytes,
      expectedCount: preflight.expectedCount,
      missingReferences: identifyReferences(result.missingReferenceIds, references)
    };
    await this.emitCommandResult({ kind: "portable", ...completed });
    this.autosaveCoordinator?.markDirty();
    if (revocationAttention !== undefined) {
      this.emitAttention(revocationAttention);
      await this.refreshTail;
    }
    return completed;
  }

  async graphSnapshot(documentId: string) {
    this.assertScope(documentId);
    const snapshot = this.requireSnapshot();
    return { graph: await this.requireApplication().queryGraph(snapshot.graphId), revision: snapshot.revision };
  }

  async applyGraphTransaction(documentId: string, transaction: GraphTransaction) {
    return this.enqueueLifecycle(() => this.applyGraphTransactionNow(documentId, transaction));
  }

  private async applyGraphTransactionNow(documentId: string, transaction: GraphTransaction) {
    this.assertScope(documentId);
    await this.options.mutationOperationCheckpoint?.("graph");
    await this.requireApplication().applyGraphTransaction({ commandId: randomUUID(), transaction });
    const snapshot = await this.refresh("graph", "saving");
    this.autosaveCoordinator?.markDirty();
    return { graph: await this.requireApplication().queryGraph(snapshot.graphId), revision: snapshot.revision };
  }

  async searchArtifacts(documentId: string, text: string) {
    this.assertScope(documentId);
    return this.requireApplication().searchArtifacts({ text });
  }

  async generateFakeArtifact(documentId: string) {
    return this.enqueueLifecycle(() => this.generateFakeArtifactNow(documentId));
  }

  async grantFolder(documentId: string, purpose: "export" | "live-output"): Promise<{ grantId: string; displayName: string } | null> {
    if (this.current?.documentId !== documentId || this.application === null) throw codedError("DOCUMENT_SCOPE_REJECTED", "The active document does not match this request.");
    if (this.options.dialogs.chooseOutputFolder === undefined) throw codedError("PATH_PERMISSION_REQUIRED", "Folder selection is unavailable in this desktop host.");
    const selected = await this.options.dialogs.chooseOutputFolder(purpose);
    if (selected === null) return null;
    if (!(await lstat(selected)).isDirectory()) throw codedError("PATH_GRANT_KIND_MISMATCH", "The selected output destination is not a folder.");
    const grantId = this.pathGrants.grant(documentId, purpose, selected);
    try {
      await this.application.grantPathPermit(randomUUID(), grantId, purpose);
      return { grantId, displayName: path.basename(selected) };
    } catch (error) {
      this.pathGrants.revoke(grantId, documentId);
      throw error;
    }
  }

  async prepareArtifactDrag(documentId: string, artifactIds: readonly string[]): Promise<string[]> {
    if (this.current?.documentId !== documentId) throw codedError("DOCUMENT_SCOPE_REJECTED", "The active document does not match this request.");
    const result = await this.requireApplication().createDragExport(randomUUID(), artifactIds, 24);
    return result.paths;
  }

  subscribeApplication(listener: (event: ApplicationEvent) => void): () => void {
    this.applicationListeners.add(listener);
    return () => this.applicationListeners.delete(listener);
  }

  async executeApplicationCommand(command: ApplicationCommand): Promise<ApplicationCommandResponse> {
    const parsed = ApplicationCommandSchema.parse(command);
    if (!applicationCommandAvailableToRenderer(parsed.name)) {
      throw codedError(
        "DESKTOP_LIFECYCLE_REQUIRED",
        "Use Ether's File commands for document lifecycle operations."
      );
    }
    return this.enqueueLifecycle(async () => {
      if ("documentId" in parsed) this.assertScope(parsed.documentId);
      const response = await this.requireApplication().execute(parsed);
      if (response.kind === "error") throw boundaryError(response.error);
      const validated = ApplicationCommandResponseSchema.parse(response);
      if ("documentId" in parsed && applicationCommandMutationPolicy[parsed.name]) {
        this.autosaveCoordinator?.markDirty();
      }
      return validated;
    });
  }

  async executeApplicationQuery(query: ApplicationQuery): Promise<ApplicationQueryResponse> {
    const parsed = ApplicationQuerySchema.parse(query);
    if ("documentId" in parsed) this.assertScope(parsed.documentId);
    const response = await this.requireApplication().query(parsed);
    if (response.kind === "error") throw boundaryError(response.error);
    return redactApplicationQueryResponse(ApplicationQueryResponseSchema.parse(response));
  }

  mcpActiveDocument(): { documentId: string } | null {
    return this.current === null ? null : { documentId: this.current.documentId };
  }

  async grantMcpEditPermit(documentId: string, expiresAt: string | null = null) {
    this.assertScope(documentId);
    return this.requireApplication().grantEditPermit(`mcp-edit-${randomUUID()}`, expiresAt);
  }

  async grantMcpRunPermit(documentId: string, planId: string, contentHash: string) {
    this.assertScope(documentId);
    return this.requireApplication().grantRunPermit({
      commandId: `mcp-run-${randomUUID()}`,
      planId,
      contentHash
    });
  }

  latestMcpRunPlan(documentId: string): ExecutionPlan | null {
    this.assertScope(documentId);
    if (this.latestMcpPlanPreview?.documentId !== documentId) return null;
    return structuredClone(this.latestMcpPlanPreview.plan);
  }

  async approveLatestMcpRunPlan(documentId: string) {
    this.assertScope(documentId);
    const latest = this.latestMcpPlanPreview;
    if (latest === null || latest.documentId !== documentId) {
      throw codedError("MCP_PLAN_APPROVAL_UNAVAILABLE", "Codex has not previewed a run plan for the active document yet.");
    }
    const persisted = await this.requireApplication().queryPlan(latest.plan.id);
    if (persisted.documentId !== documentId || persisted.contentHash !== latest.plan.contentHash) {
      throw codedError("MCP_PLAN_APPROVAL_STALE", "The latest Codex plan no longer matches its persisted immutable plan.");
    }
    return this.grantMcpRunPermit(documentId, persisted.id, persisted.contentHash);
  }

  mcpInspectPermits(documentId: string) {
    this.assertScope(documentId);
    return this.requireApplication().inspectPermits();
  }

  async executeMcpCommand(command: ApplicationCommand): Promise<ApplicationCommandResponse> {
    const parsed = ApplicationCommandSchema.parse(command);
    if (!new Set<ApplicationCommand["name"]>(["recipe.preview", "run.preview", "run.start"]).has(parsed.name)) {
      throw codedError("MCP_COMMAND_REJECTED", `The MCP bridge cannot execute ${parsed.name} through its generic command lane.`);
    }
    const response = await this.executeApplicationCommand(parsed);
    if (parsed.name === "run.preview") {
      const plan = ExecutionPlanSchema.parse((response.payload as { plan?: unknown }).plan);
      if (plan.documentId !== parsed.documentId) {
        throw codedError("MCP_PLAN_SCOPE_MISMATCH", "The previewed run plan does not belong to the active document.");
      }
      this.latestMcpPlanPreview = { documentId: plan.documentId, plan };
    }
    return response;
  }

  executeMcpQuery(query: ApplicationQuery): Promise<ApplicationQueryResponse> {
    return this.executeApplicationQuery(ApplicationQuerySchema.parse(query));
  }

  async previewMcpGraphTransaction(documentId: string, transaction: GraphTransaction) {
    this.assertScope(documentId);
    return this.requireApplication().previewGraphTransaction(transaction);
  }

  async applyMcpGraphTransaction(input: {
    commandId: string;
    documentId: string;
    editPermitId: string;
    transaction: GraphTransaction;
  }) {
    return this.enqueueLifecycle(async () => {
      this.assertScope(input.documentId);
      const result = await this.requireApplication().applyGraphTransactionWithEditPermit(input);
      this.autosaveCoordinator?.markDirty();
      await this.refresh("graph", "saving");
      return result;
    });
  }

  async instantiateMcpRecipe(input: { command: ApplicationCommand; editPermitId: string }) {
    return this.enqueueLifecycle(async () => {
      const command = ApplicationCommandSchema.parse(input.command);
      if (command.name !== "recipe.instantiate" || !("documentId" in command)) {
        throw codedError("MCP_COMMAND_REJECTED", "The recipe bridge lane accepts only document-scoped recipe.instantiate commands.");
      }
      this.assertScope(command.documentId);
      const application = this.requireApplication();
      application.requireEditPermit(input.editPermitId);
      const response = await application.execute(command);
      if (response.kind === "error") throw boundaryError(response.error);
      const validated = ApplicationCommandResponseSchema.parse(response);
      this.autosaveCoordinator?.markDirty();
      await this.refresh("graph", "saving");
      return validated.payload as Record<string, unknown>;
    });
  }

  async cancelMcpRun(input: {
    commandId: string;
    contentHash: string;
    documentId: string;
    jobId: string;
    planId: string;
    runPermitId: string;
  }) {
    return this.enqueueLifecycle(async () => {
      this.assertScope(input.documentId);
      return { job: await this.requireApplication().cancelRunWithPermit(input) };
    });
  }

  async retryMcpRun(input: {
    commandId: string;
    contentHash: string;
    documentId: string;
    jobId: string;
    planId: string;
    runPermitId: string;
    workItemIds: readonly string[];
  }) {
    return this.enqueueLifecycle(async () => {
      this.assertScope(input.documentId);
      return { job: await this.requireApplication().retryRunWithPermit(input) };
    });
  }

  async chooseAndLinkReference(input: {
    documentId: string;
    graphId: string;
    nodeId: string;
    role: import("@ether/schema").ConnectionRole;
    storage: "link" | "embed";
    droppedPath?: string;
  }): Promise<{ cancelled: true } | { cancelled: false; referenceId: string }> {
    return this.enqueueLifecycle(async () => {
      this.assertScope(input.documentId);
      const selected = input.droppedPath ?? await this.options.dialogs.locateReference(input.nodeId);
      if (selected === null) return { cancelled: true };
      const grantId = this.pathGrants.grant(input.documentId, "link", selected);
      const application = this.requireApplication();
      try {
        await application.grantPathPermit(randomUUID(), grantId, "reference");
        const linked = await application.execute({
          kind: "command",
          id: randomUUID(),
          correlationId: randomUUID(),
          documentId: input.documentId,
          name: "reference.link",
          payload: {
            graphId: input.graphId,
            nodeId: input.nodeId,
            pathGrantId: grantId,
            role: input.role
          }
        });
        if (linked.kind === "error") throw boundaryError(linked.error);
        if (linked.name !== "reference.link") throw codedError("REFERENCE_LINK_FAILED", "Ether returned an unexpected reference response.");
        this.pathGrants.allowResolve(grantId, input.documentId);
        if (input.storage === "embed") {
          const embedded = await application.execute({
            kind: "command",
            id: randomUUID(),
            correlationId: randomUUID(),
            documentId: input.documentId,
            name: "reference.embed",
            payload: { referenceId: linked.payload.referenceId }
          });
          if (embedded.kind === "error") throw boundaryError(embedded.error);
        }
        this.autosaveCoordinator?.markDirty();
        return { cancelled: false, referenceId: linked.payload.referenceId };
      } catch (error) {
        this.revokePathGrant(grantId, input.documentId);
        throw error;
      }
    });
  }

  private async generateFakeArtifactNow(documentId: string) {
    this.assertScope(documentId);
    if (this.options.simulationMode !== true) {
      throw codedError("SIMULATION_DISABLED", "Simulation output is available only in diagnostic test mode.");
    }
    const application = this.requireApplication();
    let snapshot = this.requireSnapshot();
    let graph = await application.queryGraph(snapshot.graphId);
    if (!graph.nodes.some((node) => node.config.kind === "generation.image")) {
      const promptId = `prompt-${randomUUID()}`;
      const generatorId = `generator-${randomUUID()}`;
      const transaction: GraphTransaction = {
        id: randomUUID(),
        baseDocumentRevisionId: snapshot.documentRevisionId,
        baseGraphRevisions: { [graph.id]: snapshot.graphRevisionId },
        title: "Add fake image workflow",
        actor: "user",
        layoutPolicy: "preserve",
        operations: [
          {
            type: "addNode",
            graphId: graph.id,
            node: {
              id: promptId,
              definitionId: "prompt.text",
              title: "Creative direction",
              position: { x: 120, y: 160 },
              size: { width: 240, height: 132 },
              config: {
                kind: "prompt.text",
                body: "A luminous blue object in a precise DreamBay studio composition.",
                assembly: "append"
              },
              presentation: { collapsed: false, accent: "default", previewMode: "content" }
            }
          },
          {
            type: "addNode",
            graphId: graph.id,
            node: {
              id: generatorId,
              definitionId: "generation.image",
              title: "Image Generator",
              position: { x: 460, y: 160 },
              size: { width: 250, height: 142 },
              config: {
                kind: "generation.image",
                providerId: "ether-fake-local",
                profileId: "fake-image-default",
                aspectRatio: "1:1",
                resolution: { width: 64, height: 64 },
                outputCount: 1
              },
              presentation: { collapsed: false, accent: "default", previewMode: "summary" }
            }
          },
          {
            type: "addEdge",
            graphId: graph.id,
            edge: {
              id: `edge-${randomUUID()}`,
              from: { kind: "node", nodeId: promptId, channel: "text" },
              to: { kind: "node", nodeId: generatorId, channel: "text" },
              role: "subject",
              order: 0,
              selector: { kind: "latest-approved" },
              adapter: { kind: "auto" },
              enabled: true
            }
          }
        ]
      };
      await application.applyGraphTransaction({ commandId: randomUUID(), transaction });
      snapshot = await this.refresh("graph", "saving");
      graph = await application.queryGraph(snapshot.graphId);
    }

    const before = new Set((await application.searchArtifacts({ text: "" })).map((artifact) => artifact.id));
    const plan = await application.previewRun({
      commandId: randomUUID(),
      graphId: graph.id,
      scope: { kind: "graph" }
    });
    const permit = await application.grantRunPermit({
      commandId: randomUUID(),
      planId: plan.id,
      contentHash: plan.contentHash
    });
    const job = await application.startRun({
      commandId: randomUUID(),
      planId: plan.id,
      contentHash: plan.contentHash,
      runPermitId: permit.id
    });
    const completed = await application.waitForJob(job.id);
    if (completed.status !== "completed") {
      throw codedError("FAKE_GENERATION_FAILED", `Fake generation ended in ${completed.status}.`);
    }
    await this.refresh("artifacts", "saving");
    this.autosaveCoordinator?.markDirty();
    return (await application.searchArtifacts({ text: "" })).filter((artifact) => !before.has(artifact.id));
  }

  async listReferences(documentId: string): Promise<DesktopReference[]> {
    this.assertScope(documentId);
    const references = await this.requireApplication().queryReferences();
    const writable = this.requireSnapshot().mode === "writable";
    const hasMissingReferences = references.some((reference) => reference.state === "missing");
    return Promise.all(references.map(async (reference) => ({
      id: reference.id,
      displayName: reference.displayName,
      mediaType: reference.mediaType,
      state: reference.state,
      actions: referenceCapabilities(reference, {
        writable,
        sourceAvailable: await referenceSourceAvailable(reference),
        hasMissingReferences
      })
    })));
  }

  async actOnReference(documentId: string, referenceId: string, action: string) {
    return this.enqueueLifecycle(() => this.actOnReferenceNow(documentId, referenceId, action));
  }

  private async actOnReferenceNow(documentId: string, referenceId: string, action: string) {
    this.assertScope(documentId);
    await this.options.mutationOperationCheckpoint?.("reference");
    const application = this.requireApplication();
    const persistedBefore = (await application.queryReferences()).find((candidate) => candidate.id === referenceId);
    const reference = (await this.listReferences(documentId)).find((candidate) => candidate.id === referenceId);
    if (reference === undefined) throw codedError("REFERENCE_NOT_FOUND", `Unknown reference ${referenceId}.`);
    if (!reference.actions.includes(action as ReferenceAction)) {
      throw codedError("REFERENCE_ACTION_UNAVAILABLE", "That recovery action is not currently available.");
    }
    let revocationAttention: unknown;
    try {
    if (action === "locate") {
      const selected = await this.options.dialogs.locateReference(referenceId);
      if (selected !== null) {
        const grantId = this.pathGrants.grant(documentId, "relink", selected);
        try {
          await application.relinkDocumentReference({
            referenceId,
            sourcePath: selected,
            pathGrantId: grantId
          });
          this.pathGrants.allowResolve(grantId, documentId);
        } catch (error) {
          this.pathGrants.revoke(grantId, documentId);
          throw error;
        }
      }
    } else if (action === "search-folder" || action === "relink-all") {
      const folder = await this.options.dialogs.searchReferenceFolder(referenceId);
      if (folder !== null) {
        const targets = action === "relink-all"
          ? (await application.queryReferences()).filter((reference) => reference.state === "missing")
          : (await application.queryReferences()).filter((reference) => reference.id === referenceId);
        this.referenceSearchController?.abort();
        const controller = new AbortController();
        this.referenceSearchController = controller;
        try {
          for (const target of targets) {
            for await (const candidate of searchReferenceFiles(folder, {
              extensions: referenceExtensions(target),
              signal: controller.signal
            })) {
              let grantId: string | undefined;
              try {
                await this.options.referenceCandidateCheckpoint?.(candidate, "before-grant");
                grantId = this.pathGrants.grant(documentId, "relink", candidate);
                await this.options.referenceCandidateCheckpoint?.(candidate, "after-grant");
                await application.relinkDocumentReference({
                  referenceId: target.id,
                  sourcePath: candidate,
                  pathGrantId: grantId
                });
                this.pathGrants.allowResolve(grantId, documentId);
                break;
              } catch (error) {
                if (grantId !== undefined) {
                  const revokeError = this.revokePathGrant(grantId, documentId);
                  if (revokeError !== undefined) revocationAttention ??= revokeError;
                }
                if (!await isSkippableReferenceCandidateError(error, candidate)) throw error;
              }
            }
          }
        } finally {
          if (this.referenceSearchController === controller) this.referenceSearchController = null;
        }
      }
    } else if (action === "use-embedded-preview") {
      await application.useEmbeddedReferencePreview(referenceId);
    } else if (action === "embed-available-copy") {
      const result = await application.embedAvailableReference(referenceId);
      if (result?.grantRevocationPending) revocationAttention = grantRevocationAttentionError();
    } else if (action === "remove") {
      const result = await application.removeDocumentReference(referenceId);
      if (result?.grantRevocationPending) revocationAttention = grantRevocationAttentionError();
    } else {
      throw codedError("INVALID_REFERENCE_ACTION", `Unsupported reference action: ${action}`);
    }
    } catch (error) {
      const persistedAfter = (await application.queryReferences()).find((candidate) => candidate.id === referenceId);
      if (
        persistedBefore?.pathGrantId !== null &&
        persistedBefore?.pathGrantId !== undefined &&
        (persistedAfter === undefined || persistedAfter.pathGrantId === null)
      ) {
        try {
          const revokeError = this.revokePathGrant(persistedBefore.pathGrantId, documentId);
          revocationAttention = revokeError ?? error;
        } catch {
          revocationAttention = error;
        }
        await this.refresh("references", "needs-attention");
        this.autosaveCoordinator?.markDirty();
        this.emitAttention(revocationAttention);
        await this.refreshTail;
        return this.listReferences(documentId);
      }
      throw error;
    }
    await this.refresh("references", revocationAttention === undefined ? "saving" : "needs-attention");
    this.autosaveCoordinator?.markDirty();
    if (revocationAttention !== undefined) {
      this.emitAttention(revocationAttention);
      await this.refreshTail;
    }
    return this.listReferences(documentId);
  }

  async artifactDescriptor(documentId: string, artifactId: string) {
    this.assertScope(documentId);
    return this.requireApplication().queryArtifactDescriptor(artifactId);
  }

  async readArtifactRange(
    documentId: string,
    artifactId: string,
    start: number,
    endExclusive: number
  ) {
    this.assertScope(documentId);
    return this.requireApplication().readArtifactRange(artifactId, start, endExclusive);
  }

  streamArtifactRange(
    documentId: string,
    artifactId: string,
    start: number,
    endExclusive: number
  ) {
    this.assertScope(documentId);
    return this.requireApplication().streamArtifactRange(artifactId, start, endExclusive);
  }

  snapshot(): DocumentDescriptor {
    return this.requireSnapshot();
  }

  activePath(): string | null {
    return this.currentPath;
  }

  async closeDocument(): Promise<void> {
    return this.enqueueLifecycle(() => this.closeActiveDocument());
  }

  async close(): Promise<void> {
    if (this.closePromise !== null) return this.closePromise;
    this.lifecycleAccepting = false;
    this.abortReferenceSearch();
    const draining = this.appendLifecycle(() => this.closeActiveDocument());
    this.closePromise = draining.catch((error) => {
      this.lifecycleAccepting = true;
      this.closePromise = null;
      throw error;
    });
    return this.closePromise;
  }

  drainLifecycle(): Promise<void> {
    return this.lifecycleTail;
  }

  private async closeActiveDocument(): Promise<void> {
    const closingDocumentId = this.current?.documentId;
    this.abortReferenceSearch();
    await this.autosaveCoordinator?.flushAndDispose();
    this.autosaveCoordinator = null;
    await this.refreshTail;
    if (this.application !== null) await this.application.closeDocument();
    if (closingDocumentId !== undefined) this.options.providerLifecycle?.clearDocument(closingDocumentId);
    if (closingDocumentId !== undefined) this.pathGrants.deactivateDocument(closingDocumentId);
    this.application = null;
    this.current = null;
    this.currentPath = null;
    this.untitled = false;
    this.latestMcpPlanPreview = null;
  }

  private abortReferenceSearch(): void {
    this.referenceSearchController?.abort();
    this.referenceSearchController = null;
  }

  private revokePathGrant(grantId: string, documentId: string): unknown | undefined {
    try {
      return this.pathGrants.revoke(grantId, documentId) === "pending"
        ? grantRevocationAttentionError()
        : undefined;
    } catch (error) {
      return error;
    }
  }

  private createApplication(): EtherApplication {
    const application = new EtherApplication({
      appDataRoot: this.options.appDataRoot,
      appVersion: this.options.appVersion,
      provider: this.options.provider,
      executionProviders: this.options.executionProviders,
      dispatchMode: this.options.dispatchMode,
      pathGrantResolver: {
        resolve: (input) => this.pathGrants.resolveApplicationPathGrant(input)
      },
      documentEnvironment: {
        ...this.options.documentEnvironment,
        ...(this.options.locationCapability === undefined
          ? {}
          : { locationCapability: this.options.locationCapability }),
        referenceGrantAuthority: this.pathGrants
      }
    });
    application.events.subscribe((rawEvent) => {
      if (this.application !== application || this.current === null) return;
      const event = ApplicationEventSchema.parse(rawEvent);
      if ("documentId" in event && event.documentId !== this.current.documentId) return;
      for (const listener of this.applicationListeners) listener(event);
      void this.refresh("state");
    });
    return application;
  }

  private activateApplication(
    application: EtherApplication,
    documentId: string,
    filePath: string,
    untitled: boolean
  ): void {
    this.latestMcpPlanPreview = null;
    this.pathGrants.activateDocument(documentId, filePath);
    this.application = application;
    this.currentPath = filePath;
    this.untitled = untitled;
    this.autosaveCoordinator = new AutosaveCoordinator(
      () => this.options.autosaveOperation?.(application) ?? application.autosaveDocument(),
      (state) => {
        if (this.application === application && this.current !== null) {
          if (state.error !== undefined) this.emitAttention(state.error);
          else void this.refresh("state", state.saveState).catch((error) => this.emitAttention(error));
        }
      }
    );
  }

  private enqueueLifecycle<T>(operation: () => Promise<T>): Promise<T> {
    if (!this.lifecycleAccepting) {
      return Promise.reject(codedError("LIFECYCLE_CLOSING", "The document lifecycle is closing."));
    }
    return this.appendLifecycle(operation);
  }

  private appendLifecycle<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.lifecycleTail.then(operation, operation);
    this.lifecycleTail = result.then(() => undefined, () => undefined);
    return result;
  }

  private refresh(
    kind: DesktopDocumentEvent["kind"],
    saveState?: SaveState,
    displayNameOverride?: string
  ): Promise<DocumentDescriptor> {
    const operation = this.refreshTail.then(() => this.performRefresh(kind, saveState, displayNameOverride));
    this.refreshTail = operation.then(() => undefined, () => undefined);
    return operation;
  }

  private async performRefresh(
    kind: DesktopDocumentEvent["kind"],
    saveState?: SaveState,
    displayNameOverride?: string
  ): Promise<DocumentDescriptor> {
    const application = this.requireApplication();
    const document = await application.queryDocument();
    const header = await application.queryDocumentHeader();
    const graphId = Object.keys(document.graphRevisions)[0];
    if (graphId === undefined) throw codedError("GRAPH_NOT_FOUND", "The document has no root graph.");
    this.revision += 1;
    const mode = document.mode;
    this.current = {
      documentId: document.documentId,
      displayName: displayNameOverride ?? (this.untitled || this.currentPath === null ? "Untitled" : path.basename(this.currentPath)),
      named: !this.untitled,
      mode,
      readOnlyReason: document.readOnlyReason,
      commands: documentCommandCapabilities(mode),
      saveState: saveState ?? this.current?.saveState ?? "saved",
      documentRevisionId: document.documentRevisionId,
      graphId,
      graphRevisionId: document.graphRevisions[graphId]!,
      simulationEnabled: this.options.simulationMode === true,
      revision: this.revision
    };
    const event: DesktopDocumentEvent = { kind, documentId: this.current.documentId, revision: this.revision, snapshot: this.current };
    for (const listener of this.listeners) listener(structuredClone(event));
    void header;
    return this.current;
  }

  private emitAttention(error: unknown): void {
    const operation = this.refreshTail.then(() => {
      if (this.current === null) return;
      this.revision += 1;
      this.current = { ...this.current, saveState: "needs-attention", revision: this.revision };
      const candidateCode = (error as { code?: unknown } | null)?.code;
      const event: DesktopDocumentEvent = {
        kind: "state",
        documentId: this.current.documentId,
        revision: this.revision,
        saveState: "needs-attention",
        snapshot: this.current,
        error: {
          code: typeof candidateCode === "string" ? candidateCode : "AUTOSAVE_FAILED",
          category: "document",
          message: error instanceof Error ? error.message : "Autosave failed.",
          retryable: true
        }
      };
      for (const listener of this.listeners) listener(structuredClone(event));
    });
    this.refreshTail = operation.then(() => undefined, () => undefined);
  }

  private emitCommandResult(commandResult: DocumentCommandResult): Promise<void> {
    const operation = this.refreshTail.then(() => {
      if (this.current === null) return;
      this.revision += 1;
      this.current = { ...this.current, revision: this.revision };
      const event: DesktopDocumentEvent = {
        kind: "state",
        documentId: this.current.documentId,
        revision: this.revision,
        snapshot: this.current,
        commandResult
      };
      for (const listener of this.listeners) listener(structuredClone(event));
    });
    this.refreshTail = operation.then(() => undefined, () => undefined);
    return operation;
  }

  private assertScope(documentId: string): void {
    if (documentId !== this.requireSnapshot().documentId) {
      throw codedError("DOCUMENT_SCOPE_REJECTED", "The request does not target the active document.");
    }
  }

  private requireApplication(): EtherApplication {
    if (this.application === null) throw codedError("DOCUMENT_NOT_OPEN", "No Ether document is open.");
    return this.application;
  }

  private requireSnapshot(): DocumentDescriptor {
    if (this.current === null) throw codedError("DOCUMENT_NOT_OPEN", "No Ether document is open.");
    return this.current;
  }
}

function validateDestination(destination: string): void {
  if (path.extname(destination).toLocaleLowerCase() !== ".ether") {
    throw codedError("INVALID_DESTINATION", "Ether documents must use the .ether extension.");
  }
}

function codedError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

function canonicalGrantPath(filePath: string): string {
  const canonical = realpathSync.native(filePath);
  return process.platform === "win32" ? canonical.toLocaleLowerCase() : canonical;
}

function canonicalGrantDestinationPath(filePath: string): string {
  try {
    return canonicalGrantPath(filePath);
  } catch {
    const canonicalParent = realpathSync.native(path.dirname(path.resolve(filePath)));
    const destination = path.join(canonicalParent, path.basename(filePath));
    return process.platform === "win32" ? destination.toLocaleLowerCase() : destination;
  }
}

function tryCanonicalGrantPath(filePath: string): string | null {
  try {
    return canonicalGrantPath(filePath);
  } catch {
    return null;
  }
}

function grantKey(grantId: string, documentId: string): string {
  return `${grantId}\0${documentId}`;
}

function isGrantBinding(value: unknown): value is {
  documentId: string;
  documentPath: string;
  grantId: string;
  operation: DesktopGrantOperation;
  path: string;
  fingerprint?: string;
} {
  if (value === null || typeof value !== "object") return false;
  const binding = value as Record<string, unknown>;
  return typeof binding.documentId === "string" &&
    typeof binding.documentPath === "string" &&
    typeof binding.grantId === "string" &&
    ["link", "relink", "resolve", "export", "live-output"].includes(String(binding.operation)) &&
    typeof binding.path === "string" &&
    (binding.fingerprint === undefined || typeof binding.fingerprint === "string");
}

function isPendingGrantRebind(value: unknown): value is PendingGrantRebind {
  if (value === null || typeof value !== "object") return false;
  const pending = value as Record<string, unknown>;
  return pending.version === 1 &&
    typeof pending.id === "string" &&
    typeof pending.sourceDocumentId === "string" &&
    typeof pending.sourceDocumentPath === "string" &&
    typeof pending.destinationDocumentPath === "string" &&
    typeof pending.retainSource === "boolean" &&
    typeof pending.switchActive === "boolean";
}

function isPendingGrantRevocation(value: unknown): value is PendingGrantRevocation {
  if (value === null || typeof value !== "object") return false;
  const pending = value as Record<string, unknown>;
  return pending.version === 1 &&
    typeof pending.documentId === "string" &&
    typeof pending.grantId === "string";
}

function sameCanonicalPath(left: string, right: string): boolean {
  const resolvedLeft = path.resolve(left);
  const resolvedRight = path.resolve(right);
  return process.platform === "win32"
    ? resolvedLeft.toLocaleLowerCase() === resolvedRight.toLocaleLowerCase()
    : resolvedLeft === resolvedRight;
}

async function closeCandidate(application: EtherApplication): Promise<void> {
  try {
    await application.closeDocument();
  } catch (error) {
    if ((error as { code?: unknown } | null)?.code !== "DOCUMENT_NOT_OPEN") throw error;
  }
}

export const applicationCommandMutationPolicy: Record<ApplicationCommand["name"], boolean> = {
  "document.new": false,
  "document.open": false,
  "document.save": false,
  "document.saveAs": false,
  "document.saveCopy": false,
  "document.close": false,
  "document.compact": false,
  "document.recover": false,
  "graph.applyTransaction": true,
  "graph.undo": true,
  "graph.redo": true,
  "graph.validate": false,
  "graph.layout": true,
  "reference.link": true,
  "reference.embed": true,
  "reference.relink": true,
  "reference.remove": true,
  "reference.assignToSet": true,
  "output.edit": true,
  "editWorkspace.commit": true,
  "output.pin": true,
  "output.restore": true,
  "recipe.preview": false,
  "recipe.instantiate": true,
  "run.preview": false,
  "run.start": false,
  "run.cancel": false,
  "run.retry": false,
  "run.resume": false,
  "review.approve": true,
  "review.reject": true,
  "review.rate": true,
  "review.tag": true,
  "review.route": true,
  "review.completeCompare": true,
  "collection.create": true,
  "collection.update": true,
  "collection.delete": true,
  "collection.addMembers": true,
  "collection.removeMembers": true,
  "collection.setPrimary": true,
  "artifact.export": false,
  "artifact.dragExport": false,
  "artifact.deleteDerivative": true,
  "export.retry": false,
  "export.cancel": false,
  "provider.probe": false,
  "provider.refresh": false,
  "provider.configure": false,
  "provider.disable": false,
  "recipe.install": false,
  "recipe.remove": false,
  "job.cancel": false,
  "job.retry": false,
  "job.resume": false,
  "recovery.inspect": false,
  "recovery.dismiss": false,
  "permission.grantEdit": false,
  "permission.grantRun": false,
  "permission.grantPath": false,
  "permission.revoke": false,
  "liveOutput.enable": true,
  "liveOutput.disable": true,
  "liveOutput.rebuild": false,
  "liveOutput.reconcile": false,
  "liveOutput.removeMirrorFiles": false
};

export function applicationCommandAvailableToRenderer(name: ApplicationCommand["name"]): boolean {
  return !name.startsWith("document.");
}

function boundaryError(error: EtherError): Error {
  return Object.assign(new Error(error.message), error);
}

function redactApplicationQueryResponse(response: ApplicationQueryResponse): ApplicationQueryResponse {
  if (response.name === "reference.list") {
    return ApplicationQueryResponseSchema.parse({
      ...response,
      payload: {
        references: response.payload.references.map((reference) => ({
          ...reference,
          originalPath: null
        }))
      }
    });
  }
  if (response.name === "reference.detail") {
    return ApplicationQueryResponseSchema.parse({
      ...response,
      payload: { reference: { ...response.payload.reference, originalPath: null } }
    });
  }
  return response;
}

export interface WindowsLocationCapabilityPort {
  inspect(filePath: string, signal: AbortSignal): Promise<{
    cloudPlaceholder: boolean;
    cloudRoots: readonly string[];
    finalPath: string;
    volumeType: "fixed" | "network" | "removable" | "unknown";
  }>;
}

export function createWindowsLocationCapability(
  port: WindowsLocationCapabilityPort = productionWindowsLocationPort(),
  options: { cacheTtlMs?: number; timeoutMs?: number } = {}
): WritableLocationCapabilityAdapter {
  const cache = new Map<string, { expiresAt: number; kind: WritableLocationKind }>();
  return {
    async classify(filePath, callerSignal): Promise<WritableLocationKind> {
      if (callerSignal?.aborted === true) return "unknown";
      const controller = new AbortController();
      const abort = () => controller.abort();
      callerSignal?.addEventListener("abort", abort, { once: true });
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const timeout = new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(codedError("LOCATION_PROBE_TIMEOUT", "The location capability probe timed out."));
          }, options.timeoutMs ?? 2_000);
        });
        const inspection = await Promise.race([port.inspect(filePath, controller.signal), timeout]);
        const normalized = normalizeWindowsPath(inspection.finalPath);
        const factKey = JSON.stringify({
          cloudPlaceholder: inspection.cloudPlaceholder,
          cloudRoots: inspection.cloudRoots.map(normalizeWindowsPath).sort(),
          finalPath: normalized,
          volumeType: inspection.volumeType
        });
        const cached = cache.get(factKey);
        if (cached !== undefined && cached.expiresAt > Date.now()) return cached.kind;
        const kind: WritableLocationKind = normalized.startsWith("\\\\")
          ? "mapped-network"
          : (
          inspection.cloudPlaceholder ||
          inspection.cloudRoots.some((root) => insideWindowsPath(normalized, normalizeWindowsPath(root)))
        ) ? "cloud-placeholder"
          : inspection.volumeType === "fixed" ? "local-fixed"
            : inspection.volumeType === "network" ? "mapped-network"
              : inspection.volumeType === "removable" ? "removable"
                : "unknown";
        cache.set(factKey, { expiresAt: Date.now() + (options.cacheTtlMs ?? 5_000), kind });
        return kind;
      } catch {
        return "unknown";
      } finally {
        if (timer !== undefined) clearTimeout(timer);
        callerSignal?.removeEventListener("abort", abort);
      }
    }
  };
}

function productionWindowsLocationPort(): WindowsLocationCapabilityPort {
  return { inspect: async (filePath, signal) => {
    const script = [
      "Add-Type -Language CSharp -TypeDefinition @'",
      "using System;",
      "using System.ComponentModel;",
      "using System.Runtime.InteropServices;",
      "using System.Text;",
      "public static class EtherNativePath {",
      "  [DllImport(\"kernel32.dll\", CharSet = CharSet.Unicode, SetLastError = true)]",
      "  private static extern IntPtr CreateFileW(string name, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);",
      "  [DllImport(\"kernel32.dll\", CharSet = CharSet.Unicode, SetLastError = true)]",
      "  private static extern uint GetFinalPathNameByHandleW(IntPtr handle, StringBuilder path, uint length, uint flags);",
      "  [DllImport(\"kernel32.dll\", SetLastError = true)]",
      "  private static extern bool CloseHandle(IntPtr handle);",
      "  public static string Resolve(string path) {",
      "    IntPtr handle = CreateFileW(path, 0, 7, IntPtr.Zero, 3, 0x02000000, IntPtr.Zero);",
      "    if (handle == new IntPtr(-1)) throw new Win32Exception(Marshal.GetLastWin32Error());",
      "    try {",
      "      var result = new StringBuilder(32768);",
      "      uint length = GetFinalPathNameByHandleW(handle, result, (uint)result.Capacity, 0);",
      "      if (length == 0 || length >= result.Capacity) throw new Win32Exception(Marshal.GetLastWin32Error());",
      "      return result.ToString();",
      "    } finally { CloseHandle(handle); }",
      "  }",
      "}",
      "'@",
      "$requested = [System.IO.Path]::GetFullPath([Console]::In.ReadToEnd())",
      "$existing = $requested",
      "while (-not (Test-Path -LiteralPath $existing)) {",
      "  $parent = [System.IO.Path]::GetDirectoryName($existing)",
      "  if ([string]::IsNullOrEmpty($parent) -or $parent -eq $existing) { throw 'No existing path ancestor.' }",
      "  $existing = $parent",
      "}",
      "$item = Get-Item -LiteralPath $existing -Force -ErrorAction Stop",
      "$native = [EtherNativePath]::Resolve($existing)",
      "$resolved = if ($native.StartsWith('\\\\?\\UNC\\')) { '\\\\' + $native.Substring(8) } elseif ($native.StartsWith('\\\\?\\')) { $native.Substring(4) } else { $native }",
      "$suffix = [System.IO.Path]::GetRelativePath($existing, $requested)",
      "$finalPath = if ($suffix -eq '.') { $resolved } else { [System.IO.Path]::GetFullPath((Join-Path $resolved $suffix)) }",
      "$root = [System.IO.Path]::GetPathRoot($finalPath)",
      "$driveType = ([System.IO.DriveInfo]::new($root)).DriveType.ToString().ToLowerInvariant()",
      "$attributes = [int64]$item.Attributes",
      "$cloudRoots = @($env:OneDrive, $env:OneDriveCommercial, $env:OneDriveConsumer, $env:Dropbox) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }",
      "[pscustomobject]@{ finalPath = $finalPath; driveType = $driveType; attributes = $attributes; cloudRoots = $cloudRoots } | ConvertTo-Json -Compress"
    ].join("\n");
    const raw = await runBoundedLocationProbe(script, filePath, signal);
    const value = JSON.parse(raw) as {
      attributes?: unknown;
      cloudRoots?: unknown;
      driveType?: unknown;
      finalPath?: unknown;
    };
    const driveType = String(value.driveType ?? "unknown");
    const attributes = Number(value.attributes ?? 0);
    return {
      cloudPlaceholder: (attributes & (4096 | 262144 | 4194304)) !== 0,
      cloudRoots: Array.isArray(value.cloudRoots)
        ? value.cloudRoots.filter((root): root is string => typeof root === "string")
        : typeof value.cloudRoots === "string" ? [value.cloudRoots] : [],
      finalPath: typeof value.finalPath === "string" ? value.finalPath : filePath,
      volumeType: driveType === "fixed" || driveType === "network" || driveType === "removable"
        ? driveType
        : "unknown"
    };
  } };
}

export function runBoundedLocationProbe(script: string, filePath: string, signal: AbortSignal): Promise<string> {
  if (signal.aborted) {
    return Promise.reject(Object.assign(new Error("Location probe was cancelled."), { code: "ABORT_ERR" }));
  }
  return new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    });
    const maximumOutputBytes = 32 * 1024;
    let output = "";
    let outputBytes = 0;
    let settled = false;
    let terminating = false;
    const finish = (operation: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", abort);
      operation();
    };
    const stop = (error: Error) => {
      if (settled || terminating) return;
      terminating = true;
      signal.removeEventListener("abort", abort);
      void terminateProbeProcessTree(child).then(
        () => finish(() => reject(error)),
        (terminationError) => finish(() => reject(terminationError))
      );
    };
    const abort = () => stop(Object.assign(new Error("Location probe was cancelled."), { code: "ABORT_ERR" }));
    signal.addEventListener("abort", abort, { once: true });
    child.once("error", (error) => finish(() => reject(error)));
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      output += chunk;
      outputBytes += Buffer.byteLength(chunk, "utf8");
      if (outputBytes > maximumOutputBytes) {
        stop(codedError("LOCATION_PROBE_OUTPUT_LIMIT", "Location probe output exceeded its limit."));
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      outputBytes += chunk.byteLength;
      if (outputBytes > maximumOutputBytes) {
        stop(codedError("LOCATION_PROBE_OUTPUT_LIMIT", "Location probe output exceeded its limit."));
      }
    });
    child.once("close", (code) => {
      if (terminating) return;
      finish(() => {
      if (code === 0) resolve(output);
      else reject(codedError("LOCATION_PROBE_FAILED", "Windows location capability probe failed."));
      });
    });
    child.stdin.end(filePath, "utf8");
  });
}

async function terminateProbeProcessTree(
  child: ReturnType<typeof spawn>
): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const closed = new Promise<void>((resolve) => child.once("close", () => resolve()));
  if (process.platform === "win32" && child.pid !== undefined) {
    await new Promise<void>((resolve) => {
      const killer = spawn("taskkill.exe", ["/pid", String(child.pid), "/t", "/f"], {
        stdio: "ignore",
        windowsHide: true
      });
      killer.once("error", () => {
        child.kill();
        resolve();
      });
      killer.once("close", () => resolve());
    });
  } else {
    child.kill("SIGKILL");
  }
  await closed;
}

function normalizeWindowsPath(filePath: string): string {
  let normalized = filePath.replaceAll("/", "\\");
  if (normalized.toLocaleLowerCase().startsWith("\\\\?\\unc\\")) normalized = `\\\\${normalized.slice(8)}`;
  else if (normalized.startsWith("\\\\?\\")) normalized = normalized.slice(4);
  return normalized.replace(/\\+$/u, "").toLocaleLowerCase();
}

function insideWindowsPath(candidate: string, root: string): boolean {
  if (root === "") return false;
  const relative = path.win32.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.win32.isAbsolute(relative));
}

function documentCommandCapabilities(mode: DocumentDescriptor["mode"]): DocumentDescriptor["commands"] {
  const writable = mode === "writable";
  return {
    save: writable,
    saveAs: writable,
    saveCopy: true,
    compact: writable,
    makePortable: writable
  };
}

function identifyReferences(
  ids: readonly string[],
  references: readonly Pick<LinkedReference, "id" | "displayName">[]
): PortableResult["missingReferences"] {
  const byId = new Map(references.map((reference) => [reference.id, reference.displayName]));
  return ids.map((id) => {
    const displayName = byId.get(id);
    if (displayName === undefined) {
      throw codedError("REFERENCE_NOT_FOUND", `Portable preflight returned unknown reference ${id}.`);
    }
    return { id, displayName };
  });
}

export async function* searchReferenceFiles(
  root: string,
  options: {
    signal?: AbortSignal;
    extensions?: readonly string[];
    maxDepth?: number;
    maxDirectories?: number;
    maxEntries?: number;
  } = {}
): AsyncGenerator<string, void, void> {
  const maxDepth = options.maxDepth ?? 24;
  const maxDirectories = options.maxDirectories ?? 2_000;
  const maxEntries = options.maxEntries ?? 20_000;
  const extensions = new Set((options.extensions ?? []).map((extension) => extension.toLocaleLowerCase()));
  const pending = [{ directory: path.resolve(root), depth: 0 }];
  let visitedDirectories = 0;
  let visitedEntries = 0;
  while (pending.length > 0 && visitedDirectories < maxDirectories && visitedEntries < maxEntries) {
    if (searchCancelled(options.signal)) return;
    const next = pending.shift()!;
    let directory;
    try {
      directory = await opendir(next.directory);
    } catch (error) {
      if (isSkippableFileSystemError(error)) continue;
      throw error;
    }
    visitedDirectories += 1;
    try {
      for await (const entry of directory) {
        if (searchCancelled(options.signal)) return;
        visitedEntries += 1;
        if (visitedEntries > maxEntries) return;
        const candidate = path.join(next.directory, entry.name);
        if (entry.isDirectory()) {
          if (next.depth < maxDepth) pending.push({ directory: candidate, depth: next.depth + 1 });
          continue;
        }
        if (!entry.isFile()) continue;
        if (extensions.size > 0 && !extensions.has(path.extname(entry.name).toLocaleLowerCase())) continue;
        try {
          if (!(await lstat(candidate)).isFile()) continue;
        } catch (error) {
          if (isSkippableFileSystemError(error)) continue;
          throw error;
        }
        yield candidate;
      }
    } catch (error) {
      if (!isSkippableFileSystemError(error)) throw error;
    }
  }
}

function referenceExtensions(reference: Pick<LinkedReference, "displayName" | "mediaType">): string[] {
  if (reference.mediaType === "image/png") return [".png"];
  if (reference.mediaType === "image/jpeg") return [".jpg", ".jpeg"];
  if (reference.mediaType === "image/webp") return [".webp"];
  if (reference.mediaType === "image/gif") return [".gif"];
  const extension = path.extname(reference.displayName).toLocaleLowerCase();
  return extension === "" ? [] : [extension];
}

async function isSkippableReferenceCandidateError(
  error: unknown,
  candidatePath: string
): Promise<boolean> {
  const code = (error as { code?: unknown } | null)?.code;
  if ([
    "EACCES",
    "ENOENT",
    "EPERM",
    "MIME_MISMATCH",
    "REFERENCE_CHANGED",
    "REFERENCE_IDENTITY_MISMATCH",
    "REFERENCE_MISSING"
  ].includes(String(code))) return true;
  if (code !== "REFERENCE_GRANT_DENIED") return false;
  try {
    await lstat(candidatePath);
    return false;
  } catch (fileError) {
    return ["EACCES", "ENOENT", "EPERM"].includes(
      String((fileError as { code?: unknown } | null)?.code)
    );
  }
}

function grantRevocationAttentionError(): Error & { code: string } {
  return codedError(
    "GRANT_REVOCATION_PENDING",
    "The document change was saved, but Ether is still finalizing linked-file authorization cleanup."
  );
}

function isSkippableFileSystemError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return ["EACCES", "ENOENT", "ENOTDIR", "EPERM"].includes(String(code));
}

function searchCancelled(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

export function referenceCapabilities(
  reference: LinkedReference,
  state: { writable: boolean; sourceAvailable: boolean; hasMissingReferences: boolean }
): ReferenceAction[] {
  if (!state.writable) return [];
  const actions: ReferenceAction[] = [];
  if (reference.state === "missing") {
    actions.push("locate", "search-folder");
    if (state.hasMissingReferences) actions.push("relink-all");
    if (reference.previewContentKey !== null) actions.push("use-embedded-preview");
  }
  if (reference.state !== "embedded" && state.sourceAvailable) actions.push("embed-available-copy");
  actions.push("remove");
  return actions;
}

async function referenceSourceAvailable(reference: LinkedReference): Promise<boolean> {
  if (reference.originalPath === null) return false;
  try {
    const source = await lstat(reference.originalPath);
    return source.isFile() && source.size === reference.fingerprint.byteLength;
  } catch {
    return false;
  }
}
