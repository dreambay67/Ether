import type { Readable, Writable } from "node:stream";
import { StringDecoder } from "node:string_decoder";

import {
  CodexAppServerProtocolError,
  CodexAppServerRequestError,
  parseAppServerMessage,
  isRecord,
  stringField,
  type AppServerMessage,
  type AppServerNotification,
  type AppServerRequest,
  type CodexAppServerEvent,
  type CodexImageGenerationEvent,
  type CodexModel,
  type CodexTurnResult,
  type CodexUserInput,
  type JsonObject
} from "./protocol.js";

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
};

type PendingRequest = {
  method: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

type TurnState = {
  threadId: string;
  turnId: string;
  startedAt: number;
  signal?: AbortSignal;
  abortListener?: () => void;
  interruptCompletionTimeoutMs: number;
  interruptTimer?: ReturnType<typeof setTimeout>;
  interruptRequested: boolean;
  settled: boolean;
  textByItem: Map<string, string>;
  finalText: string | null;
  warnings: string[];
  errors: string[];
  events: CodexAppServerEvent[];
  toolEvents: JsonObject[];
  imageViews: string[];
  imageGenerations: CodexImageGenerationEvent[];
  unknownEvents: CodexAppServerEvent[];
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
  signal?: AbortSignal;
  interruptCompletionTimeoutMs?: number;
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
  private readonly decoder = new StringDecoder("utf8");
  private readonly listeners = new Set<(event: CodexAppServerEvent) => void>();
  private readonly pending = new Map<number, PendingRequest>();
  private readonly settledRequestIds = new Set<number>();
  private readonly turns = new Map<string, TurnState>();
  private readonly turnByThread = new Map<string, string>();
  private readonly eventBacklog = new Map<string, CodexAppServerEvent[]>();
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
    const seenCursors = new Set<string>();
    do {
      const result = await this.request("model/list", {
        cursor,
        includeHidden: options.includeHidden ?? false,
        limit: options.pageSize ?? null
      });
      if (!isRecord(result) || !Array.isArray(result.data)) {
        throw new CodexAppServerProtocolError("Codex model/list response has invalid data.");
      }
      for (const candidate of result.data) models.push(readModel(candidate));
      cursor = typeof result.nextCursor === "string" ? result.nextCursor : null;
      if (cursor !== null && seenCursors.has(cursor)) {
        throw new CodexAppServerProtocolError("Codex model/list returned a duplicate pagination cursor.");
      }
      if (cursor !== null) seenCursors.add(cursor);
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
    const result = await this.request("turn/start", {
      threadId: options.threadId,
      input: options.input,
      ...(options.outputSchema ? { outputSchema: options.outputSchema } : {}),
      ...(options.effort ? { effort: options.effort } : {}),
      ...(options.model ? { model: options.model } : {})
    });
    if (!isRecord(result) || !isRecord(result.turn)) {
      throw new CodexAppServerProtocolError("Codex turn/start response is missing turn metadata.");
    }
    const turnId = stringField(result.turn, "id");
    return new Promise<CodexTurnResult>((resolve, reject) => {
      const state: TurnState = {
        threadId: options.threadId,
        turnId,
        startedAt: Date.now(),
        signal: options.signal,
        interruptCompletionTimeoutMs: positiveInteger(options.interruptCompletionTimeoutMs, 5_000),
        interruptRequested: false,
        settled: false,
        textByItem: new Map(),
        finalText: null,
        warnings: [],
        errors: [],
        events: [],
        toolEvents: [],
        imageViews: [],
        imageGenerations: [],
        unknownEvents: [],
        truncated: { events: false, toolEvents: false, text: false, stderr: this.stderrTruncated },
        resolve,
        reject
      };
      this.turns.set(turnId, state);
      this.turnByThread.set(options.threadId, turnId);
      const backlog = this.eventBacklog.get(turnId) ?? [];
      this.eventBacklog.delete(turnId);
      for (const event of backlog) this.applyTurnEvent(state, event);
      if (state.settled) return;
      if (options.signal) {
        state.abortListener = () => void this.interrupt(state);
        options.signal.addEventListener("abort", state.abortListener, { once: true });
        if (options.signal.aborted) void this.interrupt(state);
      }
    });
  }

  subscribe(listener: (event: CodexAppServerEvent) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notifyTransportClosed(error?: Error) {
    this.fail(error ?? new Error("Codex App Server transport closed."));
  }

  async close() {
    if (this.closed) return;
    this.fail(new Error("Codex App Server client closed."));
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

  private readonly onTransportEnd = () => this.fail(new Error("Codex App Server transport closed."));
  private readonly onTransportError = (error: Error) => this.fail(error);

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
      if (backlog.length < this.maxEvents) backlog.push(event);
      this.eventBacklog.set(turnId, backlog);
      return;
    }
    this.applyTurnEvent(state, event);
  }

  private applyTurnEvent(state: TurnState, event: CodexAppServerEvent) {
    if (state.settled) return;
    retainBounded(state.events, event, this.maxEvents, () => { state.truncated.events = true; });
    const params = event.params;
    if (event.method === "item/agentMessage/delta") {
      const itemId = typeof params.itemId === "string" ? params.itemId : "agent";
      const delta = typeof params.delta === "string" ? params.delta : "";
      const previous = state.textByItem.get(itemId) ?? "";
      const next = previous + delta;
      if (Buffer.byteLength(next) <= this.maxTextBytes) state.textByItem.set(itemId, next);
      else state.truncated.text = true;
      return;
    }
    if (event.method === "warning") {
      if (typeof params.message === "string") state.warnings.push(params.message);
      return;
    }
    if (event.method === "error") {
      const error = isRecord(params.error) && typeof params.error.message === "string"
        ? params.error.message
        : "Codex turn failed.";
      state.errors.push(error);
      return;
    }
    if (event.method === "item/completed") {
      if (!isRecord(params.item)) return;
      const item = params.item;
      const type = typeof item.type === "string" ? item.type : "unknown";
      if (type === "agentMessage" && typeof item.text === "string") state.finalText = item.text;
      else if (type === "imageView" && typeof item.path === "string") {
        retainBounded(state.imageViews, item.path, this.maxToolEvents, () => { state.truncated.toolEvents = true; });
      } else if (type === "imageGeneration") {
        retainBounded(state.imageGenerations, readImageGeneration(item), this.maxToolEvents, () => { state.truncated.toolEvents = true; });
      } else {
        retainBounded(state.toolEvents, item, this.maxToolEvents, () => { state.truncated.toolEvents = true; });
      }
      return;
    }
    if (event.method === "turn/completed") {
      const turn = isRecord(params.turn) ? params.turn : {};
      this.completeTurn(state, typeof turn.status === "string" ? turn.status : "completed");
      return;
    }
    if (event.method !== "turn/started") {
      retainBounded(state.unknownEvents, event, this.maxEvents, () => { state.truncated.events = true; });
    }
  }

  private completeTurn(state: TurnState, status: string) {
    if (state.settled) return;
    state.settled = true;
    this.cleanupTurn(state);
    if (state.interruptRequested) {
      const error = abortError("Codex turn was cancelled.") as Error & { completedStatus?: string };
      error.completedStatus = status;
      state.reject(error);
      return;
    }
    if (status !== "completed") {
      state.reject(new Error(state.errors.at(-1) ?? `Codex turn completed with status ${status}.`));
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
    if (state.settled || state.interruptRequested) return;
    state.interruptRequested = true;
    try {
      await this.request("turn/interrupt", { threadId: state.threadId, turnId: state.turnId });
    } catch (error) {
      if (!state.settled) {
        state.settled = true;
        this.cleanupTurn(state);
        state.reject(error instanceof Error ? error : new Error("Codex interrupt failed."));
      }
      return;
    }
    if (state.settled) return;
    state.interruptTimer = setTimeout(() => {
      if (state.settled) return;
      state.settled = true;
      this.cleanupTurn(state);
      state.reject(new Error(`Codex turn did not complete as interrupted within ${state.interruptCompletionTimeoutMs} ms.`));
    }, state.interruptCompletionTimeoutMs);
  }

  private cleanupTurn(state: TurnState) {
    this.turns.delete(state.turnId);
    if (this.turnByThread.get(state.threadId) === state.turnId) this.turnByThread.delete(state.threadId);
    if (state.interruptTimer) clearTimeout(state.interruptTimer);
    if (state.signal && state.abortListener) state.signal.removeEventListener("abort", state.abortListener);
  }

  private request(method: string, params: JsonObject): Promise<unknown> {
    if (this.closed) return Promise.reject(this.closeError ?? new Error("Codex App Server client is closed."));
    const id = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { method, resolve, reject });
      try {
        this.write({ id, method, params });
      } catch (error) {
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error("Codex App Server write failed."));
      }
    });
  }

  private write(message: AppServerRequest | AppServerNotification) {
    if (this.closed) throw this.closeError ?? new Error("Codex App Server client is closed.");
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
    this.closed = true;
    this.closeError = error;
    this.stdout.off("data", this.onData);
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
    for (const state of this.turns.values()) {
      if (state.settled) continue;
      state.settled = true;
      this.cleanupTurn(state);
      state.reject(error);
    }
    this.turns.clear();
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
    result: typeof item.result === "string" ? item.result : undefined,
    savedPath: typeof item.savedPath === "string" ? item.savedPath : undefined,
    revisedPrompt: typeof item.revisedPrompt === "string" || item.revisedPrompt === null
      ? item.revisedPrompt
      : undefined
  };
}

function retainBounded<T>(values: T[], value: T, limit: number, onTruncate: () => void) {
  if (values.length < limit) values.push(value);
  else onTruncate();
}

function abortError(message: string) {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}
