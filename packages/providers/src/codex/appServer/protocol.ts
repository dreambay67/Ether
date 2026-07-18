export const CODEX_APP_SERVER_VERSION = "0.144.2";
export const CODEX_APP_SERVER_PROTOCOL = "app-server-jsonl-v2";
export const CODEX_APP_SERVER_MANIFEST_SHA256 =
  "579e6d66fe30749682413b6a32289b896c314db8a3e51b11d65874214e098ee6";

export type JsonObject = Record<string, unknown>;
export type AppServerRequestId = number | string;

export type AppServerRequest = {
  id: AppServerRequestId;
  method: string;
  params: JsonObject;
};

export type AppServerNotification = {
  method: string;
  params: JsonObject;
};

export type AppServerResponse = {
  id: AppServerRequestId;
  result?: unknown;
  error?: {
    code?: number;
    message?: string;
    data?: unknown;
  };
};

export type AppServerMessage = AppServerNotification | AppServerResponse;

export type CodexReasoningEffort = {
  reasoningEffort: string;
  description: string;
};

export type CodexModel = {
  id: string;
  model: string;
  displayName: string;
  description: string;
  hidden: boolean;
  isDefault: boolean;
  defaultReasoningEffort: string;
  supportedReasoningEfforts: CodexReasoningEffort[];
  inputModalities: string[];
};

export type CodexUserInput =
  | { type: "text"; text: string }
  | { type: "localImage"; path: string; detail?: "low" | "high" | "auto" }
  | { type: "image"; url: string; detail?: "low" | "high" | "auto" };

export type CodexAppServerEvent = {
  method: string;
  params: JsonObject;
  receivedAt: number;
};

export type CodexImageGenerationEvent = {
  id?: string;
  status?: string;
  result?: string;
  savedPath?: string;
  revisedPrompt?: string | null;
};

export type CodexTurnResult = {
  threadId: string;
  turnId: string;
  status: string;
  text: string;
  warnings: string[];
  errors: string[];
  toolEvents: JsonObject[];
  imageViews: string[];
  imageGenerations: CodexImageGenerationEvent[];
  unknownEvents: CodexAppServerEvent[];
  events: CodexAppServerEvent[];
  startedAt: number;
  completedAt: number;
  truncated: {
    events: boolean;
    toolEvents: boolean;
    text: boolean;
    stderr: boolean;
  };
};

export class CodexAppServerProtocolError extends Error {
  readonly code = "CODEX_APP_SERVER_PROTOCOL_ERROR";

  constructor(message: string) {
    super(message);
    this.name = "CodexAppServerProtocolError";
  }
}

export class CodexAppServerRequestError extends Error {
  readonly code = "CODEX_APP_SERVER_REQUEST_ERROR";
  readonly requestCode: number | undefined;
  readonly data: unknown;

  constructor(method: string, error: AppServerResponse["error"]) {
    super(`Codex App Server ${method} failed: ${error?.message ?? "unknown request error"}`);
    this.name = "CodexAppServerRequestError";
    this.requestCode = error?.code;
    this.data = error?.data;
  }
}

export function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function stringField(value: unknown, field: string): string {
  if (!isRecord(value) || typeof value[field] !== "string") {
    throw new CodexAppServerProtocolError(`Codex App Server response is missing string field ${field}.`);
  }
  return value[field];
}

export function parseAppServerMessage(line: string): AppServerMessage {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "invalid JSON";
    throw new CodexAppServerProtocolError(`Received malformed Codex App Server JSON: ${detail}`);
  }
  if (!isRecord(parsed)) {
    throw new CodexAppServerProtocolError("Codex App Server frame must contain a JSON object.");
  }
  if (typeof parsed.method === "string") {
    if (!isRecord(parsed.params)) {
      throw new CodexAppServerProtocolError(`Codex App Server notification ${parsed.method} has invalid params.`);
    }
    return { method: parsed.method, params: parsed.params };
  }
  if (typeof parsed.id !== "number" && typeof parsed.id !== "string") {
    throw new CodexAppServerProtocolError("Codex App Server response is missing a valid request id.");
  }
  if (parsed.error !== undefined && !isRecord(parsed.error)) {
    throw new CodexAppServerProtocolError("Codex App Server response error must be an object.");
  }
  return parsed as AppServerResponse;
}
