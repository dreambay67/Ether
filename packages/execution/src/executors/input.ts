import type { PayloadEnvelope as ProviderPayloadEnvelope } from "@ether/providers";
import type { JsonObject, JsonValue, PayloadEnvelope } from "@ether/schema";

export function toProviderPayloads(inputs: readonly PayloadEnvelope[]): ProviderPayloadEnvelope[] {
  return inputs.map((input) => ({
    id: input.id,
    channel: input.channel,
    role: input.role,
    text: input.content.kind === "text" ? input.content.value : undefined,
    data: input.content.kind === "object" ? input.content.value : undefined,
    assetId: input.content.kind === "artifact" ? input.content.artifactId : undefined,
    // Artifact resolution deliberately materializes paths on the immutable
    // payload envelope's metadata. Promote the transport fields here so every
    // provider (including Assistant vision turns) sees the actual local file,
    // rather than having to know Ether's persistence detail.
    assetPath: readStringMetadata(input, "assetPath"),
    uri: readStringMetadata(input, "uri"),
    mimeType: readStringMetadata(input, "mimeType") ?? readStringMetadata(input, "mediaType"),
    metadata: input.metadata,
    sourceNodeId: input.source.nodeId,
    sourceEdgeId: input.source.edgeId
  }));
}

export function stringParameter(parameters: JsonObject, name: string, fallback = ""): string {
  const value = parameters[name];
  return typeof value === "string" ? value : fallback;
}

export function booleanParameter(parameters: JsonObject, name: string, fallback = false): boolean {
  const value = parameters[name];
  return typeof value === "boolean" ? value : fallback;
}

export function numberParameter(parameters: JsonObject, name: string, fallback: number): number {
  const value = parameters[name];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function objectParameter(parameters: JsonObject, name: string): JsonObject {
  const value = parameters[name];
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}

export function readStringMetadata(input: PayloadEnvelope, name: string): string | undefined {
  const value = input.metadata[name];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function jsonObject(value: unknown): JsonObject {
  const normalized = jsonValue(value);
  return normalized !== null && typeof normalized === "object" && !Array.isArray(normalized) ? normalized : {};
}

export function jsonValue(value: unknown): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.map(jsonValue);
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, jsonValue(entry)])
    );
  }
  return String(value);
}
