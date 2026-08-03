import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  unlink,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

import {
  DocumentStore,
  DocumentStoreError,
  ExecutionRepositoryError,
  embedReference,
  embedReferences,
  importBlob,
  inspectReplacementRecovery,
  linkReference,
  materializeLiveOutput,
  mediaSignatureMatches,
  reconcileLiveOutput,
  removeMirrorFiles,
  readBlobRange,
  relinkReference,
  resolveReference,
  streamBlobRange,
  type ArtifactLineageSnapshot,
  type DocumentStoreEnvironment,
  type LiveOutputDirectoryGrant,
  type LiveOutputFileSystem,
  type ReadOnlyReason
} from "@ether/document";
import {
  compilePlan,
  DurableScheduler,
  ExecutionConcurrencyDomains,
  resolveScope,
  type ExecutionProviderFacets,
  type ExecutionProviderResolver
} from "@ether/execution";
import type { StructuredOutputSchema } from "@ether/intelligence";
import { previewGraphTransaction } from "@ether/graph-kernel";
import type { GenerationProvider } from "@ether/providers";
import {
  ApplicationCommandSchema,
  ApplicationEventSchema,
  ApplicationQuerySchema,
  ExecutionJobSchema,
  ExecutionPlanSchema,
  referenceSetMembers,
  readArtifactThumbnailMetadata,
  type ApplicationCommand,
  type ApplicationCommandResponse,
  type ApplicationErrorMessage,
  type ApplicationEvent,
  type ApplicationQuery,
  type ApplicationQueryResponse,
  type EtherApplicationService
} from "@ether/schema";
import type {
  Artifact,
  EtherGraph,
  ExecutionAttempt,
  ExecutionJob,
  ExecutionPlan,
  ExecutionScope,
  ExecutionWorkItem,
  ExportRecord,
  GraphTransaction,
  LinkedReference,
  NodeOutputVersion,
  PayloadEnvelope,
  ProviderCapability
} from "@ether/schema";

import { applyGraphTransaction as applyTransaction } from "./commands/graphCommands.js";
import { createDocument as createStore } from "./commands/documentCommands.js";
import { ApplicationEventBus } from "./events/eventBus.js";
import type { DocumentSnapshot } from "./queries/documentQueries.js";
import { deepFreezeSnapshot } from "./snapshots.js";
import { executeApplicationCommand, executeApplicationQuery } from "./dispatch.js";
import {
  publishAtomicExportBundle,
  stableExportPublicationId
} from "./atomicExportPublisher.js";
import {
  ApplicationPermitStore,
  type ApplicationPermit,
  type ApplicationPermitInspection,
  type PathGrantPurpose,
  type PathGrantResolver,
  type ResolvedPathGrant
} from "./services.js";

export class ApplicationServiceError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ApplicationServiceError";
    this.code = code;
  }
}

export interface ApplicationDiagnosticRecord {
  causeId?: string;
  correlationId: string;
  details?: Record<string, unknown>;
  event: string;
  level: "info" | "warning" | "error";
  message: string;
}

export class EtherApplication implements EtherApplicationService {
  readonly events = new ApplicationEventBus();
  private store: DocumentStore | undefined;
  private scheduler: DurableScheduler | undefined;
  private inspectedAccess: "prefer-write" | "read-only" | "require-write" | undefined;
  private eventDrain: Promise<void> = Promise.resolve();
  private readonly permits = new ApplicationPermitStore();
  private recoveryReport: { dismissed: boolean; message: string | null; reportId: string | null; state: "attention" | "healthy" | "recovering" } = {
    dismissed: false,
    message: null,
    reportId: null,
    state: "healthy"
  };

  constructor(
    private readonly options: {
      appDataRoot: string;
      appVersion: string;
      provider: GenerationProvider;
      executionProviders?: ExecutionProviderFacets;
      providerResolver?: ExecutionProviderResolver;
      providerCapabilities?:
        | ProviderCapability[]
        | (() => Promise<readonly ProviderCapability[]>);
      /** Application-owned schemas are copied into a previewed Worker plan. */
      workerSchemaCatalog?: readonly StructuredOutputSchema[];
      pathGrantResolver?: PathGrantResolver;
      liveOutputFileSystem?: LiveOutputFileSystem;
      dispatchMode?: "automatic" | "manual";
      documentEnvironment?: Omit<DocumentStoreEnvironment, "leaseRoot" | "recoveryRoot">;
      executionCheckpoint?: (name: string) => void;
      concurrencyDomains?: ExecutionConcurrencyDomains;
      portableCheckpoint?: (stage: "prepared", referenceId: string) => void;
      portableImportCheckpoint?: (stage: string, referenceId: string) => void;
      exportCheckpoint?: (
        stage: "before-open" | "after-output",
        destination: string
      ) => void | Promise<void>;
      onDiagnostic?: (record: ApplicationDiagnosticRecord) => void;
    }
  ) {}

  /** Shared, schema-validated boundary used by Electron IPC and MCP. */
  async execute(command: ApplicationCommand): Promise<ApplicationCommandResponse | ApplicationErrorMessage> {
    try {
      const response = await executeApplicationCommand(this, ApplicationCommandSchema.parse(command));
      if (command.name !== "document.close") await this.drainEvents();
      this.emitDiagnostic({
        correlationId: command.correlationId,
        details: { commandId: command.id, commandName: command.name },
        event: "application.command.completed",
        level: "info",
        message: `Application command ${command.name} completed.`
      });
      return response;
    } catch (error) {
      this.emitDiagnostic({
        causeId: command.correlationId,
        correlationId: command.correlationId,
        details: { commandId: command.id, commandName: command.name },
        event: "application.command.failed",
        level: "error",
        message: error instanceof Error ? error.message : "Application command failed."
      });
      return this.toBoundaryError(command.id, command.correlationId, error);
    }
  }

  async query(query: ApplicationQuery): Promise<ApplicationQueryResponse | ApplicationErrorMessage> {
    try {
      return await executeApplicationQuery(this, ApplicationQuerySchema.parse(query));
    } catch (error) {
      return this.toBoundaryError(query.id, query.correlationId, error);
    }
  }

  subscribe(listener: (event: ApplicationEvent) => void): () => void {
    return this.events.subscribe(listener);
  }

  /** @internal Command handlers use repositories through this narrow service boundary. */
  boundaryStore(): DocumentStore {
    return this.requireStore();
  }

  /** @internal Provider inspection is intentionally read-only at this layer. */
  boundaryProvider(): GenerationProvider {
    return this.options.provider;
  }

  /** @internal Recipe previews combine configured profiles with provider diagnosis. */
  async boundaryConfiguredProviderCapabilities(): Promise<readonly ProviderCapability[]> {
    const configured = this.options.providerCapabilities;
    return typeof configured === "function" ? configured() : configured ?? [];
  }

  async grantEditPermit(commandId: string, expiresAt: string | null): Promise<ApplicationPermit> {
    const permit = this.permits.grantEdit(commandId, expiresAt);
    this.publishPermission(permit, "granted");
    return permit;
  }

  inspectPermits(): ApplicationPermitInspection[] {
    return deepFreezeSnapshot(this.permits.inspect());
  }

  requireEditPermit(permitId: string): void {
    try {
      this.permits.requireEdit(permitId);
    } catch (error) {
      throw mapError(error);
    }
  }

  async grantPathPermit(
    commandId: string,
    pathGrantId: string,
    purpose: PathGrantPurpose
  ): Promise<ApplicationPermit> {
    if (this.options.pathGrantResolver === undefined) {
      throw new ApplicationServiceError("EXTERNAL_CAPABILITY_UNAVAILABLE", "No desktop path-grant resolver is attached.");
    }
    const resolution = await this.options.pathGrantResolver.resolve({
      documentId: this.requireStore().documentId,
      pathGrantId,
      purpose
    });
    return this.permits.grantPath(commandId, pathGrantId, purpose, resolution);
  }

  revokePermit(permitId: string): ApplicationPermit {
    const permit = this.permits.revoke(permitId);
    if (permit.permission !== "path") this.publishPermission(permit, "revoked");
    return permit;
  }

  requirePathGrant(pathGrantId: string, purpose: PathGrantPurpose): ResolvedPathGrant {
    return this.permits.requirePath(pathGrantId, purpose);
  }

  private async revalidatePathGrant(
    pathGrantId: string,
    purpose: PathGrantPurpose
  ): Promise<ResolvedPathGrant> {
    const cached = this.requirePathGrant(pathGrantId, purpose);
    if (this.options.pathGrantResolver === undefined) {
      throw new ApplicationServiceError(
        "EXTERNAL_CAPABILITY_UNAVAILABLE",
        "No desktop path-grant resolver is attached."
      );
    }
    const current = await this.options.pathGrantResolver.resolve({
      documentId: this.requireStore().documentId,
      pathGrantId,
      purpose
    });
    if (
      current.kind !== cached.kind ||
      !samePath(current.path, cached.path)
    ) {
      throw new ApplicationServiceError(
        "PATH_GRANT_CHANGED",
        "The granted path changed after it was authorized."
      );
    }
    return { ...current, path: path.resolve(current.path) };
  }

  async inspectRecovery(): Promise<Omit<typeof this.recoveryReport, "dismissed">> {
    const store = this.requireStore();
    const result = await inspectReplacementRecovery(store.path, path.join(this.options.appDataRoot, "recovery"));
    const state = result.attention ? "attention" : result.pending ? "recovering" : "healthy";
    this.recoveryReport = {
      dismissed: false,
      message: state === "attention"
        ? "Ether found recovery data that needs attention."
        : state === "recovering" ? "Ether found a recoverable interrupted document operation." : null,
      reportId: state === "healthy" ? null : `recovery-${randomUUID()}`,
      state
    };
    return this.recoveryStatus();
  }

  recoveryStatus(): Omit<typeof this.recoveryReport, "dismissed"> {
    return this.recoveryReport.dismissed
      ? { message: null, reportId: null, state: "healthy" }
      : { message: this.recoveryReport.message, reportId: this.recoveryReport.reportId, state: this.recoveryReport.state };
  }

  dismissRecovery(reportId: string): void {
    if (this.recoveryReport.reportId !== reportId) {
      throw new ApplicationServiceError("RECOVERY_REPORT_NOT_FOUND", `Unknown recovery report ${reportId}.`);
    }
    this.recoveryReport = { ...this.recoveryReport, dismissed: true };
  }

  async linkDocumentReference(input: {
    graphId: string;
    nodeId: string;
    pathGrantId: string;
    role: import("@ether/schema").ConnectionRole;
  }) {
    const store = this.requireWritableStore();
    const resolution = this.requirePathGrant(input.pathGrantId, "reference");
    const graph = await this.queryGraph(input.graphId);
    const node = graph.nodes.find((candidate) => candidate.id === input.nodeId);
    if (node?.definitionId !== "reference.set") {
      throw new ApplicationServiceError("REFERENCE_SET_NOT_FOUND", `Unknown Reference Set node ${input.nodeId}.`);
    }
    const mediaType = resolution.mediaType ?? mediaTypeForPath(resolution.path);
    const preview = await importBlob(
      store,
      { mediaType, sourcePath: resolution.path },
      { appDataRoot: this.options.appDataRoot }
    );
    const reference = await linkReference(store, {
      displayName: resolution.displayName ?? path.basename(resolution.path),
      id: `reference-${randomUUID()}`,
      mediaType,
      pathGrantId: input.pathGrantId,
      previewContentKey: preview.contentKey,
      sourcePath: resolution.path
    });
    const member = {
      kind: "linked-reference",
      referenceId: reference.id,
      enabled: true,
      roleOverride: input.role
    } as const;
    await store.transaction(({ references }) => references.assignToReferenceSet(input.nodeId, [member]));
    this.publishReferenceChanged(reference.id, "linked");
    this.publishReferenceSetMembershipChanged(input.nodeId, [member], "assign");
    return reference;
  }

  async relinkDocumentReferenceGrant(referenceId: string, pathGrantId: string) {
    const resolution = this.requirePathGrant(pathGrantId, "reference");
    return this.relinkDocumentReference({ referenceId, sourcePath: resolution.path, pathGrantId });
  }

  async assignReferenceSet(
    nodeId: string,
    members: readonly import("@ether/schema").ReferenceSetMember[],
    replace: boolean
  ): Promise<void> {
    const assigned = await this.requireWritableStore().transaction(({ artifacts, references }) => {
      const parsed = members.map((member) => {
        const id = member.kind === "linked-reference" ? member.referenceId : member.artifactId;
        const exists = member.kind === "linked-reference" ? references.get(id) : artifacts.get(id);
        if (exists === undefined) {
          throw new ApplicationServiceError("REFERENCE_MEMBER_NOT_FOUND", `Unknown ${member.kind} ${id}.`);
        }
        return member;
      });
      return replace ? references.setReferenceSetMembers(nodeId, parsed) : references.assignToReferenceSet(nodeId, parsed);
    });
    this.publishReferenceSetMembershipChanged(nodeId, assigned, replace ? "replace" : "assign");
    const references = await this.queryReferences();
    const stateById = new Map(references.map((reference) => [reference.id, reference.state]));
    for (const member of assigned) {
      if (member.kind === "linked-reference") {
        this.publishReferenceChanged(member.referenceId, stateById.get(member.referenceId) ?? "missing");
      }
    }
  }

  async liveOutputStatus() {
    return this.requireStore().runLiveOutput(async (repository) => repository.getSettings(), "read");
  }

  async liveOutputEntries(filters: { artifactId?: string; collectionId?: string }) {
    return this.requireStore().runLiveOutput(async (repository) => repository.listEntries(filters), "read");
  }

  async liveOutputOperations(options: { entryId?: string; limit?: number }) {
    return this.requireStore().runLiveOutput(async (repository) => repository.listOperations(options), "read");
  }

  async enableLiveOutput(input: {
    collisionPolicy: "error" | "rename" | "skip";
    namingPolicy: "artifact" | "node" | "template";
    pathGrantId: string;
    transferPolicy: "copy" | "move";
  }): Promise<{ operationId: string }> {
    const grant = this.liveOutputGrant(input.pathGrantId);
    const items = await this.liveOutputItems(input.namingPolicy);
    const result = await this.requireWritableStore().runLiveOutput(async (repository) => {
      repository.enable(grant, {
        collisionPolicy: input.collisionPolicy,
        namingPolicy: { template: liveOutputTemplate(input.namingPolicy) },
        transferPolicy: input.transferPolicy
      });
      return materializeLiveOutput(repository, {
        fileSystem: this.options.liveOutputFileSystem,
        grant,
        grantValidator: () => this.permits.isActivePath(input.pathGrantId, "live-output"),
        items
      });
    });
    return { operationId: result.items[0]?.operationId ?? `live-output-enable-${randomUUID()}` };
  }

  async disableLiveOutput(): Promise<void> {
    await this.requireWritableStore().runLiveOutput(async (repository) => { repository.disable(); });
  }

  async rebuildLiveOutput(): Promise<string> {
    const settings = await this.liveOutputStatus();
    if (!settings.enabled || settings.pathGrantId === null) {
      throw new ApplicationServiceError("LIVE_OUTPUT_DISABLED", "Enable Live Output before rebuilding it.");
    }
    const grant = this.liveOutputGrant(settings.pathGrantId);
    const entries = await this.liveOutputEntries({});
    const items = await Promise.all(entries.map(async (entry) => {
      const artifact = await this.queryArtifactDescriptor(entry.artifactId);
      return {
        artifactId: artifact.id,
        byteLength: artifact.byteLength,
        collectionId: entry.collectionId,
        contentKey: artifact.contentKey,
        expectedHash: artifact.contentKey,
        relativePath: entry.relativePath,
        bytes: await this.readArtifactBytes(artifact.id)
      };
    }));
    const result = await this.requireWritableStore().runLiveOutput((repository) => materializeLiveOutput(repository, {
      fileSystem: this.options.liveOutputFileSystem,
      grant,
      grantValidator: () => this.permits.isActivePath(settings.pathGrantId!, "live-output"),
      items,
      operationKind: "rebuild"
    }));
    return result.items[0]?.operationId ?? `live-output-rebuild-${randomUUID()}`;
  }

  async reconcileLiveOutputMirror(): Promise<string> {
    const settings = await this.liveOutputStatus();
    if (!settings.enabled || settings.pathGrantId === null) {
      throw new ApplicationServiceError("LIVE_OUTPUT_DISABLED", "Enable Live Output before reconciling it.");
    }
    const grant = this.liveOutputGrant(settings.pathGrantId);
    const result = await this.requireWritableStore().runLiveOutput((repository) => reconcileLiveOutput(repository, {
      fileSystem: this.options.liveOutputFileSystem,
      grant,
      grantValidator: () => this.permits.isActivePath(settings.pathGrantId!, "live-output")
    }));
    return result.operationId ?? `live-output-reconcile-${randomUUID()}`;
  }

  async removeLiveOutputFiles(): Promise<string> {
    const settings = await this.liveOutputStatus();
    if (settings.pathGrantId === null) {
      throw new ApplicationServiceError("LIVE_OUTPUT_GRANT_REQUIRED", "Live Output has no directory grant.");
    }
    const grant = this.liveOutputGrant(settings.pathGrantId);
    const result = await this.requireWritableStore().runLiveOutput((repository) => removeMirrorFiles(repository, {
      fileSystem: this.options.liveOutputFileSystem,
      grant,
      grantValidator: () => this.permits.isActivePath(settings.pathGrantId!, "live-output")
    }));
    return result.operationIds[0] ?? `live-output-remove-${randomUUID()}`;
  }

  toBoundaryError(requestId: string, correlationId: string, error: unknown): ApplicationErrorMessage {
    const mapped = mapError(error);
    return {
      kind: "error",
      id: randomUUID(),
      correlationId,
      requestId,
      error: {
        code: mapped.code,
        category: categoryForError(mapped.code),
        message: mapped.message,
        retryable: retryableError(mapped.code),
        causeId: correlationId,
        ...(mapped.code === "EXTERNAL_CAPABILITY_UNAVAILABLE"
          ? { userAction: "Configure the requested desktop integration, then retry." }
          : {})
      }
    };
  }

  async createDocument(input: {
    path: string;
    title: string;
    initialGraph: EtherGraph;
  }): Promise<DocumentSnapshot> {
    this.assertNoDocument();
    this.store = await createStore({
      ...input,
      appVersion: this.options.appVersion,
      environment: this.documentEnvironment()
    });
    this.attachScheduler();
    return this.queryDocument();
  }

  async openDocument(input: {
    path: string;
    access: "prefer-write" | "read-only" | "require-write";
  }): Promise<DocumentSnapshot> {
    await this.inspectDocument(input);
    return this.activateInspectedDocument();
  }

  async inspectDocument(input: {
    path: string;
    access: "prefer-write" | "read-only" | "require-write";
  }): Promise<DocumentSnapshot> {
    this.assertNoDocument();
    this.store = await DocumentStore.inspect(input.path, this.documentEnvironment());
    this.inspectedAccess = input.access;
    return this.queryDocument();
  }

  async activateInspectedDocument(): Promise<DocumentSnapshot> {
    const inspected = this.requireStore();
    const access = this.inspectedAccess;
    if (access === undefined) {
      throw new ApplicationServiceError("DOCUMENT_NOT_INSPECTED", "No inspected Ether document is pending activation.");
    }
    const inspectedPath = inspected.path;
    await inspected.close();
    this.store = undefined;
    this.inspectedAccess = undefined;
    const store = await DocumentStore.open(inspectedPath, {
      access,
      environment: this.documentEnvironment()
    });
    this.store = store;
    this.attachScheduler();
    if (store.mode.kind === "writable") {
      const recoveryCandidates = await store.transaction(({ execution }) => {
        execution.quarantineForeignDocumentPlans();
        return execution.recoverProcessLost();
      });
      const jobIds = recoveryCandidates.length === 0
        ? []
        : await this.recoverableJobs(store, recoveryCandidates);
      await this.drainEvents();
      if (this.options.dispatchMode !== "manual") jobIds.forEach((jobId) => void this.scheduler!.run(jobId));
    }
    return this.queryDocument();
  }

  private async recoverableJobs(
    store: DocumentStore,
    candidateJobIds: readonly string[]
  ): Promise<string[]> {
    const recoverableProviderIds = new Set([
      this.options.provider.descriptor.id,
      ...(await this.boundaryConfiguredProviderCapabilities()).map((capability) => capability.providerId)
    ]);
    return store.read(({ execution }) => candidateJobIds.filter((jobId) => {
      const job = execution.getJob(jobId);
      const plan = job === undefined ? undefined : execution.getPlan(job.planId);
      return plan !== undefined &&
        plan.steps.every((step) =>
          step.providerBinding === null ||
          step.providerBinding === undefined ||
          recoverableProviderIds.has(step.providerBinding.providerId)
        ) &&
        plan.workItems.every((workItem) =>
          workItem.providerBindingOverride === undefined ||
          recoverableProviderIds.has(workItem.providerBindingOverride.providerId)
        );
    }));
  }

  async saveDocument(input: { commandId: string }): Promise<void> {
    await this.requireWritableStore().transaction(({ execution, revisions }) => {
      const existing = execution.getCommandResult(input.commandId, "document.save");
      if (existing !== undefined) return;
      const milestone = revisions.createMilestone("Manual save", "manual");
      const head = revisions.head();
      execution.completeCommand(input.commandId, "document.save", { milestone }, [{
        name: "document.stateChanged",
        payload: {
          state: "open",
          dirty: false,
          documentRevisionId: head.documentRevisionId
        }
      }]);
    });
    await this.drainEvents();
  }

  async autosaveDocument(): Promise<void> {
    await this.requireWritableStore().transaction(({ revisions }) => {
      revisions.createMilestone("Autosave", "autosave");
    });
  }

  async saveAsDocument(input: { path: string }): Promise<DocumentSnapshot> {
    await this.requireWritableStore().saveAs(input.path);
    return this.queryDocument();
  }

  async saveCopyDocument(input: { path: string }): Promise<{ documentId: string; path: string }> {
    return this.requireStore().saveCopy(input.path);
  }

  async compactDocument(): Promise<{ beforeBytes: number; afterBytes: number }> {
    return this.requireWritableStore().compact();
  }

  async closeDocument(): Promise<void> {
    const store = this.requireStore();
    await this.scheduler?.detach();
    await store.close();
    this.store = undefined;
    this.scheduler = undefined;
    this.inspectedAccess = undefined;
  }

  async applyGraphTransaction(input: {
    commandId: string;
    transaction: GraphTransaction;
  }): Promise<{ documentRevisionId: string; graphRevisions: Record<string, string> }> {
    try {
      const result = await applyTransaction(this.requireStore(), input.commandId, input.transaction);
      await this.drainEvents();
      return deepFreezeSnapshot(result);
    } catch (error) {
      throw mapError(error);
    }
  }

  async previewGraphTransaction(transaction: GraphTransaction): Promise<{
    documentId: string;
    transaction: GraphTransaction;
    tempIds: Record<string, string>;
    summary: {
      operationCount: number;
      affectedGraphIds: string[];
      addedNodes: number;
      addedEdges: number;
      removedNodes: number;
      removedEdges: number;
    };
    warnings: string[];
  }> {
    try {
      const store = this.requireStore();
      const snapshot = await store.read(({ graphs, revisions }) => ({ graphs: graphs.list(), head: revisions.head() }));
      if (snapshot.head.documentRevisionId !== transaction.baseDocumentRevisionId) {
        throw new ApplicationServiceError("STALE_REVISION", "The graph transaction must be rebased onto the current document revision.");
      }
      for (const [graphId, baseRevisionId] of Object.entries(transaction.baseGraphRevisions)) {
        if (snapshot.head.graphRevisions[graphId] !== baseRevisionId) {
          throw new ApplicationServiceError("STALE_REVISION", `Graph ${graphId} changed after the transaction was authored.`);
        }
      }
      const preview = previewGraphTransaction({ graphs: snapshot.graphs, transaction });
      const canonicalTransaction: GraphTransaction = {
        ...transaction,
        operations: preview.forwardOperations
      };
      return deepFreezeSnapshot({
        documentId: store.documentId,
        transaction: canonicalTransaction,
        tempIds: preview.tempIds,
        summary: {
          operationCount: preview.forwardOperations.length,
          affectedGraphIds: [...new Set(preview.forwardOperations.map((operation) => operation.graphId))],
          addedNodes: preview.forwardOperations.filter((operation) => operation.type === "addNode").length,
          addedEdges: preview.forwardOperations.filter((operation) => operation.type === "addEdge").length,
          removedNodes: preview.forwardOperations.filter((operation) => operation.type === "removeNode").length,
          removedEdges: preview.forwardOperations.filter((operation) => operation.type === "removeEdge").length
        },
        warnings: []
      });
    } catch (error) {
      throw mapError(error);
    }
  }

  async applyGraphTransactionWithEditPermit(input: {
    commandId: string;
    editPermitId: string;
    transaction: GraphTransaction;
  }): Promise<{ documentRevisionId: string; graphRevisions: Record<string, string> }> {
    this.requireEditPermit(input.editPermitId);
    return this.applyGraphTransaction({ commandId: input.commandId, transaction: input.transaction });
  }

  async pinOutput(input: {
    baseDocumentRevisionId: string;
    commandId: string;
    edgeId: string;
    outputVersionId: string;
  }): Promise<{ documentRevisionId: string; graphRevisions: Record<string, string> }> {
    const store = this.requireWritableStore();
    const existing = await store.read(({ execution }) => execution.getCommandResult(input.commandId, "output.pin"));
    if (existing !== undefined) return existing.revision as { documentRevisionId: string; graphRevisions: Record<string, string> };
    const snapshot = await store.read(({ graphs, outputs, revisions }) => ({
      graphs: graphs.list(),
      head: revisions.head(),
      output: outputs.getVersion(input.outputVersionId)
    }));
    if (snapshot.head.documentRevisionId !== input.baseDocumentRevisionId) {
      throw new ApplicationServiceError("STALE_REVISION", "Output pinning requires the current document revision.");
    }
    if (snapshot.output === undefined) throw new ApplicationServiceError("OUTPUT_NOT_FOUND", `Unknown output ${input.outputVersionId}.`);
    const graph = snapshot.graphs.find((candidate) => candidate.edges.some((edge) => edge.id === input.edgeId));
    const edge = graph?.edges.find((candidate) => candidate.id === input.edgeId);
    if (graph === undefined || edge === undefined) throw new ApplicationServiceError("EDGE_NOT_FOUND", `Unknown edge ${input.edgeId}.`);
    if (edge.from.kind !== "node" || edge.from.nodeId !== snapshot.output.nodeId) {
      throw new ApplicationServiceError("OUTPUT_PIN_SOURCE_MISMATCH", "Pinned outputs must belong to the edge source node.");
    }
    const transaction: GraphTransaction = {
      id: `pin-${input.commandId}`,
      baseDocumentRevisionId: input.baseDocumentRevisionId,
      baseGraphRevisions: snapshot.head.graphRevisions,
      title: "Pin output version",
      actor: "user",
      layoutPolicy: "preserve",
      operations: [{
        type: "updateEdge",
        graphId: graph.id,
        edgeId: edge.id,
        edge: { ...edge, selector: { kind: "pinned", outputVersionId: input.outputVersionId } }
      }]
    };
    const preview = previewGraphTransaction({ graphs: snapshot.graphs, transaction });
    const result = await store.transaction(({ execution, revisions }) => {
      const duplicate = execution.getCommandResult(input.commandId, "output.pin");
      if (duplicate !== undefined) return duplicate.revision as { documentRevisionId: string; graphRevisions: Record<string, string> };
      const committed = revisions.commit({
        id: transaction.id,
        baseDocumentRevisionId: transaction.baseDocumentRevisionId,
        baseGraphRevisions: transaction.baseGraphRevisions,
        title: transaction.title,
        actor: transaction.actor,
        graphSnapshots: preview.graphs,
        forwardOperations: preview.forwardOperations,
        inverseOperations: preview.inverseOperations
      });
      const revision = { documentRevisionId: committed.documentRevisionId, graphRevisions: committed.graphRevisions };
      execution.completeCommand(input.commandId, "output.pin", { revision }, [
        { name: "graph.revisionChanged", payload: { graphId: graph.id, revisionId: committed.graphRevisions[graph.id]!, transactionId: transaction.id } },
        { name: "output.pinned", payload: { edgeId: edge.id, outputVersionId: input.outputVersionId, documentRevisionId: committed.documentRevisionId } }
      ]);
      return revision;
    });
    await this.drainEvents();
    return result;
  }

  async applyHistory(commandId: string, name: "graph.redo" | "graph.undo") {
    const store = this.requireWritableStore();
    return store.transaction(({ execution, revisions }) => {
      const existing = execution.getCommandResult(commandId, name);
      if (existing !== undefined) return existing.revision as { documentRevisionId: string; graphRevisions: Record<string, string> };
      const committed = name === "graph.undo" ? revisions.undo() : revisions.redo();
      const revision = { documentRevisionId: committed.documentRevisionId, graphRevisions: committed.graphRevisions };
      execution.completeCommand(commandId, name, { revision });
      return revision;
    });
  }

  async completeCompare(input: {
    checkpointId: string;
    commandId: string;
    note?: string;
    selectedOutputVersionIds: string[];
  }): Promise<void> {
    const store = this.requireWritableStore();
    const jobId = await store.transaction(({ execution }) => {
      const existing = execution.getCommandResult(input.commandId, "review.completeCompare");
      if (existing !== undefined) return String(existing.jobId);
      execution.completeCompareCheckpoint({
        checkpointId: input.checkpointId,
        selectedOutputVersionIds: input.selectedOutputVersionIds,
        completion: { note: input.note ?? "" }
      });
      const job = execution.listJobs().find((candidate) =>
        execution.listReviewCheckpoints(candidate.id).some((checkpoint) => checkpoint.id === input.checkpointId)
      );
      if (job === undefined) throw new ApplicationServiceError("JOB_NOT_FOUND", "The Compare checkpoint has no durable job.");
      execution.completeCommand(input.commandId, "review.completeCompare", {
        acknowledgement: { kind: "acknowledgement", accepted: true },
        jobId: job.id
      });
      return job.id;
    });
    await this.drainEvents();
    this.resumeAfterReview(jobId);
  }

  async previewRun(input: {
    commandId: string;
    correlationId?: string;
    graphId: string;
    scope: ExecutionScope;
  }): Promise<ExecutionPlan> {
    const store = this.requireWritableStore();
    const planId = `plan-${randomUUID()}`;
    const existing = await store.read(({ execution }) =>
      execution.getCommandResult(input.commandId, "run.preview")
    );
    if (existing !== undefined) {
      return deepFreezeSnapshot(ExecutionPlanSchema.parse(existing.plan));
    }
    const snapshot = await store.read(({ artifacts, blobs, graphs, outputs, references, revisions }) => {
      const graph = graphs.get(input.graphId);
      if (graph === undefined) throw new ApplicationServiceError("GRAPH_NOT_FOUND", `Unknown graph ${input.graphId}.`);
      const versions = graph.nodes.flatMap((node) => outputs.listByNode(node.id));
      const payloads = versions.flatMap((version) => version.outputPayloadIds.flatMap((payloadId) => {
        const payload = outputs.getPayload(payloadId);
        return payload === undefined ? [] : [payload];
      }));
      return {
        graph,
        head: revisions.head(),
        versions,
        payloads,
        referenceInputs: referenceInputBindings(
          graph,
          (referenceId) => references.get(referenceId),
          (artifactId) => artifacts.get(artifactId),
          (contentKey) => blobs.get(contentKey),
          planId
        )
      };
    });
    const capabilities = await planningCapabilities(
      snapshot.graph,
      this.options.provider,
      await this.boundaryConfiguredProviderCapabilities(),
      input.scope
    );
    const planCompilationStartedAt = performance.now();
    const plan = compilePlan({
      id: planId,
      documentId: store.documentId,
      documentRevisionId: snapshot.head.documentRevisionId,
      graph: snapshot.graph,
      graphRevisionId: snapshot.head.graphRevisions[input.graphId]!,
      scope: input.scope,
      capability: capabilities.primary,
      providerCapabilities: capabilities.all,
      workerRuntimeIntegration: { schemaCatalog: this.options.workerSchemaCatalog ?? [] },
      referenceInputs: snapshot.referenceInputs,
      outputVersions: snapshot.versions,
      payloads: snapshot.payloads,
      createdAt: new Date().toISOString()
    });
    recordBoundedPerformanceMeasure(
      "plan-compilation",
      planCompilationStartedAt,
      performance.now(),
      { commandId: input.commandId, graphId: input.graphId }
    );
    if (plan.steps.length === 0) {
      throw new ApplicationServiceError("NO_RUNNABLE_SCOPE", "The selected execution scope has no runnable steps.");
    }
    const persisted = await store.transaction(({ execution }) => {
      const duplicate = execution.getCommandResult(input.commandId, "run.preview");
      if (duplicate !== undefined) return ExecutionPlanSchema.parse(duplicate.plan);
      execution.savePlan(plan);
      execution.completeCommand(input.commandId, "run.preview", { plan }, [{
        name: "plan.stateChanged",
        payload: { planId: plan.id, state: "previewed" }
      }], input.correlationId ?? input.commandId);
      return plan;
    });
    await this.drainEvents();
    return deepFreezeSnapshot(persisted);
  }

  async grantRunPermit(input: {
    commandId: string;
    correlationId?: string;
    planId: string;
    contentHash: string;
  }): Promise<{ id: string; planId: string; contentHash: string }> {
    try {
      const permit = await this.requireWritableStore().transaction(({ execution }) =>
        execution.grantRunPermit(
          input.planId,
          input.contentHash,
          input.commandId,
          input.correlationId ?? input.commandId
        )
      );
      this.permits.registerRun(input.commandId, permit.id, input.planId, input.contentHash);
      await this.drainEvents();
      return deepFreezeSnapshot(permit);
    } catch (error) {
      throw mapError(error);
    }
  }

  async startRun(input: {
    commandId: string;
    correlationId?: string;
    planId: string;
    contentHash: string;
    runPermitId: string;
  }): Promise<ExecutionJob> {
    try {
      this.permits.requireRun(input.runPermitId, input.planId, input.contentHash, input.commandId);
      this.permits.consumeRun(input.runPermitId, input.commandId);
      let job: ExecutionJob;
      try {
        job = await this.requireWritableStore().transaction(({ execution }) =>
          execution.startJob(input)
        );
      } catch (error) {
        this.permits.releaseRun(input.runPermitId, input.commandId);
        throw error;
      }
      await this.drainEvents();
      if (this.options.dispatchMode !== "manual") void this.scheduler!.run(job.id);
      return deepFreezeSnapshot(job);
    } catch (error) {
      throw mapError(error);
    }
  }

  async runPending(jobId: string): Promise<ExecutionJob> {
    await this.requireScheduler().run(jobId);
    await this.drainEvents();
    return this.queryJob(jobId);
  }

  async waitForJob(jobId: string): Promise<ExecutionJob> {
    return deepFreezeSnapshot(await this.requireScheduler().waitForJob(jobId));
  }

  async cancelRun(input: { commandId: string; jobId: string }): Promise<ExecutionJob> {
    const job = await this.requireScheduler().cancel(input.jobId, input.commandId);
    await this.drainEvents();
    return deepFreezeSnapshot(job);
  }

  async cancelRunWithPermit(input: {
    commandId: string;
    contentHash: string;
    jobId: string;
    planId: string;
    runPermitId: string;
  }): Promise<ExecutionJob> {
    const job = await this.queryJob(input.jobId);
    if (job.planId !== input.planId || job.planContentHash !== input.contentHash) {
      throw new ApplicationServiceError("RUN_PERMIT_MISMATCH", "The job does not belong to the authorized immutable plan.");
    }
    this.permits.requireRunControl(input.runPermitId, input.planId, input.contentHash);
    const cancelled = await this.cancelRun({ commandId: input.commandId, jobId: input.jobId });
    return cancelled;
  }

  async retryRun(input: {
    commandId: string;
    jobId: string;
    workItemIds?: readonly string[];
  }): Promise<ExecutionJob> {
    const job = await this.requireWritableStore().transaction(({ execution }) =>
      execution.retryFailed(input.jobId, input.workItemIds, input.commandId)
    );
    await this.drainEvents();
    if (this.options.dispatchMode !== "manual") void this.requireScheduler().run(job.id);
    return deepFreezeSnapshot(job);
  }

  async retryRunWithPermit(input: {
    commandId: string;
    contentHash: string;
    jobId: string;
    planId: string;
    runPermitId: string;
    workItemIds?: readonly string[];
  }): Promise<ExecutionJob> {
    const job = await this.queryJob(input.jobId);
    if (job.planId !== input.planId || job.planContentHash !== input.contentHash) {
      throw new ApplicationServiceError("RUN_PERMIT_MISMATCH", "The job does not belong to the authorized immutable plan.");
    }
    this.permits.requireRunControl(input.runPermitId, input.planId, input.contentHash);
    const retried = await this.retryRun({ commandId: input.commandId, jobId: input.jobId, workItemIds: input.workItemIds });
    return retried;
  }

  async resumeRun(input: { commandId: string; jobId: string }): Promise<ExecutionJob> {
    const existing = await this.requireWritableStore().read(({ execution }) =>
      execution.getCommandResult(input.commandId, "run.resume")
    );
    if (existing !== undefined) return deepFreezeSnapshot(ExecutionJobSchema.parse(existing.job));
    await this.requireScheduler().run(input.jobId);
    const job = await this.queryJob(input.jobId);
    await this.requireWritableStore().transaction(({ execution }) =>
      execution.completeCommand(input.commandId, "run.resume", { job }, [{
        name: "job.stateChanged",
        payload: { jobId: job.id, state: job.status }
      }])
    );
    await this.drainEvents();
    return job;
  }

  async queryDocument(): Promise<DocumentSnapshot> {
    const store = this.requireStore();
    const head = await store.read(({ revisions }) => revisions.head());
    return deepFreezeSnapshot({
      documentId: store.documentId,
      path: store.path,
      mode: store.mode.kind,
      readOnlyReason: store.mode.kind === "read-only" ? store.mode.reason : null,
      dirty: store.dirty,
      documentRevisionId: head.documentRevisionId,
      graphRevisions: head.graphRevisions
    });
  }

  async queryDocumentHeader() {
    return deepFreezeSnapshot(await this.requireStore().read(({ settings }) => settings.getHeader()));
  }

  async queryReferences() {
    return deepFreezeSnapshot(await this.requireStore().read(({ references }) => references.list()));
  }

  async relinkDocumentReference(input: { referenceId: string; sourcePath: string; pathGrantId: string }) {
    const reference = await relinkReference(
      this.requireWritableStore(),
      input.referenceId,
      input.sourcePath,
      input.pathGrantId
    );
    this.publishReferenceChanged(reference.id, "linked");
    return reference;
  }

  async useEmbeddedReferencePreview(referenceId: string) {
    const store = this.requireWritableStore();
    const reference = await store.read(({ references }) => references.get(referenceId));
    if (reference === undefined) {
      throw new ApplicationServiceError("REFERENCE_NOT_FOUND", `Unknown reference ${referenceId}.`);
    }
    if (reference.previewContentKey === null) {
      throw new ApplicationServiceError(
        "REFERENCE_PREVIEW_UNAVAILABLE",
        "This reference has no embedded preview."
      );
    }
    return embedReference(store, referenceId, reference.previewContentKey);
  }

  async embedAvailableReference(referenceId: string) {
    const store = this.requireWritableStore();
    store.takeReferenceGrantAttention();
    const reference = await resolveReference(store, referenceId);
    if (reference.state !== "linked" || reference.originalPath === null) {
      this.publishReferenceChanged(reference.id, "missing");
      throw new ApplicationServiceError(
        "REFERENCE_SOURCE_UNAVAILABLE",
        "The linked reference source is not currently available."
      );
    }
    const blob = await importBlob(
      store,
      { mediaType: reference.mediaType, sourcePath: reference.originalPath },
      { appDataRoot: this.options.appDataRoot }
    );
    const embedded = await embedReference(store, referenceId, blob.contentKey);
    this.publishReferenceChanged(embedded.id, "embedded");
    return { grantRevocationPending: store.takeReferenceGrantAttention(), reference: embedded };
  }

  async removeDocumentReference(referenceId: string): Promise<{ grantRevocationPending: boolean }> {
    const store = this.requireWritableStore();
    store.takeReferenceGrantAttention();
    const reference = await store.read(({ references }) => references.get(referenceId));
    if (reference === undefined) {
      throw new ApplicationServiceError("REFERENCE_NOT_FOUND", `Unknown reference ${referenceId}.`);
    }
    if (reference.pathGrantId !== null) store.prepareReferenceGrantRevocation(reference.pathGrantId);
    let removed: boolean;
    try {
      removed = await store.transaction(({ references }) => references.remove(referenceId));
    } catch (error) {
      if (reference.pathGrantId !== null) store.cancelReferenceGrantRevocation(reference.pathGrantId);
      throw error;
    }
    if (!removed) {
      if (reference.pathGrantId !== null) store.cancelReferenceGrantRevocation(reference.pathGrantId);
      throw new ApplicationServiceError("REFERENCE_NOT_FOUND", `Unknown reference ${referenceId}.`);
    }
    if (reference.pathGrantId !== null) store.revokeReferenceGrantAuthority(reference.pathGrantId);
    this.publishReferenceChanged(referenceId, "removed");
    return { grantRevocationPending: store.takeReferenceGrantAttention() };
  }

  async makeDocumentPortable() {
    const store = this.requireWritableStore();
    store.takeReferenceGrantAttention();
    const references = await this.queryReferences();
    const existingContentKeys = new Set(
      await store.read(({ blobs }) => blobs.list().map(({ contentKey }) => contentKey))
    );
    let embeddedBytes = 0;
    const missingReferenceIds: string[] = [];
    const prepared: Array<{ referenceId: string; contentKey: string }> = [];
    try {
      for (const reference of references) {
        if (reference.state === "embedded") continue;
        try {
          const resolved = await resolveReference(store, reference.id);
          if (resolved.state !== "linked" || resolved.originalPath === null) {
            missingReferenceIds.push(reference.id);
            continue;
          }
          const blob = await importBlob(
            store,
            { mediaType: resolved.mediaType, sourcePath: resolved.originalPath },
            {
              appDataRoot: this.options.appDataRoot,
              checkpoint: (stage) => this.options.portableImportCheckpoint?.(stage, resolved.id)
            }
          );
          prepared.push({ referenceId: resolved.id, contentKey: blob.contentKey });
          embeddedBytes += resolved.fingerprint.byteLength;
          this.options.portableCheckpoint?.("prepared", resolved.id);
        } catch (error) {
          if (!isExpectedReferenceUnavailable(error)) throw error;
          missingReferenceIds.push(reference.id);
        }
      }
      await embedReferences(store, prepared);
      return {
        embeddedBytes,
        embeddedCount: prepared.length,
        grantRevocationPending: store.takeReferenceGrantAttention(),
        missingReferenceIds
      };
    } catch (error) {
      try {
        const operationContentKeys = await store.read(({ blobs }) => blobs.list()
          .map(({ contentKey }) => contentKey)
          .filter((contentKey) => !existingContentKeys.has(contentKey)));
        if (operationContentKeys.length > 0) {
          await store.reclaimUnreferencedReadyBlobs(operationContentKeys);
          await store.reclaimUnusedPages();
        }
      } catch (cleanupError) {
        if (typeof error === "object" && error !== null && !("cleanupError" in error)) {
          Object.defineProperty(error, "cleanupError", {
            configurable: true,
            enumerable: false,
            value: cleanupError
          });
        }
      }
      throw error;
    }
  }

  async preflightDocumentPortable(): Promise<{
    expectedBytes: number;
    expectedCount: number;
    missingReferenceIds: string[];
  }> {
    const references = await this.queryReferences();
    let expectedBytes = 0;
    let expectedCount = 0;
    const missingReferenceIds: string[] = [];
    for (const reference of references) {
      if (reference.state === "embedded") continue;
      if (reference.state !== "linked" || reference.originalPath === null) {
        missingReferenceIds.push(reference.id);
        continue;
      }
      try {
        const source = await stat(reference.originalPath);
        if (!source.isFile() || source.size !== reference.fingerprint.byteLength) {
          missingReferenceIds.push(reference.id);
          continue;
        }
        expectedCount += 1;
        expectedBytes += source.size;
      } catch {
        missingReferenceIds.push(reference.id);
      }
    }
    return { expectedBytes, expectedCount, missingReferenceIds };
  }

  async queryArtifactDescriptor(artifactId: string) {
    const artifact = await this.requireStore().read(({ artifacts }) => artifacts.get(artifactId));
    if (artifact === undefined) {
      throw new ApplicationServiceError("ARTIFACT_NOT_FOUND", `Unknown artifact ${artifactId}.`);
    }
    return deepFreezeSnapshot(artifact);
  }

  async queryArtifactAssetDescriptor(
    artifactId: string,
    variant: "original" | "thumbnail"
  ): Promise<{ byteLength: number; contentKey: string; mediaType: string }> {
    const store = this.requireStore();
    const artifact = await this.queryArtifactDescriptor(artifactId);
    if (variant === "original") {
      return deepFreezeSnapshot({
        byteLength: artifact.byteLength,
        contentKey: artifact.contentKey,
        mediaType: artifact.mediaType
      });
    }
    const candidate = thumbnailDescriptor(artifact);
    if (candidate === null) {
      throw new ApplicationServiceError(
        "ARTIFACT_THUMBNAIL_UNAVAILABLE",
        `Artifact ${artifactId} has no embedded thumbnail.`
      );
    }
    const stored = await store.read(({ blobs }) => blobs.get(candidate.contentKey));
    if (
      stored === undefined ||
      stored.byteLength !== candidate.byteLength ||
      stored.mediaType !== candidate.mediaType
    ) {
      throw new ApplicationServiceError(
        "ARTIFACT_THUMBNAIL_INVALID",
        `Artifact ${artifactId} has invalid embedded thumbnail metadata.`
      );
    }
    return deepFreezeSnapshot(candidate);
  }

  async readArtifactRange(artifactId: string, start: number, endExclusive: number): Promise<Buffer> {
    const store = this.requireStore();
    const artifact = await this.queryArtifactDescriptor(artifactId);
    return readBlobRange(store, artifact.contentKey, start, endExclusive);
  }

  async *streamArtifactRange(
    artifactId: string,
    start: number,
    endExclusive: number
  ): AsyncGenerator<Buffer, void, void> {
    const store = this.requireStore();
    const artifact = await this.queryArtifactDescriptor(artifactId);
    yield* streamBlobRange(store, artifact.contentKey, start, endExclusive);
  }

  async *streamArtifactAssetRange(
    artifactId: string,
    variant: "original" | "thumbnail",
    start: number,
    endExclusive: number
  ): AsyncGenerator<Buffer, void, void> {
    const store = this.requireStore();
    const descriptor = await this.queryArtifactAssetDescriptor(artifactId, variant);
    yield* streamBlobRange(store, descriptor.contentKey, start, endExclusive);
  }

  async queryGraph(graphId: string): Promise<EtherGraph> {
    const graph = await this.requireStore().read(({ graphs }) => graphs.get(graphId));
    if (graph === undefined) throw new ApplicationServiceError("GRAPH_NOT_FOUND", `Unknown graph ${graphId}.`);
    return deepFreezeSnapshot(graph);
  }

  async compiledInputPreview(nodeId: string) {
    const store = this.requireStore();
    const snapshot = await store.read(({ graphs, outputs, revisions }) => {
      const allGraphs = graphs.list();
      const graph = allGraphs.find((candidate) => candidate.nodes.some((node) => node.id === nodeId));
      if (graph === undefined) throw new ApplicationServiceError("NODE_NOT_FOUND", `Unknown node ${nodeId}.`);
      const versions = graph.nodes.flatMap((node) => outputs.listByNode(node.id));
      const payloads = versions.flatMap((version) => version.outputPayloadIds.map((id) => outputs.getPayload(id)).filter((value): value is NonNullable<typeof value> => value !== undefined));
      return { allGraphs, graph, head: revisions.head(), payloads, versions };
    });
    const node = snapshot.graph.nodes.find((candidate) => candidate.id === nodeId)!;
    if (node.config.kind === "prompt.text") {
      return {
        nodeId,
        instruction: node.config.body,
        contextHash: stableApplicationId("context", JSON.stringify(node.config)),
        inputs: []
      };
    }
    const capabilities = await planningCapabilities(
      snapshot.graph,
      this.options.provider,
      await this.boundaryConfiguredProviderCapabilities(),
      { kind: "node", nodeId }
    );
    const plan = compilePlan({
      id: `preview-${randomUUID()}`,
      documentId: store.documentId,
      documentRevisionId: snapshot.head.documentRevisionId,
      graph: snapshot.graph,
      graphs: snapshot.allGraphs,
      graphRevisionId: snapshot.head.graphRevisions[snapshot.graph.id]!,
      scope: { kind: "node", nodeId },
      capability: capabilities.primary,
      providerCapabilities: capabilities.all,
      workerRuntimeIntegration: { schemaCatalog: this.options.workerSchemaCatalog ?? [] },
      outputVersions: snapshot.versions,
      payloads: snapshot.payloads,
      createdAt: new Date().toISOString()
    });
    const step = plan.steps.find((candidate) => candidate.nodeId === nodeId && candidate.subject?.kind !== "adapter");
    if (step === undefined) throw new ApplicationServiceError("NO_RUNNABLE_SCOPE", "This node has no compiled runnable input.");
    const inputIds = new Set([...(step.inputPayloadIds ?? []), ...(step.resolvedInputBindings ?? []).map((binding) => binding.payloadId)]);
    return {
      nodeId,
      instruction: step.compiledPrompt,
      contextHash: plan.contentHash,
      inputs: snapshot.payloads.filter((payload) => inputIds.has(payload.id))
    };
  }

  async queryPlan(planId: string): Promise<ExecutionPlan> {
    const plan = await this.requireStore().read(({ execution }) => execution.getPlan(planId));
    if (plan === undefined) throw new ApplicationServiceError("PLAN_NOT_FOUND", `Unknown plan ${planId}.`);
    return deepFreezeSnapshot(plan);
  }

  async queryJob(jobId: string): Promise<ExecutionJob> {
    const job = await this.requireStore().read(({ execution }) => execution.getJob(jobId));
    if (job === undefined) throw new ApplicationServiceError("JOB_NOT_FOUND", `Unknown job ${jobId}.`);
    return deepFreezeSnapshot(job);
  }

  async queryWorkItems(jobId: string): Promise<ExecutionWorkItem[]> {
    return deepFreezeSnapshot(
      await this.requireStore().read(({ execution }) => execution.listWorkItems(jobId))
    );
  }

  async queryAttempts(jobId: string): Promise<ExecutionAttempt[]> {
    return deepFreezeSnapshot(
      await this.requireStore().read(({ execution }) => execution.listAttempts(jobId))
    );
  }

  async queryNodeOutputs(nodeId: string): Promise<NodeOutputVersion[]> {
    return deepFreezeSnapshot(
      await this.requireStore().read(({ outputs }) => outputs.listByNode(nodeId))
    );
  }

  async searchArtifacts(input: { text: string }): Promise<Artifact[]> {
    const needle = input.text.trim().toLocaleLowerCase();
    const artifacts = await this.requireStore().read(({ artifacts }) => artifacts.list());
    return deepFreezeSnapshot(
      needle.length === 0
        ? artifacts
        : artifacts.filter((artifact) => JSON.stringify(artifact).toLocaleLowerCase().includes(needle))
    );
  }

  async queryArtifactLineage(artifactId: string): Promise<ArtifactLineageSnapshot> {
    const lineage = await this.requireStore().read(({ execution }) => execution.getLineage(artifactId));
    if (lineage === undefined) {
      throw new ApplicationServiceError("ARTIFACT_NOT_FOUND", `Unknown artifact ${artifactId}.`);
    }
    return deepFreezeSnapshot(lineage);
  }

  async readArtifactBytes(artifactId: string): Promise<Buffer> {
    const store = this.requireStore();
    const artifact = await store.read(({ artifacts }) => artifacts.get(artifactId));
    if (artifact === undefined) throw new ApplicationServiceError("ARTIFACT_NOT_FOUND", `Unknown artifact ${artifactId}.`);
    return readBlobRange(store, artifact.contentKey, 0, artifact.byteLength);
  }

  async exportArtifacts(input: {
    artifactIds: readonly string[];
    collisionPolicy: "error" | "rename" | "skip";
    commandId: string;
    namingTemplate: string;
    pathGrantId: string;
    format?: "original" | "png" | "jpeg" | "webp";
    hierarchy?: "flat" | "collection";
    includeMetadataSidecar?: boolean;
    includeLineageReport?: boolean;
  }): Promise<ExportRecord[]> {
    const store = this.requireWritableStore();
    const duplicate = await store.read(({ execution }) => execution.getCommandResult(input.commandId, "artifact.export"));
    if (duplicate !== undefined) {
      const records = duplicate.records as ExportRecord[];
      for (const record of records) await this.materializeExport(record);
      return store.read(({ exports }) => records.map((record) => exports.get(record.id)!));
    }
    await this.revalidatePathGrant(input.pathGrantId, "export");
    const exportDetails = await Promise.all(input.artifactIds.map((artifactId) => store.read(({ artifacts }) => artifacts.detail(artifactId))));
    const records = await store.transaction(({ artifacts, exports }) => input.artifactIds.map((artifactId, index) => {
      const artifact = artifacts.get(artifactId);
      if (artifact === undefined) throw new ApplicationServiceError("ARTIFACT_NOT_FOUND", `Unknown artifact ${artifactId}.`);
      const id = stableApplicationId("export", input.commandId, artifactId);
      const collectionFolder = input.hierarchy === "collection"
        ? exportDetails[index]?.collections[0]?.title
        : undefined;
      const relativePath = exportName(input.namingTemplate, artifact, input.format ?? "original");
      return exports.get(id) ?? exports.create({
        id,
        artifactId,
        pathGrantId: input.pathGrantId,
        relativePath: collectionFolder === undefined ? relativePath : path.join(safeFileName(collectionFolder), relativePath),
        contentKey: artifact.contentKey,
        status: "planned",
        createdAt: new Date().toISOString(),
        completedAt: null,
        options: {
          collisionPolicy: input.collisionPolicy,
          commandId: input.commandId,
          format: input.format ?? "original",
          hierarchy: input.hierarchy ?? "flat",
          includeMetadataSidecar: input.includeMetadataSidecar ?? false,
          includeLineageReport: input.includeLineageReport ?? false
        }
      });
    }));
    for (const record of records) await this.materializeExport(record);
    const completed = await store.transaction(({ execution, exports }) => {
      const current = records.map((record) => exports.get(record.id)!);
      execution.completeCommand(input.commandId, "artifact.export", { records: current }, current.map((record) => ({
        name: "export.stateChanged",
        payload: { exportId: record.id, status: record.status }
      })));
      return current;
    });
    return completed;
  }

  async retryExport(commandId: string, exportId: string): Promise<ExportRecord[]> {
    const store = this.requireWritableStore();
    const duplicate = await store.read(({ execution }) => execution.getCommandResult(commandId, "export.retry"));
    if (duplicate !== undefined) return duplicate.records as ExportRecord[];
    const record = await store.read(({ exports }) => exports.get(exportId));
    if (record === undefined) throw new ApplicationServiceError("EXPORT_NOT_FOUND", `Unknown export ${exportId}.`);
    if (record.pathGrantId === null) throw new ApplicationServiceError("PATH_PERMISSION_REQUIRED", "The export has no path grant.");
    await this.revalidatePathGrant(record.pathGrantId, "export");
    await store.transaction(({ exports }) => { if (record.status !== "committed") exports.setStatus(record.id, "planned", null); });
    await this.materializeExport({
      ...record,
      status: record.status === "committed" ? "committed" : "planned"
    });
    return store.transaction(({ execution, exports }) => {
      const current = exports.get(record.id)!;
      execution.completeCommand(commandId, "export.retry", { records: [current] }, [{
        name: "export.stateChanged", payload: { exportId: current.id, status: current.status }
      }]);
      return [current];
    });
  }

  async cancelExport(commandId: string, exportId: string): Promise<void> {
    const store = this.requireWritableStore();
    await store.transaction(({ execution, exports }) => {
      if (execution.getCommandResult(commandId, "export.cancel") !== undefined) return;
      const record = exports.get(exportId);
      if (record === undefined) throw new ApplicationServiceError("EXPORT_NOT_FOUND", `Unknown export ${exportId}.`);
      if (!new Set(["committed", "skipped", "cancelled"]).has(record.status)) exports.setStatus(exportId, "cancelled");
      execution.completeCommand(commandId, "export.cancel", { acknowledgement: { kind: "acknowledgement", accepted: true } }, [{
        name: "export.stateChanged", payload: { exportId, status: "cancelled" }
      }]);
    });
  }

  async createDragExport(commandId: string, artifactIds: readonly string[], lifetimeHours: number) {
    const store = this.requireWritableStore();
    const duplicate = await store.read(({ execution }) => execution.getCommandResult(commandId, "artifact.dragExport"));
    if (duplicate !== undefined) return duplicate as { expiresAt: string; materializationId: string; paths: string[] };
    const materializationId = stableApplicationId("drag", store.documentId, commandId);
    const root = path.join(this.options.appDataRoot, "drag-exports", materializationId);
    await mkdir(root, { recursive: true });
    const paths: string[] = [];
    for (const artifactId of artifactIds) {
      const artifact = await this.queryArtifactDescriptor(artifactId);
      const outputPath = path.join(root, exportName("{artifact}", artifact));
      await writeFile(outputPath, await this.readArtifactBytes(artifact.id), { flag: "w" });
      paths.push(outputPath);
    }
    const result = { materializationId, expiresAt: new Date(Date.now() + lifetimeHours * 3_600_000).toISOString(), paths };
    await store.transaction(({ execution }) => execution.completeCommand(commandId, "artifact.dragExport", result));
    return result;
  }

  private async materializeExport(record: ExportRecord): Promise<void> {
    if (record.status === "skipped") return;
    const requestedSidecars = record.options?.includeMetadataSidecar === true ||
      record.options?.includeLineageReport === true;
    if (record.status === "committed" && !requestedSidecars) return;
    if (record.pathGrantId === null) {
      throw new ApplicationServiceError("PATH_PERMISSION_REQUIRED", "The export has no path grant.");
    }
    const root = (await this.revalidatePathGrant(record.pathGrantId, "export")).path;
    const artifact = await this.queryArtifactDescriptor(record.artifactId!);
    if (artifact.contentKey !== record.contentKey) {
      throw new ApplicationServiceError("EXPORT_SOURCE_CHANGED", "The export record no longer matches its immutable artifact source.");
    }
    const sourceBytes = await this.readArtifactBytes(artifact.id);
    const format = exportFormat(record.options?.format);
    const bytes = await transcodeArtifactForExport(sourceBytes, artifact.mediaType, format);
    const detail = requestedSidecars
      ? await this.requireStore().read(({ artifacts }) => artifacts.detail(artifact.id))
      : undefined;
    if (requestedSidecars && detail === undefined) {
      throw new ApplicationServiceError("ARTIFACT_NOT_FOUND", `Unknown artifact ${artifact.id}.`);
    }

    let relativePath = record.relativePath;
    let outputs = exportBundleOutputs(relativePath, bytes, detail, record);
    await prepareExportBundleParents(root, outputs);
    const policy = String(record.options?.collisionPolicy ?? "error");
    let collisions = await inspectExportBundle(root, outputs);
    if (collisions.some((entry) => entry === "different")) {
      if (policy === "skip") {
        await this.requireWritableStore().transaction(({ exports }) => { exports.setStatus(record.id, "skipped"); });
        return;
      }
      if (policy === "error") {
        await this.requireWritableStore().transaction(({ exports }) => { exports.setStatus(record.id, "failed"); });
        throw new ApplicationServiceError("EXPORT_COLLISION", `Export destination already exists: ${relativePath}`);
      }
      ({ relativePath, outputs, collisions } = await availableExportBundlePath(
        root,
        relativePath,
        bytes,
        detail,
        record
      ));
      await this.requireWritableStore().transaction(({ exports }) => { exports.setRelativePath(record.id, relativePath); });
    }

    const bundle = await prepareDurableExportBundle(
      this.options.appDataRoot,
      this.requireStore().documentId,
      record.id,
      root,
      outputs,
      collisions
    );
    if (record.status !== "committed") {
      await this.requireWritableStore().transaction(({ exports }) => {
        exports.setStatus(record.id, "staged", null);
      });
    }
    try {
      const publicationOutputs = [];
      for (const [index, output] of outputs.entries()) {
        const currentGrant = await this.revalidatePathGrant(record.pathGrantId, "export");
        if (!samePath(currentGrant.path, root)) {
          throw new ApplicationServiceError(
            "PATH_GRANT_CHANGED",
            "The export root changed before bundle publication."
          );
        }
        const destination = containedPath(root, output.relativePath);
        await this.options.exportCheckpoint?.("before-open", destination);
        publicationOutputs.push({
          destination,
          expectedByteLength: output.bytes.byteLength,
          expectedHash: output.hash,
          publicationId: stableExportPublicationId(record.id, output.relativePath),
          sourcePath: bundle.sourcePaths[index]!
        });
      }
      await publishAtomicExportBundle({
        onOutputPublished: async (output, index) => {
          await markDurableExportOutputSatisfied(bundle, index);
          await this.options.exportCheckpoint?.("after-output", output.destination);
        },
        outputs: publicationOutputs,
        root
      });
      const verified = await inspectExportBundle(root, outputs);
      if (verified.some((entry) => entry !== "matching")) {
        throw new ApplicationServiceError(
          "EXPORT_VERIFY_FAILED",
          "The complete export bundle could not be verified."
        );
      }
      await this.requireWritableStore().transaction(({ exports }) => {
        exports.setStatus(record.id, "written", null);
        exports.setStatus(record.id, "verified", null);
        exports.setStatus(record.id, "committed");
      });
      await rm(bundle.root, { recursive: true, force: true });
    } catch (error) {
      if ((error as { code?: unknown }).code === "EXPORT_COLLISION") {
        await this.requireWritableStore().transaction(({ exports }) => {
          exports.setStatus(record.id, "failed", null);
        });
      }
      throw error;
    }
  }

  private attachScheduler(): void {
    this.scheduler = new DurableScheduler({
      appDataRoot: this.options.appDataRoot,
      provider: this.options.provider,
      providers: this.options.executionProviders,
      providerResolver: this.options.providerResolver,
      concurrencyDomains: this.options.concurrencyDomains,
      // The scheduler's durable-store protocol is intentionally narrower than
      // DocumentStore and is being evolved independently in Task 14.
      store: this.requireStore() as unknown as ConstructorParameters<typeof DurableScheduler>[0]["store"],
      checkpoint: this.options.executionCheckpoint,
      onEventsAvailable: () => this.drainEvents()
    });
  }

  private drainEvents(): Promise<void> {
    const drain = async (): Promise<void> => {
      const store = this.requireStore();
      if (store.mode.kind !== "writable") return;
      const events = await store.read(({ execution }) => execution.listPendingEvents());
      for (const event of events) {
        this.emitDiagnostic({
          correlationId: event.correlationId,
          details: {
            applicationEventId: event.id,
            applicationEventName: event.name
          },
          event: `application.event.${event.name}`,
          level: "info",
          message: `Application event ${event.name} was published.`
        });
        if (!this.events.publish(event)) return;
        await store.transaction(({ execution }) => execution.markEventDelivered(event.id));
      }
    };
    this.eventDrain = this.eventDrain.then(drain, drain);
    return this.eventDrain;
  }

  private emitDiagnostic(record: ApplicationDiagnosticRecord): void {
    try {
      this.options.onDiagnostic?.(record);
    } catch {
      // Diagnostics are observational and cannot alter application behavior.
    }
  }

  private requireStore(): DocumentStore {
    if (this.store === undefined) throw new ApplicationServiceError("DOCUMENT_NOT_OPEN", "No Ether document is open.");
    return this.store;
  }

  private requireWritableStore(): DocumentStore {
    const store = this.requireStore();
    if (store.mode.kind !== "writable") throw new ApplicationServiceError("READ_ONLY", "The Ether document is read-only.");
    return store;
  }

  private requireScheduler(): DurableScheduler {
    if (this.scheduler === undefined) throw new ApplicationServiceError("DOCUMENT_NOT_OPEN", "No scheduler is active.");
    return this.scheduler;
  }

  private assertNoDocument(): void {
    if (this.store !== undefined) throw new ApplicationServiceError("DOCUMENT_ALREADY_OPEN", "Close the current document first.");
  }

  private documentEnvironment(): DocumentStoreEnvironment {
    const configuredReadOnly = this.options.documentEnvironment?.onReadOnly;
    return {
      ...this.options.documentEnvironment,
      referenceGrantAuthority: this.options.documentEnvironment?.referenceGrantAuthority ?? {
        authorizePath: (request) => this.permits.authorizesReference(request.grantId, request.path),
        validateFingerprint: (request) => this.permits.authorizesReference(request.grantId, request.path)
      },
      leaseRoot: path.join(this.options.appDataRoot, "leases"),
      recoveryRoot: path.join(this.options.appDataRoot, "recovery"),
      onReadOnly: (reason) => {
        configuredReadOnly?.(reason);
        queueMicrotask(() => this.publishReadOnly(reason));
      }
    };
  }

  private publishReadOnly(reason: ReadOnlyReason): void {
    const store = this.store;
    if (store === undefined || store.mode.kind !== "read-only" || store.mode.reason !== reason) return;
    const eventId = randomUUID();
    this.events.publish({
      kind: "event",
      id: eventId,
      correlationId: eventId,
      name: "document.stateChanged",
      documentId: store.documentId,
      occurredAt: new Date().toISOString(),
      payload: {
        state: "read-only",
        dirty: store.dirty,
        documentRevisionId: null,
        readOnlyReason: reason
      }
    });
  }

  resumeAfterReview(jobId: string): void {
    void this.requireScheduler().run(jobId);
  }

  private liveOutputGrant(pathGrantId: string): LiveOutputDirectoryGrant {
    const resolution = this.requirePathGrant(pathGrantId, "live-output");
    return {
      documentId: this.requireStore().documentId,
      grantId: pathGrantId,
      purpose: "live-output",
      root: resolution.path
    };
  }

  private async liveOutputItems(namingPolicy: "artifact" | "node" | "template") {
    const artifacts = await this.requireStore().read(({ artifacts }) => artifacts.list());
    return Promise.all(artifacts.map(async (artifact) => ({
      artifactId: artifact.id,
      byteLength: artifact.byteLength,
      collectionId: null,
      contentKey: artifact.contentKey,
      expectedHash: artifact.contentKey,
      relativePath: liveOutputName(artifact, namingPolicy),
      bytes: await this.readArtifactBytes(artifact.id)
    })));
  }

  private publishPermission(permit: ApplicationPermit, state: "granted" | "revoked" | "expired"): void {
    if (permit.permission === "path" || this.store === undefined) return;
    const id = randomUUID();
    this.events.publish(ApplicationEventSchema.parse({
      kind: "event",
      id,
      correlationId: id,
      name: "permission.changed",
      documentId: this.store.documentId,
      occurredAt: new Date().toISOString(),
      payload: { permitId: permit.id, permission: permit.permission, state }
    }));
  }

  async commitEditWorkspace(input: {
    commandId: string;
    graphId: string;
    nodeId: string;
    kind: "drawing" | "mask";
    channel: "text" | "image" | "mask" | "data" | "video" | "audio";
    mediaType: "image/svg+xml" | "image/png";
    width: number;
    height: number;
    byteLength: number;
    content: { encoding: "utf8" | "base64"; data: string };
    geometry?: import("@ether/schema").EditMaskGeometry;
    drawing?: import("@ether/schema").CanvasDrawingConfig;
    editState?: import("@ether/schema").EditWorkspaceState;
  }): Promise<{ outputVersion: NodeOutputVersion; artifact: Artifact }> {
    const store = this.requireWritableStore();
    const duplicate = await store.read(({ execution }) => execution.getCommandResult(input.commandId, "editWorkspace.commit"));
    if (duplicate !== undefined) return duplicate as { outputVersion: NodeOutputVersion; artifact: Artifact };
    const graph = await store.read(({ graphs }) => graphs.get(input.graphId));
    const node = graph?.nodes.find((candidate) => candidate.id === input.nodeId);
    if (node === undefined) throw new ApplicationServiceError("LOCAL_OUTPUT_NODE_NOT_FOUND", "The target graph node does not exist.");
    if (input.kind === "drawing" && node.config.kind !== "canvas.drawing") {
      throw new ApplicationServiceError("LOCAL_OUTPUT_KIND_MISMATCH", "Drawing output can only be published from a Drawing node.");
    }
    if (input.kind === "drawing" && (input.drawing === undefined || input.drawing.width !== input.width || input.drawing.height !== input.height)) {
      throw new ApplicationServiceError("LOCAL_OUTPUT_DRAWING_INVALID", "Drawing publication requires matching editable stroke geometry.");
    }
    if (input.kind === "mask" && node.config.kind !== "edit.image" && node.config.kind !== "edit.mask") {
      throw new ApplicationServiceError("LOCAL_OUTPUT_KIND_MISMATCH", "Mask output can only be published from an Image Edit or Mask node.");
    }
    if ((input.kind === "drawing" && input.channel !== "image") || (input.kind === "mask" && input.channel !== "mask")) {
      throw new ApplicationServiceError("LOCAL_OUTPUT_CHANNEL_MISMATCH", "The local output channel does not match its output kind.");
    }
    if (input.editState?.capability.mode === "unsupported") {
      throw new ApplicationServiceError("EDIT_CAPABILITY_UNSUPPORTED", input.editState.capability.detail ?? "The selected provider cannot perform image editing.");
    }
    if (node.config.kind === "edit.image" && input.editState !== undefined && (
      input.editState.capability.providerId !== node.config.providerId ||
      input.editState.capability.profileId !== node.config.profileId
    )) {
      throw new ApplicationServiceError("EDIT_CAPABILITY_MISMATCH", "The committed edit capability does not match the Image Edit node provider profile.");
    }
    const bytes = decodeLocalOutput(input.content, input.byteLength);
    if (!mediaSignatureMatches(bytes.subarray(0, 512), input.mediaType)) {
      throw new ApplicationServiceError("LOCAL_OUTPUT_MEDIA_MISMATCH", "Published bytes do not match the declared media type.");
    }
    if (input.mediaType === "image/svg+xml" && /<script\b|<foreignObject\b|\bon[a-z]+\s*=|(?:href|src)\s*=\s*["'](?:https?:|file:|data:)/i.test(bytes.toString("utf8"))) {
      throw new ApplicationServiceError("LOCAL_OUTPUT_SVG_UNSAFE", "SVG local outputs cannot contain scripts, event handlers, embedded data, or external resources.");
    }
    const image = await sharp(bytes, { failOn: "error" }).metadata().catch((error: unknown) => {
      throw new ApplicationServiceError("LOCAL_OUTPUT_IMAGE_INVALID", "The local image output could not be decoded.", { cause: error });
    });
    if (image.width !== input.width || image.height !== input.height) {
      throw new ApplicationServiceError("LOCAL_OUTPUT_SIZE_MISMATCH", "Published dimensions do not match the encoded image.");
    }
    const sourceArtifact = input.editState === undefined
      ? undefined
      : await store.read(({ artifacts }) => artifacts.get(input.editState!.sourceArtifactId));
    if (input.editState !== undefined && (sourceArtifact === undefined || !sourceArtifact.mediaType.startsWith("image/"))) {
      throw new ApplicationServiceError("EDIT_SOURCE_INVALID", "The edit source must be an existing image artifact.");
    }
    const outputVersionId = stableApplicationId("local-output", store.documentId, input.commandId);
    const payloadId = stableApplicationId("local-payload", store.documentId, input.commandId);
    const artifactId = stableApplicationId("local-artifact", store.documentId, input.commandId);
    const at = new Date().toISOString();
    const head = await store.read(({ revisions }) => revisions.head());
    const graphRevisionId = head.graphRevisions[input.graphId];
    if (graphRevisionId === undefined) throw new ApplicationServiceError("LOCAL_OUTPUT_GRAPH_STALE", "The target graph has no current revision.");
    const provenance = {
      localPublication: true,
      actor: "user",
      outputKind: input.kind,
      width: input.width,
      height: input.height,
      geometry: input.geometry ?? null,
      drawing: input.drawing ?? null,
      editWorkspace: input.editState ?? null,
      editCapabilityMode: input.editState?.capability.mode ?? null,
      maskSemantics: input.editState?.capability.mode === "guidance-only" ? "guidance-only-not-pixel-exact" : "native-or-not-applicable"
    } as const;
    const outputVersion: NodeOutputVersion = {
      id: outputVersionId,
      nodeId: input.nodeId,
      graphId: input.graphId,
      graphRevisionId,
      inputPayloadIds: sourceArtifact ? [sourceArtifact.source.payloadId] : [],
      selectedOutputVersionIds: sourceArtifact ? [sourceArtifact.source.outputVersionId] : [],
      compiledContextHash: createHash("sha256").update(JSON.stringify(provenance)).digest("hex"),
      producer: { kind: "local", executor: input.kind === "drawing" ? "drawing" : "mask" },
      outputPayloadIds: [payloadId],
      parentOutputVersionId: null,
      approval: { state: "unreviewed" },
      runId: null, stepId: null, workItemId: null, attemptId: null,
      timing: { startedAt: at, completedAt: at },
      failure: null,
      createdAt: at
    };
    const payload: PayloadEnvelope = {
      id: payloadId,
      channel: input.channel,
      role: "general",
      content: { kind: "artifact", artifactId },
      source: { nodeId: input.nodeId, outputVersionId, lineageKey: `${input.graphId}:${input.nodeId}:${input.commandId}` },
      metadata: provenance
    };
    const temporaryRoot = path.join(this.options.appDataRoot, "local-output-ingress");
    await mkdir(temporaryRoot, { recursive: true });
    const temporaryPath = path.join(temporaryRoot, `${artifactId}.incoming`);
    const thumbnailBytes = await createEmbeddedThumbnail(bytes);
    const thumbnailTemporaryPath = path.join(temporaryRoot, `${artifactId}.thumbnail.webp.incoming`);
    try {
      await writeFile(temporaryPath, bytes, { flag: "wx" }).catch(async (error: NodeJS.ErrnoException) => {
        if (error.code !== "EEXIST") throw error;
        const existing = await readFile(temporaryPath);
        if (!existing.equals(bytes)) throw new ApplicationServiceError("LOCAL_OUTPUT_INGRESS_CONFLICT", "A conflicting local output ingress file already exists.");
      });
      await writeFile(thumbnailTemporaryPath, thumbnailBytes, { flag: "wx" }).catch(async (error: NodeJS.ErrnoException) => {
        if (error.code !== "EEXIST") throw error;
        const existing = await readFile(thumbnailTemporaryPath);
        if (!existing.equals(thumbnailBytes)) {
          throw new ApplicationServiceError(
            "LOCAL_OUTPUT_INGRESS_CONFLICT",
            "A conflicting local output thumbnail ingress file already exists."
          );
        }
      });
      const importedContentKeys: string[] = [];
      try {
        const blob = await importBlob(
          store,
          { sourcePath: temporaryPath, mediaType: input.mediaType },
          { appDataRoot: this.options.appDataRoot }
        );
        importedContentKeys.push(blob.contentKey);
        const thumbnailBlob = await importBlob(
          store,
          { sourcePath: thumbnailTemporaryPath, mediaType: "image/webp" },
          { appDataRoot: this.options.appDataRoot }
        );
        importedContentKeys.push(thumbnailBlob.contentKey);
        const artifact: Artifact = {
          id: artifactId,
          contentKey: blob.contentKey,
          channel: input.channel,
          mediaType: input.mediaType,
          byteLength: bytes.byteLength,
          source: { outputVersionId, payloadId },
          createdAt: at,
          metadata: {
            ...provenance,
            thumbnailByteLength: thumbnailBlob.byteLength,
            thumbnailContentKey: thumbnailBlob.contentKey,
            thumbnailMediaType: thumbnailBlob.mediaType
          }
        };
        return await store.transaction(({ artifacts, execution, outputs }) => {
          const raced = execution.getCommandResult(input.commandId, "editWorkspace.commit");
          if (raced !== undefined) return raced as { outputVersion: NodeOutputVersion; artifact: Artifact };
          outputs.insert(outputVersion, [payload]);
          artifacts.attach(artifact);
          if (sourceArtifact !== undefined) artifacts.addLineage({
            artifactId, parentArtifactId: sourceArtifact.id, relation: "edited-from",
            sourceOutputVersionId: outputVersionId,
            metadata: { role: "general", editCapabilityMode: input.editState?.capability.mode ?? "unknown" }
          });
          return execution.completeCommand(input.commandId, "editWorkspace.commit", { outputVersion, artifact }, [
            { name: "output.created", payload: { outputVersionId, parentOutputVersionId: null } },
            { name: "artifact.changed", payload: { artifactId, change: "created" } }
          ]) as { outputVersion: NodeOutputVersion; artifact: Artifact };
        });
      } catch (error) {
        try {
          await store.reclaimUnreferencedReadyBlobs(importedContentKeys);
        } catch (cleanupError) {
          throw new AggregateError(
            [error, cleanupError],
            "Local output publication failed and its unreferenced imported blobs could not be reclaimed.",
            { cause: cleanupError }
          );
        }
        throw error;
      }
    } finally {
      await unlink(temporaryPath).catch(() => undefined);
      await unlink(thumbnailTemporaryPath).catch(() => undefined);
    }
  }

  private publishReferenceChanged(
    referenceId: string,
    state: "linked" | "embedded" | "missing" | "relinking" | "removed"
  ): void {
    if (this.store === undefined) return;
    const id = randomUUID();
    this.events.publish(ApplicationEventSchema.parse({
      kind: "event",
      id,
      correlationId: id,
      name: "reference.changed",
      documentId: this.store.documentId,
      occurredAt: new Date().toISOString(),
      payload: { referenceId, state }
    }));
  }

  private publishReferenceSetMembershipChanged(
    nodeId: string,
    members: readonly import("@ether/schema").ReferenceSetMember[],
    mode: "assign" | "replace"
  ): void {
    if (this.store === undefined) return;
    const id = randomUUID();
    this.events.publish(ApplicationEventSchema.parse({
      kind: "event",
      id,
      correlationId: id,
      name: "reference.setMembershipChanged",
      documentId: this.store.documentId,
      occurredAt: new Date().toISOString(),
      payload: { nodeId, members, mode }
    }));
  }
}

async function planningCapabilities(
  graph: EtherGraph,
  provider: GenerationProvider,
  configured: readonly ProviderCapability[] = [],
  scope: ExecutionScope = { kind: "graph" }
): Promise<{ all: ProviderCapability[]; primary: ProviderCapability }> {
  const runtimeParallelism = new Map<string, number>();
  try {
    const diagnostic = await provider.diagnose();
    for (const profile of diagnostic.profiles ?? []) {
      const maxParallelism = profile.maxParallelism;
      if (maxParallelism !== undefined && Number.isSafeInteger(maxParallelism) && maxParallelism > 0) {
        runtimeParallelism.set(`${profile.providerId}\u0000${profile.profileId}`, maxParallelism);
      }
    }
  } catch {
    // A provider diagnostic is advisory; planning remains available without a cap.
  }
  const discovered = graph.nodes.flatMap((node): ProviderCapability[] => {
    if (node.config.kind !== "generation.image" || node.config.providerId !== provider.descriptor.id) return [];
    return [{
      providerId: provider.descriptor.id,
      profileId: node.config.profileId,
      operation: "generate-image",
      inputChannels: ["text", "image", "data"],
      outputChannels: ["image"],
      aspectRatios: [node.config.aspectRatio],
      resolutions: [{
        id: `${node.config.resolution.width}x${node.config.resolution.height}`,
        width: node.config.resolution.width,
        height: node.config.resolution.height,
        label: `${node.config.resolution.width} x ${node.config.resolution.height}`
      }],
      maxReferences: 16,
      maxOutputsPerCall: node.config.outputCount,
      supportsCancellation: true,
      supportsSeed: false,
      provenance: "static-constraint",
      limitations: []
    }];
  });
  const local: ProviderCapability = {
    providerId: "ether-local",
    profileId: "local-deterministic",
    operation: "llm",
    inputChannels: ["text", "image", "mask", "data", "video", "audio"],
    outputChannels: ["text", "image", "mask", "data", "video", "audio"],
    aspectRatios: [],
    resolutions: [],
    maxReferences: 0,
    maxOutputsPerCall: 1,
    supportsCancellation: true,
    supportsSeed: false,
    provenance: "static-constraint",
    limitations: ["Local execution capability; no external provider call."]
  };
  const all = uniqueCapabilities([...discovered, ...configured, local].map((capability) => {
    const runtimeCap = runtimeParallelism.get(`${capability.providerId}\u0000${capability.profileId}`);
    if (runtimeCap === undefined) return capability;
    return {
      ...capability,
      maxParallelism: capability.maxParallelism === undefined
        ? runtimeCap
        : Math.min(capability.maxParallelism, runtimeCap)
    };
  }));
  const scopedNodeIds = new Set(
    scope.kind === "recipe"
      ? graph.nodes.map((node) => node.id)
      : resolveScope(graph, scope)
  );
  const needsReasoning = graph.nodes.some((node) =>
    scopedNodeIds.has(node.id) &&
    (node.config.kind === "prompt.worker" || node.config.kind === "review.evaluate")
  );
  const reasoning = all.find((capability) => capability.operation === "llm" || capability.operation === "interpret");
  if (needsReasoning && (reasoning === undefined || reasoning.providerId === "ether-local")) {
    throw new ApplicationServiceError(
      "PROVIDER_CAPABILITY_UNAVAILABLE",
      "This graph requires an injected Worker or evaluation provider capability."
    );
  }
  const primary = needsReasoning
    ? reasoning!
    : all.find((capability) => capability.providerId !== "ether-local") ?? local;
  return { all, primary };
}

function uniqueCapabilities(input: readonly ProviderCapability[]): ProviderCapability[] {
  const byIdentity = new Map<string, ProviderCapability>();
  for (const capability of input) {
    byIdentity.set(`${capability.providerId}:${capability.profileId}:${capability.operation}`, capability);
  }
  return [...byIdentity.values()];
}

function mediaTypeForPath(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case ".png": return "image/png";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".webp": return "image/webp";
    case ".mp4": return "video/mp4";
    case ".wav": return "audio/wav";
    case ".mp3": return "audio/mpeg";
    default: return "application/octet-stream";
  }
}

type ReferenceInputBindingBase = {
  id: string;
  edgeId: string;
  sourceNodeId: string;
  payloadId: string;
  channel: PayloadEnvelope["channel"];
  role: PayloadEnvelope["role"];
  order: number;
  displayName: string;
  mediaType: string;
};

type ReferenceInputBinding =
  | (ReferenceInputBindingBase & {
    memberKind: "linked-reference";
    referenceId: string;
    originalPath: string;
    pathGrantId: string;
    identity: NonNullable<LinkedReference["identity"]>;
    fingerprint: LinkedReference["fingerprint"];
  })
  | (ReferenceInputBindingBase & {
    memberKind: "embedded-reference";
    referenceId: string;
    contentKey: string;
    byteLength: number;
  })
  | (ReferenceInputBindingBase & {
    memberKind: "embedded-artifact";
    artifactId: string;
    contentKey: string;
    byteLength: number;
  });

function referenceInputBindings(
  graph: EtherGraph,
  getReference: (referenceId: string) => LinkedReference | undefined,
  getArtifact: (artifactId: string) => Artifact | undefined,
  getBlob: (contentKey: string) => { byteLength: number; mediaType: string } | undefined,
  planId: string
): ReferenceInputBinding[] {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const bindings: ReferenceInputBinding[] = [];
  const edges = graph.edges
    .filter((edge) => edge.enabled && edge.from.kind === "node" && edge.to.kind === "node")
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
  for (const edge of edges) {
    if (edge.from.kind !== "node" || edge.to.kind !== "node") continue;
    const source = nodes.get(edge.from.nodeId);
    if (source === undefined || source.config.kind !== "reference.set") continue;
    const config = source.config;
    if (!config.enabledChannels.includes(edge.from.channel)) continue;
    const candidates: Array<{
      manualOrder: number;
      createdAt: string;
      displayName: string;
      binding: ReferenceInputBinding;
    }> = [];
    for (const [manualOrder, member] of referenceSetMembers(config).entries()) {
      if (!member.enabled) continue;
      if (member.kind === "linked-reference") {
        const reference = getReference(member.referenceId);
        if (reference === undefined) {
          throw new ApplicationServiceError(
            "REFERENCE_SOURCE_UNAVAILABLE",
            `Enabled Reference Set member ${member.referenceId} is not an authorized linked source.`
          );
        }
        const channel = channelForReferenceMediaType(reference.mediaType);
        if (channel !== edge.from.channel) continue;
        if (reference.state === "embedded") {
          const contentKey = reference.contentKey;
          const blob = contentKey === null ? undefined : getBlob(contentKey);
          if (contentKey === null || blob === undefined || blob.mediaType !== reference.mediaType) {
            throw new ApplicationServiceError(
              "REFERENCE_SOURCE_UNAVAILABLE",
              `Embedded Reference Set member ${member.referenceId} has no durable source content.`
            );
          }
          candidates.push({
            manualOrder,
            createdAt: reference.createdAt,
            displayName: reference.displayName,
            binding: {
              id: referenceBindingId(planId, edge.id, `embedded-reference:${reference.id}:${contentKey}`),
              edgeId: edge.id,
              sourceNodeId: source.id,
              payloadId: referencePayloadId(planId, edge.id, `embedded-reference:${reference.id}:${contentKey}`),
              channel,
              role: member.roleOverride ?? edge.role,
              order: 0,
              displayName: reference.displayName,
              mediaType: reference.mediaType,
              memberKind: "embedded-reference",
              referenceId: reference.id,
              contentKey,
              byteLength: blob.byteLength
            }
          });
          continue;
        }
        if (reference.state !== "linked" || reference.originalPath === null || reference.pathGrantId === null || reference.identity === null) {
          throw new ApplicationServiceError(
            "REFERENCE_SOURCE_UNAVAILABLE",
            `Enabled Reference Set member ${member.referenceId} is not an authorized linked source.`
          );
        }
        candidates.push({
          manualOrder,
          createdAt: reference.createdAt,
          displayName: reference.displayName,
          binding: {
            id: referenceBindingId(planId, edge.id, linkedReferenceSnapshotId(reference)),
            edgeId: edge.id,
            sourceNodeId: source.id,
            payloadId: referencePayloadId(planId, edge.id, linkedReferenceSnapshotId(reference)),
            channel,
            role: member.roleOverride ?? edge.role,
            order: 0,
            displayName: reference.displayName,
            mediaType: reference.mediaType,
            memberKind: "linked-reference",
            referenceId: reference.id,
            originalPath: reference.originalPath,
            pathGrantId: reference.pathGrantId,
            identity: reference.identity,
            fingerprint: reference.fingerprint
          }
        });
        continue;
      }
      const artifact = getArtifact(member.artifactId);
      if (artifact === undefined) {
        throw new ApplicationServiceError("REFERENCE_MEMBER_NOT_FOUND", `Reference artifact ${member.artifactId} does not exist.`);
      }
      if (artifact.channel !== edge.from.channel) continue;
      const displayName = typeof artifact.metadata.title === "string" ? artifact.metadata.title : artifact.id;
      candidates.push({
        manualOrder,
        createdAt: artifact.createdAt,
        displayName,
        binding: {
          id: referenceBindingId(planId, edge.id, `embedded-artifact:${artifact.id}:${artifact.contentKey}`),
          edgeId: edge.id,
          sourceNodeId: source.id,
          payloadId: referencePayloadId(planId, edge.id, `embedded-artifact:${artifact.id}:${artifact.contentKey}`),
          channel: artifact.channel,
          role: member.roleOverride ?? edge.role,
          order: 0,
          displayName,
          mediaType: artifact.mediaType,
          memberKind: "embedded-artifact",
          artifactId: artifact.id,
          contentKey: artifact.contentKey,
          byteLength: artifact.byteLength
        }
      });
    }
    candidates.sort((left, right) => referenceMemberOrder(config.ordering, left, right));
    for (const candidate of candidates) {
      bindings.push({ ...candidate.binding, order: bindings.length });
    }
  }
  return bindings;
}

function channelForReferenceMediaType(mediaType: string): ReferenceInputBinding["channel"] | null {
  if (mediaType.startsWith("image/")) return "image";
  if (mediaType.startsWith("video/")) return "video";
  if (mediaType.startsWith("audio/")) return "audio";
  if (mediaType.startsWith("text/")) return "text";
  if (mediaType === "application/json") return "data";
  return null;
}

function referenceMemberOrder(
  ordering: "manual" | "created" | "name",
  left: { manualOrder: number; createdAt: string; displayName: string },
  right: { manualOrder: number; createdAt: string; displayName: string }
): number {
  if (ordering === "manual") return left.manualOrder - right.manualOrder;
  if (ordering === "created") return left.createdAt.localeCompare(right.createdAt) || left.manualOrder - right.manualOrder;
  return left.displayName.localeCompare(right.displayName) || left.manualOrder - right.manualOrder;
}

function linkedReferenceSnapshotId(reference: LinkedReference): string {
  return [
    "linked-reference",
    reference.id,
    reference.fingerprint.sampleSha256,
    reference.fingerprint.byteLength,
    reference.fingerprint.modifiedAt
  ].join(":");
}

function referenceBindingId(planId: string, edgeId: string, sourceId: string): string {
  return `reference-binding-${createHash("sha256").update(`${planId}\u0000${edgeId}\u0000${sourceId}`).digest("hex").slice(0, 24)}`;
}

function referencePayloadId(planId: string, edgeId: string, sourceId: string): string {
  return `reference-payload-${createHash("sha256").update(`${planId}\u0000${edgeId}\u0000${sourceId}`).digest("hex").slice(0, 24)}`;
}

function liveOutputTemplate(policy: "artifact" | "node" | "template"): string {
  if (policy === "artifact") return "{artifact}";
  if (policy === "node") return "{node}-{artifact}";
  return "{node}-{version}";
}

function liveOutputName(
  artifact: Artifact,
  policy: "artifact" | "node" | "template"
): string {
  const extension = extensionForMediaType(artifact.mediaType);
  const node = typeof artifact.metadata.nodeId === "string" ? artifact.metadata.nodeId : "output";
  const base = policy === "artifact"
    ? artifact.id
    : policy === "node" ? `${node}-${artifact.id}` : `${node}-${artifact.source.outputVersionId}`;
  return `${safeFileName(base)}${extension}`;
}

function extensionForMediaType(mediaType: string): string {
  if (mediaType === "image/png") return ".png";
  if (mediaType === "image/jpeg") return ".jpg";
  if (mediaType === "image/webp") return ".webp";
  if (mediaType === "video/mp4") return ".mp4";
  if (mediaType === "audio/wav") return ".wav";
  if (mediaType === "audio/mpeg") return ".mp3";
  return ".bin";
}

function safeFileName(value: string): string {
  const safe = [...value]
    .map((character) => character.charCodeAt(0) < 32 || /[<>:"/\\|?*]/.test(character) ? "-" : character)
    .join("")
    .replace(/[. ]+$/g, "")
    .trim();
  return safe.length === 0 ? "artifact" : safe.slice(0, 180);
}

function exportName(
  template: string,
  artifact: Artifact,
  format: "original" | "png" | "jpeg" | "webp" = "original"
): string {
  const expanded = template
    .replaceAll("{artifact}", artifact.id)
    .replaceAll("{id}", artifact.id)
    .replaceAll("{version}", artifact.source.outputVersionId);
  const extension = format === "original" ? extensionForMediaType(artifact.mediaType) : exportFormatExtension(format);
  return `${safeFileName(expanded)}${extension}`;
}

function exportFormat(value: unknown): "original" | "png" | "jpeg" | "webp" {
  return value === "png" || value === "jpeg" || value === "webp" ? value : "original";
}

function decodeLocalOutput(
  content: { encoding: "utf8" | "base64"; data: string },
  declaredByteLength: number
): Buffer {
  let bytes: Buffer;
  if (content.encoding === "utf8") {
    bytes = Buffer.from(content.data, "utf8");
  } else {
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(content.data)) {
      throw new ApplicationServiceError("LOCAL_OUTPUT_BASE64_INVALID", "The local output contains invalid Base64 data.");
    }
    bytes = Buffer.from(content.data, "base64");
  }
  if (bytes.byteLength !== declaredByteLength) {
    throw new ApplicationServiceError("LOCAL_OUTPUT_LENGTH_MISMATCH", "Decoded local output length does not match its declaration.");
  }
  if (bytes.byteLength === 0 || bytes.byteLength > 16 * 1024 * 1024) {
    throw new ApplicationServiceError("LOCAL_OUTPUT_TOO_LARGE", "Local outputs must be between 1 byte and 16 MiB.");
  }
  return bytes;
}

function exportFormatExtension(format: "png" | "jpeg" | "webp"): string {
  return format === "jpeg" ? ".jpg" : `.${format}`;
}

export async function transcodeArtifactForExport(
  source: Uint8Array,
  mediaType: string,
  format: "original" | "png" | "jpeg" | "webp"
): Promise<Buffer> {
  if (format === "original") return Buffer.from(source);
  if (!mediaType.startsWith("image/")) {
    throw new ApplicationServiceError(
      "EXPORT_FORMAT_NOT_IMAGE",
      `Cannot convert ${mediaType} to ${format.toUpperCase()}; converted formats require an image artifact.`
    );
  }
  try {
    const pipeline = sharp(source, { failOn: "error" }).rotate();
    if (format === "png") return await pipeline.png({ compressionLevel: 9 }).toBuffer();
    if (format === "jpeg") return await pipeline.jpeg({ quality: 90, mozjpeg: true }).toBuffer();
    return await pipeline.webp({ quality: 90 }).toBuffer();
  } catch (error) {
    throw new ApplicationServiceError(
      "EXPORT_IMAGE_DECODE_FAILED",
      `The image could not be decoded for ${format.toUpperCase()} export.`,
      { cause: error instanceof Error ? error.message : String(error) }
    );
  }
}

async function createEmbeddedThumbnail(source: Uint8Array): Promise<Buffer> {
  try {
    return await sharp(source, { failOn: "error" })
      .rotate()
      .resize({ width: 320, height: 320, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 76, effort: 4 })
      .toBuffer();
  } catch (error) {
    throw new ApplicationServiceError(
      "ARTIFACT_THUMBNAIL_CREATE_FAILED",
      "The image could not produce a safe embedded thumbnail.",
      { cause: error }
    );
  }
}

function thumbnailDescriptor(
  artifact: Artifact
): { byteLength: number; contentKey: string; mediaType: string } | null {
  const thumbnail = readArtifactThumbnailMetadata(artifact.metadata);
  if (thumbnail === null) return null;
  return {
    byteLength: thumbnail.thumbnailByteLength,
    contentKey: thumbnail.thumbnailContentKey.toLowerCase(),
    mediaType: thumbnail.thumbnailMediaType
  };
}

function stableApplicationId(prefix: string, ...parts: string[]): string {
  return `${prefix}-${createHash("sha256").update(parts.join("\0")).digest("hex").slice(0, 32)}`;
}

function samePath(left: string, right: string): boolean {
  const normalizedLeft = path.resolve(left);
  const normalizedRight = path.resolve(right);
  return process.platform === "win32"
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

interface ExportBundleArtifactDetail {
  artifact: unknown;
  evaluation: unknown;
  lineage: unknown;
  ratings: unknown;
  tags: unknown;
}

interface ExportBundleOutput {
  bytes: Buffer;
  hash: string;
  kind: "lineage" | "main" | "metadata";
  relativePath: string;
}

type ExportBundleCollision = "different" | "matching" | "missing";

interface DurableExportBundleManifest {
  documentId: string;
  exportId: string;
  outputs: Array<{
    byteLength: number;
    hash: string;
    kind: ExportBundleOutput["kind"];
    relativePath: string;
    sourceName: string;
    status: "pending" | "satisfied";
  }>;
  root: string;
  version: 1;
}

interface PreparedDurableExportBundle {
  manifest: DurableExportBundleManifest;
  manifestPath: string;
  root: string;
  sourcePaths: string[];
}

function exportBundleOutputs(
  relativePath: string,
  mainBytes: Uint8Array,
  detail: ExportBundleArtifactDetail | undefined,
  record: ExportRecord
): ExportBundleOutput[] {
  const outputs: Array<{ bytes: Buffer; kind: ExportBundleOutput["kind"]; relativePath: string }> = [{
    bytes: Buffer.from(mainBytes),
    kind: "main",
    relativePath
  }];
  if (record.options?.includeMetadataSidecar === true && detail !== undefined) {
    outputs.push({
      bytes: Buffer.from(JSON.stringify({
        artifact: detail.artifact,
        tags: detail.tags,
        ratings: detail.ratings,
        evaluation: detail.evaluation
      }, null, 2), "utf8"),
      kind: "metadata",
      relativePath: `${relativePath}.metadata.json`
    });
  }
  if (record.options?.includeLineageReport === true && detail !== undefined) {
    outputs.push({
      bytes: Buffer.from(JSON.stringify({
        artifactId: record.artifactId,
        lineage: detail.lineage
      }, null, 2), "utf8"),
      kind: "lineage",
      relativePath: `${relativePath}.lineage.json`
    });
  }
  return outputs.map((output) => ({
    ...output,
    hash: createHash("sha256").update(output.bytes).digest("hex")
  }));
}

async function prepareExportBundleParents(
  root: string,
  outputs: readonly ExportBundleOutput[]
): Promise<void> {
  for (const output of outputs) {
    await prepareExportDestinationParent(root, containedPath(root, output.relativePath));
  }
}

async function inspectExportBundle(
  root: string,
  outputs: readonly ExportBundleOutput[]
): Promise<ExportBundleCollision[]> {
  return Promise.all(outputs.map(async (output) => {
    const occupied = await authorizedExportFileHash(root, containedPath(root, output.relativePath));
    if (occupied === null) return "missing";
    return occupied === output.hash ? "matching" : "different";
  }));
}

async function availableExportBundlePath(
  root: string,
  relativePath: string,
  mainBytes: Uint8Array,
  detail: ExportBundleArtifactDetail | undefined,
  record: ExportRecord
): Promise<{
  collisions: ExportBundleCollision[];
  outputs: ExportBundleOutput[];
  relativePath: string;
}> {
  const extension = path.extname(relativePath);
  const stem = relativePath.slice(0, relativePath.length - extension.length);
  for (let index = 2; index <= 10_000; index += 1) {
    const candidate = `${stem}-${index}${extension}`;
    const outputs = exportBundleOutputs(candidate, mainBytes, detail, record);
    await prepareExportBundleParents(root, outputs);
    const collisions = await inspectExportBundle(root, outputs);
    if (collisions.every((entry) => entry !== "different")) {
      return { collisions, outputs, relativePath: candidate };
    }
  }
  throw new ApplicationServiceError(
    "EXPORT_COLLISION_EXHAUSTED",
    `No collision-free export bundle name is available for ${relativePath}.`
  );
}

async function writeDurableExportFile(filePath: string, bytes: Uint8Array): Promise<void> {
  const expectedHash = createHash("sha256").update(bytes).digest("hex");
  if (await authorizedOwnedFileMatches(filePath, expectedHash, bytes.byteLength)) return;
  await unlink(filePath).catch((error: { code?: unknown }) => {
    if (error.code !== "ENOENT") throw error;
  });
  const temporary = `${filePath}.${randomUUID()}.incoming`;
  const descriptor = await open(temporary, "wx", 0o600);
  try {
    await descriptor.writeFile(bytes);
    await descriptor.sync();
  } finally {
    await descriptor.close();
  }
  await rename(temporary, filePath);
}

async function authorizedOwnedFileMatches(
  filePath: string,
  expectedHash: string,
  expectedByteLength: number
): Promise<boolean> {
  try {
    const info = await lstat(filePath);
    if (!info.isFile() || info.isSymbolicLink() || info.size !== expectedByteLength) return false;
    return createHash("sha256").update(await readFile(filePath)).digest("hex") === expectedHash;
  } catch (error) {
    if ((error as { code?: unknown }).code === "ENOENT") return false;
    throw error;
  }
}

async function writeDurableExportManifest(
  manifestPath: string,
  manifest: DurableExportBundleManifest
): Promise<void> {
  const temporary = `${manifestPath}.${randomUUID()}.next`;
  const descriptor = await open(temporary, "wx", 0o600);
  try {
    await descriptor.writeFile(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    await descriptor.sync();
  } finally {
    await descriptor.close();
  }
  await rename(temporary, manifestPath);
}

async function prepareDurableExportBundle(
  appDataRoot: string,
  documentId: string,
  exportId: string,
  root: string,
  outputs: readonly ExportBundleOutput[],
  collisions: readonly ExportBundleCollision[]
): Promise<PreparedDurableExportBundle> {
  const materializationId = stableExportPublicationId(documentId, exportId);
  const ownedRoot = path.resolve(appDataRoot, "export-materializations");
  const bundleRoot = path.resolve(ownedRoot, materializationId);
  const relative = path.relative(ownedRoot, bundleRoot);
  if (relative.length === 0 || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new ApplicationServiceError("EXPORT_MANIFEST_INVALID", "The durable export bundle escaped app data.");
  }
  await mkdir(bundleRoot, { recursive: true });
  const sourcePaths: string[] = [];
  const manifest: DurableExportBundleManifest = {
    documentId,
    exportId,
    outputs: outputs.map((output, index) => {
      const sourceName = `output-${index}-${output.kind}.bin`;
      sourcePaths.push(path.join(bundleRoot, sourceName));
      return {
        byteLength: output.bytes.byteLength,
        hash: output.hash,
        kind: output.kind,
        relativePath: output.relativePath,
        sourceName,
        status: collisions[index] === "matching" ? "satisfied" : "pending"
      };
    }),
    root: path.resolve(root),
    version: 1
  };
  for (const [index, output] of outputs.entries()) {
    await writeDurableExportFile(sourcePaths[index]!, output.bytes);
  }
  const manifestPath = path.join(bundleRoot, "manifest.json");
  await writeDurableExportManifest(manifestPath, manifest);
  return { manifest, manifestPath, root: bundleRoot, sourcePaths };
}

async function markDurableExportOutputSatisfied(
  bundle: PreparedDurableExportBundle,
  index: number
): Promise<void> {
  bundle.manifest.outputs[index]!.status = "satisfied";
  await writeDurableExportManifest(bundle.manifestPath, bundle.manifest);
}

export async function prepareExportDestinationParent(
  root: string,
  destination: string
): Promise<void> {
  await captureExportParentChain(root, destination, true);
}

interface ExportPathIdentity {
  birthtimeNs: string;
  canonicalPath: string;
  dev: string;
  ino: string;
}

function exportPathIdentity(
  canonicalPath: string,
  info: { birthtimeNs: bigint; dev: bigint; ino: bigint }
): ExportPathIdentity {
  return {
    birthtimeNs: info.birthtimeNs.toString(),
    canonicalPath: process.platform === "win32" ? canonicalPath.toLowerCase() : canonicalPath,
    dev: info.dev.toString(),
    ino: info.ino.toString()
  };
}

function sameExportPathIdentity(left: ExportPathIdentity, right: ExportPathIdentity): boolean {
  return left.birthtimeNs === right.birthtimeNs &&
    left.canonicalPath === right.canonicalPath &&
    left.dev === right.dev &&
    left.ino === right.ino;
}

function sameExportFileIdentity(
  left: { birthtimeNs: bigint; dev: bigint; ino: bigint },
  right: { birthtimeNs: bigint; dev: bigint; ino: bigint }
): boolean {
  return left.birthtimeNs === right.birthtimeNs &&
    left.dev === right.dev &&
    left.ino === right.ino;
}

function sameExportParentChain(
  left: readonly ExportPathIdentity[],
  right: readonly ExportPathIdentity[]
): boolean {
  return left.length === right.length &&
    left.every((identity, index) => sameExportPathIdentity(identity, right[index]!));
}

async function captureExportParentChain(
  root: string,
  destination: string,
  createMissing: boolean
): Promise<ExportPathIdentity[]> {
  const resolvedRoot = path.resolve(root);
  const resolvedDestination = path.resolve(destination);
  const relativeDestination = path.relative(resolvedRoot, resolvedDestination);
  if (
    relativeDestination.length === 0 ||
    relativeDestination === ".." ||
    relativeDestination.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeDestination)
  ) {
    throw new ApplicationServiceError("PATH_ESCAPE", "The export destination escaped its granted root.");
  }
  const parent = path.dirname(resolvedDestination);
  const relativeParent = path.relative(resolvedRoot, parent);
  const identities: ExportPathIdentity[] = [];
  let current = resolvedRoot;
  const parents = [resolvedRoot, ...relativeParent.split(path.sep).filter(Boolean).map((segment) => {
    current = path.join(current, segment);
    return current;
  })];
  for (const [index, directory] of parents.entries()) {
    if (createMissing && index > 0) {
      try {
        await mkdir(directory);
      } catch (error) {
        if ((error as { code?: unknown }).code !== "EEXIST") throw error;
      }
    }
    const before = await lstat(directory, { bigint: true });
    if (!before.isDirectory() || before.isSymbolicLink()) {
      throw new ApplicationServiceError(
        index === 0 ? "PATH_GRANT_KIND_MISMATCH" : "PATH_ESCAPE",
        index === 0
          ? "The export grant root must remain a real directory."
          : "Export destination parents cannot contain symbolic links or junctions."
      );
    }
    const canonical = await realpath(directory);
    const normalizedCanonical = process.platform === "win32" ? canonical.toLowerCase() : canonical;
    const canonicalInfo = await lstat(canonical, { bigint: true });
    if (
      !canonicalInfo.isDirectory() ||
      canonicalInfo.isSymbolicLink() ||
      (index === 0 && !samePath(canonical, resolvedRoot) && !sameExportFileIdentity(before, canonicalInfo))
    ) {
      throw new ApplicationServiceError(
        "PATH_ESCAPE",
        "The export root cannot be a symbolic link or junction."
      );
    }
    const canonicalRoot = identities[0]?.canonicalPath ?? normalizedCanonical;
    const relative = path.relative(canonicalRoot, normalizedCanonical);
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new ApplicationServiceError(
        "PATH_ESCAPE",
        "The export destination parent escaped its granted root."
      );
    }
    const after = await lstat(directory, { bigint: true });
    const beforeIdentity = exportPathIdentity(normalizedCanonical, before);
    const afterIdentity = exportPathIdentity(normalizedCanonical, after);
    if (
      !after.isDirectory() ||
      after.isSymbolicLink() ||
      !sameExportPathIdentity(beforeIdentity, afterIdentity)
    ) {
      throw new ApplicationServiceError("PATH_GRANT_CHANGED", "An export destination parent changed during validation.");
    }
    identities.push(afterIdentity);
  }
  return identities;
}

function containedPath(root: string, relativePath: string): string {
  const candidate = path.resolve(root, relativePath);
  const relative = path.relative(path.resolve(root), candidate);
  if (relative.length === 0 || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new ApplicationServiceError("PATH_ESCAPE", "The export path escapes its granted directory.");
  }
  return candidate;
}

async function authorizedExportFileHash(root: string, filePath: string): Promise<string | null> {
  const beforeOpen = await captureExportParentChain(root, filePath, true);
  let descriptor: Awaited<ReturnType<typeof open>> | undefined;
  try {
    descriptor = await open(filePath, "r");
    const opened = await descriptor.stat({ bigint: true });
    const current = await lstat(filePath, { bigint: true });
    if (!opened.isFile() || !current.isFile() || current.isSymbolicLink()) return "occupied";
    const openedIdentity = exportPathIdentity(path.resolve(filePath), opened);
    const currentIdentity = exportPathIdentity(path.resolve(filePath), current);
    if (
      openedIdentity.birthtimeNs !== currentIdentity.birthtimeNs ||
      openedIdentity.dev !== currentIdentity.dev ||
      openedIdentity.ino !== currentIdentity.ino
    ) {
      throw new ApplicationServiceError("PATH_GRANT_CHANGED", "The export collision target changed while it was opened.");
    }
    const afterOpen = await captureExportParentChain(root, filePath, false);
    if (!sameExportParentChain(beforeOpen, afterOpen)) {
      throw new ApplicationServiceError("PATH_GRANT_CHANGED", "An export destination parent changed during collision inspection.");
    }
    const bytes = await descriptor.readFile();
    const afterRead = await captureExportParentChain(root, filePath, false);
    if (!sameExportParentChain(beforeOpen, afterRead)) {
      throw new ApplicationServiceError("PATH_GRANT_CHANGED", "An export destination parent changed during collision inspection.");
    }
    return createHash("sha256").update(bytes).digest("hex");
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: unknown }).code)
      : "";
    if (code === "ENOENT") return null;
    throw error;
  } finally {
    await descriptor?.close();
  }
}


function isExpectedReferenceUnavailable(error: unknown): boolean {
  const code = typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : "";
  return new Set([
    "EACCES",
    "ENOENT",
    "EPERM",
    "MIME_MISMATCH",
    "REFERENCE_CHANGED",
    "REFERENCE_GRANT_DENIED",
    "REFERENCE_IDENTITY_MISMATCH",
    "REFERENCE_MISSING",
    "REFERENCE_SOURCE_UNAVAILABLE"
  ]).has(code);
}

function mapError(error: unknown): ApplicationServiceError {
  if (error instanceof ApplicationServiceError) return error;
  if (error instanceof ExecutionRepositoryError || error instanceof DocumentStoreError) {
    return new ApplicationServiceError(error.code, error.message, { cause: error });
  }
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = String((error as { code?: unknown }).code);
    return new ApplicationServiceError(code, error instanceof Error ? error.message : code, { cause: error as unknown as Error });
  }
  return new ApplicationServiceError("APPLICATION_COMMAND_FAILED", error instanceof Error ? error.message : String(error), { cause: error });
}

const MAX_RETAINED_PERFORMANCE_MEASURES = 1_024;

function recordBoundedPerformanceMeasure(
  name: string,
  start: number,
  end: number,
  detail?: Record<string, string>
): void {
  performance.measure(name, { start, end, detail });
  if (performance.getEntriesByName(name, "measure").length <= MAX_RETAINED_PERFORMANCE_MEASURES) return;
  performance.clearMeasures(name);
  performance.measure(name, { start, end, detail });
}

function categoryForError(code: string): "document" | "graph" | "provider" | "execution" | "reference" | "security" | "validation" {
  if (code.includes("REFERENCE")) return "reference";
  if (code.includes("GRAPH") || code.includes("EDGE") || code.includes("NODE")) return "graph";
  if (code.includes("PROVIDER") || code.includes("CAPABILITY")) return "provider";
  if (code.includes("PERMIT") || code.includes("GRANT") || code.includes("SCOPE")) return "security";
  if (code.includes("JOB") || code.includes("PLAN") || code.includes("RUN") || code.includes("OUTPUT")) return "execution";
  if (code.includes("VALID") || code.includes("CORRUPT")) return "validation";
  return "document";
}

function retryableError(code: string): boolean {
  return code.includes("UNAVAILABLE") || code.includes("BUSY") || code.includes("RETRY") || code.includes("RECOVERY");
}
