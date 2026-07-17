import { connectionRoles, payloadChannels, type ConnectionDecision, type ConnectionRole, type InputConsequence, type NodeDefinitionId, type PayloadChannel, type PayloadEnvelope } from "@ether/schema";
import { adapterDefinitions, FULL_ADAPTER_CAPABILITIES } from "./adapters.js";
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

export type ExplicitAdapterMatrixRow = ConnectionMatrixRow & {
  adapterId: string;
  capabilityScenario: "full" | "none";
  capabilities: readonly string[];
};

export type ExecutorInputSlot = {
  assemblyStrategy: InputConsequence["assemblyStrategy"];
  preservationRule: InputConsequence["preservationRule"];
  payloads: PayloadEnvelope[];
};

export type ExecutorInputFixture = {
  targetDefinitionId: NodeDefinitionId;
  inputs: Record<string, ExecutorInputSlot>;
};

export function createExecutorInputFixture(targetDefinitionId: NodeDefinitionId): ExecutorInputFixture {
  if (!nodeDefinitions.some((definition) => definition.id === targetDefinitionId)) throw new Error(`Unknown executor fixture definition: ${targetDefinitionId}`);
  return { targetDefinitionId, inputs: {} };
}

export function applyInputConsequence(fixture: ExecutorInputFixture, consequence: InputConsequence, payload: PayloadEnvelope): ExecutorInputFixture {
  const definition = nodeDefinitions.find((candidate) => candidate.id === fixture.targetDefinitionId)!;
  const validFields = new Set(Object.values(definition.contract.consequences).flatMap((roles) => Object.values(roles ?? {}).map((item) => item.executorInputField)));
  if (!validFields.has(consequence.executorInputField)) throw new Error(`Unknown executor input field ${consequence.executorInputField} for ${fixture.targetDefinitionId}`);
  const current = fixture.inputs[consequence.executorInputField];
  if (current !== undefined && (current.assemblyStrategy !== consequence.assemblyStrategy || current.preservationRule !== consequence.preservationRule)) throw new Error(`Conflicting consequence contract for ${consequence.executorInputField}`);
  return {
    ...fixture,
    inputs: {
      ...fixture.inputs,
      [consequence.executorInputField]: {
        assemblyStrategy: consequence.assemblyStrategy,
        preservationRule: consequence.preservationRule,
        payloads: [...(current?.payloads ?? []), payload]
      }
    }
  };
}

export function enumerateConnectionMatrix(capabilities: readonly string[]): ConnectionMatrixRow[] {
  const rows: ConnectionMatrixRow[] = [];
  for (const source of nodeDefinitions) for (const sourceChannel of payloadChannels) for (const target of nodeDefinitions) for (const targetChannel of payloadChannels) for (const role of connectionRoles) {
    const key = `${source.id}|${sourceChannel}|${target.id}|${targetChannel}|${role}`;
    rows.push({ key, sourceDefinitionId: source.id, sourceChannel, targetDefinitionId: target.id, targetChannel, role, decision: validateConnection({ sourceDefinitionId: source.id, sourceChannel, targetDefinitionId: target.id, targetChannel, role, capabilities }) });
  }
  return rows;
}

export function enumerateExplicitAdapterMatrix(): ExplicitAdapterMatrixRow[] {
  const rows: ExplicitAdapterMatrixRow[] = [];
  const scenarios = [
    { id: "full" as const, capabilities: FULL_ADAPTER_CAPABILITIES },
    { id: "none" as const, capabilities: [] as const }
  ];
  for (const adapter of adapterDefinitions) {
    const sources = nodeDefinitions.filter((definition) => definition.library.outputChannels.includes(adapter.fromChannel));
    const targets = nodeDefinitions.filter((definition) => definition.library.inputChannels.includes(adapter.toChannel));
    for (const scenario of scenarios) for (const source of sources) for (const target of targets) for (const role of connectionRoles) {
      const key = `${adapter.id}|${scenario.id}|${source.id}|${adapter.fromChannel}|${target.id}|${adapter.toChannel}|${role}`;
      rows.push({
        key,
        adapterId: adapter.id,
        capabilityScenario: scenario.id,
        capabilities: scenario.capabilities,
        sourceDefinitionId: source.id,
        sourceChannel: adapter.fromChannel,
        targetDefinitionId: target.id,
        targetChannel: adapter.toChannel,
        role,
        decision: validateConnection({
          sourceDefinitionId: source.id,
          sourceChannel: adapter.fromChannel,
          targetDefinitionId: target.id,
          targetChannel: adapter.toChannel,
          role,
          adapter: { kind: "explicit", adapterId: adapter.id },
          capabilities: scenario.capabilities
        })
      });
    }
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
