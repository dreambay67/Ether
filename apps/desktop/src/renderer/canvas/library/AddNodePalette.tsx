import { useMemo, useState } from "react";
import {
  NODE_CATEGORIES,
  type EtherNodeDefinition
} from "@ether/engine/graph/nodeCatalog";
import { getOptionalNodeContract } from "@ether/engine/graph/contracts";

type AddNodePaletteProps = {
  onAddNode(definition: EtherNodeDefinition): void;
};

function searchTextForDefinition(definition: EtherNodeDefinition) {
  const contract = getOptionalNodeContract(definition.id);

  return [
    definition.category,
    definition.subtype,
    definition.title,
    definition.description,
    contract?.description,
    ...(contract?.acceptedInputs ?? []),
    ...(contract?.producedOutputs ?? [])
  ].join(" ").toLowerCase();
}

export function AddNodePalette({ onAddNode }: AddNodePaletteProps) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const categories = useMemo(
    () =>
      NODE_CATEGORIES.map((category) => ({
        ...category,
        definitions: normalizedQuery
          ? category.definitions.filter((definition) =>
              searchTextForDefinition(definition).includes(normalizedQuery)
            )
          : category.definitions
      })).filter((category) => category.definitions.length > 0),
    [normalizedQuery]
  );

  return (
    <div className="node-palette">
      <label className="node-palette-search">
        <span>Search nodes</span>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Name, input, output..."
          aria-label="Search nodes"
          data-testid="node-palette-search"
        />
      </label>
      <div className="node-library-list">
        {categories.map((category) => (
          <details key={category.id} open={normalizedQuery.length > 0 || category.label === "Prompt" || category.label === "Generation"}>
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
                  title={`${definition.title}: ${definition.description}. Inputs and outputs are shown in the inspector contract.`}
                >
                  <span aria-hidden="true" style={{ background: definition.accent }} />
                  <strong>{definition.subtype}</strong>
                  <em>{definition.category}</em>
                </button>
              ))}
            </div>
          </details>
        ))}
        {categories.length === 0 ? (
          <p className="node-palette-empty">No matching nodes</p>
        ) : null}
      </div>
    </div>
  );
}
