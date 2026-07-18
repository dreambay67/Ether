import { randomUUID } from "node:crypto";
import { lstat, mkdir, readdir, realpath } from "node:fs/promises";
import path from "node:path";

import { EtherApplication } from "@ether/application";
import type {
  ReferenceGrantAuthority,
  ReferenceGrantFingerprintRequest,
  ReferenceGrantPathRequest,
  WritableLocationCapabilityAdapter
} from "@ether/document";
import type { GenerationProvider } from "@ether/providers";
import type { EtherGraph, GraphTransaction } from "@ether/schema";

import type {
  DesktopDocumentEvent,
  DocumentDescriptor
} from "../../shared/ipc/contracts.js";

export interface NativeDialogPort {
  openDocument(): Promise<string | null>;
  saveDocument(kind?: "save-as" | "save-copy"): Promise<string | null>;
  locateReference(referenceId: string): Promise<string | null>;
  searchReferenceFolder(referenceId: string): Promise<string | null>;
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
  private firstDirtyAt: number | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private maximumTimer: ReturnType<typeof setTimeout> | null = null;
  private inFlight = false;
  private queued = false;
  private saveState: SaveState = "saved";

  constructor(
    private readonly save: () => Promise<void>,
    private readonly onState: (state: { dirty: boolean; saveState: SaveState; error?: unknown }) => void = () => undefined
  ) {}

  markDirty(): void {
    this.dirty = true;
    const now = Date.now();
    if (this.firstDirtyAt === null) {
      this.firstDirtyAt = now;
      this.maximumTimer = setTimeout(() => void this.flush(), 10_000);
    }
    if (this.idleTimer !== null) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => void this.flush(), 1_500);
    this.onState(this.state());
  }

  async flush(): Promise<void> {
    if (!this.dirty) return;
    if (this.inFlight) {
      this.queued = true;
      return;
    }
    this.clearTimers();
    this.inFlight = true;
    this.saveState = "saving";
    this.onState(this.state());
    try {
      await this.save();
      this.dirty = false;
      this.firstDirtyAt = null;
      this.saveState = "saved";
      this.onState(this.state());
    } catch (error) {
      this.dirty = true;
      this.saveState = "needs-attention";
      this.onState({ ...this.state(), error });
    } finally {
      this.inFlight = false;
      if (this.queued) {
        this.queued = false;
        this.dirty = true;
        this.firstDirtyAt = Date.now();
        void this.flush();
      }
    }
  }

  state(): { dirty: boolean; saveState: SaveState } {
    return { dirty: this.dirty, saveState: this.saveState };
  }

  dispose(): void {
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

class DesktopPathGrantAuthority implements ReferenceGrantAuthority {
  private readonly grants = new Map<string, { path: string; fingerprint?: string }>();

  grant(filePath: string): string {
    const grantId = randomUUID();
    this.grants.set(grantId, { path: path.resolve(filePath) });
    return grantId;
  }

  authorizePath(request: ReferenceGrantPathRequest): boolean {
    return this.grants.get(request.grantId)?.path === path.resolve(request.path);
  }

  validateFingerprint(request: ReferenceGrantFingerprintRequest): boolean {
    const grant = this.grants.get(request.grantId);
    if (grant === undefined || grant.path !== path.resolve(request.path)) return false;
    const fingerprint = `${request.fingerprint.byteLength}:${request.fingerprint.sampleSha256}`;
    if (grant.fingerprint !== undefined && grant.fingerprint !== fingerprint) return false;
    grant.fingerprint = fingerprint;
    return true;
  }

  revoke(grantId: string): void {
    this.grants.delete(grantId);
  }
}

export class DesktopApplicationService {
  private application: EtherApplication | null = null;
  private current: DocumentDescriptor | null = null;
  private currentPath: string | null = null;
  private untitled = false;
  private revision = 0;
  private readonly listeners = new Set<(event: DesktopDocumentEvent) => void>();
  private autosaveCoordinator: AutosaveCoordinator | null = null;
  private readonly pathGrants = new DesktopPathGrantAuthority();

  constructor(private readonly options: {
    appDataRoot: string;
    appVersion: string;
    dialogs: NativeDialogPort;
    provider: GenerationProvider;
    locationCapability?: WritableLocationCapabilityAdapter;
  }) {}

  subscribe(listener: (event: DesktopDocumentEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async bootstrap(): Promise<DocumentDescriptor> {
    if (this.current !== null) return this.current;
    return this.newDocument();
  }

  async newDocument(): Promise<DocumentDescriptor> {
    await this.close();
    const directory = path.join(this.options.appDataRoot, "untitled");
    await mkdir(directory, { recursive: true });
    const filePath = path.join(directory, `${randomUUID()}.ether`);
    const application = this.createApplication();
    await application.createDocument({ path: filePath, title: "Untitled", initialGraph: blankGraph() });
    this.application = application;
    this.currentPath = filePath;
    this.untitled = true;
    return this.refresh("snapshot");
  }

  async open(): Promise<DocumentDescriptor> {
    const selected = await this.options.dialogs.openDocument();
    if (selected === null) return this.requireSnapshot();
    return this.openPath(selected);
  }

  async openPath(filePath: string): Promise<DocumentDescriptor> {
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
    await this.close();
    const application = this.createApplication();
    await application.openDocument({ path: canonicalPath, access: "prefer-write" });
    this.application = application;
    this.currentPath = canonicalPath;
    this.untitled = false;
    return this.refresh("snapshot");
  }

  async save(documentId: string): Promise<DocumentDescriptor> {
    this.assertScope(documentId);
    if (this.untitled) {
      const saved = await this.saveAs(documentId);
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
    this.assertScope(documentId);
    const destination = await this.options.dialogs.saveDocument("save-as");
    if (destination === null) return this.requireSnapshot();
    validateDestination(destination);
    await this.requireApplication().saveAsDocument({ path: destination });
    this.currentPath = await realpath(destination);
    this.untitled = false;
    return this.refresh("snapshot", "saved");
  }

  async saveCopy(documentId: string): Promise<DocumentDescriptor> {
    this.assertScope(documentId);
    const destination = await this.options.dialogs.saveDocument("save-copy");
    if (destination === null) return this.requireSnapshot();
    validateDestination(destination);
    await this.requireApplication().saveCopyDocument({ path: destination });
    return this.refresh("state", "saved");
  }

  async compact(documentId: string): Promise<{ beforeBytes: number; afterBytes: number }> {
    this.assertScope(documentId);
    const result = await this.requireApplication().compactDocument();
    await this.refresh("state", "saved");
    return result;
  }

  async makePortable(documentId: string): Promise<{ embeddedCount: number; missingReferenceIds: string[] }> {
    this.assertScope(documentId);
    return this.requireApplication().makeDocumentPortable();
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

  async listReferences(documentId: string) {
    this.assertScope(documentId);
    return this.requireApplication().queryReferences();
  }

  async actOnReference(documentId: string, referenceId: string, action: string) {
    this.assertScope(documentId);
    const application = this.requireApplication();
    if (action === "locate") {
      const selected = await this.options.dialogs.locateReference(referenceId);
      if (selected !== null) {
        await application.relinkDocumentReference({
          referenceId,
          sourcePath: selected,
          pathGrantId: this.pathGrants.grant(selected)
        });
      }
    } else if (action === "search-folder" || action === "relink-all") {
      const folder = await this.options.dialogs.searchReferenceFolder(referenceId);
      if (folder !== null) {
        const targets = action === "relink-all"
          ? (await application.queryReferences()).filter((reference) => reference.state === "missing")
          : (await application.queryReferences()).filter((reference) => reference.id === referenceId);
        const candidates = await listFiles(folder);
        for (const target of targets) {
          for (const candidate of candidates) {
            try {
              await application.relinkDocumentReference({
                referenceId: target.id,
                sourcePath: candidate,
                pathGrantId: this.pathGrants.grant(candidate)
              });
              break;
            } catch (error) {
              const code = (error as { code?: unknown } | null)?.code;
              if (code !== "REFERENCE_IDENTITY_MISMATCH" && code !== "MIME_MISMATCH") throw error;
            }
          }
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
    return application.queryReferences();
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

  snapshot(): DocumentDescriptor {
    return this.requireSnapshot();
  }

  activePath(): string | null {
    return this.currentPath;
  }

  async close(): Promise<void> {
    this.autosaveCoordinator?.dispose();
    this.autosaveCoordinator = null;
    if (this.application !== null) await this.application.closeDocument();
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
      documentEnvironment: this.options.locationCapability === undefined
        ? { referenceGrantAuthority: this.pathGrants }
        : {
            locationCapability: this.options.locationCapability,
            referenceGrantAuthority: this.pathGrants
          }
    });
    application.events.subscribe(() => {
      if (this.current !== null) void this.refresh("state");
    });
    this.autosaveCoordinator = new AutosaveCoordinator(
      () => application.autosaveDocument(),
      (state) => {
        if (this.current !== null) {
          void this.refresh("state", state.saveState).catch((error) => this.emitAttention(error));
        }
      }
    );
    return application;
  }

  private async refresh(
    kind: DesktopDocumentEvent["kind"],
    saveState: SaveState = "saved",
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
      readOnlyReason: mode === "read-only"
        ? (await this.readOnlyReason())
        : null,
      saveState,
      documentRevisionId: document.documentRevisionId,
      graphId,
      graphRevisionId: document.graphRevisions[graphId]!,
      revision: this.revision
    };
    const event: DesktopDocumentEvent = { kind, documentId: this.current.documentId, revision: this.revision, snapshot: this.current };
    for (const listener of this.listeners) listener(structuredClone(event));
    void header;
    return this.current;
  }

  private emitAttention(error: unknown): void {
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
  }

  private async readOnlyReason(): Promise<DocumentDescriptor["readOnlyReason"]> {
    const document = await this.requireApplication().queryDocument();
    if (document.mode !== "read-only" || this.currentPath === null) return null;
    if (this.options.locationCapability?.classify(this.currentPath) !== "local-fixed") return "location-unsupported";
    return "requested";
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

async function listFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  const pending = [path.resolve(root)];
  while (pending.length > 0) {
    const directory = pending.shift()!;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const candidate = path.join(directory, entry.name);
      if (entry.isDirectory()) pending.push(candidate);
      else if (entry.isFile()) files.push(candidate);
    }
  }
  return files;
}
