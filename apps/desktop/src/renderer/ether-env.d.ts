import type {
  AssetKind,
  AssetMoveRecord,
  AssetRecord,
  CreateProjectOptions,
  EtherGraph,
  ExecutionRequest,
  ExecutionRunResult,
  HealthCheckResult,
  ProjectOpenResult
} from "@ether/engine";

export type ProjectSession = ProjectOpenResult & {
  projectId: string;
};

export type ProviderDiagnostics = {
  providers: Array<{
    id: string;
    name: string;
    availability: "available" | "unavailable";
  }>;
};

declare global {
  interface Window {
    ether: {
      shell: "desktop";
      file: {
        getDroppedFilePath(file: File): string | null;
      };
      project: {
        create(options: CreateProjectOptions): Promise<ProjectSession>;
        open(projectPath: string): Promise<ProjectSession>;
        saveGraph(projectId: string, graph: EtherGraph): Promise<EtherGraph>;
        loadGraph(projectId: string): Promise<EtherGraph>;
        health(projectId: string): Promise<HealthCheckResult>;
      };
      asset: {
        selectReferenceImage(projectId: string, options?: { role?: string }): Promise<AssetRecord | null>;
        linkDroppedReference(
          projectId: string,
          filePath: string,
          options?: { role?: string }
        ): Promise<AssetRecord>;
        ensureCollection(
          projectId: string,
          options: { name: string; nodeId?: string }
        ): Promise<AssetRecord>;
        ensureDirectory(
          projectId: string,
          options: { name: string; nodeId?: string }
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
      execution: {
        run(
          projectId: string,
          graph: EtherGraph,
          request: Omit<ExecutionRequest, "now">
        ): Promise<ExecutionRunResult>;
      };
      provider?: {
        diagnostics(): Promise<ProviderDiagnostics>;
      };
    };
  }
}

export {};
