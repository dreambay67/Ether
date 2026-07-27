import { appendFileSync, writeFileSync } from "node:fs";

const mode = process.env.ETHER_FAKE_APP_SERVER_MODE ?? "normal";
const requestLog = process.env.ETHER_FAKE_APP_SERVER_REQUEST_LOG;
const environmentLog = process.env.ETHER_FAKE_APP_SERVER_ENV_LOG;
const imageOutputPath = process.env.ETHER_FAKE_APP_SERVER_IMAGE_OUTPUT_PATH ?? "C:\\Fixture\\generated.png";
const newline = mode === "crlf-split" ? "\r\n" : "\n";
let input = "";
let threadOrdinal = 0;
let turnOrdinal = 0;
const concurrencyTurns = [];

process.stderr.write("fake app server diagnostic noise\n");
if (environmentLog) {
  writeFileSync(environmentLog, JSON.stringify({
    openAiApiKey: process.env.OPENAI_API_KEY ?? null,
    marker: process.env.ETHER_RUNTIME_MARKER ?? null,
    pid: process.pid
  }), "utf8");
}

function writeRaw(value) {
  if (mode !== "crlf-split") {
    process.stdout.write(value);
    return;
  }
  const split = Math.max(1, Math.floor(value.length / 2));
  process.stdout.write(value.slice(0, split));
  setTimeout(() => process.stdout.write(value.slice(split)), 2);
}

function send(message) {
  writeRaw(`${JSON.stringify(message)}${newline}`);
}

function turn(id, status = "inProgress") {
  return { id, status, items: [], error: null };
}

function model(id = "gpt-5.4", overrides = {}) {
  return {
    id,
    model: id,
    displayName: id,
    description: "Fixture model",
    hidden: false,
    isDefault: id === "gpt-5.4",
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: [{ reasoningEffort: "medium", description: "Balanced" }],
    inputModalities: ["text", "image"],
    ...overrides
  };
}

const requestErrors = {
  "request-error-authentication": {
    code: -32000,
    message: `Unauthorized at C:\\Users\\fixture\\secret.txt with sk-fixture-secret ${"x".repeat(4_000)}`,
    data: { codexErrorInfo: "unauthorized", httpStatusCode: 401, token: "sk-fixture-secret", path: "C:\\Users\\fixture\\secret.txt" }
  },
  "request-error-capability": {
    code: -32000,
    message: "Usage limit exceeded",
    data: { codexErrorInfo: "usageLimitExceeded" }
  },
  "request-error-invalid-input": {
    code: -32602,
    message: "Invalid request parameters",
    data: { codexErrorInfo: "badRequest", field: "model" }
  },
  "request-error-timeout": {
    code: -32000,
    message: "Upstream request timed out",
    data: { codexErrorInfo: { httpConnectionFailed: { httpStatusCode: 408 } } }
  },
  "request-error-cancellation": {
    code: -32800,
    message: "Request cancelled",
    data: { reason: "caller" }
  },
  "request-error-process": {
    code: -32603,
    message: "Internal server error",
    data: { codexErrorInfo: "internalServerError" }
  },
  "request-error-malformed-output": {
    code: -32700,
    message: "Malformed upstream response",
    data: { responseType: "invalid-json" }
  }
};

function emitCompleted(threadId, turnId, text) {
  send({ method: "turn/started", params: { threadId, turn: turn(turnId) } });
  send({ method: "item/agentMessage/delta", params: { threadId, turnId, itemId: "agent-1", delta: text.slice(0, 4) } });
  send({ method: "warning", params: { threadId, message: "fixture warning" } });
  send({ method: "ether/unknown", params: { threadId, turnId, retained: true } });
  send({ method: "item/agentMessage/delta", params: { threadId, turnId, itemId: "agent-1", delta: text.slice(4) } });
  send({ method: "item/completed", params: { threadId, turnId, completedAtMs: 10, item: { id: "tool-1", type: "imageView", path: "C:\\Fixture\\view.png" } } });
  send({ method: "item/completed", params: { threadId, turnId, completedAtMs: 11, item: { id: "image-1", type: "imageGeneration", status: "completed", result: "generated", savedPath: imageOutputPath, revisedPrompt: null } } });
  if (mode === "flood-tools") {
    for (let index = 0; index < 20; index += 1) {
      send({ method: "item/completed", params: { threadId, turnId, item: { id: `tool-${index + 2}`, type: "commandExecution", command: "redacted" } } });
    }
  }
  send({ method: "item/completed", params: { threadId, turnId, completedAtMs: 12, item: { id: "agent-1", type: "agentMessage", text } } });
  send({ method: "turn/completed", params: { threadId, turn: turn(turnId, "completed") } });
}

function handle(message) {
  if (requestLog) appendFileSync(requestLog, `${JSON.stringify(message)}\n`, "utf8");
  if (message.method === "initialized") return;
  if (message.method === "initialize") {
    if (mode === "die-init") return process.exit(31);
    if (mode === "no-init") return;
    if (mode === "malformed-init") return writeRaw("{not-json\n");
    if (mode === "unknown-response") return send({ id: 9999, result: {} });
    const userAgent = mode === "version-mismatch"
      ? "codex-cli/0.145.0"
      : mode === "desktop-user-agent"
        ? "Codex Desktop/0.144.2 (Windows 10.0.26200; x86_64) unknown (ether; 4.0.0)"
        : mode === "client-user-agent"
          ? "ether/0.144.2 (Windows 10.0.26200; x86_64) unknown (ether; 4.0.0)"
        : "codex-cli/0.144.2";
    send({ id: message.id, result: { codexHome: "C:\\CodexHome", platformFamily: "windows", platformOs: "windows", userAgent } });
    if (mode === "duplicate-response") send({ id: message.id, result: {} });
    if (mode === "die-idle") setTimeout(() => process.exit(32), 20);
    return;
  }
  if (message.method === "model/list") {
    if (mode === "request-timeout") return;
    if (requestErrors[mode]) return send({ id: message.id, error: requestErrors[mode] });
    if (mode === "model-pages-unbounded") {
      const page = Number.parseInt(message.params?.cursor?.slice(5) ?? "0", 10) || 0;
      return send({ id: message.id, result: { data: [model(`page-model-${page}`)], nextCursor: `page-${page + 1}` } });
    }
    if (mode === "model-count-overflow") {
      return send({ id: message.id, result: { data: [model("model-1"), model("model-2"), model("model-3")], nextCursor: null } });
    }
    if (mode === "model-bytes-overflow") {
      return send({ id: message.id, result: { data: [model("large-model", { description: "d".repeat(2_048) })], nextCursor: null } });
    }
    if (mode === "model-cursor-overflow") {
      return send({ id: message.id, result: { data: [model()], nextCursor: "c".repeat(256) } });
    }
    if (mode === "model-discovery-slow") {
      const page = Number.parseInt(message.params?.cursor?.slice(5) ?? "0", 10) || 0;
      return setTimeout(() => send({
        id: message.id,
        result: { data: [model(`slow-model-${page}`)], nextCursor: page >= 2 ? null : `page-${page + 1}` }
      }), 30);
    }
    const second = message.params?.cursor === "page-2";
    send({ id: message.id, result: { data: [second ? {
      id: "hidden-model", model: "hidden-model", displayName: "Hidden", description: "Hidden fixture model", hidden: true, isDefault: false,
      defaultReasoningEffort: "high", supportedReasoningEfforts: [{ reasoningEffort: "high", description: "Deep" }], inputModalities: ["text"]
    } : {
      id: "gpt-5.4", model: "gpt-5.4", displayName: "GPT-5.4", description: "Default fixture model", hidden: false, isDefault: true,
      defaultReasoningEffort: "medium", supportedReasoningEfforts: [{ reasoningEffort: "low", description: "Fast" }, { reasoningEffort: "medium", description: "Balanced" }], inputModalities: ["text", "image"]
    }], nextCursor: second ? null : "page-2" } });
    return;
  }
  if (message.method === "thread/start") {
    const id = `thread-${++threadOrdinal}`;
    send({ id: message.id, result: { thread: { id }, model: message.params?.model ?? "gpt-5.4", modelProvider: "openai", cwd: message.params?.cwd ?? process.cwd(), approvalPolicy: "never", approvalsReviewer: "user", sandbox: "read-only" } });
    return;
  }
  if (message.method === "turn/start") {
    if (mode === "strict-schema") {
      const invalidPath = findIncompleteRequired(message.params?.outputSchema);
      if (invalidPath) {
        return send({
          id: message.id,
          error: { code: -32602, message: `strict schema is missing required properties at ${invalidPath}` }
        });
      }
    }
    const id = `turn-${++turnOrdinal}`;
    if (mode === "flood-retention") {
      for (let index = 0; index < 20; index += 1) {
        send({ method: "warning", params: { threadId: message.params.threadId, turnId: `ghost-${index}`, message: "b".repeat(128) } });
      }
    }
    send({ id: message.id, result: { turn: turn(id) } });
    if (mode === "concurrency-4") {
      const text = message.params?.input?.find((entry) => entry.type === "text")?.text ?? "fixture response";
      concurrencyTurns.push({ threadId: message.params.threadId, turnId: id, text });
      if (concurrencyTurns.length === 4) {
        for (const pending of concurrencyTurns.splice(0)) {
          setTimeout(() => emitCompleted(pending.threadId, pending.turnId, pending.text), 0);
        }
      }
      return;
    }
    if (mode === "die-active") return setTimeout(() => process.exit(33), 5);
    if (mode === "turn-error") {
      send({ method: "error", params: { threadId: message.params.threadId, turnId: id, willRetry: false, error: { message: "invalid input at C:\\Users\\fixture\\prompt.txt with sk-fixture-secret", codexErrorInfo: "badRequest", additionalDetails: "field: prompt" } } });
      return send({ method: "turn/completed", params: { threadId: message.params.threadId, turn: { ...turn(id, "failed"), error: { message: "turn failed" } } } });
    }
    if (mode === "oversized-frame") return writeRaw(`${JSON.stringify({ method: "warning", params: { message: "x".repeat(200000) } })}\n`);
    if (mode === "large-image-frame") {
      send({ method: "item/completed", params: { threadId: message.params.threadId, turnId: id, item: {
        id: "large-image", type: "imageGeneration", status: "completed", result: "x".repeat(2 * 1024 * 1024),
        savedPath: "C:\\Fixture\\large-generated.png", revisedPrompt: null
      } } });
      return send({ method: "turn/completed", params: { threadId: message.params.threadId, turn: turn(id, "completed") } });
    }
    if (mode === "flood-retention") {
      for (let index = 0; index < 20; index += 1) {
        send({ method: "warning", params: { threadId: message.params.threadId, turnId: id, message: `warning-${index}-${"w".repeat(64)}` } });
        send({ method: "error", params: { threadId: message.params.threadId, turnId: id, error: { message: `error-${index}-${"e".repeat(64)}` } } });
        send({ method: "item/agentMessage/delta", params: { threadId: message.params.threadId, turnId: id, itemId: `agent-${index}-${"k".repeat(64)}`, delta: "d".repeat(64) } });
        send({ method: "ether/unknown", params: { threadId: message.params.threadId, turnId: id, payload: "u".repeat(128) } });
      }
      send({ method: "item/completed", params: { threadId: message.params.threadId, turnId: id, item: { id: "agent-final", type: "agentMessage", text: "f".repeat(512) } } });
      return send({ method: "turn/completed", params: { threadId: message.params.threadId, turn: turn(id, "completed") } });
    }
    const textInput = message.params?.input?.find((entry) => entry.type === "text")?.text ?? "fixture response";
    if (textInput.includes("WAIT_FOR_INTERRUPT")) return;
    const response = textInput.includes("STRUCTURED") ? '{"score":91,"decision":"pass"}' : "fixture response";
    setTimeout(() => emitCompleted(message.params.threadId, id, response), 5);
    return;
  }
  if (message.method === "turn/interrupt") {
    send({ id: message.id, result: {} });
    if (mode !== "interrupt-never-completes") {
      setTimeout(() => send({ method: "turn/completed", params: { threadId: message.params.threadId, turn: turn(message.params.turnId, "interrupted") } }), 5);
    }
    return;
  }
  send({ id: message.id, error: { code: -32601, message: `unknown method ${message.method}` } });
}

function findIncompleteRequired(schema, path = "root") {
  if (!schema || typeof schema !== "object") return null;
  if (schema.type === "object" && schema.properties && typeof schema.properties === "object") {
    const required = new Set(Array.isArray(schema.required) ? schema.required : []);
    for (const key of Object.keys(schema.properties)) {
      if (!required.has(key)) return `${path}.${key}`;
      const nested = findIncompleteRequired(schema.properties[key], `${path}.${key}`);
      if (nested) return nested;
    }
  }
  if (schema.type === "array") return findIncompleteRequired(schema.items, `${path}[]`);
  return null;
}

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
  while (true) {
    const lineEnd = input.indexOf("\n");
    if (lineEnd < 0) break;
    const line = input.slice(0, lineEnd).replace(/\r$/, "");
    input = input.slice(lineEnd + 1);
    if (!line.trim()) continue;
    try {
      handle(JSON.parse(line));
    } catch {
      process.exitCode = 34;
      process.exit();
    }
  }
});
