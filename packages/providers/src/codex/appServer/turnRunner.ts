import path from "node:path";

import type { CodexAppServerClient } from "./client.js";
import {
  CODEX_APP_SERVER_MANIFEST_SHA256,
  CODEX_APP_SERVER_VERSION,
  type CodexTurnResult,
  type CodexUserInput,
  type JsonObject
} from "./protocol.js";
import {
  CodexAppServerSessionPool,
  type CodexClientGeneration
} from "./sessionPool.js";

export type CodexTurnImageInput =
  | { kind: "local-image"; value: string; detail?: "low" | "high" | "auto" }
  | { kind: "data-url"; value: string; detail?: "low" | "high" | "auto" };

export type CodexTurnRunnerRequest = {
  documentId: string;
  memoryScopeKey: string | null;
  cwd: string;
  prompt: string;
  images?: CodexTurnImageInput[];
  outputSchema?: JsonObject;
  model?: string;
  reasoningEffort?: string;
  onEvent?: (event: import("./protocol.js").CodexAppServerEvent) => void;
  signal?: AbortSignal;
  interruptCompletionTimeoutMs?: number;
  timeoutMs?: number;
};

export type CodexTurnProvenance = {
  transport: "app-server";
  version: string;
  reportedVersion: string | null;
  manifestHash: string;
  generation: number;
  threadId: string;
  turnId: string;
  timing: {
    queueMs: number;
    dispatchToFirstEventMs: number;
    generationMs: number;
    totalMs: number;
  };
};

export type CodexTurnRunnerResult = CodexTurnResult & {
  structuredOutput?: unknown;
  provenance: CodexTurnProvenance;
};

export class CodexImageInputError extends Error {
  readonly code = "CODEX_IMAGE_INPUT_INVALID";
  readonly category = "invalid-input" as const;
  readonly retryable = false;

  constructor(message: string) {
    super(message);
    this.name = "CodexImageInputError";
  }
}

export class CodexAppServerTurnRunner {
  constructor(
    private readonly getClientGeneration: () => CodexClientGeneration,
    private readonly sessions: CodexAppServerSessionPool
  ) {}

  async run(request: CodexTurnRunnerRequest): Promise<CodexTurnRunnerResult> {
    if (!request.prompt.trim()) throw new CodexImageInputError("Codex turn prompt must not be blank.");
    if (request.signal?.aborted) throw abortError("Codex turn was cancelled before dispatch.");
    const startedAt = Date.now();
    const inputs = buildInputs(request.prompt, request.images ?? []);
    return this.sessions.withThread(
      { documentId: request.documentId, memoryScopeKey: request.memoryScopeKey },
      { cwd: request.cwd, model: request.model, reasoningEffort: request.reasoningEffort },
      async (threadId) => {
        const dispatchAt = Date.now();
        const current = this.getClientGeneration();
        let firstEventAt: number | null = null;
        const result = await current.client.runTurn({
          threadId,
          input: inputs,
          outputSchema: request.outputSchema,
          effort: request.reasoningEffort,
          model: request.model,
          onEvent: (event) => {
            firstEventAt ??= event.receivedAt;
            request.onEvent?.(event);
          },
          signal: request.signal,
          interruptCompletionTimeoutMs: request.interruptCompletionTimeoutMs,
          timeoutMs: request.timeoutMs
        });
        const completedAt = Date.now();
        const observedFirstEventAt = firstEventAt ?? completedAt;
        const structuredOutput = request.outputSchema ? parseStructuredOutput(result.text) : undefined;
        return {
          ...result,
          ...(request.outputSchema ? { structuredOutput } : {}),
          provenance: {
            transport: "app-server" as const,
            version: CODEX_APP_SERVER_VERSION,
            reportedVersion: current.reportedVersion ?? null,
            manifestHash: CODEX_APP_SERVER_MANIFEST_SHA256,
            generation: current.generation,
            threadId,
            turnId: result.turnId,
            timing: {
              queueMs: Math.max(0, dispatchAt - startedAt),
              dispatchToFirstEventMs: Math.max(0, observedFirstEventAt - dispatchAt),
              generationMs: Math.max(0, completedAt - observedFirstEventAt),
              totalMs: Math.max(0, completedAt - startedAt)
            }
          }
        };
      }
    );
  }
}

function buildInputs(prompt: string, images: CodexTurnImageInput[]): CodexUserInput[] {
  const input: CodexUserInput[] = [{ type: "text", text: prompt }];
  for (const image of images) {
    if (image.kind === "local-image") {
      if (!path.isAbsolute(image.value)) {
        throw new CodexImageInputError("Codex local image input must use an absolute path.");
      }
      input.push({ type: "localImage", path: path.normalize(image.value), ...(image.detail ? { detail: image.detail } : {}) });
      continue;
    }
    if (!/^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/i.test(image.value)) {
      throw new CodexImageInputError("Codex data URL input must contain a supported base64 image MIME type.");
    }
    input.push({ type: "image", url: image.value, ...(image.detail ? { detail: image.detail } : {}) });
  }
  return input;
}

function parseStructuredOutput(text: string) {
  try {
    return JSON.parse(text);
  } catch (error) {
    const failure = new Error(
      `Codex structured output was not valid JSON: ${error instanceof Error ? error.message : "parse failed"}`,
      { cause: error }
    ) as Error & { code: string; category: "malformed-output"; retryable: boolean };
    failure.code = "CODEX_STRUCTURED_OUTPUT_INVALID";
    failure.category = "malformed-output";
    failure.retryable = false;
    throw failure;
  }
}

function abortError(message: string) {
  const error = new Error(message) as Error & { code: string; category: "cancellation"; retryable: boolean };
  error.name = "AbortError";
  error.code = "CODEX_APP_SERVER_CANCELLED";
  error.category = "cancellation";
  error.retryable = false;
  return error;
}

export type { CodexAppServerClient };
