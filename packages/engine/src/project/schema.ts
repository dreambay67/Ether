import { z } from "zod";

export const SNAPSHOT_SLOTS = ["A", "B", "C", "D"] as const;
export const LATEST_GRAPH_VERSION = "2.5" as const;

export type SnapshotSlot = (typeof SNAPSHOT_SLOTS)[number];

export const ProjectMetadataSchema = z.object({
  id: z.string().uuid(),
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

const EtherGraphBaseSchema = z.object({
  graphVersion: z.string().optional(),
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
  updatedAt: z.string().datetime()
});

export const EtherGraphSchema = EtherGraphBaseSchema.transform((graph, context) => {
  if (graph.graphVersion === undefined || graph.graphVersion === LATEST_GRAPH_VERSION) {
    return {
      ...graph,
      graphVersion: LATEST_GRAPH_VERSION
    };
  }

  context.addIssue({
    code: z.ZodIssueCode.custom,
    message: `Unsupported graph version "${graph.graphVersion}". This Ether build supports graph version ${LATEST_GRAPH_VERSION}; legacy files without graphVersion are still accepted.`
  });

  return z.NEVER;
});

export function normalizeEtherGraph(value: unknown): EtherGraph {
  const graphVersion =
    typeof value === "object" && value !== null && "graphVersion" in value
      ? value.graphVersion
      : undefined;

  if (graphVersion !== undefined && graphVersion !== LATEST_GRAPH_VERSION) {
    throw new Error(unsupportedGraphVersionMessage(graphVersion));
  }

  return EtherGraphSchema.parse(value);
}

function unsupportedGraphVersionMessage(graphVersion: unknown) {
  return `Unsupported graph version "${String(graphVersion)}". This Ether build supports graph version ${LATEST_GRAPH_VERSION}; legacy files without graphVersion are still accepted.`;
}

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
export type NormalizedEtherGraph = EtherGraph;
export type EtherGraphInput = z.input<typeof EtherGraphSchema>;
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
