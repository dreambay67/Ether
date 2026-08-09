import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { copyFile, mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import {
  importBlob,
  streamBlobRange,
  verifyExecutionEmbeddedReference,
  verifyExecutionReference,
  type ClaimedExecution,
  type DocumentStore
} from "@ether/document";
import { resolveOutputSelector } from "@ether/graph-kernel";
import {
  ConnectionRoleSchema,
  type ExecutionAttempt,
  type ExecutionWorkItem,
  OutputSelectorSchema,
  PayloadChannelSchema,
  type Artifact,
  type ExecutionJob,
  type NodeOutputVersion,
  type PayloadEnvelope
} from "@ether/schema";

import { ExecutorFailure, type ExecutorClaim, type LocalMediaOutput } from "../executors/types.js";

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
    identity: { platform: string; device: string; fileId: string };
    fingerprint: { byteLength: number; modifiedAt: number; sampleSha256: string };
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
    /** New plans bind the durable output which originally produced the artifact. */
    artifactSourceOutputVersionId?: string;
    contentKey: string;
    byteLength: number;
  });

export type SchedulerPersistence = {
  readonly documentId: string;
  readonly path: string;
  claimNext(jobId: string, claimToken: string): Promise<ExecutorClaim | undefined>;
  getJob(jobId: string): Promise<ExecutionJob | undefined>;
  cancelJob(jobId: string, commandId: string): Promise<ExecutionJob>;
  failAttempt(attemptId: string, code: string, message: string, retryable: boolean): Promise<boolean>;
  acceptProviderOutput(input: Record<string, unknown>): Promise<unknown>;
  acceptCompletion(input: Record<string, unknown>): Promise<unknown>;
  acceptLocalMediaOutput?(input: LocalMediaPersistenceInput): Promise<unknown>;
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
  waitForReview(input: {
    candidateOutputVersionIds: string[];
    claim: ExecutorClaim;
    selectionMode: "one" | "many";
    minimumSelections: number;
  }): Promise<void>;
};

export type DocumentStoreLike = {
  documentId: string;
  path: string;
  read<T>(operation: (repositories: { artifacts: unknown; execution: unknown; outputs: unknown }) => T): Promise<T>;
  transaction<T>(operation: (repositories: { execution: unknown; outputs: unknown }) => T): Promise<T>;
};

export type LocalMediaPersistenceInput = {
  claim: ExecutorClaim;
  outputs: Array<LocalMediaOutput & { artifactId: string; outputVersionId: string; payloadId: string }>;
  step: ExecutorClaim["plan"]["steps"][number];
  inputs: PayloadEnvelope[];
};

export function documentStorePersistence(store: DocumentStoreLike, appDataRoot?: string): SchedulerPersistence {
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
    acceptLocalMediaOutput: async (input) => acceptLocalMediaOutput(store as DocumentStore, input, appDataRoot),
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
      const bindings: Array<Record<string, unknown>> = Array.isArray(step.compiledContext.inputBindings)
        ? step.compiledContext.inputBindings.flatMap((binding) =>
          binding !== null && typeof binding === "object" && !Array.isArray(binding)
            ? [binding as Record<string, unknown>]
            : []
        )
        : [];
      const staticFilterRoutes = filterRoutesForStaticPayloads(step.id, bindings);
      const staticIds = [
        ...plannedWorkItem.inputs.map((input) => input.payloadId),
        ...step.inputPayloadIds,
        ...(step.resolvedInputBindings ?? []).map((binding) => binding.payloadId)
      ];
      const dynamic = await store.read(({ execution, outputs }) => bindings.flatMap((binding) => {
        const filterRoute = parseFilterRoute(step.id, binding);
        const sourceStepId = typeof binding.sourceStepId === "string" ? binding.sourceStepId : null;
        const sourceNodeId = typeof binding.sourceNodeId === "string" ? binding.sourceNodeId : null;
        const sourceChannel = PayloadChannelSchema.safeParse(binding.sourceChannel);
        const selector = OutputSelectorSchema.safeParse(binding.selector);
        if (sourceNodeId === null || !sourceChannel.success || !selector.success) {
          if (filterRoute !== undefined) {
            throw invalidFilterRoutePlan(step.id, "the input binding has no valid deterministic Filter source contract");
          }
          return [];
        }
        const sourceStep = sourceStepId === null
          ? undefined
          : claim.plan.steps.find((candidate) => candidate.id === sourceStepId);
        if (filterRoute !== undefined) {
          if (sourceStepId === null) {
            assertCachedFilterSource(step.id, binding, sourceNodeId);
          } else if (sourceStep?.executor !== "deterministic-filter") {
            throw invalidFilterRoutePlan(step.id, `filterRoute ${filterRoute} does not originate from deterministic Filter step ${sourceStepId}`);
          }
        }
        if (sourceStepId === null) {
          return [];
        }
        if (sourceStep?.executor === "human-checkpoint") {
          // Compare records its selected existing output versions on the durable
          // checkpoint rather than minting duplicate artifact payloads. Those
          // selections are the Compare step's runtime output for downstream
          // lanes, including Collection and Export.
          const checkpoint = callMethod<Array<{
            state: string;
            stepId: string;
            selectedOutputVersionIds: string[];
          }>>(execution, "listReviewCheckpoints", [claim.job.id])
            .find((candidate) => candidate.stepId === sourceStepId && candidate.state === "completed");
          if (checkpoint === undefined) return [];
          return checkpoint.selectedOutputVersionIds.flatMap((outputVersionId) => {
            const version = callMethod<import("@ether/schema").NodeOutputVersion | undefined>(
              outputs,
              "getVersion",
              [outputVersionId]
            );
            if (version === undefined) {
              throw new ExecutorFailure(
                "REVIEW_SELECTION_OUTPUT_MISSING",
                `Compare selected output version ${outputVersionId}, but it is no longer available.`
              );
            }
            return version.outputPayloadIds
              .map((payloadId) => callMethod<PayloadEnvelope | undefined>(outputs, "getPayload", [payloadId]))
              .filter((payload): payload is PayloadEnvelope => payload !== undefined && payload.channel === sourceChannel.data)
              .map((payload) => ({
                payload,
                role: typeof binding.role === "string" ? binding.role : payload.role,
                edgeId: typeof binding.edgeId === "string" ? binding.edgeId : undefined
              }));
          });
        }
        const versions = callMethod<import("@ether/schema").NodeOutputVersion[]>(outputs, "listByNode", [sourceNodeId])
          .filter((version) => version.runId === claim.job.id && version.stepId === sourceStepId);
        const payloads = versions
          .flatMap((version) => version.outputPayloadIds)
          .map((payloadId) => callMethod<PayloadEnvelope | undefined>(outputs, "getPayload", [payloadId]))
          .filter((payload): payload is PayloadEnvelope => payload !== undefined);
        // A newly compiled singleton Join seals an entire upstream batch into
        // one work item. It needs per-dependency selection and plan-ordinal
        // ordering to preserve that pool. Expanded Join work items in older
        // immutable capsules retain the ordinary, global edge-selector
        // contract (for example, `latest` remains one newest version).
        const batchBoundaryJoin = isSingletonBatchBoundaryJoin(step, plannedWorkItem);
        const selected = batchBoundaryJoin
          ? resolveJoinInputVersions({
              claim,
              channel: sourceChannel.data,
              execution,
              payloads,
              plannedWorkItem,
              selector: selector.data,
              sourceStepId,
              versions
            })
          : resolveOutputSelector({
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
        const orderedVersions = batchBoundaryJoin
          ? orderJoinInputVersions({ claim, execution, plannedWorkItem, sourceStepId, versions })
          : versions;
        return orderedVersions
          .filter((version) => selectedVersions.has(version.id))
          .flatMap((version) => version.outputPayloadIds)
          .map((payloadId) => payloads.find((payload) => payload.id === payloadId))
          .filter((payload): payload is PayloadEnvelope => payload !== undefined && payload.channel === sourceChannel.data)
          .filter((payload) => filterRoute === undefined || payload.metadata.filterMatched === (filterRoute === "matched"))
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
      const runtimeInputs = resolved
        .filter((payload) => matchesStaticFilterRoute(payload, staticFilterRoutes))
        .map((payload) => {
        const binding = dynamicById.get(payload.id);
        return binding === undefined ? payload : {
          ...payload,
          role: binding.role as PayloadEnvelope["role"],
          source: { ...payload.source, ...(binding.edgeId === undefined ? {} : { edgeId: binding.edgeId }) }
        };
      });
      const referenceInputs = await materializePlanReferences(store, claim, step, stagingDirectory);
      return [...runtimeInputs, ...referenceInputs];
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

type FilterRoute = "matched" | "unmatched";
type StaticFilterRoutes = ReadonlyMap<string, readonly FilterRoute[]>;

/**
 * Filter route markers are a new immutable plan contract. In their absence,
 * historical capsules keep the prior selector-only behavior.
 */
function parseFilterRoute(stepId: string, binding: Record<string, unknown>): FilterRoute | undefined {
  if (!Object.prototype.hasOwnProperty.call(binding, "filterRoute")) return undefined;
  const route = binding.filterRoute;
  if (route === "matched" || route === "unmatched") return route;
  throw invalidFilterRoutePlan(stepId, "filterRoute must be matched or unmatched");
}

function filterRoutesForStaticPayloads(
  stepId: string,
  bindings: readonly Record<string, unknown>[]
): StaticFilterRoutes {
  const routes = new Map<string, FilterRoute[]>();
  for (const binding of bindings) {
    const route = parseFilterRoute(stepId, binding);
    if (route === undefined) continue;
    for (const payloadId of filterRouteSourcePayloadIds(stepId, binding)) {
      const existing = routes.get(payloadId) ?? [];
      if (!existing.includes(route)) routes.set(payloadId, [...existing, route]);
    }
  }
  return routes;
}

function filterRouteSourcePayloadIds(stepId: string, binding: Record<string, unknown>): string[] {
  const payloadIds = binding.sourcePayloadIds;
  // A live Filter input resolves from its step output at execution time, so
  // older capsules need not carry a static source list. A cached boundary is
  // different: without those sealed IDs it cannot be routed truthfully.
  if (payloadIds === undefined && binding.sourceStepId !== null) return [];
  if (!Array.isArray(payloadIds) || !payloadIds.every((id) => typeof id === "string" && id.length > 0)) {
    throw invalidFilterRoutePlan(stepId, "filterRoute must seal its source payload IDs");
  }
  return payloadIds;
}

function assertCachedFilterSource(
  stepId: string,
  binding: Record<string, unknown>,
  sourceNodeId: string
): void {
  const source = binding.filterSource;
  if (
    binding.sourceStepId !== null ||
    source === null ||
    typeof source !== "object" ||
    Array.isArray(source) ||
    (source as Record<string, unknown>).nodeId !== sourceNodeId ||
    (source as Record<string, unknown>).definitionId !== "review.filter" ||
    (source as Record<string, unknown>).executor !== "deterministic-filter"
  ) {
    throw invalidFilterRoutePlan(
      stepId,
      "a cached Filter route must seal its review.filter/deterministic-filter source identity"
    );
  }
}

function matchesStaticFilterRoute(payload: PayloadEnvelope, routes: StaticFilterRoutes): boolean {
  const expectedRoutes = routes.get(payload.id);
  if (expectedRoutes === undefined) return true;
  return expectedRoutes.some((route) => payload.metadata.filterMatched === (route === "matched"));
}

function invalidFilterRoutePlan(stepId: string, detail: string): ExecutorFailure {
  return new ExecutorFailure(
    "FILTER_ROUTE_PLAN_CONTRACT_INVALID",
    `Step ${stepId} has an invalid Filter route binding: ${detail}.`
  );
}

function isSingletonBatchBoundaryJoin(
  step: Pick<ExecutorClaim["plan"]["steps"][number], "executor" | "dependencyStepIds">,
  plannedWorkItem: import("@ether/schema").PlannedWorkItem
): boolean {
  return step.executor === "join" &&
    (plannedWorkItem.dependencyWorkItemIds?.length ?? 0) > step.dependencyStepIds.length;
}

function resolveJoinInputVersions(input: {
  claim: ExecutorClaim;
  channel: PayloadEnvelope["channel"];
  execution: unknown;
  payloads: readonly PayloadEnvelope[];
  plannedWorkItem: import("@ether/schema").PlannedWorkItem;
  selector: { kind: "latest-approved" | "latest" | "all" | "pinned"; outputVersionId?: string };
  sourceStepId: string;
  versions: readonly NodeOutputVersion[];
}): { versionIds: string[]; diagnostics: Array<{ code: string; message: string }> } {
  const state = joinSourceState(input);
  if (state.acceptedWorkItemIds.size !== state.expectedCount) {
    return { versionIds: [], diagnostics: [{ code: "JOIN_INPUT_INCOMPLETE", message: "Join is waiting for every dependency work item to be accepted." }] };
  }
  const versions = orderJoinInputVersions(input, state).filter((version) =>
    version.outputPayloadIds.some((payloadId) => {
      const payload = input.payloads.find((candidate) => candidate.id === payloadId);
      return payload?.channel === input.channel;
    })
  );
  if (input.selector.kind === "pinned") {
    const pinned = versions.find((version) => version.id === input.selector.outputVersionId);
    return pinned === undefined
      ? { versionIds: [], diagnostics: [{ code: "PINNED_VERSION_NOT_FOUND", message: "Pinned output version is not an eligible Join dependency." }] }
      : { versionIds: [pinned.id], diagnostics: [] };
  }
  const byWorkItem = new Map([...state.acceptedWorkItemIds].map((id) => [id, [] as NodeOutputVersion[]]));
  for (const version of versions) {
    if (version.workItemId === null) continue;
    byWorkItem.set(version.workItemId, [...(byWorkItem.get(version.workItemId) ?? []), version]);
  }
  if ([...byWorkItem.values()].some((candidates) => candidates.length === 0)) {
    return { versionIds: [], diagnostics: [{ code: "JOIN_INPUT_INCOMPLETE", message: "Join requires a matching output from every dependency work item." }] };
  }
  if (input.selector.kind === "all") return { versionIds: versions.map((version) => version.id), diagnostics: [] };
  const selected = [...byWorkItem.values()].flatMap((candidates) => {
    const eligible = input.selector.kind === "latest-approved"
      ? candidates.filter((version) => version.approval.state === "approved")
      : candidates;
    return eligible.at(-1) === undefined ? [] : [eligible.at(-1)!];
  });
  return selected.length === state.expectedCount
    ? { versionIds: selected.map((version) => version.id), diagnostics: [] }
    : { versionIds: [], diagnostics: [{ code: "NO_APPROVED_OUTPUT", message: "Join requires one eligible output from every dependency work item." }] };
}

/**
 * A Join is a cardinality reset, so its runtime pool is deliberately derived
 * from the exact dependency work items sealed into its singleton planned item.
 * This keeps retries and concurrent completions from changing candidate order.
 */
function orderJoinInputVersions(input: {
  claim: ExecutorClaim;
  execution: unknown;
  plannedWorkItem: import("@ether/schema").PlannedWorkItem;
  sourceStepId: string;
  versions: readonly NodeOutputVersion[];
}, state = joinSourceState(input)): NodeOutputVersion[] {
  return input.versions
    .filter((version) =>
      version.workItemId !== null &&
      state.acceptedWorkItemIds.has(version.workItemId) &&
      version.attemptId !== null &&
      state.acceptedAttemptIds.has(version.attemptId) &&
      state.acceptedOutputVersionIds.has(version.id)
    )
    .slice()
    .sort((left, right) => {
      const leftPlanned = left.workItemId === null ? undefined : state.durableToPlanned.get(left.workItemId);
      const rightPlanned = right.workItemId === null ? undefined : state.durableToPlanned.get(right.workItemId);
      const sourceOrder = (state.plannedOrdinal.get(leftPlanned ?? "") ?? Number.MAX_SAFE_INTEGER) -
        (state.plannedOrdinal.get(rightPlanned ?? "") ?? Number.MAX_SAFE_INTEGER);
      if (sourceOrder !== 0) return sourceOrder;
      const retryOrder = (state.attemptOrdinal.get(left.attemptId ?? "") ?? Number.MAX_SAFE_INTEGER) -
        (state.attemptOrdinal.get(right.attemptId ?? "") ?? Number.MAX_SAFE_INTEGER);
      if (retryOrder !== 0) return retryOrder;
      const outputPosition = (state.outputOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
        (state.outputOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER);
      return outputPosition || left.id.localeCompare(right.id);
    });
}

function joinSourceState(input: {
  claim: ExecutorClaim;
  execution: unknown;
  plannedWorkItem: import("@ether/schema").PlannedWorkItem;
  sourceStepId: string;
}) {
  const dependencyIds = new Set(input.plannedWorkItem.dependencyWorkItemIds ?? []);
  const sourcePlanned = input.claim.plan.workItems.filter((item) =>
    dependencyIds.has(item.id) && item.stepId === input.sourceStepId
  );
  const plannedOrdinal = new Map(sourcePlanned.map((item) => [item.id, item.ordinal]));
  const workItems = callMethod<ExecutionWorkItem[]>(input.execution, "listWorkItems", [input.claim.job.id]);
  const durableToPlanned = new Map(workItems.map((work) => [work.id, work.plannedWorkItemId]));
  const acceptedWorkItemIds = new Set(workItems
    .filter((work) => work.status === "accepted" && plannedOrdinal.has(work.plannedWorkItemId))
    .map((work) => work.id));
  const attempts = callMethod<ExecutionAttempt[]>(input.execution, "listAttempts", [input.claim.job.id]);
  const outputOrder = new Map<string, number>();
  const attemptOrdinal = new Map<string, number>();
  const acceptedAttemptIds = new Set<string>();
  const acceptedOutputVersionIds = new Set<string>();
  for (const attempt of attempts) {
    if (attempt.status !== "accepted" || !acceptedWorkItemIds.has(attempt.workItemId)) continue;
    acceptedAttemptIds.add(attempt.id);
    attemptOrdinal.set(attempt.id, attempt.ordinal);
    attempt.outputVersionIds.forEach((id, index) => {
      acceptedOutputVersionIds.add(id);
      outputOrder.set(id, index);
    });
  }
  return {
    acceptedAttemptIds,
    acceptedOutputVersionIds,
    acceptedWorkItemIds,
    attemptOrdinal,
    durableToPlanned,
    expectedCount: sourcePlanned.length,
    outputOrder,
    plannedOrdinal
  };
}

async function acceptLocalMediaOutput(
  store: DocumentStore,
  input: LocalMediaPersistenceInput,
  appDataRoot: string | undefined
): Promise<unknown> {
  const importedContentKeys: string[] = [];
  try {
    const imported: Array<{
      output: LocalMediaPersistenceInput["outputs"][number];
      blob: Awaited<ReturnType<typeof importBlob>>;
    }> = [];
    for (const output of input.outputs) {
      const source = { sourcePath: output.stagedPath, mediaType: output.mediaType };
      const blob = appDataRoot === undefined
        ? await importBlob(store, source)
        : await importBlob(store, source, { appDataRoot });
      importedContentKeys.push(blob.contentKey);
      imported.push({ output, blob });
    }
    const completedAt = new Date().toISOString();
    return store.transaction(({ execution }) => execution.acceptCompletion({
      claim: input.claim as ClaimedExecution,
      outputs: imported.map(({ output, blob }, ordinal) => {
        const version: NodeOutputVersion = {
          id: output.outputVersionId,
          nodeId: input.step.nodeId,
          graphId: input.claim.plan.graphId,
          graphRevisionId: input.claim.plan.graphRevisionId,
          inputPayloadIds: input.inputs.map((payload) => payload.id),
          selectedOutputVersionIds: unique(input.inputs.map((payload) => payload.source.outputVersionId)),
          compiledContextHash: input.claim.plan.contentHash,
          producer: { kind: "local", executor: input.step.executor },
          outputPayloadIds: [output.payloadId],
          parentOutputVersionId: null,
          approval: input.step.parameters.reviewPolicy === "auto-apply"
            ? { state: "approved", actor: "system", at: completedAt }
            : { state: "unreviewed" },
          runId: input.claim.job.id,
          stepId: input.step.id,
          workItemId: input.claim.workItem.id,
          attemptId: input.claim.attempt.id,
          timing: { startedAt: input.claim.attempt.startedAt ?? input.claim.attempt.createdAt, completedAt },
          failure: null,
          createdAt: completedAt
        };
        const payload: PayloadEnvelope = {
          id: output.payloadId,
          channel: output.channel,
          role: output.role,
          content: { kind: "artifact", artifactId: output.artifactId },
          source: {
            nodeId: input.step.nodeId,
            outputVersionId: output.outputVersionId,
            lineageKey: `${input.claim.plan.graphId}:${input.step.nodeId}:${input.claim.workItem.id}:${ordinal}`
          },
          metadata: { mediaType: output.mediaType, ...(output.metadata ?? {}) }
        };
        const artifact: Artifact = {
          id: output.artifactId,
          contentKey: blob.contentKey,
          channel: output.channel,
          mediaType: output.mediaType,
          byteLength: blob.byteLength,
          source: { outputVersionId: output.outputVersionId, payloadId: output.payloadId },
          createdAt: completedAt,
          metadata: {
            title: output.fileName,
            localMediaOperation: input.step.executor === "mask" ? "mask" : input.step.parameters.operation,
            ...(output.metadata ?? {})
          }
        };
        return { version, payloads: [payload], artifacts: [artifact] };
      })
    }));
  } catch (error) {
    if (importedContentKeys.length > 0) {
      try {
        await store.reclaimUnreferencedReadyBlobs(importedContentKeys);
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          "Local media output acceptance failed and its unreferenced blobs could not be reclaimed.",
          { cause: cleanupError }
        );
      }
    }
    throw error;
  }
}

async function materializePlanReferences(
  store: DocumentStoreLike,
  claim: ExecutorClaim,
  step: ExecutorClaim["plan"]["steps"][number],
  stagingDirectory: string
): Promise<PayloadEnvelope[]> {
  const bindings = planReferenceInputs(step);
  if (bindings.length === 0) return [];
  const assetRoot = await referenceAssetRoot(stagingDirectory);
  const resolved: PayloadEnvelope[] = [];
  for (const binding of bindings) {
    const assetPath = path.join(
      assetRoot,
      `${createHash("sha256").update(binding.id).digest("hex")}${extensionForMediaType(binding.mediaType)}`
    );
    let material: ReferenceMaterial;
    if (binding.memberKind === "linked-reference") {
      try {
        await verifyExecutionReference(store as DocumentStore, { ...binding, id: binding.referenceId });
        await copyFile(binding.originalPath, assetPath);
        material = {
          byteLength: binding.fingerprint.byteLength,
          contentKey: null,
          fingerprint: binding.fingerprint
        };
      } catch (error) {
        const code = typeof error === "object" && error !== null && "code" in error
          ? String((error as { code?: unknown }).code)
          : "REFERENCE_SOURCE_UNAVAILABLE";
        throw new ExecutorFailure(
          code,
          `Reference Set member ${binding.referenceId} cannot be materialized for step ${step.id}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    } else if (binding.memberKind === "embedded-reference") {
      try {
        await verifyExecutionEmbeddedReference(store as DocumentStore, { ...binding, id: binding.referenceId });
        await pipeline(
          Readable.from(streamBlobRange(store as DocumentStore, binding.contentKey, 0, binding.byteLength)),
          createWriteStream(assetPath, { flags: "w" })
        );
      } catch (error) {
        const code = typeof error === "object" && error !== null && "code" in error
          ? String((error as { code?: unknown }).code)
          : "REFERENCE_SOURCE_UNAVAILABLE";
        throw new ExecutorFailure(
          code,
            `Embedded Reference Set member ${binding.referenceId} cannot be materialized for step ${step.id}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
      material = {
        byteLength: binding.byteLength,
        contentKey: binding.contentKey,
        fingerprint: null
      };
    } else {
      const artifact = await store.read(({ artifacts }) => callMethod<Artifact | undefined>(artifacts, "get", [binding.artifactId]));
      if (
        artifact === undefined ||
        artifact.contentKey !== binding.contentKey ||
        artifact.byteLength !== binding.byteLength ||
        artifact.mediaType !== binding.mediaType ||
        artifact.channel !== binding.channel ||
        (binding.artifactSourceOutputVersionId !== undefined &&
          artifact.source.outputVersionId !== binding.artifactSourceOutputVersionId)
      ) {
        throw new ExecutorFailure(
          "REFERENCE_ARTIFACT_SNAPSHOT_STALE",
          `Reference Set artifact ${binding.artifactId} no longer matches the immutable execution plan.`
        );
      }
      await pipeline(
        Readable.from(streamBlobRange(store as DocumentStore, artifact.contentKey, 0, artifact.byteLength)),
        createWriteStream(assetPath, { flags: "w" })
      );
      material = {
        assetId: artifact.id,
        byteLength: artifact.byteLength,
        contentKey: artifact.contentKey,
        fingerprint: null
      };
    }
    const payload = await persistReferenceMaterial(
      store as DocumentStore,
      claim,
      binding,
      material
    );
    resolved.push({ ...payload, metadata: { ...payload.metadata, assetPath } });
  }
  return resolved;
}

type ReferenceMaterial = {
  assetId?: string;
  byteLength: number;
  contentKey: string | null;
  fingerprint: { byteLength: number; modifiedAt: number; sampleSha256: string } | null;
};

async function persistReferenceMaterial(
  store: DocumentStore,
  claim: ExecutorClaim,
  binding: ReferenceInputBinding,
  material: ReferenceMaterial
): Promise<PayloadEnvelope> {
  const now = new Date().toISOString();
  return store.transaction(({ outputs }) => {
    const existing = outputs.getPayload(binding.payloadId);
    if (existing !== undefined) {
      if (
        existing.source.nodeId !== binding.sourceNodeId ||
        existing.source.outputVersionId !== binding.id ||
        existing.source.edgeId !== binding.edgeId
      ) {
        throw new ExecutorFailure(
          "REFERENCE_PLAN_CONTRACT_INVALID",
          `Reference Set payload ${binding.payloadId} conflicts with a different durable source.`
        );
      }
      return existing;
    }
    const payload: PayloadEnvelope = {
      id: binding.payloadId,
      channel: binding.channel,
      role: binding.role,
      content: binding.memberKind === "embedded-artifact"
        ? { kind: "artifact", artifactId: material.assetId! }
        : {
          kind: "object",
          value: {
            kind: "reference-material",
            referenceId: binding.referenceId,
            contentKey: material.contentKey,
            byteLength: material.byteLength,
            mediaType: binding.mediaType,
            fingerprint: material.fingerprint
          }
        },
      source: {
        nodeId: binding.sourceNodeId,
        outputVersionId: binding.id,
        edgeId: binding.edgeId,
        lineageKey: `${claim.plan.id}:${binding.id}`
      },
      metadata: {
        mediaType: binding.mediaType,
        referenceBindingId: binding.id,
        referenceMemberKind: binding.memberKind,
        referenceOrder: binding.order,
        referenceByteLength: material.byteLength,
        ...(material.contentKey === null ? {} : { referenceContentKey: material.contentKey }),
        ...(material.fingerprint === null ? {} : {
          referenceFingerprintByteLength: material.fingerprint.byteLength,
          referenceFingerprintModifiedAt: material.fingerprint.modifiedAt,
          referenceFingerprintSampleSha256: material.fingerprint.sampleSha256
        }),
        ...(binding.memberKind === "embedded-artifact"
          ? {
              referenceArtifactId: binding.artifactId,
              ...(binding.artifactSourceOutputVersionId === undefined
                ? {}
                : { referenceArtifactSourceOutputVersionId: binding.artifactSourceOutputVersionId })
            }
          : { referenceId: binding.referenceId })
      }
    };
    const version: NodeOutputVersion = {
      id: binding.id,
      nodeId: binding.sourceNodeId,
      graphId: claim.plan.graphId,
      graphRevisionId: claim.plan.graphRevisionId,
      inputPayloadIds: [],
      selectedOutputVersionIds: binding.memberKind === "embedded-artifact" && binding.artifactSourceOutputVersionId !== undefined
        ? [binding.artifactSourceOutputVersionId]
        : [],
      compiledContextHash: claim.plan.contentHash,
      producer: { kind: "local", executor: "asset-resolution" },
      outputPayloadIds: [payload.id],
      parentOutputVersionId: null,
      approval: { state: "approved", actor: "system", at: now },
      runId: null,
      stepId: null,
      workItemId: null,
      attemptId: null,
      timing: { startedAt: now, completedAt: now },
      failure: null,
      createdAt: now
    };
    outputs.insert(version, [payload]);
    return payload;
  });
}

function planReferenceInputs(step: ExecutorClaim["plan"]["steps"][number]): ReferenceInputBinding[] {
  const value = step.compiledContext.referenceInputs;
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    return invalidReferencePlan(step.id);
  }
  return value
    .map((candidate) => parseReferenceInputBinding(step.id, candidate))
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
}

function parseReferenceInputBinding(stepId: string, value: unknown): ReferenceInputBinding {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return invalidReferencePlan(stepId);
  const record = value as Record<string, unknown>;
  const channel = PayloadChannelSchema.safeParse(record.channel);
  const role = ConnectionRoleSchema.safeParse(record.role);
  const base: ReferenceInputBindingBase = {
    id: requiredReferenceString(stepId, record.id),
    edgeId: requiredReferenceString(stepId, record.edgeId),
    sourceNodeId: requiredReferenceString(stepId, record.sourceNodeId),
    payloadId: requiredReferenceString(stepId, record.payloadId),
    channel: channel.success ? channel.data : invalidReferencePlan(stepId),
    role: role.success ? role.data : invalidReferencePlan(stepId),
    order: nonnegativeReferenceInteger(stepId, record.order),
    displayName: requiredReferenceString(stepId, record.displayName),
    mediaType: requiredReferenceString(stepId, record.mediaType)
  };
  if (record.memberKind === "linked-reference") {
    const identity = referenceRecord(stepId, record.identity);
    const fingerprint = referenceRecord(stepId, record.fingerprint);
    return {
      ...base,
      memberKind: "linked-reference",
      referenceId: requiredReferenceString(stepId, record.referenceId),
      originalPath: requiredReferenceString(stepId, record.originalPath),
      pathGrantId: requiredReferenceString(stepId, record.pathGrantId),
      identity: {
        platform: requiredReferenceString(stepId, identity.platform),
        device: requiredReferenceString(stepId, identity.device),
        fileId: requiredReferenceString(stepId, identity.fileId)
      },
      fingerprint: {
        byteLength: nonnegativeReferenceInteger(stepId, fingerprint.byteLength),
        modifiedAt: nonnegativeReferenceNumber(stepId, fingerprint.modifiedAt),
        sampleSha256: contentKey(stepId, fingerprint.sampleSha256)
      }
    };
  }
  if (record.memberKind === "embedded-reference") {
    return {
      ...base,
      memberKind: "embedded-reference",
      referenceId: requiredReferenceString(stepId, record.referenceId),
      contentKey: contentKey(stepId, record.contentKey),
      byteLength: nonnegativeReferenceInteger(stepId, record.byteLength)
    };
  }
  if (record.memberKind === "embedded-artifact") {
    const artifactSourceOutputVersionId = optionalReferenceString(stepId, record.artifactSourceOutputVersionId);
    return {
      ...base,
      memberKind: "embedded-artifact",
      artifactId: requiredReferenceString(stepId, record.artifactId),
      ...(artifactSourceOutputVersionId === undefined ? {} : { artifactSourceOutputVersionId }),
      contentKey: contentKey(stepId, record.contentKey),
      byteLength: nonnegativeReferenceInteger(stepId, record.byteLength)
    };
  }
  return invalidReferencePlan(stepId);
}

function requiredReferenceString(stepId: string, value: unknown): string {
  return typeof value === "string" && value.length > 0 ? value : invalidReferencePlan(stepId);
}

/** Optional only to retain executable plan capsules sealed before source binding existed. */
function optionalReferenceString(stepId: string, value: unknown): string | undefined {
  if (value === undefined) return undefined;
  return requiredReferenceString(stepId, value);
}

function nonnegativeReferenceInteger(stepId: string, value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : invalidReferencePlan(stepId);
}

function nonnegativeReferenceNumber(stepId: string, value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : invalidReferencePlan(stepId);
}

function contentKey(stepId: string, value: unknown): string {
  const key = requiredReferenceString(stepId, value);
  return /^[a-f0-9]{64}$/i.test(key) ? key : invalidReferencePlan(stepId);
}

function referenceRecord(stepId: string, value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : invalidReferencePlan(stepId);
}

function invalidReferencePlan(stepId: string): never {
  throw new ExecutorFailure("REFERENCE_PLAN_CONTRACT_INVALID", `Step ${stepId} has an invalid Reference Set plan binding.`);
}

async function referenceAssetRoot(stagingDirectory: string): Promise<string> {
  const assetRoot = path.join(stagingDirectory, "resolved-references");
  await mkdir(assetRoot, { recursive: true });
  const canonicalStaging = await realpath(stagingDirectory);
  const canonicalAssetRoot = await realpath(assetRoot);
  const relative = path.relative(canonicalStaging, canonicalAssetRoot);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new ExecutorFailure(
      "INPUT_ASSET_PATH_INVALID",
      "Resolved Reference Set assets must remain inside the scheduler-owned attempt staging directory."
    );
  }
  return canonicalAssetRoot;
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

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
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
