import {
  DocumentHeaderSchema,
  LiveOutputSettingsSchema,
  type DocumentHeader,
  type LiveOutputSettings
} from "@ether/schema";

import type { RepositoryTransactionContext } from "./graphs.js";

interface HeaderRow {
  app_version: string;
  created_at: string;
  document_id: string;
  feature_flags_json: string;
  format_marker: string;
  format_version: string;
  schema_version: number;
  title: string;
  updated_at: string;
}

interface LiveOutputRow {
  collision_policy: LiveOutputSettings["collisionPolicy"];
  enabled: number;
  last_reconciled_at: string | null;
  naming_policy_json: string;
  path_grant_id: string | null;
  transfer_policy: LiveOutputSettings["transferPolicy"];
}

export class SettingsRepository {
  constructor(private readonly context: RepositoryTransactionContext) {}

  getHeader(): DocumentHeader {
    const row = this.context.database
      .prepare(
        `SELECT document_id, format_marker, format_version, schema_version, title,
                created_at, updated_at, app_version, feature_flags_json
         FROM document WHERE singleton = 1`
      )
      .get() as unknown as HeaderRow;
    return DocumentHeaderSchema.parse({
      documentId: row.document_id,
      formatMarker: row.format_marker,
      formatVersion: row.format_version,
      schemaVersion: row.schema_version,
      title: row.title,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      appVersion: row.app_version,
      featureFlags: JSON.parse(row.feature_flags_json)
    });
  }

  setFeatureFlag(name: string, enabled: boolean): void {
    const current = this.getHeader();
    const next = DocumentHeaderSchema.parse({
      ...current,
      updatedAt: this.context.now(),
      featureFlags: { ...current.featureFlags, [name]: enabled }
    });
    this.context.database
      .prepare("UPDATE document SET feature_flags_json = ?, updated_at = ? WHERE singleton = 1")
      .run(JSON.stringify(next.featureFlags), next.updatedAt);
  }

  setTitle(title: string): void {
    const current = this.getHeader();
    const next = DocumentHeaderSchema.parse({
      ...current,
      title,
      updatedAt: this.context.now()
    });
    this.context.database
      .prepare("UPDATE document SET title = ?, updated_at = ? WHERE singleton = 1")
      .run(next.title, next.updatedAt);
  }

  getLiveOutput(): LiveOutputSettings {
    const row = this.context.database
      .prepare(
        `SELECT enabled, path_grant_id, naming_policy_json, collision_policy,
                transfer_policy, last_reconciled_at
         FROM live_output_settings WHERE singleton = 1`
      )
      .get() as unknown as LiveOutputRow;
    return LiveOutputSettingsSchema.parse({
      enabled: row.enabled === 1,
      pathGrantId: row.path_grant_id,
      namingPolicy: JSON.parse(row.naming_policy_json),
      collisionPolicy: row.collision_policy,
      transferPolicy: row.transfer_policy,
      lastReconciledAt: row.last_reconciled_at
    });
  }

  setLiveOutput(input: LiveOutputSettings): void {
    const settings = LiveOutputSettingsSchema.parse(input);
    this.context.database
      .prepare(
        `UPDATE live_output_settings SET
           enabled = ?, path_grant_id = ?, naming_policy_json = ?, collision_policy = ?,
           transfer_policy = ?, last_reconciled_at = ?
         WHERE singleton = 1`
      )
      .run(
        settings.enabled ? 1 : 0,
        settings.pathGrantId,
        JSON.stringify(settings.namingPolicy),
        settings.collisionPolicy,
        settings.transferPolicy,
        settings.lastReconciledAt
      );
  }
}
