import { referenceSetMembers, type EtherNode } from "@ether/schema";
import { NoteNodeVisual } from "./NoteNodeVisual";

export function NodePreview({ node }: { node: EtherNode }) {
  if (node.config.kind === "canvas.note" || node.config.kind === "canvas.drawing") {
    return <NoteNodeVisual config={node.config} compact />;
  }

  if (node.config.kind === "reference.set") {
    const members = referenceSetMembers(node.config);
    return (
      <div className="ether-node-reference-preview" data-testid="reference-set-preview" aria-label={`${members.length} references`}>
        {members.length === 0 ? <span className="ether-node-reference-empty">No references yet</span> : (
          <div className="ether-node-reference-grid" aria-label="Reference media grid">
            {members.slice(0, 3).map((member) => {
              const id = member.kind === "linked-reference" ? member.referenceId : member.artifactId;
              const label = member.kind === "linked-reference" ? "Linked reference" : "Embedded artifact";
              return (
                <span className={`ether-node-reference-tile${member.enabled ? "" : " is-disabled"}`} key={`${member.kind}:${id}`} title={`${label}: ${id}`}>
                  <span className="ether-node-reference-unavailable" aria-label="Media preview unavailable">Preview unavailable</span>
                  <strong>{id.length > 12 ? `${id.slice(0, 10)}…` : id}</strong>
                  <small>{member.enabled ? label : "Excluded"}</small>
                </span>
              );
            })}
          </div>
        )}
        {members.length > 3 ? <small className="ether-node-reference-overflow">+{members.length - 3} more references</small> : null}
      </div>
    );
  }

  const content = node.config.kind === "prompt.text" ? node.config.body
    : node.config.kind === "prompt.worker" ? node.config.instruction
    : node.config.kind === "generation.image" ? `${node.config.aspectRatio} / ${node.config.resolution.width} x ${node.config.resolution.height} / ${node.config.outputCount} output${node.config.outputCount === 1 ? "" : "s"}`
    : node.config.kind === "review.evaluate" ? node.config.instruction
    : node.config.kind === "edit.image" ? `${node.config.profileId} / strength ${Math.round(node.config.strength * 100)}%`
    : node.definitionId.split(".")[1] ?? "Ready";
  return <p className="ether-node-preview">{content || "Ready for configuration"}</p>;
}
