import { connectionRoles, payloadChannels, type ConnectionDecision, type ConnectionRole, type NodeDefinitionId, type PayloadChannel } from "@ether/schema";
import { validateConnection } from "./connectionValidator.js";
import { nodeDefinitions } from "./registry.js";

export type ConnectionMatrixRow = {
  key: string;
  sourceDefinitionId: NodeDefinitionId;
  sourceChannel: PayloadChannel;
  targetDefinitionId: NodeDefinitionId;
  targetChannel: PayloadChannel;
  role: ConnectionRole;
  decision: ConnectionDecision;
};

export function enumerateConnectionMatrix(capabilities: readonly string[]): ConnectionMatrixRow[] {
  const rows: ConnectionMatrixRow[] = [];
  for (const source of nodeDefinitions) for (const sourceChannel of payloadChannels) for (const target of nodeDefinitions) for (const targetChannel of payloadChannels) for (const role of connectionRoles) {
    const key = `${source.id}|${sourceChannel}|${target.id}|${targetChannel}|${role}`;
    rows.push({ key, sourceDefinitionId: source.id, sourceChannel, targetDefinitionId: target.id, targetChannel, role, decision: validateConnection({ sourceDefinitionId: source.id, sourceChannel, targetDefinitionId: target.id, targetChannel, role, capabilities }) });
  }
  return rows;
}

export function connectionMatrixHash(rows: readonly ConnectionMatrixRow[]): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (const row of rows) {
    const decision = row.decision.allowed ? `A:${row.decision.adapter?.adapterId ?? "same"}:${row.decision.consequences.map((item) => `${item.executorInputField}:${item.assemblyStrategy}:${item.preservationRule}`).join(",")}` : `R:${row.decision.code}:${JSON.stringify(row.decision.remedies)}`;
    for (const character of `${row.key}:${decision}\n`) {
      hash ^= BigInt(character.charCodeAt(0));
      hash = (hash * prime) & mask;
    }
  }
  return `ether-matrix-v1:${hash.toString(16).padStart(16, "0")}`;
}
