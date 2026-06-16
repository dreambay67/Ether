import type {
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
      project: {
        create(options: CreateProjectOptions): Promise<ProjectSession>;
        open(projectPath: string): Promise<ProjectSession>;
        saveGraph(projectId: string, graph: EtherGraph): Promise<EtherGraph>;
        loadGraph(projectId: string): Promise<EtherGraph>;
        health(projectId: string): Promise<HealthCheckResult>;
      };
    };
  }
}

export {};
