import type { GenerationReferenceInput, ImageEditProviderInput } from "@ether/providers";

import { numberParameter, readStringMetadata, stringParameter } from "./input.js";
import { ExecutorFailure, requireFacet, type ExecutorContext, type ExecutorResult, type StepExecutor } from "./types.js";

export class ImageGenerationExecutor implements StepExecutor {
  readonly kinds = ["image-provider"] as const;

  async execute(context: ExecutorContext): Promise<ExecutorResult> {
    const provider = requireFacet(context.providers.image, "image generation");
    const binding = context.step.providerBinding ?? context.step.provider;
    const resolution = context.step.parameters.resolution;
    const size = resolution !== null && typeof resolution === "object" && !Array.isArray(resolution)
      ? resolution as { width?: unknown; height?: unknown }
      : {};
    const width = typeof size.width === "number" ? size.width : 1024;
    const height = typeof size.height === "number" ? size.height : 1024;
    const outputCount = numberParameter(context.step.parameters, "outputCount", 1);
    return {
      kind: "provider-generation",
      provider,
      operation: "generate",
      expectedOutputCount: outputCount,
      input: {
        workspacePath: context.stagingDirectory,
        runId: context.claim.job.id,
        generationNodeId: context.step.nodeId,
        iteration: context.claim.attempt.ordinal,
        prompt: context.step.compiledPrompt,
        negativePrompt: stringParameter(context.step.parameters, "negativePrompt"),
        sections: [],
        references: references(context),
        edgeRoles: [],
        outputCount,
        inputs: context.providerInputs,
        output: {
          aspectRatio: stringParameter(context.step.parameters, "aspectRatio", "1:1"),
          resolution: `${width}x${height}`,
          width,
          height,
          outputFormat: stringParameter(context.step.parameters, "outputFormat", "image/png") === "image/jpeg"
            ? "image/jpeg"
            : "image/png"
        },
        model: binding?.modelId ?? provider.descriptor.model,
        requestedAt: context.claim.attempt.startedAt ?? context.claim.attempt.createdAt
      }
    };
  }
}

export class ImageEditExecutor implements StepExecutor {
  readonly kinds = ["edit-provider"] as const;

  async execute(context: ExecutorContext): Promise<ExecutorResult> {
    const provider = requireFacet(context.providers.image, "image editing");
    const binding = context.step.providerBinding ?? context.step.provider;
    const source = context.inputs.find((input) => input.channel === "image");
    const assetPath = source === undefined ? undefined : readStringMetadata(source, "assetPath");
    if (source === undefined || assetPath === undefined) {
      throw new ExecutorFailure(
        "EDIT_SOURCE_REQUIRED",
        "Image Edit requires an image input with an authorized local artifact path."
      );
    }
    const mask = context.inputs.find((input) => input.channel === "mask");
    const maskPath = mask === undefined ? undefined : readStringMetadata(mask, "assetPath");
    const workspace = context.step.parameters.workspace;
    const workspaceRecord = recordValue(workspace);
    const workspaceFrame = frameValue(workspaceRecord?.frame);
    const workspaceRecipeId = typeof workspaceRecord?.recipeId === "string" ? workspaceRecord.recipeId : undefined;
    const configuredOperation = stringParameter(context.step.parameters, "operation", "");
    const operation = configuredOperation || operationForWorkspace(workspaceRecipeId, workspaceFrame);
    const capabilityMode = workspace !== null && typeof workspace === "object" && !Array.isArray(workspace)
      && workspace.capability !== null && typeof workspace.capability === "object" && !Array.isArray(workspace.capability)
      && typeof workspace.capability.mode === "string"
      ? workspace.capability.mode
      : null;
    if (capabilityMode === "unsupported") {
      throw new ExecutorFailure("EDIT_CAPABILITY_UNSUPPORTED", "The persisted edit workspace marks this provider capability as unsupported.");
    }
    if (!isEditOperation(operation)) {
      throw new ExecutorFailure("EDIT_OPERATION_INVALID", `Unsupported image edit operation ${operation}.`);
    }
    const outputCount = numberParameter(context.step.parameters, "outputCount", 1);
    const input: ImageEditProviderInput = {
      workspacePath: context.stagingDirectory,
      runId: context.claim.job.id,
      editNodeId: context.step.nodeId,
      editSubtype: operation,
      operation,
      iteration: context.claim.attempt.ordinal,
      prompt: context.step.compiledPrompt,
      negativePrompt: stringParameter(context.step.parameters, "negativePrompt"),
      instruction: context.step.compiledPrompt,
      notes: capabilityMode === "guidance-only"
        ? "The mask is guidance-only and is not guaranteed to produce pixel-exact native inpainting."
        : "",
      sections: [],
      references: references(context, new Set([
        source.id,
        ...(mask === undefined ? [] : [mask.id])
      ])),
      edgeRoles: [],
      outputCount,
      sourceImage: {
        assetId: source.content.kind === "artifact" ? source.content.artifactId : undefined,
        assetPath,
        assetMetadata: source.metadata
      },
      mask: maskPath === undefined ? null : {
        assetId: mask?.content.kind === "artifact" ? mask.content.artifactId : undefined,
        assetPath: maskPath,
        assetMetadata: {
          ...mask?.metadata,
          editCapabilityMode: capabilityMode,
          maskSemantics: capabilityMode === "guidance-only" ? "guidance-only-not-pixel-exact" : "native-or-unspecified"
        }
      },
      ...(workspaceRecipeId === undefined ? {} : { recipe: { id: workspaceRecipeId } }),
      ...(workspaceFrame === undefined ? {} : { frame: workspaceFrame }),
      inputs: context.providerInputs,
      model: binding?.modelId ?? provider.descriptor.model,
      requestedAt: context.claim.attempt.startedAt ?? context.claim.attempt.createdAt
    };
    return { kind: "provider-generation", provider, operation: "edit", input, expectedOutputCount: outputCount };
  }
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function frameValue(value: unknown): ImageEditProviderInput["frame"] {
  const frame = recordValue(value);
  if (frame === undefined || (frame.mode !== "source" && frame.mode !== "crop" && frame.mode !== "outpaint")) return undefined;
  const values = [frame.x, frame.y, frame.width, frame.height];
  if (!values.every((item) => typeof item === "number" && Number.isFinite(item))) return undefined;
  return {
    mode: frame.mode,
    x: frame.x as number,
    y: frame.y as number,
    width: frame.width as number,
    height: frame.height as number
  };
}

function operationForWorkspace(recipeId: string | undefined, frame: ImageEditProviderInput["frame"]): ImageEditProviderInput["operation"] {
  if (frame?.mode === "outpaint" || recipeId === "outpaint-scene") return "outpaint";
  return "inpaint";
}

function references(
  context: ExecutorContext,
  excludedInputIds: ReadonlySet<string> = new Set()
): GenerationReferenceInput[] {
  return context.inputs
    .filter((input) =>
      !excludedInputIds.has(input.id) &&
      (input.channel === "image" || input.channel === "video")
    )
    .flatMap((input) => {
      const assetPath = readStringMetadata(input, "assetPath");
      if (assetPath === undefined) return [];
      return [{
        nodeId: input.source.nodeId,
        role: input.role,
        title: input.id,
        sourceKind: input.channel,
        assetId: input.content.kind === "artifact" ? input.content.artifactId : undefined,
        assetPath,
        assetMetadata: input.metadata
      }];
    });
}

function isEditOperation(value: string): value is ImageEditProviderInput["operation"] {
  return value === "inpaint" || value === "outpaint" || value === "draw-note" || value === "upscale";
}
