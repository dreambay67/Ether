import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  closeSync,
  existsSync,
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
import type { EtherGraph, GraphTransaction, LinkedReference } from "@ether/schema";

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

export class DesktopPathGrantAuthority implements ReferenceGrantAuthority {
  private readonly grants = new Map<string, {
    documentId: string;
    documentPath: string;
    grantId: string;
    operation: ReferenceGrantPathRequest["operation"];
    path: string;
    fingerprint?: string;
  }>();
  private readonly activeDocuments = new Map<string, string>();

  constructor(private readonly options: { storagePath?: string } = {}) {
    this.load();
  }

  activateDocument(documentId: string, documentPath: string): void {
    this.activeDocuments.set(documentId, canonicalGrantPath(documentPath));
  }

  deactivateDocument(documentId: string): void {
    this.activeDocuments.delete(documentId);
  }

  grant(documentId: string, operation: ReferenceGrantPathRequest["operation"], filePath: string): string {
    const documentPath = this.activeDocuments.get(documentId) ?? this.memoryDocumentPath(documentId);
    const grantId = randomUUID();
    this.grants.set(grantKey(grantId, documentId), {
      documentId,
      documentPath,
      grantId,
      operation,
      path: canonicalGrantPath(filePath)
    });
    this.persist();
    return grantId;
  }

  authorizePath(request: ReferenceGrantPathRequest): boolean {
    const grant = this.grants.get(grantKey(request.grantId, request.documentId));
    return grant !== undefined &&
      grant.documentPath === this.activeDocuments.get(request.documentId) &&
      grant.operation === request.operation &&
      grant.path === tryCanonicalGrantPath(request.path);
  }

  validateFingerprint(request: ReferenceGrantFingerprintRequest): boolean {
    const grant = this.grants.get(grantKey(request.grantId, request.documentId));
    if (
      grant === undefined ||
      grant.documentPath !== this.activeDocuments.get(request.documentId) ||
      grant.operation !== request.operation ||
      grant.path !== tryCanonicalGrantPath(request.path)
    ) return false;
    const fingerprint = `${request.fingerprint.byteLength}:${request.fingerprint.sampleSha256}`;
    if (grant.fingerprint !== undefined && grant.fingerprint !== fingerprint) return false;
    grant.fingerprint = fingerprint;
    this.persist();
    return true;
  }

  allowResolve(grantId: string, documentId: string): void {
    const grant = this.grants.get(grantKey(grantId, documentId));
    if (grant !== undefined) {
      grant.operation = "resolve";
      this.persist();
    }
  }

  revoke(grantId: string, documentId: string): void {
    if (this.grants.delete(grantKey(grantId, documentId))) this.persist();
  }

  revokeDocument(documentId: string): void {
    let changed = false;
    for (const [key, grant] of this.grants) {
      if (grant.documentId === documentId) changed = this.grants.delete(key) || changed;
    }
    this.activeDocuments.delete(documentId);
    if (changed) this.persist();
  }

  rebindDocument(input: {
    sourceDocumentId: string;
    sourceDocumentPath: string;
    destinationDocumentId: string;
    destinationDocumentPath: string;
    retainSource: boolean;
  }): void {
    const sourcePath = canonicalGrantPath(input.sourceDocumentPath);
    const destinationPath = canonicalGrantPath(input.destinationDocumentPath);
    if (this.activeDocuments.get(input.sourceDocumentId) !== sourcePath) {
      throw codedError("DOCUMENT_SCOPE_REJECTED", "Reference grants are not active for the source document identity.");
    }
    const bindings = [...this.grants.values()].filter((grant) =>
      grant.documentId === input.sourceDocumentId && grant.documentPath === sourcePath
    );
    for (const binding of bindings) {
      this.grants.set(grantKey(binding.grantId, input.destinationDocumentId), {
        ...binding,
        documentId: input.destinationDocumentId,
        documentPath: destinationPath
      });
      if (!input.retainSource) {
        this.grants.delete(grantKey(binding.grantId, input.sourceDocumentId));
      }
    }
    if (!input.retainSource) this.activeDocuments.delete(input.sourceDocumentId);
    this.activeDocuments.set(input.destinationDocumentId, destinationPath);
    if (bindings.length > 0) this.persist();
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

  private persist(): void {
    const storagePath = this.options.storagePath;
    if (storagePath === undefined) return;
    mkdirSync(path.dirname(storagePath), { recursive: true });
    const temporaryPath = `${storagePath}.${randomUUID()}.tmp`;
    let descriptor: number | undefined;
    try {
      descriptor = openSync(temporaryPath, "wx", 0o600);
      writeFileSync(descriptor, `${JSON.stringify([...this.grants.values()], null, 2)}\n`, "utf8");
      fsyncSync(descriptor);
      closeSync(descriptor);
      descriptor = undefined;
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
  locationCapability?: WritableLocationCapabilityAdapter;
  documentEnvironment?: Omit<
    DocumentStoreEnvironment,
    "leaseRoot" | "recoveryRoot" | "referenceGrantAuthority" | "locationCapability"
  >;
  simulationMode?: boolean;
  autosaveOperation?: (application: EtherApplication) => Promise<void>;
}

export class DesktopApplicationService {
  private application: EtherApplication | null = null;
  private current: DocumentDescriptor | null = null;
  private currentPath: string | null = null;
  private untitled = false;
  private revision = 0;
  private readonly listeners = new Set<(event: DesktopDocumentEvent) => void>();
  private autosaveCoordinator: AutosaveCoordinator | null = null;
  private readonly pathGrants: DesktopPathGrantAuthority;
  private refreshTail: Promise<void> = Promise.resolve();
  private lifecycleTail: Promise<void> = Promise.resolve();
  private referenceSearchController: AbortController | null = null;

  constructor(private readonly options: DesktopApplicationServiceOptions) {
    this.pathGrants = new DesktopPathGrantAuthority({
      storagePath: path.join(options.appDataRoot, "reference-grants.json")
    });
  }

  subscribe(listener: (event: DesktopDocumentEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async bootstrap(): Promise<DocumentDescriptor> {
    return this.enqueueLifecycle(async () => this.current ?? this.newDocumentNow());
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
      const opened = await application.openDocument({ path: canonicalPath, access: "prefer-write" });
      await application.queryDocumentHeader();
      await this.closeActiveDocument();
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
    const saved = await this.requireApplication().saveAsDocument({ path: destination });
    const destinationPath = await realpath(destination);
    this.pathGrants.rebindDocument({
      sourceDocumentId: documentId,
      sourceDocumentPath: sourcePath,
      destinationDocumentId: saved.documentId,
      destinationDocumentPath: destinationPath,
      retainSource: false
    });
    this.currentPath = destinationPath;
    this.untitled = false;
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
    const copied = await this.requireApplication().saveCopyDocument({ path: destination });
    this.pathGrants.rebindDocument({
      sourceDocumentId: documentId,
      sourceDocumentPath: sourcePath,
      destinationDocumentId: copied.documentId,
      destinationDocumentPath: await realpath(destination),
      retainSource: true
    });
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
    await this.refresh("references", "saving");
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
    return completed;
  }

  async graphSnapshot(documentId: string) {
    this.assertScope(documentId);
    const snapshot = this.requireSnapshot();
    return { graph: await this.requireApplication().queryGraph(snapshot.graphId), revision: snapshot.revision };
  }

  async applyGraphTransaction(documentId: string, transaction: GraphTransaction) {
    this.assertScope(documentId);
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
    this.assertScope(documentId);
    const application = this.requireApplication();
    const reference = (await this.listReferences(documentId)).find((candidate) => candidate.id === referenceId);
    if (reference === undefined) throw codedError("REFERENCE_NOT_FOUND", `Unknown reference ${referenceId}.`);
    if (!reference.actions.includes(action as ReferenceAction)) {
      throw codedError("REFERENCE_ACTION_UNAVAILABLE", "That recovery action is not currently available.");
    }
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
              const grantId = this.pathGrants.grant(documentId, "relink", candidate);
              try {
                await application.relinkDocumentReference({
                  referenceId: target.id,
                  sourcePath: candidate,
                  pathGrantId: grantId
                });
                this.pathGrants.allowResolve(grantId, documentId);
                break;
              } catch (error) {
                this.pathGrants.revoke(grantId, documentId);
                if (!isSkippableReferenceCandidateError(error)) throw error;
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
      await application.embedAvailableReference(referenceId);
    } else if (action === "remove") {
      await application.removeDocumentReference(referenceId);
    } else {
      throw codedError("INVALID_REFERENCE_ACTION", `Unsupported reference action: ${action}`);
    }
    await this.refresh("references", "saving");
    this.autosaveCoordinator?.markDirty();
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

  async close(): Promise<void> {
    return this.enqueueLifecycle(() => this.closeActiveDocument());
  }

  drainLifecycle(): Promise<void> {
    return this.lifecycleTail;
  }

  private async closeActiveDocument(): Promise<void> {
    const closingDocumentId = this.current?.documentId;
    this.referenceSearchController?.abort();
    this.referenceSearchController = null;
    await this.autosaveCoordinator?.flushAndDispose();
    this.autosaveCoordinator = null;
    await this.refreshTail;
    if (this.application !== null) await this.application.closeDocument();
    if (closingDocumentId !== undefined) this.pathGrants.deactivateDocument(closingDocumentId);
    this.application = null;
    this.current = null;
    this.currentPath = null;
    this.untitled = false;
  }

  private createApplication(): EtherApplication {
    const application = new EtherApplication({
      appDataRoot: this.options.appDataRoot,
      appVersion: this.options.appVersion,
      provider: this.options.provider,
      documentEnvironment: {
        ...this.options.documentEnvironment,
        ...(this.options.locationCapability === undefined
          ? {}
          : { locationCapability: this.options.locationCapability }),
        referenceGrantAuthority: this.pathGrants
      }
    });
    application.events.subscribe(() => {
      if (this.application === application && this.current !== null) void this.refresh("state");
    });
    return application;
  }

  private activateApplication(
    application: EtherApplication,
    documentId: string,
    filePath: string,
    untitled: boolean
  ): void {
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
  operation: ReferenceGrantPathRequest["operation"];
  path: string;
  fingerprint?: string;
} {
  if (value === null || typeof value !== "object") return false;
  const binding = value as Record<string, unknown>;
  return typeof binding.documentId === "string" &&
    typeof binding.documentPath === "string" &&
    typeof binding.grantId === "string" &&
    ["link", "relink", "resolve"].includes(String(binding.operation)) &&
    typeof binding.path === "string" &&
    (binding.fingerprint === undefined || typeof binding.fingerprint === "string");
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

export interface WindowsLocationCapabilityPort {
  resolveFinalPath(filePath: string): string;
  volumeType(filePath: string): "fixed" | "network" | "removable" | "unknown";
  cloudRoots(): readonly string[];
  isCloudPlaceholder(filePath: string): boolean;
}

export function createWindowsLocationCapability(
  port: WindowsLocationCapabilityPort = productionWindowsLocationPort()
): WritableLocationCapabilityAdapter {
  return {
    classify(filePath): WritableLocationKind {
      let finalPath: string;
      try {
        finalPath = port.resolveFinalPath(filePath);
      } catch {
        return "unknown";
      }
      const normalized = normalizeWindowsPath(finalPath);
      if (normalized.startsWith("\\\\")) return "mapped-network";
      try {
        if (
          port.isCloudPlaceholder(finalPath) ||
          port.cloudRoots().some((root) => insideWindowsPath(normalized, normalizeWindowsPath(root)))
        ) return "cloud-placeholder";
        const volume = port.volumeType(finalPath);
        if (volume === "fixed") return "local-fixed";
        if (volume === "network") return "mapped-network";
        if (volume === "removable") return "removable";
      } catch {
        return "unknown";
      }
      return "unknown";
    }
  };
}

function productionWindowsLocationPort(): WindowsLocationCapabilityPort {
  const cache = new Map<string, { cloudPlaceholder: boolean; volumeType: "fixed" | "network" | "removable" | "unknown" }>();
  const inspect = (filePath: string) => {
    const key = normalizeWindowsPath(filePath);
    const cached = cache.get(key);
    if (cached !== undefined) return cached;
    const script = [
      "$path = [Console]::In.ReadToEnd()",
      "while (-not (Test-Path -LiteralPath $path)) {",
      "  $parent = [System.IO.Path]::GetDirectoryName($path)",
      "  if ([string]::IsNullOrEmpty($parent) -or $parent -eq $path) { throw 'No existing path ancestor.' }",
      "  $path = $parent",
      "}",
      "$item = Get-Item -LiteralPath $path -Force -ErrorAction Stop",
      "$root = [System.IO.Path]::GetPathRoot($item.FullName)",
      "$driveType = ([System.IO.DriveInfo]::new($root)).DriveType.ToString().ToLowerInvariant()",
      "$attributes = [int64]$item.Attributes",
      "[pscustomobject]@{ driveType = $driveType; attributes = $attributes } | ConvertTo-Json -Compress"
    ].join("\n");
    const raw = execFileSync("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      script
    ], { encoding: "utf8", input: filePath, windowsHide: true });
    const value = JSON.parse(raw) as { attributes?: unknown; driveType?: unknown };
    const driveType = String(value.driveType ?? "unknown");
    const attributes = Number(value.attributes ?? 0);
    const result = {
      cloudPlaceholder: (attributes & (4096 | 262144 | 4194304)) !== 0,
      volumeType: driveType === "fixed" || driveType === "network" || driveType === "removable"
        ? driveType
        : "unknown"
    } as const;
    cache.set(key, result);
    return result;
  };
  return {
    resolveFinalPath: resolveFinalWindowsPath,
    volumeType: (filePath) => inspect(filePath).volumeType,
    cloudRoots: () => [
      process.env.OneDrive,
      process.env.OneDriveCommercial,
      process.env.OneDriveConsumer,
      process.env.Dropbox
    ].filter((value): value is string => typeof value === "string" && value.length > 0),
    isCloudPlaceholder: (filePath) => inspect(filePath).cloudPlaceholder
  };
}

function resolveFinalWindowsPath(filePath: string): string {
  const absolutePath = path.resolve(filePath);
  let existingPath = absolutePath;
  while (!existsSync(existingPath)) {
    const parent = path.dirname(existingPath);
    if (parent === existingPath) throw codedError("INVALID_DOCUMENT_PATH", "No existing path ancestor is available.");
    existingPath = parent;
  }
  const finalExistingPath = realpathSync.native(existingPath);
  const suffix = path.relative(existingPath, absolutePath);
  return suffix === "" ? finalExistingPath : path.join(finalExistingPath, suffix);
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

function isSkippableReferenceCandidateError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return [
    "EACCES",
    "ENOENT",
    "EPERM",
    "MIME_MISMATCH",
    "REFERENCE_CHANGED",
    "REFERENCE_IDENTITY_MISMATCH",
    "REFERENCE_MISSING"
  ].includes(String(code));
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
