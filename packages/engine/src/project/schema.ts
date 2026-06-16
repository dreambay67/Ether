import { z } from "zod";

export const SNAPSHOT_SLOTS = ["A", "B", "C", "D"] as const;

export type SnapshotSlot = (typeof SNAPSHOT_SLOTS)[number];

export const ProjectMetadataSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1),
  appVersion: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  brandLockup: z.string().min(1),
  autosave: z.object({
    enabled: z.boolean(),
    intervalMs: z.number().int().positive()
  }),
  providerPreferences: z.record(z.unknown()),
  activeSnapshotId: z.string().nullable()
});

export const EtherGraphSchema = z.object({
  nodes: z.array(z.record(z.unknown())),
  edges: z.array(z.record(z.unknown())),
  viewport: z
    .object({
      x: z.number(),
      y: z.number(),
      zoom: z.number().positive()
    })
    .catch({ x: 0, y: 0, zoom: 1 }),
  selectedSnapshotId: z.string().nullable(),
  updatedAt: z.string()
});

export const LinkedReferenceSchema = z.object({
  id: z.string().min(1),
  path: z.string().min(1),
  linkedAt: z.string().optional()
});

export const LinkedIndexSchema = z.object({
  references: z.array(LinkedReferenceSchema)
});

export const HealthIssueSchema = z.object({
  id: z.string().min(1),
  code: z.string().min(1),
  severity: z.enum(["warning", "error"]),
  message: z.string().min(1),
  path: z.string().nullable(),
  detectedAt: z.string().datetime()
});

export type ProjectMetadata = z.infer<typeof ProjectMetadataSchema>;
export type EtherGraph = z.infer<typeof EtherGraphSchema>;
export type LinkedReferenceIndex = z.infer<typeof LinkedIndexSchema>;
export type HealthIssue = z.infer<typeof HealthIssueSchema>;

export type CreateProjectOptions = {
  parentDirectory: string;
  name: string;
};

export type ProjectDatabaseStatus = {
  path: string;
  tables: string[];
  healthIssueCount: number;
};

export type ProjectOpenResult = {
  path: string;
  metadata: ProjectMetadata;
  graph: EtherGraph;
  database: ProjectDatabaseStatus;
};

export type SnapshotRecord = {
  id: string;
  slot: SnapshotSlot;
  label: string | null;
  path: string;
  createdAt: string;
};

export type RestoreSnapshotResult = {
  metadata: ProjectMetadata;
  graph: EtherGraph;
  snapshot: SnapshotRecord;
};

export type HealthCheckResult = {
  issues: HealthIssue[];
};
