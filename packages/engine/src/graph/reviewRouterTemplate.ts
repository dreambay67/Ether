import type { EtherGraph } from "../project/schema.js";
import { createGraphNodeData, type CanvasNodeData } from "./nodeCatalog.js";

export type ReviewRouterTemplateOptions = {
  idPrefix?: string;
  origin?: { x: number; y: number };
};

export type ReviewRouterTemplate = {
  nodes: Array<EtherGraph["nodes"][number] & { id: string; data: CanvasNodeData }>;
  edges: Array<EtherGraph["edges"][number] & { id: string; source: string; target: string; label: string }>;
};

const defaultOrigin = { x: 0, y: 0 };

export function createReviewRouterTemplate(
  options: ReviewRouterTemplateOptions = {}
): ReviewRouterTemplate {
  const idPrefix = sanitizeIdPrefix(options.idPrefix ?? "review-router");
  const origin = options.origin ?? defaultOrigin;

  const nodes = [
    reviewNode(`${idPrefix}-compare`, "store-compare", origin.x, origin.y, {
      title: "Compare",
      label: "Compare",
      compareLayout: 4,
      reviewDecision: "select"
    }),
    reviewNode(`${idPrefix}-evaluate`, "store-evaluate", origin.x + 280, origin.y, {
      title: "Evaluate",
      label: "Evaluate",
      instruction: "Score each image against the campaign direction and route pass, needs-edit, or fail.",
      evaluationThreshold: 70
    }),
    reviewNode(`${idPrefix}-filter`, "store-filter", origin.x + 560, origin.y, {
      title: "Filter",
      label: "Filter",
      filterAutoApply: true,
      filterDryRun: false,
      filterRules: "pass -> Selected; needs-edit -> Needs Edit; fail -> Rejected"
    }),
    reviewNode(`${idPrefix}-selected`, "store-collection", origin.x + 840, origin.y - 120, {
      title: "Selected",
      label: "Selected"
    }),
    reviewNode(`${idPrefix}-needs-edit`, "store-collection", origin.x + 840, origin.y, {
      title: "Needs Edit",
      label: "Needs Edit"
    }),
    reviewNode(`${idPrefix}-rejected`, "store-collection", origin.x + 840, origin.y + 120, {
      title: "Rejected",
      label: "Rejected"
    })
  ];

  const edges = [
    reviewEdge(`${idPrefix}-edge-compare-evaluate`, `${idPrefix}-compare`, `${idPrefix}-evaluate`, "review"),
    reviewEdge(`${idPrefix}-edge-evaluate-filter`, `${idPrefix}-evaluate`, `${idPrefix}-filter`, "evaluation"),
    reviewEdge(`${idPrefix}-edge-filter-selected`, `${idPrefix}-filter`, `${idPrefix}-selected`, "pass"),
    reviewEdge(`${idPrefix}-edge-filter-needs-edit`, `${idPrefix}-filter`, `${idPrefix}-needs-edit`, "needs-edit"),
    reviewEdge(`${idPrefix}-edge-filter-rejected`, `${idPrefix}-filter`, `${idPrefix}-rejected`, "fail")
  ];

  return { nodes, edges };
}

function reviewNode(
  id: string,
  definitionId: string,
  x: number,
  y: number,
  data: Partial<CanvasNodeData>
): ReviewRouterTemplate["nodes"][number] {
  return {
    id,
    type: "etherNode",
    position: { x, y },
    width: 236,
    height: 150,
    data: {
      ...createGraphNodeData(definitionId),
      ...data
    }
  };
}

function reviewEdge(id: string, source: string, target: string, label: string) {
  return {
    id,
    source,
    target,
    label,
    data: { label }
  };
}

function sanitizeIdPrefix(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-|-$/g, "");

  return normalized || "review-router";
}
