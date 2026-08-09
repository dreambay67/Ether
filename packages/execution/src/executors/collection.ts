import { ExecutorFailure, requireFacet, type ExecutorContext, type ExecutorResult, type StepExecutor } from "./types.js";

export class CollectionExecutor implements StepExecutor {
  readonly kinds = ["collection"] as const;

  async execute(context: ExecutorContext): Promise<ExecutorResult> {
    const collection = requireFacet(context.providers.collection, "collection persistence");
    const collectionId = context.step.parameters.collectionId;
    const collectionTitle = context.step.parameters.collectionTitle;
    const mode = context.step.parameters.membershipMode;
    const makePrimary = context.step.parameters.makePrimary;
    if (
      typeof collectionId !== "string" ||
      typeof collectionTitle !== "string" ||
      (mode !== "add" && mode !== "replace") ||
      typeof makePrimary !== "boolean"
    ) {
      throw new ExecutorFailure("COLLECTION_CONFIGURATION_INVALID", "Collection requires a valid ID, title, and membership mode.");
    }
    const result = await collection.apply({ collectionId, collectionTitle, mode, makePrimary, payloads: context.inputs });
    return {
      kind: "complete",
      outputs: [{
        channel: "data",
        role: "general",
        content: { kind: "object", value: result, schemaId: "ether.collection-result.v1" },
        metadata: { collectionId }
      }]
    };
  }
}
