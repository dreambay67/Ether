import { NODE_CATEGORIES, type EtherNodeDefinition } from "@ether/engine/graph/nodeCatalog";

type NodeLibraryProps = {
  onAddNode(definition: EtherNodeDefinition): void;
};

export function NodeLibrary({ onAddNode }: NodeLibraryProps) {
  return (
    <div className="node-library-list">
      {NODE_CATEGORIES.map((category) => (
        <details key={category.id} open={category.label === "Prompt" || category.label === "Generation"}>
          <summary>{category.label}</summary>
          <div className="node-library-items">
            {category.definitions.map((definition) => (
              <button
                key={definition.id}
                type="button"
                className="node-library-item"
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.setData("application/ether-node-definition", definition.id);
                  event.dataTransfer.effectAllowed = "copy";
                }}
                onClick={() => onAddNode(definition)}
                data-testid={`library-node-${definition.id}`}
              >
                <span aria-hidden="true" style={{ background: definition.accent }} />
                <strong>{definition.subtype}</strong>
                <em>{definition.category}</em>
              </button>
            ))}
          </div>
        </details>
      ))}
    </div>
  );
}
