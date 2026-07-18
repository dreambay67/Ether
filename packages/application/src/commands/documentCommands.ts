import { DocumentStore, type DocumentStoreEnvironment } from "@ether/document";
import type { EtherGraph } from "@ether/schema";

export function createDocument(input: {
  path: string;
  title: string;
  initialGraph: EtherGraph;
  appVersion: string;
  environment?: DocumentStoreEnvironment;
}): Promise<DocumentStore> {
  return DocumentStore.create(input.path, {
    appVersion: input.appVersion,
    title: input.title,
    initialGraph: input.initialGraph,
    environment: input.environment
  });
}
