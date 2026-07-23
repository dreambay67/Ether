import { randomUUID } from "node:crypto";

import { GraphTransactionSchema } from "@ether/schema";

import type { EtherMcpApplicationAdapter, TransactionPreview } from "../applicationAdapter.js";
import { EtherMcpError } from "../schemas.js";

export type TransactionProposal = TransactionPreview & {
  proposalId: string;
  state: "previewed" | "applying" | "applied" | "rejected";
};

export class EditTransactionStore {
  private readonly proposals = new Map<string, TransactionProposal>();

  async preview(adapter: EtherMcpApplicationAdapter, input: unknown): Promise<TransactionProposal> {
    const transaction = GraphTransactionSchema.parse(input);
    if (transaction.actor !== "codex") {
      throw transactionError(
        "MCP_TRANSACTION_ACTOR_INVALID",
        "MCP graph transactions must identify Codex as their revision actor.",
        { requestedActor: transaction.actor }
      );
    }
    const preview = await adapter.previewGraphTransaction(transaction);
    const proposal: TransactionProposal = {
      ...preview,
      proposalId: `proposal-${randomUUID()}`,
      state: "previewed"
    };
    this.proposals.set(proposal.proposalId, proposal);
    return proposal;
  }

  requirePreviewed(proposalId: string): TransactionProposal {
    const proposal = this.proposals.get(proposalId);
    if (proposal === undefined) throw transactionError("TRANSACTION_PROPOSAL_NOT_FOUND", `Unknown transaction proposal ${proposalId}.`);
    if (proposal.state !== "previewed") throw transactionError("TRANSACTION_PROPOSAL_CLOSED", `Transaction proposal ${proposalId} is already ${proposal.state}.`);
    return proposal;
  }

  reserveApply(proposalId: string, documentId: string): TransactionProposal {
    const proposal = this.requirePreviewed(proposalId);
    if (proposal.documentId !== documentId) {
      throw transactionError("DOCUMENT_SCOPE_REJECTED", "The transaction proposal belongs to a different active document.", {
        proposalDocumentId: proposal.documentId,
        activeDocumentId: documentId
      });
    }
    proposal.state = "applying";
    return proposal;
  }

  applied(proposalId: string): void {
    const proposal = this.proposals.get(proposalId);
    if (proposal?.state !== "applying") throw transactionError("TRANSACTION_PROPOSAL_CLOSED", `Transaction proposal ${proposalId} is not applying.`);
    proposal.state = "applied";
  }

  applyFailed(proposalId: string): void {
    const proposal = this.proposals.get(proposalId);
    if (proposal?.state === "applying") proposal.state = "previewed";
  }

  reject(proposalId: string): TransactionProposal {
    const proposal = this.requirePreviewed(proposalId);
    proposal.state = "rejected";
    return proposal;
  }
}

export function assertApplyBase(proposal: TransactionProposal, namedBaseRevision: string, currentBaseRevision: string | null): void {
  const expected = proposal.transaction.baseDocumentRevisionId;
  if (namedBaseRevision !== expected || currentBaseRevision !== expected) {
    throw transactionError("BASE_REVISION_CONFLICT", "The transaction base is stale and must be rebased before apply.", {
      proposalId: proposal.proposalId,
      namedBaseRevision,
      expectedBaseRevision: expected,
      currentBaseRevision,
      rebaseable: true
    });
  }
}

function transactionError(code: string, message: string, details?: Record<string, unknown>): EtherMcpError {
  return new EtherMcpError(code, "graph", message, { details, userAction: "Inspect the current graph revisions, rebase the transaction, and preview it again." });
}
