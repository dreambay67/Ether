import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import path from "node:path";

import {
  DocumentStore,
  DocumentStoreError,
  ExecutionRepositoryError,
  embedReference,
  embedReferences,
  importBlob,
  readBlobRange,
  relinkReference,
  resolveReference,
  streamBlobRange,
  type ArtifactLineageSnapshot,
  type DocumentStoreEnvironment,
  type ReadOnlyReason
} from "@ether/document";
import { compilePlan, DurableScheduler } from "@ether/execution";
import type { GenerationProvider } from "@ether/providers";
import { ExecutionJobSchema, ExecutionPlanSchema } from "@ether/schema";
import type {
  Artifact,
  EtherGraph,
  ExecutionAttempt,
  ExecutionJob,
  ExecutionPlan,
  ExecutionScope,
  ExecutionWorkItem,
  GraphTransaction,
  NodeOutputVersion,
  ProviderCapability
} from "@ether/schema";

import { applyGraphTransaction as applyTransaction } from "./commands/graphCommands.js";
import { createDocument as createStore } from "./commands/documentCommands.js";
import { ApplicationEventBus } from "./events/eventBus.js";
import type { DocumentSnapshot } from "./queries/documentQueries.js";
import { deepFreezeSnapshot } from "./snapshots.js";

export class ApplicationServiceError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ApplicationServiceError";
    this.code = code;
  }
}

export class EtherApplication {
  readonly events = new ApplicationEventBus();
  private store: DocumentStore | undefined;
  private scheduler: DurableScheduler | undefined;
  private inspectedAccess: "prefer-write" | "read-only" | "require-write" | undefined;
  private eventDrain: Promise<void> = Promise.resolve();

  constructor(
    private readonly options: {
      appDataRoot: string;
      appVersion: string;
      provider: GenerationProvider;
      dispatchMode?: "automatic" | "manual";
      documentEnvironment?: Omit<DocumentStoreEnvironment, "leaseRoot" | "recoveryRoot">;
      executionCheckpoint?: (name: string) => void;
      portableCheckpoint?: (stage: "prepared", referenceId: string) => void;
      portableImportCheckpoint?: (stage: string, referenceId: string) => void;
    }
  ) {}

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
      const jobIds = await store.transaction(({ execution }) => {
        execution.quarantineForeignDocumentPlans();
        return execution.recoverProcessLost().filter((jobId) => {
          const job = execution.getJob(jobId);
          const plan = job === undefined ? undefined : execution.getPlan(job.planId);
          return plan !== undefined && plan.steps.every(
            (step) => step.provider.providerId === this.options.provider.descriptor.id
          );
        });
      });
      await this.drainEvents();
      if (this.options.dispatchMode !== "manual") jobIds.forEach((jobId) => void this.scheduler!.run(jobId));
    }
    return this.queryDocument();
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

  async previewRun(input: {
    commandId: string;
    graphId: string;
    scope: ExecutionScope;
  }): Promise<ExecutionPlan> {
    const store = this.requireWritableStore();
    const existing = await store.read(({ execution }) =>
      execution.getCommandResult(input.commandId, "run.preview")
    );
    if (existing !== undefined) {
      return deepFreezeSnapshot(ExecutionPlanSchema.parse(existing.plan));
    }
    const snapshot = await store.read(({ graphs, revisions }) => {
      const graph = graphs.get(input.graphId);
      if (graph === undefined) throw new ApplicationServiceError("GRAPH_NOT_FOUND", `Unknown graph ${input.graphId}.`);
      return { graph, head: revisions.head() };
    });
    const plan = compilePlan({
      id: `plan-${randomUUID()}`,
      documentId: store.documentId,
      documentRevisionId: snapshot.head.documentRevisionId,
      graph: snapshot.graph,
      graphRevisionId: snapshot.head.graphRevisions[input.graphId]!,
      scope: input.scope,
      capability: capabilityFor(snapshot.graph, this.options.provider),
      createdAt: new Date().toISOString()
    });
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
      }]);
      return plan;
    });
    await this.drainEvents();
    return deepFreezeSnapshot(persisted);
  }

  async grantRunPermit(input: {
    commandId: string;
    planId: string;
    contentHash: string;
  }): Promise<{ id: string; planId: string; contentHash: string }> {
    try {
      const permit = await this.requireWritableStore().transaction(({ execution }) =>
        execution.grantRunPermit(input.planId, input.contentHash, input.commandId)
      );
      await this.drainEvents();
      return deepFreezeSnapshot(permit);
    } catch (error) {
      throw mapError(error);
    }
  }

  async startRun(input: {
    commandId: string;
    planId: string;
    contentHash: string;
    runPermitId: string;
  }): Promise<ExecutionJob> {
    try {
      const job = await this.requireWritableStore().transaction(({ execution }) =>
        execution.startJob(input)
      );
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
    return relinkReference(
      this.requireWritableStore(),
      input.referenceId,
      input.sourcePath,
      input.pathGrantId
    );
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

  async queryGraph(graphId: string): Promise<EtherGraph> {
    const graph = await this.requireStore().read(({ graphs }) => graphs.get(graphId));
    if (graph === undefined) throw new ApplicationServiceError("GRAPH_NOT_FOUND", `Unknown graph ${graphId}.`);
    return deepFreezeSnapshot(graph);
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

  private attachScheduler(): void {
    this.scheduler = new DurableScheduler({
      appDataRoot: this.options.appDataRoot,
      provider: this.options.provider,
      store: this.requireStore(),
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
        if (!this.events.publish(event)) return;
        await store.transaction(({ execution }) => execution.markEventDelivered(event.id));
      }
    };
    this.eventDrain = this.eventDrain.then(drain, drain);
    return this.eventDrain;
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
}

function capabilityFor(graph: EtherGraph, provider: GenerationProvider): ProviderCapability {
  const target = graph.nodes.find((node) => node.config.kind === "generation.image");
  if (target?.config.kind !== "generation.image") {
    throw new ApplicationServiceError("NO_RUNNABLE_SCOPE", "The graph has no image generator.");
  }
  if (target.config.providerId !== provider.descriptor.id) {
    throw new ApplicationServiceError(
      "PROVIDER_MISMATCH",
      `Graph provider ${target.config.providerId} does not match injected provider ${provider.descriptor.id}.`
    );
  }
  return {
    providerId: provider.descriptor.id,
    profileId: target.config.profileId,
    operation: "generate-image",
    inputChannels: ["text", "image", "data"],
    outputChannels: ["image"],
    aspectRatios: [target.config.aspectRatio],
    resolutions: [
      {
        id: `${target.config.resolution.width}x${target.config.resolution.height}`,
        width: target.config.resolution.width,
        height: target.config.resolution.height,
        label: `${target.config.resolution.width} x ${target.config.resolution.height}`
      }
    ],
    maxReferences: 16,
    maxOutputsPerCall: target.config.outputCount,
    supportsCancellation: true,
    supportsSeed: false,
    provenance: "static-constraint",
    limitations: []
  };
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
  return new ApplicationServiceError("APPLICATION_COMMAND_FAILED", error instanceof Error ? error.message : String(error), { cause: error });
}
