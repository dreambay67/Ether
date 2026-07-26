import type { Readable, Writable } from "node:stream";
import { StringDecoder } from "node:string_decoder";

import {
  CodexAppServerOperationError,
  CodexAppServerProtocolError,
  CodexAppServerRequestError,
  mapCodexAppServerError,
  parseAppServerMessage,
  isRecord,
  stringField,
  type AppServerMessage,
  type AppServerNotification,
  type AppServerRequest,
  type CodexAppServerFailureCategory,
  type CodexAppServerEvent,
  type CodexImageGenerationEvent,
  type CodexModel,
  type CodexTurnResult,
  type CodexUserInput,
  type JsonObject
} from "./protocol.js";

export { CodexAppServerOperationError } from "./protocol.js";
export type { CodexAppServerFailureCategory } from "./protocol.js";

const defaultMaxFrameBytes = 32 * 1024 * 1024;

type ClientOptions = {
  stdin: Writable;
  stdout: Readable;
  stderr?: Readable;
  close?: () => void | Promise<void>;
  maxFrameBytes?: number;
  maxEvents?: number;
  maxToolEvents?: number;
  maxTextBytes?: number;
  maxStderrBytes?: number;
  maxDiagnosticBytes?: number;
  maxEventBytes?: number;
  maxToolBytes?: number;
  maxTextItems?: number;
  maxBacklogKeys?: number;
  maxBacklogBytes?: number;
  requestTimeoutMs?: number;
  turnTimeoutMs?: number;
  maxModelPages?: number;
  maxModels?: number;
  maxModelBytes?: number;
  maxModelCursorBytes?: number;
  modelDiscoveryTimeoutMs?: number;
};

type PendingRequest = {
  method: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer?: ReturnType<typeof setTimeout>;
};

type TurnState = {
  threadId: string;
  turnId: string;
  startedAt: number;
  onEvent?: (event: CodexAppServerEvent) => void;
  signal?: AbortSignal;
  abortListener?: () => void;
  interruptCompletionTimeoutMs: number;
  interruptTimer?: ReturnType<typeof setTimeout>;
  deadlineTimer?: ReturnType<typeof setTimeout>;
  completionReason: "cancel" | "timeout" | null;
  settled: boolean;
  textBytes: number;
  diagnosticBytes: number;
  eventBytes: number;
  toolBytes: number;
  textByItem: Map<string, string>;
  finalText: string | null;
  warnings: string[];
  errors: string[];
  events: CodexAppServerEvent[];
  toolEvents: JsonObject[];
  imageViews: string[];
  imageGenerations: CodexImageGenerationEvent[];
  unknownEvents: CodexAppServerEvent[];
  failure: CodexAppServerOperationError | null;
  truncated: CodexTurnResult["truncated"];
  resolve: (result: CodexTurnResult) => void;
  reject: (error: Error) => void;
};

export type InitializeOptions = {
  clientName?: string;
  clientVersion?: string;
};

export type ModelListOptions = {
  includeHidden?: boolean;
  pageSize?: number;
};

export type ThreadStartOptions = {
  cwd: string;
  model?: string;
  reasoningEffort?: string;
};

export type RunTurnOptions = {
  threadId: string;
  input: CodexUserInput[];
  outputSchema?: JsonObject;
  effort?: string;
  model?: string;
  onEvent?: (event: CodexAppServerEvent) => void;
  signal?: AbortSignal;
  interruptCompletionTimeoutMs?: number;
  timeoutMs?: number;
};

export class CodexAppServerClient {
  private readonly stdin: Writable;
  private readonly stdout: Readable;
  private readonly stderr: Readable | undefined;
  private readonly closeTransport: (() => void | Promise<void>) | undefined;
  private readonly maxFrameBytes: number;
  private readonly maxEvents: number;
  private readonly maxToolEvents: number;
  private readonly maxTextBytes: number;
  private readonly maxStderrBytes: number;
  private readonly maxDiagnosticBytes: number;
  private readonly maxEventBytes: number;
  private readonly maxToolBytes: number;
  private readonly maxTextItems: number;
  private readonly maxBacklogKeys: number;
  private readonly maxBacklogBytes: number;
  private readonly requestTimeoutMs: number;
  private readonly turnTimeoutMs: number;
  private readonly maxModelPages: number;
  private readonly maxModels: number;
  private readonly maxModelBytes: number;
  private readonly maxModelCursorBytes: number;
  private readonly modelDiscoveryTimeoutMs: number;
  private readonly decoder = new StringDecoder("utf8");
  private readonly listeners = new Set<(event: CodexAppServerEvent) => void>();
  private readonly pending = new Map<number, PendingRequest>();
  private readonly settledRequestIds = new Set<number>();
  private readonly turns = new Map<string, TurnState>();
  private readonly turnByThread = new Map<string, string>();
  private readonly eventBacklog = new Map<string, CodexAppServerEvent[]>();
  private backlogBytes = 0;
  private inputBuffer = "";
  private nextRequestId = 1;
  private closed = false;
  private initialized = false;
  private closeError: Error | null = null;
  private stderrText = "";
  private stderrTruncated = false;

  constructor(options: ClientOptions) {
    this.stdin = options.stdin;
    this.stdout = options.stdout;
    this.stderr = options.stderr;
    this.closeTransport = options.close;
    this.maxFrameBytes = positiveInteger(options.maxFrameBytes, defaultMaxFrameBytes);
    this.maxEvents = positiveInteger(options.maxEvents, 512);
    this.maxToolEvents = positiveInteger(options.maxToolEvents, 128);
    this.maxTextBytes = positiveInteger(options.maxTextBytes, 1024 * 1024);
    this.maxStderrBytes = positiveInteger(options.maxStderrBytes, 64 * 1024);
    this.maxDiagnosticBytes = positiveInteger(options.maxDiagnosticBytes, 64 * 1024);
    this.maxEventBytes = positiveInteger(options.maxEventBytes, 8 * 1024 * 1024);
    this.maxToolBytes = positiveInteger(options.maxToolBytes, 8 * 1024 * 1024);
    this.maxTextItems = positiveInteger(options.maxTextItems, 128);
    this.maxBacklogKeys = positiveInteger(options.maxBacklogKeys, 128);
    this.maxBacklogBytes = positiveInteger(options.maxBacklogBytes, 4 * 1024 * 1024);
    this.requestTimeoutMs = positiveInteger(options.requestTimeoutMs, 30_000);
    this.turnTimeoutMs = positiveInteger(options.turnTimeoutMs, 10 * 60_000);
    this.maxModelPages = positiveInteger(options.maxModelPages, 32);
    this.maxModels = positiveInteger(options.maxModels, 256);
    this.maxModelBytes = positiveInteger(options.maxModelBytes, 2 * 1024 * 1024);
    this.maxModelCursorBytes = positiveInteger(options.maxModelCursorBytes, 16 * 1024);
    this.modelDiscoveryTimeoutMs = positiveInteger(options.modelDiscoveryTimeoutMs, 30_000);
    this.stdout.on("data", this.onData);
    this.stdout.once("end", this.onTransportEnd);
    this.stdout.once("error", this.onTransportError);
    this.stdin.once("error", this.onTransportError);
    this.stderr?.on("data", this.onStderr);
  }

  get isClosed() {
    return this.closed;
  }

  get capturedStderr() {
    return this.stderrText;
  }

  get activeTurnCount() {
    return this.turns.size;
  }

  get retentionStats() {
    return { backlogKeys: this.eventBacklog.size, backlogBytes: this.backlogBytes };
  }

  async initialize(options: InitializeOptions = {}) {
    if (this.initialized) {
      throw new CodexAppServerProtocolError("Codex App Server client was initialized more than once.");
    }
    const result = await this.request("initialize", {
      clientInfo: {
        name: options.clientName ?? "ether",
        title: "Ether",
        version: options.clientVersion ?? "4.0.0"
      },
      capabilities: { experimentalApi: true }
    });
    const userAgent = stringField(result, "userAgent");
    this.write({ method: "initialized", params: {} });
    this.initialized = true;
    return {
      userAgent,
      codexHome: stringField(result, "codexHome"),
      platformFamily: stringField(result, "platformFamily"),
      platformOs: stringField(result, "platformOs")
    };
  }

  async listModels(options: ModelListOptions = {}): Promise<CodexModel[]> {
    this.requireInitialized();
    const models: CodexModel[] = [];
    let cursor: string | null = null;
    let pages = 0;
    let modelBytes = 0;
    let cursorBytes = 0;
    const discoveryDeadline = Date.now() + this.modelDiscoveryTimeoutMs;
    const seenCursors = new Set<string>();
    do {
      pages += 1;
      if (pages > this.maxModelPages) {
        throw operationError(
          `Codex model discovery exceeded its ${this.maxModelPages} page limit.`,
          "CODEX_APP_SERVER_MODEL_PAGE_LIMIT",
          "malformed-output",
          false
        );
      }
      const remainingMs = discoveryDeadline - Date.now();
      if (remainingMs <= 0) throw modelDiscoveryTimeout(this.modelDiscoveryTimeoutMs);
      const requestTimeoutMs = Math.min(this.requestTimeoutMs, remainingMs);
      const result = await this.request("model/list", {
        cursor,
        includeHidden: options.includeHidden ?? false,
        limit: options.pageSize ?? null
      }, requestTimeoutMs, remainingMs <= this.requestTimeoutMs
        ? () => modelDiscoveryTimeout(this.modelDiscoveryTimeoutMs)
        : undefined);
      if (!isRecord(result) || !Array.isArray(result.data)) {
        throw new CodexAppServerProtocolError("Codex model/list response has invalid data.");
      }
      const pageBytes = serializedBytes(result.data);
      if (pageBytes > this.maxModelBytes - modelBytes) {
        throw operationError(
          `Codex model discovery exceeded its ${this.maxModelBytes} byte payload limit.`,
          "CODEX_APP_SERVER_MODEL_BYTES_LIMIT",
          "malformed-output",
          false
        );
      }
      modelBytes += pageBytes;
      if (result.data.length > this.maxModels - models.length) {
        throw operationError(
          `Codex model discovery exceeded its ${this.maxModels} model limit.`,
          "CODEX_APP_SERVER_MODEL_LIMIT",
          "capability",
          false
        );
      }
      for (const candidate of result.data) models.push(readModel(candidate));
      if (result.nextCursor !== undefined && result.nextCursor !== null && typeof result.nextCursor !== "string") {
        throw new CodexAppServerProtocolError("Codex model/list returned an invalid pagination cursor.");
      }
      cursor = typeof result.nextCursor === "string" ? result.nextCursor : null;
      if (cursor !== null && seenCursors.has(cursor)) {
        throw new CodexAppServerProtocolError("Codex model/list returned a duplicate pagination cursor.");
      }
      if (cursor !== null) {
        const nextCursorBytes = Buffer.byteLength(cursor);
        if (nextCursorBytes > this.maxModelCursorBytes - cursorBytes) {
          throw operationError(
            `Codex model discovery exceeded its ${this.maxModelCursorBytes} byte cursor limit.`,
            "CODEX_APP_SERVER_MODEL_CURSOR_LIMIT",
            "malformed-output",
            false
          );
        }
        cursorBytes += nextCursorBytes;
        seenCursors.add(cursor);
      }
    } while (cursor !== null);
    return (options.includeHidden ?? false) ? models : models.filter((model) => !model.hidden);
  }

  async startThread(options: ThreadStartOptions) {
    this.requireInitialized();
    const result = await this.request("thread/start", {
      cwd: options.cwd,
      model: options.model ?? null,
      approvalPolicy: "never",
      sandbox: "read-only",
      ephemeral: true,
      ...(options.reasoningEffort ? { config: { model_reasoning_effort: options.reasoningEffort } } : {})
    });
    if (!isRecord(result) || !isRecord(result.thread)) {
      throw new CodexAppServerProtocolError("Codex thread/start response is missing thread metadata.");
    }
    return {
      threadId: stringField(result.thread, "id"),
      model: typeof result.model === "string" ? result.model : options.model,
      reasoningEffort: typeof result.reasoningEffort === "string" ? result.reasoningEffort : options.reasoningEffort
    };
  }

  async runTurn(options: RunTurnOptions): Promise<CodexTurnResult> {
    this.requireInitialized();
    if (options.signal?.aborted) throw abortError("Codex turn was cancelled before dispatch.");
    if (!Array.isArray(options.input) || options.input.length === 0) {
      throw new CodexAppServerProtocolError("Codex turn input must contain at least one item.");
    }
    const operationStartedAt = Date.now();
    const turnTimeoutMs = positiveInteger(options.timeoutMs, this.turnTimeoutMs);
    const result = await this.request("turn/start", {
      threadId: options.threadId,
      input: options.input,
      ...(options.outputSchema ? { outputSchema: options.outputSchema } : {}),
      ...(options.effort ? { effort: options.effort } : {}),
      ...(options.model ? { model: options.model } : {})
    }, Math.min(this.requestTimeoutMs, turnTimeoutMs));
    if (!isRecord(result) || !isRecord(result.turn)) {
      throw new CodexAppServerProtocolError("Codex turn/start response is missing turn metadata.");
    }
    const turnId = stringField(result.turn, "id");
    return new Promise<CodexTurnResult>((resolve, reject) => {
      const state: TurnState = {
        threadId: options.threadId,
        turnId,
        startedAt: operationStartedAt,
        onEvent: options.onEvent,
        signal: options.signal,
        interruptCompletionTimeoutMs: positiveInteger(options.interruptCompletionTimeoutMs, 5_000),
        completionReason: null,
        settled: false,
        textBytes: 0,
        diagnosticBytes: 2,
        eventBytes: 2,
        toolBytes: 2,
        textByItem: new Map(),
        finalText: null,
        warnings: [],
        errors: [],
        events: [],
        toolEvents: [],
        imageViews: [],
        imageGenerations: [],
        unknownEvents: [],
        failure: null,
        truncated: { events: false, toolEvents: false, text: false, stderr: this.stderrTruncated },
        resolve,
        reject
      };
      this.turns.set(turnId, state);
      this.turnByThread.set(options.threadId, turnId);
      const backlog = this.eventBacklog.get(turnId) ?? [];
      this.eventBacklog.delete(turnId);
      for (const event of backlog) this.backlogBytes -= backlogEntryBytes(turnId, event);
      this.backlogBytes = Math.max(0, this.backlogBytes);
      for (const event of backlog) this.applyTurnEvent(state, event);
      if (state.settled) return;
      if (options.signal) {
        state.abortListener = () => void this.interrupt(state);
        options.signal.addEventListener("abort", state.abortListener, { once: true });
        if (options.signal.aborted) void this.interrupt(state);
      }
      const remainingMs = Math.max(1, operationStartedAt + turnTimeoutMs - Date.now());
      state.deadlineTimer = setTimeout(() => void this.timeoutTurn(state, turnTimeoutMs), remainingMs);
    });
  }

  subscribe(listener: (event: CodexAppServerEvent) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notifyTransportClosed(error?: Error) {
    this.fail(processError(error, "Codex App Server transport closed.", "CODEX_APP_SERVER_PROCESS_CLOSED", true));
  }

  async close() {
    if (this.closed) return;
    this.fail(operationError("Codex App Server client closed.", "CODEX_APP_SERVER_CLIENT_CLOSED", "process", false));
    await this.closeTransport?.();
  }

  private readonly onData = (chunk: string | Buffer | Uint8Array) => {
    if (this.closed) return;
    this.inputBuffer += typeof chunk === "string" ? chunk : this.decoder.write(Buffer.from(chunk));
    try {
      this.consumeFrames();
    } catch (error) {
      this.fail(error instanceof Error ? error : new CodexAppServerProtocolError("Unknown protocol failure."));
    }
  };

  private readonly onStderr = (chunk: string | Buffer | Uint8Array) => {
    const text = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
    const combined = this.stderrText + text;
    if (Buffer.byteLength(combined) <= this.maxStderrBytes) {
      this.stderrText = combined;
      return;
    }
    this.stderrTruncated = true;
    this.stderrText = combined.slice(-Math.floor(this.maxStderrBytes / 2));
  };

  private readonly onTransportEnd = () => this.fail(operationError(
    "Codex App Server transport closed.",
    "CODEX_APP_SERVER_PROCESS_CLOSED",
    "process",
    true
  ));
  private readonly onTransportError = (error: Error) => this.fail(processError(
    error,
    "Codex App Server transport failed.",
    "CODEX_APP_SERVER_PROCESS_CLOSED",
    true
  ));

  private consumeFrames() {
    while (true) {
      const newline = this.inputBuffer.indexOf("\n");
      if (newline < 0) {
        if (Buffer.byteLength(this.inputBuffer) > this.maxFrameBytes) {
          throw new CodexAppServerProtocolError(`Codex App Server frame exceeded the ${this.maxFrameBytes} byte limit.`);
        }
        return;
      }
      let line = this.inputBuffer.slice(0, newline);
      this.inputBuffer = this.inputBuffer.slice(newline + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (!line.trim()) continue;
      if (Buffer.byteLength(line) > this.maxFrameBytes) {
        throw new CodexAppServerProtocolError(`Codex App Server frame exceeded the ${this.maxFrameBytes} byte limit.`);
      }
      this.dispatch(parseAppServerMessage(line));
    }
  }

  private dispatch(message: AppServerMessage) {
    if ("method" in message) {
      this.dispatchEvent(message);
      return;
    }
    if (typeof message.id !== "number") {
      throw new CodexAppServerProtocolError(`Codex App Server returned unsupported response id ${String(message.id)}.`);
    }
    const pending = this.pending.get(message.id);
    if (!pending) {
      const kind = this.settledRequestIds.has(message.id) ? "duplicate" : "unknown";
      throw new CodexAppServerProtocolError(`Codex App Server returned a ${kind} response id ${message.id}.`);
    }
    this.pending.delete(message.id);
    if (pending.timer) clearTimeout(pending.timer);
    this.rememberSettledId(message.id);
    if (message.error) pending.reject(new CodexAppServerRequestError(pending.method, message.error));
    else pending.resolve(message.result);
  }

  private dispatchEvent(notification: AppServerNotification) {
    const event = { method: notification.method, params: notification.params, receivedAt: Date.now() };
    for (const listener of this.listeners) listener(event);
    const turnId = typeof notification.params.turnId === "string"
      ? notification.params.turnId
      : isRecord(notification.params.turn) && typeof notification.params.turn.id === "string"
        ? notification.params.turn.id
        : typeof notification.params.threadId === "string"
          ? this.turnByThread.get(notification.params.threadId) ?? null
          : null;
    if (!turnId) return;
    const state = this.turns.get(turnId);
    if (!state) {
      const backlog = this.eventBacklog.get(turnId) ?? [];
      const bytes = backlogEntryBytes(turnId, event);
      const hasKey = this.eventBacklog.has(turnId);
      if ((!hasKey && this.eventBacklog.size >= this.maxBacklogKeys)
        || backlog.length >= this.maxEvents
        || this.backlogBytes + bytes > this.maxBacklogBytes) return;
      backlog.push(event);
      this.backlogBytes += bytes;
      this.eventBacklog.set(turnId, backlog);
      return;
    }
    this.applyTurnEvent(state, event);
  }

  private applyTurnEvent(state: TurnState, event: CodexAppServerEvent) {
    if (state.settled) return;
    state.onEvent?.(event);
    state.eventBytes = retainByteBounded(state.events, event, this.maxEvents, state.eventBytes, this.maxEventBytes, () => { state.truncated.events = true; });
    const params = event.params;
    if (event.method === "item/agentMessage/delta") {
      const itemId = typeof params.itemId === "string" && Buffer.byteLength(params.itemId) <= 256 ? params.itemId : "agent";
      const delta = typeof params.delta === "string" ? params.delta : "";
      if (!state.textByItem.has(itemId) && state.textByItem.size >= this.maxTextItems) {
        state.truncated.text = true;
        return;
      }
      const previous = state.textByItem.get(itemId) ?? "";
      const retained = truncateUtf8(delta, Math.max(0, this.maxTextBytes - state.textBytes));
      if (retained !== delta) state.truncated.text = true;
      if (retained) {
        state.textByItem.set(itemId, previous + retained);
        state.textBytes += Buffer.byteLength(retained);
      }
      return;
    }
    if (event.method === "warning") {
      if (typeof params.message === "string") {
        state.diagnosticBytes = retainByteBounded(state.warnings, params.message, this.maxEvents, state.diagnosticBytes, this.maxDiagnosticBytes, () => { state.truncated.text = true; });
      }
      return;
    }
    if (event.method === "error") {
      const failure = mapCodexAppServerError(
        "Codex turn failed",
        params.error,
        typeof params.willRetry === "boolean" ? params.willRetry : undefined
      );
      state.failure = failure;
      state.diagnosticBytes = retainByteBounded(state.errors, failure.message, this.maxEvents, state.diagnosticBytes, this.maxDiagnosticBytes, () => { state.truncated.text = true; });
      return;
    }
    if (event.method === "item/completed") {
      if (!isRecord(params.item)) return;
      const item = params.item;
      const type = typeof item.type === "string" ? item.type : "unknown";
      if (type === "agentMessage" && typeof item.text === "string") {
        state.finalText = truncateUtf8(item.text, this.maxTextBytes);
        if (state.finalText !== item.text) state.truncated.text = true;
        state.textByItem.clear();
        state.textBytes = Buffer.byteLength(state.finalText);
      }
      else if (type === "imageView" && typeof item.path === "string") {
        state.toolBytes = retainByteBounded(state.imageViews, truncateUtf8(item.path, 4096), this.maxToolEvents, state.toolBytes, this.maxToolBytes, () => { state.truncated.toolEvents = true; });
      } else if (type === "imageGeneration") {
        state.toolBytes = retainByteBounded(state.imageGenerations, readImageGeneration(item), this.maxToolEvents, state.toolBytes, this.maxToolBytes, () => { state.truncated.toolEvents = true; });
      } else {
        state.toolBytes = retainByteBounded(state.toolEvents, item, this.maxToolEvents, state.toolBytes, this.maxToolBytes, () => { state.truncated.toolEvents = true; });
      }
      return;
    }
    if (event.method === "turn/completed") {
      const turn = isRecord(params.turn) ? params.turn : {};
      const completionFailure = isRecord(turn.error)
        ? mapCodexAppServerError("Codex turn failed", turn.error)
        : null;
      this.completeTurn(state, typeof turn.status === "string" ? turn.status : "", completionFailure);
      return;
    }
    if (event.method !== "turn/started") {
      state.eventBytes = retainByteBounded(state.unknownEvents, event, this.maxEvents, state.eventBytes, this.maxEventBytes, () => { state.truncated.events = true; });
    }
  }

  private completeTurn(
    state: TurnState,
    status: string,
    completionFailure: CodexAppServerOperationError | null = null
  ) {
    if (state.settled) return;
    state.settled = true;
    this.cleanupTurn(state);
    if (state.completionReason) {
      const error = state.completionReason === "timeout"
        ? operationError(`Codex turn exceeded its overall deadline.`, "CODEX_APP_SERVER_TURN_TIMEOUT", "timeout", true)
        : abortError("Codex turn was cancelled.");
      error.completedStatus = status;
      state.reject(error);
      return;
    }
    if (status === "failed") {
      state.reject(state.failure ?? completionFailure ?? operationError(
        "Codex turn failed without structured error information.",
        "CODEX_APP_SERVER_PROCESS",
        "process",
        false
      ));
      return;
    }
    if (status === "interrupted") {
      const error = abortError("Codex turn completed as interrupted.");
      error.completedStatus = status;
      state.reject(error);
      return;
    }
    if (status !== "completed") {
      state.reject(operationError(
        `Codex turn completed with invalid status ${status || "<missing>"}.`,
        "CODEX_APP_SERVER_MALFORMED_OUTPUT",
        "malformed-output",
        false
      ));
      return;
    }
    const streamedText = [...state.textByItem.values()].join("");
    state.resolve({
      threadId: state.threadId,
      turnId: state.turnId,
      status,
      text: state.finalText ?? streamedText,
      warnings: state.warnings,
      errors: state.errors,
      toolEvents: state.toolEvents,
      imageViews: state.imageViews,
      imageGenerations: state.imageGenerations,
      unknownEvents: state.unknownEvents,
      events: state.events,
      startedAt: state.startedAt,
      completedAt: Date.now(),
      truncated: { ...state.truncated, stderr: this.stderrTruncated }
    });
  }

  private async interrupt(state: TurnState) {
    if (state.settled || state.completionReason) return;
    state.completionReason = "cancel";
    await this.requestInterrupt(state);
  }

  private async timeoutTurn(state: TurnState, timeoutMs: number) {
    if (state.settled || state.completionReason) return;
    state.completionReason = "timeout";
    await this.requestInterrupt(state, timeoutMs);
  }

  private async requestInterrupt(state: TurnState, timeoutMs?: number) {
    try {
      await this.request("turn/interrupt", { threadId: state.threadId, turnId: state.turnId });
    } catch (error) {
      if (!state.settled) {
        state.settled = true;
        this.cleanupTurn(state);
        state.reject(error instanceof CodexAppServerOperationError
          ? error
          : processError(error, "Codex interrupt failed.", "CODEX_APP_SERVER_PROCESS", true));
      }
      return;
    }
    if (state.settled) return;
    state.interruptTimer = setTimeout(() => {
      if (state.settled) return;
      state.settled = true;
      this.cleanupTurn(state);
        state.reject(state.completionReason === "timeout"
          ? operationError(`Codex turn exceeded its ${timeoutMs ?? this.turnTimeoutMs} ms overall deadline and did not complete after interrupt.`, "CODEX_APP_SERVER_TURN_TIMEOUT", "timeout", true)
          : operationError(
            `Codex turn did not complete as interrupted within ${state.interruptCompletionTimeoutMs} ms.`,
            "CODEX_APP_SERVER_INTERRUPT_TIMEOUT",
            "cancellation",
            false
          ));
    }, state.interruptCompletionTimeoutMs);
  }

  private cleanupTurn(state: TurnState) {
    this.turns.delete(state.turnId);
    if (this.turnByThread.get(state.threadId) === state.turnId) this.turnByThread.delete(state.threadId);
    if (state.interruptTimer) clearTimeout(state.interruptTimer);
    if (state.deadlineTimer) clearTimeout(state.deadlineTimer);
    if (state.signal && state.abortListener) state.signal.removeEventListener("abort", state.abortListener);
  }

  private request(
    method: string,
    params: JsonObject,
    timeoutMs = this.requestTimeoutMs,
    timeoutError?: () => CodexAppServerOperationError
  ): Promise<unknown> {
    if (this.closed) return Promise.reject(this.closeError ?? operationError(
      "Codex App Server client is closed.",
      "CODEX_APP_SERVER_CLIENT_CLOSED",
      "process",
      false
    ));
    const id = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      const pending: PendingRequest = { method, resolve, reject };
      pending.timer = setTimeout(() => {
        if (this.pending.get(id) !== pending) return;
        this.pending.delete(id);
        this.rememberSettledId(id);
        reject(timeoutError?.() ?? operationError(
          `Codex App Server ${method} exceeded its ${timeoutMs} ms request deadline.`,
          "CODEX_APP_SERVER_REQUEST_TIMEOUT",
          "timeout",
          true
        ));
      }, timeoutMs);
      this.pending.set(id, pending);
      try {
        this.write({ id, method, params });
      } catch (error) {
        this.pending.delete(id);
        if (pending.timer) clearTimeout(pending.timer);
        reject(processError(error, "Codex App Server write failed.", "CODEX_APP_SERVER_PROCESS", true));
      }
    });
  }

  private write(message: AppServerRequest | AppServerNotification) {
    if (this.closed) throw this.closeError ?? operationError(
      "Codex App Server client is closed.",
      "CODEX_APP_SERVER_CLIENT_CLOSED",
      "process",
      false
    );
    this.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private rememberSettledId(id: number) {
    this.settledRequestIds.add(id);
    if (this.settledRequestIds.size > 512) {
      const oldest = this.settledRequestIds.values().next().value as number | undefined;
      if (oldest !== undefined) this.settledRequestIds.delete(oldest);
    }
  }

  private requireInitialized() {
    if (!this.initialized) throw new CodexAppServerProtocolError("Codex App Server client is not initialized.");
  }

  private fail(error: Error) {
    if (this.closed) return;
    const failure = error instanceof CodexAppServerOperationError
      ? error
      : processError(error, "Codex App Server process failed.", "CODEX_APP_SERVER_PROCESS_CLOSED", true);
    this.closed = true;
    this.closeError = failure;
    this.stdout.off("data", this.onData);
    for (const pending of this.pending.values()) {
      if (pending.timer) clearTimeout(pending.timer);
      pending.reject(failure);
    }
    this.pending.clear();
    for (const state of this.turns.values()) {
      if (state.settled) continue;
      state.settled = true;
      this.cleanupTurn(state);
      state.reject(failure);
    }
    this.turns.clear();
    this.eventBacklog.clear();
    this.backlogBytes = 0;
    this.listeners.clear();
  }
}

function positiveInteger(value: number | undefined, fallback: number) {
  return value === undefined ? fallback : Math.max(1, Math.floor(value));
}

function readModel(value: unknown): CodexModel {
  if (!isRecord(value)) throw new CodexAppServerProtocolError("Codex model entry must be an object.");
  if (!Array.isArray(value.supportedReasoningEfforts)) {
    throw new CodexAppServerProtocolError("Codex model entry has invalid reasoning efforts.");
  }
  return {
    id: stringField(value, "id"),
    model: stringField(value, "model"),
    displayName: stringField(value, "displayName"),
    description: stringField(value, "description"),
    hidden: Boolean(value.hidden),
    isDefault: Boolean(value.isDefault),
    defaultReasoningEffort: stringField(value, "defaultReasoningEffort"),
    supportedReasoningEfforts: value.supportedReasoningEfforts.map((entry) => ({
      reasoningEffort: stringField(entry, "reasoningEffort"),
      description: stringField(entry, "description")
    })),
    inputModalities: Array.isArray(value.inputModalities)
      ? value.inputModalities.filter((entry): entry is string => typeof entry === "string")
      : ["text", "image"]
  };
}

function readImageGeneration(item: JsonObject): CodexImageGenerationEvent {
  return {
    id: typeof item.id === "string" ? item.id : undefined,
    status: typeof item.status === "string" ? item.status : undefined,
    result: typeof item.result === "string" ? truncateUtf8(item.result, 64 * 1024) : undefined,
    savedPath: typeof item.savedPath === "string" ? truncateUtf8(item.savedPath, 4096) : undefined,
    revisedPrompt: typeof item.revisedPrompt === "string" || item.revisedPrompt === null
      ? typeof item.revisedPrompt === "string" ? truncateUtf8(item.revisedPrompt, 64 * 1024) : null
      : undefined
  };
}

function retainByteBounded<T>(
  values: T[],
  value: T,
  countLimit: number,
  retainedBytes: number,
  byteLimit: number,
  onTruncate: () => void
) {
  const bytes = serializedBytes(value) + (values.length > 0 ? 1 : 0);
  if (values.length < countLimit && retainedBytes + bytes <= byteLimit) {
    values.push(value);
    return retainedBytes + bytes;
  }
  onTruncate();
  return retainedBytes;
}

function serializedBytes(value: unknown) {
  try { return Buffer.byteLength(JSON.stringify(value)); } catch { return Number.MAX_SAFE_INTEGER; }
}

function backlogEntryBytes(turnId: string, event: CodexAppServerEvent) {
  return Buffer.byteLength(turnId) + serializedBytes(event);
}

function truncateUtf8(value: string, maxBytes: number) {
  if (maxBytes <= 0) return "";
  const bytes = Buffer.from(value);
  return bytes.byteLength <= maxBytes ? value : bytes.subarray(0, maxBytes).toString("utf8").replace(/\uFFFD$/u, "");
}

function operationError(message: string, code: string, category: CodexAppServerFailureCategory, retryable: boolean) {
  return new CodexAppServerOperationError(message, code, category, retryable);
}

function processError(
  error: unknown,
  fallbackMessage: string,
  code: string,
  retryable: boolean
) {
  if (error instanceof CodexAppServerOperationError) return error;
  return operationError(error instanceof Error ? error.message : fallbackMessage, code, "process", retryable);
}

function modelDiscoveryTimeout(timeoutMs: number) {
  return operationError(
    `Codex model discovery exceeded its ${timeoutMs} ms overall deadline.`,
    "CODEX_APP_SERVER_MODEL_DISCOVERY_TIMEOUT",
    "timeout",
    true
  );
}

function abortError(message: string) {
  const error = operationError(message, "CODEX_APP_SERVER_CANCELLED", "cancellation", false);
  error.name = "AbortError";
  return error;
}
