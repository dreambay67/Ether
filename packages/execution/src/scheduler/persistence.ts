import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { streamBlobRange, type ClaimedExecution, type DocumentStore } from "@ether/document";
import { resolveOutputSelector } from "@ether/graph-kernel";
import { OutputSelectorSchema, PayloadChannelSchema, type Artifact, type ExecutionJob, type PayloadEnvelope } from "@ether/schema";

import { ExecutorFailure, type ExecutorClaim } from "../executors/types.js";

export type SchedulerPersistence = {
  readonly documentId: string;
  readonly path: string;
  claimNext(jobId: string, claimToken: string): Promise<ExecutorClaim | undefined>;
  getJob(jobId: string): Promise<ExecutionJob | undefined>;
  cancelJob(jobId: string, commandId: string): Promise<ExecutionJob>;
  failAttempt(attemptId: string, code: string, message: string, retryable: boolean): Promise<boolean>;
  acceptProviderOutput(input: Record<string, unknown>): Promise<unknown>;
  acceptCompletion(input: Record<string, unknown>): Promise<unknown>;
  prepareProviderCompletion(completion: unknown, stagingPath: string): Promise<unknown>;
  stageProviderCompletion(completion: unknown): Promise<unknown>;
  discardProviderCompletion(attemptId: string): Promise<boolean>;
  resolvePayloads(payloadIds: readonly string[], stagingDirectory?: string): Promise<PayloadEnvelope[]>;
  resolvePlanInputs?(input: {
    claim: ExecutorClaim;
    step: ExecutorClaim["plan"]["steps"][number];
    plannedWorkItem: import("@ether/schema").PlannedWorkItem;
    stagingDirectory: string;
  }): Promise<PayloadEnvelope[]>;
  waitForReview(input: { claim: ExecutorClaim; selectionMode: "one" | "many"; minimumSelections: number }): Promise<void>;
};

export type DocumentStoreLike = {
  documentId: string;
  path: string;
  read<T>(operation: (repositories: { artifacts: unknown; execution: unknown; outputs: unknown }) => T): Promise<T>;
  transaction<T>(operation: (repositories: { execution: unknown; outputs: unknown }) => T): Promise<T>;
};

export function documentStorePersistence(store: DocumentStoreLike): SchedulerPersistence {
  const persistence: SchedulerPersistence = {
    // A Save As publishes the same open store under a new document identity. Keep
    // scheduler persistence bound to that live identity rather than the identity
    // captured when the document was first opened.
    get documentId() {
      return store.documentId;
    },
    get path() {
      return store.path;
    },
    claimNext: (jobId, claimToken) => store.transaction(({ execution }) =>
      callMethod<ExecutorClaim | undefined>(execution, "claimNext", [jobId, claimToken])
    ),
    getJob: (jobId) => store.read(({ execution }) => callMethod<ExecutionJob | undefined>(execution, "getJob", [jobId])),
    cancelJob: (jobId, commandId) => store.transaction(({ execution }) =>
      callMethod<ExecutionJob>(execution, "cancelJob", [jobId, commandId])
    ),
    failAttempt: (attemptId, code, message, retryable) =>
      store.transaction(({ execution }) => callMethod<boolean>(execution, "failAttempt", [attemptId, code, message, retryable])),
    acceptProviderOutput: (input) => store.transaction(({ execution }) => callMethod(execution, "acceptProviderOutput", [input])),
    acceptCompletion: (input) => store.transaction(({ execution }) => requireExecutionMethod(execution, "acceptCompletion")(input)),
    prepareProviderCompletion: (completion, stagingPath) =>
      store.transaction(({ execution }) => callMethod(execution, "prepareProviderCompletion", [completion, stagingPath])),
    stageProviderCompletion: (completion) => store.transaction(({ execution }) => callMethod(execution, "stageProviderCompletion", [completion])),
    discardProviderCompletion: (attemptId) =>
      store.transaction(({ execution }) => callMethod<boolean>(execution, "discardProviderCompletion", [attemptId])),
    resolvePayloads: async (payloadIds, stagingDirectory) => {
      const resolved = await store.read(({ artifacts, outputs }) => payloadIds.map((id) => {
        const payload = callMethod<PayloadEnvelope | undefined>(outputs, "getPayload", [id]);
        if (payload?.content.kind !== "artifact") return payload === undefined ? undefined : { payload };
        const artifact = callMethod<Artifact | undefined>(artifacts, "get", [payload.content.artifactId]);
        return artifact === undefined ? { payload } : { payload, artifact };
      }).filter((value): value is { payload: PayloadEnvelope; artifact?: Artifact } => value !== undefined));
      if (stagingDirectory === undefined) return resolved.map(({ payload }) => payload);
      if (!resolved.some(({ artifact }) => artifact !== undefined)) return resolved.map(({ payload }) => payload);
      const assetRoot = path.join(stagingDirectory, "resolved-inputs");
      await mkdir(assetRoot, { recursive: true });
      const canonicalStaging = await realpath(stagingDirectory);
      const canonicalAssetRoot = await realpath(assetRoot);
      const assetRootRelative = path.relative(canonicalStaging, canonicalAssetRoot);
      if (assetRootRelative === ".." || assetRootRelative.startsWith(`..${path.sep}`) || path.isAbsolute(assetRootRelative)) {
        throw new ExecutorFailure(
          "INPUT_ASSET_PATH_INVALID",
          "Resolved input assets must remain inside the scheduler-owned attempt staging directory."
        );
      }
      return Promise.all(resolved.map(async ({ payload, artifact }) => {
        if (artifact === undefined) return payload;
        const fileName = `${createHash("sha256").update(payload.id).digest("hex")}${extensionForMediaType(artifact.mediaType)}`;
        const assetPath = path.join(canonicalAssetRoot, fileName);
        await pipeline(
          Readable.from(streamBlobRange(store as DocumentStore, artifact.contentKey, 0, artifact.byteLength)),
          createWriteStream(assetPath, { flags: "w" })
        );
        return { ...payload, metadata: { ...payload.metadata, assetPath, resolvedArtifactId: artifact.id } };
      }));
    },
    resolvePlanInputs: async ({ claim, step, plannedWorkItem, stagingDirectory }) => {
      const staticIds = [
        ...plannedWorkItem.inputs.map((input) => input.payloadId),
        ...step.inputPayloadIds,
        ...(step.resolvedInputBindings ?? []).map((binding) => binding.payloadId)
      ];
      const bindings: Array<Record<string, unknown>> = Array.isArray(step.compiledContext.inputBindings)
        ? step.compiledContext.inputBindings.flatMap((binding) =>
          binding !== null && typeof binding === "object" && !Array.isArray(binding)
            ? [binding as Record<string, unknown>]
            : []
        )
        : [];
      const dynamic = await store.read(({ outputs }) => bindings.flatMap((binding) => {
        const sourceStepId = typeof binding.sourceStepId === "string" ? binding.sourceStepId : null;
        const sourceNodeId = typeof binding.sourceNodeId === "string" ? binding.sourceNodeId : null;
        const sourceChannel = PayloadChannelSchema.safeParse(binding.sourceChannel);
        const selector = OutputSelectorSchema.safeParse(binding.selector);
        if (sourceStepId === null || sourceNodeId === null || !sourceChannel.success || !selector.success) return [];
        const versions = callMethod<import("@ether/schema").NodeOutputVersion[]>(outputs, "listByNode", [sourceNodeId])
          .filter((version) => version.runId === claim.job.id && version.stepId === sourceStepId);
        const payloads = versions
          .flatMap((version) => version.outputPayloadIds)
          .map((payloadId) => callMethod<PayloadEnvelope | undefined>(outputs, "getPayload", [payloadId]))
          .filter((payload): payload is PayloadEnvelope => payload !== undefined);
        const selected = resolveOutputSelector({
          selector: selector.data,
          nodeId: sourceNodeId,
          channel: sourceChannel.data,
          versions,
          payloads
        });
        if (selected.diagnostics.length > 0) {
          const diagnostic = selected.diagnostics[0]!;
          throw new ExecutorFailure(
            "INPUT_SELECTOR_UNRESOLVED",
            `Step ${step.id} cannot consume planned edge ${typeof binding.edgeId === "string" ? binding.edgeId : "(unknown)"}: ${diagnostic.message}`
          );
        }
        const selectedVersions = new Set(selected.versionIds);
        return versions
          .filter((version) => selectedVersions.has(version.id))
          .flatMap((version) => version.outputPayloadIds)
          .map((payloadId) => payloads.find((payload) => payload.id === payloadId))
          .filter((payload): payload is PayloadEnvelope => payload !== undefined && payload.channel === sourceChannel.data)
          .map((payload) => ({
            payload,
            role: typeof binding.role === "string" ? binding.role : payload.role,
            edgeId: typeof binding.edgeId === "string" ? binding.edgeId : undefined
          }));
      }));
      const resolved = await persistence.resolvePayloads(
        [...new Set([...staticIds, ...dynamic.map((entry) => entry.payload.id)])],
        stagingDirectory
      );
      const dynamicById = new Map(dynamic.map((entry) => [entry.payload.id, entry]));
      return resolved.map((payload) => {
        const binding = dynamicById.get(payload.id);
        return binding === undefined ? payload : {
          ...payload,
          role: binding.role as PayloadEnvelope["role"],
          source: { ...payload.source, ...(binding.edgeId === undefined ? {} : { edgeId: binding.edgeId }) }
        };
      });
    },
    waitForReview: async (input) => {
      await store.transaction(({ execution }) => {
        const create = optionalExecutionMethod(execution, "createReviewCheckpoint")
          ?? optionalExecutionMethod(execution, "waitForReview");
        if (create === undefined) {
          throw new ExecutorFailure(
            "REVIEW_PERSISTENCE_UNAVAILABLE",
            "The open Ether document does not support durable Compare checkpoints."
          );
        }
        return create(input);
      });
    }
  };
  return persistence;
}

function extensionForMediaType(mediaType: string): string {
  if (mediaType === "image/png") return ".png";
  if (mediaType === "image/jpeg") return ".jpg";
  if (mediaType === "image/webp") return ".webp";
  if (mediaType === "image/svg+xml") return ".svg";
  if (mediaType === "video/mp4") return ".mp4";
  if (mediaType === "audio/wav") return ".wav";
  return ".bin";
}

export function isSchedulerPersistence(value: unknown): value is SchedulerPersistence {
  return value !== null && typeof value === "object" &&
    typeof (value as { claimNext?: unknown }).claimNext === "function" &&
    typeof (value as { acceptCompletion?: unknown }).acceptCompletion === "function";
}

function requireExecutionMethod(execution: unknown, name: string): (input: Record<string, unknown>) => unknown {
  const method = optionalExecutionMethod(execution, name);
  if (method === undefined) {
    throw new ExecutorFailure(
      "EXECUTION_PERSISTENCE_UNAVAILABLE",
      `The open Ether document does not provide durable execution.${name}().`
    );
  }
  return method;
}

function optionalExecutionMethod(
  execution: unknown,
  name: string
): ((...args: unknown[]) => unknown) | undefined {
  if (execution === null || typeof execution !== "object") return undefined;
  const method = (execution as Record<string, unknown>)[name];
  return typeof method === "function" ? method.bind(execution) as (...args: unknown[]) => unknown : undefined;
}

function callMethod<T = unknown>(target: unknown, name: string, args: unknown[]): T {
  const method = optionalExecutionMethod(target, name);
  if (method === undefined) {
    throw new ExecutorFailure("EXECUTION_PERSISTENCE_UNAVAILABLE", `The open Ether document does not provide durable ${name}().`);
  }
  return method(...args) as T;
}

export type ProviderClaim = ClaimedExecution;
