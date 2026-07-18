import { createHash } from "node:crypto";
import { open, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";

import {
  removeOwnedStagingPath,
  removeRecoveryJournal,
  resolveRecoveryRoots,
  ensureOwnedRecoveryDirectory,
  writeRecoveryJournal,
  type ClaimedExecution,
  type DocumentStore
} from "@ether/document";
import type {
  GenerationProvider,
  GenerationProviderInput,
  ProviderGenerationResult
} from "@ether/providers";
import type { ExecutionJob, ProviderCompletionRecovery } from "@ether/schema";

import { verifyPlanHash } from "../plan/hashPlan.js";

export class DurableScheduler {
  private readonly active = new Map<string, { controller: AbortController; promise: Promise<void> }>();
  private readonly detaching = new Set<string>();

  constructor(
    private readonly options: {
      appDataRoot: string;
      provider: GenerationProvider;
      store: DocumentStore;
      onEventsAvailable?: () => Promise<void>;
      checkpoint?: (name: string) => void;
    }
  ) {}

  run(jobId: string): Promise<void> {
    const current = this.active.get(jobId);
    if (current !== undefined) return current.promise;
    const controller = new AbortController();
    const promise = this.runLoop(jobId, controller).finally(() => this.active.delete(jobId));
    this.active.set(jobId, { controller, promise });
    return promise;
  }

  async waitForJob(jobId: string): Promise<ExecutionJob> {
    await this.active.get(jobId)?.promise;
    const job = await this.options.store.read(({ execution }) => execution.getJob(jobId));
    if (job === undefined) throw new Error(`Unknown job ${jobId}.`);
    return job;
  }

  async cancel(jobId: string, commandId: string): Promise<ExecutionJob> {
    this.active.get(jobId)?.controller.abort();
    const job = await this.options.store.transaction(({ execution }) => execution.cancelJob(jobId, commandId));
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
    while (!controller.signal.aborted) {
      const claim = await this.options.store.transaction(({ execution }) =>
        execution.claimNext(jobId, `worker:${process.pid}`)
      );
      if (claim === undefined) return;
      await this.options.onEventsAvailable?.();
      try {
        await this.dispatch(claim, controller.signal);
      } catch (error) {
        if (this.detaching.has(jobId)) return;
        if (error instanceof ExecutionProcessLostError) return;
        const code = errorCode(error);
        if (code === "CANCELLED" || errorName(error) === "AbortError") return;
        await this.options.store.transaction(({ execution }) =>
          execution.failAttempt(
            claim.attempt.id,
            code,
            error instanceof Error ? error.message : String(error),
            errorRetryable(error)
          )
        );
        await this.options.onEventsAvailable?.();
      }
    }
  }

  private async dispatch(claim: ClaimedExecution, signal: AbortSignal): Promise<void> {
    if (!verifyPlanHash(claim.plan)) throw new Error("Persisted plan content hash is invalid.");
    if (claim.plan.documentId !== this.options.store.documentId) {
      throw new StalePlanDocumentError(claim.plan.documentId, this.options.store.documentId);
    }
    const step = claim.plan.steps.find((candidate) => candidate.workItemIds.includes(claim.workItem.plannedWorkItemId));
    if (step === undefined) throw new Error("Persisted plan step is missing.");
    if (step.provider.providerId !== this.options.provider.descriptor.id) {
      throw new ProviderMismatchError(step.provider.providerId, this.options.provider.descriptor.id);
    }
    const roots = resolveRecoveryRoots(this.options.appDataRoot);
    const stagingDirectory = path.join(
      roots.stagingRoot,
      "provider",
      claim.plan.documentId,
      claim.job.id,
      claim.attempt.id
    );
    const request = generationInput(claim, step, stagingDirectory);
    const acceptedAt = new Date().toISOString();
    const expectedOutputCount = Number(step.provider.settings.outputCount ?? 1);
    const prepared: ProviderCompletionRecovery = {
      attemptId: claim.attempt.id,
      providerAttemptId: claim.providerAttemptId,
      expectedOutputCount,
      providerRunId: stableId("provider-run", claim.providerAttemptId),
      capabilitySnapshotId: stableId("capability", claim.providerAttemptId),
      acceptedAt,
      providerId: step.provider.providerId,
      modelId: step.provider.modelId,
      capabilitySnapshot: step.provider.capabilitySnapshot,
      request: request as unknown as Record<string, unknown>,
      response: null,
      metadata: null,
      outputs: []
    };
    let journalPath: string | undefined;
    let stagedCompletion: ProviderCompletionRecovery | undefined;
    let stagedOutputs: Awaited<ReturnType<typeof stageArtifacts>> = [];
    try {
      this.checkpoint("provider-output-before-journal");
      journalPath = writeRecoveryJournal({
        appDataRoot: roots.appDataRoot,
        entry: {
          id: `provider-output-${claim.attempt.id}`,
          kind: "provider-output",
          state: "prepared",
          documentId: claim.plan.documentId,
          documentPath: this.options.store.path,
          stagedPath: stagingDirectory,
          sourceName: "provider-output",
          mediaType: "application/octet-stream",
          execution: prepared,
          createdAt: acceptedAt,
          updatedAt: acceptedAt
        }
      });
      this.checkpoint("provider-output-journal-created");
      await this.options.store.transaction(({ execution }) =>
        execution.prepareProviderCompletion(prepared, stagingDirectory)
      );
      this.checkpoint("provider-output-intent-created");
      ensureOwnedRecoveryDirectory(stagingDirectory, roots.appDataRoot);
      const authorizedStagingDirectory = await realpath(stagingDirectory);
      this.checkpoint("provider-output-staging-created");
      let result: ProviderGenerationResult | undefined;
      try {
        result = await this.options.provider.generate(request, {
          signal,
          providerAttemptId: claim.providerAttemptId,
          attemptOrdinal: claim.attempt.ordinal,
          stagingDirectory,
          complete: async (providerResult) => {
            if (stagedCompletion !== undefined) {
              throw new ProviderCompletionProtocolError("Provider completed the same attempt more than once.");
            }
            if (providerResult.providerId !== step.provider.providerId) {
              throw new ProviderMismatchError(step.provider.providerId, providerResult.providerId);
            }
            if (providerResult.artifacts.length !== expectedOutputCount) {
              throw new ProviderOutputCountError(expectedOutputCount, providerResult.artifacts.length);
            }
            stagedOutputs = await stageArtifacts(
              providerResult,
              stagingDirectory,
              authorizedStagingDirectory
            );
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
                documentPath: this.options.store.path,
                stagedPath: stagingDirectory,
                sourceName: "provider-output",
                mediaType: "application/octet-stream",
                execution: stagedCompletion,
                createdAt: acceptedAt,
                updatedAt: new Date().toISOString()
              }
            });
            await this.options.store.transaction(({ execution }) =>
              execution.stageProviderCompletion(stagedCompletion!)
            );
            this.checkpoint("provider-output-staged");
          }
        });
      } catch (error) {
        if (error instanceof ExecutionProcessLostError || stagedCompletion === undefined) throw error;
      }
      if (stagedCompletion === undefined) {
        throw new ProviderCompletionProtocolError(
          `Provider ${result?.providerId ?? this.options.provider.descriptor.id} returned without durably completing its result.`
        );
      }
      const accepted = await this.options.store.transaction(({ execution }) =>
        execution.acceptProviderOutput({
          claim,
          identifiers: {
            providerRunId: stagedCompletion!.providerRunId,
            capabilitySnapshotId: stagedCompletion!.capabilitySnapshotId,
            acceptedAt: stagedCompletion!.acceptedAt
          },
          outputs: stagedOutputs.map((staged, index) => ({
            ...stagedCompletion!.outputs[index]!,
            bytes: staged.bytes
          })),
          providerId: stagedCompletion!.providerId,
          modelId: step.provider.modelId,
          capabilitySnapshot: step.provider.capabilitySnapshot,
          request: stagedCompletion!.request,
          response: stagedCompletion!.response ?? {},
          metadata: stagedCompletion!.metadata ?? {}
        })
      );
      if (accepted.artifacts.length !== expectedOutputCount) throw new Error("Artifact acceptance failed.");
      this.checkpoint("provider-output-accepted");
    } catch (error) {
      if (error instanceof ExecutionProcessLostError) throw error;
      cleanupProviderStaging(stagingDirectory, journalPath, roots.appDataRoot);
      await this.options.store.transaction(({ execution }) =>
        execution.discardProviderCompletion(claim.attempt.id)
      );
      throw error;
    }
    cleanupProviderStaging(stagingDirectory, journalPath, roots.appDataRoot);
    await this.options.onEventsAvailable?.();
  }

  private checkpoint(name: string): void {
    try {
      this.options.checkpoint?.(name);
    } catch (error) {
      throw new ExecutionProcessLostError(name, { cause: error });
    }
  }
}

function generationInput(
  claim: ClaimedExecution,
  step: ClaimedExecution["plan"]["steps"][number],
  stagingDirectory: string
): GenerationProviderInput {
  const settings = step.provider.settings;
  const resolution = settings.resolution as { width?: unknown; height?: unknown } | undefined;
  return {
    projectPath: stagingDirectory,
    runId: claim.job.id,
    generationNodeId: step.nodeId,
    iteration: claim.attempt.ordinal,
    prompt: step.compiledPrompt,
    negativePrompt: "",
    sections: [],
    references: [],
    edgeRoles: [],
    outputCount: Number(settings.outputCount ?? 1),
    output: {
      aspectRatio: String(settings.aspectRatio ?? "1:1"),
      resolution: `${String(resolution?.width ?? 1024)}x${String(resolution?.height ?? 1024)}`,
      width: Number(resolution?.width ?? 1024),
      height: Number(resolution?.height ?? 1024)
    },
    requestedAt: claim.attempt.startedAt ?? claim.attempt.createdAt
  };
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
}>> {
  const currentStagingDirectory = await realpath(stagingDirectory);
  if (!samePath(currentStagingDirectory, authorizedStagingDirectory)) {
    throw new ProviderOutputPathError("Provider replaced its owned staging directory.");
  }
  const staged = [];
  for (let ordinal = 0; ordinal < result.artifacts.length; ordinal += 1) {
    const artifact = result.artifacts[ordinal]!;
    assertSafeArtifactFileName(artifact.fileName);
    const stagedPath = path.resolve(
      stagingDirectory,
      `${String(ordinal).padStart(4, "0")}-${artifact.fileName}`
    );
    assertContainedPath(stagingDirectory, stagedPath);
    const source = artifact.sourcePath === undefined
      ? undefined
      : await authorizeProviderSource(artifact.sourcePath, authorizedStagingDirectory);
    const bytes = source !== undefined
      ? await readFile(source)
      : typeof artifact.content === "string"
        ? Buffer.from(artifact.content)
        : Buffer.from(artifact.content ?? []);
    if (source === undefined || !samePath(source, stagedPath)) {
      let destination;
      try {
        destination = await open(stagedPath, "wx", 0o600);
        await destination.writeFile(bytes);
      } catch (error) {
        throw new ProviderOutputPathError("Provider artifact destination is not an unused owned file.", { cause: error });
      } finally {
        await destination?.close();
      }
    }
    staged.push({
      bytes,
      fileName: artifact.fileName,
      mediaType: artifact.mimeType,
      metadata: artifact.metadata ?? {},
      path: stagedPath
    });
  }
  return staged;
}

class ProviderOutputPathError extends Error {
  readonly code = "PROVIDER_OUTPUT_PATH_INVALID";
  readonly retryable = false;

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ProviderOutputPathError";
  }
}

class StalePlanDocumentError extends Error {
  readonly code = "STALE_PLAN";
  readonly retryable = false;

  constructor(expected: string, actual: string) {
    super(`Persisted plan document ${expected} does not match open document ${actual}.`);
    this.name = "StalePlanDocumentError";
  }
}

class ProviderMismatchError extends Error {
  readonly code = "PROVIDER_MISMATCH";
  readonly retryable = false;

  constructor(expected: string, actual: string) {
    super(`Persisted provider ${expected} does not match injected provider ${actual}.`);
    this.name = "ProviderMismatchError";
  }
}

class ProviderOutputCountError extends Error {
  readonly code = "PROVIDER_OUTPUT_COUNT_MISMATCH";
  readonly retryable = false;

  constructor(expected: number, actual: number) {
    super(`Provider returned ${actual} artifacts; the persisted plan requires ${expected}.`);
    this.name = "ProviderOutputCountError";
  }
}

class ProviderCompletionProtocolError extends Error {
  readonly code = "PROVIDER_COMPLETION_PROTOCOL_INVALID";
  readonly retryable = false;

  constructor(message: string) {
    super(message);
    this.name = "ProviderCompletionProtocolError";
  }
}

class ExecutionProcessLostError extends Error {
  readonly code = "PROCESS_LOST";

  constructor(checkpoint: string, options?: ErrorOptions) {
    super(`Execution interrupted at ${checkpoint}.`, options);
    this.name = "ExecutionProcessLostError";
  }
}

function stableId(kind: string, providerAttemptId: string, ordinal?: number): string {
  const digest = createHash("sha256")
    .update(`${providerAttemptId}\0${kind}\0${ordinal ?? ""}`)
    .digest("hex");
  return `${kind}-${digest}`;
}

function assertSafeArtifactFileName(fileName: string): void {
  const trimmed = fileName.trim();
  const windowsStem = trimmed.replace(/[. ]+$/u, "").split(".", 1)[0]?.toUpperCase();
  if (
    trimmed.length === 0 ||
    trimmed !== fileName ||
    trimmed === "." ||
    trimmed === ".." ||
    trimmed.includes("/") ||
    trimmed.includes("\\") ||
    trimmed.includes(":") ||
    path.isAbsolute(trimmed) ||
    path.win32.isAbsolute(trimmed) ||
    /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/u.test(windowsStem ?? "")
  ) {
    throw new ProviderOutputPathError(`Provider artifact name ${JSON.stringify(fileName)} is not allowed.`);
  }
}

async function authorizeProviderSource(sourcePath: string, stagingDirectory: string): Promise<string> {
  const candidate = path.resolve(stagingDirectory, sourcePath);
  assertContainedPath(stagingDirectory, candidate);
  let canonical: string;
  try {
    canonical = await realpath(candidate);
    assertContainedPath(stagingDirectory, canonical);
    if (!(await stat(canonical)).isFile()) {
      throw new ProviderOutputPathError("Provider artifact source is not a regular file.");
    }
  } catch (error) {
    if (error instanceof ProviderOutputPathError) throw error;
    throw new ProviderOutputPathError("Provider artifact source is not an authorized staging file.", { cause: error });
  }
  return canonical;
}

function assertContainedPath(root: string, candidate: string): void {
  const relative = path.relative(root, candidate);
  if (relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))) {
    return;
  }
  throw new ProviderOutputPathError("Provider artifact path escapes its owned staging directory.");
}

function samePath(left: string, right: string): boolean {
  return process.platform === "win32"
    ? path.resolve(left).toLocaleLowerCase() === path.resolve(right).toLocaleLowerCase()
    : path.resolve(left) === path.resolve(right);
}

function cleanupProviderStaging(
  directory: string,
  journalPath: string | undefined,
  appDataRoot: string
): void {
  try {
    removeOwnedStagingPath(directory, appDataRoot);
  } catch {
    return;
  }
  if (journalPath !== undefined) {
    try {
      removeRecoveryJournal(journalPath, appDataRoot);
    } catch {
      // A committed output remains accepted; reopen reconciliation owns leftover journal cleanup.
    }
  }
}

function errorCode(error: unknown): string {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code: unknown }).code)
    : "PROVIDER_FAILED";
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "Error";
}

function errorRetryable(error: unknown): boolean {
  return typeof error === "object" && error !== null && "retryable" in error
    ? Boolean((error as { retryable: unknown }).retryable)
    : false;
}
