import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import {
  ApplicationCommandResponseSchema,
  ApplicationErrorMessageSchema,
  ApplicationQueryResponseSchema
} from "@ether/schema";
import { z } from "zod";

import type { EtherMcpApplicationAdapter } from "./applicationAdapter.js";
import {
  ActiveDocumentSchema,
  ApplicationBridgeResponseSchema,
  BridgeRequestSchema,
  BridgeResponseSchema,
  BridgeSessionDescriptorSchema,
  NodeCatalogSchema,
  PermitInspectionSchema,
  TransactionPreviewSchema,
  type BridgeRequest,
  type BridgeOperation,
  type BridgeResponse,
  type BridgeSessionDescriptor,
  type EtherMcpBridgeHost
} from "./bridgeProtocol.js";
import { EtherMcpError, normalizeError } from "./schemas.js";

const MAX_BRIDGE_MESSAGE_BYTES = 32 * 1024 * 1024;

export type EtherMcpApplicationBridge = {
  descriptor: BridgeSessionDescriptor;
  descriptorPath: string;
  close(): Promise<void>;
};

export function defaultMcpSessionDescriptorPath(environment: NodeJS.ProcessEnv = process.env): string {
  const localRoot = environment.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local");
  return path.join(localRoot, "DreamBay", "Ether", "mcp-session.json");
}

export async function startEtherMcpApplicationBridge(
  host: EtherMcpBridgeHost,
  options: { descriptorPath?: string } = {}
): Promise<EtherMcpApplicationBridge> {
  const descriptorPath = path.resolve(options.descriptorPath ?? defaultMcpSessionDescriptorPath());
  const descriptor: BridgeSessionDescriptor = {
    version: 1,
    pipeName: localPipeName(descriptorPath),
    authToken: randomBytes(32).toString("hex"),
    pid: process.pid,
    startedAt: new Date().toISOString()
  };
  const server = net.createServer((socket) => receiveOne(socket, descriptor, host));
  await listen(server, descriptor.pipeName);
  try {
    await publishDescriptor(descriptorPath, descriptor);
  } catch (error) {
    await closeServer(server);
    throw error;
  }
  let closePromise: Promise<void> | null = null;
  return {
    descriptor,
    descriptorPath,
    close() {
      closePromise ??= Promise.all([
        closeServer(server),
        removeOwnedDescriptor(descriptorPath, descriptor.authToken)
      ]).then(() => undefined);
      return closePromise;
    }
  };
}

export function createLocalBridgeApplicationAdapter(
  options: { descriptorPath?: string } = {}
): EtherMcpApplicationAdapter {
  const request = <T>(operation: BridgeOperation, schema: z.ZodType<T>) =>
    sendBridgeRequest(options.descriptorPath ?? defaultMcpSessionDescriptorPath(), operation).then((data) => schema.parse(data));
  return {
    activeDocument: () => request({ operation: "activeDocument" }, ActiveDocumentSchema),
    applyGraphTransaction: (input) => request({ operation: "applyGraphTransaction", ...input }, recordSchema),
    cancelRun: (input) => request({ operation: "cancelRun", ...input }, recordSchema),
    execute: (command) => request({ operation: "execute", command }, ApplicationBridgeResponseSchema).then((response) => {
      return commandResponse(response, command);
    }),
    inspectNodeCatalog: () => request({ operation: "inspectNodeCatalog" }, NodeCatalogSchema),
    inspectPermits: () => request({ operation: "inspectPermits" }, PermitInspectionSchema),
    instantiateRecipe: (input) => request({ operation: "instantiateRecipe", ...input }, recordSchema),
    previewGraphTransaction: (transaction) => request({ operation: "previewGraphTransaction", transaction }, TransactionPreviewSchema),
    query: (query) => request({ operation: "query", query }, ApplicationBridgeResponseSchema).then((response) => {
      return queryResponse(response, query);
    }),
    retryRun: (input) => request({ operation: "retryRun", ...input, workItemIds: [...input.workItemIds] }, recordSchema)
  };
}

const recordSchema = z.record(z.string(), z.unknown());

async function sendBridgeRequest(
  descriptorPath: string,
  operation: BridgeOperation
): Promise<unknown> {
  let descriptor: BridgeSessionDescriptor;
  try {
    descriptor = BridgeSessionDescriptorSchema.parse(JSON.parse(await readFile(descriptorPath, "utf8")));
  } catch (error) {
    throw new EtherMcpError("DESKTOP_SESSION_UNAVAILABLE", "document", "No live Ether desktop MCP session is available.", {
      retryable: true,
      userAction: "Start Ether and keep the target document open.",
      details: { descriptorPath, cause: error instanceof Error ? error.message : String(error) }
    });
  }
  const requestId = `bridge-${randomUUID()}`;
  const message = BridgeRequestSchema.parse({ version: 1, requestId, authToken: descriptor.authToken, ...operation });
  const response = await exchange(descriptor.pipeName, `${JSON.stringify(message)}\n`);
  const parsed = BridgeResponseSchema.parse(JSON.parse(response));
  if (parsed.requestId !== requestId) throw new EtherMcpError("BRIDGE_CORRELATION_MISMATCH", "security", "Ether rejected an uncorrelated desktop bridge response.");
  if (!parsed.ok) throw EtherMcpError.fromApplication(parsed.error);
  return parsed.data;
}

function receiveOne(socket: net.Socket, descriptor: BridgeSessionDescriptor, host: EtherMcpBridgeHost): void {
  let buffer = Buffer.alloc(0);
  let handled = false;
  socket.on("data", (chunk: Buffer) => {
    if (handled) return;
    buffer = Buffer.concat([buffer, chunk]);
    if (buffer.byteLength > MAX_BRIDGE_MESSAGE_BYTES) {
      handled = true;
      void respond(socket, bridgeFailure("bridge-oversize", new EtherMcpError("BRIDGE_MESSAGE_TOO_LARGE", "security", "The desktop bridge request exceeds the size limit.")));
      return;
    }
    const newline = buffer.indexOf(0x0a);
    if (newline < 0) return;
    handled = true;
    void handleRaw(buffer.subarray(0, newline).toString("utf8"), descriptor, host).then(
      (response) => respond(socket, response),
      (error) => respond(socket, bridgeFailure("bridge-invalid", error))
    );
  });
}

async function handleRaw(raw: string, descriptor: BridgeSessionDescriptor, host: EtherMcpBridgeHost): Promise<BridgeResponse> {
  let requestId = "bridge-invalid";
  try {
    const unknown = JSON.parse(raw) as { requestId?: unknown };
    if (typeof unknown.requestId === "string" && unknown.requestId.length > 0) requestId = unknown.requestId;
    const request = BridgeRequestSchema.parse(unknown);
    if (!secureTokenEqual(request.authToken, descriptor.authToken)) {
      throw new EtherMcpError("BRIDGE_AUTHENTICATION_FAILED", "security", "The desktop bridge token is invalid.");
    }
    const data = await dispatchBridgeRequest(host, request);
    return { version: 1, requestId: request.requestId, ok: true, data };
  } catch (error) {
    return bridgeFailure(requestId, error);
  }
}

async function dispatchBridgeRequest(host: EtherMcpBridgeHost, request: BridgeRequest): Promise<unknown> {
  switch (request.operation) {
    case "activeDocument": return host.activeDocument();
    case "execute": return host.execute(request.command);
    case "query": return host.query(request.query);
    case "inspectNodeCatalog": return host.inspectNodeCatalog();
    case "inspectPermits": return host.inspectPermits();
    case "previewGraphTransaction": return host.previewGraphTransaction(request.transaction);
    case "applyGraphTransaction": return host.applyGraphTransaction(request);
    case "instantiateRecipe": {
      if (request.command.name !== "recipe.instantiate") throw new EtherMcpError("BRIDGE_OPERATION_REJECTED", "security", "Only recipe.instantiate is accepted by this bridge operation.");
      return host.instantiateRecipe(request);
    }
    case "cancelRun": return host.cancelRun(request);
    case "retryRun": return host.retryRun(request);
  }
}

function commandResponse(response: z.infer<typeof ApplicationBridgeResponseSchema>, request: Parameters<EtherMcpApplicationAdapter["execute"]>[0]) {
  if (response.kind === "error") {
    const parsed = ApplicationErrorMessageSchema.parse(response);
    validateErrorIdentity(parsed, request);
    return parsed;
  }
  const parsed = ApplicationCommandResponseSchema.parse(response);
  validateApplicationIdentity(parsed, request);
  return parsed;
}

function queryResponse(response: z.infer<typeof ApplicationBridgeResponseSchema>, request: Parameters<EtherMcpApplicationAdapter["query"]>[0]) {
  if (response.kind === "error") {
    const parsed = ApplicationErrorMessageSchema.parse(response);
    validateErrorIdentity(parsed, request);
    return parsed;
  }
  const parsed = ApplicationQueryResponseSchema.parse(response);
  validateApplicationIdentity(parsed, request);
  return parsed;
}

function validateErrorIdentity(
  response: { requestId: string; correlationId: string },
  request: { id: string; correlationId: string }
): void {
  if (response.requestId !== request.id || response.correlationId !== request.correlationId) {
    throw new EtherMcpError("APPLICATION_RESPONSE_MISMATCH", "security", "The desktop application error does not match its validated request.");
  }
}

function validateApplicationIdentity(
  response: { requestId: string; correlationId: string; name: string; documentId?: string },
  request: { id: string; correlationId: string; name: string; documentId?: string }
): void {
  if (response.requestId !== request.id || response.correlationId !== request.correlationId || response.name !== request.name || response.documentId !== request.documentId) {
    throw new EtherMcpError("APPLICATION_RESPONSE_MISMATCH", "security", "The desktop application response does not match its validated request.");
  }
}

function bridgeFailure(requestId: string, error: unknown): BridgeResponse {
  return { version: 1, requestId, ok: false, error: normalizeError(error).structured().error };
}

function secureTokenEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.byteLength === rightBytes.byteLength && timingSafeEqual(leftBytes, rightBytes);
}

function localPipeName(descriptorPath: string): string {
  const identity = createHash("sha256").update(`${descriptorPath}\0${randomUUID()}`).digest("hex").slice(0, 32);
  return process.platform === "win32" ? `\\\\.\\pipe\\dreambay-ether-4-${identity}` : path.join(os.tmpdir(), `dreambay-ether-4-${identity}.sock`);
}

async function publishDescriptor(descriptorPath: string, descriptor: BridgeSessionDescriptor): Promise<void> {
  await mkdir(path.dirname(descriptorPath), { recursive: true });
  const temporaryPath = `${descriptorPath}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(descriptor, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  await rename(temporaryPath, descriptorPath);
}

async function removeOwnedDescriptor(descriptorPath: string, authToken: string): Promise<void> {
  try {
    const current = BridgeSessionDescriptorSchema.parse(JSON.parse(await readFile(descriptorPath, "utf8")));
    if (secureTokenEqual(current.authToken, authToken)) await unlink(descriptorPath);
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? String((error as { code: unknown }).code) : "";
    if (code !== "ENOENT") throw error;
  }
}

function listen(server: net.Server, pipeName: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => { server.off("listening", onListening); reject(error); };
    const onListening = () => { server.off("error", onError); resolve(); };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(pipeName);
  });
}

function closeServer(server: net.Server): Promise<void> {
  return new Promise((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
}

function exchange(pipeName: string, message: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(pipeName);
    let buffer = Buffer.alloc(0);
    socket.once("error", reject);
    socket.on("data", (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.byteLength > MAX_BRIDGE_MESSAGE_BYTES) {
        socket.destroy();
        reject(new EtherMcpError("BRIDGE_MESSAGE_TOO_LARGE", "security", "The desktop bridge response exceeds the size limit."));
      }
    });
    socket.once("connect", () => socket.write(message));
    socket.once("end", () => resolve(buffer.toString("utf8").trim()));
  });
}

async function respond(socket: net.Socket, response: BridgeResponse): Promise<void> {
  socket.end(`${JSON.stringify(BridgeResponseSchema.parse(response))}\n`);
}
