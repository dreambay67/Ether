import type { ExecutionJob } from "@ether/schema";
import { SAFE_GLOBAL_PARALLELISM } from "../plan/providerConcurrency.js";

export function isTerminalJob(job: ExecutionJob): boolean {
  return job.status === "completed" || job.status === "failed" || job.status === "cancelled" || job.status === "needs-attention";
}

export function effectiveParallelism(job: ExecutionJob): number {
  const requested = job.effectiveParallelism ?? job.requestedParallelism ?? 1;
  return Number.isInteger(requested) && requested > 0
    ? Math.min(requested, SAFE_GLOBAL_PARALLELISM)
    : 1;
}
