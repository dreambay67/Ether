export type JobStatus = "queued" | "running" | "completed" | "failed" | "canceled";

export type JobItemStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "canceled"
  | "skipped";

export type JsonRecord = Record<string, unknown>;

export type EtherJob = {
  id: string;
  status: JobStatus;
  kind: string;
  graphRevisionId: string | null;
  rootNodeId: string | null;
  metadata: JsonRecord;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

export type EtherJobItem = {
  id: string;
  jobId: string;
  nodeId: string;
  status: JobItemStatus;
  input: JsonRecord;
  output: JsonRecord;
  error: JsonRecord | null;
  metadata: JsonRecord;
  retryCount: number;
  retryMetadata: JsonRecord;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

export type EtherJobDependency = {
  id: string;
  jobId: string;
  parentJobItemId: string;
  childJobItemId: string;
  createdAt: string;
};

export type EtherJobEvent = {
  id: string;
  jobId: string;
  jobItemId: string | null;
  eventType: string;
  payload: JsonRecord;
  createdAt: string;
};

export type EnqueueJobInput = {
  kind: string;
  graphRevisionId?: string | null;
  rootNodeId?: string | null;
  metadata?: JsonRecord;
  now?: Date;
};

export type ListJobsQuery = {
  statuses?: JobStatus[];
};

export type AddJobItemsInput = {
  jobId: string;
  items: Array<{
    nodeId: string;
    input?: JsonRecord;
    metadata?: JsonRecord;
  }>;
  now?: Date;
};

export type AddJobDependenciesInput = {
  jobId: string;
  dependencies: Array<{
    parentJobItemId: string;
    childJobItemId: string;
  }>;
  now?: Date;
};

export type TransitionJobStatusInput = {
  jobId: string;
  from: JobStatus;
  to: JobStatus;
  now?: Date;
};

export type TransitionJobItemStatusInput = {
  jobItemId: string;
  from: JobItemStatus;
  to: JobItemStatus;
  output?: JsonRecord;
  error?: JsonRecord | null;
  now?: Date;
};

export type RecordJobItemFailureInput = {
  jobItemId: string;
  error: JsonRecord;
  metadata?: JsonRecord;
  now?: Date;
};

export type RetryJobItemInput = {
  jobItemId: string;
  error?: JsonRecord | null;
  metadata?: JsonRecord;
  now?: Date;
};

export type CancelJobItemInput = {
  jobItemId: string;
  now?: Date;
};

export type AppendJobEventInput = {
  jobId: string;
  jobItemId?: string | null;
  eventType: string;
  payload?: JsonRecord;
  now?: Date;
};
