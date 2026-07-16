import type { EtherGraph, EtherGraphInput } from "../project/schema.js";

export type GraphRevision = {
  id: string;
  parentRevisionId: string | null;
  reason: string;
  actor: string;
  contentHash: string;
  graph: EtherGraph;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type CreateGraphRevisionInput = {
  graph: EtherGraphInput;
  reason?: string;
  actor?: string;
  metadata?: Record<string, unknown>;
};

export type SaveGraphRevisionInput = CreateGraphRevisionInput & {
  baseRevisionId?: string | null;
};

export class GraphRevisionConflict extends Error {
  readonly expectedRevisionId: string | null;
  readonly actualRevisionId: string | null;

  constructor(expectedRevisionId: string | null, actualRevisionId: string | null) {
    super(
      `Stale graph revision: expected base revision ${expectedRevisionId ?? "none"}, latest is ${actualRevisionId ?? "none"}.`
    );
    this.name = "GraphRevisionConflict";
    this.expectedRevisionId = expectedRevisionId;
    this.actualRevisionId = actualRevisionId;
  }
}
