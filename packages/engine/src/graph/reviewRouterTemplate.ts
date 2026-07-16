import type { EtherGraph } from "../project/schema.js";
import { createGraphNodeData, type CanvasNodeData } from "./nodeCatalog.js";

export type CanvasTemplateId =
  | "prompt-to-image"
  | "reference-set"
  | "product-shoot"
  | "character-sheet"
  | "edit-loop"
  | "review-router"
  | "collection-routing";

export type CanvasTemplateSummary = {
  id: CanvasTemplateId;
  title: string;
  description: string;
};

export type CanvasTemplateOptions = {
  idPrefix?: string;
  origin?: { x: number; y: number };
};

export type CanvasTemplate = {
  id: CanvasTemplateId;
  title: string;
  description: string;
  nodes: Array<EtherGraph["nodes"][number] & { id: string; data: CanvasNodeData }>;
  edges: Array<EtherGraph["edges"][number] & { id: string; source: string; target: string; label: string }>;
};

export type ReviewRouterTemplateOptions = {
  idPrefix?: string;
  origin?: { x: number; y: number };
};

export type ReviewRouterTemplate = Pick<CanvasTemplate, "nodes" | "edges">;

export const CANVAS_TEMPLATE_CATALOG: CanvasTemplateSummary[] = [
  {
    id: "prompt-to-image",
    title: "Prompt to Image",
    description: "Start with one prompt feeding one image generation."
  },
  {
    id: "reference-set",
    title: "Reference Set",
    description: "Collect image, moodboard, and note references for a brief."
  },
  {
    id: "product-shoot",
    title: "Product Shoot",
    description: "Subject, setting, reference, generation, and collection output."
  },
  {
    id: "character-sheet",
    title: "Character Sheet",
    description: "Prompt and reference inputs routed into a character sheet."
  },
  {
    id: "edit-loop",
    title: "Edit Loop",
    description: "Generate, inpaint, upscale, and store a refined result."
  },
  {
    id: "review-router",
    title: "Review Router",
    description: "Compare, evaluate, filter, and route selected outputs."
  },
  {
    id: "collection-routing",
    title: "Collection Routing",
    description: "Route generated output through review into collection buckets."
  }
];

const defaultOrigin = { x: 0, y: 0 };

export function createReviewRouterTemplate(
  options: ReviewRouterTemplateOptions = {}
): ReviewRouterTemplate {
  const template = createReviewRouterCanvasTemplate(options);

  return {
    nodes: template.nodes,
    edges: template.edges
  };
}

export function createCanvasTemplate(
  templateId: CanvasTemplateId,
  options: CanvasTemplateOptions = {}
): CanvasTemplate {
  switch (templateId) {
    case "prompt-to-image":
      return createPromptToImageTemplate(options);
    case "reference-set":
      return createReferenceSetTemplate(options);
    case "product-shoot":
      return createProductShootTemplate(options);
    case "character-sheet":
      return createCharacterSheetTemplate(options);
    case "edit-loop":
      return createEditLoopTemplate(options);
    case "review-router":
      return createReviewRouterCanvasTemplate(options);
    case "collection-routing":
      return createCollectionRoutingTemplate(options);
    default:
      throw new Error(`Unknown canvas template: ${templateId satisfies never}`);
  }
}

function createPromptToImageTemplate(options: CanvasTemplateOptions = {}): CanvasTemplate {
  const template = getTemplateSummary("prompt-to-image");
  const idPrefix = sanitizeIdPrefix(options.idPrefix ?? template.id);
  const origin = options.origin ?? defaultOrigin;

  return {
    ...template,
    nodes: [
      templateNode(`${idPrefix}-prompt`, "prompt-prompt", origin.x, origin.y, {
        instruction: "Describe the image you want to make."
      }),
      templateNode(`${idPrefix}-image`, "generation-image", origin.x + 300, origin.y, {
        instruction: "Generate from the connected prompt."
      })
    ],
    edges: [
      templateEdge(`${idPrefix}-edge-prompt-image`, `${idPrefix}-prompt`, `${idPrefix}-image`, "prompt")
    ]
  };
}

function createReferenceSetTemplate(options: CanvasTemplateOptions = {}): CanvasTemplate {
  const template = getTemplateSummary("reference-set");
  const idPrefix = sanitizeIdPrefix(options.idPrefix ?? template.id);
  const origin = options.origin ?? defaultOrigin;

  return {
    ...template,
    nodes: [
      templateNode(`${idPrefix}-hero-reference`, "reference-image", origin.x, origin.y, {
        title: "Hero Reference",
        label: "Hero Reference",
        instruction: "Link the primary visual reference."
      }),
      templateNode(`${idPrefix}-moodboard`, "reference-moodboard", origin.x + 280, origin.y, {
        title: "Moodboard",
        label: "Moodboard",
        instruction: "Gather style, texture, and lighting references."
      }),
      templateNode(`${idPrefix}-notes`, "note-cloud", origin.x + 140, origin.y + 180, {
        title: "Reference Notes",
        label: "Reference Notes",
        instruction: "Capture usage notes for this reference set."
      })
    ],
    edges: [
      templateEdge(`${idPrefix}-edge-note-reference`, `${idPrefix}-notes`, `${idPrefix}-hero-reference`, "context"),
      templateEdge(`${idPrefix}-edge-note-moodboard`, `${idPrefix}-notes`, `${idPrefix}-moodboard`, "context")
    ]
  };
}

function createProductShootTemplate(options: CanvasTemplateOptions = {}): CanvasTemplate {
  const template = getTemplateSummary("product-shoot");
  const idPrefix = sanitizeIdPrefix(options.idPrefix ?? template.id);
  const origin = options.origin ?? defaultOrigin;

  return {
    ...template,
    nodes: [
      templateNode(`${idPrefix}-subject`, "prompt-prompt", origin.x, origin.y - 90, {
        title: "Subject Prompt",
        label: "Subject Prompt",
        instruction: "Product, material, finish, and key features."
      }),
      templateNode(`${idPrefix}-setting`, "prompt-prompt", origin.x, origin.y + 90, {
        title: "Setting Prompt",
        label: "Setting Prompt",
        instruction: "Studio surface, lighting environment, and background."
      }),
      templateNode(`${idPrefix}-reference`, "reference-image", origin.x + 280, origin.y + 90, {
        title: "Product Reference",
        label: "Product Reference"
      }),
      templateNode(`${idPrefix}-image`, "generation-image", origin.x + 560, origin.y, {
        title: "Product Image",
        label: "Product Image"
      }),
      templateNode(`${idPrefix}-collection`, "store-collection", origin.x + 840, origin.y, {
        title: "Shoot Selects",
        label: "Shoot Selects"
      })
    ],
    edges: [
      templateEdge(`${idPrefix}-edge-subject-image`, `${idPrefix}-subject`, `${idPrefix}-image`, "subject", "subject"),
      templateEdge(`${idPrefix}-edge-setting-image`, `${idPrefix}-setting`, `${idPrefix}-image`, "setting", "setting"),
      templateEdge(`${idPrefix}-edge-reference-image`, `${idPrefix}-reference`, `${idPrefix}-image`, "context"),
      templateEdge(`${idPrefix}-edge-image-collection`, `${idPrefix}-image`, `${idPrefix}-collection`, "result")
    ]
  };
}

function createCharacterSheetTemplate(options: CanvasTemplateOptions = {}): CanvasTemplate {
  const template = getTemplateSummary("character-sheet");
  const idPrefix = sanitizeIdPrefix(options.idPrefix ?? template.id);
  const origin = options.origin ?? defaultOrigin;

  return {
    ...template,
    nodes: [
      templateNode(`${idPrefix}-prompt`, "prompt-prompt", origin.x, origin.y, {
        title: "Character Brief",
        label: "Character Brief",
        instruction: "Describe identity, wardrobe, expression range, and continuity details."
      }),
      templateNode(`${idPrefix}-reference`, "reference-image", origin.x, origin.y + 180, {
        title: "Character Reference",
        label: "Character Reference"
      }),
      templateNode(`${idPrefix}-sheet`, "generation-character-sheet", origin.x + 320, origin.y + 80, {
        title: "Character Sheet",
        label: "Character Sheet"
      }),
      templateNode(`${idPrefix}-collection`, "store-collection", origin.x + 620, origin.y + 80, {
        title: "Character Selects",
        label: "Character Selects"
      })
    ],
    edges: [
      templateEdge(`${idPrefix}-edge-prompt-sheet`, `${idPrefix}-prompt`, `${idPrefix}-sheet`, "prompt"),
      templateEdge(`${idPrefix}-edge-reference-sheet`, `${idPrefix}-reference`, `${idPrefix}-sheet`, "context"),
      templateEdge(`${idPrefix}-edge-sheet-collection`, `${idPrefix}-sheet`, `${idPrefix}-collection`, "result")
    ]
  };
}

function createEditLoopTemplate(options: CanvasTemplateOptions = {}): CanvasTemplate {
  const template = getTemplateSummary("edit-loop");
  const idPrefix = sanitizeIdPrefix(options.idPrefix ?? template.id);
  const origin = options.origin ?? defaultOrigin;

  return {
    ...template,
    nodes: [
      templateNode(`${idPrefix}-prompt`, "prompt-prompt", origin.x, origin.y - 100, {
        instruction: "Describe the first image draft."
      }),
      templateNode(`${idPrefix}-image`, "generation-image", origin.x + 280, origin.y - 100, {
        title: "Draft Image",
        label: "Draft Image"
      }),
      templateNode(`${idPrefix}-inpaint`, "edit-inpaint", origin.x + 560, origin.y - 100, {
        instruction: "Mask and repair the strongest draft."
      }),
      templateNode(`${idPrefix}-upscale`, "edit-upscale", origin.x + 840, origin.y - 100, {
        instruction: "Upscale the approved edit."
      }),
      templateNode(`${idPrefix}-collection`, "store-collection", origin.x + 1120, origin.y - 100, {
        title: "Finals",
        label: "Finals"
      })
    ],
    edges: [
      templateEdge(`${idPrefix}-edge-prompt-image`, `${idPrefix}-prompt`, `${idPrefix}-image`, "prompt"),
      templateEdge(`${idPrefix}-edge-image-inpaint`, `${idPrefix}-image`, `${idPrefix}-inpaint`, "variant"),
      templateEdge(`${idPrefix}-edge-inpaint-upscale`, `${idPrefix}-inpaint`, `${idPrefix}-upscale`, "variant"),
      templateEdge(`${idPrefix}-edge-upscale-collection`, `${idPrefix}-upscale`, `${idPrefix}-collection`, "result")
    ]
  };
}

function createReviewRouterCanvasTemplate(options: CanvasTemplateOptions = {}): CanvasTemplate {
  const template = getTemplateSummary("review-router");
  const idPrefix = sanitizeIdPrefix(options.idPrefix ?? "review-router");
  const origin = options.origin ?? defaultOrigin;

  const nodes = [
    templateNode(`${idPrefix}-compare`, "review-compare", origin.x, origin.y, {
      title: "Compare",
      label: "Compare",
      compareLayout: 4,
      reviewDecision: "select"
    }),
    templateNode(`${idPrefix}-evaluation`, "review-evaluation", origin.x + 280, origin.y, {
      title: "Evaluate",
      label: "Evaluate",
      instruction: "Score each image against the campaign direction and route pass, needs-edit, or fail.",
      evaluationThreshold: 70
    }),
    templateNode(`${idPrefix}-filter`, "review-filter", origin.x + 560, origin.y, {
      title: "Filter",
      label: "Filter",
      filterAutoApply: true,
      filterDryRun: false,
      filterRules: "pass -> Selected; needs-edit -> Needs Edit; fail -> Rejected"
    }),
    templateNode(`${idPrefix}-selected`, "store-collection", origin.x + 840, origin.y - 120, {
      title: "Selected",
      label: "Selected"
    }),
    templateNode(`${idPrefix}-needs-edit`, "store-collection", origin.x + 840, origin.y, {
      title: "Needs Edit",
      label: "Needs Edit"
    }),
    templateNode(`${idPrefix}-rejected`, "store-collection", origin.x + 840, origin.y + 120, {
      title: "Rejected",
      label: "Rejected"
    })
  ];

  const edges = [
    templateEdge(
      `${idPrefix}-edge-compare-evaluation`,
      `${idPrefix}-compare`,
      `${idPrefix}-evaluation`,
      "review",
      undefined,
      "compare",
      "compare"
    ),
    templateEdge(
      `${idPrefix}-edge-evaluation-filter`,
      `${idPrefix}-evaluation`,
      `${idPrefix}-filter`,
      "evaluation",
      undefined,
      "evaluation",
      "evaluation"
    ),
    templateEdge(
      `${idPrefix}-edge-filter-selected`,
      `${idPrefix}-filter`,
      `${idPrefix}-selected`,
      "pass",
      undefined,
      "route",
      "collection"
    ),
    templateEdge(
      `${idPrefix}-edge-filter-needs-edit`,
      `${idPrefix}-filter`,
      `${idPrefix}-needs-edit`,
      "needs-edit",
      undefined,
      "route",
      "collection"
    ),
    templateEdge(
      `${idPrefix}-edge-filter-rejected`,
      `${idPrefix}-filter`,
      `${idPrefix}-rejected`,
      "fail",
      undefined,
      "route",
      "collection"
    )
  ];

  return { ...template, nodes, edges };
}

function createCollectionRoutingTemplate(options: CanvasTemplateOptions = {}): CanvasTemplate {
  const template = getTemplateSummary("collection-routing");
  const idPrefix = sanitizeIdPrefix(options.idPrefix ?? template.id);
  const origin = options.origin ?? defaultOrigin;

  return {
    ...template,
    nodes: [
      templateNode(`${idPrefix}-image`, "generation-image", origin.x, origin.y, {
        title: "Generated Batch",
        label: "Generated Batch"
      }),
      templateNode(`${idPrefix}-compare`, "review-compare", origin.x + 280, origin.y, {
        title: "Compare Batch",
        label: "Compare Batch",
        compareLayout: 6
      }),
      templateNode(`${idPrefix}-evaluation`, "review-evaluation", origin.x + 560, origin.y, {
        title: "Evaluate Batch",
        label: "Evaluate Batch",
        evaluationThreshold: 75
      }),
      templateNode(`${idPrefix}-filter`, "review-filter", origin.x + 840, origin.y, {
        title: "Route Batch",
        label: "Route Batch",
        filterAutoApply: true,
        filterRules: "hero -> Campaign Heroes; alt -> Alternates"
      }),
      templateNode(`${idPrefix}-heroes`, "store-collection", origin.x + 1120, origin.y - 90, {
        title: "Campaign Heroes",
        label: "Campaign Heroes"
      }),
      templateNode(`${idPrefix}-alternates`, "store-collection", origin.x + 1120, origin.y + 90, {
        title: "Alternates",
        label: "Alternates"
      })
    ],
    edges: [
      templateEdge(`${idPrefix}-edge-image-compare`, `${idPrefix}-image`, `${idPrefix}-compare`, "result"),
      templateEdge(`${idPrefix}-edge-compare-evaluation`, `${idPrefix}-compare`, `${idPrefix}-evaluation`, "review"),
      templateEdge(`${idPrefix}-edge-evaluation-filter`, `${idPrefix}-evaluation`, `${idPrefix}-filter`, "evaluation"),
      templateEdge(`${idPrefix}-edge-filter-heroes`, `${idPrefix}-filter`, `${idPrefix}-heroes`, "hero", undefined, "route", "collection"),
      templateEdge(`${idPrefix}-edge-filter-alternates`, `${idPrefix}-filter`, `${idPrefix}-alternates`, "alt", undefined, "route", "collection")
    ]
  };
}

function templateNode(
  id: string,
  definitionId: string,
  x: number,
  y: number,
  data: Partial<CanvasNodeData>
): CanvasTemplate["nodes"][number] {
  return {
    id,
    type: "etherNode",
    position: { x, y },
    width: 236,
    height: 188,
    data: {
      ...createGraphNodeData(definitionId),
      ...data
    }
  };
}

function templateEdge(
  id: string,
  source: string,
  target: string,
  label: string,
  role?: string,
  sourceHandle?: string,
  targetHandle?: string
) {
  return {
    id,
    source,
    target,
    ...(sourceHandle ? { sourceHandle } : {}),
    ...(targetHandle ? { targetHandle } : {}),
    label,
    data: {
      label,
      ...(role ? { role } : {}),
      ...(sourceHandle ? { sourceHandle } : {}),
      ...(targetHandle ? { targetHandle } : {})
    }
  };
}

function getTemplateSummary(templateId: CanvasTemplateId) {
  const template = CANVAS_TEMPLATE_CATALOG.find((candidate) => candidate.id === templateId);

  if (!template) {
    throw new Error(`Unknown canvas template: ${templateId}`);
  }

  return template;
}

function sanitizeIdPrefix(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-|-$/g, "");

  return normalized || "review-router";
}
