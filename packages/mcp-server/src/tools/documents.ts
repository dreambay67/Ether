import { z } from "zod";

import { activeDocumentId, applicationQuery } from "../applicationAdapter.js";
import { EmptyInputSchema } from "../schemas.js";
import type { EtherToolDefinition, ToolContext } from "../toolTypes.js";
import { readOnlyAnnotations } from "../toolTypes.js";

export const documentTools: EtherToolDefinition[] = [
  {
    name: "ether.document.inspect",
    description: "Inspect the active Ether 4.0 document summary and durable revision state.",
    inputSchema: EmptyInputSchema,
    annotations: readOnlyAnnotations,
    async run({ application }) {
      const [documentId, summary, dirtyState] = await Promise.all([
        activeDocumentId(application),
        applicationQuery(application, "document.summary", {}),
        applicationQuery(application, "document.dirtyState", {})
      ]);
      return { documentId, summary, dirtyState };
    }
  },
  {
    name: "ether.document.health",
    description: "Inspect document, storage, recovery, graph validation, and provider health without changing state.",
    inputSchema: EmptyInputSchema,
    annotations: readOnlyAnnotations,
    async run(context) {
      return documentHealth(context);
    }
  },
  {
    name: "ether.project.doctor",
    description: "Run the read-only Ether project doctor over the active document and report actionable diagnostics.",
    inputSchema: EmptyInputSchema,
    annotations: readOnlyAnnotations,
    async run(context) {
      const health = await documentHealth(context);
      return { ...health, doctor: { state: "inspected", mutationPerformed: false } };
    }
  },
  {
    name: "ether.recovery.inspect",
    description: "Inspect recovery attention for the active document without dismissing or modifying it.",
    inputSchema: EmptyInputSchema,
    annotations: readOnlyAnnotations,
    async run({ application }) {
      return { recovery: await applicationQuery(application, "recovery.status", {}) };
    }
  },
  {
    name: "ether.permission.inspect",
    description: "Inspect MCP permits accepted by the Ether host; this tool cannot grant or escalate permissions.",
    inputSchema: z.object({}).strict(),
    annotations: readOnlyAnnotations,
    async run({ application }) {
      return { permits: await application.inspectPermits() };
    }
  }
];

async function documentHealth({ application }: ToolContext): Promise<Record<string, unknown>> {
  const [documentId, summary, dirtyState, graphCatalog, recovery, storage, providers] = await Promise.all([
    activeDocumentId(application),
    applicationQuery(application, "document.summary", {}),
    applicationQuery(application, "document.dirtyState", {}),
    applicationQuery(application, "graph.catalog", {}),
    applicationQuery(application, "recovery.status", {}),
    applicationQuery(application, "storage.status", {}),
    applicationQuery(application, "provider.health", {}, true)
  ]);
  const graphs = Array.isArray(graphCatalog.graphs) ? graphCatalog.graphs : [];
  const firstGraph = graphs[0] as { id?: unknown } | undefined;
  const validation = typeof firstGraph?.id === "string"
    ? await applicationQuery(application, "graph.validation", { graphId: firstGraph.id })
    : { valid: true, issues: [] };
  return { documentId, summary, dirtyState, validation, recovery, storage, providers };
}
