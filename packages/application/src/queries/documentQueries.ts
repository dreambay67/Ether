export type DocumentSnapshot = {
  documentId: string;
  path: string;
  mode: "writable" | "read-only";
  dirty: boolean;
  documentRevisionId: string;
  graphRevisions: Record<string, string>;
};
