import { useMemo, useRef, useState } from "react";
import type { ExecutionJob } from "@ether/schema";
import { Activity, RefreshCcw } from "lucide-react";
import { JobDetail } from "./JobDetail";
import { useJobs } from "./useJobs";

const rowHeight = 58;

type JobGroup = "all" | "queued" | "active" | "done" | "attention";

const jobGroups: ReadonlyArray<{ id: JobGroup; label: string }> = [
  { id: "all", label: "All" },
  { id: "queued", label: "Queued" },
  { id: "active", label: "Active" },
  { id: "done", label: "Done" },
  { id: "attention", label: "Attention required" }
];

function groupForStatus(status: ExecutionJob["status"]): Exclude<JobGroup, "all"> {
  if (status === "planned" || status === "queued") return "queued";
  if (status === "running") return "active";
  if (status === "completed" || status === "cancelled") return "done";
  return "attention";
}

function statusLabel(status: ExecutionJob["status"]) {
  return status.replaceAll("-", " ");
}

export function JobCenter({ documentId, onStatus }: { documentId: string; onStatus(message: string): void }) {
  const { jobs, loading, error, refresh } = useJobs(documentId);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeGroup, setActiveGroup] = useState<JobGroup>("all");
  const [scrollTop, setScrollTop] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const counts = useMemo(() => {
    const next: Record<JobGroup, number> = { all: jobs.length, queued: 0, active: 0, done: 0, attention: 0 };
    for (const job of jobs) next[groupForStatus(job.status)] += 1;
    return next;
  }, [jobs]);
  const filteredJobs = useMemo(
    () => activeGroup === "all" ? jobs : jobs.filter((job) => groupForStatus(job.status) === activeGroup),
    [activeGroup, jobs]
  );
  const selected = filteredJobs.find((job) => job.id === selectedId) ?? filteredJobs[0];
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - 3);
  const visible = useMemo(() => filteredJobs.slice(start, start + 12), [filteredJobs, start]);

  const chooseGroup = (group: JobGroup) => {
    setActiveGroup(group);
    setScrollTop(0);
    if (listRef.current) listRef.current.scrollTop = 0;
  };

  return (
    <section className="job-center" aria-label="Job Center">
      <header><div><span className="eyebrow">Durable execution</span><h2>Job Center</h2></div><button type="button" title="Refresh jobs" onClick={() => void refresh()}><RefreshCcw size={15} aria-hidden="true" />Refresh</button></header>
      <nav className="job-groups" aria-label="Filter jobs by status">
        {jobGroups.map((group) => (
          <button
            type="button"
            key={group.id}
            className={activeGroup === group.id ? "is-active" : ""}
            data-group={group.id}
            aria-pressed={activeGroup === group.id}
            aria-label={`${group.label}, ${counts[group.id]} job${counts[group.id] === 1 ? "" : "s"}`}
            onClick={() => chooseGroup(group.id)}
          >
            <span aria-hidden="true" />
            <strong>{group.label}</strong>
            <small>{counts[group.id]}</small>
          </button>
        ))}
      </nav>
      <div className="job-center-body">
        <div ref={listRef} className="job-list" data-testid="job-list" onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}>
          <div style={{ height: filteredJobs.length * rowHeight, position: "relative" }}>
            {visible.map((job, index) => <button type="button" key={job.id} className={selected?.id === job.id ? "is-selected" : ""} data-group={groupForStatus(job.status)} style={{ top: (start + index) * rowHeight, height: rowHeight }} onClick={() => setSelectedId(job.id)}><Activity size={14} aria-hidden="true" /><span><strong>{statusLabel(job.status)}</strong><small>{job.id}</small></span><time>{new Date(job.createdAt).toLocaleTimeString()}</time></button>)}
          </div>
        </div>
        <div className="job-detail-slot">{loading ? <p>Hydrating jobs…</p> : error ? <p role="alert">{error}</p> : selected ? <JobDetail documentId={documentId} job={selected} onChanged={refresh} onStatus={onStatus} /> : <p className="job-empty">{jobs.length === 0 ? "No durable jobs yet. Preview and start a run to see live status here." : `No ${jobGroups.find((group) => group.id === activeGroup)?.label.toLocaleLowerCase()} jobs.`}</p>}</div>
      </div>
      <footer>{jobs.length} durable job{jobs.length === 1 ? "" : "s"} · event driven</footer>
    </section>
  );
}
