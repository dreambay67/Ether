import { createHash, randomUUID } from "node:crypto";
import { open, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";

import {
  ensureOwnedRecoveryDirectory,
  removeOwnedStagingPath,
  removeRecoveryJournal,
  resolveRecoveryRoots,
  writeRecoveryJournal
} from "@ether/document";
import type { GenerationProviderInput, ImageEditProviderInput, ProviderGenerationResult } from "@ether/providers";
import {
  canonicalJson,
  type NodeOutputVersion,
  type PayloadEnvelope,
  type PlanStep,
  type PlannedWorkItem,
  type ProviderBinding,
  type ProviderCompletionRecovery
} from "@ether/schema";
import sharp from "sharp";

import { ExecutorRegistry } from "../executors/registry.js";
import type { ExecutorClaim, ExecutorPayloadDraft, ExecutionProviderFacets, ExecutionProviderResolver, LocalMediaOutput } from "../executors/types.js";
import { ExecutorFailure } from "../executors/types.js";
import { toProviderPayloads } from "../executors/input.js";
import { verifyPlanHash } from "../plan/hashPlan.js";
import { isCancellation } from "./cancellation.js";
import { ExecutionConcurrencyDomains } from "./concurrencyDomains.js";
import { documentStorePersistence, isSchedulerPersistence, type DocumentStoreLike, type SchedulerPersistence } from "./persistence.js";
import { effectiveParallelism, isTerminalJob } from "./transitions.js";

export type DurableSchedulerOptions = {
  appDataRoot: string;
  store?: DocumentStoreLike;
  persistence?: SchedulerPersistence;
  provider?: ExecutionProviderFacets["image"];
  providers?: ExecutionProviderFacets;
  providerResolver?: ExecutionProviderResolver;
  executors?: ExecutorRegistry;
  onEventsAvailable?: () => Promise<void>;
  checkpoint?: (name: string) => void;
  concurrencyDomains?: ExecutionConcurrencyDomains;
};

export class DurableScheduler {
  private readonly active = new Map<string, { controller: AbortController; promise: Promise<void> }>();
  private readonly detaching = new Set<string>();
  private readonly persistence: SchedulerPersistence;
  private readonly providers: ExecutionProviderFacets;
  private readonly executors: ExecutorRegistry;
  private readonly concurrencyDomains: ExecutionConcurrencyDomains;

  constructor(private readonly options: DurableSchedulerOptions) {
    if (options.persistence !== undefined) {
      this.persistence = options.persistence;
    } else if (options.store !== undefined) {
      this.persistence = isSchedulerPersistence(options.store)
        ? options.store
        : documentStorePersistence(options.store, options.appDataRoot);
    } else {
      throw new Error("DurableScheduler requires a persistence adapter or an open Ether document store.");
    }
    this.providers = { ...options.providers, image: options.providers?.image ?? options.provider };
    this.executors = options.executors ?? new ExecutorRegistry();
    this.concurrencyDomains = options.concurrencyDomains ?? new ExecutionConcurrencyDomains();
  }

  run(jobId: string): Promise<void> {
    const current = this.active.get(jobId);
    if (current !== undefined) return current.promise;
    const controller = new AbortController();
    const promise = this.runLoop(jobId, controller).finally(() => {
      this.active.delete(jobId);
      this.detaching.delete(jobId);
    });
    this.active.set(jobId, { controller, promise });
    return promise;
  }

  async waitForJob(jobId: string) {
    await this.active.get(jobId)?.promise;
    const job = await this.persistence.getJob(jobId);
    if (job === undefined) throw new ExecutorFailure("JOB_NOT_FOUND", `Unknown Ether job ${jobId}.`);
    return job;
  }

  async cancel(jobId: string, commandId: string) {
    this.active.get(jobId)?.controller.abort();
    const job = await this.persistence.cancelJob(jobId, commandId);
    await this.options.onEventsAvailable?.();
    await this.active.get(jobId)?.promise.catch(() => undefined);
    return job;
  }

  async detach(): Promise<void> {
    const entries = [...this.active.entries()];
    for (const [jobId, active] of entries) {
      this.detaching.add(jobId);
      active.controller.abort();
    }
    await Promise.all(entries.map(([, active]) => active.promise.catch(() => undefined)));
  }

  private async runLoop(jobId: string, controller: AbortController): Promise<void> {
    const running = new Set<Promise<void>>();
    try {
      while (!controller.signal.aborted) {
        const job = await this.persistence.getJob(jobId);
        if (job === undefined) throw new ExecutorFailure("JOB_NOT_FOUND", `Unknown Ether job ${jobId}.`);
        if (isTerminalJob(job) || job.status === "waiting-review") return;
        const capacity = effectiveParallelism(job);
        let claimed = false;
        while (!controller.signal.aborted && running.size < capacity) {
          const claim = await this.persistence.claimNext(jobId, `scheduler:${process.pid}:${randomUUID()}`);
          if (claim === undefined) break;
          claimed = true;
          await this.options.onEventsAvailable?.();
          const work = this.executeClaim(claim, controller.signal)
            .catch(async (error) => this.handleClaimError(claim, error, controller.signal))
            .finally(() => running.delete(work));
          running.add(work);
        }
        if (running.size === 0) {
          // No dependency-ready work remains. The durable repository owns the distinction
          // between completed, waiting-review, failed, and a later explicit resume.
          if (!claimed) return;
          continue;
        }
        await Promise.race(running);
      }
    } finally {
      // A failure can make the durable job terminal while sibling calls are still
      // active. Retain scheduler ownership until every claimed call has settled so
      // retry cannot create a second capacity domain around orphaned work.
      await Promise.allSettled([...running]);
    }
  }

  private async executeClaim(claim: ExecutorClaim, signal: AbortSignal): Promise<void> {
    if (!verifyPlanHash(claim.plan)) {
      throw new ExecutorFailure("PLAN_HASH_INVALID", "Persisted execution plan content hash is invalid.");
    }
    if (claim.plan.documentId !== this.persistence.documentId) {
      throw new ExecutorFailure(
        "STALE_PLAN",
        `Plan document ${claim.plan.documentId} does not match the open document ${this.persistence.documentId}.`
      );
    }
    const plannedStep = claim.plan.steps.find((candidate) => candidate.workItemIds.includes(claim.workItem.plannedWorkItemId));
    const plannedWorkItem = claim.plan.workItems.find((candidate) => candidate.id === claim.workItem.plannedWorkItemId);
    if (plannedStep === undefined || plannedWorkItem === undefined) {
      throw new ExecutorFailure("PLAN_CORRUPT", "Claimed Ether work item is missing its persisted plan step.");
    }
    const itemStep = effectiveStepForWorkItem(plannedStep, plannedWorkItem);
    const binding = providerBindingForWorkItem(itemStep, plannedWorkItem);
    const step = plannedWorkItem.providerBindingOverride === undefined
      ? itemStep
      : {
          ...itemStep,
          providerBinding: plannedWorkItem.providerBindingOverride,
          parameters: {
            ...itemStep.parameters,
            model: plannedWorkItem.providerBindingOverride.modelId
          },
          compiledContext: {
            ...itemStep.compiledContext,
            providerBindingOverride: {
              providerId: plannedWorkItem.providerBindingOverride.providerId,
              profileId: plannedWorkItem.providerBindingOverride.profileId,
              modelId: plannedWorkItem.providerBindingOverride.modelId
            }
          }
        };
    const roots = resolveRecoveryRoots(this.options.appDataRoot);
    const stagingDirectory = path.join(roots.stagingRoot, "execution", claim.plan.documentId, claim.job.id, claim.attempt.id);
    ensureOwnedRecoveryDirectory(stagingDirectory, roots.appDataRoot);
    const inputIds = [
      ...plannedWorkItem.inputs.map((input) => input.payloadId),
      ...step.inputPayloadIds,
      ...(step.resolvedInputBindings ?? []).map((binding) => binding.payloadId)
    ];
    const inputs = this.persistence.resolvePlanInputs === undefined
      ? await this.persistence.resolvePayloads(unique(inputIds), stagingDirectory)
      : await this.persistence.resolvePlanInputs({ claim, step, plannedWorkItem, stagingDirectory });
    const providerInputs = toProviderPayloads(inputs);
    await this.withConcurrency(binding, signal, async () => {
      const resolvedProviders = this.options.providerResolver === undefined
        ? this.providers
        : await this.options.providerResolver({ binding, step });
      // Remote-provider resolution intentionally remains authoritative for every
      // remote facet.  The deterministic local-media capability is application
      // owned, however, and must stay available for Mask/Transform executions.
      const providers = this.options.providerResolver === undefined
        ? resolvedProviders
        : { ...resolvedProviders, localMedia: resolvedProviders.localMedia ?? this.providers.localMedia };
      const result = await this.executors.execute({
        claim,
        step,
        plannedWorkItem,
        inputs,
        providerInputs,
        signal,
        stagingDirectory,
        providers
      });
      if (result.kind === "provider-generation") {
        await this.executeProviderCompletion(claim, step, binding, result, inputs, stagingDirectory, signal);
      } else if (result.kind === "local-media") {
        await this.acceptLocalMediaCompletion(claim, step, inputs, result.outputs, stagingDirectory);
      } else if (result.kind === "waiting-review") {
        await this.persistence.waitForReview({ claim, ...result.checkpoint });
      } else {
        await this.acceptLocalCompletion(
          claim,
          step,
          binding,
          result.providerId,
          inputs,
          result.outputs,
          result.effects,
          result.adapterIntermediates
        );
      }
    });
    await this.options.onEventsAvailable?.();
  }

  private async withConcurrency<T>(
    binding: ProviderBinding | null,
    signal: AbortSignal,
    operation: () => Promise<T>
  ): Promise<T> {
    let release: (() => void) | undefined;
    try {
      release = await this.concurrencyDomains.acquire(binding, signal);
      return await operation();
    } finally {
      release?.();
    }
  }

  private async acceptLocalCompletion(
    claim: ExecutorClaim,
    step: ExecutorClaim["plan"]["steps"][number],
    binding: ProviderBinding | null,
    actualProviderId: string | undefined,
    inputs: PayloadEnvelope[],
    drafts: ExecutorPayloadDraft[],
    effects: Array<Record<string, unknown>> | undefined,
    adapterIntermediates: Array<{ adapterId: string; inputPayloadIds: string[]; outputPayloadIds: string[]; metadata?: Record<string, unknown> }> | undefined
  ): Promise<void> {
    if (drafts.length === 0) {
      throw new ExecutorFailure("EMPTY_EXECUTOR_OUTPUT", `${step.executor} completed without producing an immutable output.`);
    }
    const producer = completionProducer(step, binding, actualProviderId);
    const completedAt = new Date().toISOString();
    const outputs = drafts.map((draft, ordinal) => {
      const outputVersionId = stableId("output", claim.attempt.id, ordinal);
      const payloadId = stableId("payload", claim.attempt.id, ordinal);
      const version: NodeOutputVersion = {
        id: outputVersionId,
        nodeId: step.nodeId,
        graphId: claim.plan.graphId,
        graphRevisionId: claim.plan.graphRevisionId,
        inputPayloadIds: inputs.map((input) => input.id),
        selectedOutputVersionIds: unique(inputs.map((input) => input.source.outputVersionId)),
        compiledContextHash: claim.plan.contentHash,
        producer,
        outputPayloadIds: [payloadId],
        parentOutputVersionId: null,
        approval: step.parameters.reviewPolicy === "auto-apply"
          ? { state: "approved", actor: "system", at: completedAt }
          : { state: "unreviewed" },
        runId: claim.job.id,
        stepId: step.id,
        workItemId: claim.workItem.id,
        attemptId: claim.attempt.id,
        timing: { startedAt: claim.attempt.startedAt ?? claim.attempt.createdAt, completedAt },
        failure: null,
        createdAt: completedAt
      };
      const payload: PayloadEnvelope = {
        id: payloadId,
        channel: draft.channel,
        role: draft.role,
        content: draft.content,
        source: {
          nodeId: step.nodeId,
          outputVersionId,
          lineageKey: `${claim.plan.graphId}:${step.nodeId}:${claim.workItem.id}:${ordinal}`
        },
        metadata: draft.metadata ?? {}
      };
      return { version, payloads: [payload] };
    });
    await this.persistence.acceptCompletion({
      claim,
      outputs,
      effects: effects ?? [],
      adapterIntermediates: (adapterIntermediates ?? []).map((intermediate) => ({
        ...intermediate,
        outputPayloadIds: intermediate.outputPayloadIds.length > 0
          ? intermediate.outputPayloadIds
          : outputs.flatMap((output) => output.payloads.map((payload) => payload.id))
      }))
    });
  }

  private async acceptLocalMediaCompletion(
    claim: ExecutorClaim,
    step: ExecutorClaim["plan"]["steps"][number],
    inputs: PayloadEnvelope[],
    outputs: LocalMediaOutput[],
    stagingDirectory: string
  ): Promise<void> {
    if (outputs.length === 0) {
      throw new ExecutorFailure("EMPTY_EXECUTOR_OUTPUT", `${step.executor} completed without a staged local media output.`);
    }
    const accept = this.persistence.acceptLocalMediaOutput;
    if (accept === undefined) {
      throw new ExecutorFailure(
        "LOCAL_MEDIA_PERSISTENCE_UNAVAILABLE",
        "The active execution store cannot durably accept deterministic local media output."
      );
    }
    const durableOutputs = await Promise.all(outputs.map(async (output, ordinal) => {
      assertSafeArtifactFileName(output.fileName);
      const stagedPath = await authorizeLocalMediaSource(output.stagedPath, stagingDirectory);
      return {
        ...output,
        stagedPath,
        artifactId: stableId("artifact", claim.attempt.id, ordinal),
        outputVersionId: stableId("output", claim.attempt.id, ordinal),
        payloadId: stableId("payload", claim.attempt.id, ordinal)
      };
    }));
    try {
      await accept({ claim, step, inputs, outputs: durableOutputs });
    } finally {
      try { removeOwnedStagingPath(stagingDirectory, this.options.appDataRoot); } catch { /* terminal local attempt owns cleanup */ }
    }
  }

  private async executeProviderCompletion(
    claim: ExecutorClaim,
    step: ExecutorClaim["plan"]["steps"][number],
    requestedBinding: ProviderBinding | null,
    invocation: Extract<Awaited<ReturnType<ExecutorRegistry["execute"]>>, { kind: "provider-generation" }>,
    inputs: readonly PayloadEnvelope[],
    stagingDirectory: string,
    signal: AbortSignal
  ): Promise<void> {
    const binding = requestedBinding ?? step.providerBinding ?? step.provider;
    if (binding === undefined || binding === null || binding.providerId !== invocation.provider.descriptor.id) {
      throw new ExecutorFailure(
        "PROVIDER_MISMATCH",
        `Step ${step.id} requires ${binding?.providerId ?? "no provider"}, not ${invocation.provider.descriptor.id}.`
      );
    }
    const roots = resolveRecoveryRoots(this.options.appDataRoot);
    const acceptedAt = new Date().toISOString();
    const prepared: ProviderCompletionRecovery = {
      attemptId: claim.attempt.id,
      providerAttemptId: claim.providerAttemptId,
      expectedOutputCount: invocation.expectedOutputCount,
      providerRunId: stableId("provider-run", claim.providerAttemptId),
      capabilitySnapshotId: stableId("capability", claim.providerAttemptId),
      acceptedAt,
      providerId: binding.providerId,
      modelId: binding.modelId,
      capabilitySnapshot: binding.capabilitySnapshot,
      inputPayloadIds: inputs.map((input) => input.id),
      selectedOutputVersionIds: unique(inputs.map((input) => input.source.outputVersionId)),
      request: invocation.input as unknown as Record<string, unknown>,
      response: null,
      metadata: null,
      outputs: []
    };
    let journalPath: string | undefined;
    let stagedCompletion: ProviderCompletionRecovery | undefined;
    let stagedOutputs: Awaited<ReturnType<typeof stageArtifacts>> = [];
    let providerDispatchStartedAt = 0;
    let firstProviderEventAt: number | null = null;
    let providerGenerationCompletedAt: number | null = null;
    let providerValidationCompletedAt: number | null = null;
    try {
      this.checkpoint("provider-output-before-journal");
      journalPath = writeRecoveryJournal({
        appDataRoot: roots.appDataRoot,
        entry: {
          id: `provider-output-${claim.attempt.id}`,
          kind: "provider-output",
          state: "prepared",
          documentId: claim.plan.documentId,
          documentPath: this.persistence.path,
          stagedPath: stagingDirectory,
          sourceName: "provider-output",
          mediaType: "application/octet-stream",
          execution: prepared,
          createdAt: acceptedAt,
          updatedAt: acceptedAt
        }
      });
      this.checkpoint("provider-output-journal-created");
      await this.persistence.prepareProviderCompletion(prepared, stagingDirectory);
      this.checkpoint("provider-output-intent-created");
      const authorizedStagingDirectory = await realpath(stagingDirectory);
      const complete = async (providerResult: ProviderGenerationResult): Promise<void> => {
        if (stagedCompletion !== undefined) {
          throw new ExecutorFailure("PROVIDER_COMPLETION_PROTOCOL_INVALID", "Provider completed the same Ether attempt twice.");
        }
        providerGenerationCompletedAt ??= performance.now();
        recordBoundedPerformanceMeasure(
          "provider-generation",
          firstProviderEventAt ?? providerDispatchStartedAt,
          providerGenerationCompletedAt,
          { attemptId: claim.attempt.id }
        );
        if (providerResult.providerId !== binding.providerId) {
          throw new ExecutorFailure("PROVIDER_MISMATCH", `Provider returned ${providerResult.providerId}, expected ${binding.providerId}.`);
        }
        if (providerResult.artifacts.length !== invocation.expectedOutputCount) {
          throw new ExecutorFailure(
            "PROVIDER_OUTPUT_COUNT_MISMATCH",
            `Provider returned ${providerResult.artifacts.length} outputs; this plan requires ${invocation.expectedOutputCount}.`
          );
        }
        stagedOutputs = await stageArtifacts(providerResult, stagingDirectory, authorizedStagingDirectory);
        stagedCompletion = {
          ...prepared,
          response: { artifactCount: providerResult.artifacts.length },
          metadata: providerResult.metadata ?? {},
          outputs: stagedOutputs.map((staged, ordinal) => ({
            ordinal,
            artifactId: stableId("artifact", claim.providerAttemptId, ordinal),
            outputVersionId: stableId("output", claim.providerAttemptId, ordinal),
            payloadId: stableId("payload", claim.providerAttemptId, ordinal),
            importId: stableId("blob-import", claim.providerAttemptId, ordinal),
            stagedPath: staged.path,
            fileName: staged.fileName,
            mediaType: staged.mediaType,
            ...(staged.thumbnail === undefined ? {} : {
              thumbnailStagedPath: staged.thumbnail.path,
              thumbnailMediaType: staged.thumbnail.mediaType
            }),
            artifactMetadata: {
              ...staged.metadata,
              title: staged.fileName,
              graphId: claim.plan.graphId,
              nodeId: step.nodeId,
              jobId: claim.job.id,
              providerRunId: prepared.providerRunId,
              ordinal
            }
          }))
        };
        writeRecoveryJournal({
          appDataRoot: roots.appDataRoot,
          entry: {
            id: `provider-output-${claim.attempt.id}`,
            kind: "provider-output",
            state: "staged",
            documentId: claim.plan.documentId,
            documentPath: this.persistence.path,
            stagedPath: stagingDirectory,
            sourceName: "provider-output",
            mediaType: "application/octet-stream",
            execution: stagedCompletion,
            createdAt: acceptedAt,
            updatedAt: new Date().toISOString()
          }
        });
        await this.persistence.stageProviderCompletion(stagedCompletion);
        providerValidationCompletedAt = performance.now();
        recordBoundedPerformanceMeasure(
          "provider-output-validation",
          providerGenerationCompletedAt,
          providerValidationCompletedAt,
          { attemptId: claim.attempt.id }
        );
        this.checkpoint("provider-output-staged");
      };
      let returned: ProviderGenerationResult | undefined;
      try {
        providerDispatchStartedAt = performance.now();
        const queueMs = Math.max(0, Date.now() - Date.parse(claim.attempt.createdAt));
        recordBoundedPerformanceMeasure(
          "provider-queue",
          providerDispatchStartedAt - queueMs,
          providerDispatchStartedAt,
          { attemptId: claim.attempt.id }
        );
        this.checkpoint("provider-dispatch-started");
        const reportPhase = (phase: import("@ether/providers").ProviderExecutionPhase): void => {
          const observedAt = performance.now();
          if (phase === "first-event" && firstProviderEventAt === null) {
            firstProviderEventAt = observedAt;
            recordBoundedPerformanceMeasure(
              "provider-dispatch:first-event",
              providerDispatchStartedAt,
              observedAt,
              { attemptId: claim.attempt.id }
            );
            this.checkpoint("provider-first-event");
          } else if (phase === "generation-complete" && providerGenerationCompletedAt === null) {
            providerGenerationCompletedAt = observedAt;
            this.checkpoint("provider-generation-completed");
          } else if (phase === "provider-validation-complete" && providerValidationCompletedAt === null) {
            providerValidationCompletedAt = observedAt;
            this.checkpoint("provider-validation-completed");
          }
        };
        returned = invocation.operation === "generate"
          ? await invocation.provider.generate(invocation.input as GenerationProviderInput, {
            signal, providerAttemptId: claim.providerAttemptId, attemptOrdinal: claim.attempt.ordinal,
            stagingDirectory, reportPhase, complete
          })
          : await invocation.provider.edit(invocation.input as ImageEditProviderInput, {
            signal, providerAttemptId: claim.providerAttemptId, attemptOrdinal: claim.attempt.ordinal,
            stagingDirectory, reportPhase, complete
          });
      } catch (error) {
        if (error instanceof ExecutorFailure && error.code === "PROCESS_LOST") throw error;
        // Once complete() has durably staged the exact provider result, a later
        // provider exception cannot revoke that completion.
        if (stagedCompletion === undefined) throw error;
      }
      if (stagedCompletion === undefined) {
        if (returned === undefined) {
          throw new ExecutorFailure("PROVIDER_COMPLETION_PROTOCOL_INVALID", "Provider returned without a completion result.");
        }
        await complete(returned);
      }
      const completion = stagedCompletion;
      if (completion === undefined) {
        throw new ExecutorFailure("PROVIDER_COMPLETION_PROTOCOL_INVALID", "Provider returned without a durable completion.");
      }
      const artifactImportStartedAt = performance.now();
      await this.persistence.acceptProviderOutput({
        claim,
        identifiers: {
          providerRunId: completion.providerRunId,
          capabilitySnapshotId: completion.capabilitySnapshotId,
          acceptedAt: completion.acceptedAt
        },
        outputs: stagedOutputs.map((staged, index) => ({
          ...completion.outputs[index]!,
          bytes: staged.bytes,
          ...(staged.thumbnail === undefined ? {} : {
            thumbnailBytes: staged.thumbnail.bytes,
            thumbnailMediaType: staged.thumbnail.mediaType
          })
        })),
        providerId: completion.providerId,
        modelId: binding.modelId,
        capabilitySnapshot: binding.capabilitySnapshot,
        inputPayloadIds: completion.inputPayloadIds,
        selectedOutputVersionIds: completion.selectedOutputVersionIds,
        request: completion.request,
        response: completion.response ?? {},
        metadata: completion.metadata ?? {}
      });
      const artifactImportCompletedAt = performance.now();
      recordBoundedPerformanceMeasure(
        "artifact-import",
        artifactImportStartedAt,
        artifactImportCompletedAt,
        { attemptId: claim.attempt.id }
      );
      this.checkpoint("provider-output-accepted");
    } catch (error) {
      // A checkpoint interruption models abrupt process loss. Preserve the
      // journal, staging, and durable intent for open-time reconciliation.
      if (error instanceof ExecutorFailure && error.code === "PROCESS_LOST") throw error;
      cleanupProviderStaging(stagingDirectory, journalPath, roots.appDataRoot);
      await this.persistence.discardProviderCompletion(claim.attempt.id);
      throw error;
    }
    cleanupProviderStaging(stagingDirectory, journalPath, roots.appDataRoot);
  }

  private async handleClaimError(claim: ExecutorClaim, error: unknown, signal: AbortSignal): Promise<void> {
    if (this.detaching.has(claim.job.id) || isCancellation(error, signal)) return;
    if (error instanceof ExecutorFailure && error.code === "PROCESS_LOST") return;
    const code = error instanceof ExecutorFailure ? error.code : errorCode(error);
    const message = error instanceof Error ? error.message : String(error);
    const retryable = error instanceof ExecutorFailure ? error.retryable : errorRetryable(error);
    await this.persistence.failAttempt(claim.attempt.id, code, message, retryable);
    await this.options.onEventsAvailable?.();
  }

  private checkpoint(name: string): void {
    try {
      this.options.checkpoint?.(name);
    } catch (error) {
      throw new ExecutorFailure("PROCESS_LOST", `Execution was interrupted at ${name}.`, true, { cause: error });
    }
  }
}

async function stageArtifacts(
  result: ProviderGenerationResult,
  stagingDirectory: string,
  authorizedStagingDirectory: string
): Promise<Array<{
  bytes: Uint8Array;
  fileName: string;
  mediaType: string;
  metadata: Record<string, unknown>;
  path: string;
  thumbnail?: { bytes: Uint8Array; mediaType: string; path: string };
}>> {
  const current = await realpath(stagingDirectory);
  if (!samePath(current, authorizedStagingDirectory)) {
    throw new ExecutorFailure("PROVIDER_OUTPUT_PATH_INVALID", "Provider replaced its owned staging directory.");
  }
  const staged = [];
  for (let ordinal = 0; ordinal < result.artifacts.length; ordinal += 1) {
    const artifact = result.artifacts[ordinal]!;
    assertSafeArtifactFileName(artifact.fileName);
    const stagedPath = path.resolve(stagingDirectory, `${String(ordinal).padStart(4, "0")}-${artifact.fileName}`);
    assertContainedPath(stagingDirectory, stagedPath);
    const source = artifact.sourcePath === undefined ? undefined : await authorizeProviderSource(artifact.sourcePath, authorizedStagingDirectory);
    const bytes = source !== undefined
      ? await readFile(source)
      : typeof artifact.content === "string" ? Buffer.from(artifact.content) : Buffer.from(artifact.content ?? []);
    if (source === undefined || !samePath(source, stagedPath)) {
      let destination;
      try {
        destination = await open(stagedPath, "wx", 0o600);
        await destination.writeFile(bytes);
      } finally {
        await destination?.close();
      }
    }
    const thumbnailBytes = await createThumbnail(bytes, artifact.mimeType);
    let thumbnail: { bytes: Uint8Array; mediaType: string; path: string } | undefined;
    if (thumbnailBytes !== null) {
      const thumbnailPath = path.resolve(
        stagingDirectory,
        `${String(ordinal).padStart(4, "0")}-${artifact.fileName}.thumbnail.webp`
      );
      assertContainedPath(stagingDirectory, thumbnailPath);
      let destination;
      try {
        destination = await open(thumbnailPath, "wx", 0o600);
        await destination.writeFile(thumbnailBytes);
      } finally {
        await destination?.close();
      }
      thumbnail = { bytes: thumbnailBytes, mediaType: "image/webp", path: thumbnailPath };
    }
    staged.push({
      bytes,
      fileName: artifact.fileName,
      mediaType: artifact.mimeType,
      metadata: artifact.metadata ?? {},
      path: stagedPath,
      ...(thumbnail === undefined ? {} : { thumbnail })
    });
  }
  return staged;
}

async function createThumbnail(bytes: Uint8Array, mediaType: string): Promise<Buffer | null> {
  if (!mediaType.startsWith("image/")) return null;
  try {
    return await sharp(bytes, { failOn: "error" })
      .rotate()
      .resize({ width: 320, height: 320, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 76, effort: 4 })
      .toBuffer();
  } catch (error) {
    throw new ExecutorFailure(
      "PROVIDER_OUTPUT_THUMBNAIL_INVALID",
      "The provider image could not produce a safe embedded thumbnail.",
      false,
      { cause: error }
    );
  }
}

async function authorizeProviderSource(sourcePath: string, stagingDirectory: string): Promise<string> {
  const candidate = path.resolve(stagingDirectory, sourcePath);
  let canonicalRoot: string;
  let canonical: string;
  try {
    [canonicalRoot, canonical] = await Promise.all([realpath(stagingDirectory), realpath(candidate)]);
  } catch (error) {
    throw new ExecutorFailure(
      "PROVIDER_OUTPUT_PATH_INVALID",
      "Provider artifact source is unavailable or cannot be resolved safely.",
      false,
      { cause: error }
    );
  }
  assertContainedPath(canonicalRoot, canonical);
  if (!(await stat(canonical)).isFile()) {
    throw new ExecutorFailure("PROVIDER_OUTPUT_PATH_INVALID", "Provider artifact source is not a regular file.");
  }
  return canonical;
}

async function authorizeLocalMediaSource(sourcePath: string, stagingDirectory: string): Promise<string> {
  const candidate = path.resolve(stagingDirectory, sourcePath);
  let canonicalRoot: string;
  let canonical: string;
  try {
    [canonicalRoot, canonical] = await Promise.all([realpath(stagingDirectory), realpath(candidate)]);
  } catch (error) {
    throw new ExecutorFailure(
      "LOCAL_MEDIA_OUTPUT_PATH_INVALID",
      "The deterministic local media output is unavailable or cannot be resolved safely.",
      false,
      { cause: error }
    );
  }
  assertContainedPath(canonicalRoot, canonical);
  if (!(await stat(canonical)).isFile()) {
    throw new ExecutorFailure("LOCAL_MEDIA_OUTPUT_PATH_INVALID", "The deterministic local media output is not a regular file.");
  }
  return canonical;
}

function assertSafeArtifactFileName(fileName: string): void {
  const trimmed = fileName.trim();
  const windowsStem = trimmed.replace(/[. ]+$/u, "").split(".", 1)[0]?.toUpperCase();
  if (
    trimmed.length === 0 || trimmed !== fileName || trimmed === "." || trimmed === ".." ||
    trimmed.includes("/") || trimmed.includes("\\") || trimmed.includes(":") || path.isAbsolute(trimmed) ||
    path.win32.isAbsolute(trimmed) || /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/u.test(windowsStem ?? "")
  ) {
    throw new ExecutorFailure("PROVIDER_OUTPUT_PATH_INVALID", `Provider artifact name ${JSON.stringify(fileName)} is not allowed.`);
  }
}

function assertContainedPath(root: string, candidate: string): void {
  const relative = path.relative(root, candidate);
  if (relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))) return;
  throw new ExecutorFailure("PROVIDER_OUTPUT_PATH_INVALID", "Provider artifact path escapes its owned staging directory.");
}

function cleanupProviderStaging(directory: string, journalPath: string | undefined, appDataRoot: string): void {
  try { removeOwnedStagingPath(directory, appDataRoot); } catch { return; }
  if (journalPath !== undefined) {
    try { removeRecoveryJournal(journalPath, appDataRoot); } catch { /* reopen reconciliation owns committed leftovers */ }
  }
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function stableId(kind: string, attemptId: string, ordinal?: number): string {
  return `${kind}-${createHash("sha256").update(`${attemptId}\0${kind}\0${ordinal ?? ""}`).digest("hex")}`;
}

function samePath(left: string, right: string): boolean {
  return process.platform === "win32"
    ? path.resolve(left).toLocaleLowerCase() === path.resolve(right).toLocaleLowerCase()
    : path.resolve(left) === path.resolve(right);
}

const LEGACY_PROVIDER_EXECUTORS = new Set<PlanStep["executor"]>([
  "codex-llm",
  "codex-evaluation",
  "image-provider",
  "edit-provider"
]);

function providerBindingForWorkItem(
  step: PlanStep,
  workItem: PlannedWorkItem
): ProviderBinding | null {
  const explicit = workItem.providerBindingOverride ?? step.providerBinding;
  if (explicit !== undefined && explicit !== null) return explicit;
  // provider remains required in the persisted schema for compatibility with
  // plans compiled before nullable providerBinding existed.
  return LEGACY_PROVIDER_EXECUTORS.has(step.executor) ? step.provider : null;
}

function completionProducer(
  step: PlanStep,
  binding: ProviderBinding | null,
  actualProviderId: string | undefined
): NodeOutputVersion["producer"] {
  if (binding === null) return { kind: "local", executor: step.executor };
  if (actualProviderId !== binding.providerId) {
    throw new ExecutorFailure(
      "PROVIDER_MISMATCH",
      `Step ${step.id} requires ${binding.providerId}, but its executor returned ${actualProviderId ?? "no provider identity"}.`
    );
  }
  return {
    kind: "provider",
    providerId: binding.providerId,
    profileId: binding.profileId,
    modelId: binding.modelId,
    capabilitySnapshot: binding.capabilitySnapshot
  };
}

function effectiveStepForWorkItem(step: PlanStep, workItem: PlannedWorkItem): PlanStep {
  const batchParameters = workItem.parameters
    .filter((parameter) => !Object.hasOwn(step.parameters, parameter.name))
    .sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
  if (batchParameters.length === 0) return step;
  const batchItem = Object.fromEntries(
    batchParameters.map((parameter) => [parameter.name, parameter.value])
  );
  const batchPrompt = batchParameters
    .map((parameter) => `- ${parameter.name}: ${canonicalJson(parameter.value)}`)
    .join("\n");
  return {
    ...step,
    compiledPrompt: `${step.compiledPrompt}${step.compiledPrompt.length === 0 ? "" : "\n\n"}Batch item:\n${batchPrompt}`,
    compiledContext: {
      ...step.compiledContext,
      batchItem
    }
  };
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

function errorCode(error: unknown): string {
  return typeof error === "object" && error !== null && "code" in error ? String((error as { code: unknown }).code) : "EXECUTOR_FAILED";
}

function errorRetryable(error: unknown): boolean {
  return typeof error === "object" && error !== null && "retryable" in error && (error as { retryable: unknown }).retryable === true;
}
