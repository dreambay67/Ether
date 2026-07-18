import type { ReadOnlyReason } from "@ether/document";

export type DocumentSnapshot = {
  documentId: string;
  path: string;
  mode: "writable" | "read-only";
  readOnlyReason: ReadOnlyReason | null;
  dirty: boolean;
  documentRevisionId: string;
  graphRevisions: Record<string, string>;
};
