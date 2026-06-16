import type {
  CreateProjectOptions,
  EtherGraph,
  HealthCheckResult,
  ProjectOpenResult
} from "@ether/engine";

declare global {
  interface Window {
    ether: {
      shell: "desktop";
      project: {
        create(options: CreateProjectOptions): Promise<ProjectOpenResult>;
        open(projectPath: string): Promise<ProjectOpenResult>;
        saveGraph(projectPath: string, graph: EtherGraph): Promise<EtherGraph>;
        loadGraph(projectPath: string): Promise<EtherGraph>;
        health(projectPath: string): Promise<HealthCheckResult>;
      };
    };
  }
}

export {};
