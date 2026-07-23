import { getNodeDefinition } from "@ether/graph-kernel";
import type { ConnectionRole, EtherGraph, EtherNode, NodeDefinitionId } from "@ether/schema";

export const roleLabels: Record<ConnectionRole, string> = {
  general: "General", negative: "Negative", subject: "Subject", product: "Product", face: "Face",
  clothing: "Clothing", pose: "Pose", setting: "Setting", composition: "Composition", style: "Style",
  lighting: "Lighting", colourPalette: "Colour Palette", typography: "Typography", motion: "Motion", timing: "Timing"
};

export const controlHelp: Record<string, string> = {
  title: "The title appears on the canvas. It does not alter the node's executable instruction.",
  body: "Authored source text. Changes are stored in the Ether document as a graph revision.",
  assembly: "Append keeps incoming text in order; Replace uses this authored text as the manual override.",
  behavior: "A worker behavior presets the transformation contract, not a hidden model call.",
  profile: "Fast, Balanced, and Deep resolve to inspectable model settings. Custom exposes the exact settings.",
  provider: "Only profiles returned by the active provider capability service are offered.",
  aspect: "Aspect ratios come from the selected provider profile.",
  resolution: "Available sizes come from the selected provider profile and are never guessed.",
  output: "Output count is capped by the selected provider profile.",
  references: "Add keeps existing set members. Replace swaps the complete set explicitly.",
  advanced: "Exact settings and compiled context are useful for diagnosis, but stay out of ordinary work."
};

export function inspectorDefinition(id: NodeDefinitionId) {
  return getNodeDefinition(id).inspector;
}

export function outgoingRoles(graph: EtherGraph, node: EtherNode) {
  return graph.edges.flatMap((edge) => edge.from.kind === "node" && edge.from.nodeId === node.id
    ? (() => { const target = edge.to; return [{ edge, target: target.kind === "node" ? graph.nodes.find((candidate) => candidate.id === target.nodeId)?.title ?? target.nodeId : `Module ${target.portId}` }]; })()
    : []);
}

export function nodeDisplayName(node: EtherNode): string {
  return getNodeDefinition(node.definitionId).title;
}
