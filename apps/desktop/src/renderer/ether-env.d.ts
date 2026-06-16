import type {
  AssetKind,
  AssetMoveRecord,
  AssetRecord,
  CreateProjectOptions,
  EtherGraph,
  HealthCheckResult,
  ProjectOpenResult
} from "@ether/engine";

export type ProjectSession = ProjectOpenResult & {
  projectId: string;
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
        moveToCollection(
          projectId: string,
          options: { assetId: string; collectionId?: string; collectionName?: string; reason?: string }
        ): Promise<AssetRecord>;
        listMoves(projectId: string, query?: { assetId?: string }): Promise<AssetMoveRecord[]>;
      };
    };
  }
}

export {};
