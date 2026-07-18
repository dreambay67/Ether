import type { createEtherBridge } from "../preload/filePathBridge";

type LegacyRendererTestCompatibility = {
  project: Record<string, unknown>;
  asset: {
    selectStoreDirectory(): Promise<string | null>;
    ensureCollection(projectId: string, options: Record<string, unknown>): Promise<unknown>;
  };
};

declare global {
  interface Window {
    ether: ReturnType<typeof createEtherBridge> & LegacyRendererTestCompatibility;
  }
}

export {};
