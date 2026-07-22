import type { ClaimedExecution } from "@ether/document";
import type { ExecutionJob, PayloadEnvelope } from "@ether/schema";

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
  resolvePayloads(payloadIds: readonly string[]): Promise<PayloadEnvelope[]>;
  waitForReview(input: { claim: ExecutorClaim; selectionMode: "one" | "many"; minimumSelections: number }): Promise<void>;
};

export type DocumentStoreLike = {
  documentId: string;
  path: string;
  read<T>(operation: (repositories: { execution: unknown; outputs: unknown }) => T): Promise<T>;
  transaction<T>(operation: (repositories: { execution: unknown; outputs: unknown }) => T): Promise<T>;
};

export function documentStorePersistence(store: DocumentStoreLike): SchedulerPersistence {
  return {
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
    resolvePayloads: (payloadIds) => store.read(({ outputs }) =>
      payloadIds.map((id) => callMethod<PayloadEnvelope | undefined>(outputs, "getPayload", [id]))
        .filter((value): value is PayloadEnvelope => value !== undefined)
    ),
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
