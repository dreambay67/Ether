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

export type CodexAppServerFailureCategory =
  | "authentication"
  | "capability"
  | "invalid-input"
  | "timeout"
  | "cancellation"
  | "process"
  | "malformed-output";

export type CodexAppServerOperationDetails = {
  requestCode?: number;
  codexErrorInfo?: string;
  httpStatusCode?: number;
  data?: unknown;
};

export class CodexAppServerOperationError extends Error {
  completedStatus?: string;

  constructor(
    message: string,
    readonly code: string,
    readonly category: CodexAppServerFailureCategory,
    readonly retryable: boolean,
    readonly details?: CodexAppServerOperationDetails
  ) {
    super(safeErrorMessage(message));
    this.name = "CodexAppServerOperationError";
  }
}

export class CodexAppServerProtocolError extends CodexAppServerOperationError {
  constructor(message: string) {
    super(message, "CODEX_APP_SERVER_PROTOCOL_ERROR", "malformed-output", false);
    this.name = "CodexAppServerProtocolError";
  }
}

export class CodexAppServerRequestError extends CodexAppServerOperationError {
  readonly requestCode: number | undefined;
  readonly data: unknown;
  readonly codexErrorInfo: string | undefined;
  readonly httpStatusCode: number | undefined;

  constructor(method: string, error: AppServerResponse["error"]) {
    const mapped = classifyAppServerError(error);
    const data = safeErrorData(error?.data);
    const details = {
      requestCode: error?.code,
      codexErrorInfo: mapped.codexErrorInfo,
      httpStatusCode: mapped.httpStatusCode,
      data
    };
    super(
      `Codex App Server ${method} failed: ${messageFromError(error)}`,
      mapped.code,
      mapped.category,
      mapped.retryable,
      details
    );
    this.name = "CodexAppServerRequestError";
    this.requestCode = error?.code;
    this.data = data;
    this.codexErrorInfo = mapped.codexErrorInfo;
    this.httpStatusCode = mapped.httpStatusCode;
  }
}

export function mapCodexAppServerError(
  context: string,
  error: unknown,
  retryableOverride?: boolean
) {
  const mapped = classifyAppServerError(error);
  const record = isRecord(error) ? error : null;
  const data = safeErrorData(record?.data ?? error);
  return new CodexAppServerOperationError(
    `${context}: ${messageFromError(error)}`,
    mapped.code,
    mapped.category,
    retryableOverride ?? mapped.retryable,
    {
      requestCode: typeof record?.code === "number" ? record.code : undefined,
      codexErrorInfo: mapped.codexErrorInfo,
      httpStatusCode: mapped.httpStatusCode,
      data
    }
  );
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

type FailureClassification = {
  code: string;
  category: CodexAppServerFailureCategory;
  retryable: boolean;
  codexErrorInfo?: string;
  httpStatusCode?: number;
};

function classifyAppServerError(error: unknown): FailureClassification {
  const record = isRecord(error) ? error : {};
  const requestCode = typeof record.code === "number" ? record.code : undefined;
  const codexErrorInfo = findCodexErrorInfo(record);
  const httpStatusCode = findHttpStatusCode(record);
  const message = messageFromError(error).toLocaleLowerCase();
  const result = (category: CodexAppServerFailureCategory, retryable: boolean): FailureClassification => ({
    code: categoryCode(category),
    category,
    retryable,
    codexErrorInfo,
    httpStatusCode
  });

  if (requestCode === -32700 || requestCode === -32600) return result("malformed-output", false);
  if (requestCode === -32601) return result("capability", false);
  if (requestCode === -32602) return result("invalid-input", false);
  if (requestCode === -32800 || /\bcancel(?:led|ed|lation)?\b/u.test(message)) return result("cancellation", false);
  if (codexErrorInfo === "unauthorized" || httpStatusCode === 401 || httpStatusCode === 403) {
    return result("authentication", false);
  }
  if (codexErrorInfo === "badRequest") return result("invalid-input", false);
  if (codexErrorInfo === "contextWindowExceeded"
    || codexErrorInfo === "sessionBudgetExceeded"
    || codexErrorInfo === "usageLimitExceeded"
    || codexErrorInfo === "cyberPolicy"
    || codexErrorInfo === "activeTurnNotSteerable") {
    return result("capability", false);
  }
  if (httpStatusCode === 408 || httpStatusCode === 504 || /\b(?:timed? out|timeout)\b/u.test(message)) {
    return result("timeout", true);
  }
  if (codexErrorInfo === "serverOverloaded"
    || codexErrorInfo === "internalServerError"
    || codexErrorInfo === "httpConnectionFailed"
    || codexErrorInfo === "responseStreamConnectionFailed"
    || codexErrorInfo === "responseStreamDisconnected"
    || codexErrorInfo === "responseTooManyFailedAttempts"
    || requestCode === -32603
    || (httpStatusCode !== undefined && httpStatusCode >= 500)) {
    return result("process", true);
  }
  if (codexErrorInfo === "sandboxError" || codexErrorInfo === "threadRollbackFailed") {
    return result("process", false);
  }
  return result("process", false);
}

function categoryCode(category: CodexAppServerFailureCategory) {
  const suffix: Record<CodexAppServerFailureCategory, string> = {
    authentication: "AUTHENTICATION",
    capability: "CAPABILITY",
    "invalid-input": "INVALID_INPUT",
    timeout: "TIMEOUT",
    cancellation: "CANCELLED",
    process: "PROCESS",
    "malformed-output": "MALFORMED_OUTPUT"
  };
  return `CODEX_APP_SERVER_${suffix[category]}`;
}

function messageFromError(error: unknown) {
  if (isRecord(error) && typeof error.message === "string") return error.message;
  return "unknown App Server error";
}

function findCodexErrorInfo(value: unknown, depth = 0): string | undefined {
  if (depth > 3 || !isRecord(value)) return undefined;
  if (typeof value.codexErrorInfo === "string") return truncateUtf8(value.codexErrorInfo, 64);
  if (isRecord(value.codexErrorInfo)) {
    const key = Object.keys(value.codexErrorInfo)[0];
    if (key) return truncateUtf8(key, 64);
  }
  return findCodexErrorInfo(value.data, depth + 1) ?? findCodexErrorInfo(value.error, depth + 1);
}

function findHttpStatusCode(value: unknown, depth = 0): number | undefined {
  if (depth > 4 || !isRecord(value)) return undefined;
  if (typeof value.httpStatusCode === "number" && Number.isInteger(value.httpStatusCode)) {
    return value.httpStatusCode;
  }
  for (const candidate of [value.codexErrorInfo, value.data, value.error]) {
    const nested = findHttpStatusCode(candidate, depth + 1);
    if (nested !== undefined) return nested;
  }
  if (isRecord(value.codexErrorInfo)) {
    for (const candidate of Object.values(value.codexErrorInfo)) {
      const nested = findHttpStatusCode(candidate, depth + 1);
      if (nested !== undefined) return nested;
    }
  }
  return undefined;
}

function safeErrorData(value: unknown): unknown {
  if (value === undefined) return undefined;
  const sanitized = sanitizeValue(value, 0);
  if (serializedBytes(sanitized) <= 4_096) return sanitized;
  return {
    truncated: true,
    codexErrorInfo: findCodexErrorInfo(value),
    httpStatusCode: findHttpStatusCode(value)
  };
}

function sanitizeValue(value: unknown, depth: number, key = ""): unknown {
  if (/token|secret|authorization|api.?key|prompt|input|path|cwd/i.test(key)) return "<redacted>";
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return safeErrorMessage(value, 512);
  if (depth >= 4) return "<truncated>";
  if (Array.isArray(value)) return value.slice(0, 16).map((entry) => sanitizeValue(entry, depth + 1));
  if (!isRecord(value)) return String(value);
  const entries = Object.entries(value).slice(0, 32);
  return Object.fromEntries(entries.map(([entryKey, entry]) => [
    truncateUtf8(entryKey, 64),
    sanitizeValue(entry, depth + 1, entryKey)
  ]));
}

function safeErrorMessage(value: string, maxBytes = 1_024) {
  const printable = [...value].map((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f ? " " : character;
  }).join("");
  const redacted = printable
    .replace(/\b(?:sk|sess)-[A-Za-z0-9_-]+/giu, "<redacted-secret>")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/giu, "Bearer <redacted-secret>")
    .replace(/[A-Za-z]:\\(?:[^\\\s"'<>|]+\\)*[^\\\s"'<>|]*/gu, "<redacted-path>")
    .replace(/(?:^|\s)\/(?:Users|home|tmp|var|private)\/[^\s"']+/gu, " <redacted-path>");
  return truncateUtf8(redacted, maxBytes);
}

function serializedBytes(value: unknown) {
  try {
    return Buffer.byteLength(JSON.stringify(value));
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}

function truncateUtf8(value: string, maxBytes: number) {
  const bytes = Buffer.from(value);
  return bytes.byteLength <= maxBytes
    ? value
    : bytes.subarray(0, maxBytes).toString("utf8").replace(/\uFFFD$/u, "");
}
