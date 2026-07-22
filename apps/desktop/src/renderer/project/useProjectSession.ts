import type { DocumentDescriptor } from "../../shared/ipc/contracts";
import { useDocumentSession } from "./useDocumentSession";

export function useProjectSession() {
  const session = useDocumentSession();
  const snapshot = session.state.snapshot;
  const document = isDocumentDescriptor(snapshot) ? snapshot : null;
  return { ...session, document };
}

function isDocumentDescriptor(value: unknown): value is DocumentDescriptor {
  return value !== null && typeof value === "object" && "graphId" in value;
}
