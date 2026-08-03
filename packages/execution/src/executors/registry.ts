import type { NodeExecutorKind } from "@ether/schema";

import { CollectionExecutor } from "./collection.js";
import { AssemblyExecutor } from "./assembly.js";
import { ImageEditExecutor, ImageGenerationExecutor } from "./imageGeneration.js";
import { LocalMediaExecutor } from "./localMedia.js";
import { MediaInterpretationExecutor } from "./mediaInterpretation.js";
import { ReviewExecutor } from "./review.js";
import type { ExecutorContext, ExecutorResult, StepExecutor } from "./types.js";
import { WorkerExecutor } from "./worker.js";
import { ExportExecutor } from "./export.js";
import { JoinExecutor } from "./join.js";

export class ExecutorRegistry {
  private readonly executors = new Map<NodeExecutorKind, StepExecutor>();

  constructor(executors: readonly StepExecutor[] = defaultExecutors()) {
    for (const executor of executors) {
      for (const kind of executor.kinds) {
        if (this.executors.has(kind)) throw new Error(`Duplicate Ether executor registration for ${kind}.`);
        this.executors.set(kind, executor);
      }
    }
  }

  get(kind: NodeExecutorKind): StepExecutor {
    const executor = this.executors.get(kind);
    if (executor === undefined) throw new Error(`No Ether executor is registered for ${kind}.`);
    return executor;
  }

  execute(context: ExecutorContext): Promise<ExecutorResult> {
    return this.get(context.step.executor).execute(context);
  }
}

function defaultExecutors(): StepExecutor[] {
  return [
    new AssemblyExecutor(),
    new WorkerExecutor(),
    new ImageGenerationExecutor(),
    new ImageEditExecutor(),
    new MediaInterpretationExecutor(),
    new LocalMediaExecutor(),
    new ReviewExecutor(),
    new CollectionExecutor(),
    new ExportExecutor(),
    new JoinExecutor()
  ];
}
