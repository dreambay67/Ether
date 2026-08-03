import type { EtherNode, NodeConfig } from "@ether/schema";

export type CanvasEditorField = "title" | "primary";

export type PrimaryEditor = {
  label: string;
  placeholder: string;
  value: string;
};

const FILTER_OPERATORS = new Set(["eq", "neq", "gt", "gte", "lt", "lte", "contains", "exists"]);

export function primaryEditorFor(node: EtherNode): PrimaryEditor | null {
  switch (node.config.kind) {
    case "prompt.text": return { label: "Prompt body", placeholder: "Describe the result you want…", value: node.config.body };
    case "prompt.worker": return { label: "Worker instruction", placeholder: "Give this worker a clear instruction…", value: node.config.instruction };
    case "canvas.note": return { label: "Note body", placeholder: "Write a note for this canvas…", value: node.config.body };
    case "review.evaluate": return { label: "Evaluation instruction", placeholder: "Describe how results should be evaluated…", value: node.config.instruction };
    case "flow.variables": return { label: "Variables", placeholder: "subject = \"ceramic lamp\"", value: node.config.variables.map((item) => `${item.name} = ${JSON.stringify(item.value)}`).join("\n") };
    case "review.filter": return { label: "Filter rules", placeholder: "score gte 0.8", value: node.config.rules.map((rule) => `${rule.field} ${rule.operator}${rule.operator === "exists" ? "" : ` ${JSON.stringify(rule.value)}`}`).join("\n") };
    default: return null;
  }
}

export function configFromPrimaryDraft(node: EtherNode, draft: string): NodeConfig {
  switch (node.config.kind) {
    case "prompt.text": return { ...node.config, body: draft };
    case "prompt.worker": return { ...node.config, instruction: draft };
    case "canvas.note": return { ...node.config, body: draft };
    case "review.evaluate": return { ...node.config, instruction: draft };
    case "flow.variables": return { ...node.config, variables: parseVariables(draft) };
    case "review.filter": return { ...node.config, rules: parseFilterRules(draft) };
    default: throw new Error(`${node.title} uses the Inspector for its primary configuration.`);
  }
}

function nonBlankLines(draft: string) {
  return draft.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function parseJsonValue(source: string): import("@ether/schema").JsonValue {
  if (source === "") return "";
  try { return JSON.parse(source) as import("@ether/schema").JsonValue; }
  catch { return source; }
}

function parseVariables(draft: string) {
  return nonBlankLines(draft).map((line, index) => {
    const separator = line.indexOf("=");
    const name = (separator < 0 ? line : line.slice(0, separator)).trim();
    if (!name) throw new Error(`Variable line ${index + 1} needs a name.`);
    return { name, value: parseJsonValue(separator < 0 ? "" : line.slice(separator + 1).trim()) };
  });
}

function parseFilterRules(draft: string) {
  return nonBlankLines(draft).map((line, index) => {
    const [field = "", operator = "", ...valueParts] = line.split(/\s+/);
    if (!field || !FILTER_OPERATORS.has(operator)) throw new Error(`Filter line ${index + 1} must use: field operator value.`);
    const typedOperator = operator as "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "contains" | "exists";
    return {
      id: `rule-${index + 1}`,
      field,
      operator: typedOperator,
      ...(typedOperator === "exists" ? {} : { value: parseJsonValue(valueParts.join(" ")) })
    };
  });
}
