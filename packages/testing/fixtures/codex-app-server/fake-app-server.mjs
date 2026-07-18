import { appendFileSync, writeFileSync } from "node:fs";

const mode = process.env.ETHER_FAKE_APP_SERVER_MODE ?? "normal";
const requestLog = process.env.ETHER_FAKE_APP_SERVER_REQUEST_LOG;
const environmentLog = process.env.ETHER_FAKE_APP_SERVER_ENV_LOG;
const newline = mode === "crlf-split" ? "\r\n" : "\n";
let input = "";
let threadOrdinal = 0;
let turnOrdinal = 0;

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

function emitCompleted(threadId, turnId, text) {
  send({ method: "turn/started", params: { threadId, turn: turn(turnId) } });
  send({ method: "item/agentMessage/delta", params: { threadId, turnId, itemId: "agent-1", delta: text.slice(0, 4) } });
  send({ method: "warning", params: { threadId, message: "fixture warning" } });
  send({ method: "ether/unknown", params: { threadId, turnId, retained: true } });
  send({ method: "item/agentMessage/delta", params: { threadId, turnId, itemId: "agent-1", delta: text.slice(4) } });
  send({ method: "item/completed", params: { threadId, turnId, completedAtMs: 10, item: { id: "tool-1", type: "imageView", path: "C:\\Fixture\\view.png" } } });
  send({ method: "item/completed", params: { threadId, turnId, completedAtMs: 11, item: { id: "image-1", type: "imageGeneration", status: "completed", result: "generated", savedPath: "C:\\Fixture\\generated.png", revisedPrompt: null } } });
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
    send({ id: message.id, result: { codexHome: "C:\\CodexHome", platformFamily: "windows", platformOs: "windows", userAgent: "codex-cli/0.144.2" } });
    if (mode === "duplicate-response") send({ id: message.id, result: {} });
    if (mode === "die-idle") setTimeout(() => process.exit(32), 20);
    return;
  }
  if (message.method === "model/list") {
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
    send({ id: message.id, result: { turn: turn(id) } });
    if (mode === "die-active") return setTimeout(() => process.exit(33), 5);
    if (mode === "turn-error") {
      send({ method: "error", params: { threadId: message.params.threadId, turnId: id, willRetry: false, error: { message: "ordinary turn error", codexErrorInfo: "badRequest" } } });
      return send({ method: "turn/completed", params: { threadId: message.params.threadId, turn: { ...turn(id, "failed"), error: { message: "ordinary turn error" } } } });
    }
    if (mode === "oversized-frame") return writeRaw(`${JSON.stringify({ method: "warning", params: { message: "x".repeat(200000) } })}\n`);
    if (mode === "large-image-frame") {
      send({ method: "item/completed", params: { threadId: message.params.threadId, turnId: id, item: {
        id: "large-image", type: "imageGeneration", status: "completed", result: "x".repeat(2 * 1024 * 1024),
        savedPath: "C:\\Fixture\\large-generated.png", revisedPrompt: null
      } } });
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
