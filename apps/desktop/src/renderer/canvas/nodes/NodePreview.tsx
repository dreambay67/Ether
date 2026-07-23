import type { EtherNode } from "@ether/schema";

export function NodePreview({ node }: { node: EtherNode }) {
  const content = node.config.kind === "prompt.text" ? node.config.body
    : node.config.kind === "prompt.worker" ? node.config.instruction
    : node.config.kind === "generation.image" ? `${node.config.aspectRatio} / ${node.config.resolution.width} x ${node.config.resolution.height} / ${node.config.outputCount} output${node.config.outputCount === 1 ? "" : "s"}`
    : node.config.kind === "reference.set" ? `${(node.config.members ?? node.config.artifactIds ?? []).length} reference${(node.config.members ?? node.config.artifactIds ?? []).length === 1 ? "" : "s"}`
    : node.config.kind === "canvas.note" ? node.config.body
    : node.config.kind === "review.evaluate" ? node.config.instruction
    : node.config.kind === "edit.image" ? `${node.config.profileId} / strength ${Math.round(node.config.strength * 100)}%`
    : node.definitionId.split(".")[1] ?? "Ready";
  return <p className="ether-node-preview">{content || "Ready for configuration"}</p>;
}
