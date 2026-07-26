import { useCallback, useEffect, useMemo, useState } from "react";
import type { ExecutionAttempt, ExecutionJob, ExecutionPlan, ExecutionWorkItem } from "@ether/schema";

type TimelineEntry = { id: string; occurredAt: string; state: string; workItemId: string | null; attemptId: string | null };

export function JobDetail({ documentId, job, onChanged, onStatus }: { documentId: string; job: ExecutionJob; onChanged(): Promise<void>; onStatus(message: string): void }) {
  const [plan, setPlan] = useState<ExecutionPlan | null>(null);
  const [workItems, setWorkItems] = useState<ExecutionWorkItem[]>([]);
  const [attempts, setAttempts] = useState<ExecutionAttempt[]>([]);
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);

  const load = useCallback(async () => {
    const [planResponse, workResponse, attemptResponse, timelineResponse] = await Promise.all([
      window.ether.application.query({ kind: "query", id: crypto.randomUUID(), correlationId: crypto.randomUUID(), documentId, name: "plan.summary", payload: { planId: job.planId } }),
      window.ether.application.query({ kind: "query", id: crypto.randomUUID(), correlationId: crypto.randomUUID(), documentId, name: "job.workItems", payload: { jobId: job.id } }),
      window.ether.application.query({ kind: "query", id: crypto.randomUUID(), correlationId: crypto.randomUUID(), documentId, name: "job.attempts", payload: { jobId: job.id } }),
      window.ether.application.query({ kind: "query", id: crypto.randomUUID(), correlationId: crypto.randomUUID(), documentId, name: "job.timeline", payload: { jobId: job.id } })
    ]);
    if (planResponse.name !== "plan.summary" || workResponse.name !== "job.workItems" || attemptResponse.name !== "job.attempts" || timelineResponse.name !== "job.timeline") throw new Error("Ether returned mismatched job detail responses.");
    setPlan(planResponse.payload.plan);
    setWorkItems(workResponse.payload.workItems);
    setAttempts(attemptResponse.payload.attempts);
    setTimeline(timelineResponse.payload.entries);
  }, [documentId, job.id, job.planId]);

  useEffect(() => { void load().catch((cause) => onStatus(cause instanceof Error ? cause.message : "Job detail could not be loaded.")); }, [load, onStatus]);
  useEffect(() => window.ether.application.onEvent((event) => {
    if (!("documentId" in event) || event.documentId !== documentId) return;
    if ((event.name === "job.stateChanged" || event.name === "workItem.stateChanged" || event.name === "attempt.stateChanged") && event.payload.jobId === job.id) {
      void load().catch((cause) => onStatus(cause instanceof Error ? cause.message : "Live job detail could not be refreshed."));
    }
  }), [documentId, job.id, load, onStatus]);
  const failedIds = useMemo(() => workItems.filter((item) => item.status === "failed").map((item) => item.id), [workItems]);

  const command = async (name: "job.cancel" | "job.retry", payload: { jobId: string; workItemIds?: string[] }) => {
    try {
      await window.ether.application.command({ kind: "command", id: crypto.randomUUID(), correlationId: crypto.randomUUID(), documentId, name, payload } as Parameters<typeof window.ether.application.command>[0]);
      onStatus(`${name.replace("job.", "Job ")} requested.`);
      await Promise.all([load(), onChanged()]);
    } catch (cause) {
      onStatus(cause instanceof Error ? cause.message : "The job command needs attention.");
    }
  };

  return (
    <article className="job-detail" aria-label={`Job ${job.id} detail`}>
      <header><div><span>{job.status}</span><h3>{job.id}</h3></div><time>{new Date(job.createdAt).toLocaleString()}</time></header>
      <div className="job-actions">
        <button type="button" disabled={job.status !== "running" && job.status !== "queued"} onClick={() => void command("job.cancel", { jobId: job.id })}>Cancel</button>
        <button type="button" disabled={failedIds.length === 0} onClick={() => void command("job.retry", { jobId: job.id, workItemIds: failedIds })}>Retry failed ({failedIds.length})</button>
      </div>
      <div className="job-metrics"><span>{workItems.length} items</span><span>{workItems.filter((item) => item.status === "accepted").length} accepted</span><span>{attempts.length} attempts</span><span>{job.effectiveParallelism ?? plan?.effectiveParallelism ?? 1} active max</span></div>
      <details><summary>Immutable plan</summary><p>{plan ? `${plan.estimatedCalls} calls · ${plan.workItems.length} planned items · ${plan.contentHash.slice(0, 20)}…` : "Loading plan…"}</p>{plan?.warnings.map((warning) => <p key={`${warning.code}:${warning.nodeId ?? "graph"}`} className={warning.blocking ? "job-warning is-blocking" : "job-warning"}>{warning.message}</p>)}</details>
      <ol className="job-timeline">{timeline.slice(-12).reverse().map((entry) => <li key={entry.id}><time>{new Date(entry.occurredAt).toLocaleTimeString()}</time><strong>{entry.state}</strong><span>{entry.workItemId ?? "job"}</span></li>)}</ol>
    </article>
  );
}
