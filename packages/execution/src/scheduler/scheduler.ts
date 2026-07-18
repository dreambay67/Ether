import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  removeOwnedStagingPath,
  removeRecoveryJournal,
  resolveRecoveryRoots,
  writeRecoveryJournal,
  type ClaimedExecution,
  type DocumentStore
} from "@ether/document";
import type {
  GenerationProvider,
  GenerationProviderInput,
  ProviderGenerationResult
} from "@ether/providers";
import type { ExecutionJob } from "@ether/schema";

import { verifyPlanHash } from "../plan/hashPlan.js";

export class DurableScheduler {
  private readonly active = new Map<string, { controller: AbortController; promise: Promise<void> }>();
  private readonly detaching = new Set<string>();

  constructor(
    private readonly options: {
      appDataRoot: string;
      provider: GenerationProvider;
      store: DocumentStore;
      onAccepted?: (input: {
        claim: ClaimedExecution;
        artifactId: string;
        outputVersionId: string;
      }) => void;
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

  async cancel(jobId: string): Promise<ExecutionJob> {
    this.active.get(jobId)?.controller.abort();
    const job = await this.options.store.transaction(({ execution }) => execution.cancelJob(jobId));
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
      try {
        await this.dispatch(claim, controller.signal);
      } catch (error) {
        if (this.detaching.has(jobId)) return;
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
      }
    }
  }

  private async dispatch(claim: ClaimedExecution, signal: AbortSignal): Promise<void> {
    if (!verifyPlanHash(claim.plan)) throw new Error("Persisted plan content hash is invalid.");
    const step = claim.plan.steps.find((candidate) => candidate.workItemIds.includes(claim.workItem.plannedWorkItemId));
    if (step === undefined) throw new Error("Persisted plan step is missing.");
    const roots = resolveRecoveryRoots(this.options.appDataRoot);
    const stagingDirectory = path.join(
      roots.stagingRoot,
      "provider",
      claim.plan.documentId,
      claim.job.id,
      claim.attempt.id
    );
    await mkdir(stagingDirectory, { recursive: true });
    const request = generationInput(claim, step, stagingDirectory);
    const result = await this.options.provider.generate(request, {
      signal,
      providerAttemptId: claim.providerAttemptId,
      attemptOrdinal: claim.attempt.ordinal,
      stagingDirectory
    });
    const staged = await stageFirstArtifact(result, stagingDirectory);
    const acceptedAt = new Date().toISOString();
    const identifiers = {
      artifactId: `artifact-${randomUUID()}`,
      outputVersionId: `output-${randomUUID()}`,
      payloadId: `payload-${randomUUID()}`,
      providerRunId: `provider-run-${randomUUID()}`,
      capabilitySnapshotId: `capability-${randomUUID()}`,
      importId: `blob-import-${randomUUID()}`,
      acceptedAt
    };
    const artifactMetadata = {
      title: staged.fileName,
      graphId: claim.plan.graphId,
      nodeId: step.nodeId,
      jobId: claim.job.id,
      providerRunId: identifiers.providerRunId
    };
    const journalPath = writeRecoveryJournal({
      appDataRoot: roots.appDataRoot,
      entry: {
        id: `provider-output-${claim.attempt.id}`,
        kind: "provider-output",
        state: "staged",
        documentId: claim.plan.documentId,
        documentPath: this.options.store.path,
        stagedPath: staged.path,
        sourceName: staged.fileName,
        mediaType: staged.mediaType,
        artifact: {
          id: identifiers.artifactId,
          channel: "image",
          mediaType: staged.mediaType,
          source: {
            outputVersionId: identifiers.outputVersionId,
            payloadId: identifiers.payloadId
          },
          createdAt: acceptedAt,
          metadata: artifactMetadata
        },
        createdAt: acceptedAt,
        updatedAt: acceptedAt
      }
    });
    this.options.checkpoint?.("provider-output-journal-created");
    let accepted;
    try {
      accepted = await this.options.store.transaction(({ execution }) =>
        execution.acceptProviderOutput({
          claim,
          identifiers,
          artifactMetadata,
          bytes: staged.bytes,
          fileName: staged.fileName,
          mediaType: staged.mediaType,
          providerId: result.providerId,
          modelId: step.provider.modelId,
          capabilitySnapshot: step.provider.capabilitySnapshot,
          request: request as unknown as Record<string, unknown>,
          response: { artifactCount: result.artifacts.length },
          metadata: result.metadata ?? {}
        })
      );
    } catch (error) {
      cleanupProviderStaging(stagingDirectory, journalPath, roots.appDataRoot);
      throw error;
    }
    if (accepted.artifact.id.length === 0) throw new Error("Artifact acceptance failed.");
    cleanupProviderStaging(stagingDirectory, journalPath, roots.appDataRoot);
    this.options.onAccepted?.({
      claim,
      artifactId: accepted.artifact.id,
      outputVersionId: accepted.outputVersion.id
    });
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
    output: {
      aspectRatio: String(settings.aspectRatio ?? "1:1"),
      resolution: `${String(resolution?.width ?? 1024)}x${String(resolution?.height ?? 1024)}`,
      width: Number(resolution?.width ?? 1024),
      height: Number(resolution?.height ?? 1024)
    },
    requestedAt: claim.attempt.startedAt ?? claim.attempt.createdAt
  };
}

async function stageFirstArtifact(
  result: ProviderGenerationResult,
  stagingDirectory: string
): Promise<{ bytes: Uint8Array; fileName: string; mediaType: string; path: string }> {
  const artifact = result.artifacts[0];
  if (artifact === undefined) throw new Error("Provider returned no artifact.");
  const bytes = artifact.sourcePath !== undefined
    ? await readFile(artifact.sourcePath)
    : typeof artifact.content === "string"
      ? Buffer.from(artifact.content)
      : Buffer.from(artifact.content ?? []);
  const stagedPath = path.join(stagingDirectory, artifact.fileName);
  await writeFile(stagedPath, bytes);
  return { bytes, fileName: artifact.fileName, mediaType: artifact.mimeType, path: stagedPath };
}

function cleanupProviderStaging(directory: string, journalPath: string, appDataRoot: string): void {
  try {
    removeOwnedStagingPath(directory, appDataRoot);
  } catch {
    return;
  }
  try {
    removeRecoveryJournal(journalPath, appDataRoot);
  } catch {
    // A committed output remains accepted; reopen reconciliation owns leftover journal cleanup.
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
