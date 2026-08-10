import { getNodeDefinition } from "@ether/graph-kernel";
import { EtherNodeSchema, type EtherNode, type ModuleParameter } from "@ether/schema";

import { registrySelectOptions } from "../inspector/registryFieldModel";

export type ModuleParameterControl = "text" | "number" | "boolean" | "select";
export type ModuleParameterValue = string | number | boolean;
export type ModuleParameterMetadata = {
  valueType: "string" | "number" | "boolean";
  control: ModuleParameterControl;
  options?: string[];
};
export type ModuleParameterCandidate = ModuleParameter & { exposure: ModuleParameterMetadata };

const excludedFields = new Set([
  "kind",
  "providerId",
  "profileId",
  "model",
  "reasoningEffort",
  "artifactIds",
  "members",
  "pathGrantId",
  "workspace",
  "strokes"
]);

const moduleSelectOptions: Record<string, readonly string[]> = {
  ...registrySelectOptions,
  "prompt.text.assembly": ["append", "replace"],
  "generation.image.outputFormat": ["image/png", "image/jpeg"]
};

function labelFor(field: string): string {
  return field.replace(/([A-Z])/g, " $1").replace(/^./, (value) => value.toUpperCase());
}

function metadataFor(kind: string, field: string, value: unknown): ModuleParameterMetadata | null {
  if (excludedFields.has(field)) return null;
  const options = moduleSelectOptions[`${kind}.${field}`];
  if (options !== undefined && typeof value === "string" && options.includes(value)) {
    return { valueType: "string", control: "select", options: [...options] };
  }
  if (typeof value === "string") return { valueType: "string", control: "text" };
  if (typeof value === "number" && Number.isFinite(value)) return { valueType: "number", control: "number" };
  if (typeof value === "boolean") return { valueType: "boolean", control: "boolean" };
  return null;
}

/**
 * Only scalar, registry-declared inspector fields may become an external module
 * control. Provider routing, opaque grants, artifacts, and managed workspaces
 * are intentionally not candidates.
 */
export function moduleParameterCandidates(node: EtherNode): ModuleParameterCandidate[] {
  const definition = getNodeDefinition(node.definitionId);
  const config = node.config as Record<string, unknown>;
  const fields = [...new Set(definition.inspector.sections.flatMap((section) => section.fields))];
  return fields.flatMap((field) => {
    const metadata = metadataFor(node.config.kind, field, config[field]);
    if (metadata === null) return [];
    return [{
      id: `parameter-${node.id}-${field}`,
      name: `${node.title} ${labelFor(field)}`,
      nodeId: node.id,
      configPath: [field],
      required: false,
      exposure: { ...metadata }
    }];
  });
}

export function moduleParameterMetadata(node: EtherNode, parameter: ModuleParameter): ModuleParameterMetadata | null {
  if (parameter.configPath.length !== 1) return null;
  const candidate = moduleParameterCandidates(node).find((item) => item.configPath[0] === parameter.configPath[0]);
  if (candidate === undefined) return null;
  const exposure = parameter.exposure;
  if (exposure?.valueType !== undefined && exposure.valueType !== candidate.exposure.valueType) return null;
  if (exposure?.control !== undefined && exposure.control !== candidate.exposure.control) return null;
  if (exposure?.options !== undefined && (candidate.exposure.options === undefined || exposure.options.length !== candidate.exposure.options.length || exposure.options.some((option, index) => option !== candidate.exposure.options![index]))) return null;
  return {
    valueType: exposure?.valueType ?? candidate.exposure.valueType,
    control: exposure?.control ?? candidate.exposure.control,
    ...(exposure?.options === undefined ? (candidate.exposure.options === undefined ? {} : { options: candidate.exposure.options }) : { options: exposure.options })
  };
}

export function moduleParameterValue(node: EtherNode, parameter: ModuleParameter): ModuleParameterValue | null {
  const metadata = moduleParameterMetadata(node, parameter);
  const value = parameter.configPath.reduce<unknown>((current, segment) => current !== null && typeof current === "object" ? Reflect.get(current, segment) : undefined, node.config);
  if (metadata === null) return null;
  if (metadata.valueType === "string" && typeof value === "string") return value;
  if (metadata.valueType === "number" && typeof value === "number" && Number.isFinite(value)) return value;
  if (metadata.valueType === "boolean" && typeof value === "boolean") return value;
  return null;
}

export function updateModuleParameterNode<TNode extends EtherNode>(node: TNode, parameter: ModuleParameter, value: ModuleParameterValue): { ok: true; node: TNode } | { ok: false; message: string } {
  const metadata = moduleParameterMetadata(node, parameter);
  if (metadata === null) return { ok: false, message: `${parameter.name} is no longer a safe editable module parameter.` };
  if (typeof value !== metadata.valueType || typeof value === "number" && !Number.isFinite(value)) return { ok: false, message: `${parameter.name} needs a valid ${metadata.valueType} value.` };
  if (metadata.control === "select" && !metadata.options?.includes(value as string)) return { ok: false, message: `${parameter.name} must use one of its listed options.` };
  const config = structuredClone(node.config) as Record<string, unknown>;
  if (parameter.configPath.length !== 1) return { ok: false, message: `${parameter.name} no longer targets a supported configuration field.` };
  config[parameter.configPath[0]!] = value;
  const parsed = EtherNodeSchema.safeParse({ ...node, config });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? `${parameter.name} would make the member invalid.` };
  return { ok: true, node: parsed.data as TNode };
}
