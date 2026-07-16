import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Image, Play, RefreshCw, RotateCcw, Square } from "lucide-react";
import type { EtherJob, EtherJobItem, JobStatus } from "@ether/engine";
import type { RunJobDetail } from "../../ether-env";

type RunTimelineProps = {
  projectId: string | null;
  onFocusNode(nodeId: string): void;
};

type TimelineGroup = {
  id: string;
  label: string;
  details: RunJobDetail[];
};

const POLL_INTERVAL_MS = 5000;

export function RunTimeline({ projectId, onFocusNode }: RunTimelineProps) {
  const [details, setDetails] = useState<RunJobDetail[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [message, setMessage] = useState("No durable jobs yet");
  const refreshSequenceRef = useRef(0);
  const mountedRef = useRef(true);

  const jobsBridge = window.ether.execution?.jobs;
  const canUseJobs = Boolean(projectId && jobsBridge);

  const refresh = useCallback(async () => {
    const bridge = window.ether.execution?.jobs;
    const requestId = refreshSequenceRef.current + 1;

    refreshSequenceRef.current = requestId;

    if (!projectId || !bridge) {
      setDetails([]);
      setMessage("Open a project to inspect durable jobs");
      return;
    }

    setIsRefreshing(true);

    try {
      const jobs = await bridge.list(projectId);
      const recentJobs = [...jobs].sort((left, right) => right.createdAt.localeCompare(left.createdAt)).slice(0, 8);
      const nextDetails = (
        await Promise.all(recentJobs.map((job) => bridge.get(projectId, job.id)))
      ).filter(isRunJobDetail);

      if (!isCurrentRefresh(requestId, refreshSequenceRef, mountedRef)) {
        return;
      }

      setDetails(nextDetails);
      setMessage(nextDetails.length === 0 ? "No durable jobs yet" : "Timeline refreshed");
    } catch (error) {
      if (!isCurrentRefresh(requestId, refreshSequenceRef, mountedRef)) {
        return;
      }

      setMessage(error instanceof Error ? error.message : "Timeline refresh failed");
    } finally {
      if (isCurrentRefresh(requestId, refreshSequenceRef, mountedRef)) {
        setIsRefreshing(false);
      }
    }
  }, [projectId]);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      refreshSequenceRef.current += 1;
    };
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!canUseJobs) {
      return;
    }

    const interval = window.setInterval(() => {
      void refresh();
    }, POLL_INTERVAL_MS);

    return () => window.clearInterval(interval);
  }, [canUseJobs, refresh]);

  const groups = useMemo(() => groupDetails(details), [details]);
  const activeCount = details.filter((detail) => detail.job.status === "queued" || detail.job.status === "running").length;

  const cancelJob = async (job: EtherJob) => {
    const bridge = window.ether.execution?.jobs;

    if (!projectId || !bridge) {
      return;
    }

    try {
      await bridge.cancel(projectId, job.id);
      setMessage(`Canceled ${job.id}`);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Cancel failed");
    }
  };

  const executeJob = async (job: EtherJob) => {
    const bridge = window.ether.execution?.jobs;

    if (!projectId || !bridge) {
      return;
    }

    try {
      await bridge.execute(projectId, job.id);
      setMessage(`Resumed ${job.id}`);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Resume failed");
    }
  };

  const retryItem = async (item: EtherJobItem) => {
    const bridge = window.ether.execution?.jobs;

    if (!projectId || !bridge) {
      return;
    }

    try {
      await bridge.retryItem(projectId, item.id);
      setMessage(`Retried ${item.nodeId}`);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Retry failed");
    }
  };

  return (
    <section className="run-timeline" data-testid="run-timeline" aria-label="Run timeline">
      <div className="run-timeline-header">
        <div>
          <h3>Durable Runs</h3>
          <p>{activeCount} active job{activeCount === 1 ? "" : "s"}</p>
        </div>
        <button
          type="button"
          data-testid="run-timeline-refresh"
          onClick={() => void refresh()}
          disabled={isRefreshing || !canUseJobs}
          aria-label="Refresh run timeline"
          title="Refresh run timeline"
        >
          <RefreshCw size={14} aria-hidden="true" />
        </button>
      </div>
      <div className="run-timeline-groups">
        {groups.map((group) => (
          <TimelineGroupView
            key={group.id}
            group={group}
            onFocusNode={onFocusNode}
            onCancelJob={cancelJob}
            onExecuteJob={executeJob}
            onRetryItem={retryItem}
          />
        ))}
      </div>
      <p className="run-timeline-message" aria-live="polite">{message}</p>
    </section>
  );
}

function TimelineGroupView({
  group,
  onFocusNode,
  onCancelJob,
  onExecuteJob,
  onRetryItem
}: {
  group: TimelineGroup;
  onFocusNode(nodeId: string): void;
  onCancelJob(job: EtherJob): void | Promise<void>;
  onExecuteJob(job: EtherJob): void | Promise<void>;
  onRetryItem(item: EtherJobItem): void | Promise<void>;
}) {
  return (
    <div className="run-timeline-group" data-testid={`run-timeline-group-${group.id}`}>
      <h4>{group.label}</h4>
      <div className="run-timeline-list">
        {group.details.length === 0 ? <p className="run-timeline-empty">No runs</p> : null}
        {group.details.map((detail) => (
          <article key={detail.job.id} className={`run-timeline-job is-${detail.job.status}`}>
            <div className="run-timeline-job-topline">
              <strong>{formatJobLabel(detail.job)}</strong>
              <span>{detail.job.status}</span>
            </div>
            <div className="run-timeline-actions">
              {canCancelJob(detail.job.status) ? (
                <button
                  type="button"
                  data-testid={`run-timeline-cancel-${detail.job.id}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    void onCancelJob(detail.job);
                  }}
                  aria-label={`Cancel ${detail.job.status} job`}
                  title="Cancel job"
                >
                  <Square size={12} aria-hidden="true" />
                </button>
              ) : null}
              {canExecuteJob(detail.job.status) ? (
                <button
                  type="button"
                  data-testid={`run-timeline-execute-${detail.job.id}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    void onExecuteJob(detail.job);
                  }}
                  aria-label={`Resume ${detail.job.status} job`}
                  title="Resume job"
                >
                  <Play size={12} aria-hidden="true" />
                </button>
              ) : null}
            </div>
            <div className="run-timeline-items">
              {detail.items.map((item) => (
                <TimelineItem
                  key={item.id}
                  item={item}
                  onFocusNode={onFocusNode}
                  onRetryItem={onRetryItem}
                />
              ))}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function TimelineItem({
  item,
  onFocusNode,
  onRetryItem
}: {
  item: EtherJobItem;
  onFocusNode(nodeId: string): void;
  onRetryItem(item: EtherJobItem): void | Promise<void>;
}) {
  const outputPaths = outputAssetPaths(item);
  const retryLabel = item.retryCount > 0 ? `retried ${item.retryCount}` : null;

  return (
    <div
      className={`run-timeline-item is-${item.status}`}
      data-testid={`run-timeline-item-${item.id}`}
      role="button"
      tabIndex={0}
      onClick={() => onFocusNode(item.nodeId)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onFocusNode(item.nodeId);
        }
      }}
    >
      <span className="run-timeline-state">{item.status}</span>
      <div className="run-timeline-item-main">
        <strong>{item.nodeId}</strong>
        <p>
          {formatIteration(item)}
          {retryLabel ? `, ${retryLabel}` : ""}
          {item.error?.message ? `, ${String(item.error.message)}` : ""}
        </p>
        {outputPaths.length > 0 ? (
          <div className="run-timeline-output">
            <Image size={12} aria-hidden="true" />
            {thumbnailPath(outputPaths) ? (
              <img
                src={thumbnailSrc(thumbnailPath(outputPaths)!)}
                alt="Timeline output thumbnail"
                data-testid={`run-timeline-thumbnail-${item.id}`}
                onError={(event) => {
                  event.currentTarget.style.display = "none";
                }}
              />
            ) : null}
            <div>
              {outputPaths.map((assetPath) => (
                <code key={assetPath}>{basename(assetPath)}</code>
              ))}
            </div>
          </div>
        ) : null}
      </div>
      {item.status === "failed" ? (
        <button
          type="button"
          data-testid={`run-timeline-retry-${item.id}`}
          onClick={(event) => {
            event.stopPropagation();
            void onRetryItem(item);
          }}
          aria-label={`Retry ${item.nodeId}`}
          title="Retry item"
        >
          <RotateCcw size={12} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

function groupDetails(details: RunJobDetail[]): TimelineGroup[] {
  return [
    {
      id: "queued",
      label: "Queued",
      details: details.filter((detail) => detail.job.status === "queued")
    },
    {
      id: "active",
      label: "Active",
      details: details.filter((detail) => detail.job.status === "running")
    },
    {
      id: "done",
      label: "Done",
      details: details.filter((detail) => detail.job.status === "completed")
    },
    {
      id: "attention",
      label: "Attention",
      details: details.filter((detail) => detail.job.status === "failed" || detail.job.status === "canceled")
    }
  ];
}

function canCancelJob(status: JobStatus) {
  return status === "queued" || status === "running";
}

function canExecuteJob(status: JobStatus) {
  return status === "queued" || status === "running";
}

function isCurrentRefresh(
  requestId: number,
  refreshSequenceRef: RefObject<number>,
  mountedRef: RefObject<boolean>
) {
  return mountedRef.current && requestId === refreshSequenceRef.current;
}

function formatJobLabel(job: EtherJob) {
  return job.rootNodeId ? `${job.kind} / ${job.rootNodeId}` : job.kind;
}

function formatIteration(item: EtherJobItem) {
  return typeof item.input.iteration === "number" ? `iteration ${item.input.iteration}` : item.status;
}

function outputAssetPaths(item: EtherJobItem) {
  const paths = [
    item.output.assetPath,
    readMetadataPath(item.output.metadata),
    item.output.path,
    readMetadataPath(item.metadata)
  ].filter(isString);

  return [...new Set(paths)];
}

function readMetadataPath(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>).path
    : undefined;
}

function basename(assetPath: string) {
  return assetPath.split(/[\\/]/).filter(Boolean).at(-1) ?? assetPath;
}

function thumbnailPath(paths: string[]) {
  return paths.find((assetPath) => /\.(png|jpe?g|webp|gif|bmp|svg|avif)$/i.test(assetPath)) ?? null;
}

function thumbnailSrc(assetPath: string) {
  if (/^(data:|https?:|file:)/i.test(assetPath)) {
    return assetPath;
  }

  const normalizedPath = assetPath.replace(/\\/g, "/");
  const filePath = normalizedPath.startsWith("/") ? normalizedPath : `/${normalizedPath}`;

  return encodeURI(`file://${filePath}`);
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isRunJobDetail(value: RunJobDetail | null | undefined): value is RunJobDetail {
  return Boolean(value?.job && Array.isArray(value.items) && Array.isArray(value.dependencies) && Array.isArray(value.events));
}
