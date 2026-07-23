import { createHash } from "node:crypto";

import { z } from "zod";

import { ExecutionScopeSchema } from "@ether/schema";

import { activeDocumentId, applicationCommand, applicationQuery } from "../applicationAdapter.js";
import { EtherMcpError, NonEmptyIdSchema } from "../schemas.js";
import type { EtherToolDefinition, ToolContext } from "../toolTypes.js";
import { executionAnnotations, planningAnnotations, readOnlyAnnotations } from "../toolTypes.js";
import { assertContentHash } from "./graph.js";

export const runTools: EtherToolDefinition[] = [
  {
    name: "ether.run.list",
    description: "List durable jobs without starting, cancelling, or retrying execution.",
    inputSchema: z.object({
      status: z.enum(["planned", "queued", "running", "completed", "failed", "cancelled", "waiting-review", "needs-attention"]).optional(),
      limit: z.number().int().positive().max(500).default(100)
    }).strict(),
    annotations: readOnlyAnnotations,
    async run({ application }, input) {
      return applicationQuery(application, "job.list", input);
    }
  },
  {
    name: "ether.run.inspect",
    description: "Inspect a durable job, timeline, work items, attempts, and immutable plan.",
    inputSchema: z.object({ jobId: NonEmptyIdSchema }).strict(),
    annotations: readOnlyAnnotations,
    async run({ application }, input) {
      const jobId = String(input.jobId);
      const jobSummary = await applicationQuery(application, "job.summary", { jobId });
      const job = record(jobSummary.job, "job");
      const planId = requiredString(job.planId, "job.planId");
      const [plan, timeline, workItems, attempts] = await Promise.all([
        applicationQuery(application, "plan.summary", { planId }),
        applicationQuery(application, "job.timeline", { jobId }),
        applicationQuery(application, "job.workItems", { jobId }),
        applicationQuery(application, "job.attempts", { jobId })
      ]);
      return { job: jobSummary, plan, timeline, workItems, attempts };
    }
  },
  {
    name: "ether.run.plan.inspect",
    description: "Inspect one persisted immutable run plan and its content hash.",
    inputSchema: z.object({ planId: NonEmptyIdSchema }).strict(),
    annotations: readOnlyAnnotations,
    async run({ application }, input) {
      return applicationQuery(application, "plan.summary", input);
    }
  },
  {
    name: "ether.run.plan.preview",
    description: "Compile and persist an immutable run-plan preview without launching providers.",
    inputSchema: z.object({ graphId: NonEmptyIdSchema, scope: ExecutionScopeSchema }).strict(),
    annotations: planningAnnotations,
    async run({ application }, input) {
      return applicationCommand(application, "run.preview", input);
    }
  },
  {
    name: "ether.run.start",
    description: "Explicitly start one exact immutable plan under its host-approved Run Permit.",
    inputSchema: z.object({
      planId: NonEmptyIdSchema,
      contentHash: NonEmptyIdSchema,
      runPermitId: NonEmptyIdSchema
    }).strict(),
    annotations: executionAnnotations,
    async run(context, input) {
      const planId = String(input.planId);
      const contentHash = String(input.contentHash);
      const planResponse = await applicationQuery(context.application, "plan.summary", { planId });
      const plan = record(planResponse.plan, "plan");
      assertContentHash(plan.contentHash, contentHash, planId);
      return applicationCommand(context.application, "run.start", input);
    }
  },
  {
    name: "ether.run.cancel",
    description: "Explicitly cancel a durable job under a Run Permit bound to that job's immutable plan.",
    inputSchema: z.object({ jobId: NonEmptyIdSchema, runPermitId: NonEmptyIdSchema }).strict(),
    annotations: executionAnnotations,
    async run(context, input) {
      const jobId = String(input.jobId);
      const documentId = await activeDocumentId(context.application);
      const authorization = await jobAuthorization(context, jobId);
      return context.application.cancelRun({
        commandId: `mcp-cancel-${jobId}`,
        documentId,
        jobId,
        runPermitId: String(input.runPermitId),
        ...authorization
      });
    }
  },
  {
    name: "ether.run.retry",
    description: "Explicitly retry selected failed work items under a Run Permit bound to the original immutable plan.",
    inputSchema: z.object({
      jobId: NonEmptyIdSchema,
      workItemIds: z.array(NonEmptyIdSchema).min(1),
      runPermitId: NonEmptyIdSchema
    }).strict(),
    annotations: executionAnnotations,
    async run(context, input) {
      const jobId = String(input.jobId);
      const documentId = await activeDocumentId(context.application);
      const authorization = await jobAuthorization(context, jobId);
      return context.application.retryRun({
        commandId: `mcp-retry-${jobId}-${selectionHash(input.workItemIds as string[])}`,
        documentId,
        jobId,
        runPermitId: String(input.runPermitId),
        workItemIds: input.workItemIds as string[],
        ...authorization
      });
    }
  }
];

async function jobAuthorization(context: ToolContext, jobId: string): Promise<{ planId: string; contentHash: string }> {
  const response = await applicationQuery(context.application, "job.summary", { jobId });
  const job = record(response.job, "job");
  return {
    planId: requiredString(job.planId, "job.planId"),
    contentHash: requiredString(job.planContentHash, "job.planContentHash")
  };
}

function selectionHash(workItemIds: readonly string[]): string {
  return createHash("sha256").update([...workItemIds].sort().join("\0")).digest("hex").slice(0, 24);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new EtherMcpError("APPLICATION_RESPONSE_INVALID", "validation", `The application returned an invalid ${label}.`);
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new EtherMcpError("APPLICATION_RESPONSE_INVALID", "validation", `The application response is missing ${label}.`);
  }
  return value;
}
