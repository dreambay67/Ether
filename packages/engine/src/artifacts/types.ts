export type ArtifactKind =
  | "prompt"
  | "negative_prompt"
  | "reference"
  | "image"
  | "edit"
  | "mask"
  | "compare"
  | "evaluation"
  | "route"
  | "collection_membership"
  | "report";

export type ArtifactRecord = {
  id: string;
  kind: ArtifactKind;
  type: ArtifactKind;
  nodeId: string | null;
  runId: string | null;
  jobId: string | null;
  path: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type LineageEdgeRecord = {
  id: string;
  parentArtifactId: string;
  childArtifactId: string;
  edgeType: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type CreateArtifactInput = {
  kind: ArtifactKind;
  nodeId?: string;
  runId?: string;
  jobId?: string;
  path?: string;
  metadata?: Record<string, unknown>;
  parentArtifactIds?: string[];
  now?: Date;
};

export type ListArtifactsQuery = {
  kind?: ArtifactKind;
  type?: ArtifactKind;
  collectionId?: string;
  search?: string;
};

export type UpdateArtifactMetadataInput = {
  artifactId: string;
  metadata: Record<string, unknown>;
  now?: Date;
};

export type TagArtifactInput = {
  artifactId: string;
  tag: string;
  color?: string;
  metadata?: Record<string, unknown>;
  now?: Date;
};

export type RateArtifactInput = {
  artifactId: string;
  rating: number;
  note?: string;
  source?: string;
  now?: Date;
};

export type CreateLineageEdgeInput = {
  parentArtifactId: string;
  childArtifactId: string;
  edgeType?: string;
  metadata?: Record<string, unknown>;
  now?: Date;
};

export type AddArtifactToCollectionInput = {
  artifactId: string;
  collectionId: string;
  position?: number;
  metadata?: Record<string, unknown>;
  now?: Date;
};
