import { z } from "zod";
import { GraphTransactionSchema } from "@ether/schema";

import { activeDocumentId, applicationQuery } from "../applicationAdapter.js";
import { EmptyInputSchema, EtherMcpError, NonEmptyIdSchema } from "../schemas.js";
import type { EtherToolDefinition } from "../toolTypes.js";
import { editAnnotations, readOnlyAnnotations } from "../toolTypes.js";
import { assertApplyBase } from "../transactions/editTransaction.js";

export const graphTools: EtherToolDefinition[] = [
  {
    name: "ether.node.catalog",
    description: "Inspect the canonical Ether 4.0 node catalog, ports, roles, adapters, and inspector metadata.",
    inputSchema: EmptyInputSchema,
    annotations: readOnlyAnnotations,
    async run({ application }) {
      return { nodes: await application.inspectNodeCatalog() };
    }
  },
  {
    name: "ether.graph.catalog",
    description: "List graphs and modules in the active document.",
    inputSchema: EmptyInputSchema,
    annotations: readOnlyAnnotations,
    async run({ application }) {
      return applicationQuery(application, "graph.catalog", {});
    }
  },
  {
    name: "ether.graph.inspect",
    description: "Inspect one immutable graph snapshot and its exact document and graph revisions.",
    inputSchema: z.object({ graphId: NonEmptyIdSchema }).strict(),
    annotations: readOnlyAnnotations,
    async run({ application }, input) {
      return applicationQuery(application, "graph.snapshot", { graphId: input.graphId });
    }
  },
  {
    name: "ether.graph.validate",
    description: "Validate the complete active document graph state through the application service.",
    inputSchema: z.object({ graphId: NonEmptyIdSchema }).strict(),
    annotations: readOnlyAnnotations,
    async run({ application }, input) {
      return applicationQuery(application, "graph.validation", { graphId: input.graphId });
    }
  },
  {
    name: "ether.graph.transaction.preview",
    description: "Preview and validate one atomic graph transaction, including connect-as-created temporary references, without applying it.",
    inputSchema: z.object({ transaction: GraphTransactionSchema }).strict(),
    annotations: readOnlyAnnotations,
    async run({ application, transactions }, input) {
      const proposal = await transactions.preview(application, input.transaction);
      return { proposal };
    }
  },
  {
    name: "ether.graph.transaction.apply",
    description: "Apply one previously previewed graph transaction under an active Edit Permit. This never starts providers.",
    inputSchema: z.object({
      proposalId: NonEmptyIdSchema,
      baseDocumentRevisionId: NonEmptyIdSchema,
      editPermitId: NonEmptyIdSchema
    }).strict(),
    annotations: editAnnotations,
    async run({ application, transactions }, input) {
      const proposalId = String(input.proposalId);
      const documentId = await activeDocumentId(application);
      const proposal = transactions.reserveApply(proposalId, documentId);
      try {
        const dirty = await applicationQuery(application, "document.dirtyState", {});
        const currentRevision = typeof dirty.documentRevisionId === "string" ? dirty.documentRevisionId : null;
        assertApplyBase(proposal, String(input.baseDocumentRevisionId), currentRevision);
        const result = await application.applyGraphTransaction({
          commandId: `mcp-apply-${proposal.proposalId}`,
          documentId,
          editPermitId: String(input.editPermitId),
          transaction: proposal.transaction
        });
        transactions.applied(proposalId);
        return { proposalId, state: "applied", tempIds: proposal.tempIds, result };
      } catch (error) {
        transactions.applyFailed(proposalId);
        throw error;
      }
    }
  },
  {
    name: "ether.graph.transaction.reject",
    description: "Reject a previewed graph transaction without changing the document.",
    inputSchema: z.object({ proposalId: NonEmptyIdSchema }).strict(),
    annotations: readOnlyAnnotations,
    async run({ transactions }, input) {
      const proposal = transactions.reject(String(input.proposalId));
      return { proposalId: proposal.proposalId, state: proposal.state, mutationPerformed: false };
    }
  }
];

export function assertContentHash(actual: unknown, expected: string, planId: string): void {
  if (typeof actual !== "string" || actual !== expected) {
    throw new EtherMcpError("PLAN_CONTENT_HASH_CONFLICT", "execution", "The requested content hash does not match the immutable persisted plan.", {
      details: { planId, expectedContentHash: actual ?? null, requestedContentHash: expected }
    });
  }
}
