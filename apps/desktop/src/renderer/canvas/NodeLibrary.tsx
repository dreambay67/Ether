import { useEffect, useRef, useState } from "react";
import type { CanvasTemplateId } from "@ether/engine/graph/reviewRouterTemplate";
import type { EtherNodeDefinition } from "@ether/engine/graph/nodeCatalog";
import { AddNodePalette } from "./library/AddNodePalette";
import { TemplateGallery } from "./library/TemplateGallery";

type NodeLibraryProps = {
  onAddNode(definition: EtherNodeDefinition): void;
  onAddTemplate(templateId: CanvasTemplateId): void;
  templateFocusSignal: number;
};

export function NodeLibrary({ onAddNode, onAddTemplate, templateFocusSignal }: NodeLibraryProps) {
  const [activeSection, setActiveSection] = useState<"nodes" | "templates">("nodes");
  const templateButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (templateFocusSignal === 0) {
      return;
    }

    setActiveSection("templates");
    window.requestAnimationFrame(() => templateButtonRef.current?.focus());
  }, [templateFocusSignal]);

  return (
    <div className="node-library">
      <div className="node-library-tabs" aria-label="Node library sections">
        <button
          type="button"
          aria-pressed={activeSection === "nodes"}
          onClick={() => setActiveSection("nodes")}
        >
          Nodes
        </button>
        <button
          ref={templateButtonRef}
          type="button"
          aria-pressed={activeSection === "templates"}
          onClick={() => setActiveSection("templates")}
        >
          Templates
        </button>
      </div>
      {activeSection === "nodes" ? (
        <AddNodePalette onAddNode={onAddNode} />
      ) : (
        <TemplateGallery onAddTemplate={onAddTemplate} />
      )}
    </div>
  );
}
