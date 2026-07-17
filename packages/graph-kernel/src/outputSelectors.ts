import type { NodeOutputVersion, OutputSelector, PayloadChannel, PayloadEnvelope } from "@ether/schema";

export type OutputSelectorDiagnostic = {
  code: "NO_OUTPUT_VERSION" | "NO_OUTPUT_FOR_CHANNEL" | "NO_APPROVED_OUTPUT" | "PINNED_VERSION_NOT_FOUND" | "PINNED_VERSION_WRONG_NODE" | "PINNED_VERSION_WRONG_CHANNEL";
  message: string;
  outputVersionId?: string;
  channel?: PayloadChannel;
};

export type OutputSelectorResult = { versionIds: string[]; diagnostics: OutputSelectorDiagnostic[] };

function ordered(versions: readonly NodeOutputVersion[]): NodeOutputVersion[] {
  return [...versions].sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
}

export function resolveOutputSelector(input: {
  selector: OutputSelector;
  nodeId: string;
  channel: PayloadChannel;
  versions: readonly NodeOutputVersion[];
  payloads: readonly PayloadEnvelope[];
}): OutputSelectorResult {
  const owned = ordered(input.versions.filter((version) => version.nodeId === input.nodeId));
  const hasChannel = (version: NodeOutputVersion): boolean => version.outputPayloadIds.some((payloadId) => {
    const payload = input.payloads.find((candidate) => candidate.id === payloadId);
    return payload?.source.nodeId === input.nodeId
      && payload.source.outputVersionId === version.id
      && payload.channel === input.channel;
  });
  if (input.selector.kind === "pinned") {
    const pinnedId = input.selector.outputVersionId;
    const pinned = input.versions.find((version) => version.id === pinnedId);
    if (pinned === undefined) return { versionIds: [], diagnostics: [{ code: "PINNED_VERSION_NOT_FOUND", message: "Pinned output version does not exist.", outputVersionId: pinnedId }] };
    if (pinned.nodeId !== input.nodeId) return { versionIds: [], diagnostics: [{ code: "PINNED_VERSION_WRONG_NODE", message: "Pinned output version belongs to another node.", outputVersionId: pinned.id }] };
    if (!hasChannel(pinned)) return { versionIds: [], diagnostics: [{ code: "PINNED_VERSION_WRONG_CHANNEL", message: "Pinned output version does not contain the selected channel.", outputVersionId: pinned.id, channel: input.channel }] };
    return { versionIds: [pinned.id], diagnostics: [] };
  }
  if (owned.length === 0) return { versionIds: [], diagnostics: [{ code: "NO_OUTPUT_VERSION", message: "The source node has no immutable output versions." }] };
  const matching = owned.filter(hasChannel);
  if (matching.length === 0) return { versionIds: [], diagnostics: [{ code: "NO_OUTPUT_FOR_CHANNEL", message: `The source node has no immutable output version for ${input.channel}.`, channel: input.channel }] };
  if (input.selector.kind === "all") return { versionIds: matching.map((version) => version.id), diagnostics: [] };
  if (input.selector.kind === "latest") return { versionIds: [matching.at(-1)!.id], diagnostics: [] };
  const approved = matching.filter((version) => version.approval.state === "approved");
  if (approved.length === 0) return { versionIds: [], diagnostics: [{ code: "NO_APPROVED_OUTPUT", message: "The source node has no approved output version." }] };
  return { versionIds: [approved.at(-1)!.id], diagnostics: [] };
}
