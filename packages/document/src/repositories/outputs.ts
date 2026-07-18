import {
  NodeOutputVersionSchema,
  PayloadEnvelopeSchema,
  type NodeOutputVersion,
  type PayloadEnvelope
} from "@ether/schema";

import type { RepositoryTransactionContext } from "./graphs.js";
import { DocumentRepositoryError } from "./revisions.js";

interface VersionRow {
  approval_json: string;
  attempt_id: string | null;
  compiled_context_hash: string;
  created_at: string;
  failure_json: string | null;
  graph_id: string;
  graph_revision_id: string;
  input_payload_ids_json: string;
  node_id: string;
  output_payload_ids_json: string;
  output_version_id: string;
  parent_output_version_id: string | null;
  producer_json: string;
  run_id: string | null;
  selected_output_version_ids_json: string;
  step_id: string | null;
  timing_json: string;
  work_item_id: string | null;
}

interface PayloadRow {
  channel: PayloadEnvelope["channel"];
  content_json: string;
  metadata_json: string;
  payload_id: string;
  role: PayloadEnvelope["role"];
  source_json: string;
}

export class OutputRepository {
  constructor(private readonly context: RepositoryTransactionContext) {}

  insert(versionInput: NodeOutputVersion, payloadInputs: PayloadEnvelope[]): void {
    const version = NodeOutputVersionSchema.parse(versionInput);
    const payloads = payloadInputs.map((payload) => PayloadEnvelopeSchema.parse(payload));
    const existing = this.context.database
      .prepare("SELECT 1 AS found FROM node_output_versions WHERE output_version_id = ?")
      .get(version.id);
    if (existing !== undefined) {
      throw new DocumentRepositoryError("IMMUTABLE_OUTPUT", `Output version ${version.id} already exists.`);
    }
    const payloadIds = payloads.map((payload) => payload.id);
    if (JSON.stringify(payloadIds) !== JSON.stringify(version.outputPayloadIds)) {
      throw new DocumentRepositoryError(
        "INVALID_OUTPUT_PAYLOADS",
        "Output payload IDs must exactly match the inserted immutable payload order."
      );
    }
    for (const payload of payloads) {
      if (
        payload.source.nodeId !== version.nodeId ||
        payload.source.outputVersionId !== version.id
      ) {
        throw new DocumentRepositoryError(
          "INVALID_OUTPUT_PAYLOADS",
          "Payload source must identify its owning output version and node."
        );
      }
    }
    if (version.parentOutputVersionId !== null) {
      const parent = this.context.database
        .prepare(
          `SELECT graph_id, node_id FROM node_output_versions
           WHERE output_version_id = ?`
        )
        .get(version.parentOutputVersionId) as { graph_id: string; node_id: string } | undefined;
      if (parent === undefined || parent.graph_id !== version.graphId || parent.node_id !== version.nodeId) {
        throw new DocumentRepositoryError(
          "INVALID_OUTPUT_ANCESTRY",
          "Manual output ancestry must remain within the same graph node."
        );
      }
    }
    for (const payloadId of new Set(version.inputPayloadIds)) {
      const payload = this.context.database
        .prepare("SELECT 1 AS found FROM node_output_payloads WHERE payload_id = ?")
        .get(payloadId);
      if (payload === undefined) {
        throw new DocumentRepositoryError(
          "INVALID_OUTPUT_PROVENANCE",
          `Input payload ${payloadId} does not exist.`
        );
      }
    }
    for (const outputVersionId of new Set(version.selectedOutputVersionIds)) {
      const selected = this.context.database
        .prepare("SELECT 1 AS found FROM node_output_versions WHERE output_version_id = ?")
        .get(outputVersionId);
      if (selected === undefined) {
        throw new DocumentRepositoryError(
          "INVALID_OUTPUT_PROVENANCE",
          `Selected output version ${outputVersionId} does not exist.`
        );
      }
    }
    const node = this.context.database
      .prepare("SELECT graph_id FROM nodes WHERE node_id = ? AND deleted_at IS NULL")
      .get(version.nodeId) as { graph_id: string } | undefined;
    if (node?.graph_id !== version.graphId) {
      throw new DocumentRepositoryError(
        "INVALID_OUTPUT_ANCESTRY",
        "Output version node is not current in the identified graph."
      );
    }

    this.context.database
      .prepare(
        `INSERT INTO node_output_versions (
           output_version_id, node_id, graph_id, graph_revision_id, parent_output_version_id,
           producer_json, input_payload_ids_json, selected_output_version_ids_json,
           output_payload_ids_json, compiled_context_hash, approval_json,
           run_id, step_id, work_item_id, attempt_id, timing_json, failure_json, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        version.id,
        version.nodeId,
        version.graphId,
        version.graphRevisionId,
        version.parentOutputVersionId,
        JSON.stringify(version.producer),
        JSON.stringify(version.inputPayloadIds),
        JSON.stringify(version.selectedOutputVersionIds),
        JSON.stringify(version.outputPayloadIds),
        version.compiledContextHash,
        JSON.stringify(version.approval),
        version.runId,
        version.stepId,
        version.workItemId,
        version.attemptId,
        JSON.stringify(version.timing),
        version.failure === null ? null : JSON.stringify(version.failure),
        version.createdAt
      );
    const payloadStatement = this.context.database.prepare(
      `INSERT INTO node_output_payloads (
         payload_id, output_version_id, channel, role, content_text, content_json,
         source_json, artifact_id, metadata_json, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const payload of payloads) {
      payloadStatement.run(
        payload.id,
        version.id,
        payload.channel,
        payload.role,
        payload.content.kind === "text" ? payload.content.value : null,
        JSON.stringify(payload.content),
        JSON.stringify(payload.source),
        payload.content.kind === "artifact" ? payload.content.artifactId : null,
        JSON.stringify(payload.metadata),
        version.createdAt
      );
    }
    const approval = version.approval;
    this.context.database
      .prepare(
        `INSERT INTO approvals (
           approval_id, output_version_id, state, actor, reason, created_at
         ) VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        this.context.createId("approval"),
        version.id,
        approval.state,
        approval.state === "unreviewed" ? "system" : approval.actor,
        approval.state === "rejected" ? (approval.reason ?? null) : null,
        approval.state === "unreviewed" ? version.createdAt : approval.at
      );
  }

  getVersion(id: string): NodeOutputVersion | undefined {
    const row = this.context.database
      .prepare(
        `SELECT output_version_id, node_id, graph_id, graph_revision_id,
                parent_output_version_id, producer_json, input_payload_ids_json,
                selected_output_version_ids_json, output_payload_ids_json,
                compiled_context_hash, approval_json, run_id, step_id, work_item_id,
                attempt_id, timing_json, failure_json, created_at
         FROM node_output_versions WHERE output_version_id = ?`
      )
      .get(id) as VersionRow | undefined;
    if (row === undefined) {
      return undefined;
    }
    return NodeOutputVersionSchema.parse({
      id: row.output_version_id,
      nodeId: row.node_id,
      graphId: row.graph_id,
      graphRevisionId: row.graph_revision_id,
      inputPayloadIds: JSON.parse(row.input_payload_ids_json),
      selectedOutputVersionIds: JSON.parse(row.selected_output_version_ids_json),
      compiledContextHash: row.compiled_context_hash,
      producer: JSON.parse(row.producer_json),
      outputPayloadIds: JSON.parse(row.output_payload_ids_json),
      parentOutputVersionId: row.parent_output_version_id,
      approval: JSON.parse(row.approval_json),
      runId: row.run_id,
      stepId: row.step_id,
      workItemId: row.work_item_id,
      attemptId: row.attempt_id,
      timing: JSON.parse(row.timing_json),
      failure: row.failure_json === null ? null : JSON.parse(row.failure_json),
      createdAt: row.created_at
    });
  }

  listByNode(nodeId: string): NodeOutputVersion[] {
    const rows = this.context.database
      .prepare(
        `SELECT v.output_version_id
         FROM node_output_versions v
         LEFT JOIN attempts a ON a.attempt_id = v.attempt_id
         LEFT JOIN json_each(coalesce(a.output_version_ids_json, '[]')) position
           ON position.value = v.output_version_id
         WHERE v.node_id = ?
         ORDER BY v.created_at, cast(coalesce(position.key, 0) AS INTEGER), v.output_version_id`
      )
      .all(nodeId) as unknown as Array<{ output_version_id: string }>;
    return rows
      .map((row) => this.getVersion(row.output_version_id))
      .filter((value): value is NodeOutputVersion => value !== undefined);
  }

  getPayload(id: string): PayloadEnvelope | undefined {
    const row = this.context.database
      .prepare(
        `SELECT payload_id, channel, role, content_json, source_json, metadata_json
         FROM node_output_payloads WHERE payload_id = ?`
      )
      .get(id) as PayloadRow | undefined;
    if (row === undefined) {
      return undefined;
    }
    return PayloadEnvelopeSchema.parse({
      id: row.payload_id,
      channel: row.channel,
      role: row.role,
      content: JSON.parse(row.content_json),
      source: JSON.parse(row.source_json),
      metadata: JSON.parse(row.metadata_json)
    });
  }
}
