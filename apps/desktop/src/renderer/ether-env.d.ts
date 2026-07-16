import type {
  ArtifactKind,
  ArtifactRecord,
  AssetKind,
  AssetMoveRecord,
  AssetRecord,
  CreateProjectOptions,
  EtherGraph,
  ExecutionRequest,
  ExecutionRunResult,
  ExecutedQueuedRun,
  EnqueuedRun,
  HealthCheckResult,
  EtherJob,
  EtherJobDependency,
  EtherJobEvent,
  EtherJobItem,
  JobStatus,
  ProviderLogCleanupResult,
  ProjectOpenResult,
  RunArtifactCleanupResult,
  RunPreview
} from "@ether/engine";

export type ProjectSession = ProjectOpenResult & {
  projectId: string;
};

export type ProviderDiagnostics = {
  policy?: {
    openAiPlatformApi: {
      status: "blocked";
      envKeyDetected: boolean;
      blockedEnvKeys: string[];
      message: string;
    };
  };
  providers: Array<{
    id: string;
    name: string;
    availability: "available" | "unavailable";
  }>;
  matrix?: ProviderMatrixEntry[];
  optionalApiProviders?: Record<string, unknown>;
};

export type ProviderMatrixEntry = {
  id: string;
  displayName: string;
  name: string;
  route: string;
  availability: "available" | "unavailable";
  status: "ready" | "unavailable" | "experimental";
  mode: "real" | "simulation" | "experimental";
  capabilities: string[];
  messages: string[];
  unavailableReason?: string;
  model?: string;
  notes?: string[];
  readiness?: "configured" | "missing_credentials" | "missing_adapter" | "disabled";
  noHiddenFallback?: true;
  noApiPolicy: "openai-platform-api-blocked";
};

export type DesktopSettings = {
  parentDirectory: string;
  projectName: string;
  projectPath: string;
  recentProjects: string[];
};

export type RunJobDetail = {
  job: EtherJob;
  items: EtherJobItem[];
  dependencies: EtherJobDependency[];
  events: EtherJobEvent[];
};

declare global {
  interface Window {
    ether: {
      shell: "desktop";
      file: {
        getDroppedFilePath(file: File): string | null;
      };
      project: {
        defaultParentDirectory?(): Promise<string>;
        selectParentDirectory?(): Promise<string | null>;
        selectProjectBundle?(): Promise<string | null>;
        create(options: CreateProjectOptions): Promise<ProjectSession>;
        open(projectPath: string): Promise<ProjectSession>;
        saveGraph(projectId: string, graph: EtherGraph): Promise<EtherGraph>;
        loadGraph(projectId: string): Promise<EtherGraph>;
        health(projectId: string): Promise<HealthCheckResult>;
        clearProviderLogs(projectId: string): Promise<ProviderLogCleanupResult>;
        clearRunArtifacts(projectId: string): Promise<RunArtifactCleanupResult>;
      };
      asset: {
        selectReferenceImage(projectId: string, options?: { role?: string }): Promise<AssetRecord | null>;
        selectStoreDirectory?(): Promise<string | null>;
        linkDroppedReference(
          projectId: string,
          filePath: string,
          options?: { role?: string }
        ): Promise<AssetRecord>;
        ensureCollection(
          projectId: string,
          options: { name: string; nodeId?: string; path?: string }
        ): Promise<AssetRecord>;
        ensureDirectory(
          projectId: string,
          options: { name: string; nodeId?: string; path?: string }
        ): Promise<AssetRecord>;
        list(projectId: string, query?: { kind?: AssetKind }): Promise<AssetRecord[]>;
        saveFakeGenerated(
          projectId: string,
          options: { generationNodeId: string; fileName: string; content?: string; mimeType?: string }
        ): Promise<AssetRecord>;
        saveMask(
          projectId: string,
          options: {
            editNodeId: string;
            sourceAssetId?: string;
            sourceAssetPath?: string;
            fileName?: string;
            content?: string;
            mimeType?: string;
            instruction?: string;
            notes?: string;
            metadata?: Record<string, unknown>;
          }
        ): Promise<AssetRecord>;
        moveToCollection(
          projectId: string,
          options: { assetId: string; collectionId?: string; collectionName?: string; reason?: string }
        ): Promise<AssetRecord>;
        listMoves(projectId: string, query?: { assetId?: string }): Promise<AssetMoveRecord[]>;
      };
      artifacts?: {
        list(
          projectId: string,
          query?: { kind?: ArtifactKind; type?: ArtifactKind; collectionId?: string; search?: string }
        ): Promise<ArtifactRecord[]>;
        get(projectId: string, artifactId: string): Promise<ArtifactRecord | null>;
        updateMetadata(
          projectId: string,
          options: { artifactId: string; metadata: Record<string, unknown> }
        ): Promise<ArtifactRecord>;
        tag(
          projectId: string,
          options: { artifactId: string; tag: string; color?: string; metadata?: Record<string, unknown> }
        ): Promise<ArtifactRecord>;
        rate(
          projectId: string,
          options: { artifactId: string; rating: number; note?: string; source?: string }
        ): Promise<ArtifactRecord>;
        listLineageParents(projectId: string, artifactId: string): Promise<ArtifactRecord[]>;
        listLineageChildren(projectId: string, artifactId: string): Promise<ArtifactRecord[]>;
        addToCollection(
          projectId: string,
          options: { artifactId: string; collectionId: string; position?: number; metadata?: Record<string, unknown> }
        ): Promise<void>;
        listByCollection(projectId: string, collectionId: string): Promise<ArtifactRecord[]>;
        revealFile(projectId: string, artifactId: string): Promise<void>;
      };
      execution: {
        preview(
          projectId: string,
          graph: EtherGraph,
          request: Omit<ExecutionRequest, "now">
        ): Promise<RunPreview>;
        run(
          projectId: string,
          graph: EtherGraph,
          request: Omit<ExecutionRequest, "now">
        ): Promise<ExecutionRunResult>;
        jobs?: {
          list(projectId: string, query?: { statuses?: JobStatus[] }): Promise<EtherJob[]>;
          get(projectId: string, jobId: string): Promise<RunJobDetail | null>;
          enqueue(
            projectId: string,
            graph: EtherGraph,
            request: Omit<ExecutionRequest, "now">
          ): Promise<EnqueuedRun>;
          execute(projectId: string, jobId: string): Promise<ExecutedQueuedRun>;
          cancel(projectId: string, jobId: string): Promise<EtherJob>;
          retryItem(projectId: string, jobItemId: string): Promise<EtherJobItem>;
        };
      };
      provider?: {
        diagnostics(): Promise<ProviderDiagnostics>;
        health(): Promise<ProviderDiagnostics>;
      };
      settings?: {
        load(): Promise<DesktopSettings>;
        save(settings: DesktopSettings): Promise<DesktopSettings>;
      };
      menu?: {
        onSave(handler: () => void): () => void;
      };
    };
  }
}

export {};
