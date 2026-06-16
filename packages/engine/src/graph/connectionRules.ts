import { type EtherNodeKind, NODE_CATEGORY_LABELS, NODE_DEFINITIONS } from "./nodeCatalog.js";

export type ConnectionRuleResult = {
  allowed: boolean;
  reason?: string;
  defaultLabel?: string;
};

type ConnectionRuleContext = {
  sourceId?: string | null;
  targetId?: string | null;
  duplicate?: boolean;
};

const validTargets: Record<EtherNodeKind, EtherNodeKind[]> = {
  Prompt: ["Prompt", "Generation", "Assistant"],
  Reference: ["Generation", "Edit", "Store"],
  Edit: ["Generation", "Store"],
  Store: ["Store"],
  Assistant: ["Prompt", "Reference", "Note"],
  Generation: ["Edit", "Store"],
  Note: ["Prompt", "Reference", "Store"]
};

const defaultLabels: Record<string, string> = {
  "Prompt:Prompt": "prompt",
  "Prompt:Generation": "prompt",
  "Prompt:Assistant": "context",
  "Reference:Generation": "reference",
  "Reference:Edit": "reference",
  "Reference:Store": "reference",
  "Edit:Generation": "variant",
  "Edit:Store": "result",
  "Store:Store": "route",
  "Assistant:Prompt": "prompt",
  "Assistant:Reference": "reference",
  "Assistant:Note": "note",
  "Generation:Edit": "variant",
  "Generation:Store": "result",
  "Note:Prompt": "context",
  "Note:Reference": "context",
  "Note:Store": "context"
};

function isNodeKind(value: string): value is EtherNodeKind {
  return NODE_CATEGORY_LABELS.includes(value as EtherNodeKind);
}

function resolveNodeKind(value: string): EtherNodeKind | null {
  if (isNodeKind(value)) {
    return value;
  }

  return NODE_DEFINITIONS.find((definition) => definition.subtype === value)?.category ?? null;
}

export function canConnectNodeKinds(
  sourceKind: string,
  targetKind: string,
  context: ConnectionRuleContext = {}
): ConnectionRuleResult {
  if (context.sourceId && context.targetId && context.sourceId === context.targetId) {
    return { allowed: false, reason: "A node cannot connect to itself." };
  }

  if (context.duplicate) {
    return { allowed: false, reason: "This connection already exists." };
  }

  const resolvedSourceKind = resolveNodeKind(sourceKind);
  const resolvedTargetKind = resolveNodeKind(targetKind);

  if (!resolvedSourceKind || !resolvedTargetKind) {
    return { allowed: false, reason: "Unknown node type." };
  }

  if (!validTargets[resolvedSourceKind].includes(resolvedTargetKind)) {
    return {
      allowed: false,
      reason: `${sourceKind} nodes cannot connect directly to ${targetKind} nodes.`
    };
  }

  return {
    allowed: true,
    defaultLabel: defaultLabels[`${resolvedSourceKind}:${resolvedTargetKind}`] ?? "context"
  };
}
