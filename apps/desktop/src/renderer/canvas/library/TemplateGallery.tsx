import {
  CANVAS_TEMPLATE_CATALOG,
  type CanvasTemplateId
} from "@ether/engine/graph/reviewRouterTemplate";

type TemplateGalleryProps = {
  onAddTemplate(templateId: CanvasTemplateId): void;
};

export function TemplateGallery({ onAddTemplate }: TemplateGalleryProps) {
  return (
    <div className="template-gallery" data-testid="template-gallery">
      {CANVAS_TEMPLATE_CATALOG.map((template) => (
        <button
          key={template.id}
          type="button"
          className="template-gallery-item"
          onClick={() => onAddTemplate(template.id)}
          data-testid={`template-card-${template.id}`}
        >
          <strong>{template.title}</strong>
          <span>{template.description}</span>
        </button>
      ))}
    </div>
  );
}
