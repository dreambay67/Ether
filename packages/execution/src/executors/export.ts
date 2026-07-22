import { ExecutorFailure, requireFacet, type ExecutorContext, type ExecutorResult, type StepExecutor } from "./types.js";

export class ExportExecutor implements StepExecutor {
  readonly kinds = ["export"] as const;

  async execute(context: ExecutorContext): Promise<ExecutorResult> {
    const exporter = requireFacet(context.providers.export, "export");
    const pathGrantId = context.step.parameters.pathGrantId;
    const namingTemplate = context.step.parameters.namingTemplate;
    const format = context.step.parameters.format;
    const collisionPolicy = context.step.parameters.collisionPolicy;
    const includeMetadata = context.step.parameters.includeMetadata;
    if (
      typeof pathGrantId !== "string" || typeof namingTemplate !== "string" ||
      (format !== "original" && format !== "png" && format !== "jpeg" && format !== "webp") ||
      (collisionPolicy !== "rename" && collisionPolicy !== "skip" && collisionPolicy !== "error") ||
      typeof includeMetadata !== "boolean"
    ) {
      throw new ExecutorFailure("EXPORT_CONFIGURATION_INVALID", "Export requires a path grant, format, collision policy, and metadata setting.");
    }
    const result = await exporter.export({
      pathGrantId,
      namingTemplate,
      format,
      collisionPolicy,
      includeMetadata,
      payloads: context.inputs,
      signal: context.signal
    });
    return {
      kind: "complete",
      outputs: [{
        channel: "data",
        role: "general",
        content: { kind: "object", value: result, schemaId: "ether.export-result.v1" },
        metadata: { pathGrantId }
      }]
    };
  }
}
